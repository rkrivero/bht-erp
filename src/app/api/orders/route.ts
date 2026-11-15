import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
import { assertRole } from "@/lib/rbac";
import {
  advanceWarehouseStatus,
  approveDiscountedOrder,
  cancelOrder,
  createOrder,
  listCatalogForRole,
  listOrdersForRole,
} from "@/lib/services/orders";
import { AuthorizationError, ValidationError } from "@/lib/types";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const actor = assertRole(verifySessionToken(token), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
      "EXTERNAL_SELLER",
      "WAREHOUSE_DELIVERY",
    ]);

    const data = await withClient(async (client) => {
      const orders = await listOrdersForRole(client, actor, 80);
      const catalog = await listCatalogForRole(client, actor);
      const customersRes =
        actor.role === "WAREHOUSE_DELIVERY"
          ? { rows: [] }
          : await client.query(
              `SELECT party_id, COALESCE(trade_name, legal_name) AS name, doc_number, phone, address
               FROM erp.parties
               WHERE party_type = 'CUSTOMER' AND is_active = TRUE
               ORDER BY COALESCE(trade_name, legal_name) ASC
               LIMIT 250`
            );
      const accountsRes =
        actor.role === "WAREHOUSE_DELIVERY"
          ? { rows: [] }
          : await client.query(
              `SELECT account_id, code, name, account_type
               FROM erp.cash_accounts
               WHERE is_active = TRUE
               ORDER BY account_id ASC`
            );
      return {
        orders,
        catalog,
        customers: customersRes.rows,
        accounts: accountsRes.rows,
      };
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
      { error: err instanceof Error ? err.message : "Error cargando pedidos" },
      { status }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const actor = verifySessionToken(token);
    if (!actor) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const body = await req.json();
    const action = String(body.action || "create");

    const result = await withTransaction(async (client) => {
      if (action === "create") {
        return await createOrder(client, actor, body);
      }
      if (action === "approve") {
        return await approveDiscountedOrder(client, actor, Number(body.orderId));
      }
      if (action === "advance") {
        await advanceWarehouseStatus(
          client,
          actor,
          Number(body.orderId),
          body.nextStatus
        );
        return { ok: true };
      }
      if (action === "cancel") {
        await cancelOrder(
          client,
          actor,
          Number(body.orderId),
          String(body.reason || "Anulado desde app")
        );
        return { ok: true };
      }
      if (action === "create_customer") {
        assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"]);
        const name = String(body.legalName || "").trim().toUpperCase();
        if (!name) throw new ValidationError("Nombre de cliente obligatorio");
        const key = `CUST_${name.replace(/[^A-Z0-9]+/g, "_").slice(0, 36)}_${Date.now() % 10000}`;
        const res = await client.query(
          `INSERT INTO erp.parties (canonical_key, party_type, doc_type, doc_number, legal_name, trade_name, phone, address, source_origin)
           VALUES ($1, 'CUSTOMER', 'NONE', $2, $3, $3, $4, $5, 'ERP_APP')
           RETURNING party_id, legal_name AS name`,
          [key, body.docNumber || null, name, body.phone || null, body.address || null]
        );
        return res.rows[0];
      }
      throw new ValidationError(`Acción desconocida: ${action}`);
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
      { error: err instanceof Error ? err.message : "Error procesando pedido" },
      { status }
    );
  }
}
