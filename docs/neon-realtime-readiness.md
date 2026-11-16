# Neon Realtime Readiness & Activation Guide (`bht_neon`)

**Date:** 2026-11-15
**Target Branch Checked (read-only):** `BHT_DB_BRANCH=dev` (`bht_erp` on PostgreSQL 17.12)
**Current App Runtime:** Next.js `15.1.0`, React `19.0.0`, `pg` `8.13.1` (no Drizzle/Kysely ORM)

---

## 1. Executive Summary

The `bht_erp` Postgres schema is **structurally ready** for Neon Realtime (`@neon/realtime`), with every operational base table satisfying primary key, replica identity, and row-level security requirements. However, **Neon Realtime is not yet enabled** on the Neon project/branch (`NEON_REALTIME_URL` and `NEON_REALTIME_SECRET` are unset, and `wal_level` on `dev` is currently `replica`).

Because Realtime is not provisioned yet, `bht_neon` now runs a **zero-dependency Postgres watermark + SSE live-sync engine** (`/api/sync` + `useLiveSync.ts`) that works immediately on Neon Postgres today and provides a clean upgrade seam to `@neon/realtime` once enabled in the Neon Console.

---

## 2. Package & Environment Audit

### NPM Package Ecosystem (`npm view`, not installed)
- `@neon/realtime`: `0.2.1`
- `@neon/realtime-react`: `0.2.0`
- `@neon/realtime-drizzle`: `0.2.0` (not needed; `bht_neon` uses `pg` raw SQL)
- `@neon/realtime-tanstack`: `0.3.1` (optional)

### Environment Variable Names Audit (values never printed)
Checked `../bht_data/.env` (no `.env*` files exist in `bht_neon/`):
- Configured: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `DEV_DATABASE_URL`, `DEV_DATABASE_URL_UNPOOLED`, `NEON_PROJECT_ID`, `NEON_ORG_ID`, `NEON_DEFAULT_BRANCH`
- Missing for Neon Realtime:
  - `NEON_REALTIME_URL`
  - `NEON_REALTIME_SECRET`
  - `NEXT_PUBLIC_NEON_REALTIME_URL` (required in browser bundles for Next.js Client Components)

---

## 3. Database Schema & Requirements Audit (`BHT_DB_BRANCH=dev`)

From `.neon-realtime` requirements (`references/queries.md`, `references/ssr.md`, `SKILL.md`):
1. **Stable Replica Identity:** Every table read by a live query must have a stable replica identity (a Primary Key satisfies `DEFAULT`).
2. **Row-Level Security (RLS) Disabled:** Neon Realtime currently rejects queries on tables with RLS enabled (`unsupported query: row security`).
3. **Deterministic Read-Only Queries:** Live queries must be single `SELECT` statements with no `;` and no non-deterministic functions (`now()`, `CURRENT_DATE`, `gen_random_uuid()`).

### Base Tables Readiness (`erp` & `public`)

| Table | Primary Key | Replica Identity | RLS Enabled / Forced | `@neon/realtime` Ready |
|---|---|---|---|---|
| `erp.sales_orders` | `order_id` | `default` | `false / false` | Ready |
| `erp.sales_order_lines` | `order_line_id` | `default` | `false / false` | Ready |
| `erp.sales_order_events` | `event_id` | `default` | `false / false` | Ready |
| `erp.products` | `product_id` | `default` | `false / false` | Ready |
| `erp.inventory_movements` | `movement_id` | `default` | `false / false` | Ready |
| `erp.ar_payments` | `ar_payment_id` | `default` | `false / false` | Ready |
| `erp.cash_ledger` | `ledger_id` | `default` | `false / false` | Ready |
| `erp.cash_accounts` | `account_id` | `default` | `false / false` | Ready |
| `erp.ap_obligations` | `ap_id` | `default` | `false / false` | Ready |
| `erp.purchase_invoices` | `purchase_id` | `default` | `false / false` | Ready |
| `erp.purchase_invoice_lines` | `purchase_line_id` | `default` | `false / false` | Ready |
| `erp.parties` | `party_id` | `default` | `false / false` | Ready |
| `erp.party_aliases` | `alias_id` | `default` | `false / false` | Ready |
| `erp.product_aliases` | `alias_id` | `default` | `false / false` | Ready |
| `erp.quotes` | `quote_id` | `default` | `false / false` | Ready |
| `erp.quote_lines` | `quote_line_id` | `default` | `false / false` | Ready |
| `erp.route_trips` | `trip_id` | `default` | `false / false` | Ready |
| `erp.warehouses` | `warehouse_id` | `default` | `false / false` | Ready |
| `erp.app_users` | `user_id` | `default` | `false / false` | Ready (never expose `pin_hash` in sealed queries) |
| `erp.audit_flags` | `flag_id` | `default` | `false / false` | Ready |
| `public.schema_migrations` | `version` | `default` | `false / false` | Ready |

