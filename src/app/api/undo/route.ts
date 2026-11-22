import { NextRequest, NextResponse } from "next/server";
import {
  withAuthenticatedClient,
  withAuthenticatedTransaction,
} from "@/lib/auth";
import { resolveHttpError } from "@/lib/http-errors";
import { runIdempotentMutation } from "@/lib/idempotency";
import { executeUndoAction, listUndoableActions } from "@/lib/services/undo";
import { parsePositiveInt, ValidationError } from "@/lib/types";
import { parseBody, readRawJsonBody } from "@/lib/validation/parse";
import { undoMutationSchema } from "@/lib/validation/undo.schema";

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

    const data = await withAuthenticatedClient(
      req,
      [...ALL_ROLES],
      async (client, actor) => {
        return await listUndoableActions(client, actor, {
          scope,
          status,
          actionType,
          limit,
        });
      }
    );

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
    const rawBody = await readRawJsonBody(req);

    const result = await withAuthenticatedTransaction(
      req,
      [...ALL_ROLES],
      async (client, actor) => {
        const body = parseBody(undoMutationSchema, rawBody);
        return runIdempotentMutation(
          client,
          req,
          actor,
          "undo:execute",
          body,
          () =>
            executeUndoAction(client, actor, {
              undoId: body.undoId,
              reason: body.reason ?? null,
            })
        );
      }
    );

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
