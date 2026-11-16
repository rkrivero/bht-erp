import crypto from "crypto";
import type { PoolClient } from "pg";
import { withClient } from "./db";
import {
  AuthenticationError,
  type SessionUser,
  type UserRole,
} from "./types";

export const SESSION_COOKIE_NAME = "bht_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 14; // 14 hours shift
const DEV_FALLBACK_SESSION_SECRET = "bht-erp-phase2-hmac-secret-key-2026-pen";
const SCRYPT_PREFIX = "scrypt$";
const SCRYPT_KEYLEN = 32;

function getSessionSecret(): string {
  const configured = process.env.BHT_SESSION_SECRET?.trim();
  if (configured && configured.length >= 16) {
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    if (configured && configured.length > 0) {
      throw new Error(
        "BHT_SESSION_SECRET must be at least 16 characters in production"
      );
    }
    throw new Error(
      "BHT_SESSION_SECRET environment variable is required in production"
    );
  }
  return configured || DEV_FALLBACK_SESSION_SECRET;
}

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(pin, salt, SCRYPT_KEYLEN).toString("hex");
  return `${SCRYPT_PREFIX}${salt}$${derived}`;
}

export const hashPassword = hashPin;

export function hashPinLegacySha256(pin: string): string {
  return crypto.createHash("sha256").update(pin, "utf8").digest("hex");
}

export function verifyPin(pin: string, storedHash: string): boolean {
  const normalizedHash = String(storedHash || "").trim();
  if (!normalizedHash) return false;

  if (normalizedHash.startsWith(SCRYPT_PREFIX)) {
    const parts = normalizedHash.split("$");
    if (parts.length !== 3) return false;
    const [, salt, expectedHex] = parts;
    if (!salt || !/^[a-f0-9]+$/i.test(expectedHex) || expectedHex.length % 2 !== 0) {
      return false;
    }
    const expectedBuf = Buffer.from(expectedHex, "hex");
    const derivedBuf = crypto.scryptSync(pin, salt, expectedBuf.length);
    return (
      derivedBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(derivedBuf, expectedBuf)
    );
  }

  // Backward compatibility for legacy unsalted SHA-256 credentials in dev seed
  if (/^[a-f0-9]{64}$/i.test(normalizedHash)) {
    const actualBuf = Buffer.from(hashPinLegacySha256(pin), "hex");
    const expectedBuf = Buffer.from(normalizedHash, "hex");
    return (
      actualBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(actualBuf, expectedBuf)
    );
  }

  return false;
}

export const verifyPassword = verifyPin;

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

  // A manager pre-assigns the email in erp.app_users. The first verified sign-in
  // binds the Neon identity once; later role changes and deactivation remain
  // controlled by the ERP account row.
  await client.query(
    `UPDATE erp.app_users
     SET neon_auth_user_id = $1
     WHERE LOWER(BTRIM(email)) = $2
       AND is_active = TRUE
       AND (neon_auth_user_id IS NULL OR neon_auth_user_id = $1)`,
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
      row.default_cash_account_id === null
        ? null
        : Number(row.default_cash_account_id),
    mustChangePassword: false,
  };
}

/** Return the current signed-in user only when Neon Auth and the ERP allow them. */
export async function getAuthenticatedERPActor(): Promise<SessionUser | null> {
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

export function validatePersonalPassword(password: string): string | null {
  if (password.length < 10 || password.length > 128) {
    return "La contraseña debe tener entre 10 y 128 caracteres";
  }
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(password) || !/\d/.test(password)) {
    return "La contraseña debe incluir al menos una letra y un número";
  }
  return null;
}

export function computeSessionVersion(pinHash: string, role: UserRole): string {
  return crypto
    .createHash("sha256")
    .update(`${pinHash}:${role}`, "utf8")
    .digest("hex")
    .slice(0, 16);
}

export function signSessionToken(
  user: SessionUser,
  ttlSeconds = SESSION_TTL_SECONDS
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const exp =
    typeof user.exp === "number" && Number.isFinite(user.exp)
      ? Math.floor(user.exp)
      : nowSec + ttlSeconds;
  const payloadObj: SessionUser = {
    userId: user.userId,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    defaultCashAccountId: user.defaultCashAccountId ?? null,
    exp,
    ...(user.sessionVersion ? { sessionVersion: user.sessionVersion } : {}),
    ...(typeof user.mustChangePassword === "boolean"
      ? { mustChangePassword: user.mustChangePassword }
      : {}),
  };
  const payload = Buffer.from(JSON.stringify(payloadObj), "utf8").toString(
    "base64url"
  );
  const sig = crypto
    .createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionToken(
  token: string | undefined | null
): SessionUser | null {
  if (!token || !token.includes(".")) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;
  const expectedSig = crypto
    .createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );
    if (
      !parsed ||
      typeof parsed.userId !== "number" ||
      !Number.isInteger(parsed.userId) ||
      typeof parsed.role !== "string" ||
      typeof parsed.exp !== "number" ||
      !Number.isFinite(parsed.exp)
    ) {
      return null;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (parsed.exp <= nowSec) {
      return null;
    }
    return parsed as SessionUser;
  } catch {
    return null;
  }
}

