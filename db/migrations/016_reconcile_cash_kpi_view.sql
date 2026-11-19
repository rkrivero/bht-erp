-- 016_reconcile_cash_kpi_view.sql
-- Reassert the canonical net-cash calculation after detecting schema drift:
-- expected route cash equals collected sales less non-internal ROUTE_OPEX.

-- Q1: Cash Operating Margin, Reinvestment vs Non-OpEx Drain & Reconciliation Gap
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
monthly_cash AS (
    SELECT
        DATE_TRUNC('month', tx_date)::DATE AS period_month,
        COALESCE(SUM(amount_pen) FILTER (WHERE direction = 'IN' AND NOT is_internal_transfer), 0)::NUMERIC(14,2) AS ledger_inflow_pen,
        COALESCE(SUM(amount_pen) FILTER (WHERE direction = 'OUT' AND NOT is_internal_transfer AND expense_bucket = 'MERCHANDISE_PAYMENT'), 0)::NUMERIC(14,2) AS merchandise_outflow_pen,
        COALESCE(SUM(amount_pen) FILTER (WHERE direction = 'OUT' AND NOT is_internal_transfer AND expense_bucket = 'ROUTE_OPEX'), 0)::NUMERIC(14,2) AS route_opex_pen,
        COALESCE(SUM(amount_pen) FILTER (WHERE direction = 'OUT' AND NOT is_internal_transfer AND expense_bucket = 'NON_OPEX_OR_CAPEX'), 0)::NUMERIC(14,2) AS non_opex_capex_drain_pen,
        COALESCE(SUM(amount_pen) FILTER (WHERE is_internal_transfer AND direction = 'OUT'), 0)::NUMERIC(14,2) AS internal_deposits_pen
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
    COALESCE(ms.cash_collected_pen, 0)::NUMERIC(14,2) AS cash_collected_pen,
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
    COALESCE(pro.pre_route_foundational_outflow_pen, 0)::NUMERIC(14,2) AS pre_route_foundational_outflow_pen
FROM all_months m
LEFT JOIN monthly_sales ms ON ms.period_month = m.period_month
LEFT JOIN monthly_cash mc ON mc.period_month = m.period_month
LEFT JOIN monthly_trips mt ON mt.period_month = m.period_month
LEFT JOIN pre_route_outflows pro ON pro.period_month = m.period_month
ORDER BY m.period_month;

