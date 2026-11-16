import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedERPActor,
  requireActiveSession,
} from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
import { runIdempotentMutation } from "@/lib/idempotency";
import { assertRole } from "@/lib/rbac";
import {
  getOrderPaymentTimeline,
  listDebtors,
  registerCustomerFifoPayment,
  registerOrderPayment,
} from "@/lib/services/collections-and-treasury";
import {
  parsePositiveInt,
  resolveHttpError,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
      "EXTERNAL_SELLER",
    ]);

    const orderIdParam = req.nextUrl.searchParams.get("orderId");
    const data = await withClient(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
        "EXTERNAL_SELLER",
      ]);
      if (orderIdParam) {
        const orderId = parsePositiveInt(orderIdParam, "Pedido");
        const timeline = await getOrderPaymentTimeline(
          client,
          actor,
          orderId
        );
        return { timeline };
      }
      return await listDebtors(client, actor);
    });

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, error } = resolveHttpError(err, "Error en cobranzas");
    return NextResponse.json(
      { error },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
      "EXTERNAL_SELLER",
    ]);

    const body = await req.json();
    const mode = String(body.mode || "single_order");
    const nextCollectionDays =
      body.nextCollectionDays === null
        ? null
        : body.nextCollectionDays !== undefined && body.nextCollectionDays !== ""
        ? Number(body.nextCollectionDays)
        : undefined;

    const result = await withTransaction(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
        "EXTERNAL_SELLER",
      ]);
      return runIdempotentMutation(
        client,
        req,
        actor,
        `collections:${mode}`,
        body,
        async () => {
          if (mode === "fifo_customer") {
            const allocations = await registerCustomerFifoPayment(client, actor, {
              customerPartyId: parsePositiveInt(
                body.customerPartyId,
                "Cliente"
              ),
              totalAmountPen: Number(body.totalAmountPen),
              paymentMode: body.paymentMode || "CASH",
              accountId: body.accountId
                ? parsePositiveInt(body.accountId, "Cuenta")
                : undefined,
              notes: body.notes,
              nextCollectionDays,
              nextPromisedPaymentDate: body.nextPromisedPaymentDate ?? null,
            });
            return { allocations };
          }

          return await registerOrderPayment(client, actor, {
            orderId: parsePositiveInt(body.orderId, "Pedido"),
            amountPen: Number(body.amountPen),
            paymentMode: body.paymentMode || "CASH",
            accountId: body.accountId
              ? parsePositiveInt(body.accountId, "Cuenta")
              : undefined,
            notes: body.notes,
            nextCollectionDays,
            nextPromisedPaymentDate: body.nextPromisedPaymentDate ?? null,
          });
        }
      );
    });

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, error, code, entityRef } = resolveHttpError(
      err,
      "Error registrando abono"
    );
    return NextResponse.json(
      { error, ...(code ? { code } : {}), ...(entityRef ? { entityRef } : {}) },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
