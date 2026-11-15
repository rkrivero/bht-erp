# BHT Lightweight ERP (Phase 2 — `bht_neon`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the mobile-first (10h/day phone + 2h/day PC) multi-role ERP web application in `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon` connected to Neon Postgres (`bht-erp`), enforcing server-side financial isolation, Soles-per-unit discount floors with 1-tap Partner approval, 4-stage responsibility tracking, partial amortizations (`abonos`) with a debtors aging list, and Day-1 inventory reset.

**Architecture:** A single Next.js (App Router, TypeScript, Tailwind CSS) full-stack application in `bht_neon` backed by a new additive SQL migration `006_erp_phase2_workflow_and_rbac.sql` in `bht_data`. All database queries, role projections, and mutations run strictly on the server via `pg` against Neon (`dev` for tests, `main` for production) with `HMAC-SHA256` signed `HTTP-only` session cookies.

**Tech Stack:** PostgreSQL 17 (Neon `bht-erp`), Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, `pg` (`node-postgres`), Vitest.

**Spec:** `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/docs/superpowers/specs/2026-11-14-bht-erp-phase2-design.md`

## Global Constraints

- Application code lives exclusively in `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon`; SQL schema migrations live in `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_data/db/migrations/` and are applied via `uv run bht-etl migrate --branch {dev,main}`.
- Operating currency is `PEN` (`S/`). No SUNAT/OSE XML emission.
- Four strict roles (`PARTNER_ADMIN`, `PARTNER_MANAGER`, `EXTERNAL_SELLER`, `WAREHOUSE_DELIVERY`): `WAREHOUSE_DELIVERY` responses must never serialize prices, discounts, totals, costs, or debts; `EXTERNAL_SELLER` responses must never serialize `ref_cost_pen`, `unit_cost_snapshot_pen`, or gross margin fields.
- Product discounts are entered in Soles per unit (`unit_discount_pen >= 0`), never as percentages; `unit_price_pen = base_unit_price_pen - unit_discount_pen`.
- `DATABASE_URL` is server-only (`.env.local` gitignored); never print credentials in logs or client bundles.
- Timestamps display in `America/Lima` (`dd/MM/yyyy HH:mm`).

## Review Focus

1. **Discount larger than or equal to base unit price (`unit_discount_pen >= base_unit_price_pen`):** `createOrder` must reject any line where `base_unit_price_pen - unit_discount_pen <= 0` with `ValidationError("Precio final debe ser mayor a S/ 0.00")` before touching the database. (Tested in Task 3).
2. **Stock deduction while order is `PENDING_PARTNER_APPROVAL`:** When `EXTERNAL_SELLER` submits an order with a line below `min_sale_price_pen`, `createOrder` must NOT insert `SALE_OUT` movements until a Partner calls `approveDiscountedOrder`, and if rejected/cancelled while still `PENDING_PARTNER_APPROVAL`, `cancelOrder` must NOT insert duplicate `RETURN_IN` movements for stock that was never deducted. (Tested in Task 3).
3. **Overpayment on partial amortization (`amount_pen > balance_due_pen`):** `registerOrderPayment` must reject any single-order abono exceeding the order's current `balance_due_pen + 0.05` with `ValidationError("El abono supera el saldo pendiente del pedido")`. (Tested in Task 4).
4. **FIFO general customer payment across multiple open credit orders (`registerCustomerFifoPayment`):** When a customer with 2+ open orders pays a lump sum (e.g. `S/ 600` across a `S/ 400` older order and a `S/ 500` newer order), the service must settle the oldest order (`S/ 400`) first and apply the remainder (`S/ 200`) to the next order in a single transaction, rejecting if the lump sum exceeds the customer's total open balance. (Tested in Task 4).
5. **Idempotent Day-1 negative stock reset (`resetHistoricalNegativeStock`):** Running the reset button twice in a row must bring all `< 0` SKUs to `0` on the first run and insert `0` adjustments on the second run without affecting SKUs that already have positive stock (`> 0`). (Tested in Task 4).

---

## File Structure

