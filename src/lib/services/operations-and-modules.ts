import type { PoolClient } from "pg";
import {
  formatAuditFlagCodeEs,
  formatAuditFlagStatusEs,
  formatRouteTripStatusEs,
} from "../labels-es";
import { assertRole, isPartnerRole } from "../rbac";
import {
  AuthorizationError,
  ValidationError,
  parseNonNegativeNumber,
  parsePositiveInt,
  parsePositiveNumber,
  type PaymentMode,
  type SessionUser,
} from "../types";
import { advanceWarehouseStatus, createOrder, getLimaDateString } from "./orders";
import { recordPriceOverrides } from "./price-audit";
import { recordUndoableAction, type UndoActionReceipt } from "./undo";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertOptionalDate(
  val: string | null | undefined,
  label: string
): string | null {
  if (val === undefined || val === null || val.trim() === "") return null;
  const trimmed = val.trim();
  if (!DATE_RE.test(trimmed)) {
    throw new ValidationError(`${label} debe tener formato YYYY-MM-DD`);
  }
  return trimmed;
}

export interface AuditFlagRow {
  flag_id: number;
  flag_code: string;
  severity: string;
  entity_table: string;
  entity_id: string;
  message: string;
  details: Record<string, unknown>;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  source_origin: string;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

export const AUDIT_FLAG_COUNTS_SELECT = `(
  SELECT json_build_object(
    'open_cnt', COUNT(*) FILTER (WHERE status = 'OPEN')::int,
    'ack_cnt', COUNT(*) FILTER (WHERE status = 'ACKNOWLEDGED')::int,
    'res_cnt', COUNT(*) FILTER (WHERE status = 'RESOLVED')::int
  )
  FROM erp.audit_flags
)`;

export function buildAuditFlagsSelect(
  statusParam = "'ALL'",
  limitParam = "80"
): string {
  return `COALESCE((
    SELECT json_agg(t)
    FROM (
      SELECT
        flag_id,
        flag_code,
        severity::text AS severity,
        entity_table,
        entity_id,
        message,
        details,
        status,
        source_origin::text AS source_origin,
        created_at::text AS created_at,
        acknowledged_at::text AS acknowledged_at,
        acknowledged_by,
        resolved_at::text AS resolved_at,
        resolved_by,
        resolution_note
      FROM erp.audit_flags
      WHERE (${statusParam} = 'ALL' OR status = ${statusParam})
      ORDER BY
        CASE status WHEN 'OPEN' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 ELSE 2 END ASC,
        created_at DESC,
        flag_id DESC
      LIMIT ${limitParam}
    ) t
  ), '[]'::json)`;
}

export function mapAuditFlagRow(r: Record<string, unknown>): AuditFlagRow {
  return {
    flag_id: Number(r.flag_id),
    flag_code: String(r.flag_code),
    severity: String(r.severity),
    entity_table: String(r.entity_table),
    entity_id: String(r.entity_id),
    message: String(r.message),
    details:
      r.details && typeof r.details === "object"
        ? (r.details as Record<string, unknown>)
        : {},
    status: String(r.status) as AuditFlagRow["status"],
    source_origin: String(r.source_origin),
    created_at: String(r.created_at),
    acknowledged_at: r.acknowledged_at ? String(r.acknowledged_at) : null,
    acknowledged_by: r.acknowledged_by ? String(r.acknowledged_by) : null,
    resolved_at: r.resolved_at ? String(r.resolved_at) : null,
    resolved_by: r.resolved_by ? String(r.resolved_by) : null,
    resolution_note: r.resolution_note ? String(r.resolution_note) : null,
  };
}

export function mapAuditFlagCounts(raw: unknown): {
  open: number;
  acknowledged: number;
  resolved: number;
} {
  const row = (raw && typeof raw === "object" ? raw : {}) as {
    open_cnt?: number;
    ack_cnt?: number;
    res_cnt?: number;
  };
  return {
    open: Number(row.open_cnt ?? 0),
    acknowledged: Number(row.ack_cnt ?? 0),
    resolved: Number(row.res_cnt ?? 0),
  };
}

export async function listAuditFlags(
  client: PoolClient,
  actor: SessionUser,
  options: { status?: string; limit?: number } = {}
): Promise<{
  flags: AuditFlagRow[];
  counts: { open: number; acknowledged: number; resolved: number };
}> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);

  const rawStatus = String(options.status || "ALL")
    .trim()
    .toUpperCase();
  if (!["ALL", "OPEN", "ACKNOWLEDGED", "RESOLVED"].includes(rawStatus)) {
    throw new ValidationError("Estado de alerta inválido");
  }
  const safeLimit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 80)));

  const res = await client.query<{
    counts: unknown;
    flags: Array<Record<string, unknown>>;
  }>(
    `SELECT
       ${AUDIT_FLAG_COUNTS_SELECT} AS counts,
       ${buildAuditFlagsSelect("$1", "$2")} AS flags`,
    [rawStatus, safeLimit]
  );

  const row = res.rows[0];
  return {
    flags: (row?.flags ?? []).map(mapAuditFlagRow),
    counts: mapAuditFlagCounts(row?.counts),
  };
}

export async function updateAuditFlagStatus(
  client: PoolClient,
  actor: SessionUser,
  input: {
    flagId: number;
    nextStatus: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
    resolutionNote?: string | null;
  }
): Promise<{
  flagId: number;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  undoAction?: UndoActionReceipt;
}> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);
  const flagId = parsePositiveInt(input.flagId, "Alerta");
  const nextStatus = String(input.nextStatus || "")
    .trim()
    .toUpperCase();
  if (!["OPEN", "ACKNOWLEDGED", "RESOLVED"].includes(nextStatus)) {
    throw new ValidationError(
      "Estado destino inválido (OPEN, ACKNOWLEDGED o RESOLVED)"
    );
  }
  const note = input.resolutionNote?.trim() || null;

  const lockRes = await client.query<{
    flag_id: string;
    flag_code: string;
    status: string;
    acknowledged_at: string | null;
    acknowledged_by: string | null;
    resolved_at: string | null;
    resolved_by: string | null;
    resolution_note: string | null;
  }>(
    `SELECT flag_id::text, flag_code, status,
            acknowledged_at::text, acknowledged_by,
            resolved_at::text, resolved_by, resolution_note
     FROM erp.audit_flags
     WHERE flag_id = $1
     FOR UPDATE`,
    [flagId]
  );
  if (lockRes.rowCount === 0) {
    throw new ValidationError("Alerta no encontrada");
  }
  const prev = lockRes.rows[0];

  if (nextStatus === "ACKNOWLEDGED") {
    await client.query(
      `UPDATE erp.audit_flags
       SET status = 'ACKNOWLEDGED',
           acknowledged_at = COALESCE(acknowledged_at, NOW()),
           acknowledged_by = COALESCE(acknowledged_by, $2),
           resolution_note = COALESCE($3, resolution_note)
       WHERE flag_id = $1`,
      [flagId, actor.username, note]
    );
  } else if (nextStatus === "RESOLVED") {
    await client.query(
      `UPDATE erp.audit_flags
       SET status = 'RESOLVED',
           resolved_at = NOW(),
           resolved_by = $2,
           resolution_note = COALESCE($3, resolution_note)
       WHERE flag_id = $1`,
      [flagId, actor.username, note]
    );
  } else {
    await client.query(
      `UPDATE erp.audit_flags
       SET status = 'OPEN',
           resolved_at = NULL,
           resolved_by = NULL,
           resolution_note = COALESCE($2, resolution_note)
       WHERE flag_id = $1`,
      [flagId, note]
    );
  }

  const undoAction =
    prev.status !== nextStatus
      ? await recordUndoableAction(client, actor, {
          actionType: "AUDIT_FLAG_STATUS",
          entityTable: "erp.audit_flags",
          entityId: flagId,
          entityCode: prev.flag_code,
          summary: `Cambió alerta #${flagId} (${formatAuditFlagCodeEs(prev.flag_code)}) de ${formatAuditFlagStatusEs(prev.status)} a ${formatAuditFlagStatusEs(nextStatus)}`,
          undoPayload: {
            flagId,
            flagCode: prev.flag_code,
            previousStatus: prev.status,
            nextStatus,
            previousAcknowledgedAt: prev.acknowledged_at,
            previousAcknowledgedBy: prev.acknowledged_by,
            previousResolvedAt: prev.resolved_at,
            previousResolvedBy: prev.resolved_by,
            previousResolutionNote: prev.resolution_note,
          },
        })
      : undefined;

  return {
    flagId,
    status: nextStatus as "OPEN" | "ACKNOWLEDGED" | "RESOLVED",
    undoAction,
  };
}