export async function authenticateUser(
  client: PoolClient,
  username: string,
  password: string
): Promise<SessionUser | null> {
  const normalizedUsername = username.trim().toLowerCase();
  const trimmedPassword = password.trim();
  if (!normalizedUsername || !trimmedPassword) return null;

  const res = await client.query<{
    user_id: number;
    username: string;
    full_name: string;
    role: UserRole;
    default_cash_account_id: number | null;
    password_hash: string;
    must_change_password: boolean;
  }>(
    `SELECT user_id, username, full_name, role::text AS role,
            default_cash_account_id, COALESCE(password_hash, pin_hash) AS password_hash,
            must_change_password
     FROM erp.app_users
     WHERE LOWER(username) = $1
       AND is_active = TRUE
     LIMIT 1`,
    [normalizedUsername]
  );
  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  if (!verifyPassword(trimmedPassword, row.password_hash)) return null;
  const role = row.role as UserRole;
  return {
    userId: Number(row.user_id),
    username: String(row.username),
    fullName: String(row.full_name),
    role,
    defaultCashAccountId:
      row.default_cash_account_id !== null
        ? Number(row.default_cash_account_id)
        : null,
    sessionVersion: computeSessionVersion(row.password_hash, role),
    mustChangePassword: Boolean(row.must_change_password),
  };
}

export async function verifyActiveSessionUser(
  client: PoolClient,
  sessionUser: SessionUser | null | undefined
): Promise<SessionUser | null> {
  if (!sessionUser) return null;
  if (process.env.NODE_ENV === "production" && !sessionUser.sessionVersion) {
    return null;
  }
  const res = await client.query<{
    user_id: number;
    username: string;
    full_name: string;
    role: UserRole;
    default_cash_account_id: number | null;
    is_active: boolean;
    password_hash: string;
    must_change_password: boolean;
  }>(
    `SELECT user_id, username, full_name, role::text AS role,
            default_cash_account_id, is_active,
            COALESCE(password_hash, pin_hash) AS password_hash,
            must_change_password
     FROM erp.app_users
     WHERE user_id = $1
     LIMIT 1`,
    [sessionUser.userId]
  );
  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  if (!row.is_active) return null;
  const role = row.role as UserRole;
  if (sessionUser.sessionVersion) {
    const expectedSv = computeSessionVersion(row.password_hash, role);
    if (sessionUser.sessionVersion !== expectedSv) {
      return null;
    }
  }
  return {
    userId: Number(row.user_id),
    username: String(row.username),
    fullName: String(row.full_name),
    role,
    defaultCashAccountId:
      row.default_cash_account_id !== null
        ? Number(row.default_cash_account_id)
        : null,
    exp: sessionUser.exp,
    sessionVersion: sessionUser.sessionVersion,
    // Only sessions issued after the password migration carry the enforcement
    // claim. Pre-deployment sessions remain valid until their normal 14h expiry.
    mustChangePassword:
      sessionUser.mustChangePassword === true &&
      Boolean(row.must_change_password),
  };
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
      row.default_cash_account_id === null
        ? null
        : Number(row.default_cash_account_id),
    mustChangePassword: false,
  };
}

// Sliding-window rate limiter for POST /api/auth brute-force protection
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_USER_IP = 8;
const MAX_FAILS_PER_IP = 25;
const authAttempts = new Map<string, number[]>();

function pruneAttemptTimestamps(key: string, nowMs: number): number[] {
  const existing = authAttempts.get(key);
  if (!existing || existing.length === 0) return [];
  const valid = existing.filter((ts) => nowMs - ts < AUTH_WINDOW_MS);
  if (valid.length === 0) {
    authAttempts.delete(key);
  } else {
    authAttempts.set(key, valid);
  }
  return valid;
}

export function checkAuthRateLimit(
  clientIp: string,
  username: string,
  nowMs = Date.now()
): { allowed: boolean; retryAfterSec: number } {
  const ip = clientIp.trim() || "unknown";
  const userKey = `u:${ip}:${username.trim().toLowerCase()}`;
  const ipKey = `ip:${ip}`;

  const userAttempts = pruneAttemptTimestamps(userKey, nowMs);
  const ipAttempts = pruneAttemptTimestamps(ipKey, nowMs);

  if (
    userAttempts.length >= MAX_FAILS_PER_USER_IP ||
    ipAttempts.length >= MAX_FAILS_PER_IP
  ) {
    const oldest = Math.min(
      userAttempts.length >= MAX_FAILS_PER_USER_IP
        ? userAttempts[0]
        : Infinity,
      ipAttempts.length >= MAX_FAILS_PER_IP ? ipAttempts[0] : Infinity
    );
    const retryAfterSec = Math.max(
      1,
      Math.ceil((oldest + AUTH_WINDOW_MS - nowMs) / 1000)
    );
    return { allowed: false, retryAfterSec };
  }

  return { allowed: true, retryAfterSec: 0 };
}

export function recordAuthFailure(
  clientIp: string,
  username: string,
  nowMs = Date.now()
): void {
  if (authAttempts.size > 2000) {
    for (const k of authAttempts.keys()) {
      pruneAttemptTimestamps(k, nowMs);
    }
  }
  const ip = clientIp.trim() || "unknown";
  const userKey = `u:${ip}:${username.trim().toLowerCase()}`;
  const ipKey = `ip:${ip}`;

  const userAttempts = pruneAttemptTimestamps(userKey, nowMs);
  userAttempts.push(nowMs);
  authAttempts.set(userKey, userAttempts);

  const ipAttempts = pruneAttemptTimestamps(ipKey, nowMs);
  ipAttempts.push(nowMs);
  authAttempts.set(ipKey, ipAttempts);
}

export function clearAuthFailures(clientIp: string, username: string): void {
  const ip = clientIp.trim() || "unknown";
  authAttempts.delete(`u:${ip}:${username.trim().toLowerCase()}`);
}

export function resetAuthRateLimitStore(): void {
  authAttempts.clear();
}
