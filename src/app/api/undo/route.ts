import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedERPActor, requireActiveSession } from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
import { resolveHttpError } from "@/lib/http-errors";
import { assertRole } from "@/lib/rbac";
import { executeUndoAction, listUndoableActions } from "@/lib/services/undo";
import { parsePositiveInt, ValidationError } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

const ALL_ROLES = [
  "PARTNER_ADMIN",
  "PARTNER_MANAGER",
  "EXTERNAL_SELLER",
  "WAREHOUSE_DELIVERY",
] as const;

export async function GET(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(req), [...ALL_ROLES]);

    const rawScope = req.nextUrl.searchParams.get("scope")?.trim().toLowerCase();
    const scope = rawScope === "all" || rawScope === "mine" ? rawScope : undefined;
    if (rawScope && rawScope !== "all" && rawScope !== "mine") {
      throw new ValidationError("Parámetro scope inválido (use 'mine' o 'all')");
    }

    const rawStatus = req.nextUrl.searchParams.get("status")?.trim().toUpperCase();
    const status =
      rawStatus === "PENDING" || rawStatus === "UNDONE" || rawStatus === "ALL"
        ? rawStatus
        : undefined;
    if (rawStatus && !status) {
      throw new ValidationError(
        "Parámetro status inválido (use PENDING, UNDONE o ALL)"
      );
    }

    const actionType = req.nextUrl.searchParams.get("actionType")?.trim() || null;
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam ? parsePositiveInt(limitParam, "Límite") : undefined;

    const data = await withClient(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        ...ALL_ROLES,
      ]);
      return await listUndoableActions(client, actor, {
        scope,
        status,
        actionType,
        limit,
      });
    });

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error cargando historial de acciones reversibles",
      "GET /api/undo"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(req), [...ALL_ROLES]);
    const body = await req.json();
    const undoId = parsePositiveInt(body.undoId, "Acción a deshacer");
    const reason =
      body.reason !== undefined && body.reason !== null ? String(body.reason) : null;

    const result = await withTransaction(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        ...ALL_ROLES,
      ]);
      return await executeUndoAction(client, actor, { undoId, reason });
    });

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error al deshacer la acción",
      "POST /api/undo"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}
