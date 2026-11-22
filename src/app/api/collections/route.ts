import { NextRequest, NextResponse } from "next/server";
import {
  withAuthenticatedClient,
  withAuthenticatedTransaction,
} from "@/lib/auth";
import { resolveHttpError } from "@/lib/http-errors";
import { runIdempotentMutation } from "@/lib/idempotency";
import {
  getOrderPaymentTimeline,
  listDebtors,
  registerCustomerFifoPayment,
  registerOrderPayment,
} from "@/lib/services/collections-and-treasury";
import { parsePositiveInt } from "@/lib/types";
import { collectionsMutationSchema } from "@/lib/validation/collections.schema";
import { parseBody, readRawJsonBody } from "@/lib/validation/parse";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

const COLLECTION_ROLES = [
  "PARTNER_ADMIN",
  "PARTNER_MANAGER",
  "EXTERNAL_SELLER",
] as const;

export async function GET(req: NextRequest) {
  try {
    const orderIdParam = req.nextUrl.searchParams.get("orderId");
    const data = await withAuthenticatedClient(
      req,
      [...COLLECTION_ROLES],
      async (client, actor) => {
        if (orderIdParam) {
          const orderId = parsePositiveInt(orderIdParam, "Pedido");
          const timeline = await getOrderPaymentTimeline(client, actor, orderId);
          return { timeline };
        }
        return await listDebtors(client, actor);
      }
    );

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error en cobranzas",
      "GET /api/collections"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await readRawJsonBody(req);

    const result = await withAuthenticatedTransaction(
      req,
      [...COLLECTION_ROLES],
      async (client, actor) => {
        const body = parseBody(collectionsMutationSchema, rawBody);
        const mode = body.mode;

        return runIdempotentMutation(
          client,
          req,
          actor,
          `collections:${mode}`,
          body,
          async () => {
            if (body.mode === "fifo_customer") {
              const allocations = await registerCustomerFifoPayment(
                client,
                actor,
                {
                  customerPartyId: body.customerPartyId,
                  totalAmountPen: body.totalAmountPen,
                  paymentMode: body.paymentMode || "CASH",
                  accountId: body.accountId,
                  notes: body.notes,
                  nextCollectionDays: body.nextCollectionDays,
                  nextPromisedPaymentDate: body.nextPromisedPaymentDate ?? null,
                }
              );
              return { allocations };
            }

            return await registerOrderPayment(client, actor, {
              orderId: body.orderId,
              amountPen: body.amountPen,
              paymentMode: body.paymentMode || "CASH",
              accountId: body.accountId,
              notes: body.notes,
              nextCollectionDays: body.nextCollectionDays,
              nextPromisedPaymentDate: body.nextPromisedPaymentDate ?? null,
            });
          }
        );
      }
    );

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error registrando abono",
      "POST /api/collections"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}