- `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_data/db/migrations/006_erp_phase2_workflow_and_rbac.sql` — Additive Phase 2 schema (users, min price, unit discount, operational statuses, 4-responsible columns, order events).
- `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_data/tests/test_phase2_schema.py` — Pytest verification of migration `006` on Neon `dev`.
- `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/package.json`, `tsconfig.json`, `vitest.config.ts`, `next.config.ts`, `.gitignore` — Next.js + Vitest project configuration.
- `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/lib/types.ts` — Shared TypeScript domain types (`Role`, `SessionUser`, `OrderOperationalStatus`, role-specific DTOs).
- `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/lib/db.ts` — Server-side `pg.Pool` connection helper (`query`, `withTransaction`).
- `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/lib/auth.ts` — Password/PIN hashing (`scryptSync`), HMAC token signing/verification, and `authenticateUser(username, pin)`.
- `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/lib/rbac.ts` — Server-side DTO sanitizers (`projectProductForRole`, `projectOrderForRole`, `assertRole`).
- `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/lib/services/orders.ts` — Transactional order lifecycle (`createOrder`, `approveDiscountedOrder`, `advanceWarehouseStatus`, `cancelOrder`, `listOrdersForRole`).
- `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/lib/services/collections-and-treasury.ts` — Debtors aging list, partial `abonos`, FIFO customer payments, route expenses, supplier purchases, and Day-1 negative stock reset.
- `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/tests/{rbac-and-auth,orders-service,collections-and-treasury}.test.ts` — Automated unit and transactional DB integration tests.
- `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/app/` — Next.js App Router API endpoints (`/api/...`) and role-tailored mobile/PC views (`/login`, `/almacen`, `/vendedor`, `/socios`).

---

### Task 1: Phase 2 Database Migration (`006_erp_phase2_workflow_and_rbac.sql`) & Schema Tests

**Files:**
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_data/db/migrations/006_erp_phase2_workflow_and_rbac.sql`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_data/tests/test_phase2_schema.py`

**Interfaces:**
- Consumes: Existing `erp.products`, `erp.sales_orders`, `erp.sales_order_lines`, `erp.ar_payments`, `erp.cash_accounts` from migrations `001`–`005`.
- Produces:
  - Enum `erp.user_role`: `'PARTNER_ADMIN' | 'PARTNER_MANAGER' | 'EXTERNAL_SELLER' | 'WAREHOUSE_DELIVERY'`
  - Enum `erp.order_operational_status`: `'PENDING_PARTNER_APPROVAL' | 'REGISTERED' | 'PICKING' | 'READY' | 'IN_ROUTE' | 'DELIVERED' | 'CANCELLED'`
  - Table `erp.app_users(user_id, username, full_name, role, pin_hash, default_cash_account_id, is_active, created_at)` seeded with 5 users (`socio_admin` PIN `1111`, `socio_gerente` PIN `2222`, `vendedor1` PIN `3333`, `almacen1` PIN `4444`, `reparto1` PIN `5555` using deterministic SHA-256 hex `encode(digest(pin, 'sha256'), 'hex')` via `pgcrypto` or built-in `sha256(pin::bytea)`).
  - Column `erp.products.min_sale_price_pen NUMERIC(12,4)` initialized to `list_sale_price_pen` where `min_sale_price_pen IS NULL`.
  - Columns on `erp.sales_order_lines`: `base_unit_price_pen NUMERIC(12,4)`, `unit_discount_pen NUMERIC(12,4) NOT NULL DEFAULT 0`, `below_min_price_flag BOOLEAN NOT NULL DEFAULT FALSE`.
  - Columns on `erp.sales_orders`: `operational_status erp.order_operational_status NOT NULL DEFAULT 'REGISTERED'` (backfilled to `'DELIVERED'` for `source_origin = 'HISTORICAL_BACKFILL'`), `created_by_user_id`, `approved_by_user_id`, `approved_at`, `picked_by_user_id`, `picked_at`, `delivered_by_user_id`, `delivered_at`, `stock_deducted BOOLEAN NOT NULL DEFAULT TRUE`, `promised_payment_date DATE`.
  - Column on `erp.ar_payments`: `collected_by_user_id BIGINT REFERENCES erp.app_users(user_id)`.
  - Table `erp.sales_order_events(event_id, order_id, from_status, to_status, actor_user_id, notes, created_at)`.
  - View `analytics.v_debtors_aging`: per-order and per-customer pending AR with `days_overdue = (CURRENT_DATE - order_date)`, `aging_bucket` (`'GREEN_0_7' | 'AMBER_8_29' | 'RED_30_PLUS'`), `promised_payment_date`, `promise_status` (`'DUE_TODAY_OR_TOMORROW' | 'PROMISE_BROKEN' | 'ON_SCHEDULE' | 'NO_PROMISE_DATE'`), `paid_pen`, `balance_due_pen`, and payment count.

