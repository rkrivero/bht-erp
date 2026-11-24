-- User provisioning and immutable access-change traceability.
-- Neon Auth owns identities/passwords; erp.app_users owns ERP authorization.

CREATE TABLE IF NOT EXISTS erp.user_access_audit_log (
  audit_id BIGSERIAL PRIMARY KEY,
  target_user_id BIGINT NOT NULL REFERENCES erp.app_users(user_id),
  actor_user_id BIGINT NOT NULL REFERENCES erp.app_users(user_id),
  action TEXT NOT NULL CHECK (
    action IN (
      'USER_CREATED',
      'USER_NAME_CHANGED',
      'USER_EMAIL_CHANGED',
      'USER_ROLE_CHANGED',
      'USER_ACTIVATED',
      'USER_DEACTIVATED'
    )
  ),
  before_data JSONB,
  after_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_access_audit_target_created
  ON erp.user_access_audit_log (target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_access_audit_actor_created
  ON erp.user_access_audit_log (actor_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION erp.fn_keep_user_access_audit_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'El historial de accesos de usuarios es inmutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_keep_user_access_audit_immutable
  ON erp.user_access_audit_log;

CREATE TRIGGER trg_keep_user_access_audit_immutable
BEFORE UPDATE OR DELETE ON erp.user_access_audit_log
FOR EACH ROW EXECUTE FUNCTION erp.fn_keep_user_access_audit_immutable();

COMMENT ON TABLE erp.user_access_audit_log IS
  'Immutable audit trail for ERP account provisioning and authorization changes.';
