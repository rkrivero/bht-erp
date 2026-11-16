# Backend API & Service Performance Audit (`bht_neon`)

**Date:** 2026-11-15
**Scope:** `src/app/api/**`, `src/lib/services/**`, `src/app/api/sync/route.ts`
**Benchmark Target:** `BHT_DB_BRANCH=dev` (`bht_erp`, Neon Postgres 17.12, `Pool max=6`)

---

## 1. Summary of Findings

| Severity | Area | Finding | Observed Impact |
|---|---|---|---|
| **High** | `src/app/api/partners/route.ts`, `treasury/route.ts`, `services/*` | `Promise.all([client.query(...), ...])` called on a **single `PoolClient`** | Serializes 15 queries sequentially on 1 TCP connection (**1,933 ms** measured on `dev`) and emits `pg@9` `DeprecationWarning` |
| **High** | `src/app/api/partners/route.ts` + `analytics-and-reports.ts` | Duplicate view scans inside `GET /api/partners` | `v_kpi_cash_and_reinvestment` and `v_kpi_sku_margin_and_opex` are each queried twice per dashboard load |
| **High** | `src/app/api/{auth,orders,collections,treasury,purchases,partners,reports}/route.ts` | Missing `Cache-Control: no-store` on authenticated JSON responses | Only `/api/reports` CSV export sets `Cache-Control: no-store`; mobile/browser caches or bfcache can serve stale financial/order snapshots |
| **Medium** | `src/lib/services/orders.ts`, `collections-and-treasury.ts`, `purchases-and-suppliers.ts` | N+1 per-line SQL loops inside write transactions | Multi-line orders, FIFO collections, and itemized supplier purchases execute 1–3 roundtrips per item (~130–150 ms/RTT over WAN) |
| **Medium** | `src/app/socios/page.tsx` -> `/api/partners` + `/api/purchases` | Cross-endpoint overlap on `/socios` load | `analytics.v_pending_on_demand_orders`, `erp.cash_accounts`, and `erp.ap_obligations` are fetched twice on initial load/refresh |
| **Low** | `src/app/api/{orders,collections,treasury,purchases,partners,reports}/route.ts` | Unauthenticated `GET` returns `403` instead of `401` | `assertRole(verifySessionToken(token), ...)` throws `AuthorizationError` (`403`) even when cookie is absent (`POST /api/orders` and `GET /api/sync` properly return `401`) |

---

## 2. Detailed Benchmarks & Code-Level Evidence

### A. Single-`PoolClient` Serialization vs. Pool Parallelism & Query Batching
Measured directly against `DEV_DATABASE_URL` (`Pool max=6`):
- **Current pattern (`Promise.all` on 1 `PoolClient`):** `1,933 ms` for the 15 queries executed by `GET /api/partners` (`9` in `partners/route.ts` + `6` in `getBiSummary`), accompanied by:
  `DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0.`
- **Warm pool `Promise.all` (across `max=6` sockets):** `388 ms` (**5.0× faster**).
- **Single batched `json_agg` query (6 panels in 1 RTT):** `285 ms` (**6.8× faster**, single roundtrip).

Affected call sites:
1. `src/app/api/partners/route.ts:22-170` (`Promise.all` of 9 `client.query` calls + `getBiSummary(client)`).
2. `src/lib/services/analytics-and-reports.ts:119-235` (`getBiSummary`, 6 `client.query` calls in `Promise.all`).
3. `src/app/api/treasury/route.ts:22-87` (4 `client.query` calls in `Promise.all`).
4. `src/lib/services/purchases-and-suppliers.ts:174-284` (`getPurchasesDashboard`, 5 `client.query` calls in `Promise.all`).

**Recommended safe fix (requires `@coordinator` approval before touching shared services):**
- For read-only routes, execute independent queries via `pool.query(...)` (or combine small dashboards into 1–2 CTE/`json_agg` statements) instead of sharing one `PoolClient` across `Promise.all`, and deduplicate `v_kpi_cash_and_reinvestment` + `v_kpi_sku_margin_and_opex` inside `GET /api/partners` (saving 2 full view scans per request).

### B. Duplicate & Overlapping Queries
- `src/app/api/partners/route.ts`:
  - `q1Res` (`:33-60`) and `getBiSummary` (`analytics-and-reports.ts:127-141`) both scan `analytics.v_kpi_cash_and_reinvestment`.
  - `q2Res` (`:61-80`) and `getBiSummary` (`analytics-and-reports.ts:201-220`) both scan `analytics.v_kpi_sku_margin_and_opex`.
- `src/lib/services/orders.ts`:
  - `getMainWarehouseId` (`:50-58`) runs `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1` on every `createOrder` and `listCatalogForRole` call (and `updateProductStockAndPricing` in `collections-and-treasury.ts:558`). Since `MAIN` warehouse ID is static per process/branch, it can be cached or joined in the main `SELECT` (`JOIN erp.warehouses w ON w.code = 'MAIN'`).

### C. N+1 Query Loops in Services
1. **`src/lib/services/orders.ts`**
   - `createOrder` (`:163-232`): Queries `erp.products` + `erp.v_current_stock` once per line item; should batch with `WHERE p.product_id = ANY($2::bigint[])`.
   - `createOrder` (`:288-316`): Inserts `erp.sales_order_lines` row-by-row; can batch with `unnest(...)`.
   - `deductStockForOrderLines` (`:96-119`): Inserts `erp.inventory_movements` row-by-row.
   - `cancelOrder` (`:562-581`): Inserts `RETURN_IN` movements row-by-row.