export async function listRouteTrips(
  client: PoolClient,
  actor: SessionUser,
  limit = 40
): Promise<Record<string, unknown>[]> {
  assertRole(actor, [
    "PARTNER_ADMIN",
    "PARTNER_MANAGER",
    "WAREHOUSE_DELIVERY",
    "EXTERNAL_SELLER",
  ]);
  const safeLimit = Math.max(1, Math.min(120, Math.floor(limit || 40)));
  const partnerView = isPartnerRole(actor.role);

  const res = await client.query(
    `SELECT
       rt.trip_id,
       rt.trip_code,
       rt.trip_date::text AS trip_date,
       rt.end_date::text AS end_date,
       rt.zone_name,
       rt.driver_name,
       rt.warehouse_id,
       rt.cash_account_id,
       rt.status::text AS status,
       rt.declared_gross_sales_pen,
       rt.declared_route_opex_pen,
       rt.declared_net_cash_pen,
       rt.source_origin::text AS source_origin,
       rt.notes,
       COUNT(so.order_id) FILTER (WHERE so.operational_status <> 'CANCELLED')::int AS order_count,
       COUNT(so.order_id) FILTER (WHERE so.operational_status = 'READY')::int AS ready_count,
       COUNT(so.order_id) FILTER (WHERE so.operational_status = 'IN_ROUTE')::int AS in_route_count,
       COUNT(so.order_id) FILTER (WHERE so.operational_status = 'DELIVERED')::int AS delivered_count,
       COALESCE(SUM(so.total_pen) FILTER (WHERE so.operational_status <> 'CANCELLED'), 0)::numeric(14,2) AS computed_sales_pen,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             so2.order_id,
             so2.order_code,
             COALESCE(pa.trade_name, pa.legal_name, so2.customer_name_raw, 'CLIENTE') AS customer_name,
             so2.operational_status::text AS operational_status
           FROM erp.sales_orders so2
           LEFT JOIN erp.parties pa ON pa.party_id = so2.customer_party_id
           WHERE so2.trip_id = rt.trip_id
             AND so2.operational_status <> 'CANCELLED'
           ORDER BY so2.order_id DESC
         ) t
       ), '[]'::json) AS orders
     FROM erp.route_trips rt
     LEFT JOIN erp.sales_orders so ON so.trip_id = rt.trip_id
     GROUP BY rt.trip_id
     ORDER BY
       CASE WHEN rt.status = 'OPEN' THEN 0 WHEN rt.status = 'CLOSED' THEN 1 ELSE 2 END ASC,
       rt.trip_date DESC,
       rt.trip_id DESC
     LIMIT $1`,
    [safeLimit]
  );

  return res.rows.map((r) => {
    const base: Record<string, unknown> = {
      trip_id: Number(r.trip_id),
      trip_code: String(r.trip_code),
      trip_date: String(r.trip_date),
      end_date: r.end_date ? String(r.end_date) : null,
      zone_name: r.zone_name ? String(r.zone_name) : null,
      driver_name: r.driver_name ? String(r.driver_name) : null,
      warehouse_id: Number(r.warehouse_id),
      cash_account_id:
        r.cash_account_id !== null && r.cash_account_id !== undefined
          ? Number(r.cash_account_id)
          : null,
      status: String(r.status),
      source_origin: String(r.source_origin),
      notes: r.notes ? String(r.notes) : null,
      order_count: Number(r.order_count ?? 0),
      ready_count: Number(r.ready_count ?? 0),
      in_route_count: Number(r.in_route_count ?? 0),
      delivered_count: Number(r.delivered_count ?? 0),
      orders: Array.isArray(r.orders) ? r.orders : [],
    };
    if (partnerView) {
      base.computed_sales_pen = Number(r.computed_sales_pen ?? 0);
      base.declared_gross_sales_pen =
        r.declared_gross_sales_pen !== null && r.declared_gross_sales_pen !== undefined
          ? Number(r.declared_gross_sales_pen)
          : null;
      base.declared_route_opex_pen =
        r.declared_route_opex_pen !== null && r.declared_route_opex_pen !== undefined
          ? Number(r.declared_route_opex_pen)
          : null;
      base.declared_net_cash_pen =
        r.declared_net_cash_pen !== null && r.declared_net_cash_pen !== undefined
          ? Number(r.declared_net_cash_pen)
          : null;
    }
    return base;
  });
}

