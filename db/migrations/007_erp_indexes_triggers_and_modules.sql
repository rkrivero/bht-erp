-- 007_erp_indexes_triggers_and_modules.sql
-- Missing performance/FK indexes, automatic updated_at triggers, lock-free RBAC-isolated
-- realtime watermark sequences, and support columns for audit_flags / quotes / route_trips.

-- ============================================================================
-- 1. Lock-free Postgres Sequences for O(1) Realtime Watermarks
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS erp.seq_sales_orders_ops START 1;
CREATE SEQUENCE IF NOT EXISTS erp.seq_sales_orders_fin START 1;
CREATE SEQUENCE IF NOT EXISTS erp.seq_sales_order_lines_ops START 1;
CREATE SEQUENCE IF NOT EXISTS erp.seq_sales_order_lines_price START 1;
CREATE SEQUENCE IF NOT EXISTS erp.seq_sales_order_lines_cost START 1;
CREATE SEQUENCE IF NOT EXISTS erp.seq_products_ops START 1;
CREATE SEQUENCE IF NOT EXISTS erp.seq_products_price START 1;
CREATE SEQUENCE IF NOT EXISTS erp.seq_products_cost START 1;
CREATE SEQUENCE IF NOT EXISTS erp.seq_parties_sync START 1;
CREATE SEQUENCE IF NOT EXISTS erp.seq_cash_accounts_sync START 1;
CREATE SEQUENCE IF NOT EXISTS erp.seq_ap_obligations_sync START 1;
CREATE SEQUENCE IF NOT EXISTS erp.seq_app_users_sync START 1;
CREATE SEQUENCE IF NOT EXISTS erp.seq_quotes_sync START 1;
CREATE SEQUENCE IF NOT EXISTS erp.seq_route_trips_sync START 1;
CREATE SEQUENCE IF NOT EXISTS erp.seq_audit_flags_sync START 1;

-- ============================================================================
-- 2. Watermark Columns, Missing updated_at Columns & Module Support Columns
-- ============================================================================

ALTER TABLE erp.sales_orders
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS ops_seq BIGINT NOT NULL DEFAULT nextval('erp.seq_sales_orders_ops'),
    ADD COLUMN IF NOT EXISTS fin_seq BIGINT NOT NULL DEFAULT nextval('erp.seq_sales_orders_fin');

ALTER TABLE erp.sales_order_lines
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS ops_seq BIGINT NOT NULL DEFAULT nextval('erp.seq_sales_order_lines_ops'),
    ADD COLUMN IF NOT EXISTS price_seq BIGINT NOT NULL DEFAULT nextval('erp.seq_sales_order_lines_price'),
    ADD COLUMN IF NOT EXISTS cost_seq BIGINT NOT NULL DEFAULT nextval('erp.seq_sales_order_lines_cost');

ALTER TABLE erp.products
    ADD COLUMN IF NOT EXISTS ops_seq BIGINT NOT NULL DEFAULT nextval('erp.seq_products_ops'),
    ADD COLUMN IF NOT EXISTS price_seq BIGINT NOT NULL DEFAULT nextval('erp.seq_products_price'),
    ADD COLUMN IF NOT EXISTS cost_seq BIGINT NOT NULL DEFAULT nextval('erp.seq_products_cost');

ALTER TABLE erp.parties
    ADD COLUMN IF NOT EXISTS sync_seq BIGINT NOT NULL DEFAULT nextval('erp.seq_parties_sync');

ALTER TABLE erp.cash_accounts
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS sync_seq BIGINT NOT NULL DEFAULT nextval('erp.seq_cash_accounts_sync');

ALTER TABLE erp.ap_obligations
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS sync_seq BIGINT NOT NULL DEFAULT nextval('erp.seq_ap_obligations_sync');

ALTER TABLE erp.app_users
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS sync_seq BIGINT NOT NULL DEFAULT nextval('erp.seq_app_users_sync');

ALTER TABLE erp.quotes
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS sync_seq BIGINT NOT NULL DEFAULT nextval('erp.seq_quotes_sync');

ALTER TABLE erp.route_trips
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS sync_seq BIGINT NOT NULL DEFAULT nextval('erp.seq_route_trips_sync');

ALTER TABLE erp.audit_flags
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS sync_seq BIGINT NOT NULL DEFAULT nextval('erp.seq_audit_flags_sync'),
    ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS acknowledged_by TEXT,
    ADD COLUMN IF NOT EXISTS resolution_note TEXT;

