-- 018_bloque_b_financial_truth_and_daily_close.sql
-- Bloque B:
--   1. Master-data operational columns on erp.parties, erp.products, and erp.cash_accounts.
--   2. Daily Close & per-account reconciliation tables (erp.daily_closures, erp.daily_closure_accounts).
--   3. Effective payment-date monthly cash flow & ADMIN_OPEX / owner-salary visibility
--      in analytics.v_kpi_cash_and_reinvestment and analytics.v_report_monthly_pnl.
--   4. Separation of invoice age vs explicit due_date overdue in analytics.v_debtors_aging
--      and analytics.v_report_ar_aging_detail.
--   5. Canonical 24h registration coverage & correction-rate SQL view.

-- ============================================================================
-- 1. Master-Data Operational Columns & Account Reconciliation Metadata
-- ============================================================================

ALTER TABLE erp.parties
    ADD COLUMN IF NOT EXISTS credit_days_agreed INT
        CHECK (credit_days_agreed IS NULL OR (credit_days_agreed >= 0 AND credit_days_agreed <= 365)),
    ADD COLUMN IF NOT EXISTS credit_limit_pen NUMERIC(14,2)
        CHECK (credit_limit_pen IS NULL OR credit_limit_pen >= 0),
    ADD COLUMN IF NOT EXISTS last_contact_date DATE;

ALTER TABLE erp.products
    ADD COLUMN IF NOT EXISTS cost_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS default_supplier_party_id BIGINT REFERENCES erp.parties(party_id),
    ADD COLUMN IF NOT EXISTS lead_time_days INT
        CHECK (lead_time_days IS NULL OR (lead_time_days >= 0 AND lead_time_days <= 365)),
    ADD COLUMN IF NOT EXISTS min_stock_qty NUMERIC(14,4)
        CHECK (min_stock_qty IS NULL OR min_stock_qty >= 0);

ALTER TABLE erp.cash_accounts
    ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_reconciled_balance_pen NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS last_reconciled_by_user_id BIGINT REFERENCES erp.app_users(user_id);

CREATE INDEX IF NOT EXISTS idx_ar_payments_active_date
    ON erp.ar_payments (payment_date)
    WHERE voided_at IS NULL;

-- ============================================================================
-- 2. Daily Close & Per-Account Reconciliation Tables + Watermark Sync
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS erp.seq_daily_closures_sync START 1;

CREATE TABLE IF NOT EXISTS erp.daily_closures (
    closure_id                 BIGSERIAL PRIMARY KEY,
    closure_date               DATE NOT NULL UNIQUE,
    status                     TEXT NOT NULL DEFAULT 'CLOSED' CHECK (status IN ('OPEN', 'CLOSED')),
    closed_by_user_id          BIGINT NOT NULL REFERENCES erp.app_users(user_id),
    sales_count                INT NOT NULL DEFAULT 0,
    sales_total_pen            NUMERIC(14,2) NOT NULL DEFAULT 0,
    collections_total_pen      NUMERIC(14,2) NOT NULL DEFAULT 0,
    expenses_total_pen         NUMERIC(14,2) NOT NULL DEFAULT 0,
    deposits_total_pen         NUMERIC(14,2) NOT NULL DEFAULT 0,
    expected_cash_total_pen    NUMERIC(14,2) NOT NULL DEFAULT 0,
    counted_cash_total_pen     NUMERIC(14,2) NOT NULL DEFAULT 0,
    variance_total_pen         NUMERIC(14,2) NOT NULL DEFAULT 0,
    pending_deliveries_count   INT NOT NULL DEFAULT 0,
    pending_collections_count  INT NOT NULL DEFAULT 0,
    pending_ap_7d_count        INT NOT NULL DEFAULT 0,
    incomplete_orders_24h      INT NOT NULL DEFAULT 0,
    next_day_notes             TEXT,
    notes                      TEXT,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_seq                   BIGINT NOT NULL DEFAULT nextval('erp.seq_daily_closures_sync')
);

