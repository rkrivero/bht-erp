import crypto from "crypto";
import type { PoolClient } from "pg";
import type { SessionUser, UserRole } from "./types";

const SESSION_SECRET =
  process.env.BHT_SESSION_SECRET || "bht-erp-phase2-hmac-secret-key-2026-pen";

export const SESSION_COOKIE_NAME = "bht_session";

export function hashPin(pin: string): string {
  return crypto.createHash("sha256").update(pin, "utf8").digest("hex");
}

export function signSessionToken(user: SessionUser): string {
  const payload = Buffer.from(JSON.stringify(user), "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null): SessionUser | null {
  if (!token || !token.includes(".")) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed.userId !== "number" || !parsed.role) return null;
    return parsed as SessionUser;
  } catch {
    return null;
  }
}

export async function authenticateUser(
  client: PoolClient,
  username: string,
  pin: string
): Promise<SessionUser | null> {
  const normalizedUsername = username.trim().toLowerCase();
  const pinHash = hashPin(pin.trim());
  const res = await client.query(
    `SELECT user_id, username, full_name, role::text AS role, default_cash_account_id
     FROM erp.app_users
     WHERE LOWER(username) = $1
       AND pin_hash = $2
       AND is_active = TRUE
     LIMIT 1`,
    [normalizedUsername, pinHash]
  );
  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  return {
    userId: Number(row.user_id),
    username: String(row.username),
    fullName: String(row.full_name),
    role: row.role as UserRole,
    defaultCashAccountId:
      row.default_cash_account_id !== null ? Number(row.default_cash_account_id) : null,
  };
}
