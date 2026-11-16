-- 005_analytics_kpi_views.sql
-- Executive KPI views answering Q1-Q3, operational ON_DEMAND purchase backlog, and data quality audit gaps.

-- ============================================================================
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

-- ============================================================================
-- Q2: Real Gross Margin per SKU, Cost Coverage & Route OpEx Benchmark
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_kpi_sku_margin_and_opex AS
WITH global_totals AS (
    SELECT
        COALESCE((
            SELECT SUM(total_pen)
            FROM erp.sales_orders
            WHERE order_date >= DATE '2026-06-26'
              AND operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
        ), 0)::NUMERIC(14,2) AS total_sales_pen,
        COALESCE((
            SELECT SUM(amount_pen)
            FROM erp.cash_ledger
            WHERE tx_date >= DATE '2026-06-26'
              AND direction = 'OUT'
              AND NOT is_internal_transfer
              AND expense_bucket = 'ROUTE_OPEX'
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
    WHERE so.order_date >= DATE '2026-06-26'
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
        AND ROUND((s.cost_covered_revenue_pen - s.known_cogs_pen) * 100.0 / s.cost_covered_revenue_pen, 2) < 20.0
    ) AS low_margin_below_20pct_alert,
    (s.cost_covered_revenue_pen < s.total_revenue_pen) AS missing_cost_alert
FROM sku_sales s
CROSS JOIN global_totals gt
ORDER BY s.total_revenue_pen DESC;

-- ============================================================================
-- Q3: AR Collections, Overdue > 30d, Quote-to-Sale Conversion & Data Quality
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_kpi_ar_customers_and_quotes AS
WITH monthly_orders AS (
    SELECT
        DATE_TRUNC('month', order_date)::DATE AS period_month,
        COUNT(*) AS orders_total,
        COALESCE(SUM(total_pen), 0)::NUMERIC(14,2) AS total_sales_pen,
        COALESCE(SUM(total_pen) FILTER (WHERE payment_mode = 'CREDIT'), 0)::NUMERIC(14,2) AS credit_sales_pen,
        COALESCE(SUM(balance_due_pen), 0)::NUMERIC(14,2) AS pending_ar_pen,
        COUNT(*) FILTER (
            WHERE NOT is_settled
              AND COALESCE(due_date, (order_date + INTERVAL '30 days')::DATE) < (NOW() AT TIME ZONE 'America/Lima')::date
        ) AS overdue_gt_30d_count,
        COALESCE(SUM(balance_due_pen) FILTER (
            WHERE NOT is_settled
              AND COALESCE(due_date, (order_date + INTERVAL '30 days')::DATE) < (NOW() AT TIME ZONE 'America/Lima')::date
        ), 0)::NUMERIC(14,2) AS overdue_gt_30d_pen,
        COUNT(*) FILTER (WHERE historical_status_assumed) AS assumed_status_orders_count,
        COUNT(*) FILTER (WHERE NOT historical_status_assumed) AS explicit_status_orders_count,
        COUNT(*) FILTER (WHERE customer_party_id IS NOT NULL) AS matched_customer_orders_count
    FROM erp.sales_orders
    WHERE order_date >= DATE '2026-06-26'
      AND operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY DATE_TRUNC('month', order_date)::DATE
),
monthly_quotes AS (
    SELECT
        DATE_TRUNC('month', issue_date)::DATE AS period_month,
        COUNT(*) AS quotes_total,
        COUNT(*) FILTER (WHERE status = 'CONVERTED' OR related_cpe IS NOT NULL) AS quotes_converted_count,
        COALESCE(SUM(total_pen), 0)::NUMERIC(14,2) AS quotes_total_pen
    FROM erp.quotes
    WHERE issue_date >= DATE '2026-06-26'
    GROUP BY DATE_TRUNC('month', issue_date)::DATE
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

-- ============================================================================
-- Operational Backlog: ON_DEMAND Sales Lines Awaiting Supplier Purchase
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_pending_on_demand_orders AS
SELECT
    sol.order_line_id,
    so.order_id,
    so.order_code,
    so.order_date,
    so.warehouse_id,
    w.code AS warehouse_code,
    so.customer_party_id,
    COALESCE(c.legal_name, so.customer_name_raw) AS customer_name,
    p.product_id,
    p.sku,
    p.name AS product_name,
    sol.quantity,
    sol.pack_factor_applied,
    (sol.quantity * sol.pack_factor_applied)::NUMERIC(14,4) AS required_base_qty,
    COALESCE(vcs.stock_on_hand, 0)::NUMERIC(14,4) AS current_stock_on_hand,
    sol.line_total_pen,
    so.payment_mode,
    so.balance_due_pen,
    sol.fulfillment_status,
    ((NOW() AT TIME ZONE 'America/Lima')::date - so.order_date) AS days_pending,
    af.flag_id AS open_flag_id,
    af.severity AS flag_severity,
    af.message AS flag_message,
    sol.source_origin
FROM erp.sales_order_lines sol
JOIN erp.sales_orders so ON so.order_id = sol.order_id
JOIN erp.products p ON p.product_id = sol.product_id
JOIN erp.warehouses w ON w.warehouse_id = so.warehouse_id
LEFT JOIN erp.parties c ON c.party_id = so.customer_party_id
LEFT JOIN erp.v_current_stock vcs
       ON vcs.warehouse_id = so.warehouse_id
      AND vcs.product_id = sol.product_id
LEFT JOIN erp.audit_flags af
       ON af.flag_code = 'ON_DEMAND_PENDING_PURCHASE'
      AND af.entity_table = 'erp.sales_order_lines'
      AND af.entity_id = sol.order_line_id::text
      AND af.status = 'OPEN'
WHERE sol.fulfillment_mode = 'ON_DEMAND'
  AND sol.fulfillment_status IN ('PENDING_SUPPLIER_PURCHASE', 'PARTIALLY_FULFILLED')
  AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
ORDER BY so.order_date ASC, sol.order_line_id ASC;

-- ============================================================================
-- Data Quality Gaps & Anomalies Summary (Review Gate Before Promoting to main)
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_data_quality_gaps AS
SELECT
    'ASSUMED_CASH_STATUS'::TEXT AS gap_category,
    'WARNING'::TEXT AS severity,
    COUNT(*)::BIGINT AS item_count,
    COALESCE(SUM(total_pen), 0)::NUMERIC(14,2) AS impacted_pen,
    '2026 Excel sales rows with blank Col G loaded as CASH (historical_status_assumed=TRUE)'::TEXT AS description
FROM erp.sales_orders
WHERE historical_status_assumed = TRUE
  AND operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')

UNION ALL

SELECT
    'SALES_MISSING_SKU_COST'::TEXT,
    'WARNING'::TEXT,
    COUNT(DISTINCT p.product_id)::BIGINT,
    COALESCE(SUM(sol.line_total_pen), 0)::NUMERIC(14,2),
    'Sold SKUs lacking ref_cost_pen in ITEMS-COMPRAS / PRODUCTS / JSON'::TEXT
FROM erp.sales_order_lines sol
JOIN erp.sales_orders so ON so.order_id = sol.order_id
JOIN erp.products p ON p.product_id = sol.product_id
WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NULL
  AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')

UNION ALL

SELECT
    'NEGATIVE_HISTORICAL_STOCK_SKUS'::TEXT,
    'WARNING'::TEXT,
    COUNT(*)::BIGINT,
    0::NUMERIC(14,2),
    'Active SKUs with negative balance due to missing opening inventory count on 2026-06-26'::TEXT
FROM erp.v_current_stock
WHERE warehouse_code = 'MAIN'
  AND stock_on_hand < 0

UNION ALL

SELECT
    'UNMATCHED_OR_REVIEW_PRODUCT_ALIASES'::TEXT,
    'INFO'::TEXT,
    COUNT(*)::BIGINT,
    0::NUMERIC(14,2),
    'Product aliases flagged needs_review = TRUE in normalization catalog'::TEXT
FROM erp.product_aliases
WHERE needs_review = TRUE

UNION ALL

SELECT
    'UNMATCHED_OR_REVIEW_PARTY_ALIASES'::TEXT,
    'INFO'::TEXT,
    COUNT(*)::BIGINT,
    0::NUMERIC(14,2),
    'Customer/supplier aliases flagged needs_review = TRUE in normalization catalog'::TEXT
FROM erp.party_aliases
WHERE needs_review = TRUE

UNION ALL

SELECT
    ('OPEN_AUDIT_FLAG:' || flag_code)::TEXT,
    severity::TEXT,
    COUNT(*)::BIGINT,
    0::NUMERIC(14,2),
    MIN(message)::TEXT
FROM erp.audit_flags
WHERE status = 'OPEN'
GROUP BY flag_code, severity

UNION ALL

SELECT
    'PENDING_ON_DEMAND_LINES'::TEXT,
    'WARNING'::TEXT,
    COUNT(*)::BIGINT,
    COALESCE(SUM(sol.line_total_pen), 0)::NUMERIC(14,2),
    'ON_DEMAND sale lines currently awaiting supplier purchase linkage'::TEXT
FROM erp.sales_order_lines sol
JOIN erp.sales_orders so ON so.order_id = sol.order_id
WHERE sol.fulfillment_mode = 'ON_DEMAND'
  AND sol.fulfillment_status = 'PENDING_SUPPLIER_PURCHASE'
  AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL');
