import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  authenticateUser,
  signSessionToken,
  verifySessionToken,
} from "@/lib/auth";
import { withClient } from "@/lib/db";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(token);
  const users = await withClient(async (client) => {
    const res = await client.query(
      `SELECT user_id, username, full_name, role::text AS role
       FROM erp.app_users
       WHERE is_active = TRUE
       ORDER BY user_id ASC`
    );
    return res.rows;
  });
  return NextResponse.json({ session, users });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.action === "logout") {
      const res = NextResponse.json({ ok: true });
      res.cookies.delete(SESSION_COOKIE_NAME);
      return res;
    }

    const username = String(body.username || "");
    const pin = String(body.pin || "");
    const user = await withClient((client) =>
      authenticateUser(client, username, pin)
    );
    if (!user) {
      return NextResponse.json(
        { error: "Usuario o PIN incorrecto" },
        { status: 401 }
      );
    }

    const token = signSessionToken(user);
    const res = NextResponse.json({ user });
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 14, // 14 hours shift
    });
    return res;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error de autenticación" },
      { status: 500 }
    );
  }
}
