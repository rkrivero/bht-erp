import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedERPActor, requireActiveSession } from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
import { resolveHttpError } from "@/lib/http-errors";
import { runIdempotentMutation } from "@/lib/idempotency";
import { assertRole } from "@/lib/rbac";
import { createCustomer } from "@/lib/services/customers";
import {
  advanceWarehouseStatus,
  approveDiscountedOrder,
  cancelOrder,
  createOrder,
  listCatalogForRole,
  listOrdersPaginatedForRole,
  updateOrder,
} from "@/lib/services/orders";
import { parsePositiveInt, ValidationError } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(req), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
      "EXTERNAL_SELLER",
      "WAREHOUSE_DELIVERY",
    ]);

    const limitParam = req.nextUrl.searchParams.get("limit");
    const offsetParam = req.nextUrl.searchParams.get("offset");
    const limit = limitParam ? parsePositiveInt(limitParam, "Límite") : 80;
    const offset = offsetParam !== null && offsetParam !== "" ? Number(offsetParam) : 0;
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
               SELECT
                 pa.party_id,
                 COALESCE(pa.trade_name, pa.legal_name) AS name,
                 pa.legal_name,
                 pa.trade_name,
                 pa.doc_type::text AS doc_type,
                 pa.doc_number,
                 pa.is_generic_doc,
                 pa.phone,
                 pa.email,
                 pa.address,
                 pa.city_zone,
                 pa.notes,
                 pa.geo_lat,
                 pa.geo_lng,
                 EXISTS(
                   SELECT 1 FROM erp.sales_orders so WHERE so.customer_party_id = pa.party_id
                 ) AS has_orders,
                 COALESCE((
                   SELECT array_agg(al.alias_raw ORDER BY al.alias_id)
                   FROM erp.party_aliases al
                   WHERE al.party_id = pa.party_id
                 ), ARRAY[]::text[]) AS aliases
               FROM erp.parties pa
               WHERE pa.party_type IN ('CUSTOMER', 'BOTH') AND pa.is_active = TRUE
               ORDER BY COALESCE(pa.trade_name, pa.legal_name) ASC
               LIMIT 1000
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
    const { status, ...payload } = resolveHttpError(
      err,
      "Error cargando pedidos",
      "GET /api/orders"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsedActor = await getAuthenticatedERPActor(req);
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
      return runIdempotentMutation(
        client,
        req,
        actor,
        `orders:${action}`,
        body,
        async () => {
          if (action === "create") {
            return await createOrder(client, actor, body);
          }
          if (action === "update") {
            const orderId = parsePositiveInt(body.orderId, "Pedido");
            return await updateOrder(client, actor, orderId, {
              lines: body.lines,
              reason: String(body.reason || "AJUSTE_OPERATIVO"),
            });
          }
          if (action === "approve") {
            const orderId = parsePositiveInt(body.orderId, "Pedido");
            return await approveDiscountedOrder(client, actor, orderId);
          }
          if (action === "advance") {
            const orderId = parsePositiveInt(body.orderId, "Pedido");
            await advanceWarehouseStatus(client, actor, orderId, body.nextStatus);
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
            const { customer } = await createCustomer(client, actor, {
              tradeName: body.tradeName ?? null,
              legalName: body.legalName ?? null,
              docType: body.docType ?? null,
              docNumber: body.docNumber ?? null,
              phone: body.phone ?? null,
              email: body.email ?? null,
              address: body.address ?? null,
              cityZone: body.cityZone ?? null,
              notes: body.notes ?? null,
              geoLat:
                body.geoLat !== undefined && body.geoLat !== null && body.geoLat !== ""
                  ? Number(body.geoLat)
                  : null,
              geoLng:
                body.geoLng !== undefined && body.geoLng !== null && body.geoLng !== ""
                  ? Number(body.geoLng)
                  : null,
              geoAccuracyM:
                body.geoAccuracyM !== undefined &&
                body.geoAccuracyM !== null &&
                body.geoAccuracyM !== ""
                  ? Number(body.geoAccuracyM)
                  : null,
            });
            return {
              party_id: customer.party_id,
              name: customer.display_name,
              customer,
            };
          }
          throw new ValidationError(`Acción desconocida: ${action}`);
        }
      );
    });

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error procesando pedido",
      "POST /api/orders"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}
