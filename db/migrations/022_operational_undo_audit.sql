-- 022_operational_undo_audit.sql
-- Auditable reversible operational action log for timed self-undo (15 min for non-admins)
-- and exclusive PARTNER_ADMIN full-history undo screen.

-- ============================================================================
-- 1. Expand erp.sales_order_audit_log allowed actions for undo traceability
-- ============================================================================

ALTER TABLE erp.sales_order_audit_log
    DROP CONSTRAINT IF EXISTS sales_order_audit_log_action_check;

ALTER TABLE erp.sales_order_audit_log
    ADD CONSTRAINT sales_order_audit_log_action_check
    CHECK (
        action IN (
            'CANCEL',
            'EDIT',
            'APPROVE_EDIT',
            'REJECT_EDIT',
            'UNDO_CANCEL',
            'UNDO_STATUS'
        )
    );

-- ============================================================================
-- 2. Reversible operational actions audit table & sync sequence
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS erp.seq_undoable_actions_sync;

CREATE TABLE IF NOT EXISTS erp.undoable_actions (
    undo_id            BIGSERIAL PRIMARY KEY,
    action_type        TEXT NOT NULL CHECK (
        action_type IN (
            'QUOTE_STATUS_CHANGE',
            'QUOTE_CONVERT_TO_ORDER',
            'ORDER_CANCEL',
            'ORDER_STATUS_ADVANCE',
            'ORDER_CREATE',
            'TRIP_CLOSE',
            'AUDIT_FLAG_STATUS'
        )
    ),
    entity_table       TEXT NOT NULL,
    entity_id          TEXT NOT NULL,
    entity_code        TEXT,
    summary            TEXT NOT NULL CHECK (NULLIF(BTRIM(summary), '') IS NOT NULL),
    actor_user_id      BIGINT NOT NULL REFERENCES erp.app_users(user_id),
    actor_role         erp.user_role NOT NULL,
    undo_payload       JSONB NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at         TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
    undone_at          TIMESTAMPTZ,
    undone_by_user_id  BIGINT REFERENCES erp.app_users(user_id),
    undone_reason      TEXT,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_seq           BIGINT NOT NULL DEFAULT nextval('erp.seq_undoable_actions_sync'),
    CONSTRAINT chk_undoable_actions_undone_meta CHECK (
        (undone_at IS NULL AND undone_by_user_id IS NULL AND undone_reason IS NULL)
        OR
        (undone_at IS NOT NULL AND undone_by_user_id IS NOT NULL)
    ),
    CONSTRAINT chk_undoable_actions_expiry CHECK (expires_at >= created_at)
);

CREATE INDEX IF NOT EXISTS idx_undoable_actions_created
    ON erp.undoable_actions (created_at DESC, undo_id DESC);

CREATE INDEX IF NOT EXISTS idx_undoable_actions_actor_created
    ON erp.undoable_actions (actor_user_id, created_at DESC, undo_id DESC);

CREATE INDEX IF NOT EXISTS idx_undoable_actions_pending
    ON erp.undoable_actions (expires_at DESC, undo_id DESC)
    WHERE undone_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_undoable_actions_entity
    ON erp.undoable_actions (entity_table, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_undoable_actions_sync_seq
    ON erp.undoable_actions (sync_seq DESC);

-- ============================================================================
-- 3. Immutability guard: no deletes; updates may only stamp a single undo event
-- ============================================================================

CREATE OR REPLACE FUNCTION erp.fn_guard_undoable_actions_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF COALESCE(current_setting('bht.allow_hard_delete', TRUE), 'off') = 'on' THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'El registro de acciones reversibles no se elimina'
            USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.undone_at IS NOT NULL THEN
            RAISE EXCEPTION 'Una acción ya deshecha es inmutable'
                USING ERRCODE = '42501';
        END IF;

        IF NEW.action_type IS DISTINCT FROM OLD.action_type
           OR NEW.entity_table IS DISTINCT FROM OLD.entity_table
           OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
           OR NEW.entity_code IS DISTINCT FROM OLD.entity_code
           OR NEW.summary IS DISTINCT FROM OLD.summary
           OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
           OR NEW.actor_role IS DISTINCT FROM OLD.actor_role
           OR NEW.undo_payload IS DISTINCT FROM OLD.undo_payload
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
           OR NEW.undone_at IS NULL THEN
            RAISE EXCEPTION 'Solo se permite registrar la reversión (undone_at) una única vez'
                USING ERRCODE = '42501';
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_undoable_actions_audit ON erp.undoable_actions;
CREATE TRIGGER trg_guard_undoable_actions_audit
    BEFORE UPDATE OR DELETE ON erp.undoable_actions
    FOR EACH ROW EXECUTE FUNCTION erp.fn_guard_undoable_actions_audit();

DROP TRIGGER IF EXISTS trg_undoable_actions_sync_watermark ON erp.undoable_actions;
CREATE TRIGGER trg_undoable_actions_sync_watermark
    BEFORE INSERT OR UPDATE ON erp.undoable_actions
    FOR EACH ROW EXECUTE FUNCTION erp.fn_touch_generic_sync_watermark('erp.seq_undoable_actions_sync');

COMMENT ON TABLE erp.undoable_actions IS
    'Audit log of reversible operational actions supporting timed non-admin undo and unrestricted PARTNER_ADMIN reversal.';
