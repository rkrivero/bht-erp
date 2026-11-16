import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  authenticateUser,
  checkAuthRateLimit,
  clearAuthFailures,
  computeSessionVersion,
  hashPassword,
  recordAuthFailure,
  signSessionToken,
  validatePersonalPassword,
  verifyPassword,
  verifyActiveSessionUser,
  verifySessionToken,
} from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
import { resolveHttpError, ValidationError } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function extractClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "local";
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const parsedSession = verifySessionToken(token);
  const session = await withClient(async (client) => {
    return parsedSession
      ? await verifyActiveSessionUser(client, parsedSession)
      : null;
  });
  return NextResponse.json({ session }, { headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const isProd = process.env.NODE_ENV === "production";
    if (body.action === "logout") {
      const res = NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
      res.cookies.set(SESSION_COOKIE_NAME, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: isProd,
        path: "/",
        maxAge: 0,
      });
      return res;
    }

    if (body.action === "change_password") {
      const parsedSession = verifySessionToken(
        req.cookies.get(SESSION_COOKIE_NAME)?.value
      );
      if (!parsedSession) {
        return NextResponse.json(
          { error: "Sesión inválida o expirada" },
          { status: 401, headers: NO_STORE_HEADERS }
        );
      }
      const currentPassword = String(body.currentPassword || "");
      const newPassword = String(body.newPassword || "");
      const confirmation = String(body.confirmPassword || "");
      const policyError = validatePersonalPassword(newPassword);
      if (policyError) throw new ValidationError(policyError);
      if (newPassword !== confirmation) {
        throw new ValidationError("La confirmación de contraseña no coincide");
      }
      if (newPassword === currentPassword) {
        throw new ValidationError(
          "La nueva contraseña debe ser distinta de la temporal"
        );
      }

      const user = await withTransaction(async (client) => {
        const active = await verifyActiveSessionUser(client, parsedSession);
        if (!active) return null;
        const credentialRes = await client.query<{ password_hash: string }>(
          `SELECT COALESCE(password_hash, pin_hash) AS password_hash
           FROM erp.app_users
           WHERE user_id = $1 AND is_active = TRUE
           FOR UPDATE`,
          [active.userId]
        );
        const currentHash = credentialRes.rows[0]?.password_hash;
        if (!currentHash || !verifyPassword(currentPassword, currentHash)) {
          throw new ValidationError("La contraseña actual no es correcta");
        }
        const passwordHash = hashPassword(newPassword);
        await client.query(
          `UPDATE erp.app_users
           SET password_hash = $1, pin_hash = $1, must_change_password = FALSE
           WHERE user_id = $2`,
          [passwordHash, active.userId]
        );
        return {
          ...active,
          mustChangePassword: false,
          sessionVersion: computeSessionVersion(passwordHash, active.role),
        };
      });
      if (!user) {
        return NextResponse.json(
          { error: "Sesión inválida o usuario inactivo" },
          { status: 401, headers: NO_STORE_HEADERS }
        );
      }
      const token = signSessionToken(user);
      const res = NextResponse.json({ user }, { headers: NO_STORE_HEADERS });
      res.cookies.set(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: isProd,
        path: "/",
        maxAge: SESSION_TTL_SECONDS,
      });
      return res;
    }

    const username = String(body.username || "").trim();
    const password = String(body.password || body.pin || "").trim();
    const clientIp = extractClientIp(req);

    const rateCheck = checkAuthRateLimit(clientIp, username);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error:
            "Demasiados intentos fallidos. Espera unos minutos antes de intentar nuevamente.",
        },
        {
          status: 429,
          headers: {
            ...NO_STORE_HEADERS,
            "Retry-After": String(rateCheck.retryAfterSec),
          },
        }
      );
    }

    const user = await withClient((client) =>
      authenticateUser(client, username, password)
    );
    if (!user) {
      recordAuthFailure(clientIp, username);
      return NextResponse.json(
        { error: "Usuario o contraseña incorrectos" },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    clearAuthFailures(clientIp, username);
    const token = signSessionToken(user);
    const res = NextResponse.json({ user }, { headers: NO_STORE_HEADERS });
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch (err) {
    const resolved = resolveHttpError(err, "Error de autenticación");
    return NextResponse.json(
      { error: resolved.error },
      { status: resolved.status, headers: NO_STORE_HEADERS }
    );
  }
}
