import { NextRequest, NextResponse } from "next/server";
import {
  withAuthenticatedClient,
  withAuthenticatedTransaction,
} from "@/lib/auth";
import { resolveHttpError } from "@/lib/http-errors";
import { runIdempotentMutation } from "@/lib/idempotency";
import {
  createSupplier,
  getPurchasesDashboard,
  payApObligation,
  registerSupplierPurchase,
} from "@/lib/services/purchases-and-suppliers";
import { parseBody, readRawJsonBody } from "@/lib/validation/parse";
import { purchasesMutationSchema } from "@/lib/validation/purchases.schema";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

const PARTNER_ROLES = ["PARTNER_ADMIN", "PARTNER_MANAGER"] as const;

export async function GET(req: NextRequest) {
  try {
    const data = await withAuthenticatedClient(
      req,
      [...PARTNER_ROLES],
      async (client, actor) => {
        return await getPurchasesDashboard(client, actor);
      }
    );
    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error cargando compras y proveedores",
      "GET /api/purchases"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await readRawJsonBody(req);

    const result = await withAuthenticatedTransaction(
      req,
      [...PARTNER_ROLES],
      async (client, actor) => {
        const body = parseBody(purchasesMutationSchema, rawBody);
        return runIdempotentMutation(
          client,
          req,
          actor,
          `purchases:${body.action}`,
          body,
          async () => {
            if (body.action === "create_supplier") {
              return await createSupplier(client, actor, {
                legalName: body.legalName,
                tradeName: body.tradeName ?? null,
                docType:
                  (body.docType as
                    | "NONE"
                    | "RUC"
                    | "DNI"
                    | "CE"
                    | "PASSPORT") || "NONE",
                docNumber: body.docNumber ?? null,
                phone: body.phone ?? null,
                address: body.address ?? null,
                notes: body.notes ?? null,
              });
            }

            if (body.action === "register_purchase") {
              return await registerSupplierPurchase(client, actor, {
                supplierPartyId: body.supplierPartyId,
                docType: body.docType || "FACTURA",
                docSeries: body.docSeries || "",
                docNumber: body.docNumber || "",
                issueDate: body.issueDate,
                dueDate: body.dueDate ?? null,
                currency: body.currency,
                exchangeRate: body.exchangeRate,
                taxMode: body.taxMode,
                paymentCondition: body.paymentCondition,
                paidNowPen: body.paidNowPen,
                accountId: body.accountId,
                notes: body.notes,
                items: body.items,
                fulfillOrderLineIds: body.fulfillOrderLineIds,
              });
            }

            return await payApObligation(client, actor, {
              apId: body.apId,
              amountPen: body.amountPen,
              accountId: body.accountId,
              notes: body.notes,
            });
          }
        );
      }
    );

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error procesando compra o proveedor",
      "POST /api/purchases"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}
