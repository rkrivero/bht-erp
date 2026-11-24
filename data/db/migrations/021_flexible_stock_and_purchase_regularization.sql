-- 021_flexible_stock_and_purchase_regularization.sql
-- Allows non-blocking sales & quote conversions even when stock is 0/negative,
-- logs UNPURCHASED_STOCK_DEFICIT warnings for STOCKED items sold without formal purchase backing,
-- and exposes analytics.v_unpurchased_sales_regularization for supplier invoicing & Excel export.

-- ============================================================================
-- 1. Non-blocking Stock Guard (preserve ON_DEMAND_STOCK_DEFICIT & add UNPURCHASED_STOCK_DEFICIT)
-- ============================================================================

CREATE OR REPLACE FUNCTION erp.fn_guard_negative_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_allow_negative  BOOLEAN;
    v_mode            erp.fulfillment_mode;
    v_sku             TEXT;
    v_current_qty     NUMERIC(14,4);
    v_resulting_qty   NUMERIC(14,4);
BEGIN
    IF NEW.quantity_delta >= 0 THEN
        RETURN NEW;
    END IF;

    -- Serialize concurrent balance checks per warehouse + product inside transaction.
    PERFORM pg_advisory_xact_lock(hashtext(NEW.warehouse_id::text || ':' || NEW.product_id::text));

    SELECT allow_negative_stock
      INTO v_allow_negative
      FROM erp.warehouses
     WHERE warehouse_id = NEW.warehouse_id;

    SELECT fulfillment_mode, sku
      INTO v_mode, v_sku
      FROM erp.products
     WHERE product_id = NEW.product_id;

    SELECT COALESCE(SUM(quantity_delta), 0)
      INTO v_current_qty
      FROM erp.inventory_movements
     WHERE warehouse_id = NEW.warehouse_id
       AND product_id = NEW.product_id;

    v_resulting_qty := v_current_qty + NEW.quantity_delta;

    IF v_resulting_qty < 0
       AND NEW.source_origin = 'ERP_APP'
       AND COALESCE(v_allow_negative, FALSE) = FALSE THEN
        IF v_mode = 'ON_DEMAND' THEN
            INSERT INTO erp.audit_flags (
                flag_code,
                severity,
                entity_table,
                entity_id,
                message,
                details,
                source_origin
            )
            VALUES (
                'ON_DEMAND_STOCK_DEFICIT',
                'WARNING',
                'erp.products',
                NEW.product_id::text || '@' || NEW.warehouse_id::text,
                format('ON_DEMAND SKU %s dispatched with deficit (%s on hand -> %s)', v_sku, v_current_qty, v_resulting_qty),
                jsonb_build_object(
                    'sku', v_sku,
                    'warehouse_id', NEW.warehouse_id,
                    'on_hand_before', v_current_qty,
                    'quantity_delta', NEW.quantity_delta,
                    'resulting_stock', v_resulting_qty,
                    'reference_table', NEW.reference_table,
                    'reference_id', NEW.reference_id
                ),
                NEW.source_origin
            )
            ON CONFLICT (flag_code, entity_table, entity_id)
            WHERE status = 'OPEN'
            DO UPDATE SET
                message = EXCLUDED.message,
                details = EXCLUDED.details;
        ELSE
            -- Non-blocking mode: allow STOCKED sales & quote conversions and flag for formal purchase regularization.
            INSERT INTO erp.audit_flags (
                flag_code,
                severity,
                entity_table,
                entity_id,
                message,
                details,
                source_origin
            )
            VALUES (
                'UNPURCHASED_STOCK_DEFICIT',
                'WARNING',
                'erp.products',
                NEW.product_id::text || '@' || NEW.warehouse_id::text,
                format('SKU %s vendido sin compra formal suficiente (%s -> %s); pendiente de regularizar compra', v_sku, v_current_qty, v_resulting_qty),
                jsonb_build_object(
                    'sku', v_sku,
                    'warehouse_id', NEW.warehouse_id,
                    'on_hand_before', v_current_qty,
                    'quantity_delta', NEW.quantity_delta,
                    'resulting_stock', v_resulting_qty,
                    'reference_table', NEW.reference_table,
                    'reference_id', NEW.reference_id
                ),
                NEW.source_origin
            )
            ON CONFLICT (flag_code, entity_table, entity_id)
            WHERE status = 'OPEN'
            DO UPDATE SET
                message = EXCLUDED.message,
                details = EXCLUDED.details;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. Canonical Unpurchased-Sales Regularization View
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_unpurchased_sales_regularization AS
WITH main_wh AS (
    SELECT warehouse_id
    FROM erp.warehouses
    WHERE code = 'MAIN'
      AND is_active = TRUE
    LIMIT 1
),
inv_formal AS (
    SELECT
        im.product_id,
        COALESCE(SUM(im.quantity_delta) FILTER (WHERE im.movement_type = 'OPENING'), 0)::NUMERIC(14,4) AS opening_stock_qty,
        COALESCE(SUM(im.quantity_delta) FILTER (WHERE im.movement_type = 'PURCHASE_IN'), 0)::NUMERIC(14,4) AS purchased_qty
    FROM erp.inventory_movements im
    CROSS JOIN main_wh mw
    WHERE im.warehouse_id = mw.warehouse_id
    GROUP BY im.product_id
),
sales_agg AS (
    SELECT
        sol.product_id,
        COALESCE(SUM(sol.quantity * sol.pack_factor_applied), 0)::NUMERIC(14,4) AS sold_qty,
        COUNT(DISTINCT so.order_id)::INT AS orders_count,
        MIN(so.order_date) AS first_sale_date,
        MAX(so.order_date) AS last_sale_date,
        COALESCE(SUM(sol.line_total_pen), 0)::NUMERIC(14,2) AS total_sales_revenue_pen
    FROM erp.sales_order_lines sol
    JOIN erp.sales_orders so ON so.order_id = sol.order_id
    WHERE so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
      AND sol.fulfillment_status <> 'CANCELLED'
    GROUP BY sol.product_id
),
open_quotes_agg AS (
    SELECT
        ql.product_id,
        COALESCE(SUM(ql.quantity), 0)::NUMERIC(14,4) AS open_quoted_qty,
        COUNT(DISTINCT q.quote_id)::INT AS open_quotes_count
    FROM erp.quote_lines ql
    JOIN erp.quotes q ON q.quote_id = ql.quote_id
    WHERE q.status = 'OPEN'
      AND ql.product_id IS NOT NULL
    GROUP BY ql.product_id
),
last_supplier AS (
    SELECT DISTINCT ON (pil.product_id)
        pil.product_id,
        pi.supplier_party_id,
        COALESCE(NULLIF(BTRIM(sp.trade_name), ''), sp.legal_name, pi.supplier_name_raw) AS supplier_name
    FROM erp.purchase_invoice_lines pil
    JOIN erp.purchase_invoices pi ON pi.purchase_id = pil.purchase_id
    LEFT JOIN erp.parties sp ON sp.party_id = pi.supplier_party_id
    WHERE pil.product_id IS NOT NULL
    ORDER BY pil.product_id, pi.issue_date DESC, pi.purchase_id DESC
),
calc AS (
    SELECT
        p.product_id,
        p.sku,
        p.name AS product_name,
        COALESCE(p.category, 'GENERAL') AS category,
        p.unit_of_measure,
        p.fulfillment_mode::text AS fulfillment_mode,
        COALESCE(inv.opening_stock_qty, 0)::NUMERIC(14,4) AS opening_stock_qty,
        COALESCE(inv.purchased_qty, 0)::NUMERIC(14,4) AS purchased_qty,
        (COALESCE(inv.opening_stock_qty, 0) + COALESCE(inv.purchased_qty, 0))::NUMERIC(14,4) AS formal_backed_qty,
        COALESCE(sa.sold_qty, 0)::NUMERIC(14,4) AS sold_qty,
        COALESCE(sa.orders_count, 0)::INT AS orders_count,
        sa.first_sale_date,
        sa.last_sale_date,
        COALESCE(sa.total_sales_revenue_pen, 0)::NUMERIC(14,2) AS total_sales_revenue_pen,
        COALESCE(oq.open_quoted_qty, 0)::NUMERIC(14,4) AS open_quoted_qty,
        COALESCE(oq.open_quotes_count, 0)::INT AS open_quotes_count,
        GREATEST(0, COALESCE(sa.sold_qty, 0) - (COALESCE(inv.opening_stock_qty, 0) + COALESCE(inv.purchased_qty, 0)))::NUMERIC(14,4) AS qty_to_regularize,
        GREATEST(0, (COALESCE(sa.sold_qty, 0) + COALESCE(oq.open_quoted_qty, 0)) - (COALESCE(inv.opening_stock_qty, 0) + COALESCE(inv.purchased_qty, 0)))::NUMERIC(14,4) AS projected_qty_to_regularize,
        COALESCE(vcs.stock_on_hand, 0)::NUMERIC(14,4) AS current_stock_on_hand,
        p.ref_cost_pen,
        p.list_sale_price_pen,
        COALESCE(p.default_supplier_party_id, ls.supplier_party_id) AS last_supplier_party_id,
        COALESCE(
            NULLIF(BTRIM(sup_def.trade_name), ''),
            sup_def.legal_name,
            ls.supplier_name,
            'Por asignar'
        ) AS last_supplier_name
    FROM erp.products p
    CROSS JOIN main_wh mw
    LEFT JOIN inv_formal inv ON inv.product_id = p.product_id
    LEFT JOIN sales_agg sa ON sa.product_id = p.product_id
    LEFT JOIN open_quotes_agg oq ON oq.product_id = p.product_id
    LEFT JOIN erp.v_current_stock vcs
           ON vcs.warehouse_id = mw.warehouse_id
          AND vcs.product_id = p.product_id
    LEFT JOIN erp.parties sup_def ON sup_def.party_id = p.default_supplier_party_id
    LEFT JOIN last_supplier ls ON ls.product_id = p.product_id
    WHERE p.is_active = TRUE
)
SELECT
    product_id,
    sku,
    product_name,
    category,
    unit_of_measure,
    fulfillment_mode,
    opening_stock_qty,
    purchased_qty,
    formal_backed_qty,
    sold_qty,
    orders_count,
    first_sale_date,
    last_sale_date,
    total_sales_revenue_pen,
    open_quoted_qty,
    open_quotes_count,
    qty_to_regularize,
    projected_qty_to_regularize,
    GREATEST(0, projected_qty_to_regularize - qty_to_regularize)::NUMERIC(14,4) AS additional_quote_deficit_qty,
    current_stock_on_hand,
    ref_cost_pen,
    list_sale_price_pen,
    CASE
        WHEN ref_cost_pen IS NOT NULL THEN ROUND(qty_to_regularize * ref_cost_pen, 2)
        ELSE NULL
    END::NUMERIC(14,2) AS estimated_purchase_pen,
    CASE
        WHEN ref_cost_pen IS NOT NULL THEN ROUND(projected_qty_to_regularize * ref_cost_pen, 2)
        ELSE NULL
    END::NUMERIC(14,2) AS projected_purchase_pen,
    last_supplier_party_id,
    last_supplier_name,
    (qty_to_regularize > 0.0001) AS has_sold_deficit
FROM calc
WHERE qty_to_regularize > 0.0001
   OR projected_qty_to_regularize > 0.0001
ORDER BY qty_to_regularize DESC, estimated_purchase_pen DESC NULLS LAST, projected_qty_to_regularize DESC, sku ASC;