- [ ] **Step 1: Write the failing test in `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_data/tests/test_phase2_schema.py`**

```python
from __future__ import annotations
from bht_etl.db import get_connection

def test_phase2_users_and_min_price_initialized() -> None:
    with get_connection("dev") as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT username, role::text FROM erp.app_users ORDER BY user_id;")
            users = cur.fetchall()
            assert ("socio_admin", "PARTNER_ADMIN") in users
            assert ("socio_gerente", "PARTNER_MANAGER") in users
            assert ("vendedor1", "EXTERNAL_SELLER") in users
            assert ("almacen1", "WAREHOUSE_DELIVERY") in users

            cur.execute(
                "SELECT COUNT(*) FROM erp.products WHERE list_sale_price_pen IS NOT NULL AND min_sale_price_pen IS NULL;"
            )
            assert cur.fetchone()[0] == 0

def test_historical_orders_marked_delivered_and_debtors_view() -> None:
    with get_connection("dev") as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM erp.sales_orders WHERE source_origin = 'HISTORICAL_BACKFILL' AND operational_status <> 'DELIVERED';"
            )
            assert cur.fetchone()[0] == 0

            cur.execute(
                "SELECT COUNT(*), SUM(balance_due_pen) FROM analytics.v_debtors_aging WHERE aging_bucket = 'RED_30_PLUS';"
            )
            cnt, total_due = cur.fetchone()
            assert cnt == 12
            assert float(total_due) == 45525.00
```

- [ ] **Step 2: Run pytest to verify it fails before migration `006` exists**

Run: `uv run pytest tests/test_phase2_schema.py -v`
Expected: FAIL with `UndefinedTable: relation "erp.app_users" does not exist`

- [ ] **Step 3: Create `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_data/db/migrations/006_erp_phase2_workflow_and_rbac.sql` and apply to `dev` and `main`**

Write `006_erp_phase2_workflow_and_rbac.sql` defining the enums, tables, columns, seed users (using `encode(sha256(pin::bytea), 'hex')`), historical backfill updates, and `analytics.v_debtors_aging`. Then run `uv run bht-etl migrate --branch dev && uv run bht-etl migrate --branch main`.

- [ ] **Step 4: Run pytest to verify migration `006` passes**

Run: `uv run pytest -v`
Expected: `15 passed` (`0` failures).

---

### Task 2: Initialize `bht_neon` Next.js TypeScript Workspace, DB Helper, Auth & RBAC Sanitizers

**Files:**
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/package.json`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/tsconfig.json`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/vitest.config.ts`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/.gitignore`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/lib/types.ts`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/lib/db.ts`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/lib/auth.ts`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/lib/rbac.ts`
- Test: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/tests/rbac-and-auth.test.ts`

**Interfaces:**
- Produces:
  - `UserRole = 'PARTNER_ADMIN' | 'PARTNER_MANAGER' | 'EXTERNAL_SELLER' | 'WAREHOUSE_DELIVERY'`
  - `SessionUser = { userId: number; username: string; fullName: string; role: UserRole; defaultCashAccountId: number | null }`
  - `withTransaction<T>(fn: (client: PoolClient) => Promise<T>, branch?: 'dev' | 'main'): Promise<T>`
  - `hashPin(pin: string): string`, `signSessionToken(user: SessionUser): string`, `verifySessionToken(token: string): SessionUser | null`
  - `authenticateUser(client: PoolClient, username: string, pin: string): Promise<SessionUser | null>`
  - `projectProductForRole(product: RawProductRow, role: UserRole): Record<string, unknown>`
  - `projectOrderForRole(order: RawOrderWithLines, role: UserRole): Record<string, unknown>`

- [ ] **Step 1: Initialize `bht_neon` package, install dependencies, and write the failing test in `tests/rbac-and-auth.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { projectOrderForRole, projectProductForRole } from "../src/lib/rbac";
import { signSessionToken, verifySessionToken } from "../src/lib/auth";