-- ============================================================================
-- 3. Automatic updated_at & Column-Scoped Watermark Triggers
-- ============================================================================

CREATE OR REPLACE FUNCTION erp.fn_sync_sales_orders_watermark()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.updated_at := clock_timestamp();
        NEW.ops_seq := nextval('erp.seq_sales_orders_ops');
        NEW.fin_seq := nextval('erp.seq_sales_orders_fin');
        RETURN NEW;
    END IF;

    NEW.updated_at := GREATEST(clock_timestamp(), COALESCE(OLD.updated_at, clock_timestamp()) + interval '1 microsecond');

    IF OLD.operational_status IS DISTINCT FROM NEW.operational_status
       OR OLD.approved_at IS DISTINCT FROM NEW.approved_at
       OR OLD.picked_at IS DISTINCT FROM NEW.picked_at
       OR OLD.delivered_at IS DISTINCT FROM NEW.delivered_at
       OR OLD.notes IS DISTINCT FROM NEW.notes
       OR OLD.trip_id IS DISTINCT FROM NEW.trip_id
       OR OLD.warehouse_id IS DISTINCT FROM NEW.warehouse_id
       OR OLD.quote_id IS DISTINCT FROM NEW.quote_id
       OR OLD.source_origin IS DISTINCT FROM NEW.source_origin THEN
        NEW.ops_seq := nextval('erp.seq_sales_orders_ops');
    END IF;

    IF OLD.operational_status IS DISTINCT FROM NEW.operational_status
       OR OLD.total_pen IS DISTINCT FROM NEW.total_pen
       OR OLD.paid_pen IS DISTINCT FROM NEW.paid_pen
       OR OLD.balance_due_pen IS DISTINCT FROM NEW.balance_due_pen
       OR OLD.is_settled IS DISTINCT FROM NEW.is_settled
       OR OLD.promised_payment_date IS DISTINCT FROM NEW.promised_payment_date THEN
        NEW.fin_seq := nextval('erp.seq_sales_orders_fin');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_orders_sync_watermark ON erp.sales_orders;
CREATE TRIGGER trg_sales_orders_sync_watermark
BEFORE INSERT OR UPDATE ON erp.sales_orders
FOR EACH ROW EXECUTE FUNCTION erp.fn_sync_sales_orders_watermark();

CREATE OR REPLACE FUNCTION erp.fn_sync_sales_order_lines_watermark()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.updated_at := clock_timestamp();
        NEW.ops_seq := nextval('erp.seq_sales_order_lines_ops');
        NEW.price_seq := nextval('erp.seq_sales_order_lines_price');
        NEW.cost_seq := nextval('erp.seq_sales_order_lines_cost');
        RETURN NEW;
    END IF;

    NEW.updated_at := GREATEST(clock_timestamp(), COALESCE(OLD.updated_at, clock_timestamp()) + interval '1 microsecond');

    IF OLD.product_id IS DISTINCT FROM NEW.product_id
       OR OLD.raw_description IS DISTINCT FROM NEW.raw_description
       OR OLD.quantity IS DISTINCT FROM NEW.quantity
       OR OLD.pack_factor_applied IS DISTINCT FROM NEW.pack_factor_applied
       OR OLD.fulfillment_status IS DISTINCT FROM NEW.fulfillment_status
       OR OLD.fulfilling_purchase_line_id IS DISTINCT FROM NEW.fulfilling_purchase_line_id THEN
        NEW.ops_seq := nextval('erp.seq_sales_order_lines_ops');
    END IF;

    IF OLD.quantity IS DISTINCT FROM NEW.quantity
       OR OLD.base_unit_price_pen IS DISTINCT FROM NEW.base_unit_price_pen
       OR OLD.unit_discount_pen IS DISTINCT FROM NEW.unit_discount_pen
       OR OLD.unit_price_pen IS DISTINCT FROM NEW.unit_price_pen
       OR OLD.line_total_pen IS DISTINCT FROM NEW.line_total_pen THEN
        NEW.price_seq := nextval('erp.seq_sales_order_lines_price');
    END IF;

    IF OLD.unit_cost_snapshot_pen IS DISTINCT FROM NEW.unit_cost_snapshot_pen THEN
        NEW.cost_seq := nextval('erp.seq_sales_order_lines_cost');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_order_lines_sync_watermark ON erp.sales_order_lines;
