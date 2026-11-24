-- Migration 030: Harden analytics views (system_settings, reversal exclusion,
-- CONCILIACION_SALDO exclusion, overdue > 30d + dust threshold) and drop default
-- 0.00 on nullable daily_closures count/variance columns.

-- 1. Drop legacy DEFAULT 0 on nullable daily_closures count/variance columns
ALTER TABLE erp.daily_closures
    ALTER COLUMN counted_cash_total_pen DROP DEFAULT,
    ALTER COLUMN variance_total_pen DROP DEFAULT;

-- 2. Q1: Cash & Reinvestment KPIs
CREATE OR REPLACE VIEW analytics.v_kpi_cash_and_reinvestment AS
WITH params AS (
    SELECT
        erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26') AS cutoff_date,
        erp.fn_get_setting_numeric('drain_alert_pct', 30.0) AS drain_alert_pct,
        erp.fn_get_setting_numeric('route_opex_alert_pct', 8.0) AS route_opex_alert_pct
),
monthly_sales AS (
    SELECT
        DATE_TRUNC('month', so.order_date)::DATE AS period_month,
        COUNT(*) AS order_count,
        COALESCE(SUM(so.total_pen), 0)::NUMERIC(14,2) AS sales_total_pen,
        COALESCE(SUM(so.paid_pen), 0)::NUMERIC(14,2) AS cash_collected_pen,
        COALESCE(SUM(so.balance_due_pen), 0)::NUMERIC(14,2) AS ar_pending_pen
    FROM erp.sales_orders so
    CROSS JOIN params p
    WHERE so.order_date >= p.cutoff_date
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY DATE_TRUNC('month', so.order_date)::DATE
),
monthly_collections AS (
    SELECT
        DATE_TRUNC('month', ap.payment_date)::DATE AS period_month,
        COALESCE(SUM(ap.amount_pen), 0)::NUMERIC(14,2) AS effective_cash_collected_pen
    FROM erp.ar_payments ap
    JOIN erp.sales_orders so ON so.order_id = ap.order_id
    CROSS JOIN params p
    WHERE ap.voided_at IS NULL
      AND ap.payment_date >= p.cutoff_date
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY DATE_TRUNC('month', ap.payment_date)::DATE
),
monthly_cash AS (
    SELECT
        DATE_TRUNC('month', cl.tx_date)::DATE AS period_month,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'IN' AND NOT cl.is_internal_transfer), 0)::NUMERIC(14,2) AS ledger_inflow_pen,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'MERCHANDISE_PAYMENT'), 0)::NUMERIC(14,2) AS merchandise_outflow_pen,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'ROUTE_OPEX'), 0)::NUMERIC(14,2) AS route_opex_pen,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'ADMIN_OPEX'), 0)::NUMERIC(14,2) AS admin_opex_bucket_pen,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'NON_OPEX_OR_CAPEX'), 0)::NUMERIC(14,2) AS non_opex_capex_drain_pen,
        COALESCE(SUM(cl.amount_pen) FILTER (
            WHERE cl.direction = 'OUT'
              AND NOT cl.is_internal_transfer
              AND cl.expense_bucket = 'NON_OPEX_OR_CAPEX'
              AND cl.expense_category IN (
                  'PAYROLL_ADVANCE', 'ACCOUNTING_OR_LEGAL', 'ACCOUNTING_SERVICE',
                  'LEGAL_NOTARIA', 'FINANCIAL_FEE', 'SUELDO_SOCIO',
                  'PLANILLA_PERSONAL', 'ALQUILER', 'SERVICIOS_BASICOS',
                  'IMPUESTOS_OPERATIVOS', 'SOFTWARE_OFICINA', 'OTROS_ADMIN'
              )
        ), 0)::NUMERIC(14,2) AS legacy_admin_in_non_opex_pen,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_category = 'SUELDO_SOCIO'), 0)::NUMERIC(14,2) AS owner_salary_recorded_pen,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.is_internal_transfer AND cl.direction = 'OUT'), 0)::NUMERIC(14,2) AS internal_deposits_pen
    FROM erp.cash_ledger cl
    CROSS JOIN params p
    WHERE cl.tx_date >= p.cutoff_date
      AND NOT cl.is_reversal
      AND cl.expense_category <> 'CONCILIACION_SALDO'
      AND NOT EXISTS (
          SELECT 1 FROM erp.cash_ledger rev
          WHERE rev.reversal_of_ledger_id = cl.ledger_id
      )
    GROUP BY DATE_TRUNC('month', cl.tx_date)::DATE
),
trip_paid AS (
    SELECT
        so.trip_id,
        COALESCE(SUM(so.paid_pen), 0)::NUMERIC(14,2) AS paid_pen
    FROM erp.sales_orders so
    WHERE so.trip_id IS NOT NULL
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY so.trip_id
),
trip_route_opex AS (
    SELECT
        cl.trip_id,
        COALESCE(SUM(cl.amount_pen), 0)::NUMERIC(14,2) AS route_opex_pen
    FROM erp.cash_ledger cl
    WHERE cl.trip_id IS NOT NULL
      AND cl.direction = 'OUT'
      AND NOT cl.is_internal_transfer
      AND NOT cl.is_reversal
      AND cl.expense_category <> 'CONCILIACION_SALDO'
      AND cl.expense_bucket = 'ROUTE_OPEX'
      AND NOT EXISTS (
          SELECT 1 FROM erp.cash_ledger rev
          WHERE rev.reversal_of_ledger_id = cl.ledger_id
      )
    GROUP BY cl.trip_id
),
monthly_trips AS (
    SELECT
        DATE_TRUNC('month', rt.trip_date)::DATE AS period_month,
        COUNT(*) FILTER (WHERE rt.declared_net_cash_pen IS NOT NULL) AS reconciled_trips_count,
        COALESCE(SUM(rt.declared_net_cash_pen) FILTER (WHERE rt.declared_net_cash_pen IS NOT NULL), 0)::NUMERIC(14,2) AS declared_net_cash_pen,
        COALESCE(
            SUM(COALESCE(tp.paid_pen, 0) - COALESCE(tro.route_opex_pen, 0))
            FILTER (WHERE rt.declared_net_cash_pen IS NOT NULL),
            0
        )::NUMERIC(14,2) AS expected_net_cash_pen
    FROM erp.route_trips rt
    CROSS JOIN params p
    LEFT JOIN trip_paid tp ON tp.trip_id = rt.trip_id
    LEFT JOIN trip_route_opex tro ON tro.trip_id = rt.trip_id
    WHERE rt.trip_date >= p.cutoff_date
    GROUP BY DATE_TRUNC('month', rt.trip_date)::DATE
),
pre_route_outflows AS (
    SELECT
        DATE_TRUNC('month', cl.tx_date)::DATE AS period_month,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer), 0)::NUMERIC(14,2) AS pre_route_foundational_outflow_pen
    FROM erp.cash_ledger cl
    CROSS JOIN params p
    WHERE cl.tx_date < p.cutoff_date
      AND NOT cl.is_reversal
      AND cl.expense_category <> 'CONCILIACION_SALDO'
      AND NOT EXISTS (
          SELECT 1 FROM erp.cash_ledger rev
          WHERE rev.reversal_of_ledger_id = cl.ledger_id
      )
    GROUP BY DATE_TRUNC('month', cl.tx_date)::DATE
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
        ) > p.drain_alert_pct
    ) AS drain_above_30pct_alert,
    (COALESCE(mc.route_opex_pen, 0) * 100.0 / NULLIF(ms.sales_total_pen, 0) > p.route_opex_alert_pct) AS route_opex_above_8pct_alert,
    COALESCE(pro.pre_route_foundational_outflow_pen, 0)::NUMERIC(14,2) AS pre_route_foundational_outflow_pen,
    (COALESCE(mc.admin_opex_bucket_pen, 0) + COALESCE(mc.legacy_admin_in_non_opex_pen, 0))::NUMERIC(14,2) AS admin_opex_pen,
    COALESCE(mc.admin_opex_bucket_pen, 0)::NUMERIC(14,2) AS admin_opex_bucket_pen,
    GREATEST(COALESCE(mc.non_opex_capex_drain_pen, 0) - COALESCE(mc.legacy_admin_in_non_opex_pen, 0), 0)::NUMERIC(14,2) AS owner_capex_debt_outflow_pen,
    COALESCE(mc.owner_salary_recorded_pen, 0)::NUMERIC(14,2) AS owner_salary_recorded_pen,
    COALESCE(ms.cash_collected_pen, 0)::NUMERIC(14,2) AS order_cohort_collected_pen
