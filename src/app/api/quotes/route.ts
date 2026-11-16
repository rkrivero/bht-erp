import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  requireActiveSession,
  verifySessionToken,
} from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
import { assertRole } from "@/lib/rbac";
import {
  convertQuoteToOrder,
  createQuote,
  listQuotes,
  updateQuoteStatus,
} from "@/lib/services/operations-and-modules";
import { resolveHttpError, ValidationError } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const parsedActor = assertRole(verifySessionToken(token), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
      "EXTERNAL_SELLER",
    ]);
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 60;

    const data = await withClient(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
        "EXTERNAL_SELLER",
      ]);
      const quotes = await listQuotes(client, actor, limit);
      return { quotes };
    });

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, error } = resolveHttpError(err, "Error cargando cotizaciones");
    return NextResponse.json(
      { error },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const parsedActor = assertRole(verifySessionToken(token), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
      "EXTERNAL_SELLER",
    ]);

    const body = await req.json();
    const action = String(body.action || "");

    const result = await withTransaction(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
        "EXTERNAL_SELLER",
      ]);
      if (action === "create_quote") {
        return await createQuote(client, actor, {
          customerPartyId:
            body.customerPartyId !== undefined && body.customerPartyId !== ""
              ? Number(body.customerPartyId)
              : null,
          customerNameRaw: body.customerNameRaw ?? null,
          currency: body.currency || "PEN",
          taxRegime: body.taxRegime || "EXONERADA",
          notes: body.notes ?? null,
          lines: Array.isArray(body.lines) ? body.lines : [],
        });
      }
      if (action === "update_status") {
        return await updateQuoteStatus(client, actor, {
          quoteId: Number(body.quoteId),
          nextStatus: body.nextStatus,
        });
      }
      if (action === "convert_to_order") {
        return await convertQuoteToOrder(client, actor, {
          quoteId: Number(body.quoteId),
          paymentMode: body.paymentMode || "CASH",
          collectOnDelivery: Boolean(body.collectOnDelivery),
          creditDays:
            body.creditDays !== undefined && body.creditDays !== ""
              ? Number(body.creditDays)
              : undefined,
          promisedPaymentDate: body.promisedPaymentDate ?? null,
          initialPaidPen:
            body.initialPaidPen !== undefined && body.initialPaidPen !== ""
              ? Number(body.initialPaidPen)
              : undefined,
          paymentAccountId:
            body.paymentAccountId !== undefined && body.paymentAccountId !== ""
              ? Number(body.paymentAccountId)
              : undefined,
          tripId:
            body.tripId !== undefined && body.tripId !== ""
              ? Number(body.tripId)
              : null,
          notes: body.notes ? String(body.notes) : undefined,
        });
      }
      throw new ValidationError(`Acción de cotización desconocida: ${action}`);
    });

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, error } = resolveHttpError(err, "Error procesando cotización");
    return NextResponse.json(
      { error },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
