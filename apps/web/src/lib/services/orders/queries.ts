import type { PoolClient } from "pg";
import { assertRole, projectOrderForRole, projectProductForRole } from "../../rbac";
import {
  type RawOrderLineRow,
  type RawOrderWithLines,
  type RawProductRow,
  type SessionUser,
} from "../../types";

export interface OrdersPaginationMeta {
  limit: number;
  offset: number;
  totalCount: number;
  hasMore: boolean;
}

export interface OrdersListFilters {
  q?: string | null;
  status?: string | null;
}

export async function listOrdersPaginatedForRole(
  client: PoolClient,
  actor: SessionUser,
  limit = 60,
  offset = 0,
  customerPartyId: number | null = null,
  filters: OrdersListFilters = {}
): Promise<{
  orders: Record<string, unknown>[];
  pagination: OrdersPaginationMeta;
}> {
  assertRole(actor, [
    "PARTNER_ADMIN",
    "PARTNER_MANAGER",
    "EXTERNAL_SELLER",
    "WAREHOUSE_DELIVERY",
  ]);

  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit || 60)));
  const safeOffset = Math.max(0, Math.floor(offset || 0));
  const safeCustomerPartyId =
    customerPartyId !== null &&
    Number.isSafeInteger(customerPartyId) &&
    customerPartyId > 0
      ? customerPartyId
      : null;

  const filterClause =
    actor.role === "WAREHOUSE_DELIVERY"
      ? `WHERE so.operational_status NOT IN ('PENDING_PARTNER_APPROVAL', 'CANCELLED') AND so.source_origin = 'ERP_APP'`
      : actor.role === "EXTERNAL_SELLER"
        ? `WHERE so.operational_status <> 'CANCELLED'`
        : `WHERE TRUE`;

  const rawStatus = filters.status ? String(filters.status).trim().toUpperCase() : "";
  const validStatuses = new Set([
    "PENDING_PARTNER_APPROVAL",
    "REGISTERED",
    "PICKING",
    "READY",
    "IN_ROUTE",
    "DELIVERED",
    "CANCELLED",
  ]);
  const statusFilter =
    rawStatus && rawStatus !== "ALL" && validStatuses.has(rawStatus) ? rawStatus : null;
  const searchQuery = filters.q ? String(filters.q).trim().toLowerCase() : "";

  const extraParams: unknown[] = [];
  let extraWhere = "";
  if (statusFilter) {
    extraParams.push(statusFilter);
    extraWhere += ` AND so.operational_status::text = $${extraParams.length + 1}`;
  }
  if (searchQuery) {
    extraParams.push(`%${searchQuery}%`);
    const qIdx = extraParams.length + 1;
    extraWhere += ` AND (
      LOWER(so.order_code) LIKE $${qIdx}
      OR LOWER(COALESCE(so.customer_name_raw, '')) LIKE $${qIdx}
      OR EXISTS (
        SELECT 1 FROM erp.parties p_q
        WHERE p_q.party_id = so.customer_party_id
          AND (
            LOWER(COALESCE(p_q.trade_name, '')) LIKE $${qIdx}
            OR LOWER(COALESCE(p_q.legal_name, '')) LIKE $${qIdx}
            OR LOWER(COALESCE(p_q.city_zone, '')) LIKE $${qIdx}
          )
      )
    )`;
  }

  const scopedFilterClause = `${filterClause}
    AND ($1::bigint IS NULL OR so.customer_party_id = $1)${extraWhere}`;

  const countRes = await client.query<{ total_count: number }>(
    `SELECT COUNT(*)::int AS total_count
     FROM erp.sales_orders so
     ${scopedFilterClause}`,
    [safeCustomerPartyId, ...extraParams]
  );
  const totalCount = Number(countRes.rows[0]?.total_count ?? 0);

  const limitIdx = extraParams.length + 2;
  const offsetIdx = extraParams.length + 3;

  const ordersRes = await client.query(
    `SELECT
       so.order_id,
       so.order_code,
       so.order_date::text AS order_date,
       so.customer_party_id,
       COALESCE(pa.trade_name, pa.legal_name, so.customer_name_raw, 'CLIENTE') AS customer_name,
       pa.legal_name AS customer_legal_name,
       pa.trade_name AS customer_trade_name,
       pa.city_zone AS customer_zone,
       pa.address AS customer_address,
       pa.phone AS customer_phone,
       pa.geo_lat AS customer_geo_lat,
       pa.geo_lng AS customer_geo_lng,
       so.operational_status::text AS operational_status,
       so.trip_id,
       rt.trip_code,
       so.quote_id,
       so.payment_mode::text AS payment_mode,
       so.promised_payment_date::text AS promised_payment_date,
       so.total_pen,
       COALESCE(so.global_discount_pen, 0) AS global_discount_pen,
       so.paid_pen,
       so.balance_due_pen,
       so.is_settled,
       COALESCE(so.credit_limit_exceeded_flag, FALSE) AS credit_limit_exceeded_flag,
       so.notes,
       so.created_by_user_id,
       u_create.full_name AS created_by_name,
       so.created_at::text AS created_at,
       u_app.full_name AS approved_by_name,
       so.approved_at::text AS approved_at,
       u_pick.full_name AS picked_by_name,
       so.picked_at::text AS picked_at,
       u_deliv.full_name AS delivered_by_name,
       so.delivered_at::text AS delivered_at
     FROM erp.sales_orders so
     LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
     LEFT JOIN erp.route_trips rt ON rt.trip_id = so.trip_id
     LEFT JOIN erp.app_users u_create ON u_create.user_id = so.created_by_user_id
     LEFT JOIN erp.app_users u_app ON u_app.user_id = so.approved_by_user_id
     LEFT JOIN erp.app_users u_pick ON u_pick.user_id = so.picked_by_user_id
     LEFT JOIN erp.app_users u_deliv ON u_deliv.user_id = so.delivered_by_user_id
     ${scopedFilterClause}
     ORDER BY
       CASE WHEN so.source_origin = 'ERP_APP' THEN 0 ELSE 1 END ASC,
       so.order_date DESC,
       so.order_id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [safeCustomerPartyId, ...extraParams, safeLimit, safeOffset]
  );

  if (ordersRes.rowCount === 0) {
    return {
      orders: [],
      pagination: {
        limit: safeLimit,
        offset: safeOffset,
        totalCount,
        hasMore: false,
      },
    };
  }

  const orderIds = ordersRes.rows.map((r) => Number(r.order_id));
  const linesRes = await client.query(
    `SELECT
       sol.order_id,
       sol.order_line_id,
       sol.line_no,
       sol.product_id,
       p.sku,
       sol.raw_description,
       p.unit_of_measure,
       sol.quantity,
       COALESCE(sol.pack_factor_applied, 1) AS pack_factor_applied,
       COALESCE(sol.base_unit_price_pen, sol.unit_price_pen) AS base_unit_price_pen,
       COALESCE(sol.unit_discount_pen, 0) AS unit_discount_pen,
       sol.unit_price_pen,
       sol.line_total_pen,
       sol.unit_cost_snapshot_pen,
       p.fulfillment_mode::text AS fulfillment_mode,
       sol.fulfillment_status::text AS fulfillment_status,
       sol.below_min_price_flag
     FROM erp.sales_order_lines sol
     JOIN erp.products p ON p.product_id = sol.product_id
     WHERE sol.order_id = ANY($1::bigint[])
     ORDER BY sol.order_id ASC, sol.line_no ASC`,
    [orderIds]
  );

  const linesByOrder = new Map<number, RawOrderLineRow[]>();
  for (const row of linesRes.rows) {
    const oid = Number(row.order_id);
    if (!linesByOrder.has(oid)) linesByOrder.set(oid, []);
    linesByOrder.get(oid)!.push({
      order_line_id: Number(row.order_line_id),
      line_no: Number(row.line_no),
      product_id: Number(row.product_id),
      sku: String(row.sku),
      raw_description: String(row.raw_description),
      unit_of_measure: String(row.unit_of_measure || "NIU"),
      quantity: Number(row.quantity),
      pack_factor_applied: Number(row.pack_factor_applied ?? 1),
      base_unit_price_pen: Number(row.base_unit_price_pen),
      unit_discount_pen: Number(row.unit_discount_pen),
      unit_price_pen: Number(row.unit_price_pen),
      line_total_pen: Number(row.line_total_pen),
      unit_cost_snapshot_pen:
        row.unit_cost_snapshot_pen !== null ? Number(row.unit_cost_snapshot_pen) : null,
      fulfillment_mode: row.fulfillment_mode,
      fulfillment_status: row.fulfillment_status,
      below_min_price_flag: Boolean(row.below_min_price_flag),
    });
  }

  const auditRes = await client.query(
    `SELECT a.audit_id, a.order_id, a.action, a.actor_role, a.reason,
            a.created_at::text AS created_at, u.full_name AS actor_name
     FROM erp.sales_order_audit_log a
     LEFT JOIN erp.app_users u ON u.user_id = a.actor_user_id
     WHERE a.order_id = ANY($1::bigint[])
     ORDER BY a.order_id, a.created_at DESC`,
    [orderIds]
  );
  const auditByOrder = new Map<number, RawOrderWithLines["audit_history"]>();
  for (const row of auditRes.rows) {
    const orderId = Number(row.order_id);
    const history = auditByOrder.get(orderId) ?? [];
    history.push({
      audit_id: Number(row.audit_id),
      action: String(row.action),
      actor_name: row.actor_name ?? null,
      actor_role: String(row.actor_role),
      reason: String(row.reason),
      created_at: String(row.created_at),
    });
    auditByOrder.set(orderId, history);
  }

  const orders = ordersRes.rows.map((row) => {
    const rawOrder: RawOrderWithLines = {
      order_id: Number(row.order_id),
      order_code: String(row.order_code),
      order_date: String(row.order_date),
      customer_party_id:
        row.customer_party_id !== null ? Number(row.customer_party_id) : null,
      customer_name: String(row.customer_name),
      customer_legal_name: row.customer_legal_name ?? null,
      customer_trade_name: row.customer_trade_name ?? null,
      customer_zone: row.customer_zone ?? null,
      customer_address: row.customer_address ?? null,
      customer_phone: row.customer_phone ?? null,
      customer_geo_lat:
        row.customer_geo_lat !== null && row.customer_geo_lat !== undefined
          ? Number(row.customer_geo_lat)
          : null,
      customer_geo_lng:
        row.customer_geo_lng !== null && row.customer_geo_lng !== undefined
          ? Number(row.customer_geo_lng)
          : null,
      operational_status: row.operational_status,
      trip_id:
        row.trip_id !== null && row.trip_id !== undefined ? Number(row.trip_id) : null,
      trip_code: row.trip_code ?? null,
      quote_id:
        row.quote_id !== null && row.quote_id !== undefined
          ? Number(row.quote_id)
          : null,
      payment_mode: row.payment_mode,
      promised_payment_date: row.promised_payment_date ?? null,
      total_pen: Number(row.total_pen),
      global_discount_pen: Number(row.global_discount_pen ?? 0),
      paid_pen: Number(row.paid_pen),
      balance_due_pen: Number(row.balance_due_pen),
      is_settled: Boolean(row.is_settled),
      credit_limit_exceeded_flag: Boolean(row.credit_limit_exceeded_flag),
      notes: row.notes ?? null,
      created_by_user_id:
        row.created_by_user_id !== null ? Number(row.created_by_user_id) : null,
      created_by_name: row.created_by_name ?? null,
      audit_history: auditByOrder.get(Number(row.order_id)) ?? [],
      created_at: row.created_at ?? null,
      approved_by_name: row.approved_by_name ?? null,
      approved_at: row.approved_at ?? null,
      picked_by_name: row.picked_by_name ?? null,
      picked_at: row.picked_at ?? null,
      delivered_by_name: row.delivered_by_name ?? null,
      delivered_at: row.delivered_at ?? null,
      lines: linesByOrder.get(Number(row.order_id)) ?? [],
    };
    return projectOrderForRole(rawOrder, actor.role);
  });

  return {
    orders,
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      totalCount,
      hasMore: safeOffset + orders.length < totalCount,
    },
  };
}

export async function listOrdersForRole(
  client: PoolClient,
  actor: SessionUser,
  limit = 60,
  offset = 0
): Promise<Record<string, unknown>[]> {
  const { orders } = await listOrdersPaginatedForRole(client, actor, limit, offset);
  return orders;
}

export async function listCatalogForRole(
  client: PoolClient,
  actor: SessionUser
): Promise<Record<string, unknown>[]> {
  assertRole(actor, [
    "PARTNER_ADMIN",
    "PARTNER_MANAGER",
    "EXTERNAL_SELLER",
    "WAREHOUSE_DELIVERY",
  ]);
  const res = await client.query(
    `SELECT
       p.product_id,
       p.sku,
       p.name,
       p.unit_of_measure,
       p.fulfillment_mode::text AS fulfillment_mode,
       COALESCE(vcs.stock_on_hand, 0) AS stock_on_hand,
       p.list_sale_price_pen,
       p.min_sale_price_pen,
       p.ref_cost_pen,
       p.cost_updated_at::text AS cost_updated_at,
       p.default_supplier_party_id,
       p.lead_time_days,
       p.min_stock_qty,
       COALESCE(al.aliases, ARRAY[]::text[]) AS aliases
     FROM erp.products p
     JOIN erp.warehouses w
       ON w.code = 'MAIN' AND w.is_active = TRUE
     LEFT JOIN erp.v_current_stock vcs
       ON vcs.warehouse_id = w.warehouse_id AND vcs.product_id = p.product_id
     LEFT JOIN LATERAL (
       SELECT array_agg(DISTINCT pa.alias_raw ORDER BY pa.alias_raw) AS aliases
       FROM erp.product_aliases pa
       WHERE pa.product_id = p.product_id
     ) al ON TRUE
     WHERE p.is_active = TRUE
     ORDER BY p.name ASC`
  );

  return res.rows.map((r) =>
    projectProductForRole(
      {
        product_id: Number(r.product_id),
        sku: String(r.sku),
        name: String(r.name),
        unit_of_measure: String(r.unit_of_measure),
        fulfillment_mode: r.fulfillment_mode,
        stock_on_hand: Number(r.stock_on_hand),
        list_sale_price_pen:
          r.list_sale_price_pen !== null ? Number(r.list_sale_price_pen) : null,
        min_sale_price_pen:
          r.min_sale_price_pen !== null ? Number(r.min_sale_price_pen) : null,
        ref_cost_pen: r.ref_cost_pen !== null ? Number(r.ref_cost_pen) : null,
        cost_updated_at: r.cost_updated_at ? String(r.cost_updated_at) : null,
        default_supplier_party_id:
          r.default_supplier_party_id !== null &&
          r.default_supplier_party_id !== undefined
            ? Number(r.default_supplier_party_id)
            : null,
        lead_time_days:
          r.lead_time_days !== null && r.lead_time_days !== undefined
            ? Number(r.lead_time_days)
            : null,
        min_stock_qty:
          r.min_stock_qty !== null && r.min_stock_qty !== undefined
            ? Number(r.min_stock_qty)
            : null,
        aliases: Array.isArray(r.aliases) ? r.aliases.map(String) : [],
      } satisfies RawProductRow,
      actor.role
    )
  );
}