FROM all_months m
CROSS JOIN params p
LEFT JOIN monthly_sales ms ON ms.period_month = m.period_month
LEFT JOIN monthly_collections mcol ON mcol.period_month = m.period_month
LEFT JOIN monthly_cash mc ON mc.period_month = m.period_month
LEFT JOIN monthly_trips mt ON mt.period_month = m.period_month
LEFT JOIN pre_route_outflows pro ON pro.period_month = m.period_month
ORDER BY m.period_month;

-- 3. Monthly Accrual P&L vs Effective Cash Flow Statement
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
    WHERE so.order_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26')
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

-- 4. Route Profitability View
CREATE OR REPLACE VIEW analytics.v_report_route_profitability AS
WITH trip_orders AS (
    SELECT
        so.trip_id,
        COUNT(*)::int AS order_count,
        COALESCE(SUM(so.total_pen), 0)::NUMERIC(14,2) AS sales_total_pen,
        COALESCE(SUM(so.paid_pen), 0)::NUMERIC(14,2) AS cash_collected_pen,
        COALESCE(SUM(so.balance_due_pen), 0)::NUMERIC(14,2) AS ar_pending_pen
    FROM erp.sales_orders so
    WHERE so.trip_id IS NOT NULL
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY so.trip_id
),
trip_cogs AS (
    SELECT
        so.trip_id,
        COALESCE(
            SUM(sol.line_total_pen)
            FILTER (WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL),
            0
        )::NUMERIC(14,2) AS cost_covered_sales_pen,
        COALESCE(
            SUM((sol.quantity * sol.pack_factor_applied) * COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen))
            FILTER (WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL),
            0
        )::NUMERIC(14,2) AS known_cogs_pen
    FROM erp.sales_order_lines sol
    JOIN erp.sales_orders so ON so.order_id = sol.order_id
    JOIN erp.products p ON p.product_id = sol.product_id
    WHERE so.trip_id IS NOT NULL
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY so.trip_id
),
trip_opex AS (
    SELECT
        cl.trip_id,
        COALESCE(SUM(cl.amount_pen), 0)::NUMERIC(14,2) AS route_opex_pen
    FROM erp.cash_ledger cl
    WHERE cl.trip_id IS NOT NULL
      AND cl.direction = 'OUT'
      AND NOT cl.is_internal_transfer
      AND NOT cl.is_reversal
      AND cl.expense_category <> 'CONCILIACION_SALDO'
      AND cl.expense_bucket = 'ROUTE_OPEX'
      AND NOT EXISTS (
          SELECT 1 FROM erp.cash_ledger rev
          WHERE rev.reversal_of_ledger_id = cl.ledger_id
      )
    GROUP BY cl.trip_id
),
trip_base AS (
    SELECT
        rt.trip_id,
        rt.trip_code,
        rt.trip_date,
        rt.end_date,
        COALESCE(NULLIF(BTRIM(rt.zone_name), ''), 'Sin zona') AS zone_name,
        rt.driver_name,
        rt.status::text AS status,
        COALESCE(tord.order_count, 0) AS order_count,
        COALESCE(tord.sales_total_pen, 0)::NUMERIC(14,2) AS sales_total_pen,
        COALESCE(tord.cash_collected_pen, 0)::NUMERIC(14,2) AS cash_collected_pen,
        COALESCE(tord.ar_pending_pen, 0)::NUMERIC(14,2) AS ar_pending_pen,
        COALESCE(tc.cost_covered_sales_pen, 0)::NUMERIC(14,2) AS cost_covered_sales_pen,
        COALESCE(tc.known_cogs_pen, 0)::NUMERIC(14,2) AS known_cogs_pen,
        (COALESCE(tc.cost_covered_sales_pen, 0) - COALESCE(tc.known_cogs_pen, 0))::NUMERIC(14,2) AS gross_margin_pen,
        COALESCE(topx.route_opex_pen, 0)::NUMERIC(14,2) AS route_opex_pen
    FROM erp.route_trips rt
    LEFT JOIN trip_orders tord ON tord.trip_id = rt.trip_id
    LEFT JOIN trip_cogs tc ON tc.trip_id = rt.trip_id
    LEFT JOIN trip_opex topx ON topx.trip_id = rt.trip_id
)
SELECT
    tb.trip_id,
    tb.trip_code,
    tb.trip_date,
    tb.end_date,
    tb.zone_name,
    tb.driver_name,
    tb.status,
    tb.order_count,
    tb.sales_total_pen,
    tb.cash_collected_pen,
    tb.ar_pending_pen,
    tb.cost_covered_sales_pen,
    tb.known_cogs_pen,
    tb.gross_margin_pen,
    ROUND(tb.gross_margin_pen * 100.0 / NULLIF(tb.cost_covered_sales_pen, 0), 2) AS gross_margin_pct,
    tb.route_opex_pen,
    ROUND(tb.route_opex_pen * 100.0 / NULLIF(tb.sales_total_pen, 0), 2) AS route_opex_pct,
    (tb.gross_margin_pen - tb.route_opex_pen)::NUMERIC(14,2) AS trip_net_contribution_pen,
    ROUND((tb.gross_margin_pen - tb.route_opex_pen) * 100.0 / NULLIF(tb.sales_total_pen, 0), 2) AS trip_net_contribution_pct,
    (tb.route_opex_pen * 100.0 / NULLIF(tb.sales_total_pen, 0) > erp.fn_get_setting_numeric('route_opex_alert_pct', 8.0)) AS route_opex_above_8pct_alert