export async function createRouteTrip(
  client: PoolClient,
  actor: SessionUser,
  input: {
    tripDate?: string | null;
    zoneName?: string | null;
    driverName?: string | null;
    cashAccountId?: number | null;
    notes?: string | null;
  }
): Promise<{ tripId: number; tripCode: string; status: "OPEN" }> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "WAREHOUSE_DELIVERY"]);

  const tripDate =
    assertOptionalDate(input.tripDate, "Fecha de ruta") ?? getLimaDateString(0);
  const zoneName = input.zoneName?.trim() || "RUTA LOCAL";
  const driverName = input.driverName?.trim() || actor.fullName;

  const whRes = await client.query<{ warehouse_id: number }>(
    `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1`
  );
  if (whRes.rowCount === 0) {
    throw new Error("Warehouse MAIN not found");
  }
  const warehouseId = Number(whRes.rows[0].warehouse_id);

  let cashAccountId: number | null = null;
  if (input.cashAccountId !== undefined && input.cashAccountId !== null) {
    cashAccountId = parsePositiveInt(input.cashAccountId, "Cuenta de caja");
    const accRes = await client.query<{ account_type: string; is_active: boolean }>(
      `SELECT account_type, is_active FROM erp.cash_accounts WHERE account_id = $1 LIMIT 1`,
      [cashAccountId]
    );
    if (accRes.rowCount === 0 || !accRes.rows[0].is_active) {
      throw new ValidationError("Cuenta de caja inválida o inactiva");
    }
    if (
      !isPartnerRole(actor.role) &&
      accRes.rows[0].account_type === "PARTNER_CUSTODY"
    ) {
      throw new AuthorizationError(
        "No autorizado para usar cuenta de custodia de socio"
      );
    }
  }

  const tripPeriodKey = tripDate.replace(/-/g, "");
  const tripSeqRes = await client.query<{ code: string }>(
    `SELECT erp.fn_next_document_code('ROUTE_TRIP', 'TRIP', $1, 4) AS code`,
    [tripPeriodKey]
  );
  const tripCode = String(tripSeqRes.rows[0].code);

  const ins = await client.query<{ trip_id: string; trip_code: string }>(
    `INSERT INTO erp.route_trips (
       trip_code, trip_date, zone_name, driver_name,
       warehouse_id, cash_account_id, status, source_origin, notes
     ) VALUES (
       $1, $2::date, $3, $4,
       $5, $6, 'OPEN', 'ERP_APP', $7
     )
     RETURNING trip_id::text AS trip_id, trip_code`,
    [
      tripCode,
      tripDate,
      zoneName,
      driverName,
      warehouseId,
      cashAccountId,
      input.notes?.trim() || null,
    ]
  );

  return {
    tripId: Number(ins.rows[0].trip_id),
    tripCode: String(ins.rows[0].trip_code),
    status: "OPEN",
  };
}

export async function assignOrderToTrip(
  client: PoolClient,
  actor: SessionUser,
  input: {
    tripId: number;
    orderId: number;
    advanceToInRoute?: boolean;
  }
): Promise<{
  tripId: number;
  orderId: number;
  operationalStatus: string;
  undoAction?: UndoActionReceipt;
}> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "WAREHOUSE_DELIVERY"]);
  const tripId = parsePositiveInt(input.tripId, "Ruta");
  const orderId = parsePositiveInt(input.orderId, "Pedido");

  const tripRes = await client.query<{ status: string }>(
    `SELECT status::text AS status FROM erp.route_trips WHERE trip_id = $1 FOR UPDATE`,
    [tripId]
  );
  if (tripRes.rowCount === 0) {
    throw new ValidationError("Ruta no encontrada");
  }
  if (tripRes.rows[0].status !== "OPEN") {
    throw new ValidationError("Solo se pueden asignar pedidos a una ruta OPEN");
  }

  const orderRes = await client.query<{
    operational_status: string;
    trip_id: string | null;
  }>(
    `SELECT operational_status::text AS operational_status, trip_id::text AS trip_id
     FROM erp.sales_orders
     WHERE order_id = $1
     FOR UPDATE`,
    [orderId]
  );
  if (orderRes.rowCount === 0) {
    throw new ValidationError("Pedido no encontrado");
  }
  const previousTripId =
    orderRes.rows[0].trip_id !== null ? Number(orderRes.rows[0].trip_id) : null;
  let opStatus = String(orderRes.rows[0].operational_status);
  if (opStatus === "CANCELLED" || opStatus === "PENDING_PARTNER_APPROVAL") {
    throw new ValidationError(
      `No se puede asignar a ruta un pedido en estado ${opStatus}`
    );
  }

  await client.query(`UPDATE erp.sales_orders SET trip_id = $1 WHERE order_id = $2`, [
    tripId,
    orderId,
  ]);

  let undoAction: UndoActionReceipt | undefined;
  if (input.advanceToInRoute) {
    if (opStatus !== "READY") {
      throw new ValidationError(
        `El pedido debe estar READY para pasar a IN_ROUTE (estado actual: ${opStatus})`
      );
    }
    const adv = await advanceWarehouseStatus(client, actor, orderId, "IN_ROUTE", {
      previousTripIdOverride: previousTripId,
    });
    opStatus = "IN_ROUTE";
    undoAction = adv.undoAction;
  }

  return { tripId, orderId, operationalStatus: opStatus, undoAction };
}

export async function closeRouteTrip(
  client: PoolClient,
  actor: SessionUser,
  input: {
    tripId: number;
    nextStatus?: "CLOSED" | "RECONCILED";
    declaredGrossSalesPen?: number | null;
    declaredRouteOpexPen?: number | null;
    declaredNetCashPen?: number | null;
    notes?: string | null;
  }
): Promise<{
  tripId: number;
  status: "CLOSED" | "RECONCILED";
  undoAction?: UndoActionReceipt;
}> {
  const tripId = parsePositiveInt(input.tripId, "Ruta");
  const nextStatus = String(input.nextStatus || "CLOSED")
    .trim()
    .toUpperCase();
  if (nextStatus !== "CLOSED" && nextStatus !== "RECONCILED") {
    throw new ValidationError(
      "Estado inválido para cierre de ruta (use CLOSED o RECONCILED)"
    );
  }

  if (nextStatus === "RECONCILED") {
    assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);
  } else {
    assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "WAREHOUSE_DELIVERY"]);
  }

  const partnerView = isPartnerRole(actor.role);
  if (
    !partnerView &&
    (input.declaredGrossSalesPen !== undefined ||
      input.declaredRouteOpexPen !== undefined ||
      input.declaredNetCashPen !== undefined)
  ) {
    throw new AuthorizationError(
      "Solo Socios pueden declarar liquidación financiera de ruta"
    );
  }

  const gross =
    partnerView &&
    input.declaredGrossSalesPen !== undefined &&
    input.declaredGrossSalesPen !== null
      ? parseNonNegativeNumber(input.declaredGrossSalesPen, "Venta declarada")
      : null;
  const opex =
    partnerView &&
    input.declaredRouteOpexPen !== undefined &&
    input.declaredRouteOpexPen !== null
      ? parseNonNegativeNumber(input.declaredRouteOpexPen, "Gasto declarado")
      : null;
  const net =
    partnerView &&
    input.declaredNetCashPen !== undefined &&
    input.declaredNetCashPen !== null
      ? parseNonNegativeNumber(input.declaredNetCashPen, "Neto caja declarado")
      : null;

  const lockRes = await client.query<{
    trip_code: string;
    status: string;
    end_date: string | null;
    declared_gross_sales_pen: string | number | null;
    declared_route_opex_pen: string | number | null;
    declared_net_cash_pen: string | number | null;
    notes: string | null;
  }>(
    `SELECT trip_code, status::text AS status, end_date::text AS end_date,
            declared_gross_sales_pen, declared_route_opex_pen,
            declared_net_cash_pen, notes
     FROM erp.route_trips
     WHERE trip_id = $1
     FOR UPDATE`,
    [tripId]
  );
  if (lockRes.rowCount === 0) {
    throw new ValidationError("Ruta no encontrada");
  }
  const prevTrip = lockRes.rows[0];
  const currentStatus = String(prevTrip.status);
  if (currentStatus === "RECONCILED" && nextStatus === "CLOSED") {
    throw new ValidationError("Una ruta ya conciliada no puede volver a CLOSED");
  }

  await client.query(
    `UPDATE erp.route_trips
     SET status = $2::erp.trip_status,
         end_date = COALESCE(end_date, (NOW() AT TIME ZONE 'America/Lima')::date),
         declared_gross_sales_pen = COALESCE($3, declared_gross_sales_pen),
         declared_route_opex_pen = COALESCE($4, declared_route_opex_pen),
         declared_net_cash_pen = COALESCE($5, declared_net_cash_pen),
         notes = COALESCE($6, notes)
     WHERE trip_id = $1`,
    [tripId, nextStatus, gross, opex, net, input.notes?.trim() || null]
  );

  const undoAction =
    currentStatus !== nextStatus
      ? await recordUndoableAction(client, actor, {
          actionType: "TRIP_CLOSE",
          entityTable: "erp.route_trips",
          entityId: tripId,
          entityCode: prevTrip.trip_code,
          summary: `Cerró ruta ${prevTrip.trip_code} (${formatRouteTripStatusEs(currentStatus)} → ${formatRouteTripStatusEs(nextStatus)})`,
          undoPayload: {
            tripId,
            tripCode: prevTrip.trip_code,
            previousStatus: currentStatus,
            nextStatus,
            previousEndDate: prevTrip.end_date,
            previousDeclaredGrossSalesPen:
              prevTrip.declared_gross_sales_pen !== null
                ? Number(prevTrip.declared_gross_sales_pen)
                : null,
            previousDeclaredRouteOpexPen:
              prevTrip.declared_route_opex_pen !== null
                ? Number(prevTrip.declared_route_opex_pen)
                : null,
            previousDeclaredNetCashPen:
              prevTrip.declared_net_cash_pen !== null
                ? Number(prevTrip.declared_net_cash_pen)
                : null,
            previousNotes: prevTrip.notes,
          },
        })
      : undefined;

  return { tripId, status: nextStatus as "CLOSED" | "RECONCILED", undoAction };
}