describe("RBAC Financial Isolation & Session Signing", () => {
  const sampleProduct = {
    product_id: 1,
    sku: "CARPET VERDEX2MT",
    name: "ALFOMBRA LLANA VERDE X 2MT",
    unit_of_measure: "UND",
    fulfillment_mode: "STOCKED" as const,
    stock_on_hand: 12,
    list_sale_price_pen: 70,
    min_sale_price_pen: 68,
    ref_cost_pen: 63.31,
  };

  const sampleOrder = {
    order_id: 10,
    order_code: "SO-2026-11-14-001",
    order_date: "2026-11-14",
    customer_name: "FERRETERIA EL SOL",
    operational_status: "REGISTERED" as const,
    payment_mode: "CREDIT" as const,
    total_pen: 700,
    paid_pen: 200,
    balance_due_pen: 500,
    created_by_name: "Vendedor 1",
    picked_by_name: null,
    delivered_by_name: null,
    lines: [
      {
        order_line_id: 100,
        line_no: 1,
        sku: "CARPET VERDEX2MT",
        raw_description: "ALFOMBRA LLANA VERDE X 2MT",
        quantity: 10,
        base_unit_price_pen: 70,
        unit_discount_pen: 0,
        unit_price_pen: 70,
        line_total_pen: 700,
        unit_cost_snapshot_pen: 63.31,
        fulfillment_mode: "STOCKED" as const,
        fulfillment_status: "FULFILLED" as const,
      },
    ],
  };

  it("strips all money fields from WAREHOUSE_DELIVERY payloads", () => {
    const whProd = projectProductForRole(sampleProduct, "WAREHOUSE_DELIVERY");
    expect(whProd).not.toHaveProperty("list_sale_price_pen");
    expect(whProd).not.toHaveProperty("min_sale_price_pen");
    expect(whProd).not.toHaveProperty("ref_cost_pen");

    const whOrder = projectOrderForRole(sampleOrder, "WAREHOUSE_DELIVERY");
    expect(whOrder).not.toHaveProperty("total_pen");
    expect(whOrder).not.toHaveProperty("paid_pen");
    expect(whOrder).not.toHaveProperty("balance_due_pen");
    expect(whOrder).not.toHaveProperty("payment_mode");
    const whLine = (whOrder.lines as Record<string, unknown>[])[0];
    expect(whLine).not.toHaveProperty("unit_price_pen");
    expect(whLine).not.toHaveProperty("unit_discount_pen");
    expect(whLine).not.toHaveProperty("line_total_pen");
    expect(whLine).not.toHaveProperty("unit_cost_snapshot_pen");
    expect(whLine.quantity).toBe(10);
  });

  it("strips cost and margin fields from EXTERNAL_SELLER while keeping prices and min floor", () => {
    const sellerProd = projectProductForRole(sampleProduct, "EXTERNAL_SELLER");
    expect(sellerProd.list_sale_price_pen).toBe(70);
    expect(sellerProd.min_sale_price_pen).toBe(68);
    expect(sellerProd).not.toHaveProperty("ref_cost_pen");

    const sellerOrder = projectOrderForRole(sampleOrder, "EXTERNAL_SELLER");
    expect(sellerOrder.total_pen).toBe(700);
    expect(sellerOrder.balance_due_pen).toBe(500);
    const sellerLine = (sellerOrder.lines as Record<string, unknown>[])[0];
    expect(sellerLine.unit_price_pen).toBe(70);
    expect(sellerLine).not.toHaveProperty("unit_cost_snapshot_pen");
    expect(sellerLine).not.toHaveProperty("line_margin_pen");
  });

  it("includes cost and computed real margin for PARTNER_ADMIN and PARTNER_MANAGER", () => {
    const partnerOrder = projectOrderForRole(sampleOrder, "PARTNER_ADMIN");
    const partnerLine = (partnerOrder.lines as Record<string, unknown>[])[0];
    expect(partnerLine.unit_cost_snapshot_pen).toBe(63.31);
    expect(partnerLine.line_margin_pen).toBeCloseTo(66.9, 2);
  });

  it("signs and verifies session tokens tamper-proof", () => {
    const token = signSessionToken({
      userId: 1,
      username: "socio_admin",
      fullName: "Socio Operativo",
      role: "PARTNER_ADMIN",
      defaultCashAccountId: 1,
    });
    expect(verifySessionToken(token)?.role).toBe("PARTNER_ADMIN");
    expect(verifySessionToken(token + "tampered")).toBeNull();
  });
});
```

- [ ] **Step 2: Run Vitest to verify it fails**

Run: `npm --prefix /Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon test`
Expected: FAIL with module not found `../src/lib/rbac`.

- [ ] **Step 3: Implement `types.ts`, `db.ts`, `auth.ts`, and `rbac.ts`**

Implement `db.ts` reading `NEON_DATABASE_URL_DEV` / `NEON_DATABASE_URL_MAIN` / `DATABASE_URL` (falling back to `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_data/.env` for local dev), `auth.ts` with SHA-256 PIN matching and HMAC-SHA256 cookies, and `rbac.ts` enforcing strict server-side key allowlists per role.

- [ ] **Step 4: Run Vitest to verify it passes**

Run: `npm --prefix /Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon test`
Expected: PASS (`4 passed`).

---

### Task 3: Order Lifecycle Service (Soles Discount Floor, Partner Approval, Stock Reservation & 4-Responsible Tracking)

**Files:**
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/lib/services/orders.ts`
- Test: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/tests/orders-service.test.ts`

**Interfaces:**
- Consumes: `SessionUser`, `PoolClient`, `projectOrderForRole` from Task 2.
- Produces:
  - `CreateOrderInput = { customerPartyId?: number | null; customerNameRaw: string; paymentMode: 'CASH' | 'CREDIT' | 'TRANSFER' | 'YAPE_PLIN'; creditDays?: number; promisedPaymentDate?: string | null; initialPaidPen?: number; paymentAccountId?: number; notes?: string; lines: Array<{ productId: number; quantity: number; unitDiscountPen?: number }> }`
  - `createOrder(client: PoolClient, actor: SessionUser, input: CreateOrderInput): Promise<{ orderId: number; orderCode: string; operationalStatus: string; requiresApproval: boolean }>`
  - `approveDiscountedOrder(client: PoolClient, actor: SessionUser, orderId: number): Promise<{ orderId: number; operationalStatus: 'REGISTERED' }>`
  - `advanceWarehouseStatus(client: PoolClient, actor: SessionUser, orderId: number, nextStatus: 'PICKING' | 'READY' | 'IN_ROUTE' | 'DELIVERED'): Promise<void>`
  - `cancelOrder(client: PoolClient, actor: SessionUser, orderId: number, reason: string): Promise<void>`

- [ ] **Step 1: Write the failing transactional tests in `tests/orders-service.test.ts`**

Include tests for:
1. Review Focus #1: Rejecting `unitDiscountPen >= base_unit_price_pen` with `ValidationError`.
2. Review Focus #2: `EXTERNAL_SELLER` order with `unitDiscountPen > 0` below `min_sale_price_pen` saves as `'PENDING_PARTNER_APPROVAL'` with `stock_deducted = false` and `0` inventory movements; calling `approveDiscountedOrder` as `PARTNER_ADMIN` transitions to `'REGISTERED'`, stamps `approved_by_user_id`, and deducts `SALE_OUT` stock; cancelling an unapproved order inserts `0` `RETURN_IN` movements, whereas cancelling an approved `'REGISTERED'` order restores stock via `RETURN_IN`.
3. `ON_DEMAND` item at `0` stock creates `PENDING_SUPPLIER_PURCHASE` line and `ON_DEMAND_PENDING_PURCHASE` audit flag.
4. `advanceWarehouseStatus` stamps `picked_by_user_id` + `picked_at` on `'READY'` and `delivered_by_user_id` + `delivered_at` on `'DELIVERED'`.

- [ ] **Step 2: Run Vitest on `tests/orders-service.test.ts` to verify it fails**

Run: `npm --prefix /Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon test tests/orders-service.test.ts`
Expected: FAIL with module not found `../src/lib/services/orders`.

- [ ] **Step 3: Implement `src/lib/services/orders.ts`**

Implement `createOrder`, `approveDiscountedOrder`, `advanceWarehouseStatus`, `cancelOrder`, and `listOrdersForRole` using transactional SQL against `erp.sales_orders`, `erp.sales_order_lines`, `erp.inventory_movements`, `erp.ar_payments`, `erp.cash_ledger`, and `erp.sales_order_events`.

- [ ] **Step 4: Run Vitest on `tests/orders-service.test.ts` to verify it passes**

Run: `npm --prefix /Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon test tests/orders-service.test.ts`
Expected: PASS.

---

### Task 4: Debtors Aging List, Partial Amortizations (`Abonos`), FIFO Customer Payment, Treasury & Day-1 Stock Reset

**Files:**
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/lib/services/collections-and-treasury.ts`
- Test: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/tests/collections-and-treasury.test.ts`

**Interfaces:**
- Consumes: `SessionUser`, `PoolClient` from Task 2; `createOrder` from Task 3.
- Produces:
  - `registerOrderPayment(client: PoolClient, actor: SessionUser, input: { orderId: number; amountPen: number; paymentMode: 'CASH' | 'YAPE_PLIN' | 'TRANSFER'; accountId?: number; notes?: string; nextCollectionDays?: number; nextPromisedPaymentDate?: string | null }): Promise<{ arPaymentId: number; newPaidPen: number; newBalanceDuePen: number; isSettled: boolean; promisedPaymentDate: string | null }>`
  - `registerCustomerFifoPayment(client: PoolClient, actor: SessionUser, input: { customerPartyId: number; totalAmountPen: number; paymentMode: 'CASH' | 'YAPE_PLIN' | 'TRANSFER'; accountId?: number; notes?: string }): Promise<Array<{ orderId: number; orderCode: string; appliedPen: number }>>`
  - `listDebtors(client: PoolClient, actor: SessionUser): Promise<{ byCustomer: CustomerDebtSummary[]; byOrder: OrderDebtItem[] }>`
  - `getOrderPaymentTimeline(client: PoolClient, actor: SessionUser, orderId: number): Promise<PaymentTimelineEntry[]>`
  - `registerCashOutflow(client: PoolClient, actor: SessionUser, input: { amountPen: number; expenseBucket: 'ROUTE_OPEX' | 'MERCHANDISE_PAYMENT' | 'NON_OPEX_OR_CAPEX'; expenseCategory: string; description: string; accountId?: number; isInternalTransfer?: boolean }): Promise<{ ledgerId: number }>`
  - `resetHistoricalNegativeStock(client: PoolClient, actor: SessionUser): Promise<{ adjustedSkuCount: number }>`
  - `updateProductStockAndPricing(client: PoolClient, actor: SessionUser, input: { productId: number; physicalStock?: number; refCostPen?: number; listSalePricePen?: number; minSalePricePen?: number; fulfillmentMode?: 'STOCKED' | 'ON_DEMAND' }): Promise<void>`

- [ ] **Step 1: Write the failing transactional tests in `tests/collections-and-treasury.test.ts`**

Include tests for:
1. Credit order (`total = 1000`) with initial `Adelanto = 400` at creation (`paid_pen = 400, balance_due_pen = 600, is_settled = false`), followed by partial `registerOrderPayment` of `350` (`paid_pen = 750, balance_due_pen = 250`) and final `250` (`paid_pen = 1000, balance_due_pen = 0, is_settled = true`), verifying `getOrderPaymentTimeline` returns all 3 payments with `collected_by_user_id` and timestamps.
2. Review Focus #3: Rejecting `amountPen > balance_due_pen` with `ValidationError`.
3. Review Focus #4: `registerCustomerFifoPayment` distributing `S/ 600` across two open credit orders (`S/ 400` older + `S/ 500` newer -> settles older order completely and leaves `S/ 300` on newer order).
4. `EXTERNAL_SELLER` allowed to record `ROUTE_OPEX` in `registerCashOutflow`, but forbidden from recording `NON_OPEX_OR_CAPEX` or `MERCHANDISE_PAYMENT`.
5. Review Focus #5: `resetHistoricalNegativeStock` brings all negative SKUs to `0` on first call (`adjustedSkuCount == 93`) and returns `adjustedSkuCount == 0` on immediate second call.

- [ ] **Step 2: Run Vitest on `tests/collections-and-treasury.test.ts` to verify it fails**

Run: `npm --prefix /Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon test tests/collections-and-treasury.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/lib/services/collections-and-treasury.ts`**

Implement all functions with strict role checks, `erp.ar_payments` + `erp.cash_ledger` synchronization, FIFO allocation across open customer orders ordered by `(order_date ASC, order_id ASC)`, and idempotent `RESET_HISTORICAL_DEFICIT` inventory adjustments.

- [ ] **Step 4: Run Vitest to verify all service tests pass**

Run: `npm --prefix /Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon test`
Expected: PASS.

---

### Task 5: Next.js API Routes & Mobile-First Views for Login, Warehouse/Delivery (`/almacen`) and External Seller (`/vendedor`)

**Files:**
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/app/api/auth/route.ts`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/app/api/orders/route.ts`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/app/api/collections/route.ts`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/app/api/treasury/route.ts`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/app/layout.tsx`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/app/page.tsx`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/app/login/page.tsx`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/app/almacen/page.tsx`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/app/vendedor/page.tsx`

