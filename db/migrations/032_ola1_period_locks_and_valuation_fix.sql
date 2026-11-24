-- 032_ola1_period_locks_and_valuation_fix.sql
--
-- 1. Allow operational ON_DEMAND fulfillment updates on erp.sales_order_lines
--    from later-day supplier purchases when commercial/financial columns and
--    cancellation state are unchanged.
-- 2. Prorate so.global_discount_pen in analytics.v_report_inventory_valuation
--    so revenue and real_gross_margin_pct match v_kpi_sku_margin_and_opex.

CREATE OR REPLACE FUNCTION erp.fn_guard_closed_daily_period()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_old_date DATE;
    v_new_date DATE;
    v_is_closed BOOLEAN := FALSE;
BEGIN
    IF COALESCE(current_setting('bht.allow_closed_period_override', true), 'false') = 'true' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    -- Allow historical backfill imports only on INSERT
    IF TG_OP = 'INSERT' AND NEW.source_origin = 'HISTORICAL_BACKFILL' THEN
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'cash_ledger' THEN
        IF TG_OP IN ('DELETE', 'UPDATE') THEN
            v_old_date := OLD.tx_date;
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            v_new_date := NEW.tx_date;
        END IF;
    ELSIF TG_TABLE_NAME = 'ar_payments' THEN
        IF TG_OP IN ('DELETE', 'UPDATE') THEN
            v_old_date := OLD.payment_date;
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            v_new_date := NEW.payment_date;
        END IF;
    ELSIF TG_TABLE_NAME = 'sales_orders' THEN
        IF TG_OP = 'UPDATE' THEN
            -- Allow warehouse picking/delivery progression and open-day collection sync
            -- only when commercial/financial terms AND cancellation/approval state are unchanged.
            IF OLD.order_date IS NOT DISTINCT FROM NEW.order_date
               AND OLD.total_pen IS NOT DISTINCT FROM NEW.total_pen
               AND OLD.global_discount_pen IS NOT DISTINCT FROM NEW.global_discount_pen
               AND OLD.customer_party_id IS NOT DISTINCT FROM NEW.customer_party_id
               AND OLD.payment_mode IS NOT DISTINCT FROM NEW.payment_mode
               AND (
                   OLD.operational_status IS NOT DISTINCT FROM NEW.operational_status
                   OR (
                       OLD.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
                       AND NEW.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
                   )
               ) THEN
                RETURN NEW;
            END IF;
            v_old_date := OLD.order_date;
            v_new_date := NEW.order_date;
        ELSIF TG_OP = 'DELETE' THEN
            v_old_date := OLD.order_date;
        ELSIF TG_OP = 'INSERT' THEN
            v_new_date := NEW.order_date;
        END IF;
    ELSIF TG_TABLE_NAME = 'sales_order_lines' THEN
        IF TG_OP = 'UPDATE' THEN
            -- Allow ON_DEMAND purchase fulfillment linking when commercial columns
            -- and cancellation state are unchanged.
            IF OLD.order_id IS NOT DISTINCT FROM NEW.order_id
               AND OLD.line_no IS NOT DISTINCT FROM NEW.line_no
               AND OLD.product_id IS NOT DISTINCT FROM NEW.product_id
               AND OLD.quantity IS NOT DISTINCT FROM NEW.quantity
               AND OLD.pack_factor_applied IS NOT DISTINCT FROM NEW.pack_factor_applied
               AND OLD.base_unit_price_pen IS NOT DISTINCT FROM NEW.base_unit_price_pen
               AND OLD.unit_discount_pen IS NOT DISTINCT FROM NEW.unit_discount_pen
               AND OLD.unit_price_pen IS NOT DISTINCT FROM NEW.unit_price_pen
               AND OLD.line_total_pen IS NOT DISTINCT FROM NEW.line_total_pen
               AND OLD.below_min_price_flag IS NOT DISTINCT FROM NEW.below_min_price_flag
               AND OLD.fulfillment_status IS DISTINCT FROM 'CANCELLED'
               AND NEW.fulfillment_status IS DISTINCT FROM 'CANCELLED'
               AND (
                   OLD.fulfillment_status IS NOT DISTINCT FROM NEW.fulfillment_status
                   OR (
                       OLD.fulfillment_status IN ('PENDING_SUPPLIER_PURCHASE', 'PARTIALLY_FULFILLED')
                       AND NEW.fulfillment_status = 'FULFILLED'
                   )
               ) THEN
                RETURN NEW;
            END IF;
        END IF;
        IF TG_OP IN ('DELETE', 'UPDATE') THEN
            SELECT so.order_date INTO v_old_date
            FROM erp.sales_orders so
            WHERE so.order_id = OLD.order_id;
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            SELECT so.order_date INTO v_new_date
            FROM erp.sales_orders so
            WHERE so.order_id = NEW.order_id;
        END IF;
    END IF;

    IF v_old_date IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1
            FROM erp.daily_closures dc
            WHERE dc.closure_date = v_old_date
              AND dc.status = 'CLOSED'
        ) INTO v_is_closed;

        IF v_is_closed THEN
            RAISE EXCEPTION 'Periodo cerrado (%): no se permiten modificaciones sin corrección auditada de cierre diario', v_old_date
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF v_new_date IS NOT NULL AND (v_old_date IS NULL OR v_new_date IS DISTINCT FROM v_old_date) THEN
        SELECT EXISTS (
            SELECT 1
            FROM erp.daily_closures dc
            WHERE dc.closure_date = v_new_date
              AND dc.status = 'CLOSED'
        ) INTO v_is_closed;

        IF v_is_closed THEN
            RAISE EXCEPTION 'Periodo cerrado (%): no se permiten registros sin corrección auditada de cierre diario', v_new_date
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE VIEW analytics.v_report_inventory_valuation AS
WITH order_lines_net AS (
    SELECT
        sol.product_id,
        so.order_id,
        so.order_date,
        sol.quantity,
        sol.pack_factor_applied,
        sol.unit_cost_snapshot_pen,
        p.ref_cost_pen,
        (
            sol.line_total_pen * GREATEST(
                0::NUMERIC,
                1.0 - COALESCE(so.global_discount_pen, 0)
                    / NULLIF(SUM(sol.line_total_pen) OVER (PARTITION BY sol.order_id), 0)
            )
        ) AS net_line_total_pen
    FROM erp.sales_order_lines sol
    JOIN erp.sales_orders so ON so.order_id = sol.order_id
    JOIN erp.products p ON p.product_id = sol.product_id
    WHERE so.order_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26')
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
),
sku_sales_stats AS (
    SELECT
        oln.product_id,
        COALESCE(SUM(oln.quantity * oln.pack_factor_applied), 0)::NUMERIC(14,4) AS units_sold_total,
        COALESCE(
            SUM(oln.quantity * oln.pack_factor_applied)
            FILTER (WHERE oln.order_date >= ((NOW() AT TIME ZONE 'America/Lima')::date - 90)),
            0
        )::NUMERIC(14,4) AS units_sold_90d,
        COUNT(DISTINCT oln.order_id)::int AS order_frequency_total,
        COUNT(DISTINCT oln.order_id)
            FILTER (WHERE oln.order_date >= ((NOW() AT TIME ZONE 'America/Lima')::date - 90))::int AS order_frequency_90d,
        MAX(oln.order_date) AS last_sale_date,
        ROUND(COALESCE(SUM(oln.net_line_total_pen), 0), 2)::NUMERIC(14,2) AS revenue_total_pen,
        ROUND(
            COALESCE(
                SUM(oln.net_line_total_pen)
                FILTER (WHERE COALESCE(oln.unit_cost_snapshot_pen, oln.ref_cost_pen) IS NOT NULL),
                0
            ),
            2
        )::NUMERIC(14,2) AS cost_covered_revenue_pen,
        COALESCE(
            SUM((oln.quantity * oln.pack_factor_applied) * COALESCE(oln.unit_cost_snapshot_pen, oln.ref_cost_pen))
            FILTER (WHERE COALESCE(oln.unit_cost_snapshot_pen, oln.ref_cost_pen) IS NOT NULL),
            0
        )::NUMERIC(14,2) AS known_cogs_pen
    FROM order_lines_net oln
    GROUP BY oln.product_id
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