FROM trip_base tb
ORDER BY tb.trip_date DESC, tb.trip_id DESC;

-- 5. Q2: SKU Margin & Route OPEX
CREATE OR REPLACE VIEW analytics.v_kpi_sku_margin_and_opex AS
WITH params AS (
    SELECT
        erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26') AS cutoff_date,
        erp.fn_get_setting_numeric('min_margin_pct', 20.0) AS min_margin_pct
),
global_totals AS (
    SELECT
        COALESCE((
            SELECT SUM(so.total_pen)
            FROM erp.sales_orders so
            CROSS JOIN params p
            WHERE so.order_date >= p.cutoff_date
              AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
        ), 0)::NUMERIC(14,2) AS total_sales_pen,
        COALESCE((
            SELECT SUM(cl.amount_pen)
            FROM erp.cash_ledger cl
            CROSS JOIN params p
            WHERE cl.tx_date >= p.cutoff_date
              AND cl.direction = 'OUT'
              AND NOT cl.is_internal_transfer
              AND NOT cl.is_reversal
              AND cl.expense_category <> 'CONCILIACION_SALDO'
              AND cl.expense_bucket = 'ROUTE_OPEX'
              AND NOT EXISTS (
                  SELECT 1 FROM erp.cash_ledger rev
                  WHERE rev.reversal_of_ledger_id = cl.ledger_id
              )
        ), 0)::NUMERIC(14,2) AS total_route_opex_pen
),
sku_sales AS (
    SELECT
        p.product_id,
        p.sku,
        p.name AS product_name,
        p.category,
        p.fulfillment_mode,
        p.ref_cost_pen,
        p.cost_source,
        COUNT(sol.order_line_id) AS sales_line_count,
        COALESCE(SUM(sol.quantity * sol.pack_factor_applied), 0)::NUMERIC(14,4) AS total_units_sold,
        COALESCE(SUM(sol.line_total_pen), 0)::NUMERIC(14,2) AS total_revenue_pen,
        COALESCE(
            SUM(sol.line_total_pen) FILTER (WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL),
            0
        )::NUMERIC(14,2) AS cost_covered_revenue_pen,
        COALESCE(
            SUM((sol.quantity * sol.pack_factor_applied) * COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen))
            FILTER (WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL),
            0
        )::NUMERIC(14,2) AS known_cogs_pen
    FROM erp.products p
    JOIN erp.sales_order_lines sol ON sol.product_id = p.product_id
    JOIN erp.sales_orders so ON so.order_id = sol.order_id
    CROSS JOIN params prm
    WHERE so.order_date >= prm.cutoff_date
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY p.product_id, p.sku, p.name, p.category, p.fulfillment_mode, p.ref_cost_pen, p.cost_source
)
SELECT
    s.product_id,
    s.sku,
    s.product_name,
    s.category,
    s.fulfillment_mode,
    s.sales_line_count,
    s.total_units_sold,
    s.total_revenue_pen,
    ROUND(s.total_revenue_pen / NULLIF(s.total_units_sold, 0), 4) AS avg_unit_sale_price_pen,
    s.ref_cost_pen,
    s.cost_source,
    s.cost_covered_revenue_pen,
    ROUND(s.cost_covered_revenue_pen * 100.0 / NULLIF(s.total_revenue_pen, 0), 2) AS cost_coverage_pct,
    s.known_cogs_pen,
    CASE
        WHEN s.cost_covered_revenue_pen > 0 THEN (s.cost_covered_revenue_pen - s.known_cogs_pen)::NUMERIC(14,2)
        ELSE NULL
    END AS real_gross_margin_pen,
    CASE
        WHEN s.cost_covered_revenue_pen > 0 THEN ROUND((s.cost_covered_revenue_pen - s.known_cogs_pen) * 100.0 / s.cost_covered_revenue_pen, 2)
        ELSE NULL
    END AS real_gross_margin_pct,
    ROUND(gt.total_route_opex_pen * 100.0 / NULLIF(gt.total_sales_pen, 0), 2) AS portfolio_route_opex_pct,
    (
        s.cost_covered_revenue_pen > 0
        AND ROUND((s.cost_covered_revenue_pen - s.known_cogs_pen) * 100.0 / s.cost_covered_revenue_pen, 2) < prm.min_margin_pct
    ) AS low_margin_below_20pct_alert,
    (s.cost_covered_revenue_pen < s.total_revenue_pen) AS missing_cost_alert