DROP TRIGGER IF EXISTS trg_daily_closures_sync_watermark ON erp.daily_closures;
CREATE TRIGGER trg_daily_closures_sync_watermark
    BEFORE INSERT OR UPDATE ON erp.daily_closures
    FOR EACH ROW EXECUTE FUNCTION erp.fn_touch_generic_sync_watermark('erp.seq_daily_closures_sync');

CREATE INDEX IF NOT EXISTS idx_daily_closures_date
    ON erp.daily_closures (closure_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_closures_sync_seq
    ON erp.daily_closures (sync_seq DESC);

CREATE TABLE IF NOT EXISTS erp.daily_closure_accounts (
    closure_account_id   BIGSERIAL PRIMARY KEY,
    closure_id           BIGINT NOT NULL REFERENCES erp.daily_closures(closure_id) ON DELETE CASCADE,
    account_id           BIGINT NOT NULL REFERENCES erp.cash_accounts(account_id),
    system_balance_pen   NUMERIC(14,2) NOT NULL,
    counted_balance_pen  NUMERIC(14,2) NOT NULL,
    variance_pen         NUMERIC(14,2) GENERATED ALWAYS AS (counted_balance_pen - system_balance_pen) STORED,
    is_reconciled        BOOLEAN NOT NULL DEFAULT TRUE,
    notes                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (closure_id, account_id)
);

-- ============================================================================
-- 3. Effective-Date Monthly Cash Flow & Operating Expenses KPI View
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_kpi_cash_and_reinvestment AS
WITH monthly_sales AS (
    SELECT
        DATE_TRUNC('month', order_date)::DATE AS period_month,
        COUNT(*) AS order_count,
        COALESCE(SUM(total_pen), 0)::NUMERIC(14,2) AS sales_total_pen,
        COALESCE(SUM(paid_pen), 0)::NUMERIC(14,2) AS cash_collected_pen,
        COALESCE(SUM(balance_due_pen), 0)::NUMERIC(14,2) AS ar_pending_pen
    FROM erp.sales_orders
    WHERE order_date >= DATE '2026-06-26'
      AND operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY DATE_TRUNC('month', order_date)::DATE
),
monthly_collections AS (
    SELECT
        DATE_TRUNC('month', ap.payment_date)::DATE AS period_month,
        COALESCE(SUM(ap.amount_pen), 0)::NUMERIC(14,2) AS effective_cash_collected_pen
    FROM erp.ar_payments ap
    JOIN erp.sales_orders so ON so.order_id = ap.order_id
    WHERE ap.voided_at IS NULL
      AND ap.payment_date >= DATE '2026-06-26'
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY DATE_TRUNC('month', ap.payment_date)::DATE
),
monthly_cash AS (
    SELECT
        DATE_TRUNC('month', tx_date)::DATE AS period_month,
        COALESCE(SUM(amount_pen) FILTER (WHERE direction = 'IN' AND NOT is_internal_transfer AND NOT is_reversal AND expense_category <> 'CONCILIACION_SALDO'), 0)::NUMERIC(14,2) AS ledger_inflow_pen,
        COALESCE(SUM(amount_pen) FILTER (WHERE direction = 'OUT' AND NOT is_internal_transfer AND NOT is_reversal AND expense_category <> 'CONCILIACION_SALDO' AND expense_bucket = 'MERCHANDISE_PAYMENT'), 0)::NUMERIC(14,2) AS merchandise_outflow_pen,
        COALESCE(SUM(amount_pen) FILTER (WHERE direction = 'OUT' AND NOT is_internal_transfer AND NOT is_reversal AND expense_category <> 'CONCILIACION_SALDO' AND expense_bucket = 'ROUTE_OPEX'), 0)::NUMERIC(14,2) AS route_opex_pen,
        COALESCE(SUM(amount_pen) FILTER (WHERE direction = 'OUT' AND NOT is_internal_transfer AND NOT is_reversal AND expense_category <> 'CONCILIACION_SALDO' AND expense_bucket = 'ADMIN_OPEX'), 0)::NUMERIC(14,2) AS admin_opex_bucket_pen,
        COALESCE(SUM(amount_pen) FILTER (WHERE direction = 'OUT' AND NOT is_internal_transfer AND NOT is_reversal AND expense_category <> 'CONCILIACION_SALDO' AND expense_bucket = 'NON_OPEX_OR_CAPEX'), 0)::NUMERIC(14,2) AS non_opex_capex_drain_pen,
        COALESCE(SUM(amount_pen) FILTER (
            WHERE direction = 'OUT'
              AND NOT is_internal_transfer
              AND NOT is_reversal
              AND expense_category <> 'CONCILIACION_SALDO'
              AND expense_bucket = 'NON_OPEX_OR_CAPEX'
              AND expense_category IN (
                  'PAYROLL_ADVANCE', 'ACCOUNTING_OR_LEGAL', 'ACCOUNTING_SERVICE',
                  'LEGAL_NOTARIA', 'FINANCIAL_FEE', 'SUELDO_SOCIO',
                  'PLANILLA_PERSONAL', 'ALQUILER', 'SERVICIOS_BASICOS',
                  'IMPUESTOS_OPERATIVOS', 'SOFTWARE_OFICINA', 'OTROS_ADMIN'
              )
        ), 0)::NUMERIC(14,2) AS legacy_admin_in_non_opex_pen,
        COALESCE(SUM(amount_pen) FILTER (WHERE direction = 'OUT' AND NOT is_internal_transfer AND NOT is_reversal AND expense_category = 'SUELDO_SOCIO'), 0)::NUMERIC(14,2) AS owner_salary_recorded_pen,
        COALESCE(SUM(amount_pen) FILTER (WHERE is_internal_transfer AND NOT is_reversal AND direction = 'OUT'), 0)::NUMERIC(14,2) AS internal_deposits_pen
    FROM erp.cash_ledger
    WHERE tx_date >= DATE '2026-06-26'
    GROUP BY DATE_TRUNC('month', tx_date)::DATE
),
monthly_trips AS (
    SELECT
        DATE_TRUNC('month', rt.trip_date)::DATE AS period_month,
        COUNT(*) FILTER (WHERE rt.declared_net_cash_pen IS NOT NULL) AS reconciled_trips_count,
        COALESCE(SUM(rt.declared_net_cash_pen) FILTER (WHERE rt.declared_net_cash_pen IS NOT NULL), 0)::NUMERIC(14,2) AS declared_net_cash_pen,
        COALESCE(SUM(
            COALESCE((
                SELECT SUM(so.paid_pen)
                FROM erp.sales_orders so
                WHERE so.trip_id = rt.trip_id
                  AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
            ), 0)
            - COALESCE((SELECT SUM(cl.amount_pen) FROM erp.cash_ledger cl WHERE cl.trip_id = rt.trip_id AND cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'ROUTE_OPEX'), 0)
        ) FILTER (WHERE rt.declared_net_cash_pen IS NOT NULL), 0)::NUMERIC(14,2) AS expected_net_cash_pen
    FROM erp.route_trips rt
    WHERE rt.trip_date >= DATE '2026-06-26'
    GROUP BY DATE_TRUNC('month', rt.trip_date)::DATE
),
pre_route_outflows AS (
    SELECT
        DATE_TRUNC('month', tx_date)::DATE AS period_month,
        COALESCE(SUM(amount_pen) FILTER (WHERE direction = 'OUT' AND NOT is_internal_transfer), 0)::NUMERIC(14,2) AS pre_route_foundational_outflow_pen
    FROM erp.cash_ledger
    WHERE tx_date < DATE '2026-06-26'
    GROUP BY DATE_TRUNC('month', tx_date)::DATE
),
all_months AS (
    SELECT period_month FROM monthly_sales
    UNION
    SELECT period_month FROM monthly_collections
    UNION
    SELECT period_month FROM monthly_cash
    UNION
    SELECT period_month FROM monthly_trips
    UNION
    SELECT period_month FROM pre_route_outflows
)
SELECT
    m.period_month,
    COALESCE(ms.order_count, 0) AS order_count,
    COALESCE(ms.sales_total_pen, 0)::NUMERIC(14,2) AS sales_total_pen,
    COALESCE(mcol.effective_cash_collected_pen, 0)::NUMERIC(14,2) AS cash_collected_pen,
    COALESCE(ms.ar_pending_pen, 0)::NUMERIC(14,2) AS ar_pending_pen,
    COALESCE(mc.route_opex_pen, 0)::NUMERIC(14,2) AS route_opex_pen,
    ROUND(COALESCE(mc.route_opex_pen, 0) * 100.0 / NULLIF(ms.sales_total_pen, 0), 2) AS route_opex_pct,
    (COALESCE(ms.sales_total_pen, 0) - COALESCE(mc.route_opex_pen, 0))::NUMERIC(14,2) AS route_operating_cash_margin_pen,
    ROUND((COALESCE(ms.sales_total_pen, 0) - COALESCE(mc.route_opex_pen, 0)) * 100.0 / NULLIF(ms.sales_total_pen, 0), 2) AS route_operating_cash_margin_pct,
    COALESCE(mc.merchandise_outflow_pen, 0)::NUMERIC(14,2) AS merchandise_outflow_pen,
    COALESCE(mc.non_opex_capex_drain_pen, 0)::NUMERIC(14,2) AS non_opex_capex_drain_pen,
    COALESCE(mc.internal_deposits_pen, 0)::NUMERIC(14,2) AS internal_deposits_pen,
    ROUND(
        COALESCE(mc.non_opex_capex_drain_pen, 0) * 100.0
        / NULLIF(COALESCE(mc.merchandise_outflow_pen, 0) + COALESCE(mc.route_opex_pen, 0) + COALESCE(mc.non_opex_capex_drain_pen, 0), 0),
        2
    ) AS non_opex_drain_of_outflows_pct,
    ROUND(
        COALESCE(mc.merchandise_outflow_pen, 0) * 100.0
        / NULLIF(COALESCE(mc.merchandise_outflow_pen, 0) + COALESCE(mc.non_opex_capex_drain_pen, 0), 0),
        2
    ) AS reinvestment_share_pct,
    ROUND(
        COALESCE(mc.non_opex_capex_drain_pen, 0) * 100.0
        / NULLIF(COALESCE(mc.merchandise_outflow_pen, 0) + COALESCE(mc.non_opex_capex_drain_pen, 0), 0),
        2
    ) AS drain_vs_reinvestment_pct,
    COALESCE(mt.reconciled_trips_count, 0) AS reconciled_trips_count,
    COALESCE(mt.declared_net_cash_pen, 0)::NUMERIC(14,2) AS declared_net_cash_pen,
    COALESCE(mt.expected_net_cash_pen, 0)::NUMERIC(14,2) AS expected_net_cash_pen,
    (COALESCE(mt.declared_net_cash_pen, 0) - COALESCE(mt.expected_net_cash_pen, 0))::NUMERIC(14,2) AS cash_reconciliation_gap_pen,
    ROUND(
        ABS(COALESCE(mt.declared_net_cash_pen, 0) - COALESCE(mt.expected_net_cash_pen, 0)) * 100.0
        / NULLIF(GREATEST(ABS(COALESCE(mt.expected_net_cash_pen, 0)), ABS(COALESCE(ms.sales_total_pen, 0))), 0),
        2
    ) AS cash_reconciliation_gap_pct,
    (
        ROUND(
            COALESCE(mc.non_opex_capex_drain_pen, 0) * 100.0
            / NULLIF(COALESCE(mc.merchandise_outflow_pen, 0) + COALESCE(mc.non_opex_capex_drain_pen, 0), 0),
            2
        ) > 30.0
    ) AS drain_above_30pct_alert,
    (COALESCE(mc.route_opex_pen, 0) * 100.0 / NULLIF(ms.sales_total_pen, 0) > 8.0) AS route_opex_above_8pct_alert,
    COALESCE(pro.pre_route_foundational_outflow_pen, 0)::NUMERIC(14,2) AS pre_route_foundational_outflow_pen,
    (COALESCE(mc.admin_opex_bucket_pen, 0) + COALESCE(mc.legacy_admin_in_non_opex_pen, 0))::NUMERIC(14,2) AS admin_opex_pen,
    COALESCE(mc.admin_opex_bucket_pen, 0)::NUMERIC(14,2) AS admin_opex_bucket_pen,
    GREATEST(COALESCE(mc.non_opex_capex_drain_pen, 0) - COALESCE(mc.legacy_admin_in_non_opex_pen, 0), 0)::NUMERIC(14,2) AS owner_capex_debt_outflow_pen,
    COALESCE(mc.owner_salary_recorded_pen, 0)::NUMERIC(14,2) AS owner_salary_recorded_pen,
    COALESCE(ms.cash_collected_pen, 0)::NUMERIC(14,2) AS order_cohort_collected_pen
FROM all_months m
LEFT JOIN monthly_sales ms ON ms.period_month = m.period_month
LEFT JOIN monthly_collections mcol ON mcol.period_month = m.period_month
LEFT JOIN monthly_cash mc ON mc.period_month = m.period_month
LEFT JOIN monthly_trips mt ON mt.period_month = m.period_month
LEFT JOIN pre_route_outflows pro ON pro.period_month = m.period_month
ORDER BY m.period_month;

-- ============================================================================
-- 4. Monthly Accrual P&L vs. Effective Cash Flow Statement
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_report_monthly_pnl AS
WITH monthly_cogs AS (
    SELECT
        DATE_TRUNC('month', so.order_date)::DATE AS period_month,
        COALESCE(
            SUM(sol.line_total_pen)
            FILTER (WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL),
            0
        )::NUMERIC(14,2) AS cost_covered_sales_pen,
        COALESCE(
            SUM((sol.quantity * sol.pack_factor_applied) * COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen))
            FILTER (WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL),
            0
        )::NUMERIC(14,2) AS cogs_pen
    FROM erp.sales_order_lines sol
    JOIN erp.sales_orders so ON so.order_id = sol.order_id
    JOIN erp.products p ON p.product_id = sol.product_id
    WHERE so.order_date >= DATE '2026-06-26'
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY DATE_TRUNC('month', so.order_date)::DATE
),
joined AS (
    SELECT
        k.period_month,
        k.order_count,
        k.sales_total_pen,
        COALESCE(mc.cost_covered_sales_pen, 0)::NUMERIC(14,2) AS cost_covered_sales_pen,
        COALESCE(mc.cogs_pen, 0)::NUMERIC(14,2) AS cogs_pen,
        (COALESCE(mc.cost_covered_sales_pen, 0) - COALESCE(mc.cogs_pen, 0))::NUMERIC(14,2) AS gross_margin_pen,
        k.route_opex_pen,
        k.route_opex_pct,
        k.cash_collected_pen,
        k.ar_pending_pen,
        k.merchandise_outflow_pen,
        k.non_opex_capex_drain_pen,
        k.internal_deposits_pen,
        k.pre_route_foundational_outflow_pen,
        k.admin_opex_pen,
        k.admin_opex_bucket_pen,
        k.owner_capex_debt_outflow_pen,
        k.owner_salary_recorded_pen
    FROM analytics.v_kpi_cash_and_reinvestment k
    LEFT JOIN monthly_cogs mc ON mc.period_month = k.period_month
)
SELECT
    j.period_month,
    j.order_count,
    j.sales_total_pen,
    j.cost_covered_sales_pen,
    ROUND(j.cost_covered_sales_pen * 100.0 / NULLIF(j.sales_total_pen, 0), 2) AS cost_coverage_pct,
    j.cogs_pen,
    j.gross_margin_pen,
    ROUND(j.gross_margin_pen * 100.0 / NULLIF(j.cost_covered_sales_pen, 0), 2) AS gross_margin_pct,
    j.route_opex_pen,
    j.route_opex_pct,
    (j.gross_margin_pen - j.route_opex_pen)::NUMERIC(14,2) AS operating_ebitda_pen,
    ROUND((j.gross_margin_pen - j.route_opex_pen) * 100.0 / NULLIF(j.cost_covered_sales_pen, 0), 2) AS operating_ebitda_pct,
    j.cash_collected_pen,
    j.ar_pending_pen,
    j.merchandise_outflow_pen,
    j.non_opex_capex_drain_pen,
    j.internal_deposits_pen,
    j.pre_route_foundational_outflow_pen,
    (
        j.cash_collected_pen
        - j.merchandise_outflow_pen
        - j.route_opex_pen
        - j.admin_opex_bucket_pen
        - j.non_opex_capex_drain_pen
    )::NUMERIC(14,2) AS net_cash_flow_pen,
    j.admin_opex_pen,
    (j.route_opex_pen + j.admin_opex_pen)::NUMERIC(14,2) AS total_opex_pen,
    (j.gross_margin_pen - j.route_opex_pen - j.admin_opex_pen)::NUMERIC(14,2) AS operating_result_pen,
    ROUND(
        (j.gross_margin_pen - j.route_opex_pen - j.admin_opex_pen) * 100.0 / NULLIF(j.cost_covered_sales_pen, 0),
        2
    ) AS operating_result_pct,
    j.owner_salary_recorded_pen,
    j.owner_capex_debt_outflow_pen
