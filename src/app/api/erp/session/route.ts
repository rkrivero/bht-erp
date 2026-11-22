import { NextRequest, NextResponse } from "next/server";
import { withAuthenticatedClient } from "@/lib/auth";
import { resolveHttpError } from "@/lib/http-errors";
import type { UserRole } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALL_ERP_ROLES: UserRole[] = [
  "PARTNER_ADMIN",
  "PARTNER_MANAGER",
  "EXTERNAL_SELLER",
  "WAREHOUSE_DELIVERY",
];

export async function GET(req: NextRequest) {
  try {
    const session = await withAuthenticatedClient(
      req,
      ALL_ERP_ROLES,
      async (_client, actor) => actor
    );
    return NextResponse.json(
      { session },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Tu correo aún no está habilitado en el ERP.",
      "GET /api/erp/session"
    );
    return NextResponse.json(payload, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
