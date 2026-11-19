-- 015_analytics_tier1_reports.sql
-- Indexes and Tier 1 analytical reporting views (P&L vs cash flow, AP maturity,
-- AR aging & DSO detail, route profitability, zone/seller performance, inventory
-- valuation & dead stock, and inactive customers).

-- ============================================================================
-- Supporting Indexes for Fast Real-Time Reporting Queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sales_orders_trip
    ON erp.sales_orders (trip_id)
    WHERE trip_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_orders_created_by
    ON erp.sales_orders (created_by_user_id)
    WHERE created_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_ledger_trip
    ON erp.cash_ledger (trip_id)
    WHERE trip_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_order_lines_product_order
    ON erp.sales_order_lines (product_id, order_id);

-- ============================================================================
-- 1. Monthly Accrual P&L vs. Cash Flow Statement
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
        k.pre_route_foundational_outflow_pen
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
        - j.non_opex_capex_drain_pen
    )::NUMERIC(14,2) AS net_cash_flow_pen
FROM joined j
ORDER BY j.period_month ASC;

-- ============================================================================
-- 2. Accounts Payable Maturity Schedule (Overdue / 7 / 15 / 30 / >30 / No Due)
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_report_ap_maturity AS
WITH ap_base AS (
    SELECT
        ap.ap_id,
        ap.purchase_id,
        ap.supplier_party_id,
        COALESCE(NULLIF(BTRIM(pa.trade_name), ''), pa.legal_name, 'Proveedor sin especificar') AS supplier_name,
        pa.doc_number AS supplier_doc_number,
        ap.doc_ref,
        ap.obligation_type,
        ap.issue_date,
        ap.due_date,
        ROUND(ap.original_amount_pen, 2) AS original_amount_pen,
        ROUND(ap.paid_amount_pen, 2) AS paid_amount_pen,
        ROUND(ap.balance_due_pen, 2) AS balance_due_pen,
        ap.status::text AS status,
        CASE
            WHEN ap.due_date IS NULL THEN NULL
            ELSE (ap.due_date - (NOW() AT TIME ZONE 'America/Lima')::date)::int
        END AS days_to_due
    FROM erp.ap_obligations ap
    LEFT JOIN erp.parties pa ON pa.party_id = ap.supplier_party_id
    WHERE ap.status IN ('OPEN', 'PARTIAL')
      AND ap.balance_due_pen > 0.05
)
SELECT
    ab.*,
    CASE
        WHEN ab.due_date IS NULL THEN 'NO_DUE_DATE'
        WHEN ab.days_to_due < 0 THEN 'OVERDUE'
        WHEN ab.days_to_due <= 7 THEN 'DUE_0_7'
        WHEN ab.days_to_due <= 15 THEN 'DUE_8_15'
        WHEN ab.days_to_due <= 30 THEN 'DUE_16_30'
        ELSE 'DUE_31_PLUS'
    END AS maturity_bucket
FROM ap_base ab
ORDER BY
    CASE
        WHEN ab.due_date IS NULL THEN 5
        WHEN ab.days_to_due < 0 THEN 0
        WHEN ab.days_to_due <= 7 THEN 1
        WHEN ab.days_to_due <= 15 THEN 2
        WHEN ab.days_to_due <= 30 THEN 3
        ELSE 4
    END ASC,
    ab.due_date ASC NULLS LAST,
    ab.balance_due_pen DESC;

