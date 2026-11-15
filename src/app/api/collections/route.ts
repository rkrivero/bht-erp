import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
import { assertRole } from "@/lib/rbac";
import {
  getOrderPaymentTimeline,
  listDebtors,
  registerCustomerFifoPayment,
  registerOrderPayment,
} from "@/lib/services/collections-and-treasury";
import { AuthorizationError, ValidationError } from "@/lib/types";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const actor = assertRole(verifySessionToken(token), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
      "EXTERNAL_SELLER",
    ]);

    const orderIdParam = req.nextUrl.searchParams.get("orderId");
    const data = await withClient(async (client) => {
      if (orderIdParam) {
        const timeline = await getOrderPaymentTimeline(
          client,
          actor,
          Number(orderIdParam)
        );
        return { timeline };
      }
      return await listDebtors(client, actor);
    });

    return NextResponse.json(data);
  } catch (err) {
    const status =
      err instanceof AuthorizationError
        ? 403
        : err instanceof ValidationError
        ? 400
        : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error en cobranzas" },
      { status }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const actor = assertRole(verifySessionToken(token), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
      "EXTERNAL_SELLER",
    ]);

    const body = await req.json();
    const mode = String(body.mode || "single_order");

    const result = await withTransaction(async (client) => {
      if (mode === "fifo_customer") {
        const allocations = await registerCustomerFifoPayment(client, actor, {
          customerPartyId: Number(body.customerPartyId),
          totalAmountPen: Number(body.totalAmountPen),
          paymentMode: body.paymentMode || "CASH",
          accountId: body.accountId ? Number(body.accountId) : undefined,
          notes: body.notes,
          nextCollectionDays: body.nextCollectionDays
            ? Number(body.nextCollectionDays)
            : undefined,
          nextPromisedPaymentDate: body.nextPromisedPaymentDate ?? null,
        });
        return { allocations };
      }

      return await registerOrderPayment(client, actor, {
        orderId: Number(body.orderId),
        amountPen: Number(body.amountPen),
        paymentMode: body.paymentMode || "CASH",
        accountId: body.accountId ? Number(body.accountId) : undefined,
        notes: body.notes,
        nextCollectionDays: body.nextCollectionDays
          ? Number(body.nextCollectionDays)
          : undefined,
        nextPromisedPaymentDate: body.nextPromisedPaymentDate ?? null,
      });
    });

    return NextResponse.json(result);
  } catch (err) {
    const status =
      err instanceof AuthorizationError
        ? 403
        : err instanceof ValidationError
        ? 400
        : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error registrando abono" },
      { status }
    );
  }
}