export async function listQuotes(
  client: PoolClient,
  actor: SessionUser,
  limit = 250
): Promise<Record<string, unknown>[]> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"]);
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit || 250)));

  const res = await client.query(
    `SELECT
       q.quote_id,
       q.quote_code,
       q.issue_date::text AS issue_date,
       q.customer_party_id,
       COALESCE(pa.trade_name, pa.legal_name, q.customer_name_raw, 'CLIENTE') AS customer_name,
       q.currency,
       q.tax_regime,
       q.total_pen,
       COALESCE(q.global_discount_pen, 0) AS global_discount_pen,
       q.status::text AS status,
       q.related_cpe,
       q.seller_name,
       q.source_origin::text AS source_origin,
       q.notes,
       q.updated_at::text AS updated_at,
       MAX(so.order_id)::bigint AS converted_order_id,
       MAX(so.order_code) AS converted_order_code,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             ql.quote_line_id,
             ql.line_no,
             ql.product_id,
             pr.sku,
             COALESCE(pr.unit_of_measure, 'NIU') AS unit_of_measure,
             ql.raw_description,
             ql.quantity,
             COALESCE(ql.base_unit_price_pen, ql.unit_price_pen) AS base_unit_price_pen,
             ql.unit_price_pen,
             ql.line_total_pen
           FROM erp.quote_lines ql
           LEFT JOIN erp.products pr ON pr.product_id = ql.product_id
           WHERE ql.quote_id = q.quote_id
           ORDER BY ql.line_no ASC, ql.quote_line_id ASC
         ) t
       ), '[]'::json) AS lines,
       COALESCE((
         SELECT json_agg(a)
         FROM (
           SELECT
             qa.audit_id,
             qa.action,
             u.full_name AS actor_name,
             qa.actor_role,
             qa.reason,
             qa.created_at::text AS created_at
           FROM erp.quote_audit_log qa
           LEFT JOIN erp.app_users u ON u.user_id = qa.actor_user_id
           WHERE qa.quote_id = q.quote_id
           ORDER BY qa.created_at DESC, qa.audit_id DESC
           LIMIT 20
         ) a
       ), '[]'::json) AS audit_history
     FROM erp.quotes q
     LEFT JOIN erp.parties pa ON pa.party_id = q.customer_party_id
     LEFT JOIN erp.sales_orders so ON so.quote_id = q.quote_id AND so.operational_status <> 'CANCELLED'
     GROUP BY q.quote_id, pa.trade_name, pa.legal_name
     ORDER BY
       CASE q.status WHEN 'OPEN' THEN 0 WHEN 'CONVERTED' THEN 1 ELSE 2 END ASC,
       q.issue_date DESC,
       q.quote_id DESC
     LIMIT $1`,
    [safeLimit]
  );

  return res.rows.map((r) => ({
    quote_id: Number(r.quote_id),
    quote_code: String(r.quote_code),
    issue_date: String(r.issue_date),
    customer_party_id:
      r.customer_party_id !== null && r.customer_party_id !== undefined
        ? Number(r.customer_party_id)
        : null,
    customer_name: String(r.customer_name),
    currency: String(r.currency),
    tax_regime: String(r.tax_regime),
    total_pen: Number(r.total_pen ?? 0),
    global_discount_pen: Number(r.global_discount_pen ?? 0),
    status: String(r.status),
    related_cpe: r.related_cpe ? String(r.related_cpe) : null,
    seller_name: r.seller_name ? String(r.seller_name) : null,
    source_origin: String(r.source_origin),
    notes: r.notes ? String(r.notes) : null,
    updated_at: r.updated_at ? String(r.updated_at) : null,
    converted_order_id:
      r.converted_order_id !== null && r.converted_order_id !== undefined
        ? Number(r.converted_order_id)
        : null,
    converted_order_code: r.converted_order_code
      ? String(r.converted_order_code)
      : null,
    lines: Array.isArray(r.lines)
      ? r.lines.map((ln: Record<string, unknown>) => ({
          quote_line_id: Number(ln.quote_line_id),
          line_no: Number(ln.line_no),
          product_id:
            ln.product_id !== null && ln.product_id !== undefined
              ? Number(ln.product_id)
              : null,
          sku: ln.sku ? String(ln.sku) : null,
          unit_of_measure: String(ln.unit_of_measure || "NIU"),
          raw_description: String(ln.raw_description ?? ""),
          quantity: Number(ln.quantity ?? 0),
          base_unit_price_pen: Number(ln.base_unit_price_pen ?? ln.unit_price_pen ?? 0),
          unit_price_pen: Number(ln.unit_price_pen ?? 0),
          line_total_pen: Number(ln.line_total_pen ?? 0),
        }))
      : [],
    audit_history: Array.isArray(r.audit_history)
      ? r.audit_history.map((a: Record<string, unknown>) => ({
          audit_id: Number(a.audit_id),
          action: String(a.action),
          actor_name: a.actor_name ? String(a.actor_name) : null,
          actor_role: String(a.actor_role),
          reason: String(a.reason),
          created_at: String(a.created_at),
        }))
      : [],
  }));
}