FROM joined j
ORDER BY j.period_month ASC;

-- ============================================================================
-- 5. Debtors Aging & Report AR Aging Detail (Invoice Age vs Due-Date Overdue)
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_debtors_aging AS
WITH payment_stats AS (
    SELECT
        p.order_id,
        COUNT(*) AS payment_count,
        MAX(p.payment_date) AS last_payment_date
    FROM erp.ar_payments p
    WHERE p.voided_at IS NULL
    GROUP BY p.order_id
),
ar_eval AS (
    SELECT
        so.order_id,
        so.order_code,
        so.order_date,
        so.due_date,
        so.customer_party_id,
        COALESCE(pa.trade_name, pa.legal_name, so.customer_name_raw, 'CLIENTE SIN NOMBRE') AS customer_name,
        so.payment_mode::text AS payment_mode,
        so.operational_status::text AS operational_status,
        ROUND(so.total_pen, 2) AS total_pen,
        ROUND(so.paid_pen, 2) AS paid_pen,
        ROUND(so.balance_due_pen, 2) AS balance_due_pen,
        GREATEST(0, ((NOW() AT TIME ZONE 'America/Lima')::date - so.order_date))::int AS invoice_age_days,
        CASE
            WHEN so.due_date IS NOT NULL
                THEN GREATEST(0, ((NOW() AT TIME ZONE 'America/Lima')::date - so.due_date))::int
            ELSE NULL
        END AS days_past_due,
        CASE
            WHEN so.due_date IS NOT NULL
                THEN GREATEST(0, ((NOW() AT TIME ZONE 'America/Lima')::date - so.due_date))::int
            WHEN so.promised_payment_date IS NOT NULL
                THEN GREATEST(0, ((NOW() AT TIME ZONE 'America/Lima')::date - so.promised_payment_date))::int
            ELSE GREATEST(0, ((NOW() AT TIME ZONE 'America/Lima')::date - so.order_date))::int
        END AS effective_days_overdue,
        CASE
            WHEN so.due_date IS NULL THEN 'NO_DUE_DATE'
            WHEN so.due_date < (NOW() AT TIME ZONE 'America/Lima')::date THEN 'OVERDUE'
            WHEN so.due_date <= ((NOW() AT TIME ZONE 'America/Lima')::date + 7) THEN 'DUE_SOON'
            ELSE 'CURRENT'
        END AS due_status,
        so.promised_payment_date,
        CASE
            WHEN so.promised_payment_date IS NULL THEN 'NO_PROMISE_DATE'
            WHEN so.promised_payment_date < (NOW() AT TIME ZONE 'America/Lima')::date THEN 'PROMISE_BROKEN'
            WHEN so.promised_payment_date <= ((NOW() AT TIME ZONE 'America/Lima')::date + 1) THEN 'DUE_TODAY_OR_TOMORROW'
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
)
SELECT
    ae.order_id,
    ae.order_code,
    ae.order_date,
    ae.customer_party_id,
    ae.customer_name,
    ae.payment_mode,
    ae.operational_status,
    ae.total_pen,
    ae.paid_pen,
    ae.balance_due_pen,
    ae.effective_days_overdue AS days_overdue,
    CASE
        WHEN ae.effective_days_overdue >= 30 THEN 'RED_30_PLUS'
        WHEN ae.effective_days_overdue >= 8 THEN 'AMBER_8_29'
        ELSE 'GREEN_0_7'
    END AS aging_bucket,
    ae.promised_payment_date,
    ae.promise_status,
    ae.payment_count,
    ae.last_payment_date,
    ae.created_by_name,
    ae.due_date,
    ae.invoice_age_days,
    ae.days_past_due,
    ae.due_status
