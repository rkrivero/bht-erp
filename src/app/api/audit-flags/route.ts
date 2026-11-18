import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedERPActor, requireActiveSession } from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
import { resolveHttpError } from "@/lib/http-errors";
import { assertRole } from "@/lib/rbac";
import {
  listAuditFlags,
  updateAuditFlagStatus,
} from "@/lib/services/operations-and-modules";
import { ValidationError } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(req), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
    ]);
    const statusParam = req.nextUrl.searchParams.get("status") || "ALL";
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 80;

    const data = await withClient(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
      ]);
      return await listAuditFlags(client, actor, {
        status: statusParam,
        limit,
      });
    });

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error cargando alertas operativas",
      "GET /api/audit-flags"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(req), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
    ]);

    const body = await req.json();
    const action = String(body.action || "update_status");

    const result = await withTransaction(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
      ]);
      if (
        action === "update_status" ||
        action === "acknowledge" ||
        action === "resolve" ||
        action === "reopen"
      ) {
        const nextStatus =
          action === "acknowledge"
            ? "ACKNOWLEDGED"
            : action === "resolve"
              ? "RESOLVED"
              : action === "reopen"
                ? "OPEN"
                : body.nextStatus;
        return await updateAuditFlagStatus(client, actor, {
          flagId: Number(body.flagId),
          nextStatus,
          resolutionNote: body.resolutionNote ?? null,
        });
      }
      throw new ValidationError(`Acción de alerta desconocida: ${action}`);
    });

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error actualizando alerta operativa",
      "POST /api/audit-flags"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}