-- ============================================================================
-- 3. Accounts Receivable Aging Detail (0-15 / 16-30 / 31-60 / >60d + Zone)
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_report_ar_aging_detail AS
WITH payment_stats AS (
    SELECT
        p.order_id,
        COUNT(*) AS payment_count,
        MAX(p.payment_date) AS last_payment_date
    FROM erp.ar_payments p
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
        GREATEST(0, ((NOW() AT TIME ZONE 'America/Lima')::date - so.order_date))::int AS days_overdue,
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
    ab.created_by_name
FROM ar_base ab
ORDER BY ab.effective_zone ASC, ab.days_overdue DESC, ab.order_id ASC;

-- ============================================================================
-- 4. Route Trip Profitability (Sales, Gross Margin, ROUTE_OPEX %, Net)
-- ============================================================================

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
      AND cl.expense_bucket = 'ROUTE_OPEX'
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
    (tb.route_opex_pen * 100.0 / NULLIF(tb.sales_total_pen, 0) > 8.0) AS route_opex_above_8pct_alert
FROM trip_base tb
ORDER BY tb.trip_date DESC, tb.trip_id DESC;

-- ============================================================================
-- 5. Commercial Sales & Margin by Zone
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_report_sales_by_zone AS
WITH order_cogs AS (
    SELECT
        sol.order_id,
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
    JOIN erp.products p ON p.product_id = sol.product_id
    GROUP BY sol.order_id
),
zone_agg AS (
    SELECT
        COALESCE(NULLIF(BTRIM(pa.city_zone), ''), NULLIF(BTRIM(rt.zone_name), ''), 'Sin zona') AS effective_zone,
        COUNT(*)::int AS orders_count,
        COUNT(DISTINCT COALESCE(so.customer_party_id::text, so.customer_name_raw))::int AS customers_count,
        COALESCE(SUM(so.total_pen), 0)::NUMERIC(14,2) AS sales_total_pen,
        COALESCE(SUM(so.paid_pen), 0)::NUMERIC(14,2) AS cash_collected_pen,
        COALESCE(SUM(so.balance_due_pen), 0)::NUMERIC(14,2) AS ar_pending_pen,
        COALESCE(SUM(oc.cost_covered_sales_pen), 0)::NUMERIC(14,2) AS cost_covered_sales_pen,
        COALESCE(SUM(oc.known_cogs_pen), 0)::NUMERIC(14,2) AS known_cogs_pen
    FROM erp.sales_orders so
    LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
    LEFT JOIN erp.route_trips rt ON rt.trip_id = so.trip_id
    LEFT JOIN order_cogs oc ON oc.order_id = so.order_id
    WHERE so.order_date >= DATE '2026-06-26'
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY COALESCE(NULLIF(BTRIM(pa.city_zone), ''), NULLIF(BTRIM(rt.zone_name), ''), 'Sin zona')
)
SELECT
    za.effective_zone,
    za.orders_count,
    za.customers_count,
    za.sales_total_pen,
    za.cash_collected_pen,
    za.ar_pending_pen,
    za.cost_covered_sales_pen,
    za.known_cogs_pen,
    (za.cost_covered_sales_pen - za.known_cogs_pen)::NUMERIC(14,2) AS gross_margin_pen,
    ROUND((za.cost_covered_sales_pen - za.known_cogs_pen) * 100.0 / NULLIF(za.cost_covered_sales_pen, 0), 2) AS gross_margin_pct
FROM zone_agg za
ORDER BY za.sales_total_pen DESC, za.effective_zone ASC;

-- ============================================================================
-- 6. Commercial Sales, Collection Rate & Margin by Seller
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_report_sales_by_seller AS
WITH order_line_stats AS (
    SELECT
        sol.order_id,
        COALESCE(
            SUM(sol.line_total_pen)
            FILTER (WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL),
            0
        )::NUMERIC(14,2) AS cost_covered_sales_pen,
        COALESCE(
            SUM((sol.quantity * sol.pack_factor_applied) * COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen))
            FILTER (WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL),
            0
        )::NUMERIC(14,2) AS known_cogs_pen,
        COALESCE(SUM(sol.quantity * COALESCE(sol.unit_discount_pen, 0)), 0)::NUMERIC(14,2) AS discount_total_pen
    FROM erp.sales_order_lines sol
    JOIN erp.products p ON p.product_id = sol.product_id
    GROUP BY sol.order_id
),
seller_agg AS (
    SELECT
        so.created_by_user_id AS seller_user_id,
        COALESCE(u.full_name, 'Sin vendedor asignado (Histórico)') AS seller_name,
        COUNT(*)::int AS orders_count,
        COALESCE(SUM(so.total_pen), 0)::NUMERIC(14,2) AS sales_total_pen,
        COALESCE(SUM(so.paid_pen), 0)::NUMERIC(14,2) AS cash_collected_pen,
        COALESCE(SUM(so.balance_due_pen), 0)::NUMERIC(14,2) AS ar_pending_pen,
        COALESCE(SUM(ols.cost_covered_sales_pen), 0)::NUMERIC(14,2) AS cost_covered_sales_pen,
        COALESCE(SUM(ols.known_cogs_pen), 0)::NUMERIC(14,2) AS known_cogs_pen,
        COALESCE(SUM(ols.discount_total_pen), 0)::NUMERIC(14,2) AS discount_total_pen
    FROM erp.sales_orders so
    LEFT JOIN erp.app_users u ON u.user_id = so.created_by_user_id
    LEFT JOIN order_line_stats ols ON ols.order_id = so.order_id
    WHERE so.order_date >= DATE '2026-06-26'
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY so.created_by_user_id, COALESCE(u.full_name, 'Sin vendedor asignado (Histórico)')
)
SELECT
    sa.seller_user_id,
    sa.seller_name,
    sa.orders_count,
    sa.sales_total_pen,
    sa.cash_collected_pen,
    ROUND(sa.cash_collected_pen * 100.0 / NULLIF(sa.sales_total_pen, 0), 2) AS collection_rate_pct,
    sa.ar_pending_pen,
    sa.cost_covered_sales_pen,
    (sa.cost_covered_sales_pen - sa.known_cogs_pen)::NUMERIC(14,2) AS gross_margin_pen,
    ROUND((sa.cost_covered_sales_pen - sa.known_cogs_pen) * 100.0 / NULLIF(sa.cost_covered_sales_pen, 0), 2) AS gross_margin_pct,
    sa.discount_total_pen