2. **`src/lib/services/collections-and-treasury.ts`**
   - `registerCustomerFifoPayment` (`:264-290`): Calls `registerOrderPayment` inside a `for` loop (5–6 queries per open order, including repeated `resolveCashAccountId` and `FOR UPDATE` lookups).
   - `resetHistoricalNegativeStock` (`:520-535`): Inserts `ADJUSTMENT` movements row-by-row instead of a single `INSERT INTO ... SELECT`.
3. **`src/lib/services/purchases-and-suppliers.ts`**
   - `registerSupplierPurchase` (`:579-606`): Queries `erp.products` one item at a time.
   - `registerSupplierPurchase` (`:711-760`): Loops 3 sequential SQL statements per line (`INSERT purchase_invoice_lines`, `INSERT inventory_movements`, `UPDATE erp.products`).
   - `registerSupplierPurchase` (`:828-887`): Loops `SELECT ... FOR UPDATE` + `UPDATE` for each `fulfillOrderLineIds` entry.

### D. Missing `Cache-Control: no-store` Headers
- Only `src/app/api/reports/route.ts:59` (CSV download path) sets `"Cache-Control": "no-store"`.
- All JSON handlers (`auth`, `orders`, `collections`, `treasury`, `purchases`, `partners`, `reports` JSON) omit `Cache-Control: no-store`. Adding `headers: { "Cache-Control": "no-store, private" }` prevents browser/proxy/mobile WebView stale reads during multi-device workflows.

### E. Live-Sync Endpoint (`/api/sync`) Design Verification
- **Single-roundtrip SQL watermark:** Measured **1.631 ms** Postgres execution time (~155 ms end-to-end RTT from local machine to Neon `dev`).
- **Connection pool safety:** `GET /api/sync` SSE borrows a `PoolClient` via `withClient()` only for the ~1.6 ms watermark read per poll cycle (`2000 ms`) and immediately releases it — zero idle held connections against `Pool max=6`.
- **Client efficiency (`useLiveSync.ts`):** Pauses immediately when tab is hidden (`visibilityState === "hidden"`), resumes via `?since=<lastVersion>` on `visibilitychange` / `focus` / `online`, and prevents overlapping refreshes when `onRemoteChange` is already in flight.

---

## 3. Implemented Optimizations (Post-Audit `#11`)

All high- and medium-impact non-breaking optimizations approved by `@coordinator` (`#11`) have been applied while preserving 100% of existing JSON schemas, HTTP status codes, error messages, and RBAC projections:

1. **`Cache-Control: no-store` & `force-dynamic` on all JSON API routes**
   - Added `export const dynamic = "force-dynamic"` and `Cache-Control: no-store` headers on every success and error response across `src/app/api/{auth,orders,collections,treasury,purchases,partners,reports}/route.ts`.
2. **Eliminated single-`PoolClient` `Promise.all` serialization & duplicate view scans**
   - `src/lib/services/analytics-and-reports.ts` (`getBiSummary`): consolidated all 6 `client.query` calls into a single batched `json_agg` query (`BI_SOLD_QTY_CTE` + `BI_NON_MONTHLY_SELECTS` + `mapBiSummaryFromPanels`).
   - `src/app/api/partners/route.ts` (`GET`): consolidated all 9 dashboard queries plus the 5 non-monthly BI panels into **1 single DB round-trip**, reusing `q1` rows for `biSummary.monthlyPerformance` instead of scanning `analytics.v_kpi_cash_and_reinvestment` twice.
   - `src/app/api/treasury/route.ts` (`GET`): consolidated the 4 `Promise.all` queries into **1 single DB round-trip** with server-side RBAC filtering (`isPartnerRole(actor.role)`).
   - `src/lib/services/purchases-and-suppliers.ts` (`getPurchasesDashboard`): consolidated all 5 `Promise.all` queries into **1 single DB round-trip** on the caller's `PoolClient`.
   - `src/app/api/orders/route.ts` (`GET`): batched `customers` and `accounts` lookups for non-warehouse roles into 1 `json_agg` query.
   - Verified **0** `pg@9` `client.query() when the client is already executing a query` deprecation warnings remain across the entire test suite.
3. **Eliminated N+1 SQL loops in transactional services**
   - `src/lib/services/collections-and-treasury.ts` (`resetHistoricalNegativeStock`): replaced per-SKU `INSERT` loop with a single `INSERT INTO erp.inventory_movements ... SELECT ... FROM erp.v_current_stock WHERE stock_on_hand < -0.0001`.
   - `src/lib/services/orders.ts`: batched product lookup (`ANY($2::bigint[])`) and multi-row `sales_order_lines` `VALUES` insert in `createOrder`, converted `deductStockForOrderLines` and `cancelOrder` stock restoration (`RETURN_IN`) to set-based `INSERT ... SELECT`, and inlined the `MAIN` warehouse join inside `listCatalogForRole`.
   - `src/lib/services/purchases-and-suppliers.ts` (`registerSupplierPurchase`): batched active product lookup (`ANY($1::bigint[])`), `unnest(...)` batch inserts for `purchase_invoice_lines` and `inventory_movements`, batched `erp.products.ref_cost_pen` update, and batched `FOR UPDATE OF sol` + `unnest(...)` updates for `fulfillOrderLineIds`.