function assertQuoteOwnership(
  actor: SessionUser,
  quote: { created_by_user_id?: unknown; seller_name?: unknown }
): void {
  if (actor.role !== "EXTERNAL_SELLER") return;
  if (quote.created_by_user_id !== null && quote.created_by_user_id !== undefined) {
    if (Number(quote.created_by_user_id) !== actor.userId) {
      throw new AuthorizationError("Solo puedes gestionar cotizaciones creadas por ti");
    }
    return;
  }
  const sellerName =
    typeof quote.seller_name === "string" ? quote.seller_name.trim().toLowerCase() : "";
  if (!sellerName || sellerName !== actor.fullName.trim().toLowerCase()) {
    throw new AuthorizationError("Solo puedes gestionar cotizaciones creadas por ti");
  }
}

export async function createQuote(
  client: PoolClient,
  actor: SessionUser,
  input: {
    customerPartyId?: number | null;
    customerNameRaw?: string | null;
    currency?: "PEN" | "USD";
    taxRegime?: string | null;
    globalDiscountPen?: number;
    notes?: string | null;
    lines: Array<{
      productId?: number | null;
      rawDescription?: string | null;
      quantity: number;
      unitPricePen?: number;
    }>;
  }
): Promise<{ quoteId: number; quoteCode: string; totalPen: number; status: "OPEN" }> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"]);

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new ValidationError("La cotización debe incluir al menos un producto");
  }

  let customerPartyId: number | null = null;
  let customerNameRaw = input.customerNameRaw?.trim() || "";
  if (input.customerPartyId !== undefined && input.customerPartyId !== null) {
    customerPartyId = parsePositiveInt(input.customerPartyId, "Cliente");
    const cRes = await client.query<{ display_name: string }>(
      `SELECT COALESCE(trade_name, legal_name) AS display_name
       FROM erp.parties
       WHERE party_id = $1 AND is_active = TRUE
       LIMIT 1`,
      [customerPartyId]
    );
    if (cRes.rowCount === 0) {
      throw new ValidationError("Cliente no encontrado o inactivo");
    }
    if (!customerNameRaw) {
      customerNameRaw = String(cRes.rows[0].display_name);
    }
  }
  if (!customerNameRaw) {
    throw new ValidationError("El nombre del cliente es obligatorio en la cotización");
  }

  const currencyRaw = String(input.currency || "PEN")
    .trim()
    .toUpperCase();
  if (currencyRaw !== "PEN" && currencyRaw !== "USD") {
    throw new ValidationError("Moneda inválida en cotización (use PEN o USD)");
  }
  const taxRegime = (input.taxRegime?.trim() || "EXONERADA").toUpperCase();

  const productIds = Array.from(
    new Set(
      input.lines
        .map((ln) => (ln.productId ? Number(ln.productId) : null))
        .filter((id): id is number => id !== null && Number.isInteger(id) && id > 0)
    )
  );
  const productById = new Map<
    number,
    { sku: string; name: string; listSalePricePen: number }
  >();
  if (productIds.length > 0) {
    const pRes = await client.query<{
      product_id: number;
      sku: string;
      name: string;
      list_sale_price_pen: string | number | null;
    }>(
      `SELECT product_id, sku, name, list_sale_price_pen
       FROM erp.products
       WHERE product_id = ANY($1::bigint[]) AND is_active = TRUE`,
      [productIds]
    );
    for (const row of pRes.rows) {
      productById.set(Number(row.product_id), {
        sku: String(row.sku),
        name: String(row.name),
        listSalePricePen: Number(row.list_sale_price_pen ?? 0),
      });
    }
  }

  const preparedLines: Array<{
    lineNo: number;
    productId: number | null;
    sku: string | null;
    rawDescription: string;
    quantity: number;
    baseUnitPricePen: number;
    unitPricePen: number;
    lineTotalPen: number;
  }> = [];
  let subtotalPen = 0;

  for (let i = 0; i < input.lines.length; i++) {
    const line = input.lines[i];
    const quantity = parsePositiveNumber(line.quantity, `Cantidad línea ${i + 1}`);
    const pid =
      line.productId !== undefined && line.productId !== null
        ? parsePositiveInt(line.productId, `Producto línea ${i + 1}`)
        : null;
    const prod = pid ? productById.get(pid) : undefined;
    if (pid && !prod) {
      throw new ValidationError(`Producto ID ${pid} no encontrado o inactivo`);
    }
    const rawDescription = line.rawDescription?.trim() || prod?.name || "";
    if (!rawDescription) {
      throw new ValidationError(`Descripción obligatoria en línea ${i + 1}`);
    }
    const unitPricePen =
      line.unitPricePen !== undefined && line.unitPricePen !== null
        ? parseNonNegativeNumber(line.unitPricePen, `Precio línea ${i + 1}`)
        : prod
          ? prod.listSalePricePen
          : 0;
    if (unitPricePen <= 0) {
      throw new ValidationError(
        `El precio unitario debe ser mayor a 0 en línea ${i + 1}`
      );
    }
    const baseUnitPricePen =
      prod && prod.listSalePricePen > 0 ? prod.listSalePricePen : unitPricePen;
    const lineTotalPen = Number((quantity * unitPricePen).toFixed(2));
    subtotalPen = Number((subtotalPen + lineTotalPen).toFixed(2));

    preparedLines.push({
      lineNo: i + 1,
      productId: pid,
      sku: prod?.sku ?? null,
      rawDescription,
      quantity,
      baseUnitPricePen: Number(baseUnitPricePen.toFixed(4)),
      unitPricePen: Number(unitPricePen.toFixed(4)),
      lineTotalPen,
    });
  }

  const globalDiscountPen = Number((input.globalDiscountPen ?? 0).toFixed(2));
  if (!Number.isFinite(globalDiscountPen) || globalDiscountPen < 0) {
    throw new ValidationError("El descuento global no puede ser negativo");
  }
  if (globalDiscountPen >= subtotalPen) {
    throw new ValidationError(
      "El descuento global debe ser menor al subtotal de la cotización"
    );
  }
  const totalPen = Number((subtotalPen - globalDiscountPen).toFixed(2));

  const issueDate = getLimaDateString(0);
  const quotePeriodKey = issueDate.replace(/-/g, "");
  const quoteSeqRes = await client.query<{ code: string }>(
    `SELECT erp.fn_next_document_code('QUOTE', 'COT', $1, 4) AS code`,
    [quotePeriodKey]
  );
  const quoteCode = String(quoteSeqRes.rows[0].code);

  const qIns = await client.query<{ quote_id: string; quote_code: string }>(
    `INSERT INTO erp.quotes (
       quote_code, issue_date, customer_party_id, customer_name_raw,
       currency, tax_regime, total_pen, global_discount_pen, status, seller_name, created_by_user_id, source_origin, notes
     ) VALUES (
       $1, $2::date, $3, $4,
       $5, $6, $7, $10, 'OPEN', $8, $11, 'ERP_APP', $9
     )
     RETURNING quote_id::text AS quote_id, quote_code`,
    [
      quoteCode,
      issueDate,
      customerPartyId,
      customerNameRaw,
      currencyRaw,
      taxRegime,
      totalPen,
      actor.fullName,
      input.notes?.trim() || null,
      globalDiscountPen,
      actor.userId,
    ]
  );
  const quoteId = Number(qIns.rows[0].quote_id);

  await client.query(
    `INSERT INTO erp.quote_lines (
       quote_id, line_no, product_id, raw_description,
       quantity, base_unit_price_pen, unit_price_pen, line_total_pen
     )
     SELECT
       $1, u.line_no, u.product_id, u.raw_description,
       u.quantity, u.base_unit_price_pen, u.unit_price_pen, u.line_total_pen
     FROM unnest(
       $2::int[], $3::bigint[], $4::text[],
       $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[]
     ) AS u(line_no, product_id, raw_description, quantity, base_unit_price_pen, unit_price_pen, line_total_pen)`,
    [
      quoteId,
      preparedLines.map((l) => l.lineNo),
      preparedLines.map((l) => l.productId),
      preparedLines.map((l) => l.rawDescription),
      preparedLines.map((l) => l.quantity),
      preparedLines.map((l) => l.baseUnitPricePen),
      preparedLines.map((l) => l.unitPricePen),
      preparedLines.map((l) => l.lineTotalPen),
    ]
  );

  await recordPriceOverrides(
    client,
    actor,
    preparedLines
      .filter((l) => l.productId !== null && l.sku !== null)
      .map((l) => ({
        entityType: "QUOTE",
        entityId: quoteId,
        entityCode: quoteCode,
        lineNo: l.lineNo,
        productId: l.productId!,
        sku: l.sku!,
        productName: l.rawDescription,
        customerPartyId,
        customerName: customerNameRaw,
        catalogPricePen: l.baseUnitPricePen,
        appliedPricePen: l.unitPricePen,
        quantity: l.quantity,
        reason: input.notes?.trim() || null,
      }))
  );

  return {
    quoteId,
    quoteCode: String(qIns.rows[0].quote_code),
    totalPen,
    status: "OPEN",
  };
}