CREATE TRIGGER trg_sales_order_lines_sync_watermark
BEFORE INSERT OR UPDATE ON erp.sales_order_lines
FOR EACH ROW EXECUTE FUNCTION erp.fn_sync_sales_order_lines_watermark();

CREATE OR REPLACE FUNCTION erp.fn_sync_products_watermark()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.updated_at := clock_timestamp();
        NEW.ops_seq := nextval('erp.seq_products_ops');
        NEW.price_seq := nextval('erp.seq_products_price');
        NEW.cost_seq := nextval('erp.seq_products_cost');
        RETURN NEW;
    END IF;

    NEW.updated_at := GREATEST(clock_timestamp(), COALESCE(OLD.updated_at, clock_timestamp()) + interval '1 microsecond');

    IF OLD.sku IS DISTINCT FROM NEW.sku
       OR OLD.name IS DISTINCT FROM NEW.name
       OR OLD.unit_of_measure IS DISTINCT FROM NEW.unit_of_measure
       OR OLD.fulfillment_mode IS DISTINCT FROM NEW.fulfillment_mode
       OR OLD.is_active IS DISTINCT FROM NEW.is_active THEN
        NEW.ops_seq := nextval('erp.seq_products_ops');
    END IF;

    IF OLD.list_sale_price_pen IS DISTINCT FROM NEW.list_sale_price_pen
       OR OLD.min_sale_price_pen IS DISTINCT FROM NEW.min_sale_price_pen THEN
        NEW.price_seq := nextval('erp.seq_products_price');
    END IF;

    IF OLD.ref_cost_pen IS DISTINCT FROM NEW.ref_cost_pen
       OR OLD.cost_source IS DISTINCT FROM NEW.cost_source THEN
        NEW.cost_seq := nextval('erp.seq_products_cost');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_sync_watermark ON erp.products;
CREATE TRIGGER trg_products_sync_watermark
BEFORE INSERT OR UPDATE ON erp.products
FOR EACH ROW EXECUTE FUNCTION erp.fn_sync_products_watermark();

CREATE OR REPLACE FUNCTION erp.fn_touch_generic_sync_watermark()
RETURNS TRIGGER AS $$
DECLARE
    seq_name TEXT := TG_ARGV[0];
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.updated_at := clock_timestamp();
    ELSE
        NEW.updated_at := GREATEST(clock_timestamp(), COALESCE(OLD.updated_at, clock_timestamp()) + interval '1 microsecond');
    END IF;
    NEW.sync_seq := nextval(seq_name::regclass);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_parties_sync_watermark ON erp.parties;
CREATE TRIGGER trg_parties_sync_watermark
BEFORE INSERT OR UPDATE ON erp.parties
FOR EACH ROW EXECUTE FUNCTION erp.fn_touch_generic_sync_watermark('erp.seq_parties_sync');

DROP TRIGGER IF EXISTS trg_cash_accounts_sync_watermark ON erp.cash_accounts;
CREATE TRIGGER trg_cash_accounts_sync_watermark
BEFORE INSERT OR UPDATE ON erp.cash_accounts
FOR EACH ROW EXECUTE FUNCTION erp.fn_touch_generic_sync_watermark('erp.seq_cash_accounts_sync');

DROP TRIGGER IF EXISTS trg_ap_obligations_sync_watermark ON erp.ap_obligations;
CREATE TRIGGER trg_ap_obligations_sync_watermark
BEFORE INSERT OR UPDATE ON erp.ap_obligations
FOR EACH ROW EXECUTE FUNCTION erp.fn_touch_generic_sync_watermark('erp.seq_ap_obligations_sync');

DROP TRIGGER IF EXISTS trg_app_users_sync_watermark ON erp.app_users;
CREATE TRIGGER trg_app_users_sync_watermark
BEFORE INSERT OR UPDATE ON erp.app_users
FOR EACH ROW EXECUTE FUNCTION erp.fn_touch_generic_sync_watermark('erp.seq_app_users_sync');

DROP TRIGGER IF EXISTS trg_quotes_sync_watermark ON erp.quotes;
CREATE TRIGGER trg_quotes_sync_watermark
BEFORE INSERT OR UPDATE ON erp.quotes
FOR EACH ROW EXECUTE FUNCTION erp.fn_touch_generic_sync_watermark('erp.seq_quotes_sync');

