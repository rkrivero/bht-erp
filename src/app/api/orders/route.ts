import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  requireActiveSession,
  verifySessionToken,
} from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
import { assertRole } from "@/lib/rbac";
import {
  advanceWarehouseStatus,
  approveDiscountedOrder,
  cancelOrder,
  createOrder,
  listCatalogForRole,
  listOrdersPaginatedForRole,
} from "@/lib/services/orders";
import {
  parsePositiveInt,
  resolveHttpError,
  ValidationError,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const parsedActor = assertRole(verifySessionToken(token), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
      "EXTERNAL_SELLER",
      "WAREHOUSE_DELIVERY",
    ]);

    const limitParam = req.nextUrl.searchParams.get("limit");
    const offsetParam = req.nextUrl.searchParams.get("offset");
    const limit = limitParam
      ? parsePositiveInt(limitParam, "Límite")
      : 80;
    const offset =
      offsetParam !== null && offsetParam !== ""
        ? Number(offsetParam)
        : 0;
    if (!Number.isInteger(offset) || offset < 0) {
      throw new ValidationError("Offset inválido");
    }

    const data = await withClient(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
        "EXTERNAL_SELLER",
        "WAREHOUSE_DELIVERY",
      ]);
      const currentUser = {
        userId: actor.userId,
        username: actor.username,
        fullName: actor.fullName,
        role: actor.role,
      };
      const { orders, pagination } = await listOrdersPaginatedForRole(
        client,
        actor,
        Math.min(200, limit),
        offset
      );
      if (actor.role === "WAREHOUSE_DELIVERY") {
        return {
          currentUser,
          orders,
          pagination,
          catalog: [],
          customers: [],
          accounts: [],
        };
      }
      const catalog = await listCatalogForRole(client, actor);
      const refsRes = await client.query<{
        customers: Array<Record<string, unknown>>;
        accounts: Array<Record<string, unknown>>;
      }>(
        `WITH account_balances AS (
           SELECT
             account_id,
             COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_pen ELSE -amount_pen END), 0)::NUMERIC(14,2) AS current_balance_pen
           FROM erp.cash_ledger
           GROUP BY account_id
         )
         SELECT
           COALESCE((
             SELECT json_agg(t)
             FROM (
               SELECT party_id, COALESCE(trade_name, legal_name) AS name, doc_number, phone, address
               FROM erp.parties
               WHERE party_type IN ('CUSTOMER', 'BOTH') AND is_active = TRUE
               ORDER BY COALESCE(trade_name, legal_name) ASC
               LIMIT 250
             ) t
           ), '[]'::json) AS customers,
           COALESCE((
             SELECT json_agg(t)
             FROM (
               SELECT
                 ca.account_id,
                 ca.code,
                 ca.name,
                 ca.account_type,
                 COALESCE(ab.current_balance_pen, 0)::NUMERIC(14,2) AS current_balance_pen
               FROM erp.cash_accounts ca
               LEFT JOIN account_balances ab ON ab.account_id = ca.account_id
               WHERE ca.is_active = TRUE
                 AND ($1::boolean OR ca.account_type <> 'PARTNER_CUSTODY')
               ORDER BY ca.account_id ASC
             ) t
           ), '[]'::json) AS accounts`,
        [actor.role !== "EXTERNAL_SELLER"]
      );
      const refs = refsRes.rows[0] ?? { customers: [], accounts: [] };
      return {
        currentUser,
        orders,
        pagination,
        catalog,
        customers: refs.customers ?? [],
        accounts: refs.accounts ?? [],
      };
    });

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, error } = resolveHttpError(err, "Error cargando pedidos");
    return NextResponse.json(
      { error },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const parsedActor = verifySessionToken(token);
    if (!parsedActor) {
      return NextResponse.json(
        { error: "No autenticado" },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    const body = await req.json();
    const action = String(body.action || "create");

    const result = await withTransaction(async (client) => {
      const actor = await requireActiveSession(client, parsedActor);
      if (action === "create") {
        return await createOrder(client, actor, body);
      }
      if (action === "approve") {
        const orderId = parsePositiveInt(body.orderId, "Pedido");
        return await approveDiscountedOrder(client, actor, orderId);
      }
      if (action === "advance") {
        const orderId = parsePositiveInt(body.orderId, "Pedido");
        await advanceWarehouseStatus(
          client,
          actor,
          orderId,
          body.nextStatus
        );
        return { ok: true };
      }
      if (action === "cancel") {
        const orderId = parsePositiveInt(body.orderId, "Pedido");
        await cancelOrder(
          client,
          actor,
          orderId,
          String(body.reason || "Anulado desde app")
        );
        return { ok: true };
      }
      if (action === "log_cancelled_draft") {
        assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"]);
        const reasonCode = String(body.reasonCode || "").trim();
        const reasonLabel = String(body.reasonLabel || "").trim();
        if (!reasonCode || !reasonLabel) {
          throw new ValidationError("Selecciona un motivo de cancelación");
        }
        const details = {
          actorUserId: actor.userId,
          actorName: actor.fullName,
          actorRole: actor.role,
          customerName: String(body.customerName || "").trim() || null,
          paymentMode: body.paymentMode ? String(body.paymentMode) : null,
          estimatedTotalPen: Number(body.estimatedTotalPen || 0),
          itemCount: Number(body.itemCount || 0),
          items: Array.isArray(body.items) ? body.items.slice(0, 50) : [],
          reasonCode,
          reasonLabel,
          notes: String(body.notes || "").trim() || null,
        };
        const flagRes = await client.query<{ flag_id: string }>(
          `INSERT INTO erp.audit_flags
             (flag_code, severity, entity_table, entity_id, message, details, status, resolved_at, resolved_by, source_origin)
           VALUES
             ('CANCELLED_ORDER_DRAFT', 'INFO', 'sales_orders_draft', $1, $2, $3::jsonb, 'RESOLVED', NOW(), $4, 'ERP_APP')
           RETURNING flag_id::text AS flag_id`,
          [
            `${actor.userId}:${Date.now()}`,
            `Pedido cancelado antes de registrar: ${reasonLabel}`.slice(0, 240),
            JSON.stringify(details),
            actor.username,
          ]
        );
        return { ok: true, flagId: flagRes.rows[0]?.flag_id ?? null };
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

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, error } = resolveHttpError(err, "Error procesando pedido");
    return NextResponse.json(
      { error },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
