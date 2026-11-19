-- 010_sales_order_audit_and_reversals.sql
-- Preserve commercial and financial traceability: orders are never hard-deleted,
-- cancelled collections are voided, and cash is reversed with compensating entries.

ALTER TABLE erp.cash_ledger
    ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT REFERENCES erp.app_users(user_id),
    ADD COLUMN IF NOT EXISTS reversal_of_ledger_id BIGINT REFERENCES erp.cash_ledger(ledger_id),
    ADD COLUMN IF NOT EXISTS is_reversal BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_ledger_single_reversal
    ON erp.cash_ledger (reversal_of_ledger_id)
    WHERE reversal_of_ledger_id IS NOT NULL;

ALTER TABLE erp.ar_payments
    ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS voided_by_user_id BIGINT REFERENCES erp.app_users(user_id),
    ADD COLUMN IF NOT EXISTS void_reason TEXT,
    ADD COLUMN IF NOT EXISTS reversal_ledger_id BIGINT REFERENCES erp.cash_ledger(ledger_id);

ALTER TABLE erp.ar_payments
    DROP CONSTRAINT IF EXISTS chk_ar_payment_void_metadata;
ALTER TABLE erp.ar_payments
    ADD CONSTRAINT chk_ar_payment_void_metadata CHECK (
        (voided_at IS NULL AND voided_by_user_id IS NULL AND void_reason IS NULL AND reversal_ledger_id IS NULL)
        OR
        (voided_at IS NOT NULL AND voided_by_user_id IS NOT NULL AND NULLIF(BTRIM(void_reason), '') IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_ar_payments_active_order
    ON erp.ar_payments (order_id, payment_date)
    WHERE voided_at IS NULL;

CREATE TABLE IF NOT EXISTS erp.sales_order_audit_log (
    audit_id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES erp.sales_orders(order_id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK (action IN ('CANCEL', 'EDIT', 'APPROVE_EDIT', 'REJECT_EDIT')),
    actor_user_id BIGINT NOT NULL REFERENCES erp.app_users(user_id),
    actor_role TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
    before_data JSONB NOT NULL,
    after_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_order_audit_order_created
    ON erp.sales_order_audit_log (order_id, created_at DESC);

CREATE OR REPLACE FUNCTION erp.fn_keep_sales_order_audit_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'El historial de auditoría de pedidos es inmutable'
        USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_keep_sales_order_audit_immutable ON erp.sales_order_audit_log;
CREATE TRIGGER trg_keep_sales_order_audit_immutable
    BEFORE UPDATE OR DELETE ON erp.sales_order_audit_log
    FOR EACH ROW EXECUTE FUNCTION erp.fn_keep_sales_order_audit_immutable();

CREATE OR REPLACE FUNCTION erp.fn_prevent_sales_order_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF COALESCE(current_setting('bht.allow_hard_delete', TRUE), 'off') <> 'on' THEN
        RAISE EXCEPTION 'Los pedidos no se eliminan; deben anularse o revertirse'
            USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_sales_order_delete ON erp.sales_orders;
CREATE TRIGGER trg_prevent_sales_order_delete
    BEFORE DELETE ON erp.sales_orders
    FOR EACH ROW EXECUTE FUNCTION erp.fn_prevent_sales_order_delete();

CREATE OR REPLACE FUNCTION erp.fn_sync_ar_payment_to_order()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_order_id BIGINT;
    v_sum_paid NUMERIC(14,2);
BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        v_order_id := NEW.order_id;
        SELECT COALESCE(SUM(amount_pen) FILTER (WHERE voided_at IS NULL), 0)
          INTO v_sum_paid
          FROM erp.ar_payments
         WHERE order_id = v_order_id;

        UPDATE erp.sales_orders
           SET paid_pen = v_sum_paid
         WHERE order_id = v_order_id;
    END IF;

    IF TG_OP IN ('DELETE', 'UPDATE') AND (TG_OP = 'DELETE' OR OLD.order_id <> NEW.order_id) THEN
        SELECT COALESCE(SUM(amount_pen) FILTER (WHERE voided_at IS NULL), 0)
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

-- Recalculate current totals under the new active-payment rule.
UPDATE erp.sales_orders so
SET paid_pen = COALESCE((
    SELECT SUM(p.amount_pen)
    FROM erp.ar_payments p
    WHERE p.order_id = so.order_id
      AND p.voided_at IS NULL
), 0)
WHERE so.source_origin = 'ERP_APP';

