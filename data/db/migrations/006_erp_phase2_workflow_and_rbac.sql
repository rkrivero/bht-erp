-- ============================================================================
-- Migration 006: Phase 2 Workflow, 4-Role RBAC, Soles Discounts, 4-Responsible
-- Traceability, Promised Collection Date & Debtors Aging View
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'erp' AND t.typname = 'user_role') THEN
        CREATE TYPE erp.user_role AS ENUM (
            'PARTNER_ADMIN',
            'PARTNER_MANAGER',
            'EXTERNAL_SELLER',
            'WAREHOUSE_DELIVERY'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'erp' AND t.typname = 'order_operational_status') THEN
        CREATE TYPE erp.order_operational_status AS ENUM (
            'PENDING_PARTNER_APPROVAL',
            'REGISTERED',
            'PICKING',
            'READY',
            'IN_ROUTE',
            'DELIVERED',
            'CANCELLED'
        );
    END IF;
END $$;

-- 1. App Users Table (4 Roles)
CREATE TABLE IF NOT EXISTS erp.app_users (
    user_id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    role erp.user_role NOT NULL,
    pin_hash TEXT NOT NULL,
    default_cash_account_id BIGINT REFERENCES erp.cash_accounts(account_id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial operational users with SHA-256 PIN hashes
INSERT INTO erp.app_users (username, full_name, role, pin_hash, default_cash_account_id)
SELECT
    v.username,
    v.full_name,
    v.role::erp.user_role,
    encode(sha256(v.pin::bytea), 'hex'),
    (SELECT account_id FROM erp.cash_accounts WHERE code = 'CAJA_RUTA' LIMIT 1)
FROM (
    VALUES
        ('socio_admin', 'Socio Operativo y Admin', 'PARTNER_ADMIN', '1111'),
        ('socio_gerente', 'Socio Gerente', 'PARTNER_MANAGER', '2222'),
        ('vendedor1', 'Vendedor Externo Ruta', 'EXTERNAL_SELLER', '3333'),
        ('almacen1', 'Encargado de Almacén', 'WAREHOUSE_DELIVERY', '4444'),
        ('reparto1', 'Chofer y Reparto', 'WAREHOUSE_DELIVERY', '5555')
) AS v(username, full_name, role, pin)
ON CONFLICT (username) DO NOTHING;

-- 2. Minimum Permitted Sale Price on Products (initialized to list_sale_price_pen)
ALTER TABLE erp.products
    ADD COLUMN IF NOT EXISTS min_sale_price_pen NUMERIC(12,4) CHECK (min_sale_price_pen IS NULL OR min_sale_price_pen >= 0);

UPDATE erp.products
SET min_sale_price_pen = list_sale_price_pen
WHERE min_sale_price_pen IS NULL
  AND list_sale_price_pen IS NOT NULL;

-- 3. Per-Unit Soles Discount & Floor Flag on Sales Order Lines
ALTER TABLE erp.sales_order_lines
    ADD COLUMN IF NOT EXISTS base_unit_price_pen NUMERIC(12,4),
    ADD COLUMN IF NOT EXISTS unit_discount_pen NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (unit_discount_pen >= 0),
    ADD COLUMN IF NOT EXISTS below_min_price_flag BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE erp.sales_order_lines
SET base_unit_price_pen = unit_price_pen
WHERE base_unit_price_pen IS NULL;

-- 4. Operational Workflow, 4-Responsible Traceability & Promised Collection Date on Sales Orders
ALTER TABLE erp.sales_orders
    ADD COLUMN IF NOT EXISTS operational_status erp.order_operational_status NOT NULL DEFAULT 'REGISTERED',
    ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT REFERENCES erp.app_users(user_id),
    ADD COLUMN IF NOT EXISTS approved_by_user_id BIGINT REFERENCES erp.app_users(user_id),
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS picked_by_user_id BIGINT REFERENCES erp.app_users(user_id),
    ADD COLUMN IF NOT EXISTS picked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS delivered_by_user_id BIGINT REFERENCES erp.app_users(user_id),
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS stock_deducted BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS promised_payment_date DATE;

-- Mark all historical backfill orders as already DELIVERED and set default promised_payment_date for open credit orders
UPDATE erp.sales_orders
SET operational_status = 'DELIVERED'
WHERE source_origin = 'HISTORICAL_BACKFILL'
  AND operational_status <> 'DELIVERED';

UPDATE erp.sales_orders
SET promised_payment_date = (order_date + INTERVAL '7 days')::date
WHERE is_settled = FALSE
  AND promised_payment_date IS NULL;

-- 5. Collection Responsible on AR Payments
ALTER TABLE erp.ar_payments
    ADD COLUMN IF NOT EXISTS collected_by_user_id BIGINT REFERENCES erp.app_users(user_id);

-- 6. Audit Log of Order Status Transitions
CREATE TABLE IF NOT EXISTS erp.sales_order_events (
    event_id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES erp.sales_orders(order_id) ON DELETE CASCADE,
    from_status erp.order_operational_status,
    to_status erp.order_operational_status NOT NULL,
    actor_user_id BIGINT REFERENCES erp.app_users(user_id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_order_events_order ON erp.sales_order_events(order_id, created_at);

-- 7. Debtors Aging & Collection Schedule View
CREATE OR REPLACE VIEW analytics.v_debtors_aging AS
WITH payment_stats AS (
    SELECT
        p.order_id,
        COUNT(*) AS payment_count,
        MAX(p.payment_date) AS last_payment_date
    FROM erp.ar_payments p
    GROUP BY p.order_id
)
SELECT
    so.order_id,
    so.order_code,
    so.order_date,
    so.customer_party_id,
    COALESCE(pa.trade_name, pa.legal_name, so.customer_name_raw, 'CLIENTE SIN NOMBRE') AS customer_name,
    so.payment_mode::text AS payment_mode,
    so.operational_status::text AS operational_status,
    ROUND(so.total_pen, 2) AS total_pen,
    ROUND(so.paid_pen, 2) AS paid_pen,
    ROUND(so.balance_due_pen, 2) AS balance_due_pen,
    GREATEST(0, (CURRENT_DATE - so.order_date))::int AS days_overdue,
    CASE
        WHEN (CURRENT_DATE - so.order_date) >= 30 THEN 'RED_30_PLUS'
        WHEN (CURRENT_DATE - so.order_date) >= 8 THEN 'AMBER_8_29'
        ELSE 'GREEN_0_7'
    END AS aging_bucket,
    so.promised_payment_date,
    CASE
        WHEN so.promised_payment_date IS NULL THEN 'NO_PROMISE_DATE'
        WHEN so.promised_payment_date < CURRENT_DATE THEN 'PROMISE_BROKEN'
        WHEN so.promised_payment_date <= (CURRENT_DATE + 1) THEN 'DUE_TODAY_OR_TOMORROW'
        ELSE 'ON_SCHEDULE'
    END AS promise_status,
    COALESCE(ps.payment_count, 0)::int AS payment_count,
    ps.last_payment_date,
    u.full_name AS created_by_name
FROM erp.sales_orders so
LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
LEFT JOIN payment_stats ps ON ps.order_id = so.order_id
LEFT JOIN erp.app_users u ON u.user_id = so.created_by_user_id
WHERE so.is_settled = FALSE
  AND so.balance_due_pen > 0.05
  AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
ORDER BY so.promised_payment_date ASC NULLS LAST, so.order_date ASC, so.order_id ASC;
