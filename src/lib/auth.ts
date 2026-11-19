import type { PoolClient } from "pg";
import { withClient } from "./db";
import { AuthenticationError, type SessionUser, type UserRole } from "./types";

export const SESSION_COOKIE_NAME = "bht_session";

export interface NeonAuthIdentity {
  id: string;
  email: string;
  emailVerified: boolean;
}

/** Resolve a verified Neon Auth identity to its explicitly provisioned ERP role. */
export async function resolveERPActor(
  client: PoolClient,
  identity: NeonAuthIdentity | null | undefined
): Promise<SessionUser | null> {
  const authUserId = identity?.id?.trim();
  const email = identity?.email?.trim().toLowerCase();
  if (!authUserId || !email || identity?.emailVerified !== true) return null;

  await client.query(
    `UPDATE erp.app_users
     SET neon_auth_user_id = $1
     WHERE LOWER(BTRIM(email)) = $2
       AND is_active = TRUE
       AND neon_auth_user_id IS NULL`,
    [authUserId, email]
  );

  const result = await client.query<{
    user_id: number;
    username: string;
    full_name: string;
    role: UserRole;
    default_cash_account_id: number | null;
  }>(
    `SELECT user_id, username, full_name, role::text AS role,
            default_cash_account_id
     FROM erp.app_users
     WHERE neon_auth_user_id = $1
       AND LOWER(BTRIM(email)) = $2
       AND is_active = TRUE
     LIMIT 1`,
    [authUserId, email]
  );
  if (result.rowCount === 0) return null;

  const row = result.rows[0];
  return {
    userId: Number(row.user_id),
    username: String(row.username),
    fullName: String(row.full_name),
    role: row.role,
    defaultCashAccountId:
      row.default_cash_account_id === null ? null : Number(row.default_cash_account_id),
    mustChangePassword: false,
  };
}

/** Return the current signed-in user only when Neon Auth and the ERP allow them. */
export async function getAuthenticatedERPActor(request?: {
  cookies: { get(name: string): { value: string } | undefined };
}): Promise<SessionUser | null> {
  if (process.env.NODE_ENV === "test" && request) {
    const { verifyTestSessionToken } = await import("./auth/test-session");
    const fixtureUser = verifyTestSessionToken(
      request.cookies.get(SESSION_COOKIE_NAME)?.value
    );
    if (fixtureUser) return fixtureUser;
  }

  try {
    const { auth } = await import("./auth/server");
    const { data, error } = await auth.getSession();
    if (error || !data?.user) return null;
    const identity: NeonAuthIdentity = {
      id: String(data.user.id),
      email: String(data.user.email || ""),
      emailVerified: data.user.emailVerified === true,
    };
    return withClient((client) => resolveERPActor(client, identity));
  } catch {
    return null;
  }
}

export async function requireActiveSession(
  client: PoolClient,
  sessionUser: SessionUser | null | undefined
): Promise<SessionUser> {
  if (!sessionUser) {
    throw new AuthenticationError("Sesión inválida, expirada o usuario inactivo");
  }
  const result = await client.query<{
    username: string;
    full_name: string;
    role: UserRole;
    default_cash_account_id: number | null;
  }>(
    `SELECT username, full_name, role::text AS role, default_cash_account_id
     FROM erp.app_users
     WHERE user_id = $1 AND is_active = TRUE
     LIMIT 1`,
    [sessionUser.userId]
  );
  if (result.rowCount === 0) {
    throw new AuthenticationError("Sesión inválida, expirada o usuario inactivo");
  }
  const row = result.rows[0];
  return {
    userId: Number(sessionUser.userId),
    username: String(row.username),
    fullName: String(row.full_name),
    role: row.role,
    defaultCashAccountId:
      row.default_cash_account_id === null ? null : Number(row.default_cash_account_id),
    mustChangePassword: false,
  };
}
