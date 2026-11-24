-- 028_stock_quants_and_system_settings.sql
-- Adds:
--   1. Materialized O(1) stock balance table (erp.stock_quants) with initial backfill from
--      erp.inventory_movements and AFTER INSERT OR UPDATE OR DELETE trigger (erp.fn_sync_stock_quants).
--   2. Updates erp.v_current_stock and erp.fn_guard_negative_stock() to read from erp.stock_quants in O(1).
--   3. Dynamic ERP operational configuration table (erp.system_settings) with JSONB seed values
--      and SQL helper functions (erp.fn_get_setting_text, erp.fn_get_setting_numeric, erp.fn_get_setting_int,
--      erp.fn_get_setting_boolean, erp.fn_get_setting_date).
--   4. Retires legacy erp.app_users.pin_hash column (Neon Auth + password_hash remain authoritative).

-- ============================================================================
-- 1. Materialized O(1) Stock Quants & Trigger on erp.inventory_movements
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp.stock_quants (
    warehouse_id      BIGINT NOT NULL REFERENCES erp.warehouses(warehouse_id) ON DELETE CASCADE,
    product_id        BIGINT NOT NULL REFERENCES erp.products(product_id) ON DELETE CASCADE,
    qty_on_hand       NUMERIC(14,4) NOT NULL DEFAULT 0,
    qty_reserved      NUMERIC(14,4) NOT NULL DEFAULT 0,
    last_movement_at  TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (warehouse_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_quants_product
    ON erp.stock_quants (product_id, warehouse_id);

-- Idempotent backfill from erp.inventory_movements so qty_on_hand equals SUM(quantity_delta)
INSERT INTO erp.stock_quants (
    warehouse_id,
    product_id,
    qty_on_hand,
    qty_reserved,
    last_movement_at,
    updated_at
)
SELECT
    im.warehouse_id,
    im.product_id,
    COALESCE(SUM(im.quantity_delta), 0)::NUMERIC(14,4) AS qty_on_hand,
    0::NUMERIC(14,4) AS qty_reserved,
    MAX(im.movement_date) AS last_movement_at,
    NOW() AS updated_at
FROM erp.inventory_movements im
GROUP BY im.warehouse_id, im.product_id
ON CONFLICT (warehouse_id, product_id)
DO UPDATE SET
    qty_on_hand = EXCLUDED.qty_on_hand,
    last_movement_at = EXCLUDED.last_movement_at,
    updated_at = NOW();

CREATE OR REPLACE FUNCTION erp.fn_sync_stock_quants()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO erp.stock_quants (
            warehouse_id,
            product_id,
            qty_on_hand,
            qty_reserved,
            last_movement_at,
            updated_at
        )
        VALUES (
            NEW.warehouse_id,
            NEW.product_id,
            NEW.quantity_delta,
            0,
            NEW.movement_date,
            NOW()
        )
        ON CONFLICT (warehouse_id, product_id)
        DO UPDATE SET
            qty_on_hand = erp.stock_quants.qty_on_hand + EXCLUDED.qty_on_hand,
            last_movement_at = GREATEST(
                COALESCE(erp.stock_quants.last_movement_at, EXCLUDED.last_movement_at),
                EXCLUDED.last_movement_at
            ),
            updated_at = NOW();
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO erp.stock_quants (
            warehouse_id,
            product_id,
            qty_on_hand,
            qty_reserved,
            last_movement_at,
            updated_at
        )
        VALUES (
            OLD.warehouse_id,
            OLD.product_id,
            -OLD.quantity_delta,
            0,
            NULL,
            NOW()
        )
        ON CONFLICT (warehouse_id, product_id)
        DO UPDATE SET
            qty_on_hand = erp.stock_quants.qty_on_hand - OLD.quantity_delta,
            updated_at = NOW();
        RETURN OLD;

    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.warehouse_id = NEW.warehouse_id AND OLD.product_id = NEW.product_id THEN
            INSERT INTO erp.stock_quants (
                warehouse_id,
                product_id,
                qty_on_hand,
                qty_reserved,
                last_movement_at,
                updated_at
            )
            VALUES (
                NEW.warehouse_id,
                NEW.product_id,
                NEW.quantity_delta - OLD.quantity_delta,
                0,
                NEW.movement_date,
                NOW()
            )
            ON CONFLICT (warehouse_id, product_id)
            DO UPDATE SET
                qty_on_hand = erp.stock_quants.qty_on_hand + (NEW.quantity_delta - OLD.quantity_delta),
                last_movement_at = GREATEST(
                    COALESCE(erp.stock_quants.last_movement_at, NEW.movement_date),
                    NEW.movement_date
                ),
                updated_at = NOW();
        ELSE
            INSERT INTO erp.stock_quants (
                warehouse_id,
                product_id,
                qty_on_hand,
                qty_reserved,
                last_movement_at,
                updated_at
            )
            VALUES (
                OLD.warehouse_id,
                OLD.product_id,
                -OLD.quantity_delta,
                0,
                NULL,
                NOW()
            )
            ON CONFLICT (warehouse_id, product_id)
            DO UPDATE SET
                qty_on_hand = erp.stock_quants.qty_on_hand - OLD.quantity_delta,
                updated_at = NOW();

            INSERT INTO erp.stock_quants (
                warehouse_id,
                product_id,
                qty_on_hand,
                qty_reserved,
                last_movement_at,
                updated_at
            )
            VALUES (
                NEW.warehouse_id,
                NEW.product_id,
                NEW.quantity_delta,
                0,
                NEW.movement_date,
                NOW()
            )
            ON CONFLICT (warehouse_id, product_id)
            DO UPDATE SET
                qty_on_hand = erp.stock_quants.qty_on_hand + EXCLUDED.qty_on_hand,
                last_movement_at = GREATEST(
                    COALESCE(erp.stock_quants.last_movement_at, EXCLUDED.last_movement_at),
                    EXCLUDED.last_movement_at
                ),
                updated_at = NOW();
        END IF;
        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_stock_quants ON erp.inventory_movements;
CREATE TRIGGER trg_sync_stock_quants
    AFTER INSERT OR UPDATE OR DELETE ON erp.inventory_movements
    FOR EACH ROW EXECUTE FUNCTION erp.fn_sync_stock_quants();

-- ============================================================================
-- 2. Redefine erp.v_current_stock & erp.fn_guard_negative_stock() on stock_quants
-- ============================================================================

CREATE OR REPLACE VIEW erp.v_current_stock AS
SELECT
    w.warehouse_id,
    w.code AS warehouse_code,
    w.name AS warehouse_name,
    p.product_id,
    p.sku,
    p.name AS product_name,
    p.fulfillment_mode,
    COALESCE(sq.qty_on_hand, 0)::NUMERIC(14,4) AS stock_on_hand,
    sq.last_movement_at
FROM erp.warehouses w
CROSS JOIN erp.products p
LEFT JOIN erp.stock_quants sq
       ON sq.warehouse_id = w.warehouse_id
      AND sq.product_id = p.product_id
WHERE w.is_active = TRUE
  AND p.is_active = TRUE;

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

    SELECT COALESCE(sq.qty_on_hand, 0)::NUMERIC(14,4)
      INTO v_current_qty
      FROM erp.stock_quants sq
     WHERE sq.warehouse_id = NEW.warehouse_id
       AND sq.product_id = NEW.product_id;

    v_current_qty := COALESCE(v_current_qty, 0);
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
-- 3. Dynamic System Settings (JSONB) & SQL Helper Functions
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS erp.seq_system_settings_sync START 1;

CREATE TABLE IF NOT EXISTS erp.system_settings (
    setting_key         TEXT PRIMARY KEY,
    value_json          JSONB NOT NULL,
    value_type          TEXT NOT NULL DEFAULT 'string'
                            CHECK (value_type IN ('number', 'string', 'boolean', 'date', 'json')),
    label_es            TEXT NOT NULL DEFAULT '',
    description_es      TEXT NOT NULL DEFAULT '',
    updated_by_user_id  BIGINT REFERENCES erp.app_users(user_id),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_seq            BIGINT NOT NULL DEFAULT nextval('erp.seq_system_settings_sync')
);

DROP TRIGGER IF EXISTS trg_system_settings_sync_watermark ON erp.system_settings;
CREATE TRIGGER trg_system_settings_sync_watermark
    BEFORE INSERT OR UPDATE ON erp.system_settings
    FOR EACH ROW EXECUTE FUNCTION erp.fn_touch_generic_sync_watermark('erp.seq_system_settings_sync');

INSERT INTO erp.system_settings (
    setting_key,
    value_json,
    value_type,
    label_es,
    description_es
)
VALUES
    ('undo_window_minutes', '15'::jsonb, 'number', 'Ventana de deshacer (minutos)', 'Tiempo máximo en minutos para que usuarios no administradores deshagan sus propias acciones.'),
    ('default_credit_days', '7'::jsonb, 'number', 'Días de crédito por defecto', 'Plazo de crédito en días aplicado cuando el cliente no tiene plazo específico acordado.'),
    ('min_margin_pct', '20'::jsonb, 'number', 'Margen bruto mínimo (%)', 'Umbral porcentual de alerta para SKUs con margen bruto bajo.'),
    ('route_opex_alert_pct', '8'::jsonb, 'number', 'Alerta de gasto de ruta (%)', 'Porcentaje máximo de gasto operativo de ruta sobre ventas antes de activar alerta.'),
    ('drain_alert_pct', '30'::jsonb, 'number', 'Alerta de drenaje no operativo (%)', 'Porcentaje máximo de salidas no operativas/CAPEX frente a reinversión en mercadería.'),
    ('kpi_cutoff_date', '"2026-06-26"'::jsonb, 'date', 'Fecha de corte KPI operativo', 'Fecha de inicio del periodo operativo de ruta para vistas analíticas y P&L.'),
    ('credit_limit_mode', '"APPROVAL_GATE"'::jsonb, 'string', 'Modo de control de línea de crédito', 'Política al exceder límite de crédito (APPROVAL_GATE envía a cola de aprobación de socios).'),
    ('company_name', '"Blue Horizon Trade"'::jsonb, 'string', 'Nombre de la empresa', 'Razón social o nombre comercial mostrado en reportes y documentos.'),
    ('company_ruc', '""'::jsonb, 'string', 'RUC de la empresa', 'Número de RUC corporativo para documentos y exportaciones.')
ON CONFLICT (setting_key) DO NOTHING;

CREATE OR REPLACE FUNCTION erp.fn_get_setting_text(
    p_key      TEXT,
    p_fallback TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_val JSONB;
BEGIN
    SELECT s.value_json
      INTO v_val
      FROM erp.system_settings s
     WHERE s.setting_key = p_key;

    IF v_val IS NULL OR jsonb_typeof(v_val) = 'null' THEN
        RETURN p_fallback;
    END IF;

    IF jsonb_typeof(v_val) = 'string' THEN
        RETURN v_val #>> '{}';
    END IF;

    RETURN v_val::text;
END;
$$;

CREATE OR REPLACE FUNCTION erp.fn_get_setting_numeric(
    p_key      TEXT,
    p_fallback NUMERIC DEFAULT 0
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_raw TEXT;
BEGIN
    v_raw := erp.fn_get_setting_text(p_key, NULL);
    IF v_raw IS NULL OR BTRIM(v_raw) = '' THEN
        RETURN p_fallback;
    END IF;
    RETURN (BTRIM(v_raw))::numeric;
EXCEPTION
    WHEN OTHERS THEN
        RETURN p_fallback;
END;
$$;

CREATE OR REPLACE FUNCTION erp.fn_get_setting_int(
    p_key      TEXT,
    p_fallback INT DEFAULT 0
)
RETURNS INT
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN ROUND(erp.fn_get_setting_numeric(p_key, p_fallback))::int;
EXCEPTION
    WHEN OTHERS THEN
        RETURN p_fallback;
END;
$$;

CREATE OR REPLACE FUNCTION erp.fn_get_setting_boolean(
    p_key      TEXT,
    p_fallback BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_raw TEXT;
BEGIN
    v_raw := LOWER(BTRIM(COALESCE(erp.fn_get_setting_text(p_key, NULL), '')));
    IF v_raw IN ('true', '1', 'yes', 'on') THEN
        RETURN TRUE;
    ELSIF v_raw IN ('false', '0', 'no', 'off') THEN
        RETURN FALSE;
    END IF;
    RETURN p_fallback;
END;
$$;

CREATE OR REPLACE FUNCTION erp.fn_get_setting_date(
    p_key      TEXT,
    p_fallback DATE DEFAULT DATE '2026-06-26'
)
RETURNS DATE
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_raw TEXT;
BEGIN
    v_raw := erp.fn_get_setting_text(p_key, NULL);
    IF v_raw IS NULL OR BTRIM(v_raw) = '' THEN
        RETURN p_fallback;
    END IF;
    RETURN (BTRIM(v_raw))::date;
EXCEPTION
    WHEN OTHERS THEN
        RETURN p_fallback;
END;
$$;

-- ============================================================================
-- 4. Retire Legacy pin_hash Column from erp.app_users
-- ============================================================================

ALTER TABLE erp.app_users
    DROP COLUMN IF EXISTS pin_hash;