FROM ar_eval ae
ORDER BY ae.promised_payment_date ASC NULLS LAST, ae.order_date ASC, ae.order_id ASC;

CREATE OR REPLACE VIEW analytics.v_report_ar_aging_detail AS
WITH payment_stats AS (
    SELECT
        p.order_id,
        COUNT(*) AS payment_count,
        MAX(p.payment_date) AS last_payment_date
    FROM erp.ar_payments p
    WHERE p.voided_at IS NULL
    GROUP BY p.order_id
),
ar_base AS (
    SELECT
        so.order_id,
        so.order_code,
        so.order_date,
        so.due_date,
        so.customer_party_id,
        COALESCE(NULLIF(BTRIM(pa.trade_name), ''), pa.legal_name, so.customer_name_raw, 'CLIENTE SIN NOMBRE') AS customer_name,
        pa.legal_name AS customer_legal_name,
        pa.phone AS customer_phone,
        NULLIF(BTRIM(pa.city_zone), '') AS city_zone,
        COALESCE(NULLIF(BTRIM(pa.city_zone), ''), NULLIF(BTRIM(rt.zone_name), ''), 'Sin zona') AS effective_zone,
        so.payment_mode::text AS payment_mode,
        so.operational_status::text AS operational_status,
        ROUND(so.total_pen, 2) AS total_pen,
        ROUND(so.paid_pen, 2) AS paid_pen,
        ROUND(so.balance_due_pen, 2) AS balance_due_pen,
        GREATEST(0, ((NOW() AT TIME ZONE 'America/Lima')::date - so.order_date))::int AS invoice_age_days,
        CASE
            WHEN so.due_date IS NOT NULL
                THEN GREATEST(0, ((NOW() AT TIME ZONE 'America/Lima')::date - so.due_date))::int
            ELSE NULL
        END AS days_past_due,
        CASE
            WHEN so.due_date IS NOT NULL
                THEN GREATEST(0, ((NOW() AT TIME ZONE 'America/Lima')::date - so.due_date))::int
            WHEN so.promised_payment_date IS NOT NULL
                THEN GREATEST(0, ((NOW() AT TIME ZONE 'America/Lima')::date - so.promised_payment_date))::int
            ELSE GREATEST(0, ((NOW() AT TIME ZONE 'America/Lima')::date - so.order_date))::int
        END AS days_overdue,
        CASE
            WHEN so.due_date IS NULL THEN 'NO_DUE_DATE'
            WHEN so.due_date < (NOW() AT TIME ZONE 'America/Lima')::date THEN 'OVERDUE'
            WHEN so.due_date <= ((NOW() AT TIME ZONE 'America/Lima')::date + 7) THEN 'DUE_SOON'
            ELSE 'CURRENT'
        END AS due_status,
        so.promised_payment_date,
        CASE
            WHEN so.promised_payment_date IS NULL THEN 'NO_PROMISE_DATE'
            WHEN so.promised_payment_date < (NOW() AT TIME ZONE 'America/Lima')::date THEN 'PROMISE_BROKEN'
            WHEN so.promised_payment_date <= ((NOW() AT TIME ZONE 'America/Lima')::date + 1) THEN 'DUE_TODAY_OR_TOMORROW'
            ELSE 'ON_SCHEDULE'
        END AS promise_status,
        COALESCE(ps.payment_count, 0)::int AS payment_count,
        ps.last_payment_date,
        so.created_by_user_id,
        u.full_name AS created_by_name
    FROM erp.sales_orders so
    LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
    LEFT JOIN erp.route_trips rt ON rt.trip_id = so.trip_id
    LEFT JOIN payment_stats ps ON ps.order_id = so.order_id
    LEFT JOIN erp.app_users u ON u.user_id = so.created_by_user_id
    WHERE so.is_settled = FALSE
      AND so.balance_due_pen > 0.05
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
)
SELECT
    ab.order_id,
    ab.order_code,
    ab.order_date,
    ab.due_date,
    ab.customer_party_id,
    ab.customer_name,
    ab.customer_legal_name,
    ab.customer_phone,
    ab.city_zone,
    ab.effective_zone,
    ab.payment_mode,
    ab.operational_status,
    ab.total_pen,
    ab.paid_pen,
    ab.balance_due_pen,
    ab.days_overdue,
    CASE
        WHEN ab.days_overdue <= 15 THEN '0_15'
        WHEN ab.days_overdue <= 30 THEN '16_30'
        WHEN ab.days_overdue <= 60 THEN '31_60'
        ELSE 'GT_60'
    END AS ar_bucket,
    ab.promised_payment_date,
    ab.promise_status,
    ab.payment_count,
    ab.last_payment_date,
    ab.created_by_user_id,
    ab.created_by_name,
    ab.invoice_age_days,
    ab.days_past_due,
    ab.due_status