**Optional optimization later:** For write-heavy tables (`erp.sales_orders`, `erp.inventory_movements`), `ALTER TABLE ... REPLICA IDENTITY FULL;` can be benchmarked if update lookup latency matters.

### Views & Query Design Caveats

- `erp.v_current_stock`: Deterministic aggregation over `erp.warehouses`, `erp.products`, `erp.inventory_movements` — directly usable in live queries.
- `analytics.v_debtors_aging`, `analytics.v_pending_on_demand_orders`, `analytics.v_kpi_ar_customers_and_quotes`: Reference `CURRENT_DATE`. When converting these to `@neon/realtime`, inline the query using `rawSql(...)` and pass Lima's date as a bound parameter via `pgParam.date(limaToday)` rather than calling `CURRENT_DATE` inside the live query.
- **Strict RBAC Column Projection:** Because sealed queries return rows straight from the Neon Live SQL WebSocket to the browser, **never seal `SELECT *`** on `erp.sales_orders`, `erp.sales_order_lines`, or `erp.products` for `WAREHOUSE_DELIVERY` or `EXTERNAL_SELLER`:
  - `WAREHOUSE_DELIVERY` sealed queries must project ONLY operational fields (`order_id`, `order_code`, `operational_status`, `sku`, `raw_description`, `quantity`, `fulfillment_mode`, `fulfillment_status`, `stock_on_hand`) and omit all pricing/cost/payment columns.
  - `EXTERNAL_SELLER` sealed queries must omit `ref_cost_pen` and `unit_cost_snapshot_pen`.

---

## 4. Exact Activation Steps for `@neon/realtime`

### Step 1: Enable Realtime in Neon Console (or Neon CLI)
1. Open the Neon Console for project `NEON_PROJECT_ID` (ensure project is claimed and in a supported Realtime region).
2. Enable **Realtime** on `main` (and `dev` branch as needed), adding your app origins to **Allowed Origins**:
   - Local dev: `http://localhost:3000`
   - Production domain: `https://<your-production-domain>`
   - (Equivalent CLI if `neon` CLI is installed: `npx neon realtime enable --allowed-origin http://localhost:3000`)
3. Copy `NEON_REALTIME_URL` and `NEON_REALTIME_SECRET` from the Neon Console Realtime tab into `.env.local` (and deployment env vars), plus expose the public URL to Next.js client code:
   ```dotenv
   NEON_REALTIME_URL=wss://...
   NEON_REALTIME_SECRET=...
   NEXT_PUBLIC_NEON_REALTIME_URL=$NEON_REALTIME_URL
   ```

### Step 2: Install Packages
```bash
npm install @neon/realtime @neon/realtime-react
```

### Step 3: Initialize Server Sealing (`src/lib/realtime/neon-server.ts`)
Because `bht_neon` uses raw `pg` (`current_database() = 'bht_erp'`), use `createRealtime` with `rawSql` and `pgParam`:
```ts
import "server-only";
import { createRealtime } from "@neon/realtime/server";

export const neonRealtime = createRealtime({
  secret: process.env.NEON_REALTIME_SECRET!,
  db: "bht_erp",
});
```
- Authenticate every sealing Route Handler (`POST /api/sync/seal`) via `getSessionUser(req)`, verify `body.userId === actor.userId` (per `ssr.md#when-the-session-changes`), build role-scoped `rawSql` queries, and return `Response.json(sealedQuery, { headers: { "Cache-Control": "no-store" } })`.
- Note: Use Route Handlers (not Next.js Server Actions) for `refreshQuery`, because Server Actions execute sequentially (`references/subscribing.md`).

### Step 4: Wire Client Provider & Optimistic `txid`
1. Wrap the client tree with `<RealtimeProvider client={client}>` using a `useState(() => createRealtimeClient({ url: process.env.NEXT_PUBLIC_NEON_REALTIME_URL! }))` initializer (never at module scope during SSR, per `references/ssr.md`).
2. Add `pg_current_xact_id()::text AS txid` to the `RETURNING` clause of the primary `INSERT`/`UPDATE` in `src/lib/services/*.ts` mutations so clients can call `await utils.awaitTxId(txid, 10_000)`.
3. Keep `useLiveSync.ts` as the clean abstraction: when `getNeonRealtimeConfig().enabled` becomes `true`, `useLiveSync` can internally switch from `/api/sync` SSE to `@neon/realtime` `client.subscribe()` while preserving the exact `{ liveStatus, lastSyncedAt, triggerSync }` contract across `/socios`, `/vendedor`, and `/almacen`.
