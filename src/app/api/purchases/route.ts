import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedERPActor, requireActiveSession } from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
import { assertRole } from "@/lib/rbac";
import {
  createSupplier,
  getPurchasesDashboard,
  payApObligation,
  registerSupplierPurchase,
} from "@/lib/services/purchases-and-suppliers";
import { resolveHttpError, ValidationError } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  void req;
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(req), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
    ]);

    const data = await withClient(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
      ]);
      return await getPurchasesDashboard(client, actor);
    });
    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, error } = resolveHttpError(
      err,
      "Error cargando compras y proveedores"
    );
    return NextResponse.json({ error }, { status, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(req), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
    ]);

    const body = await req.json();
    const action = String(body.action || "");

    const result = await withTransaction(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
      ]);
      if (action === "create_supplier") {
        return await createSupplier(client, actor, {
          legalName: String(body.legalName || ""),
          tradeName: body.tradeName ?? null,
          docType: body.docType || "NONE",
          docNumber: body.docNumber ?? null,
          phone: body.phone ?? null,
          address: body.address ?? null,
          notes: body.notes ?? null,
        });
      }

      if (action === "register_purchase") {
        return await registerSupplierPurchase(client, actor, {
          supplierPartyId: Number(body.supplierPartyId),
          docType: String(body.docType || "FACTURA"),
          docSeries: String(body.docSeries || ""),
          docNumber: String(body.docNumber || ""),
          issueDate: body.issueDate ? String(body.issueDate) : undefined,
          dueDate: body.dueDate ? String(body.dueDate) : null,
          currency: body.currency
            ? (String(body.currency).toUpperCase() as "PEN" | "USD")
            : "PEN",
          exchangeRate:
            body.exchangeRate !== undefined && body.exchangeRate !== ""
              ? Number(body.exchangeRate)
              : undefined,
          taxMode: body.taxMode
            ? (String(body.taxMode).toUpperCase() as "NONE" | "INCLUDED" | "EXCLUDED")
            : "NONE",
          paymentCondition: body.paymentCondition,
          paidNowPen:
            body.paidNowPen !== undefined && body.paidNowPen !== ""
              ? Number(body.paidNowPen)
              : undefined,
          accountId:
            body.accountId !== undefined && body.accountId !== ""
              ? Number(body.accountId)
              : undefined,
          notes: body.notes ? String(body.notes) : undefined,
          items: Array.isArray(body.items) ? body.items : [],
          fulfillOrderLineIds: Array.isArray(body.fulfillOrderLineIds)
            ? body.fulfillOrderLineIds.map(Number)
            : undefined,
        });
      }

      if (action === "pay_ap_obligation") {
        return await payApObligation(client, actor, {
          apId: Number(body.apId),
          amountPen: Number(body.amountPen),
          accountId:
            body.accountId !== undefined && body.accountId !== ""
              ? Number(body.accountId)
              : undefined,
          notes: body.notes ? String(body.notes) : undefined,
        });
      }

      throw new ValidationError(`Acción desconocida: ${action}`);
    });

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, error } = resolveHttpError(
      err,
      "Error procesando compra o proveedor"
    );
    return NextResponse.json({ error }, { status, headers: NO_STORE_HEADERS });
  }
}
