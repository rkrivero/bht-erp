-- 020_consolidate_caliper_and_brake_catalog.sql
-- Consolidates caliper products into two canonical SKUs (47730-26120 and 47730-20480),
-- removes obsolete side-specific brake pump SKUs, merges child lines/movements/aliases,
-- and records verified June 26, 2026 opening stock (D562-SET = +4210) without duplicating FQQ1-115.

DO $$
DECLARE
    v_bufalo_keep_id  BIGINT;
    v_bufalo_drop_id  BIGINT;
    v_laser_keep_id   BIGINT;
    v_laser_drop_id   BIGINT;
    v_bomba_keep_id   BIGINT;
    v_bomba_drop_ids  BIGINT[];
    v_main_wh_id      BIGINT;
    v_d562_id         BIGINT;
    v_d562_cost       NUMERIC(12,4);
BEGIN
    SELECT product_id INTO v_bufalo_keep_id
      FROM erp.products
     WHERE sku = '47730-26120';

    SELECT product_id INTO v_bufalo_drop_id
      FROM erp.products
     WHERE sku = '47750-26120';

    SELECT COALESCE(
               (SELECT product_id FROM erp.products WHERE sku = '47730-20480'),
               (SELECT product_id FROM erp.products WHERE sku = '47730-20480 L')
           )
      INTO v_laser_keep_id;

    SELECT product_id INTO v_laser_drop_id
      FROM erp.products
     WHERE sku = '47750-20480 R';

    SELECT product_id INTO v_bomba_keep_id
      FROM erp.products
     WHERE sku = '31410-20150';

    SELECT ARRAY(
               SELECT product_id
                 FROM erp.products
                WHERE sku IN ('31410-20150 LEFT-NEW', '31410-20150 RIGHT-NEW')
           )
      INTO v_bomba_drop_ids;

    -- 1. Update canonical surviving caliper products
    IF v_bufalo_keep_id IS NOT NULL THEN
        UPDATE erp.products
           SET name = 'CALIPER PARA TOYOTA BUFALO',
               list_sale_price_pen = 145.0000,
               min_sale_price_pen = 145.0000,
               ref_cost_pen = 95.0000,
               cost_source = 'ITEMS_COMPRAS_AVG',
               updated_at = NOW()
         WHERE product_id = v_bufalo_keep_id;
    END IF;

    IF v_laser_keep_id IS NOT NULL THEN
        UPDATE erp.products
           SET sku = '47730-20480',
               name = 'CALIPER PARA TOYOTA 57-25',
               list_sale_price_pen = 135.0000,
               min_sale_price_pen = 135.0000,
               ref_cost_pen = 80.5882,
               cost_source = 'ITEMS_COMPRAS_AVG',
               updated_at = NOW()
         WHERE product_id = v_laser_keep_id;
    END IF;

    -- 2. Reassign & consolidate erp.quote_lines
    IF v_bufalo_keep_id IS NOT NULL AND v_bufalo_drop_id IS NOT NULL THEN
        UPDATE erp.quote_lines
           SET product_id = v_bufalo_keep_id
         WHERE product_id = v_bufalo_drop_id;
    END IF;

    IF v_laser_keep_id IS NOT NULL AND v_laser_drop_id IS NOT NULL THEN
        UPDATE erp.quote_lines
           SET product_id = v_laser_keep_id
         WHERE product_id = v_laser_drop_id;
    END IF;

    IF v_bomba_keep_id IS NOT NULL AND array_length(v_bomba_drop_ids, 1) > 0 THEN
        UPDATE erp.quote_lines
           SET product_id = v_bomba_keep_id
         WHERE product_id = ANY(v_bomba_drop_ids);
    END IF;

    WITH dup_quote_lines AS (
        SELECT
            quote_id,
            product_id,
            unit_price_pen,
            MIN(quote_line_id) AS keep_line_id,
            SUM(quantity) AS total_qty,
            SUM(line_total_pen) AS total_pen,
            COUNT(*) AS cnt
        FROM erp.quote_lines
        WHERE product_id IN (v_bufalo_keep_id, v_laser_keep_id)
        GROUP BY quote_id, product_id, unit_price_pen
        HAVING COUNT(*) > 1
    )
    UPDATE erp.quote_lines ql
       SET quantity = d.total_qty,
           line_total_pen = d.total_pen
      FROM dup_quote_lines d
     WHERE ql.quote_line_id = d.keep_line_id;

    WITH dup_quote_lines AS (
        SELECT
            quote_id,
            product_id,
            unit_price_pen,
            MIN(quote_line_id) AS keep_line_id
        FROM erp.quote_lines
        WHERE product_id IN (v_bufalo_keep_id, v_laser_keep_id)
        GROUP BY quote_id, product_id, unit_price_pen
        HAVING COUNT(*) > 1
    )
    DELETE FROM erp.quote_lines ql
     USING dup_quote_lines d
     WHERE ql.quote_id = d.quote_id
       AND ql.product_id = d.product_id
       AND ql.unit_price_pen = d.unit_price_pen
       AND ql.quote_line_id <> d.keep_line_id;

    IF v_bufalo_keep_id IS NOT NULL THEN
        UPDATE erp.quote_lines
           SET raw_description = 'CALIPER PARA TOYOTA BUFALO'
         WHERE product_id = v_bufalo_keep_id
           AND raw_description IS DISTINCT FROM 'CALIPER PARA TOYOTA BUFALO';
    END IF;

    IF v_laser_keep_id IS NOT NULL THEN
        UPDATE erp.quote_lines
           SET raw_description = 'CALIPER PARA TOYOTA 57-25'
         WHERE product_id = v_laser_keep_id
           AND raw_description IS DISTINCT FROM 'CALIPER PARA TOYOTA 57-25';
    END IF;

    UPDATE erp.quotes q
       SET updated_at = NOW()
     WHERE EXISTS (
         SELECT 1
         FROM erp.quote_lines ql
         WHERE ql.quote_id = q.quote_id
           AND ql.product_id IN (v_bufalo_keep_id, v_laser_keep_id, v_bomba_keep_id)
     );

    -- 3. Reassign & normalize erp.sales_order_lines
    IF v_bufalo_keep_id IS NOT NULL AND v_bufalo_drop_id IS NOT NULL THEN
        UPDATE erp.sales_order_lines
           SET product_id = v_bufalo_keep_id
         WHERE product_id = v_bufalo_drop_id;
    END IF;

    IF v_laser_keep_id IS NOT NULL AND v_laser_drop_id IS NOT NULL THEN
        UPDATE erp.sales_order_lines
           SET product_id = v_laser_keep_id
         WHERE product_id = v_laser_drop_id;
    END IF;

    IF v_bomba_keep_id IS NOT NULL AND array_length(v_bomba_drop_ids, 1) > 0 THEN
        UPDATE erp.sales_order_lines
           SET product_id = v_bomba_keep_id
         WHERE product_id = ANY(v_bomba_drop_ids);
    END IF;

    IF v_bufalo_keep_id IS NOT NULL THEN
        UPDATE erp.sales_order_lines
           SET raw_description = 'CALIPER PARA TOYOTA BUFALO'
         WHERE product_id = v_bufalo_keep_id
           AND raw_description IS DISTINCT FROM 'CALIPER PARA TOYOTA BUFALO';
    END IF;

    IF v_laser_keep_id IS NOT NULL THEN
        UPDATE erp.sales_order_lines
           SET raw_description = 'CALIPER PARA TOYOTA 57-25',
               unit_cost_snapshot_pen = CASE
                   WHEN unit_cost_snapshot_pen = 81.1538 THEN 80.5882
                   ELSE unit_cost_snapshot_pen
               END
         WHERE product_id = v_laser_keep_id
           AND (
               raw_description IS DISTINCT FROM 'CALIPER PARA TOYOTA 57-25'
               OR unit_cost_snapshot_pen = 81.1538
           );
    END IF;

    -- 4. Reassign & consolidate erp.purchase_invoice_lines
    IF v_bufalo_keep_id IS NOT NULL AND v_bufalo_drop_id IS NOT NULL THEN
        UPDATE erp.purchase_invoice_lines
           SET product_id = v_bufalo_keep_id
         WHERE product_id = v_bufalo_drop_id;
    END IF;

    IF v_laser_keep_id IS NOT NULL AND v_laser_drop_id IS NOT NULL THEN
        UPDATE erp.purchase_invoice_lines
           SET product_id = v_laser_keep_id
         WHERE product_id = v_laser_drop_id;
    END IF;

    IF v_bomba_keep_id IS NOT NULL AND array_length(v_bomba_drop_ids, 1) > 0 THEN
        UPDATE erp.purchase_invoice_lines
           SET product_id = v_bomba_keep_id
         WHERE product_id = ANY(v_bomba_drop_ids);
    END IF;

    WITH dup_purchase_lines AS (
        SELECT
            purchase_id,
            product_id,
            unit_cost_pen,
            MIN(purchase_line_id) AS keep_line_id,
            SUM(quantity) AS total_qty,
            SUM(line_total_pen) AS total_pen
        FROM erp.purchase_invoice_lines
        WHERE product_id IN (v_bufalo_keep_id, v_laser_keep_id)
        GROUP BY purchase_id, product_id, unit_cost_pen
        HAVING COUNT(*) > 1
    ),
    drop_purchase_lines AS (
        SELECT pil.purchase_line_id AS drop_line_id, d.keep_line_id
        FROM erp.purchase_invoice_lines pil
        JOIN dup_purchase_lines d
          ON pil.purchase_id = d.purchase_id
         AND pil.product_id = d.product_id
         AND pil.unit_cost_pen = d.unit_cost_pen
         AND pil.purchase_line_id <> d.keep_line_id
    )
    UPDATE erp.sales_order_lines sol
       SET fulfilling_purchase_line_id = dp.keep_line_id
      FROM drop_purchase_lines dp
     WHERE sol.fulfilling_purchase_line_id = dp.drop_line_id;

    WITH dup_purchase_lines AS (
        SELECT
            purchase_id,
            product_id,
            unit_cost_pen,
            MIN(purchase_line_id) AS keep_line_id,
            SUM(quantity) AS total_qty,
            SUM(line_total_pen) AS total_pen
        FROM erp.purchase_invoice_lines
        WHERE product_id IN (v_bufalo_keep_id, v_laser_keep_id)
        GROUP BY purchase_id, product_id, unit_cost_pen
        HAVING COUNT(*) > 1
    )
    UPDATE erp.purchase_invoice_lines pil
       SET quantity = d.total_qty,
           line_total_pen = d.total_pen
      FROM dup_purchase_lines d
     WHERE pil.purchase_line_id = d.keep_line_id;

    WITH dup_purchase_lines AS (
        SELECT
            purchase_id,
            product_id,
            unit_cost_pen,
            MIN(purchase_line_id) AS keep_line_id
        FROM erp.purchase_invoice_lines
        WHERE product_id IN (v_bufalo_keep_id, v_laser_keep_id)
        GROUP BY purchase_id, product_id, unit_cost_pen
        HAVING COUNT(*) > 1
    )
    DELETE FROM erp.purchase_invoice_lines pil
     USING dup_purchase_lines d
     WHERE pil.purchase_id = d.purchase_id
       AND pil.product_id = d.product_id
       AND pil.unit_cost_pen = d.unit_cost_pen
       AND pil.purchase_line_id <> d.keep_line_id;

    IF v_bufalo_keep_id IS NOT NULL THEN
        UPDATE erp.purchase_invoice_lines
           SET raw_description = 'CALIPER PARA TOYOTA BUFALO'
         WHERE product_id = v_bufalo_keep_id
           AND raw_description IS DISTINCT FROM 'CALIPER PARA TOYOTA BUFALO';
    END IF;

    IF v_laser_keep_id IS NOT NULL THEN
        UPDATE erp.purchase_invoice_lines
           SET raw_description = 'CALIPER PARA TOYOTA 57-25'
         WHERE product_id = v_laser_keep_id
           AND raw_description IS DISTINCT FROM 'CALIPER PARA TOYOTA 57-25';
    END IF;

    -- 5. Reassign & consolidate erp.inventory_movements
    IF v_bufalo_keep_id IS NOT NULL AND v_bufalo_drop_id IS NOT NULL THEN
        UPDATE erp.inventory_movements
           SET product_id = v_bufalo_keep_id
         WHERE product_id = v_bufalo_drop_id;
    END IF;

    IF v_laser_keep_id IS NOT NULL AND v_laser_drop_id IS NOT NULL THEN
        UPDATE erp.inventory_movements
           SET product_id = v_laser_keep_id
         WHERE product_id = v_laser_drop_id;
    END IF;

    IF v_bomba_keep_id IS NOT NULL AND array_length(v_bomba_drop_ids, 1) > 0 THEN
        UPDATE erp.inventory_movements
           SET product_id = v_bomba_keep_id
         WHERE product_id = ANY(v_bomba_drop_ids);
    END IF;

    WITH dup_inv_in AS (
        SELECT
            warehouse_id,
            product_id,
            movement_date,
            COALESCE(reference_table, '') AS ref_table,
            COALESCE(reference_id, '') AS ref_id,
            unit_cost_pen,
            MIN(movement_id) AS keep_movement_id,
            SUM(quantity_delta) AS total_delta
        FROM erp.inventory_movements
        WHERE movement_type = 'PURCHASE_IN'
          AND product_id IN (v_bufalo_keep_id, v_laser_keep_id)
        GROUP BY warehouse_id, product_id, movement_date, COALESCE(reference_table, ''), COALESCE(reference_id, ''), unit_cost_pen
        HAVING COUNT(*) > 1
    )
    UPDATE erp.inventory_movements im
       SET quantity_delta = d.total_delta
      FROM dup_inv_in d
     WHERE im.movement_id = d.keep_movement_id;

    WITH dup_inv_in AS (
        SELECT
            warehouse_id,
            product_id,
            movement_date,
            COALESCE(reference_table, '') AS ref_table,
            COALESCE(reference_id, '') AS ref_id,
            unit_cost_pen,
            MIN(movement_id) AS keep_movement_id
        FROM erp.inventory_movements
        WHERE movement_type = 'PURCHASE_IN'
          AND product_id IN (v_bufalo_keep_id, v_laser_keep_id)
        GROUP BY warehouse_id, product_id, movement_date, COALESCE(reference_table, ''), COALESCE(reference_id, ''), unit_cost_pen
        HAVING COUNT(*) > 1
    )
    DELETE FROM erp.inventory_movements im
     USING dup_inv_in d
     WHERE im.movement_type = 'PURCHASE_IN'
       AND im.warehouse_id = d.warehouse_id
       AND im.product_id = d.product_id
       AND im.movement_date = d.movement_date
       AND COALESCE(im.reference_table, '') = d.ref_table
       AND COALESCE(im.reference_id, '') = d.ref_id
       AND im.unit_cost_pen IS NOT DISTINCT FROM d.unit_cost_pen
       AND im.movement_id <> d.keep_movement_id;

    IF v_laser_keep_id IS NOT NULL THEN
        UPDATE erp.inventory_movements
           SET unit_cost_pen = 80.5882
         WHERE product_id = v_laser_keep_id
           AND movement_type = 'SALE_OUT'
           AND unit_cost_pen = 81.1538;
    END IF;

    -- 6. Reassign & clean erp.product_aliases
    IF v_bufalo_keep_id IS NOT NULL AND v_bufalo_drop_id IS NOT NULL THEN
        UPDATE erp.product_aliases
           SET product_id = v_bufalo_keep_id
         WHERE product_id = v_bufalo_drop_id;
    END IF;

    IF v_laser_keep_id IS NOT NULL AND v_laser_drop_id IS NOT NULL THEN
        UPDATE erp.product_aliases
           SET product_id = v_laser_keep_id
         WHERE product_id = v_laser_drop_id;
    END IF;

    IF v_bomba_keep_id IS NOT NULL AND array_length(v_bomba_drop_ids, 1) > 0 THEN
        UPDATE erp.product_aliases
           SET product_id = v_bomba_keep_id
         WHERE product_id = ANY(v_bomba_drop_ids);
    END IF;

    UPDATE erp.product_aliases
       SET needs_review = FALSE
     WHERE alias_normalized IN ('CALIPER BUFALO', 'CALIPER 57-25', 'CALIPER 5725')
       AND needs_review = TRUE;

    IF v_bufalo_keep_id IS NOT NULL THEN
        INSERT INTO erp.product_aliases (product_id, alias_raw, alias_normalized, pack_factor, confidence, needs_review, source)
        VALUES (v_bufalo_keep_id, 'CALIPER PARA TOYOTA BUFALO', 'CALIPER PARA TOYOTA BUFALO', 1.0, 1.000, FALSE, 'MASTER_PRODUCTS')
        ON CONFLICT (alias_normalized) DO UPDATE SET
            product_id = EXCLUDED.product_id,
            needs_review = FALSE,
            confidence = 1.000,
            source = EXCLUDED.source;
    END IF;

    IF v_laser_keep_id IS NOT NULL THEN
        INSERT INTO erp.product_aliases (product_id, alias_raw, alias_normalized, pack_factor, confidence, needs_review, source)
        VALUES
            (v_laser_keep_id, '47730-20480', '47730-20480', 1.0, 1.000, FALSE, 'MASTER_SKU_CODE'),
            (v_laser_keep_id, 'CALIPER PARA TOYOTA 57-25', 'CALIPER PARA TOYOTA 57-25', 1.0, 1.000, FALSE, 'MASTER_PRODUCTS')
        ON CONFLICT (alias_normalized) DO UPDATE SET
            product_id = EXCLUDED.product_id,
            needs_review = FALSE,
            confidence = 1.000,
            source = EXCLUDED.source;
    END IF;

    -- 7. Delete obsolete side-specific SKUs (2 calipers + 2 brake pumps)
    DELETE FROM erp.products
     WHERE sku IN (
         '47750-26120',
         '47750-20480 R',
         '31410-20150 LEFT-NEW',
         '31410-20150 RIGHT-NEW'
     );

    -- 8. Record verified June 26, 2026 opening stock for D562-SET without duplicating FQQ1-115
    SELECT warehouse_id INTO v_main_wh_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1;
    SELECT product_id, COALESCE(ref_cost_pen, 7.7000)
      INTO v_d562_id, v_d562_cost
      FROM erp.products
     WHERE sku = 'D562-SET'
     LIMIT 1;

    IF v_main_wh_id IS NOT NULL AND v_d562_id IS NOT NULL THEN
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
            v_d562_id,
            TIMESTAMPTZ '2026-06-26 00:00:00-05',
            'OPENING',
            4210.0000,
            v_d562_cost,
            'raw_staging.opening_stock_2026_06_26',
            'STOCKS-2026-06-26:D562-SET',
            'HISTORICAL_BACKFILL',
            'Saldo inicial confirmado al 26/06/2026 (20614786851-STOCKS-CONSOLIDADO)',
            'OPENING_2026_06_26:D562-SET'
        )
        ON CONFLICT (source_row_hash) DO NOTHING;
    END IF;
END $$;