FROM ar_base ab
ORDER BY ab.effective_zone ASC, ab.days_overdue DESC, ab.order_id ASC;

-- ============================================================================
-- 6. Canonical 24h Registration Coverage & Weekly Cohort View
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_kpi_registration_coverage_24h AS
WITH scored AS (
    SELECT
        so.order_id,
        so.order_code,
        so.order_date,
        DATE_TRUNC('week', so.order_date)::DATE AS order_week,
        (so.customer_party_id IS NOT NULL) AS has_customer,
        (
            EXISTS (SELECT 1 FROM erp.sales_order_lines sol WHERE sol.order_id = so.order_id)
            AND NOT EXISTS (
                SELECT 1
                FROM erp.sales_order_lines sol
                JOIN erp.products p ON p.product_id = sol.product_id
                WHERE sol.order_id = so.order_id
                  AND COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NULL
            )
        ) AS has_lines_and_costs,
        (so.created_by_user_id IS NOT NULL) AS has_seller,
        (so.historical_status_assumed = FALSE) AS has_explicit_mode,
        (
            so.paid_pen <= 0.05
            OR EXISTS (
                SELECT 1
                FROM erp.ar_payments ap
                WHERE ap.order_id = so.order_id
                  AND ap.voided_at IS NULL
                  AND ap.account_id IS NOT NULL
            )
        ) AS has_payment_account,
        (
            so.balance_due_pen <= 0.05
            OR so.promised_payment_date IS NOT NULL
            OR so.due_date IS NOT NULL
        ) AS has_credit_due,
        (((so.created_at AT TIME ZONE 'America/Lima')::date - so.order_date) <= 1) AS within_24h,
        EXISTS (
            SELECT 1
            FROM erp.sales_order_audit_log l
            WHERE l.order_id = so.order_id
              AND l.action IN ('EDIT', 'CANCEL')
        ) AS has_correction
    FROM erp.sales_orders so
    WHERE so.source_origin = 'ERP_APP'
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
)
SELECT
    s.order_id,
    s.order_code,
    s.order_date,
    s.order_week,
    s.has_customer,
    s.has_lines_and_costs,
    s.has_seller,
    s.has_explicit_mode,
    s.has_payment_account,
    s.has_credit_due,
    s.within_24h,
    (
        s.has_customer
        AND s.has_lines_and_costs
        AND s.has_seller
        AND s.has_explicit_mode
        AND s.has_payment_account
        AND s.has_credit_due
        AND s.within_24h
    ) AS is_complete_24h,
    s.has_correction
FROM scored s;
