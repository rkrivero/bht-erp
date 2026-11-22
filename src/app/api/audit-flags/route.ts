import { NextRequest, NextResponse } from "next/server";
import { withAuthenticatedClient, withAuthenticatedTransaction } from "@/lib/auth";
import { resolveHttpError } from "@/lib/http-errors";
import { runIdempotentMutation } from "@/lib/idempotency";
import {
  listAuditFlags,
  updateAuditFlagStatus,
} from "@/lib/services/operations-and-modules";
import { ValidationError } from "@/lib/types";
import { auditFlagsMutationSchema } from "@/lib/validation/audit-flags.schema";
import { parseBody, readRawJsonBody } from "@/lib/validation/parse";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

const FLAG_ROLES = ["PARTNER_ADMIN", "PARTNER_MANAGER"] as const;

export async function GET(req: NextRequest) {
  try {
    const statusParam = req.nextUrl.searchParams.get("status") || "ALL";
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 80;

    const data = await withAuthenticatedClient(
      req,
      [...FLAG_ROLES],
      async (client, actor) => {
        return await listAuditFlags(client, actor, {
          status: statusParam,
          limit,
        });
      }
    );

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
    const rawBody = await readRawJsonBody(req);

    const result = await withAuthenticatedTransaction(
      req,
      [...FLAG_ROLES],
      async (client, actor) => {
        const body = parseBody(auditFlagsMutationSchema, rawBody);
        const action = body.action;
        const nextStatus =
          action === "acknowledge"
            ? "ACKNOWLEDGED"
            : action === "resolve"
              ? "RESOLVED"
              : action === "reopen"
                ? "OPEN"
                : body.nextStatus;
        if (!nextStatus) {
          throw new ValidationError(
            "Estado destino inválido (OPEN, ACKNOWLEDGED o RESOLVED)"
          );
        }

        return runIdempotentMutation(
          client,
          req,
          actor,
          `audit-flags:${action}`,
          body,
          () =>
            updateAuditFlagStatus(client, actor, {
              flagId: body.flagId,
              nextStatus,
              resolutionNote: body.resolutionNote ?? null,
            })
        );
      }
    );

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