FROM seller_agg sa
ORDER BY sa.sales_total_pen DESC, sa.seller_name ASC;

-- ============================================================================
-- 7. Inventory Valuation (PEN), Days of Coverage & Dead Stock (60/90d)
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_report_inventory_valuation AS
WITH sku_sales_stats AS (
    SELECT
        sol.product_id,
        COALESCE(SUM(sol.quantity * sol.pack_factor_applied), 0)::NUMERIC(14,4) AS units_sold_total,
        COALESCE(
            SUM(sol.quantity * sol.pack_factor_applied)
            FILTER (WHERE so.order_date >= ((NOW() AT TIME ZONE 'America/Lima')::date - 90)),
            0
        )::NUMERIC(14,4) AS units_sold_90d,
        COUNT(DISTINCT so.order_id)::int AS order_frequency_total,
        COUNT(DISTINCT so.order_id)
            FILTER (WHERE so.order_date >= ((NOW() AT TIME ZONE 'America/Lima')::date - 90))::int AS order_frequency_90d,
        MAX(so.order_date) AS last_sale_date,
        COALESCE(SUM(sol.line_total_pen), 0)::NUMERIC(14,2) AS revenue_total_pen,
        COALESCE(
            SUM(sol.line_total_pen)
            FILTER (WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL),
            0
        )::NUMERIC(14,2) AS cost_covered_revenue_pen,
        COALESCE(
            SUM((sol.quantity * sol.pack_factor_applied) * COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen))
            FILTER (WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL),
            0
        )::NUMERIC(14,2) AS known_cogs_pen
    FROM erp.sales_order_lines sol
    JOIN erp.sales_orders so ON so.order_id = sol.order_id
    JOIN erp.products p ON p.product_id = sol.product_id
    WHERE so.order_date >= DATE '2026-06-26'
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY sol.product_id
),
base_stock AS (
    SELECT
        p.product_id,
        p.sku,
        p.name AS product_name,
        p.category,
        p.fulfillment_mode::text AS fulfillment_mode,
        p.unit_of_measure,
        COALESCE(vcs.stock_on_hand, 0)::NUMERIC(14,4) AS stock_on_hand,
        GREATEST(COALESCE(vcs.stock_on_hand, 0), 0)::NUMERIC(14,4) AS positive_stock_qty,
        p.ref_cost_pen,
        p.list_sale_price_pen,
        p.min_sale_price_pen,
        p.cost_source,
        CASE
            WHEN COALESCE(vcs.stock_on_hand, 0) > 0 AND p.ref_cost_pen IS NOT NULL
                THEN ROUND(vcs.stock_on_hand * p.ref_cost_pen, 2)
            ELSE 0
        END::NUMERIC(14,2) AS valuation_pen,
        COALESCE(ss.units_sold_total, 0)::NUMERIC(14,4) AS units_sold_total,
        COALESCE(ss.units_sold_90d, 0)::NUMERIC(14,4) AS units_sold_90d,
        COALESCE(ss.order_frequency_total, 0) AS order_frequency_total,
        COALESCE(ss.order_frequency_90d, 0) AS order_frequency_90d,
        ss.last_sale_date,
        CASE
            WHEN ss.last_sale_date IS NOT NULL
                THEN GREATEST(0, ((NOW() AT TIME ZONE 'America/Lima')::date - ss.last_sale_date))::int
            ELSE NULL
        END AS days_since_last_sale,
        ROUND(COALESCE(ss.units_sold_90d, 0) / 90.0, 4) AS daily_velocity_90d,
        CASE
            WHEN GREATEST(COALESCE(vcs.stock_on_hand, 0), 0) > 0 AND COALESCE(ss.units_sold_90d, 0) > 0
                THEN ROUND(GREATEST(COALESCE(vcs.stock_on_hand, 0), 0) / (ss.units_sold_90d / 90.0), 1)
            WHEN GREATEST(COALESCE(vcs.stock_on_hand, 0), 0) <= 0 AND COALESCE(ss.units_sold_90d, 0) > 0
                THEN 0.0
            ELSE NULL
        END AS days_of_coverage,
        COALESCE(ss.revenue_total_pen, 0)::NUMERIC(14,2) AS revenue_total_pen,
        CASE
            WHEN COALESCE(ss.cost_covered_revenue_pen, 0) > 0
                THEN ROUND((ss.cost_covered_revenue_pen - ss.known_cogs_pen) * 100.0 / ss.cost_covered_revenue_pen, 2)
            ELSE NULL
        END AS real_gross_margin_pct
    FROM erp.products p
    JOIN erp.warehouses w ON w.code = 'MAIN' AND w.is_active = TRUE
    LEFT JOIN erp.v_current_stock vcs
           ON vcs.warehouse_id = w.warehouse_id
          AND vcs.product_id = p.product_id
    LEFT JOIN sku_sales_stats ss ON ss.product_id = p.product_id
    WHERE p.is_active = TRUE
)
SELECT
    bs.*,
    CASE
        WHEN bs.stock_on_hand < -0.0001 THEN 'NEGATIVE_STOCK'
        WHEN bs.positive_stock_qty > 0 AND (bs.days_since_last_sale IS NULL OR bs.days_since_last_sale >= 90) THEN 'DEAD_90D'
        WHEN bs.positive_stock_qty > 0 AND bs.days_since_last_sale >= 60 THEN 'SLOW_60D'
        WHEN bs.fulfillment_mode = 'STOCKED'
             AND ((bs.days_of_coverage IS NOT NULL AND bs.days_of_coverage <= 14) OR (bs.positive_stock_qty <= 5 AND bs.units_sold_total > 0))
            THEN 'LOW_COVERAGE'
        WHEN bs.positive_stock_qty > 0 THEN 'HEALTHY'
        ELSE 'NO_STOCK'
    END AS dead_stock_status