FROM sku_sales s
CROSS JOIN global_totals gt
CROSS JOIN params prm
ORDER BY s.total_revenue_pen DESC;

-- 6. Q3: AR Collections, Overdue > 30d & Quote-to-Sale Conversion
CREATE OR REPLACE VIEW analytics.v_kpi_ar_customers_and_quotes AS
WITH params AS (
    SELECT erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26') AS cutoff_date
),
monthly_orders AS (
    SELECT
        DATE_TRUNC('month', so.order_date)::DATE AS period_month,
        COUNT(*) AS orders_total,
        COALESCE(SUM(so.total_pen), 0)::NUMERIC(14,2) AS total_sales_pen,
        COALESCE(SUM(so.total_pen) FILTER (WHERE so.payment_mode = 'CREDIT'), 0)::NUMERIC(14,2) AS credit_sales_pen,
        COALESCE(SUM(so.balance_due_pen), 0)::NUMERIC(14,2) AS pending_ar_pen,
        COUNT(*) FILTER (
            WHERE NOT so.is_settled
              AND so.balance_due_pen > 0.05
              AND ((NOW() AT TIME ZONE 'America/Lima')::date - COALESCE(so.due_date, so.order_date)) > 30
        ) AS overdue_gt_30d_count,
        COALESCE(SUM(so.balance_due_pen) FILTER (
            WHERE NOT so.is_settled
              AND so.balance_due_pen > 0.05
              AND ((NOW() AT TIME ZONE 'America/Lima')::date - COALESCE(so.due_date, so.order_date)) > 30
        ), 0)::NUMERIC(14,2) AS overdue_gt_30d_pen,
        COUNT(*) FILTER (WHERE so.historical_status_assumed) AS assumed_status_orders_count,
        COUNT(*) FILTER (WHERE NOT so.historical_status_assumed) AS explicit_status_orders_count,
        COUNT(*) FILTER (WHERE so.customer_party_id IS NOT NULL) AS matched_customer_orders_count
    FROM erp.sales_orders so
    CROSS JOIN params p
    WHERE so.order_date >= p.cutoff_date
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY DATE_TRUNC('month', so.order_date)::DATE
),
monthly_quotes AS (
    SELECT
        DATE_TRUNC('month', q.issue_date)::DATE AS period_month,
        COUNT(*) AS quotes_total,
        COUNT(*) FILTER (WHERE q.status = 'CONVERTED' OR q.related_cpe IS NOT NULL) AS quotes_converted_count,
        COALESCE(SUM(q.total_pen), 0)::NUMERIC(14,2) AS quotes_total_pen
    FROM erp.quotes q
    CROSS JOIN params p
    WHERE q.issue_date >= p.cutoff_date
    GROUP BY DATE_TRUNC('month', q.issue_date)::DATE
),
all_months AS (
    SELECT period_month FROM monthly_orders
    UNION
    SELECT period_month FROM monthly_quotes
)
SELECT
    m.period_month,
    COALESCE(mo.orders_total, 0) AS orders_total,
    COALESCE(mo.total_sales_pen, 0)::NUMERIC(14,2) AS total_sales_pen,
    COALESCE(mo.credit_sales_pen, 0)::NUMERIC(14,2) AS credit_sales_pen,
    COALESCE(mo.pending_ar_pen, 0)::NUMERIC(14,2) AS pending_ar_pen,
    ROUND(COALESCE(mo.pending_ar_pen, 0) * 100.0 / NULLIF(mo.credit_sales_pen, 0), 2) AS ar_pending_of_credit_pct,
    ROUND(COALESCE(mo.pending_ar_pen, 0) * 100.0 / NULLIF(mo.total_sales_pen, 0), 2) AS ar_pending_of_total_sales_pct,
    COALESCE(mo.overdue_gt_30d_count, 0) AS overdue_gt_30d_count,
    COALESCE(mo.overdue_gt_30d_pen, 0)::NUMERIC(14,2) AS overdue_gt_30d_pen,
    COALESCE(mq.quotes_total, 0) AS quotes_total,
    COALESCE(mq.quotes_converted_count, 0) AS quotes_converted_count,
    ROUND(COALESCE(mq.quotes_converted_count, 0) * 100.0 / NULLIF(mq.quotes_total, 0), 2) AS quote_conversion_rate_pct,
    COALESCE(mq.quotes_total_pen, 0)::NUMERIC(14,2) AS quotes_total_pen,
    COALESCE(mo.explicit_status_orders_count, 0) AS explicit_status_orders_count,
    COALESCE(mo.assumed_status_orders_count, 0) AS assumed_status_orders_count,
    ROUND(COALESCE(mo.explicit_status_orders_count, 0) * 100.0 / NULLIF(mo.orders_total, 0), 2) AS explicit_payment_status_pct,
    ROUND(COALESCE(mo.matched_customer_orders_count, 0) * 100.0 / NULLIF(mo.orders_total, 0), 2) AS matched_customer_pct,
    (ROUND(COALESCE(mo.pending_ar_pen, 0) * 100.0 / NULLIF(mo.credit_sales_pen, 0), 2) > 15.0) AS ar_above_15pct_alert,
    (COALESCE(mo.overdue_gt_30d_count, 0) > 0) AS overdue_gt_30d_alert
FROM all_months m
LEFT JOIN monthly_orders mo ON mo.period_month = m.period_month
LEFT JOIN monthly_quotes mq ON mq.period_month = m.period_month
ORDER BY m.period_month;
