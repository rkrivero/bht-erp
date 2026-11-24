-- 025_close_historical_quotes_through_sep29.sql
-- Marks historical quotes up to 2026-09-29 (which correspond to sales already
-- recorded and delivered in erp.sales_orders from EXEL BLUE HORIZON.xlsx) as CONVERTED,
-- leaving OPEN only the 68 quotes from October-November 2026 (2026-10-01 to 2026-11-12).

DO $$
DECLARE
    v_updated_count INT := 0;
BEGIN
    UPDATE erp.quotes
       SET status = 'CONVERTED',
           notes = CASE
               WHEN COALESCE(notes, '') LIKE '%Cerrada automáticamente (<= 29/09/2026)%' THEN notes
               ELSE TRIM(BOTH ' |' FROM COALESCE(notes || ' | ', '') || 'Cerrada automáticamente (<= 29/09/2026): venta registrada en pedidos históricos')
           END,
           updated_at = NOW()
     WHERE source_origin = 'HISTORICAL_BACKFILL'
       AND issue_date <= DATE '2026-09-29'
       AND status = 'OPEN';

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

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
        'HISTORICAL_QUOTES_THROUGH_SEP29_CONVERTED',
        'INFO',
        'erp.quotes',
        'CUTOFF:2026-09-29',
        'Marcadas como CONVERTED las 134 cotizaciones históricas hasta el 29/09/2026 (ya registradas como pedidos entregados en EXEL 2026), quedando OPEN solo las 68 cotizaciones de oct-nov 2026.',
        jsonb_build_object(
            'cutoff_date', '2026-09-29',
            'converted_quotes_through_sep29', 138,
            'remaining_open_quotes_oct_nov', 68,
            'updated_in_run', v_updated_count
        ),
        'RESOLVED',
        'HISTORICAL_BACKFILL',
        NOW(),
        'MIGRATION_025'
    WHERE NOT EXISTS (
        SELECT 1
        FROM erp.audit_flags
        WHERE flag_code = 'HISTORICAL_QUOTES_THROUGH_SEP29_CONVERTED'
          AND entity_table = 'erp.quotes'
          AND entity_id = 'CUTOFF:2026-09-29'
    );
END $$;
