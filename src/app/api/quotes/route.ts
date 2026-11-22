import { NextRequest, NextResponse } from "next/server";
import {
  withAuthenticatedClient,
  withAuthenticatedTransaction,
} from "@/lib/auth";
import { resolveHttpError } from "@/lib/http-errors";
import { runIdempotentMutation } from "@/lib/idempotency";
import {
  convertQuoteToOrder,
  createQuote,
  listQuotes,
  updateQuote,
  updateQuoteStatus,
} from "@/lib/services/operations-and-modules";
import { parseBody, readRawJsonBody } from "@/lib/validation/parse";
import { quotesMutationSchema } from "@/lib/validation/quotes.schema";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

const QUOTE_ROLES = [
  "PARTNER_ADMIN",
  "PARTNER_MANAGER",
  "EXTERNAL_SELLER",
] as const;

export async function GET(req: NextRequest) {
  try {
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 250;

    const data = await withAuthenticatedClient(
      req,
      [...QUOTE_ROLES],
      async (client, actor) => {
        const quotes = await listQuotes(client, actor, limit);
        return { quotes };
      }
    );

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error cargando cotizaciones",
      "GET /api/quotes"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await readRawJsonBody(req);

    const result = await withAuthenticatedTransaction(
      req,
      [...QUOTE_ROLES],
      async (client, actor) => {
        const body = parseBody(quotesMutationSchema, rawBody);
        return runIdempotentMutation(
          client,
          req,
          actor,
          `quotes:${body.action}`,
          body,
          async () => {
            if (body.action === "create_quote") {
              return await createQuote(client, actor, {
                customerPartyId: body.customerPartyId ?? null,
                customerNameRaw: body.customerNameRaw ?? null,
                currency: body.currency || "PEN",
                taxRegime: body.taxRegime || "EXONERADA",
                globalDiscountPen: body.globalDiscountPen ?? 0,
                notes: body.notes ?? null,
                lines: body.lines,
              });
            }
            if (body.action === "update_quote") {
              return await updateQuote(client, actor, {
                quoteId: body.quoteId,
                customerPartyId: body.customerPartyId ?? null,
                customerNameRaw: body.customerNameRaw ?? null,
                globalDiscountPen: body.globalDiscountPen ?? 0,
                notes: body.notes ?? null,
                reason: body.reason ?? null,
                lines: body.lines,
              });
            }
            if (body.action === "update_status") {
              return await updateQuoteStatus(client, actor, {
                quoteId: body.quoteId,
                nextStatus: body.nextStatus,
              });
            }
            return await convertQuoteToOrder(client, actor, {
              quoteId: body.quoteId,
              paymentMode: body.paymentMode || "CASH",
              collectOnDelivery: Boolean(body.collectOnDelivery),
              creditDays: body.creditDays,
              promisedPaymentDate: body.promisedPaymentDate ?? null,
              initialPaidPen: body.initialPaidPen,
              paymentAccountId: body.paymentAccountId,
              tripId: body.tripId ?? null,
              notes: body.notes ?? undefined,
            });
          }
        );
      }
    );

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error procesando cotización",
      "POST /api/quotes"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}