export async function updateQuote(
  client: PoolClient,
  actor: SessionUser,
  input: {
    quoteId: number;
    customerPartyId?: number | null;
    customerNameRaw?: string | null;
    globalDiscountPen?: number;
    notes?: string | null;
    reason?: string | null;
    lines: Array<{
      productId?: number | null;
      rawDescription?: string | null;
      quantity: number;
      unitPricePen?: number;
    }>;
  }
): Promise<{ quoteId: number; quoteCode: string; totalPen: number; status: "OPEN" }> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"]);
  const quoteId = parsePositiveInt(input.quoteId, "Cotización");
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new ValidationError("La cotización debe conservar al menos un producto");
  }
  const reason = input.reason?.trim() || "Actualización comercial de cotización";

  const qRes = await client.query<Record<string, unknown>>(
    `SELECT quote_id, quote_code, issue_date::text AS issue_date,
            customer_party_id, customer_name_raw, currency, tax_regime,
            total_pen, COALESCE(global_discount_pen, 0) AS global_discount_pen,
            status::text AS status, notes, created_by_user_id, seller_name
     FROM erp.quotes
     WHERE quote_id = $1
     FOR UPDATE`,
    [quoteId]
  );
  if (qRes.rowCount === 0) {
    throw new ValidationError("Cotización no encontrada");
  }
  const existingQuote = qRes.rows[0];
  assertQuoteOwnership(actor, existingQuote);
  if (String(existingQuote.status) !== "OPEN") {
    throw new ValidationError(
      `Solo cotizaciones abiertas se pueden modificar (estado actual: ${existingQuote.status})`
    );
  }

  const beforeLinesRes = await client.query<Record<string, unknown>>(
    `SELECT quote_line_id, line_no, product_id, raw_description,
            quantity, COALESCE(base_unit_price_pen, unit_price_pen) AS base_unit_price_pen,
            unit_price_pen, line_total_pen
     FROM erp.quote_lines
     WHERE quote_id = $1
     ORDER BY line_no ASC`,
    [quoteId]
  );
  const beforeData = { quote: existingQuote, lines: beforeLinesRes.rows };

  const customerPartyId: number | null =
    input.customerPartyId !== undefined
      ? input.customerPartyId !== null
        ? parsePositiveInt(input.customerPartyId, "Cliente")
        : null
      : existingQuote.customer_party_id !== null
        ? Number(existingQuote.customer_party_id)
        : null;
  let customerNameRaw =
    input.customerNameRaw?.trim() ||
    String(existingQuote.customer_name_raw || "").trim();

  if (customerPartyId !== null) {
    const cRes = await client.query<{ display_name: string }>(
      `SELECT COALESCE(trade_name, legal_name) AS display_name
       FROM erp.parties
       WHERE party_id = $1 AND is_active = TRUE
       LIMIT 1`,
      [customerPartyId]
    );
    if (cRes.rowCount === 0) {
      throw new ValidationError("Cliente no encontrado o inactivo");
    }
    if (!customerNameRaw) {
      customerNameRaw = String(cRes.rows[0].display_name);
    }
  }
  if (!customerNameRaw) {
    throw new ValidationError("El nombre del cliente es obligatorio en la cotización");
  }

  const productIds = Array.from(
    new Set(
      input.lines
        .map((ln) => (ln.productId ? Number(ln.productId) : null))
        .filter((id): id is number => id !== null && Number.isInteger(id) && id > 0)
    )
  );
  const productById = new Map<
    number,
    { sku: string; name: string; listSalePricePen: number }
  >();
  if (productIds.length > 0) {
    const pRes = await client.query<{
      product_id: number;
      sku: string;
      name: string;
      list_sale_price_pen: string | number | null;
    }>(
      `SELECT product_id, sku, name, list_sale_price_pen
       FROM erp.products
       WHERE product_id = ANY($1::bigint[]) AND is_active = TRUE`,
      [productIds]
    );
    for (const row of pRes.rows) {
      productById.set(Number(row.product_id), {
        sku: String(row.sku),
        name: String(row.name),
        listSalePricePen: Number(row.list_sale_price_pen ?? 0),
      });
    }
  }

  const preparedLines: Array<{
    lineNo: number;
    productId: number | null;
    sku: string | null;
    rawDescription: string;
    quantity: number;
    baseUnitPricePen: number;
    unitPricePen: number;
    lineTotalPen: number;
  }> = [];
  let subtotalPen = 0;

  for (let i = 0; i < input.lines.length; i++) {
    const line = input.lines[i];
    const quantity = parsePositiveNumber(line.quantity, `Cantidad línea ${i + 1}`);
    const pid =
      line.productId !== undefined && line.productId !== null
        ? parsePositiveInt(line.productId, `Producto línea ${i + 1}`)
        : null;
    const prod = pid ? productById.get(pid) : undefined;
    if (pid && !prod) {
      throw new ValidationError(`Producto ID ${pid} no encontrado o inactivo`);
    }
    const rawDescription = line.rawDescription?.trim() || prod?.name || "";
    if (!rawDescription) {
      throw new ValidationError(`Descripción obligatoria en línea ${i + 1}`);
    }
    const unitPricePen =
      line.unitPricePen !== undefined && line.unitPricePen !== null
        ? parseNonNegativeNumber(line.unitPricePen, `Precio línea ${i + 1}`)
        : prod
          ? prod.listSalePricePen
          : 0;
    if (unitPricePen <= 0) {
      throw new ValidationError(
        `El precio unitario debe ser mayor a 0 en línea ${i + 1}`
      );
    }
    const baseUnitPricePen =
      prod && prod.listSalePricePen > 0 ? prod.listSalePricePen : unitPricePen;
    const lineTotalPen = Number((quantity * unitPricePen).toFixed(2));
    subtotalPen = Number((subtotalPen + lineTotalPen).toFixed(2));

    preparedLines.push({
      lineNo: i + 1,
      productId: pid,
      sku: prod?.sku ?? null,
      rawDescription,
      quantity,
      baseUnitPricePen: Number(baseUnitPricePen.toFixed(4)),
      unitPricePen: Number(unitPricePen.toFixed(4)),
      lineTotalPen,
    });
  }

  const globalDiscountPen = Number((input.globalDiscountPen ?? 0).toFixed(2));
  if (!Number.isFinite(globalDiscountPen) || globalDiscountPen < 0) {
    throw new ValidationError("El descuento global no puede ser negativo");
  }
  if (globalDiscountPen >= subtotalPen) {
    throw new ValidationError(
      "El descuento global debe ser menor al subtotal de la cotización"
    );
  }
  const totalPen = Number((subtotalPen - globalDiscountPen).toFixed(2));
  const nextNotes =
    input.notes !== undefined
      ? input.notes?.trim() || null
      : existingQuote.notes
        ? String(existingQuote.notes)
        : null;

  await client.query(`DELETE FROM erp.quote_lines WHERE quote_id = $1`, [quoteId]);

  await client.query(
    `INSERT INTO erp.quote_lines (
       quote_id, line_no, product_id, raw_description,
       quantity, base_unit_price_pen, unit_price_pen, line_total_pen
     )
     SELECT
       $1, u.line_no, u.product_id, u.raw_description,
       u.quantity, u.base_unit_price_pen, u.unit_price_pen, u.line_total_pen
     FROM unnest(
       $2::int[], $3::bigint[], $4::text[],
       $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[]
     ) AS u(line_no, product_id, raw_description, quantity, base_unit_price_pen, unit_price_pen, line_total_pen)`,
    [
      quoteId,
      preparedLines.map((l) => l.lineNo),
      preparedLines.map((l) => l.productId),
      preparedLines.map((l) => l.rawDescription),
      preparedLines.map((l) => l.quantity),
      preparedLines.map((l) => l.baseUnitPricePen),
      preparedLines.map((l) => l.unitPricePen),
      preparedLines.map((l) => l.lineTotalPen),
    ]
  );

  await client.query(
    `UPDATE erp.quotes
     SET customer_party_id = $2,
         customer_name_raw = $3,
         total_pen = $4,
         global_discount_pen = $5,
         notes = $6,
         updated_at = NOW(),
         updated_by_user_id = $7
     WHERE quote_id = $1`,
    [
      quoteId,
      customerPartyId,
      customerNameRaw,
      totalPen,
      globalDiscountPen,
      nextNotes,
      actor.userId,
    ]
  );

  const afterQuoteRes = await client.query<Record<string, unknown>>(
    `SELECT quote_id, quote_code, issue_date::text AS issue_date,
            customer_party_id, customer_name_raw, currency, tax_regime,
            total_pen, COALESCE(global_discount_pen, 0) AS global_discount_pen,
            status::text AS status, notes, updated_at::text AS updated_at
     FROM erp.quotes
     WHERE quote_id = $1`,
    [quoteId]
  );
  const afterLinesRes = await client.query<Record<string, unknown>>(
    `SELECT quote_line_id, line_no, product_id, raw_description,
            quantity, COALESCE(base_unit_price_pen, unit_price_pen) AS base_unit_price_pen,
            unit_price_pen, line_total_pen
     FROM erp.quote_lines
     WHERE quote_id = $1
     ORDER BY line_no ASC`,
    [quoteId]
  );

  await client.query(
    `INSERT INTO erp.quote_audit_log
       (quote_id, action, actor_user_id, actor_role, reason, before_data, after_data)
     VALUES ($1, 'EDIT', $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      quoteId,
      actor.userId,
      actor.role,
      reason,
      JSON.stringify(beforeData),
      JSON.stringify({ quote: afterQuoteRes.rows[0], lines: afterLinesRes.rows }),
    ]
  );

  await recordPriceOverrides(
    client,
    actor,
    preparedLines
      .filter((l) => l.productId !== null && l.sku !== null)
      .map((l) => ({
        entityType: "QUOTE",
        entityId: quoteId,
        entityCode: String(existingQuote.quote_code),
        lineNo: l.lineNo,
        productId: l.productId!,
        sku: l.sku!,
        productName: l.rawDescription,
        customerPartyId,
        customerName: customerNameRaw,
        catalogPricePen: l.baseUnitPricePen,
        appliedPricePen: l.unitPricePen,
        quantity: l.quantity,
        reason: `Modificación de cotización: ${reason}`,
      }))
  );

  return {
    quoteId,
    quoteCode: String(existingQuote.quote_code),
    totalPen,
    status: "OPEN",
  };
}

export async function updateQuoteStatus(
  client: PoolClient,
  actor: SessionUser,
  input: {
    quoteId: number;
    nextStatus: "OPEN" | "EXPIRED" | "CANCELLED";
  }
): Promise<{
  quoteId: number;
  status: "OPEN" | "EXPIRED" | "CANCELLED";
  undoAction?: UndoActionReceipt;
}> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"]);
  const quoteId = parsePositiveInt(input.quoteId, "Cotización");
  const nextStatus = String(input.nextStatus || "")
    .trim()
    .toUpperCase();
  if (!["OPEN", "EXPIRED", "CANCELLED"].includes(nextStatus)) {
    throw new ValidationError("Estado destino inválido (OPEN, EXPIRED o CANCELLED)");
  }

  const res = await client.query<{
    status: string;
    quote_code: string;
    customer_name_raw: string | null;
    created_by_user_id: string | null;
    seller_name: string | null;
  }>(
    `SELECT status::text AS status, quote_code, customer_name_raw,
            created_by_user_id::text, seller_name
     FROM erp.quotes
     WHERE quote_id = $1
     FOR UPDATE`,
    [quoteId]
  );
  if (res.rowCount === 0) {
    throw new ValidationError("Cotización no encontrada");
  }
  const prev = res.rows[0];
  assertQuoteOwnership(actor, prev);
  if (prev.status === "CONVERTED") {
    throw new ValidationError(
      "Una cotización ya convertida en pedido no puede cambiar a otro estado"
    );
  }

  await client.query(
    `UPDATE erp.quotes SET status = $2::erp.quote_status WHERE quote_id = $1`,
    [quoteId, nextStatus]
  );

  const verb =
    nextStatus === "CANCELLED"
      ? "Anuló"
      : nextStatus === "EXPIRED"
        ? "Marcó como vencida"
        : "Reabrió";
  const undoAction =
    prev.status !== nextStatus
      ? await recordUndoableAction(client, actor, {
          actionType: "QUOTE_STATUS_CHANGE",
          entityTable: "erp.quotes",
          entityId: quoteId,
          entityCode: prev.quote_code,
          summary: `${verb} cotización ${prev.quote_code} (${prev.customer_name_raw || "CLIENTE"})`,
          undoPayload: {
            quoteId,
            quoteCode: prev.quote_code,
            previousStatus: prev.status,
            nextStatus,
          },
        })
      : undefined;

  return {
    quoteId,
    status: nextStatus as "OPEN" | "EXPIRED" | "CANCELLED",
    undoAction,
  };
}

export async function convertQuoteToOrder(
  client: PoolClient,
  actor: SessionUser,
  input: {
    quoteId: number;
    paymentMode?: PaymentMode;
    collectOnDelivery?: boolean;
    creditDays?: number;
    promisedPaymentDate?: string | null;
    initialPaidPen?: number;
    paymentAccountId?: number;
    tripId?: number | null;
    exchangeRate?: number | null;
    notes?: string;
  }
) {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"]);
  const quoteId = parsePositiveInt(input.quoteId, "Cotización");

  const qRes = await client.query<{
    quote_id: string;
    quote_code: string;
    issue_date: string;
    customer_party_id: string | null;
    customer_name_raw: string | null;
    currency: string;
    global_discount_pen: string | number;
    status: string;
    related_cpe: string | null;
    notes: string | null;
    created_by_user_id: string | null;
    seller_name: string | null;
  }>(
    `SELECT
       quote_id::text,
       quote_code,
       issue_date::text AS issue_date,
       customer_party_id::text,
       customer_name_raw,
       currency,
       COALESCE(global_discount_pen, 0) AS global_discount_pen,
       status::text AS status,
       related_cpe,
       notes,
       created_by_user_id::text,
       seller_name
     FROM erp.quotes
     WHERE quote_id = $1
     FOR UPDATE`,
    [quoteId]
  );
  if (qRes.rowCount === 0) {
    throw new ValidationError("Cotización no encontrada");
  }
  const quote = qRes.rows[0];
  assertQuoteOwnership(actor, quote);
  if (quote.status !== "OPEN") {
    throw new ValidationError(
      `Solo cotizaciones OPEN se pueden convertir en pedido (estado actual: ${quote.status})`
    );
  }

  const qlRes = await client.query<{
    product_id: string | null;
    raw_description: string;
    quantity: string | number;
    unit_price_pen: string | number;
    list_sale_price_pen: string | number | null;
  }>(
    `SELECT
       ql.product_id::text,
       ql.raw_description,
       ql.quantity,
       ql.unit_price_pen,
       p.list_sale_price_pen
     FROM erp.quote_lines ql
     LEFT JOIN erp.products p ON p.product_id = ql.product_id
     WHERE ql.quote_id = $1
     ORDER BY ql.line_no ASC, ql.quote_line_id ASC`,
    [quoteId]
  );
  if (qlRes.rowCount === 0) {
    throw new ValidationError("La cotización no tiene líneas para convertir en pedido");
  }

  const orderLines: Array<{
    productId: number;
    quantity: number;
    unitPricePen: number;
  }> = [];

  const isUsdQuote = String(quote.currency || "PEN").toUpperCase() === "USD";
  let fxRate = 1;
  if (isUsdQuote) {
    const providedRate =
      input.exchangeRate !== undefined && input.exchangeRate !== null
        ? Number(input.exchangeRate)
        : NaN;
    if (!Number.isFinite(providedRate) || providedRate <= 0) {
      throw new ValidationError(
        "La cotización está en USD; indica un tipo de cambio válido (> 0) para convertir a PEN"
      );
    }
    fxRate = providedRate;
  }

  for (const row of qlRes.rows) {
    if (!row.product_id) {
      throw new ValidationError(
        `La línea "${row.raw_description}" no tiene SKU vinculado; cree el pedido manualmente`
      );
    }
    orderLines.push({
      productId: Number(row.product_id),
      quantity: Number(row.quantity),
      unitPricePen: Number((Number(row.unit_price_pen) * fxRate).toFixed(4)),
    });
  }

  const convertedGlobalDiscountPen = Number(
    (Number(quote.global_discount_pen ?? 0) * fxRate).toFixed(2)
  );

  const orderResult = await createOrder(
    client,
    actor,
    {
      customerPartyId: quote.customer_party_id ? Number(quote.customer_party_id) : null,
      customerNameRaw: quote.customer_name_raw || `CLIENTE ${quote.quote_code}`,
      paymentMode: (input.paymentMode || "CASH") as PaymentMode,
      collectOnDelivery: Boolean(input.collectOnDelivery),
      creditDays: input.creditDays,
      promisedPaymentDate: input.promisedPaymentDate ?? null,
      initialPaidPen: input.initialPaidPen,
      paymentAccountId: input.paymentAccountId,
      tripId: input.tripId ?? null,
      quoteId,
      orderDate: getLimaDateString(0),
      initialOperationalStatus: "DELIVERED",
      globalDiscountPen: convertedGlobalDiscountPen,
      notes:
        input.notes?.trim() ||
        [quote.notes, `Convertido de ${quote.quote_code}`].filter(Boolean).join(" | "),
      lines: orderLines,
    },
    { skipUndoLog: true }
  );

  await client.query(
    `UPDATE erp.quotes
     SET status = 'CONVERTED',
         related_cpe = $2
     WHERE quote_id = $1`,
    [quoteId, orderResult.orderCode]
  );

  const undoAction = await recordUndoableAction(client, actor, {
    actionType: "QUOTE_CONVERT_TO_ORDER",
    entityTable: "erp.quotes",
    entityId: quoteId,
    entityCode: quote.quote_code,
    summary: `Convirtió cotización ${quote.quote_code} en pedido ${orderResult.orderCode} (${quote.customer_name_raw || "CLIENTE"})`,
    undoPayload: {
      quoteId,
      quoteCode: quote.quote_code,
      orderId: orderResult.orderId,
      orderCode: orderResult.orderCode,
      previousQuoteStatus: quote.status,
      previousRelatedCpe: quote.related_cpe ?? null,
    },
  });

  return {
    quoteId,
    quoteCode: quote.quote_code,
    order: orderResult,
    undoAction,
  };
}