**Interfaces:**
- Consumes: Services and RBAC sanitizers from Tasks 2–4.
- Produces:
  - `/login`: Touch-friendly role/user selector + 4-digit PIN pad redirecting each role to its workspace (`/almacen`, `/vendedor`, `/socios`).
  - `/almacen`: Money-free mobile workspace with tabs (`Por Alistar`, `En Alistamiento`, `Listos`, `En Ruta`, `Entregados`), item checklist, `POR RECOGER DE PROVEEDOR` badge for `ON_DEMAND` items, and 1-tap state progression buttons.
  - `/vendedor`: 4-tab mobile workspace (`Nuevo Pedido` with Soles-per-unit discount +/- and optional initial `Adelanto`, `Mis Pedidos` with 4-responsible status badges, `Cobros y Deudores` with green/amber/red aging badges + payment timeline + partial `Abono` / FIFO modal, and `Gastos de Ruta`).

- [ ] **Step 1: Implement `/api/auth`, `/api/orders`, `/api/collections`, `/api/treasury` and `/login`, `/almacen`, `/vendedor` pages**

Ensure every API route reads the signed session cookie, enforces `assertRole`, and passes all outputs through `projectProductForRole` / `projectOrderForRole`.

- [ ] **Step 2: Verify TypeScript compilation and test suite**