FROM base_stock bs
ORDER BY bs.valuation_pen DESC, bs.revenue_total_pen DESC, bs.product_id ASC;

-- ============================================================================
-- 8. Inactive Customers Detection (>30 / 45 / 60 days without active order)
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_report_inactive_customers AS
WITH customer_orders AS (
    SELECT
        pa.party_id AS customer_party_id,
        COALESCE(NULLIF(BTRIM(pa.trade_name), ''), pa.legal_name) AS customer_name,
        pa.legal_name,
        NULLIF(BTRIM(pa.city_zone), '') AS city_zone,
        COALESCE(NULLIF(BTRIM(pa.city_zone), ''), MAX(NULLIF(BTRIM(rt.zone_name), '')), 'Sin zona') AS effective_zone,
        pa.phone,
        COUNT(so.order_id)::int AS orders_count,
        COALESCE(SUM(so.total_pen), 0)::NUMERIC(14,2) AS total_sold_pen,
        COALESCE(SUM(so.balance_due_pen), 0)::NUMERIC(14,2) AS total_due_pen,
        MAX(so.order_date) AS last_order_date,
        GREATEST(0, ((NOW() AT TIME ZONE 'America/Lima')::date - MAX(so.order_date)))::int AS days_since_last_order
    FROM erp.parties pa
    JOIN erp.sales_orders so ON so.customer_party_id = pa.party_id
    LEFT JOIN erp.route_trips rt ON rt.trip_id = so.trip_id
    WHERE pa.party_type IN ('CUSTOMER', 'BOTH')
      AND pa.is_active = TRUE
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY pa.party_id, pa.trade_name, pa.legal_name, pa.city_zone, pa.phone
)
SELECT
    co.*,
    CASE
        WHEN co.days_since_last_order >= 60 THEN 'GT_60D'
        WHEN co.days_since_last_order >= 46 THEN '46_60D'
        WHEN co.days_since_last_order >= 31 THEN '31_45D'
        ELSE 'ACTIVE'
    END AS inactivity_tier
FROM customer_orders co
ORDER BY co.days_since_last_order DESC, co.total_sold_pen DESC;
