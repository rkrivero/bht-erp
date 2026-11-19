-- 024_adjust_caliper_5725_opening_stock.sql
-- Adjusts June 26, 2026 confirmed stock for CALIPER PARA TOYOTA 57-25 (47730-20480)
-- from 200 to 204 units by adding an idempotent +4.0000 OPENING movement
-- (keeping the existing 2026-06-26 FQQ1-115 PURCHASE_IN = +200.0000 intact),
-- bringing current MAIN stock on hand to 0 and clearing its sold regularization deficit.

DO $$
DECLARE
    v_main_wh_id    BIGINT;
    v_caliper_id    BIGINT;
    v_caliper_cost  NUMERIC(14,4);
    v_current_qty   NUMERIC(14,4);
BEGIN
    SELECT warehouse_id
      INTO v_main_wh_id
      FROM erp.warehouses
     WHERE code = 'MAIN'
     LIMIT 1;

    SELECT product_id, COALESCE(ref_cost_pen, 80.5882)
      INTO v_caliper_id, v_caliper_cost
      FROM erp.products
     WHERE sku = '47730-20480'
     LIMIT 1;

    IF v_main_wh_id IS NULL OR v_caliper_id IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO erp.inventory_movements (
        warehouse_id,
        product_id,
        movement_date,
        movement_type,
        quantity_delta,
        unit_cost_pen,
        reference_table,
        reference_id,
        source_origin,
        notes,
        source_row_hash
    )
    VALUES (
        v_main_wh_id,
        v_caliper_id,
        TIMESTAMPTZ '2026-06-26 00:00:00-05',
        'OPENING',
        4.0000,
        v_caliper_cost,
        'raw_staging.opening_stock_2026_06_26',
        'STOCKS-2026-06-26:47730-20480',
        'HISTORICAL_BACKFILL',
        'Saldo inicial ajustado al 26/06/2026: 204 u. confirmadas (200 FQQ1-115 + 4 saldo inicial)',
        'OPENING_2026_06_26:47730-20480'
    )
    ON CONFLICT (source_row_hash) DO NOTHING;

    SELECT COALESCE(SUM(quantity_delta), 0)::NUMERIC(14,4)
      INTO v_current_qty
      FROM erp.inventory_movements
     WHERE warehouse_id = v_main_wh_id
       AND product_id = v_caliper_id;

    IF v_current_qty >= 0 THEN
        UPDATE erp.audit_flags
           SET status = 'RESOLVED',
               resolved_at = NOW(),
               resolved_by = 'MIGRATION_024'
         WHERE flag_code = 'UNPURCHASED_STOCK_DEFICIT'
           AND entity_table = 'erp.products'
           AND entity_id = v_caliper_id::TEXT || '@' || v_main_wh_id::TEXT
           AND status = 'OPEN';
    END IF;

    INSERT INTO erp.audit_flags (
        flag_code,
        severity,
        entity_table,
        entity_id,
        message,
        details,
        status,
        source_origin,
        resolved_at,
        resolved_by
    )
    SELECT
        'OPENING_STOCK_2026_06_26_ADJUSTED',
        'INFO',
        'erp.products',
        v_caliper_id::TEXT,
        'Regularizado stock inicial al 26/06/2026 para CALIPER PARA TOYOTA 57-25 (47730-20480): 204 u. confirmadas (200 FQQ1-115 + 4 OPENING), saldo neto actual 0.',
        jsonb_build_object(
            'sku', '47730-20480',
            'target_eod_2026_06_26', 204,
            'opening_delta', 4,
            'fqq1_115_purchase_qty', 200
        ),
        'RESOLVED',
        'HISTORICAL_BACKFILL',
        NOW(),
        'MIGRATION_024'
    WHERE NOT EXISTS (
        SELECT 1
        FROM erp.audit_flags
        WHERE flag_code = 'OPENING_STOCK_2026_06_26_ADJUSTED'
          AND entity_table = 'erp.products'
          AND entity_id = v_caliper_id::TEXT
    );
END $$;