DROP TRIGGER IF EXISTS trg_route_trips_sync_watermark ON erp.route_trips;
CREATE TRIGGER trg_route_trips_sync_watermark
BEFORE INSERT OR UPDATE ON erp.route_trips
FOR EACH ROW EXECUTE FUNCTION erp.fn_touch_generic_sync_watermark('erp.seq_route_trips_sync');

DROP TRIGGER IF EXISTS trg_audit_flags_sync_watermark ON erp.audit_flags;
CREATE TRIGGER trg_audit_flags_sync_watermark
BEFORE INSERT OR UPDATE ON erp.audit_flags
FOR EACH ROW EXECUTE FUNCTION erp.fn_touch_generic_sync_watermark('erp.seq_audit_flags_sync');

-- ============================================================================
-- 4. Missing FK, Query & Watermark Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sales_order_lines_product
    ON erp.sales_order_lines (product_id);

CREATE INDEX IF NOT EXISTS idx_sales_orders_status_origin_date
    ON erp.sales_orders (operational_status, source_origin, order_date DESC, order_id DESC);

CREATE INDEX IF NOT EXISTS idx_sales_orders_trip
    ON erp.sales_orders (trip_id)
    WHERE trip_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_orders_quote
    ON erp.sales_orders (quote_id)
    WHERE quote_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ap_obligations_supplier_status
    ON erp.ap_obligations (supplier_party_id, status);

CREATE INDEX IF NOT EXISTS idx_ap_obligations_purchase
    ON erp.ap_obligations (purchase_id)
    WHERE purchase_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_ledger_account_date
    ON erp.cash_ledger (account_id, tx_date DESC, ledger_id DESC);

CREATE INDEX IF NOT EXISTS idx_cash_ledger_ref
    ON erp.cash_ledger (reference_table, reference_id);

CREATE INDEX IF NOT EXISTS idx_purchase_invoice_lines_product
    ON erp.purchase_invoice_lines (product_id);

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier
    ON erp.purchase_invoices (supplier_party_id);

CREATE INDEX IF NOT EXISTS idx_quote_lines_product
    ON erp.quote_lines (product_id);

CREATE INDEX IF NOT EXISTS idx_quotes_customer
    ON erp.quotes (customer_party_id)
    WHERE customer_party_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_flags_status_created
    ON erp.audit_flags (status, created_at DESC);

-- O(1) index scans for MAX(seq) watermarks
CREATE INDEX IF NOT EXISTS idx_sales_orders_ops_seq ON erp.sales_orders (ops_seq DESC);
CREATE INDEX IF NOT EXISTS idx_sales_orders_fin_seq ON erp.sales_orders (fin_seq DESC);
CREATE INDEX IF NOT EXISTS idx_sales_order_lines_ops_seq ON erp.sales_order_lines (ops_seq DESC);
CREATE INDEX IF NOT EXISTS idx_sales_order_lines_price_seq ON erp.sales_order_lines (price_seq DESC);
CREATE INDEX IF NOT EXISTS idx_sales_order_lines_cost_seq ON erp.sales_order_lines (cost_seq DESC);
CREATE INDEX IF NOT EXISTS idx_products_ops_seq ON erp.products (ops_seq DESC);
CREATE INDEX IF NOT EXISTS idx_products_price_seq ON erp.products (price_seq DESC);
CREATE INDEX IF NOT EXISTS idx_products_cost_seq ON erp.products (cost_seq DESC);
CREATE INDEX IF NOT EXISTS idx_parties_type_sync_seq ON erp.parties (party_type, sync_seq DESC);
CREATE INDEX IF NOT EXISTS idx_ap_obligations_sync_seq ON erp.ap_obligations (sync_seq DESC);
CREATE INDEX IF NOT EXISTS idx_cash_accounts_sync_seq ON erp.cash_accounts (sync_seq DESC);
CREATE INDEX IF NOT EXISTS idx_app_users_sync_seq ON erp.app_users (sync_seq DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_sync_seq ON erp.quotes (sync_seq DESC);
CREATE INDEX IF NOT EXISTS idx_route_trips_sync_seq ON erp.route_trips (sync_seq DESC);
CREATE INDEX IF NOT EXISTS idx_audit_flags_sync_seq ON erp.audit_flags (sync_seq DESC);
