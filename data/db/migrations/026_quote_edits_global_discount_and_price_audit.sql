-- 026_quote_edits_global_discount_and_price_audit.sql
-- Adds:
--   1. Editable quotes with immutable audit trail (erp.quote_audit_log) + global_discount_pen + updated_at/by
--   2. base_unit_price_pen on erp.quote_lines for catalog reference
--   3. global_discount_pen on erp.sales_orders for quote/order-level global discounts
--   4. Immutable erp.price_override_log recording every line price modification (rebaja or sobreprecio)
--      with actor, customer, product, catalog vs applied price, delta, date, and source document.

-- ============================================================================
-- 1. Global discount & edit metadata on quotes and sales orders
-- ============================================================================

ALTER TABLE erp.quotes
    ADD COLUMN IF NOT EXISTS global_discount_pen NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (global_discount_pen >= 0),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_by_user_id BIGINT REFERENCES erp.app_users(user_id);

ALTER TABLE erp.quote_lines
    ADD COLUMN IF NOT EXISTS base_unit_price_pen NUMERIC(12,4)
        CHECK (base_unit_price_pen IS NULL OR base_unit_price_pen >= 0);

UPDATE erp.quote_lines
SET base_unit_price_pen = unit_price_pen
WHERE base_unit_price_pen IS NULL;

ALTER TABLE erp.sales_orders
    ADD COLUMN IF NOT EXISTS global_discount_pen NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (global_discount_pen >= 0);

-- ============================================================================
-- 2. Immutable Quote Audit Log (mirrors erp.sales_order_audit_log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp.quote_audit_log (
    audit_id       BIGSERIAL PRIMARY KEY,
    quote_id       BIGINT NOT NULL REFERENCES erp.quotes(quote_id) ON DELETE RESTRICT,
    action         TEXT NOT NULL CHECK (action IN ('EDIT', 'STATUS_CHANGE', 'CONVERT')),
    actor_user_id  BIGINT NOT NULL REFERENCES erp.app_users(user_id),
    actor_role     TEXT NOT NULL,
    reason         TEXT NOT NULL CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
    before_data    JSONB NOT NULL,
    after_data     JSONB NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quote_audit_quote_created
    ON erp.quote_audit_log (quote_id, created_at DESC);

CREATE OR REPLACE FUNCTION erp.fn_keep_quote_audit_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'El historial de auditoría de cotizaciones es inmutable'
        USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_keep_quote_audit_immutable ON erp.quote_audit_log;
CREATE TRIGGER trg_keep_quote_audit_immutable
    BEFORE UPDATE OR DELETE ON erp.quote_audit_log
    FOR EACH ROW EXECUTE FUNCTION erp.fn_keep_quote_audit_immutable();

-- ============================================================================
-- 3. Immutable Price Override Audit Log (rebajas y sobreprecios por línea)
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp.price_override_log (
    override_id       BIGSERIAL PRIMARY KEY,
    entity_type       TEXT NOT NULL CHECK (entity_type IN ('ORDER', 'QUOTE')),
    entity_id         BIGINT NOT NULL,
    entity_code       TEXT NOT NULL,
    line_no           INT NOT NULL,
    product_id        BIGINT NOT NULL REFERENCES erp.products(product_id),
    sku               TEXT NOT NULL,
    product_name      TEXT NOT NULL,
    customer_party_id BIGINT REFERENCES erp.parties(party_id),
    customer_name     TEXT NOT NULL,
    catalog_price_pen NUMERIC(12,4) NOT NULL CHECK (catalog_price_pen >= 0),
    applied_price_pen NUMERIC(12,4) NOT NULL CHECK (applied_price_pen > 0),
    delta_pen         NUMERIC(12,4) NOT NULL,
    direction         TEXT NOT NULL CHECK (direction IN ('LOWER', 'HIGHER')),
    quantity          NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
    total_impact_pen  NUMERIC(14,2) NOT NULL,
    actor_user_id     BIGINT NOT NULL REFERENCES erp.app_users(user_id),
    actor_name        TEXT NOT NULL,
    actor_role        TEXT NOT NULL,
    reason            TEXT,
    event_date        DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Lima')::date,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_override_event_date
    ON erp.price_override_log (event_date DESC, override_id DESC);
CREATE INDEX IF NOT EXISTS idx_price_override_product
    ON erp.price_override_log (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_override_customer
    ON erp.price_override_log (customer_party_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_override_actor
    ON erp.price_override_log (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_override_entity
    ON erp.price_override_log (entity_type, entity_id);

CREATE OR REPLACE FUNCTION erp.fn_keep_price_override_log_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'El registro de modificaciones de precio es inmutable'
        USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_keep_price_override_log_immutable ON erp.price_override_log;
CREATE TRIGGER trg_keep_price_override_log_immutable
    BEFORE UPDATE OR DELETE ON erp.price_override_log
    FOR EACH ROW EXECUTE FUNCTION erp.fn_keep_price_override_log_immutable();
