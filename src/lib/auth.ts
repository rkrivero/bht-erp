import type { PoolClient } from "pg";
import * as dbMod from "./db";
import { assertRole } from "./rbac";
import {
  AuthenticationError,
  AuthorizationError,
  type SessionUser,
  type UserRole,
} from "./types";

export const SESSION_COOKIE_NAME = "bht_session";

export interface NeonAuthIdentity {
  id: string;
  email: string;
  emailVerified: boolean;
}

export interface RequestWithCookies {
  cookies?: { get(name: string): { value: string } | undefined };
}

/**
 * Resolve a verified Neon Auth identity to its explicitly provisioned ERP role
 * in a single SELECT query, running UPDATE only on first-time account linking
 * when `neon_auth_user_id IS NULL`.
 */
export async function resolveERPActor(
  client: PoolClient,
  identity: NeonAuthIdentity | null | undefined
): Promise<SessionUser | null> {
  const authUserId = identity?.id?.trim();
  const email = identity?.email?.trim().toLowerCase();
  if (!authUserId || !email || identity?.emailVerified !== true) return null;

  const result = await client.query<{
    user_id: number;
    username: string;
    full_name: string;
    role: UserRole;
    default_cash_account_id: number | null;
    neon_auth_user_id: string | null;
  }>(
    `SELECT user_id, username, full_name, role::text AS role,
            default_cash_account_id, neon_auth_user_id
     FROM erp.app_users
     WHERE LOWER(BTRIM(email)) = $2
       AND is_active = TRUE
       AND (neon_auth_user_id = $1 OR neon_auth_user_id IS NULL)
     LIMIT 1`,
    [authUserId, email]
  );
  if (result.rowCount === 0) return null;

  const row = result.rows[0];
  if (!row.neon_auth_user_id) {
    await client.query(
      `UPDATE erp.app_users
       SET neon_auth_user_id = $1
       WHERE user_id = $2
         AND neon_auth_user_id IS NULL`,
      [authUserId, row.user_id]
    );
  }

  return {
    userId: Number(row.user_id),
    username: String(row.username),
    fullName: String(row.full_name),
    role: row.role,
    defaultCashAccountId:
      row.default_cash_account_id === null ? null : Number(row.default_cash_account_id),
  };
}

/** Return the current signed-in user only when Neon Auth and the ERP allow them. */
export async function getAuthenticatedERPActor(
  request?: RequestWithCookies,
  existingClient?: PoolClient
): Promise<SessionUser | null> {
  if (
    process.env.NODE_ENV === "test" &&
    process.env.VERCEL !== "1" &&
    process.env.VERCEL_ENV !== "production" &&
    request?.cookies
  ) {
    const { isTestAuthRuntime, verifyTestSessionToken } =
      await import("./auth/test-session");
    if (isTestAuthRuntime()) {
      const fixtureUser = verifyTestSessionToken(
        request.cookies.get(SESSION_COOKIE_NAME)?.value
      );
      if (fixtureUser) return fixtureUser;
    }
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
    if (existingClient) {
      return await resolveERPActor(existingClient, identity);
    }
    return await dbMod.withClient((client) => resolveERPActor(client, identity));
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
  };
}

type ResolvedAuthContext =
  | { mode: "test"; fixtureUser: SessionUser }
  | { mode: "neon"; identity: NeonAuthIdentity };

async function resolveRequestAuthContext(
  request?: RequestWithCookies
): Promise<ResolvedAuthContext> {
  if (
    process.env.NODE_ENV === "test" &&
    process.env.VERCEL !== "1" &&
    process.env.VERCEL_ENV !== "production" &&
    request?.cookies
  ) {
    const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (rawCookie) {
      const { isTestAuthRuntime, verifyTestSessionToken } =
        await import("./auth/test-session");
      if (isTestAuthRuntime()) {
        const fixtureUser = verifyTestSessionToken(rawCookie);
        if (!fixtureUser) {
          throw new AuthenticationError("Sesión inválida o expirada");
        }
        return { mode: "test", fixtureUser };
      }
    }
  }

  let data: {
    user?: { id?: unknown; email?: unknown; emailVerified?: unknown } | null;
  } | null = null;
  let error: unknown = null;
  try {
    const { auth } = await import("./auth/server");
    const sessionRes = await auth.getSession();
    data = sessionRes?.data ?? null;
    error = sessionRes?.error ?? null;
  } catch {
    throw new AuthenticationError("Sesión no iniciada");
  }

  if (error || !data?.user) {
    throw new AuthenticationError("Sesión no iniciada");
  }

  return {
    mode: "neon",
    identity: {
      id: String(data.user.id || ""),
      email: String(data.user.email || ""),
      emailVerified: data.user.emailVerified === true,
    },
  };
}

async function resolveActorOnClient(
  client: PoolClient,
  authCtx: ResolvedAuthContext,
  allowedRoles: UserRole[]
): Promise<SessionUser> {
  if (authCtx.mode === "test") {
    const verified = await requireActiveSession(client, authCtx.fixtureUser);
    return assertRole(verified, allowedRoles);
  }
  const resolved = await resolveERPActor(client, authCtx.identity);
  if (!resolved) {
    throw new AuthorizationError("Tu correo aún no está habilitado en el ERP.");
  }
  return assertRole(resolved, allowedRoles);
}

/**
 * Single-checkout authenticated DB client helper.
 * Resolves Neon Auth identity and active ERP actor on the same PoolClient used by the route handler.
 */
export async function withAuthenticatedClient<T>(
  request: RequestWithCookies | undefined,
  allowedRoles: UserRole[],
  fn: (client: PoolClient, actor: SessionUser) => Promise<T>
): Promise<T> {
  const authCtx = await resolveRequestAuthContext(request);
  if (authCtx.mode === "test") {
    assertRole(authCtx.fixtureUser, allowedRoles);
  }
  return dbMod.withClient(async (client) => {
    const actor = await resolveActorOnClient(client, authCtx, allowedRoles);
    return fn(client, actor);
  });
}

/**
 * Single-checkout authenticated DB transaction helper.
 * Resolves Neon Auth identity and active ERP actor inside the same transaction PoolClient.
 */
export async function withAuthenticatedTransaction<T>(
  request: RequestWithCookies | undefined,
  allowedRoles: UserRole[],
  fn: (client: PoolClient, actor: SessionUser) => Promise<T>
): Promise<T> {
  const authCtx = await resolveRequestAuthContext(request);
  if (authCtx.mode === "test") {
    assertRole(authCtx.fixtureUser, allowedRoles);
  }
  return dbMod.withTransaction(async (client) => {
    const actor = await resolveActorOnClient(client, authCtx, allowedRoles);
    return fn(client, actor);
  });
}
