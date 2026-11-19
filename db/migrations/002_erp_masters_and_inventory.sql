-- 002_erp_masters_and_inventory.sql
-- Master data (parties, products, warehouses), audit flags, inventory ledger, and dual-mode stock guard.

-- ============================================================================
-- Parties (Customers, Suppliers, Partners/Employees) & Aliases
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp.parties (
    party_id        BIGSERIAL PRIMARY KEY,
    canonical_key   TEXT NOT NULL UNIQUE,
    party_type      erp.party_type NOT NULL DEFAULT 'CUSTOMER',
    doc_type        erp.doc_id_type NOT NULL DEFAULT 'NONE',
    doc_number      TEXT,
    is_generic_doc  BOOLEAN NOT NULL DEFAULT FALSE,
    legal_name      TEXT NOT NULL,
    trade_name      TEXT,
    phone           TEXT,
    email           TEXT,
    address         TEXT,
    city_zone       TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    source_origin   erp.data_origin NOT NULL DEFAULT 'ERP_APP',
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce uniqueness ONLY on genuine tax/national IDs; generic placeholders (00000015, etc.)
-- appear repeatedly for distinct people in legacy ENTIDADES exports.
CREATE UNIQUE INDEX IF NOT EXISTS uq_parties_real_doc
    ON erp.parties (doc_type, doc_number)
    WHERE doc_number IS NOT NULL AND is_generic_doc = FALSE;

CREATE INDEX IF NOT EXISTS idx_parties_type_name
    ON erp.parties (party_type, legal_name);

CREATE TABLE IF NOT EXISTS erp.party_aliases (
    alias_id          BIGSERIAL PRIMARY KEY,
    party_id          BIGINT NOT NULL REFERENCES erp.parties(party_id) ON DELETE CASCADE,
    alias_raw         TEXT NOT NULL,
    alias_normalized  TEXT NOT NULL UNIQUE,
    confidence        NUMERIC(4,3) NOT NULL DEFAULT 1.000 CHECK (confidence >= 0 AND confidence <= 1),
    needs_review      BOOLEAN NOT NULL DEFAULT FALSE,
    source            TEXT NOT NULL DEFAULT 'CONFIG_MAP',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Products & Aliases (with STOCKED vs ON_DEMAND fulfillment policy)
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp.products (
    product_id           BIGSERIAL PRIMARY KEY,
    sku                  TEXT NOT NULL UNIQUE,
    name                 TEXT NOT NULL,
    category             TEXT,
    unit_of_measure      TEXT NOT NULL DEFAULT 'NIU',
    fulfillment_mode     erp.fulfillment_mode NOT NULL DEFAULT 'STOCKED',
    list_sale_price_pen  NUMERIC(12,4) CHECK (list_sale_price_pen IS NULL OR list_sale_price_pen >= 0),
    ref_cost_pen         NUMERIC(12,4) CHECK (ref_cost_pen IS NULL OR ref_cost_pen >= 0),
    cost_source          TEXT NOT NULL DEFAULT 'MISSING',
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    source_origin        erp.data_origin NOT NULL DEFAULT 'ERP_APP',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS erp.product_aliases (
    alias_id          BIGSERIAL PRIMARY KEY,
    product_id        BIGINT NOT NULL REFERENCES erp.products(product_id) ON DELETE CASCADE,
    alias_raw         TEXT NOT NULL,
    alias_normalized  TEXT NOT NULL UNIQUE,
    pack_factor       NUMERIC(12,4) NOT NULL DEFAULT 1.0 CHECK (pack_factor > 0),
    confidence        NUMERIC(4,3) NOT NULL DEFAULT 1.000 CHECK (confidence >= 0 AND confidence <= 1),
    needs_review      BOOLEAN NOT NULL DEFAULT FALSE,
    source            TEXT NOT NULL DEFAULT 'CONFIG_MAP',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Warehouses & Audit Flags
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp.warehouses (
    warehouse_id          BIGSERIAL PRIMARY KEY,
    code                  TEXT NOT NULL UNIQUE,
    name                  TEXT NOT NULL,
    warehouse_type        TEXT NOT NULL DEFAULT 'FIXED',
    allow_negative_stock  BOOLEAN NOT NULL DEFAULT FALSE,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO erp.warehouses (code, name, warehouse_type, allow_negative_stock)
VALUES
    ('MAIN', 'Almacen Principal Lima', 'FIXED', FALSE),
    ('CAMIONETA_01', 'Unidad Movil Ruta 01', 'MOBILE_CAMIONETA', FALSE)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS erp.audit_flags (
    flag_id        BIGSERIAL PRIMARY KEY,
    flag_code      TEXT NOT NULL,
    severity       erp.audit_severity NOT NULL DEFAULT 'WARNING',
    entity_table   TEXT NOT NULL,
    entity_id      TEXT NOT NULL,
    message        TEXT NOT NULL,
    details        JSONB NOT NULL DEFAULT '{}'::jsonb,
    status         TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
    source_origin  erp.data_origin NOT NULL DEFAULT 'ERP_APP',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at    TIMESTAMPTZ,
    resolved_by    TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_flags_open_dedup
    ON erp.audit_flags (flag_code, entity_table, entity_id)
    WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS idx_audit_flags_status_code
    ON erp.audit_flags (status, flag_code, severity);

-- ============================================================================
-- Inventory Ledger & Dual-Mode Stock Guard
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp.inventory_movements (
    movement_id      BIGSERIAL PRIMARY KEY,
    warehouse_id     BIGINT NOT NULL REFERENCES erp.warehouses(warehouse_id),
    product_id       BIGINT NOT NULL REFERENCES erp.products(product_id),
    movement_date    TIMESTAMPTZ NOT NULL,
    movement_type    erp.movement_type NOT NULL,
    quantity_delta   NUMERIC(14,4) NOT NULL CHECK (quantity_delta <> 0),
    unit_cost_pen    NUMERIC(12,4) CHECK (unit_cost_pen IS NULL OR unit_cost_pen >= 0),
    reference_table  TEXT,
    reference_id     TEXT,
    source_origin    erp.data_origin NOT NULL DEFAULT 'ERP_APP',
    notes            TEXT,
    source_row_hash  TEXT UNIQUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_movements_wh_prod_date
    ON erp.inventory_movements (warehouse_id, product_id, movement_date);

CREATE OR REPLACE VIEW erp.v_current_stock AS
SELECT
    w.warehouse_id,
    w.code AS warehouse_code,
    w.name AS warehouse_name,
    p.product_id,
    p.sku,
    p.name AS product_name,
    p.fulfillment_mode,
    COALESCE(SUM(im.quantity_delta), 0)::NUMERIC(14,4) AS stock_on_hand,
    MAX(im.movement_date) AS last_movement_at
FROM erp.warehouses w
CROSS JOIN erp.products p
LEFT JOIN erp.inventory_movements im
       ON im.warehouse_id = w.warehouse_id
      AND im.product_id = p.product_id
WHERE w.is_active = TRUE
  AND p.is_active = TRUE
GROUP BY w.warehouse_id, w.code, w.name, p.product_id, p.sku, p.name, p.fulfillment_mode;

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
        IF v_mode = 'STOCKED' THEN
            RAISE EXCEPTION
                'Insufficient stock for STOCKED SKU % (warehouse_id=%, on_hand=%, delta=%, resulting=%)',
                v_sku, NEW.warehouse_id, v_current_qty, NEW.quantity_delta, v_resulting_qty
                USING ERRCODE = 'check_violation';
        ELSE
            -- ON_DEMAND products are permitted to sell at 0/negative stock; emit open operational alert.
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
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_negative_stock ON erp.inventory_movements;
CREATE TRIGGER trg_guard_negative_stock
    BEFORE INSERT ON erp.inventory_movements
    FOR EACH ROW
    EXECUTE FUNCTION erp.fn_guard_negative_stock();
