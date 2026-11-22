import { NextRequest, NextResponse } from "next/server";
import {
  withAuthenticatedClient,
  withAuthenticatedTransaction,
} from "@/lib/auth";
import { resolveHttpError } from "@/lib/http-errors";
import { runIdempotentMutation } from "@/lib/idempotency";
import {
  getDailyClosureDraft,
  saveDailyClosure,
} from "@/lib/services/daily-closure";
import { saveDailyClosureSchema } from "@/lib/validation/daily-closures.schema";
import { parseBody, readRawJsonBody } from "@/lib/validation/parse";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

const CLOSURE_ROLES = ["PARTNER_ADMIN", "PARTNER_MANAGER"] as const;

export async function GET(req: NextRequest) {
  try {
    const dateParam = req.nextUrl.searchParams.get("date");

    const data = await withAuthenticatedClient(
      req,
      [...CLOSURE_ROLES],
      async (client, actor) => {
        return await getDailyClosureDraft(client, actor, dateParam);
      }
    );

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
    const rawBody = await readRawJsonBody(req);

    const result = await withAuthenticatedTransaction(
      req,
      [...CLOSURE_ROLES],
      async (client, actor) => {
        const body = parseBody(saveDailyClosureSchema, rawBody);
        return runIdempotentMutation(
          client,
          req,
          actor,
          "treasury:daily_closure",
          body,
          () =>
            saveDailyClosure(client, actor, {
              closureDate: body.closureDate,
              accounts: body.accounts,
              applyReconciliationAdjustments: Boolean(
                body.applyReconciliationAdjustments
              ),
              nextDayNotes: body.nextDayNotes ?? null,
              notes: body.notes ?? null,
              correctionReason: body.correctionReason ?? null,
            })
        );
      }
    );

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
