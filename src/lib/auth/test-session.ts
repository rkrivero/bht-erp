import crypto from "crypto";
import type { SessionUser } from "../types";

const TEST_SESSION_TTL_SECONDS = 60 * 60;
const TEST_SESSION_SECRET = "bht-test-fixture-session-key-not-for-production";

function assertTestRuntime(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Test session helpers are unavailable outside the test runtime");
  }
}

export function signTestSessionToken(
  user: SessionUser,
  ttlSeconds = TEST_SESSION_TTL_SECONDS
): string {
  assertTestRuntime();
  const nowSec = Math.floor(Date.now() / 1000);
  const payloadObj: SessionUser = {
    userId: user.userId,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    defaultCashAccountId: user.defaultCashAccountId ?? null,
    exp:
      typeof user.exp === "number" && Number.isFinite(user.exp)
        ? Math.floor(user.exp)
        : nowSec + ttlSeconds,
  };
  const payload = Buffer.from(JSON.stringify(payloadObj), "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", TEST_SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyTestSessionToken(
  token: string | undefined | null
): SessionUser | null {
  assertTestRuntime();
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;

  const expected = crypto
    .createHmac("sha256", TEST_SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as Partial<SessionUser>;
    if (
      typeof parsed.userId !== "number" ||
      !Number.isInteger(parsed.userId) ||
      typeof parsed.username !== "string" ||
      typeof parsed.fullName !== "string" ||
      typeof parsed.role !== "string" ||
      typeof parsed.exp !== "number" ||
      !Number.isFinite(parsed.exp) ||
      parsed.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return parsed as SessionUser;
  } catch {
    return null;
  }
}
