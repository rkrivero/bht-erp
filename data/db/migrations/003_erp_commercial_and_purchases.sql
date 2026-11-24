-- 003_erp_commercial_and_purchases.sql
-- Cash accounts, route trips, deduplicated purchases, quotes, sales orders, and ON_DEMAND alert triggers.

-- ============================================================================
-- Cash Accounts & Route Trips
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp.cash_accounts (
    account_id          BIGSERIAL PRIMARY KEY,
    code                TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    account_type        TEXT NOT NULL CHECK (account_type IN ('BANK', 'CASH_BOX', 'WALLET', 'PARTNER_CUSTODY')),
    currency            TEXT NOT NULL DEFAULT 'PEN' CHECK (currency IN ('PEN', 'USD')),
    custodian_party_id  BIGINT REFERENCES erp.parties(party_id),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO erp.cash_accounts (code, name, account_type, currency)
VALUES
    ('CAJA_RUTA', 'Caja Efectivo de Ruta', 'CASH_BOX', 'PEN'),
    ('CAJA_GENERAL', 'Caja General Oficina', 'CASH_BOX', 'PEN'),
    ('INTERBANK_BHT', 'Cuenta Interbank BHT', 'BANK', 'PEN'),
    ('BCP_BHT', 'Cuenta BCP BHT', 'BANK', 'PEN'),
    ('YAPE_PLIN_BHT', 'Billetera Digital Yape/Plin BHT', 'WALLET', 'PEN'),
    ('CUSTODIA_SAMUEL', 'Efectivo en Custodia Samuel', 'PARTNER_CUSTODY', 'PEN')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS erp.route_trips (
    trip_id                    BIGSERIAL PRIMARY KEY,
    trip_code                  TEXT NOT NULL UNIQUE,
    trip_date                  DATE NOT NULL,
    end_date                   DATE,
    zone_name                  TEXT,
    driver_name                TEXT,
    warehouse_id               BIGINT NOT NULL REFERENCES erp.warehouses(warehouse_id),
    cash_account_id            BIGINT REFERENCES erp.cash_accounts(account_id),
    status                     erp.trip_status NOT NULL DEFAULT 'OPEN',
    declared_gross_sales_pen   NUMERIC(14,2),
    declared_route_opex_pen    NUMERIC(14,2),
    declared_net_cash_pen      NUMERIC(14,2),
    source_origin              erp.data_origin NOT NULL DEFAULT 'ERP_APP',
    source_sheet               TEXT,
    notes                      TEXT,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_trips_date ON erp.route_trips (trip_date);

-- ============================================================================
-- Purchase Invoices & Lines (Deduplicated Across Monthly Excels & JSON)
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp.purchase_invoices (
    purchase_id            BIGSERIAL PRIMARY KEY,
    supplier_party_id      BIGINT REFERENCES erp.parties(party_id),
    supplier_ruc           TEXT NOT NULL,
    supplier_name_raw      TEXT,
    doc_type               TEXT NOT NULL,
    doc_series             TEXT NOT NULL,
    doc_number             TEXT NOT NULL,
    issue_date             DATE NOT NULL,
    due_date               DATE,
    orig_currency          TEXT NOT NULL DEFAULT 'PEN' CHECK (orig_currency IN ('PEN', 'USD')),
    exchange_rate          NUMERIC(10,4) NOT NULL DEFAULT 1.0 CHECK (exchange_rate > 0),
    subtotal_pen           NUMERIC(14,2) CHECK (subtotal_pen IS NULL OR subtotal_pen >= 0),
    igv_pen                NUMERIC(14,2) CHECK (igv_pen IS NULL OR igv_pen >= 0),
    total_pen              NUMERIC(14,2) NOT NULL CHECK (total_pen >= 0),
    orig_total             NUMERIC(14,2),
    expense_bucket         erp.expense_bucket NOT NULL,
    expense_category       TEXT NOT NULL,
    currency_anomaly_flag  BOOLEAN NOT NULL DEFAULT FALSE,
    has_itemized_lines     BOOLEAN NOT NULL DEFAULT FALSE,
    source_origin          erp.data_origin NOT NULL DEFAULT 'ERP_APP',
    source_file            TEXT,
    raw_notes              TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_purchase_invoice_doc UNIQUE (supplier_ruc, doc_type, doc_series, doc_number)
);

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_date_bucket
    ON erp.purchase_invoices (issue_date, expense_bucket);

CREATE TABLE IF NOT EXISTS erp.purchase_invoice_lines (
    purchase_line_id  BIGSERIAL PRIMARY KEY,
    purchase_id       BIGINT NOT NULL REFERENCES erp.purchase_invoices(purchase_id) ON DELETE CASCADE,
    line_no           INT NOT NULL,
    product_id        BIGINT REFERENCES erp.products(product_id),
    raw_description   TEXT NOT NULL,
    unit_of_measure   TEXT DEFAULT 'NIU',
    quantity          NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
    unit_cost_pen     NUMERIC(12,4) NOT NULL CHECK (unit_cost_pen >= 0),
    line_total_pen    NUMERIC(14,2) NOT NULL CHECK (line_total_pen >= 0),
    anomaly_flag      BOOLEAN NOT NULL DEFAULT FALSE,
    source_origin     erp.data_origin NOT NULL DEFAULT 'ERP_APP',
    source_row_hash   TEXT UNIQUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (purchase_id, line_no)
);

-- ============================================================================
-- Quotes & Quote Lines
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp.quotes (
    quote_id           BIGSERIAL PRIMARY KEY,
    quote_code         TEXT NOT NULL UNIQUE,
    issue_date         DATE NOT NULL,
    customer_party_id  BIGINT REFERENCES erp.parties(party_id),
    customer_name_raw  TEXT,
    currency           TEXT NOT NULL DEFAULT 'PEN' CHECK (currency IN ('PEN', 'USD')),
    tax_regime         TEXT NOT NULL DEFAULT 'EXONERADA',
    total_pen          NUMERIC(14,2) NOT NULL CHECK (total_pen >= 0),
    status             erp.quote_status NOT NULL DEFAULT 'OPEN',
    related_cpe        TEXT,
    seller_name        TEXT,
    source_origin      erp.data_origin NOT NULL DEFAULT 'ERP_APP',
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_date_status ON erp.quotes (issue_date, status);

CREATE TABLE IF NOT EXISTS erp.quote_lines (
    quote_line_id    BIGSERIAL PRIMARY KEY,
    quote_id         BIGINT NOT NULL REFERENCES erp.quotes(quote_id) ON DELETE CASCADE,
    line_no          INT NOT NULL,
    product_id       BIGINT REFERENCES erp.products(product_id),
    raw_description  TEXT NOT NULL,
    quantity         NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
    unit_price_pen   NUMERIC(12,4) NOT NULL CHECK (unit_price_pen >= 0),
    line_total_pen   NUMERIC(14,2) NOT NULL CHECK (line_total_pen >= 0),
    UNIQUE (quote_id, line_no)
);

-- ============================================================================
-- Sales Orders & Sales Order Lines (with chk_line_math & ON_DEMAND alerts)
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp.sales_orders (
    order_id                   BIGSERIAL PRIMARY KEY,
    order_code                 TEXT NOT NULL UNIQUE,
    order_date                 DATE NOT NULL,
    trip_id                    BIGINT REFERENCES erp.route_trips(trip_id),
    warehouse_id               BIGINT NOT NULL REFERENCES erp.warehouses(warehouse_id),
    customer_party_id          BIGINT REFERENCES erp.parties(party_id),
    customer_name_raw          TEXT NOT NULL,
    quote_id                   BIGINT REFERENCES erp.quotes(quote_id),
    payment_mode               erp.payment_mode NOT NULL,
    historical_status_assumed  BOOLEAN NOT NULL DEFAULT FALSE,
    payment_status_raw         TEXT,
    doc_ref                    TEXT,
    total_pen                  NUMERIC(14,2) NOT NULL CHECK (total_pen >= 0),
    paid_pen                   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_pen >= 0),
    balance_due_pen            NUMERIC(14,2) GENERATED ALWAYS AS (GREATEST(total_pen - paid_pen, 0)) STORED,
    is_settled                 BOOLEAN GENERATED ALWAYS AS (paid_pen >= total_pen - 0.05) STORED,
    due_date                   DATE,
    source_origin              erp.data_origin NOT NULL DEFAULT 'ERP_APP',
    source_file                TEXT,
    source_sheet               TEXT,
    source_row_num             INT,
    source_row_hash            TEXT UNIQUE,
    notes                      TEXT,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_orders_date_mode
    ON erp.sales_orders (order_date, payment_mode, is_settled);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer
    ON erp.sales_orders (customer_party_id);

CREATE TABLE IF NOT EXISTS erp.sales_order_lines (
    order_line_id               BIGSERIAL PRIMARY KEY,
    order_id                    BIGINT NOT NULL REFERENCES erp.sales_orders(order_id) ON DELETE CASCADE,
    line_no                     INT NOT NULL,
    product_id                  BIGINT NOT NULL REFERENCES erp.products(product_id),
    raw_description             TEXT NOT NULL,
    quantity                    NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
    pack_factor_applied         NUMERIC(12,4) NOT NULL DEFAULT 1.0 CHECK (pack_factor_applied > 0),
    unit_price_pen              NUMERIC(12,4) NOT NULL CHECK (unit_price_pen >= 0),
    line_total_pen              NUMERIC(14,2) NOT NULL CHECK (line_total_pen >= 0),
    unit_cost_snapshot_pen      NUMERIC(12,4) CHECK (unit_cost_snapshot_pen IS NULL OR unit_cost_snapshot_pen >= 0),
    fulfillment_mode            erp.fulfillment_mode NOT NULL DEFAULT 'STOCKED',
    fulfillment_status          erp.fulfillment_status NOT NULL DEFAULT 'FULFILLED',
    fulfilling_purchase_line_id BIGINT REFERENCES erp.purchase_invoice_lines(purchase_line_id),
    source_origin               erp.data_origin NOT NULL DEFAULT 'ERP_APP',
    source_row_hash             TEXT UNIQUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id, line_no),
    CONSTRAINT chk_line_math CHECK (ABS((quantity * unit_price_pen) - line_total_pen) <= 0.05)
);

CREATE INDEX IF NOT EXISTS idx_sales_order_lines_fulfillment
    ON erp.sales_order_lines (fulfillment_mode, fulfillment_status);

CREATE OR REPLACE FUNCTION erp.fn_flag_on_demand_sale_line()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_prod_mode    erp.fulfillment_mode;
    v_sku          TEXT;
    v_wh_id        BIGINT;
    v_on_hand      NUMERIC(14,4);
    v_required     NUMERIC(14,4);
BEGIN
    SELECT p.fulfillment_mode, p.sku
      INTO v_prod_mode, v_sku
      FROM erp.products p
     WHERE p.product_id = NEW.product_id;

    SELECT so.warehouse_id
      INTO v_wh_id
      FROM erp.sales_orders so
     WHERE so.order_id = NEW.order_id;

    v_required := NEW.quantity * NEW.pack_factor_applied;

    SELECT COALESCE(SUM(im.quantity_delta), 0)
      INTO v_on_hand
      FROM erp.inventory_movements im
     WHERE im.warehouse_id = v_wh_id
       AND im.product_id = NEW.product_id;

    IF TG_OP = 'INSERT' THEN
        NEW.fulfillment_mode := v_prod_mode;

        IF v_prod_mode = 'ON_DEMAND'
           AND NEW.fulfilling_purchase_line_id IS NULL
           AND v_on_hand < v_required
           AND NEW.source_origin = 'ERP_APP' THEN
            NEW.fulfillment_status := 'PENDING_SUPPLIER_PURCHASE';

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
                'ON_DEMAND_PENDING_PURCHASE',
                'WARNING',
                'erp.sales_order_lines',
                NEW.order_line_id::text,
                format('ON_DEMAND sale line #%s for SKU %s awaiting supplier purchase (on_hand=%s, required=%s)',
                       NEW.order_line_id, v_sku, v_on_hand, v_required),
                jsonb_build_object(
                    'order_id', NEW.order_id,
                    'order_line_id', NEW.order_line_id,
                    'product_id', NEW.product_id,
                    'sku', v_sku,
                    'warehouse_id', v_wh_id,
                    'on_hand_at_order', v_on_hand,
                    'required_base_qty', v_required
                ),
                NEW.source_origin
            )
            ON CONFLICT (flag_code, entity_table, entity_id)
            WHERE status = 'OPEN'
            DO UPDATE SET
                message = EXCLUDED.message,
                details = EXCLUDED.details;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.fulfilling_purchase_line_id IS NOT NULL
           AND OLD.fulfillment_status = 'PENDING_SUPPLIER_PURCHASE'
           AND NEW.fulfillment_status = 'PENDING_SUPPLIER_PURCHASE' THEN
            NEW.fulfillment_status := 'FULFILLED';
        END IF;

        IF NEW.fulfillment_status = 'FULFILLED' THEN
            UPDATE erp.audit_flags
               SET status = 'RESOLVED',
                   resolved_at = NOW(),
                   resolved_by = 'TRIGGER_FULFILLMENT_LINK'
             WHERE flag_code = 'ON_DEMAND_PENDING_PURCHASE'
               AND entity_table = 'erp.sales_order_lines'
               AND entity_id = NEW.order_line_id::text
               AND status = 'OPEN';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_on_demand_sale_line ON erp.sales_order_lines;
CREATE TRIGGER trg_flag_on_demand_sale_line
    BEFORE INSERT OR UPDATE ON erp.sales_order_lines
    FOR EACH ROW
    EXECUTE FUNCTION erp.fn_flag_on_demand_sale_line();
