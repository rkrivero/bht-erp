import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedERPActor, requireActiveSession } from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
import { resolveHttpError } from "@/lib/http-errors";
import { runIdempotentMutation } from "@/lib/idempotency";
import { assertRole } from "@/lib/rbac";
import { getDailyClosureDraft, saveDailyClosure } from "@/lib/services/daily-closure";
import { ValidationError } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(req), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
    ]);
    const dateParam = req.nextUrl.searchParams.get("date");

    const data = await withClient(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
      ]);
      return await getDailyClosureDraft(client, actor, dateParam);
    });

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error cargando cierre diario",
      "GET /api/daily-closures"
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
    const body = (await req.json()) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      throw new ValidationError("Cuerpo JSON inválido");
    }

    const result = await withTransaction(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
      ]);
      return runIdempotentMutation(
        client,
        req,
        actor,
        "treasury:daily_closure",
        body,
        () =>
          saveDailyClosure(client, actor, {
            closureDate: body.closureDate ? String(body.closureDate) : undefined,
            accounts: Array.isArray(body.accounts)
              ? (body.accounts as Array<{
                  accountId: number;
                  countedBalancePen: number;
                  notes?: string | null;
                }>)
              : [],
            applyReconciliationAdjustments: Boolean(
              body.applyReconciliationAdjustments
            ),
            nextDayNotes:
              body.nextDayNotes !== undefined && body.nextDayNotes !== null
                ? String(body.nextDayNotes)
                : null,
            notes:
              body.notes !== undefined && body.notes !== null
                ? String(body.notes)
                : null,
            correctionReason:
              body.correctionReason !== undefined && body.correctionReason !== null
                ? String(body.correctionReason)
                : null,
          })
      );
    });

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error guardando cierre diario",
      "POST /api/daily-closures"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}
