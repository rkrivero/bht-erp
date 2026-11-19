-- Phase 3 hardening: personal passwords and exactly-once client mutations.
-- This migration is additive and backwards compatible with the legacy pin_hash
-- column so the application can be deployed before the legacy column is retired.

ALTER TABLE erp.app_users
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE erp.app_users
SET password_hash = pin_hash
WHERE password_hash IS NULL;

ALTER TABLE erp.app_users
  ALTER COLUMN password_hash SET NOT NULL;

CREATE TABLE IF NOT EXISTS erp.client_mutations (
  mutation_id UUID PRIMARY KEY,
  actor_user_id BIGINT NOT NULL REFERENCES erp.app_users(user_id),
  mutation_type TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'APPLIED'
    CHECK (status IN ('APPLIED', 'CONFLICT', 'REJECTED')),
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_client_mutations_actor_created
  ON erp.client_mutations (actor_user_id, created_at DESC);

COMMENT ON TABLE erp.client_mutations IS
  'Exactly-once ledger for authenticated offline-capable client writes.';

COMMENT ON COLUMN erp.client_mutations.result_json IS
  'Role-safe API result used to return the same response on idempotent replay.';
