-- 023_correct_rony_caliper_5725_error.sql
-- Removes the erroneous 18-unit CALIPER PARA TOYOTA 57-25 line on order SO-2026-07-23-006
-- (RONY 110, sheet '23-07-2026' r13 / ERROR RONY noted on '24-07-2026'), adjusting
-- inventory movements, order total, AR payment and cash_ledger (-S/ 2,340.00 -> S/ 920.00).

DO $$
DECLARE
    v_order_id      BIGINT;
    v_caliper_id    BIGINT;
    v_line_exists   BOOLEAN := FALSE;
    v_new_total     NUMERIC(14,2);
    v_note_tag      CONSTANT TEXT := 'Ajuste histórico ERROR RONY 110 (hoja 24-07-2026): anulada línea de 18 u. CALIPER 57-25 (-S/ 2,340.00)';
BEGIN
    SELECT order_id INTO v_order_id
    FROM erp.sales_orders
    WHERE order_code = 'SO-2026-07-23-006'
    LIMIT 1;

    SELECT product_id INTO v_caliper_id
    FROM erp.products
    WHERE sku = '47730-20480'
    LIMIT 1;

    IF v_order_id IS NULL OR v_caliper_id IS NULL THEN
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM erp.sales_order_lines
        WHERE order_id = v_order_id
          AND product_id = v_caliper_id
          AND source_origin = 'HISTORICAL_BACKFILL'
    ) INTO v_line_exists;

    IF v_line_exists THEN
        DELETE FROM erp.sales_order_lines
        WHERE order_id = v_order_id
          AND product_id = v_caliper_id
          AND source_origin = 'HISTORICAL_BACKFILL';

        DELETE FROM erp.inventory_movements
        WHERE reference_table = 'erp.sales_orders'
          AND reference_id = v_order_id::TEXT
          AND product_id = v_caliper_id
          AND movement_type = 'SALE_OUT'
          AND source_origin = 'HISTORICAL_BACKFILL';

        SELECT COALESCE(SUM(line_total_pen), 0)::NUMERIC(14,2)
        INTO v_new_total
        FROM erp.sales_order_lines
        WHERE order_id = v_order_id
          AND fulfillment_status <> 'CANCELLED';

        UPDATE erp.ar_payments
        SET amount_pen = v_new_total
        WHERE order_id = v_order_id
          AND source_origin = 'HISTORICAL_BACKFILL'
          AND voided_at IS NULL;

        UPDATE erp.sales_orders
        SET total_pen = v_new_total,
            notes = CASE
                WHEN COALESCE(notes, '') LIKE '%ERROR RONY 110%' THEN notes
                ELSE TRIM(BOTH ' |' FROM COALESCE(notes || ' | ', '') || v_note_tag)
            END
        WHERE order_id = v_order_id;

        UPDATE erp.cash_ledger
        SET amount_pen = v_new_total,
            description = 'Venta RONY 110 (SO-2026-07-23-006) [Ajustado sin 18 Caliper 57-25]'
        WHERE reference_table = 'erp.sales_orders'
          AND reference_id = v_order_id::TEXT
          AND direction = 'IN'
          AND source_origin = 'HISTORICAL_BACKFILL';
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
        'EXEL_RONY_CALIPER_ERROR_CORRECTED',
        'INFO',
        'erp.sales_orders',
        v_order_id::TEXT,
        'Anuladas 18 u. de CALIPER PARA TOYOTA 57-25 (-S/ 2,340.00) en SO-2026-07-23-006 (RONY 110) por ERROR RONY anotado en hoja 24-07-2026.',
        jsonb_build_object(
            'order_code', 'SO-2026-07-23-006',
            'sku', '47730-20480',
            'removed_qty', 18,
            'removed_pen', 2340.00,
            'adjusted_order_total_pen', 920.00
        ),
        'RESOLVED',
        'HISTORICAL_BACKFILL',
        NOW(),
        'MIGRATION_023'
    WHERE NOT EXISTS (
        SELECT 1
        FROM erp.audit_flags
        WHERE flag_code = 'EXEL_RONY_CALIPER_ERROR_CORRECTED'
          AND entity_table = 'erp.sales_orders'
          AND entity_id = v_order_id::TEXT
    );
END $$;
