-- 004_erp_treasury_and_obligations.sql
-- Treasury cash ledger, accounts receivable (AR) collections + sync trigger, and accounts payable (AP) obligations.

-- ============================================================================
-- Cash Ledger (Every Inflow / Outflow / Internal Deposit Transfer)
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp.cash_ledger (
    ledger_id             BIGSERIAL PRIMARY KEY,
    tx_date               DATE NOT NULL,
    account_id            BIGINT NOT NULL REFERENCES erp.cash_accounts(account_id),
    trip_id               BIGINT REFERENCES erp.route_trips(trip_id),
    party_id              BIGINT REFERENCES erp.parties(party_id),
    direction             erp.cash_direction NOT NULL,
    amount_pen            NUMERIC(14,2) NOT NULL CHECK (amount_pen > 0),
    expense_bucket        erp.expense_bucket,
    expense_category      TEXT NOT NULL,
    is_internal_transfer  BOOLEAN NOT NULL DEFAULT FALSE,
    reference_table       TEXT,
    reference_id          TEXT,
    description           TEXT NOT NULL,
    source_origin         erp.data_origin NOT NULL DEFAULT 'ERP_APP',
    source_file           TEXT,
    source_sheet          TEXT,
    source_row_num        INT,
    source_row_hash       TEXT UNIQUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_cash_out_bucket
        CHECK (direction = 'IN' OR is_internal_transfer = TRUE OR expense_bucket IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_cash_ledger_date_dir_bucket
    ON erp.cash_ledger (tx_date, direction, expense_bucket, is_internal_transfer);

-- ============================================================================
-- Accounts Receivable Payments & Order Sync Trigger
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp.ar_payments (
    ar_payment_id    BIGSERIAL PRIMARY KEY,
    order_id         BIGINT NOT NULL REFERENCES erp.sales_orders(order_id) ON DELETE CASCADE,
    payment_date     DATE NOT NULL,
    amount_pen       NUMERIC(14,2) NOT NULL CHECK (amount_pen > 0),
    payment_mode     erp.payment_mode NOT NULL,
    account_id       BIGINT REFERENCES erp.cash_accounts(account_id),
    reference_doc    TEXT,
    notes            TEXT,
    source_origin    erp.data_origin NOT NULL DEFAULT 'ERP_APP',
    source_row_hash  TEXT UNIQUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ar_payments_order_date
    ON erp.ar_payments (order_id, payment_date);

CREATE OR REPLACE FUNCTION erp.fn_sync_ar_payment_to_order()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_order_id  BIGINT;
    v_sum_paid  NUMERIC(14,2);
BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        v_order_id := NEW.order_id;
        SELECT COALESCE(SUM(amount_pen), 0)
          INTO v_sum_paid
          FROM erp.ar_payments
         WHERE order_id = v_order_id;

        UPDATE erp.sales_orders
           SET paid_pen = v_sum_paid
         WHERE order_id = v_order_id;
    END IF;

    IF TG_OP IN ('DELETE', 'UPDATE') AND (TG_OP = 'DELETE' OR OLD.order_id <> NEW.order_id) THEN
        SELECT COALESCE(SUM(amount_pen), 0)
          INTO v_sum_paid
          FROM erp.ar_payments
         WHERE order_id = OLD.order_id;

        UPDATE erp.sales_orders
           SET paid_pen = v_sum_paid
         WHERE order_id = OLD.order_id;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_ar_payment_to_order ON erp.ar_payments;
CREATE TRIGGER trg_sync_ar_payment_to_order
    AFTER INSERT OR UPDATE OR DELETE ON erp.ar_payments
    FOR EACH ROW
    EXECUTE FUNCTION erp.fn_sync_ar_payment_to_order();

-- ============================================================================
-- Accounts Payable Obligations (Supplier Credit & Historical Debts)
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp.ap_obligations (
    ap_id                BIGSERIAL PRIMARY KEY,
    purchase_id          BIGINT REFERENCES erp.purchase_invoices(purchase_id) ON DELETE SET NULL,
    supplier_party_id    BIGINT REFERENCES erp.parties(party_id),
    doc_ref              TEXT NOT NULL,
    obligation_type      TEXT NOT NULL DEFAULT 'SUPPLIER_INVOICE'
                             CHECK (obligation_type IN ('SUPPLIER_INVOICE', 'PARTNER_DEBT', 'TAX_OR_SERVICE', 'OTHER')),
    issue_date           DATE NOT NULL,
    due_date             DATE,
    original_amount_pen  NUMERIC(14,2) NOT NULL CHECK (original_amount_pen > 0),
    paid_amount_pen      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount_pen >= 0),
    balance_due_pen      NUMERIC(14,2) GENERATED ALWAYS AS (GREATEST(original_amount_pen - paid_amount_pen, 0)) STORED,
    status               TEXT NOT NULL DEFAULT 'OPEN'
                             CHECK (status IN ('OPEN', 'PARTIAL', 'PAID', 'CANCELLED')),
    source_origin        erp.data_origin NOT NULL DEFAULT 'ERP_APP',
    source_row_hash      TEXT UNIQUE,
    notes                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ap_obligations_status_due
    ON erp.ap_obligations (status, due_date);