Run: `npm --prefix /Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon run build` (after Task 6 completes `/socios`) or `npx --prefix /Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon tsc --noEmit`
Expected: `0` TypeScript errors.

---

### Task 6: Partner Live Control Tower, Day-1 Stock Reset/Catalog & 7-KPI Dashboard (`/socios`)

**Files:**
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/app/api/partners/route.ts`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/src/app/socios/page.tsx`
- Create: `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon/README.md`

**Interfaces:**
- Consumes: Services from Tasks 2–4 and `analytics.v_kpi_*` / `analytics.v_data_quality_gaps` / `analytics.v_pending_on_demand_orders` / `analytics.v_debtors_aging` in Neon.
- Produces:
  - `/socios`: Responsive mobile + desktop workspace for `PARTNER_ADMIN` and `PARTNER_MANAGER` with 5 tabs:
    1. `Control en Vivo`: 1-tap Discount Approval Queue (showing `ref_cost_pen`, real margin `S/` and `%`), `ON_DEMAND` Pending Supplier Purchases alert queue with supplier purchase linking, and live order monitor showing all 4 responsible timestamps (`Tomó`, `Alistó`, `Repartió`, `Cobró`) + order creation.
    2. `Deudores y Cobros`: Full debtors ranking (`Verde 0-7d`, `Ámbar 8-29d`, `Rojo 30+d`), payment history timeline, single-order abono, and FIFO customer abono.
    3. `Stock y Precios (Día 1)`: 1-click audited button `Poner en 0 los 93 saldos negativos históricos` + mobile-friendly editor for physical stock, `ref_cost_pen`, `list_sale_price_pen`, `min_sale_price_pen`, and `STOCKED` / `ON_DEMAND` mode.
    4. `Caja y Compras`: Route expenses, supplier purchase invoices, AP payments (`erp.ap_obligations`), bank deposits, and partner withdrawals.
    5. `KPIs e Insights (PC)`: Executive tables and cards for Q1 (`v_kpi_cash_and_reinvestment`), Q2 (`v_kpi_sku_margin_and_opex`), Q3 (`v_kpi_ar_customers_and_quotes`), and `v_data_quality_gaps`.

- [ ] **Step 1: Implement `/api/partners/route.ts`, `/socios/page.tsx`, and `README.md`**

- [ ] **Step 2: Run full test suite (`pytest` in `bht_data` + `vitest` in `bht_neon`) and production build (`next build`)**

Run: `uv run pytest -v && npm --prefix /Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon test && npm --prefix /Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon run build`
Expected: All tests PASS and `next build` exits `0`.

- [ ] **Step 3: Initialize Git repository in `bht_neon` and commit clean milestone**

```bash
git -C /Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon init
git -C /Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon add .
git -C /Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon commit -m "feat: implement BHT lightweight ERP Phase 2 mobile-first web app"
```
