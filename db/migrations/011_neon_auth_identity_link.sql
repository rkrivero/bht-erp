-- Link Neon Managed Better Auth identities to existing ERP users.
-- Existing passwords remain intact for rollback during the auth cutover, but
-- the application no longer uses them to authenticate once Neon Auth is live.

ALTER TABLE erp.app_users
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS neon_auth_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_users_email_normalized
  ON erp.app_users (LOWER(BTRIM(email)))
  WHERE NULLIF(BTRIM(email), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_users_neon_auth_user_id
  ON erp.app_users (neon_auth_user_id)
  WHERE neon_auth_user_id IS NOT NULL;

COMMENT ON COLUMN erp.app_users.email IS
  'Verified email allowed to link to one Neon Managed Better Auth identity.';

COMMENT ON COLUMN erp.app_users.neon_auth_user_id IS
  'Neon Managed Better Auth user ID linked to this ERP role and account.';
