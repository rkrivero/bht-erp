import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  authenticateUser,
  checkAuthRateLimit,
  clearAuthFailures,
  recordAuthFailure,
  signSessionToken,
  verifyActiveSessionUser,
  verifySessionToken,
} from "@/lib/auth";
import { withClient } from "@/lib/db";

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
  const { session, users } = await withClient(async (client) => {
    const activeSession = parsedSession
      ? await verifyActiveSessionUser(client, parsedSession)
      : null;
    const res = await client.query(
      `SELECT user_id, username, full_name, role::text AS role
       FROM erp.app_users
       WHERE is_active = TRUE
       ORDER BY user_id ASC`
    );
    return { session: activeSession, users: res.rows };
  });
  return NextResponse.json({ session, users }, { headers: NO_STORE_HEADERS });
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error de autenticación" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
