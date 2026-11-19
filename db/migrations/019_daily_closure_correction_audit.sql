-- Corrections to a closed day retain the previous and replacement snapshots.
CREATE TABLE IF NOT EXISTS erp.daily_closure_audit_log (
    audit_id BIGSERIAL PRIMARY KEY,
    closure_id BIGINT NOT NULL REFERENCES erp.daily_closures(closure_id) ON DELETE RESTRICT,
    actor_user_id BIGINT NOT NULL REFERENCES erp.app_users(user_id),
    actor_role TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
    before_data JSONB NOT NULL,
    after_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_closure_audit_closure_created
    ON erp.daily_closure_audit_log (closure_id, created_at DESC);

CREATE OR REPLACE FUNCTION erp.fn_keep_daily_closure_audit_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'El historial de correcciones de cierre es inmutable'
        USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_keep_daily_closure_audit_immutable
    BEFORE UPDATE OR DELETE ON erp.daily_closure_audit_log
    FOR EACH ROW EXECUTE FUNCTION erp.fn_keep_daily_closure_audit_immutable();
