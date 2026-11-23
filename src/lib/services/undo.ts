import type { PoolClient } from "pg";
import {
  formatAuditFlagStatusEs,
  formatOperationalStatusEs,
  formatQuoteStatusEs,
  formatRouteTripStatusEs,
} from "../labels-es";
import { assertRole } from "../rbac";
import {
  AuthorizationError,
  ValidationError,
  parsePositiveInt,
  type SessionUser,
} from "../types";
import { resolveActiveCashAccount } from "./cash-account-resolver";
import { getNumericSetting } from "./settings";

export const NON_ADMIN_UNDO_WINDOW_SECONDS = 900; // 15 minutes

export type UndoableActionType =
  | "QUOTE_STATUS_CHANGE"
  | "QUOTE_CONVERT_TO_ORDER"
  | "ORDER_CANCEL"
  | "ORDER_STATUS_ADVANCE"
  | "ORDER_CREATE"
  | "TRIP_CLOSE"
  | "AUDIT_FLAG_STATUS";

export const UNDOABLE_ACTION_TYPES: readonly UndoableActionType[] = [
  "QUOTE_STATUS_CHANGE",
  "QUOTE_CONVERT_TO_ORDER",
  "ORDER_CANCEL",
  "ORDER_STATUS_ADVANCE",
  "ORDER_CREATE",
  "TRIP_CLOSE",
  "AUDIT_FLAG_STATUS",
] as const;

export interface UndoActionReceipt {
  undoId: number;
  actionType: UndoableActionType;
  entityTable: string;
  entityId: string;
  entityCode: string | null;
  summary: string;
  createdAt: string;
  expiresAt: string;
  windowSeconds: number;
}

export interface UndoableActionRow {
  undo_id: number;
  action_type: UndoableActionType;
  entity_table: string;
  entity_id: string;
  entity_code: string | null;
  summary: string;
  actor_user_id: number;
  actor_username: string;
  actor_name: string;
  actor_role: string;
  created_at: string;
  expires_at: string;
  undone_at: string | null;
  undone_by_user_id: number | null;
  undone_by_name: string | null;
  undone_reason: string | null;
  is_expired: boolean;
  can_undo: boolean;
  remaining_seconds: number;
}

export interface RecordUndoableActionInput {
  actionType: UndoableActionType;
  entityTable: string;
  entityId: string | number;
  entityCode?: string | null;
  summary: string;
  undoPayload: Record<string, unknown>;
  windowSeconds?: number;
}

export async function recordUndoableAction(
  client: PoolClient,
  actor: SessionUser,
  input: RecordUndoableActionInput
): Promise<UndoActionReceipt> {
  const configuredMinutes =
    input.windowSeconds === undefined
      ? await getNumericSetting(client, "undo_window_minutes", 15)
      : null;
  const defaultWindowSeconds =
    configuredMinutes !== null
      ? Math.round(configuredMinutes * 60)
      : NON_ADMIN_UNDO_WINDOW_SECONDS;
  const windowSeconds = Math.max(
    60,
    Math.floor(input.windowSeconds ?? defaultWindowSeconds)
  );
  const res = await client.query<{
    undo_id: string;
    created_at: string;
    expires_at: string;
  }>(
    `INSERT INTO erp.undoable_actions (
       action_type, entity_table, entity_id, entity_code,
       summary, actor_user_id, actor_role, undo_payload,
       expires_at
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7::erp.user_role, $8::jsonb,
       NOW() + make_interval(secs => $9)
     )
     RETURNING
       undo_id::text AS undo_id,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
       to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at`,
    [
      input.actionType,
      input.entityTable,
      String(input.entityId),
      input.entityCode ?? null,
      input.summary.trim().slice(0, 280),
      actor.userId,
      actor.role,
      JSON.stringify(input.undoPayload),
      windowSeconds,
    ]
  );

  const row = res.rows[0];
  return {
    undoId: Number(row.undo_id),
    actionType: input.actionType,
    entityTable: input.entityTable,
    entityId: String(input.entityId),
    entityCode: input.entityCode ?? null,
    summary: input.summary.trim().slice(0, 280),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    windowSeconds,
  };
}

export async function listUndoableActions(
  client: PoolClient,
  actor: SessionUser,
  options: {
    scope?: "mine" | "all";
    status?: "PENDING" | "UNDONE" | "ALL";
    actionType?: string | null;
    limit?: number;
  } = {}
): Promise<{
  scope: "mine" | "all";
  windowSeconds: number;
  isAdmin: boolean;
  actions: UndoableActionRow[];
}> {
  assertRole(actor, [
    "PARTNER_ADMIN",
    "PARTNER_MANAGER",
    "EXTERNAL_SELLER",
    "WAREHOUSE_DELIVERY",
  ]);

  const isAdmin = actor.role === "PARTNER_ADMIN";
  const scope = options.scope ?? (isAdmin ? "all" : "mine");
  if (scope === "all" && !isAdmin) {
    throw new AuthorizationError(
      "Solo el Administrador puede ver y revertir el historial global de acciones"
    );
  }

  const status = String(options.status || "ALL")
    .trim()
    .toUpperCase();
  if (!["PENDING", "UNDONE", "ALL"].includes(status)) {
    throw new ValidationError("Filtro de estado inválido (use PENDING, UNDONE o ALL)");
  }

  const actionType = options.actionType?.trim().toUpperCase() || null;
  if (
    actionType &&
    !(UNDOABLE_ACTION_TYPES as readonly string[]).includes(actionType)
  ) {
    throw new ValidationError(`Tipo de acción inválido: ${actionType}`);
  }

  const safeLimit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 80)));

  const res = await client.query<{
    undo_id: string;
    action_type: UndoableActionType;
    entity_table: string;
    entity_id: string;
    entity_code: string | null;
    summary: string;
    actor_user_id: string;
    actor_username: string;
    actor_name: string;
    actor_role: string;
    created_at: string;
    expires_at: string;
    undone_at: string | null;
    undone_by_user_id: string | null;
    undone_by_name: string | null;
    undone_reason: string | null;
    is_expired: boolean;
    remaining_seconds: number;
  }>(
    `SELECT
       ua.undo_id::text AS undo_id,
       ua.action_type,
       ua.entity_table,
       ua.entity_id,
       ua.entity_code,
       ua.summary,
       ua.actor_user_id::text AS actor_user_id,
       COALESCE(u_actor.username, 'sistema') AS actor_username,
       COALESCE(u_actor.full_name, 'Usuario') AS actor_name,
       ua.actor_role::text AS actor_role,
       to_char(ua.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
       to_char(ua.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at,
       CASE WHEN ua.undone_at IS NOT NULL
         THEN to_char(ua.undone_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         ELSE NULL
       END AS undone_at,
       ua.undone_by_user_id::text AS undone_by_user_id,
       u_undo.full_name AS undone_by_name,
       ua.undone_reason,
       (NOW() > ua.expires_at) AS is_expired,
       GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (ua.expires_at - NOW()))))::int AS remaining_seconds
     FROM erp.undoable_actions ua
     LEFT JOIN erp.app_users u_actor ON u_actor.user_id = ua.actor_user_id
     LEFT JOIN erp.app_users u_undo ON u_undo.user_id = ua.undone_by_user_id
     WHERE ($1::boolean OR ua.actor_user_id = $2)
       AND (
         $3 = 'ALL'
         OR ($3 = 'PENDING' AND ua.undone_at IS NULL AND ($4::boolean OR NOW() <= ua.expires_at))
         OR ($3 = 'UNDONE' AND ua.undone_at IS NOT NULL)
       )
       AND ($5::text IS NULL OR ua.action_type = $5)
     ORDER BY
       CASE WHEN ua.undone_at IS NULL THEN 0 ELSE 1 END ASC,
       ua.created_at DESC,
       ua.undo_id DESC
     LIMIT $6`,
    [scope === "all", actor.userId, status, isAdmin, actionType, safeLimit]
  );

  const actions: UndoableActionRow[] = res.rows.map((r) => {
    const undone = r.undone_at !== null;
    const isExpired = Boolean(r.is_expired);
    const canUndo = !undone && (isAdmin || !isExpired);
    return {
      undo_id: Number(r.undo_id),
      action_type: r.action_type,
      entity_table: String(r.entity_table),
      entity_id: String(r.entity_id),
      entity_code: r.entity_code ? String(r.entity_code) : null,
      summary: String(r.summary),
      actor_user_id: Number(r.actor_user_id),
      actor_username: String(r.actor_username),
      actor_name: String(r.actor_name),
      actor_role: String(r.actor_role),
      created_at: String(r.created_at),
      expires_at: String(r.expires_at),
      undone_at: r.undone_at ? String(r.undone_at) : null,
      undone_by_user_id: r.undone_by_user_id ? Number(r.undone_by_user_id) : null,
      undone_by_name: r.undone_by_name ? String(r.undone_by_name) : null,
      undone_reason: r.undone_reason ? String(r.undone_reason) : null,
      is_expired: isExpired,
      can_undo: canUndo,
      remaining_seconds: Number(r.remaining_seconds ?? 0),
    };
  });

  const configuredMinutes = await getNumericSetting(client, "undo_window_minutes", 15);
  return {
    scope,
    windowSeconds: Math.max(60, Math.round(configuredMinutes * 60)),
    isAdmin,
    actions,
  };
}

async function cancelOrderForUndo(
  client: PoolClient,
  actor: SessionUser,
  orderId: number,
  reason: string,
  options: { allowDeliveredFromQuoteConversion?: boolean } = {}
): Promise<string> {
  const res = await client.query<{
    order_id: string;
    order_code: string;
    warehouse_id: string;
    customer_party_id: string | null;
    stock_deducted: boolean;
    status: string;
    notes: string | null;
  }>(
    `SELECT
       order_id::text,
       order_code,
       warehouse_id::text,
       customer_party_id::text,
       stock_deducted,
       operational_status::text AS status,
       notes
     FROM erp.sales_orders
     WHERE order_id = $1
     FOR UPDATE`,
    [orderId]
  );
  if (res.rowCount === 0) {
    throw new ValidationError("Pedido asociado no encontrado");
  }
  const order = res.rows[0];
  if (order.status === "DELIVERED" && !options.allowDeliveredFromQuoteConversion) {
    throw new ValidationError(
      `El pedido ${order.order_code} ya fue entregado y no puede deshacerse automáticamente`
    );
  }
  if (order.status === "CANCELLED") {
    throw new ValidationError(`El pedido ${order.order_code} ya está anulado`);
  }

  const beforeLines = await client.query(
    `SELECT order_line_id, line_no, product_id, raw_description, quantity,
            pack_factor_applied, base_unit_price_pen, unit_discount_pen,
            unit_price_pen, line_total_pen, fulfillment_status::text
     FROM erp.sales_order_lines
     WHERE order_id = $1
     ORDER BY line_no`,
    [orderId]
  );
  const beforeData = { order, lines: beforeLines.rows };

  const warehouseId = Number(order.warehouse_id);
  if (order.stock_deducted) {
    await client.query(
      `SELECT product_id
       FROM erp.products
       WHERE product_id IN (
         SELECT DISTINCT product_id
         FROM erp.inventory_movements
         WHERE reference_table = 'erp.sales_orders'
           AND reference_id = $1
       )
       ORDER BY product_id ASC
       FOR UPDATE`,
      [String(orderId)]
    );
    await client.query(
      `INSERT INTO erp.inventory_movements (
         warehouse_id, product_id, movement_date, movement_type,
         quantity_delta, unit_cost_pen, reference_table, reference_id,
         source_origin, notes
       )
       SELECT
         $1,
         product_id,
         NOW(),
         'RETURN_IN',
         ABS(SUM(quantity_delta)),
         MAX(unit_cost_pen),
         'erp.sales_orders',
         $2,
         'ERP_APP',
         $3
       FROM erp.inventory_movements
       WHERE reference_table = 'erp.sales_orders'
         AND reference_id = $2
       GROUP BY product_id
       HAVING SUM(quantity_delta) < 0
       ORDER BY product_id ASC`,
      [
        warehouseId,
        String(orderId),
        `Reingreso por deshacer ${order.order_code}: ${reason}`,
      ]
    );
  }

  const activePayments = await client.query<{
    ar_payment_id: string;
    amount_pen: string | number;
    account_id: string | null;
    reference_doc: string | null;
  }>(
    `SELECT ar_payment_id::text, amount_pen, account_id::text, reference_doc
     FROM erp.ar_payments
     WHERE order_id = $1 AND voided_at IS NULL
     ORDER BY ar_payment_id
     FOR UPDATE`,
    [orderId]
  );

  for (const payment of activePayments.rows) {
    let reversalLedgerId: number | null = null;
    if (payment.account_id !== null) {
      const sourceLedgerMatch = String(payment.reference_doc ?? "").match(
        /^LEDGER-(\d+)$/
      );
      const sourceLedgerId = sourceLedgerMatch ? Number(sourceLedgerMatch[1]) : null;
      const revRes = await client.query<{ ledger_id: string }>(
        `INSERT INTO erp.cash_ledger (
           tx_date, account_id, party_id, direction, amount_pen,
           expense_bucket, expense_category, is_internal_transfer,
           reference_table, reference_id, description, source_origin,
           created_by_user_id, reversal_of_ledger_id, is_reversal
         ) VALUES (
           (NOW() AT TIME ZONE 'America/Lima')::date, $1, $2, 'OUT', $3,
           'NON_OPEX_OR_CAPEX', 'REVERSA_COBRANZA_VENTA', FALSE,
           'erp.ar_payments', $4, $5, 'ERP_APP', $6, $7, TRUE
         ) RETURNING ledger_id::text AS ledger_id`,
        [
          Number(payment.account_id),
          order.customer_party_id !== null ? Number(order.customer_party_id) : null,
          Number(payment.amount_pen),
          String(payment.ar_payment_id),
          `Reversa por deshacer ${order.order_code}: ${reason}`,
          actor.userId,
          sourceLedgerId,
        ]
      );
      reversalLedgerId = Number(revRes.rows[0].ledger_id);
    }
    await client.query(
      `UPDATE erp.ar_payments
       SET voided_at = NOW(), voided_by_user_id = $2, void_reason = $3,
           reversal_ledger_id = $4
       WHERE ar_payment_id = $1`,
      [Number(payment.ar_payment_id), actor.userId, reason, reversalLedgerId]
    );
  }

  await client.query(
    `UPDATE erp.audit_flags
     SET status = 'RESOLVED', resolved_at = NOW(), resolved_by = $2
     WHERE flag_code IN ('ON_DEMAND_PENDING_PURCHASE', 'CREDIT_LIMIT_EXCEEDED')
       AND (
         (entity_table = 'erp.sales_order_lines' AND entity_id IN (
           SELECT order_line_id::text FROM erp.sales_order_lines WHERE order_id = $1
         ))
         OR (entity_table = 'erp.sales_orders' AND entity_id = $1::text)
       )
       AND status = 'OPEN'`,
    [orderId, actor.username]
  );

  await client.query(
    `UPDATE erp.audit_flags af
     SET status = 'RESOLVED', resolved_at = NOW(), resolved_by = $3
     FROM erp.sales_order_lines sol
     LEFT JOIN erp.v_current_stock vcs
       ON vcs.warehouse_id = $2 AND vcs.product_id = sol.product_id
     WHERE sol.order_id = $1
       AND af.flag_code IN ('ON_DEMAND_STOCK_DEFICIT', 'UNPURCHASED_STOCK_DEFICIT')
       AND af.entity_table = 'erp.products'
       AND af.entity_id = (sol.product_id::text || '@' || $2::text)
       AND af.status = 'OPEN'
       AND COALESCE(vcs.stock_on_hand, 0) >= 0`,
    [orderId, warehouseId, actor.username]
  );

  await client.query(
    `UPDATE erp.sales_order_lines SET fulfillment_status = 'CANCELLED' WHERE order_id = $1`,
    [orderId]
  );

  await client.query(
    `UPDATE erp.sales_orders
     SET operational_status = 'CANCELLED',
         stock_deducted = FALSE,
         notes = COALESCE(notes || ' | ', '') || $1
     WHERE order_id = $2`,
    [`DESHECHO: ${reason}`, orderId]
  );

  await client.query(
    `INSERT INTO erp.sales_order_events (order_id, from_status, to_status, actor_user_id, notes)
     VALUES ($1, $2::erp.order_operational_status, 'CANCELLED', $3, $4)`,
    [orderId, order.status, actor.userId, `Deshacer acción: ${reason}`]
  );

  const afterOrder = await client.query(
    `SELECT order_id, order_code, operational_status::text AS operational_status, total_pen, paid_pen, stock_deducted, notes
     FROM erp.sales_orders WHERE order_id = $1`,
    [orderId]
  );
  const afterLines = await client.query(
    `SELECT order_line_id, line_no, product_id, quantity, fulfillment_status::text
     FROM erp.sales_order_lines WHERE order_id = $1 ORDER BY line_no`,
    [orderId]
  );
  await client.query(
    `INSERT INTO erp.sales_order_audit_log
       (order_id, action, actor_user_id, actor_role, reason, before_data, after_data)
     VALUES ($1, 'CANCEL', $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      orderId,
      actor.userId,
      actor.role,
      reason,
      JSON.stringify(beforeData),
      JSON.stringify({ order: afterOrder.rows[0], lines: afterLines.rows }),
    ]
  );

  return order.order_code;
}

export async function executeUndoAction(
  client: PoolClient,
  actor: SessionUser,
  input: { undoId: number; reason?: string | null }
): Promise<{
  ok: true;
  undoId: number;
  actionType: UndoableActionType;
  entityCode: string | null;
  restoredMessage: string;
}> {
  assertRole(actor, [
    "PARTNER_ADMIN",
    "PARTNER_MANAGER",
    "EXTERNAL_SELLER",
    "WAREHOUSE_DELIVERY",
  ]);

  const undoId = parsePositiveInt(input.undoId, "Acción a deshacer");
  const reason = input.reason?.trim() || "Acción deshecha por error operativo";

  const lockRes = await client.query<{
    undo_id: string;
    action_type: UndoableActionType;
    entity_table: string;
    entity_id: string;
    entity_code: string | null;
    summary: string;
    actor_user_id: string;
    undo_payload: Record<string, unknown>;
    undone_at: string | null;
    is_expired: boolean;
  }>(
    `SELECT
       undo_id::text AS undo_id,
       action_type,
       entity_table,
       entity_id,
       entity_code,
       summary,
       actor_user_id::text AS actor_user_id,
       undo_payload,
       undone_at::text AS undone_at,
       (NOW() > expires_at) AS is_expired
     FROM erp.undoable_actions
     WHERE undo_id = $1
     FOR UPDATE`,
    [undoId]
  );

  if (lockRes.rowCount === 0) {
    throw new ValidationError("Acción reversible no encontrada");
  }

  const row = lockRes.rows[0];
  if (row.undone_at !== null) {
    throw new ValidationError("Esta acción ya fue deshecha anteriormente");
  }

  const isAdmin = actor.role === "PARTNER_ADMIN";
  if (!isAdmin) {
    if (Number(row.actor_user_id) !== actor.userId) {
      throw new AuthorizationError(
        "Solo puedes deshacer tus propias acciones recientes. Solicita al Administrador si necesitas revertir otra acción."
      );
    }
    if (row.is_expired) {
      throw new ValidationError(
        "El tiempo límite de 15 minutos para deshacer esta acción ya venció. Solicita al Administrador revertirla desde su panel."
      );
    }
  } else {
    await client.query(`SET LOCAL bht.allow_closed_period_override = 'true'`);
  }

  const payload = row.undo_payload ?? {};
  let restoredMessage = "Acción deshecha correctamente.";

  switch (row.action_type) {
    case "QUOTE_STATUS_CHANGE": {
      const quoteId = parsePositiveInt(payload.quoteId, "Cotización");
      const previousStatus = String(payload.previousStatus || "OPEN");
      const nextStatus = String(payload.nextStatus || "");
      const qRes = await client.query<{ status: string; quote_code: string }>(
        `SELECT status::text AS status, quote_code FROM erp.quotes WHERE quote_id = $1 FOR UPDATE`,
        [quoteId]
      );
      if (qRes.rowCount === 0) {
        throw new ValidationError("Cotización no encontrada");
      }
      if (qRes.rows[0].status !== nextStatus) {
        throw new ValidationError(
          `La cotización ${qRes.rows[0].quote_code} ya cambió a estado ${formatQuoteStatusEs(qRes.rows[0].status)} y no puede revertirse con esta acción`
        );
      }
      await client.query(
        `UPDATE erp.quotes SET status = $2::erp.quote_status WHERE quote_id = $1`,
        [quoteId, previousStatus]
      );
      restoredMessage = `Cotización ${qRes.rows[0].quote_code} restaurada a estado ${formatQuoteStatusEs(previousStatus)}.`;
      break;
    }

    case "QUOTE_CONVERT_TO_ORDER": {
      const quoteId = parsePositiveInt(payload.quoteId, "Cotización");
      const orderId = parsePositiveInt(payload.orderId, "Pedido");
      const previousQuoteStatus = String(payload.previousQuoteStatus || "OPEN");
      const previousRelatedCpe =
        payload.previousRelatedCpe !== undefined && payload.previousRelatedCpe !== null
          ? String(payload.previousRelatedCpe)
          : null;

      const qRes = await client.query<{ status: string; quote_code: string }>(
        `SELECT status::text AS status, quote_code FROM erp.quotes WHERE quote_id = $1 FOR UPDATE`,
        [quoteId]
      );
      if (qRes.rowCount === 0) {
        throw new ValidationError("Cotización no encontrada");
      }
      if (qRes.rows[0].status !== "CONVERTED") {
        throw new ValidationError(
          `La cotización ${qRes.rows[0].quote_code} ya no está convertida (estado actual: ${formatQuoteStatusEs(qRes.rows[0].status)})`
        );
      }

      const oCheck = await client.query<{
        status: string;
        quote_id: string | null;
        paid_pen: string | number;
      }>(
        `SELECT operational_status::text AS status, quote_id::text, paid_pen
         FROM erp.sales_orders
         WHERE order_id = $1
         FOR UPDATE`,
        [orderId]
      );
      const oRow = oCheck.rows[0];
      if (!isAdmin && oRow) {
        const st = oRow.status;
        const isDirectQuoteOrder =
          Number(oRow.quote_id) === quoteId && Number(oRow.paid_pen ?? 0) <= 0.05;
        if (
          st !== "REGISTERED" &&
          st !== "PENDING_PARTNER_APPROVAL" &&
          !(st === "DELIVERED" && isDirectQuoteOrder)
        ) {
          throw new ValidationError(
            "El pedido generado ya avanzó en almacén o tiene cobros; solicita al Administrador revertir esta conversión"
          );
        }
      }

      const orderCode = await cancelOrderForUndo(
        client,
        actor,
        orderId,
        `Reversión de conversión ${qRes.rows[0].quote_code}: ${reason}`,
        { allowDeliveredFromQuoteConversion: Number(oRow?.quote_id) === quoteId }
      );
      await client.query(
        `UPDATE erp.quotes
         SET status = $2::erp.quote_status,
             related_cpe = $3
         WHERE quote_id = $1`,
        [quoteId, previousQuoteStatus, previousRelatedCpe]
      );
      restoredMessage = `Conversión deshecha: pedido ${orderCode} anulado y cotización ${qRes.rows[0].quote_code} reabierta.`;
      break;
    }

    case "ORDER_CANCEL": {
      const orderId = parsePositiveInt(payload.orderId, "Pedido");
      const previousStatus = String(payload.previousStatus || "REGISTERED");
      const previousStockDeducted = Boolean(payload.previousStockDeducted);
      const previousNotes =
        payload.previousNotes !== undefined && payload.previousNotes !== null
          ? String(payload.previousNotes)
          : null;
      const lineStatuses = Array.isArray(payload.lineStatuses)
        ? (payload.lineStatuses as Array<{
            orderLineId: number;
            fulfillmentStatus: string;
          }>)
        : [];
      const voidedPayments = Array.isArray(payload.voidedPayments)
        ? (payload.voidedPayments as Array<{
            amountPen: number;
            paymentMode: string;
            accountId: number | null;
            paymentDate: string | null;
            notes: string | null;
            collectedByUserId: number | null;
          }>)
        : [];

      const oRes = await client.query<{
        order_id: string;
        order_code: string;
        warehouse_id: string;
        customer_party_id: string | null;
        customer_name_raw: string | null;
        status: string;
      }>(
        `SELECT
           order_id::text,
           order_code,
           warehouse_id::text,
           customer_party_id::text,
           customer_name_raw,
           operational_status::text AS status
         FROM erp.sales_orders
         WHERE order_id = $1
         FOR UPDATE`,
        [orderId]
      );
      if (oRes.rowCount === 0) {
        throw new ValidationError("Pedido no encontrado");
      }
      const order = oRes.rows[0];
      if (order.status !== "CANCELLED") {
        throw new ValidationError(
          `El pedido ${order.order_code} ya no está anulado (estado actual: ${formatOperationalStatusEs(order.status)})`
        );
      }

      const beforeOrderSnapshot = { ...order };

      for (const ls of lineStatuses) {
        const lid = Number(ls.orderLineId);
        const fStatus = String(ls.fulfillmentStatus || "FULFILLED");
        if (Number.isInteger(lid) && lid > 0) {
          await client.query(
            `UPDATE erp.sales_order_lines
             SET fulfillment_status = $2::erp.fulfillment_status
             WHERE order_line_id = $1 AND order_id = $3`,
            [lid, fStatus, orderId]
          );
        }
      }
      if (lineStatuses.length === 0) {
        await client.query(
          `UPDATE erp.sales_order_lines
           SET fulfillment_status = 'FULFILLED'
           WHERE order_id = $1`,
          [orderId]
        );
      }

      await client.query(
        `UPDATE erp.sales_orders
         SET operational_status = $2::erp.order_operational_status,
             notes = $3,
             stock_deducted = FALSE
         WHERE order_id = $1`,
        [orderId, previousStatus, previousNotes]
      );

      if (previousStockDeducted) {
        await client.query(
          `SELECT product_id
           FROM erp.products
           WHERE product_id IN (
             SELECT DISTINCT sol.product_id
             FROM erp.sales_order_lines sol
             WHERE sol.order_id = $1
               AND sol.fulfillment_status = 'FULFILLED'
           )
           ORDER BY product_id ASC
           FOR UPDATE`,
          [orderId]
        );
        await client.query(
          `INSERT INTO erp.inventory_movements (
             warehouse_id, product_id, movement_date, movement_type,
             quantity_delta, unit_cost_pen, reference_table, reference_id,
             source_origin, notes
           )
           SELECT
             $1,
             sol.product_id,
             NOW(),
             'SALE_OUT',
             -(sol.quantity * sol.pack_factor_applied),
             sol.unit_cost_snapshot_pen,
             'erp.sales_orders',
             $3,
             'ERP_APP',
             $4
           FROM erp.sales_order_lines sol
           WHERE sol.order_id = $2
             AND sol.fulfillment_status = 'FULFILLED'
           ORDER BY sol.product_id ASC, sol.line_no ASC`,
          [
            Number(order.warehouse_id),
            orderId,
            String(orderId),
            `Restauración salida venta ${order.order_code} al deshacer anulación`,
          ]
        );
        await client.query(
          `UPDATE erp.sales_orders SET stock_deducted = TRUE WHERE order_id = $1`,
          [orderId]
        );
      }

      for (const vp of voidedPayments) {
        const amt = Number(vp.amountPen ?? 0);
        if (!Number.isFinite(amt) || amt <= 0) continue;
        const originalPaymentDate =
          typeof vp.paymentDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(vp.paymentDate)
            ? vp.paymentDate
            : null;
        let refDoc: string | null = null;
        let resolvedAccountId: number | null = null;
        if (vp.accountId !== null && vp.accountId !== undefined) {
          const resolvedAccount = await resolveActiveCashAccount(
            client,
            actor,
            Number(vp.accountId)
          );
          resolvedAccountId = resolvedAccount.accountId;
          const led = await client.query<{ ledger_id: string }>(
            `INSERT INTO erp.cash_ledger (
               tx_date, account_id, party_id, direction, amount_pen,
               expense_category, is_internal_transfer, reference_table, reference_id,
               description, source_origin, created_by_user_id
             ) VALUES (
               COALESCE($7::date, (NOW() AT TIME ZONE 'America/Lima')::date), $1, $2, 'IN', $3,
               'COBRANZA_VENTA', FALSE, 'erp.sales_orders', $4,
               $5, 'ERP_APP', $6
             ) RETURNING ledger_id::text AS ledger_id`,
            [
              resolvedAccountId,
              order.customer_party_id !== null ? Number(order.customer_party_id) : null,
              amt,
              String(orderId),
              `Restauración cobro ${order.order_code} (${order.customer_name_raw ?? "CLIENTE"}) al deshacer anulación`,
              actor.userId,
              originalPaymentDate,
            ]
          );
          refDoc = `LEDGER-${led.rows[0].ledger_id}`;
        }
        await client.query(
          `INSERT INTO erp.ar_payments (
             order_id, payment_date, amount_pen, payment_mode,
             account_id, reference_doc, collected_by_user_id,
             source_origin, notes
           ) VALUES (
             $1,
             COALESCE($8::date, (NOW() AT TIME ZONE 'America/Lima')::date),
             $2,
             $3::erp.payment_mode,
             $4,
             $5,
             $6,
             'ERP_APP',
             $7
           )`,
          [
            orderId,
            amt,
            vp.paymentMode || "CASH",
            resolvedAccountId,
            refDoc,
            vp.collectedByUserId ?? actor.userId,
            vp.notes
              ? `${vp.notes} (restaurado)`
              : "Cobro restaurado al deshacer anulación",
            originalPaymentDate,
          ]
        );
      }

      await client.query(
        `INSERT INTO erp.sales_order_events (order_id, from_status, to_status, actor_user_id, notes)
         VALUES ($1, 'CANCELLED', $2::erp.order_operational_status, $3, $4)`,
        [orderId, previousStatus, actor.userId, `Anulación deshecha: ${reason}`]
      );

      await client.query(
        `INSERT INTO erp.sales_order_audit_log
           (order_id, action, actor_user_id, actor_role, reason, before_data, after_data)
         VALUES ($1, 'UNDO_CANCEL', $2, $3, $4, $5::jsonb, $6::jsonb)`,
        [
          orderId,
          actor.userId,
          actor.role,
          reason,
          JSON.stringify({ order: beforeOrderSnapshot }),
          JSON.stringify({
            order_id: orderId,
            order_code: order.order_code,
            operational_status: previousStatus,
            stock_deducted: previousStockDeducted,
            restored_payments: voidedPayments.length,
          }),
        ]
      );

      restoredMessage = `Anulación deshecha: pedido ${order.order_code} restaurado.`;
      break;
    }

    case "ORDER_STATUS_ADVANCE": {
      const orderId = parsePositiveInt(payload.orderId, "Pedido");
      const fromStatus = String(payload.fromStatus || "");
      const toStatus = String(payload.toStatus || "");
      const oRes = await client.query<{
        order_code: string;
        status: string;
      }>(
        `SELECT order_code, operational_status::text AS status
         FROM erp.sales_orders
         WHERE order_id = $1
         FOR UPDATE`,
        [orderId]
      );
      if (oRes.rowCount === 0) {
        throw new ValidationError("Pedido no encontrado");
      }
      if (oRes.rows[0].status !== toStatus) {
        throw new ValidationError(
          `El pedido ${oRes.rows[0].order_code} ya cambió a ${formatOperationalStatusEs(oRes.rows[0].status)} y no puede revertir este paso`
        );
      }

      await client.query(
        `UPDATE erp.sales_orders
         SET operational_status = $2::erp.order_operational_status,
             picked_by_user_id = $3,
             picked_at = $4::timestamptz,
             delivered_by_user_id = $5,
             delivered_at = $6::timestamptz,
             trip_id = $7
         WHERE order_id = $1`,
        [
          orderId,
          fromStatus,
          payload.previousPickedByUserId !== undefined &&
          payload.previousPickedByUserId !== null
            ? Number(payload.previousPickedByUserId)
            : null,
          payload.previousPickedAt ? String(payload.previousPickedAt) : null,
          payload.previousDeliveredByUserId !== undefined &&
          payload.previousDeliveredByUserId !== null
            ? Number(payload.previousDeliveredByUserId)
            : null,
          payload.previousDeliveredAt ? String(payload.previousDeliveredAt) : null,
          payload.previousTripId !== undefined && payload.previousTripId !== null
            ? Number(payload.previousTripId)
            : null,
        ]
      );

      await client.query(
        `INSERT INTO erp.sales_order_events (order_id, from_status, to_status, actor_user_id, notes)
         VALUES ($1, $2::erp.order_operational_status, $3::erp.order_operational_status, $4, $5)`,
        [orderId, toStatus, fromStatus, actor.userId, `Avance deshecho: ${reason}`]
      );

      await client.query(
        `INSERT INTO erp.sales_order_audit_log
           (order_id, action, actor_user_id, actor_role, reason, before_data, after_data)
         VALUES ($1, 'UNDO_STATUS', $2, $3, $4, $5::jsonb, $6::jsonb)`,
        [
          orderId,
          actor.userId,
          actor.role,
          reason,
          JSON.stringify({ operational_status: toStatus }),
          JSON.stringify({ operational_status: fromStatus }),
        ]
      );

      restoredMessage = `Estado del pedido ${oRes.rows[0].order_code} revertido a ${formatOperationalStatusEs(fromStatus)}.`;
      break;
    }

    case "ORDER_CREATE": {
      const orderId = parsePositiveInt(payload.orderId, "Pedido");
      const expectedStatus = String(payload.operationalStatus || "REGISTERED");
      if (!isAdmin) {
        const oCheck = await client.query<{ status: string }>(
          `SELECT operational_status::text AS status FROM erp.sales_orders WHERE order_id = $1 FOR UPDATE`,
          [orderId]
        );
        if (oCheck.rowCount === 0) {
          throw new ValidationError("Pedido no encontrado");
        }
        const st = oCheck.rows[0].status;
        if (st !== expectedStatus) {
          throw new ValidationError(
            "El pedido ya fue procesado por almacén o modificado; solicita al Administrador anularlo"
          );
        }
      }
      const orderCode = await cancelOrderForUndo(
        client,
        actor,
        orderId,
        `Creación de pedido deshecha: ${reason}`
      );
      restoredMessage = `Pedido ${orderCode} revertido y anulado correctamente.`;
      break;
    }

    case "TRIP_CLOSE": {
      const tripId = parsePositiveInt(payload.tripId, "Ruta");
      const previousStatus = String(payload.previousStatus || "OPEN");
      const nextStatus = String(payload.nextStatus || "CLOSED");
      const tRes = await client.query<{ status: string; trip_code: string }>(
        `SELECT status::text AS status, trip_code FROM erp.route_trips WHERE trip_id = $1 FOR UPDATE`,
        [tripId]
      );
      if (tRes.rowCount === 0) {
        throw new ValidationError("Ruta no encontrada");
      }
      if (tRes.rows[0].status !== nextStatus) {
        throw new ValidationError(
          `La ruta ${tRes.rows[0].trip_code} ya no está en estado ${formatRouteTripStatusEs(nextStatus)}`
        );
      }
      await client.query(
        `UPDATE erp.route_trips
         SET status = $2::erp.trip_status,
             end_date = $3::date,
             declared_gross_sales_pen = $4,
             declared_route_opex_pen = $5,
             declared_net_cash_pen = $6,
             notes = $7
         WHERE trip_id = $1`,
        [
          tripId,
          previousStatus,
          payload.previousEndDate ? String(payload.previousEndDate) : null,
          payload.previousDeclaredGrossSalesPen !== undefined &&
          payload.previousDeclaredGrossSalesPen !== null
            ? Number(payload.previousDeclaredGrossSalesPen)
            : null,
          payload.previousDeclaredRouteOpexPen !== undefined &&
          payload.previousDeclaredRouteOpexPen !== null
            ? Number(payload.previousDeclaredRouteOpexPen)
            : null,
          payload.previousDeclaredNetCashPen !== undefined &&
          payload.previousDeclaredNetCashPen !== null
            ? Number(payload.previousDeclaredNetCashPen)
            : null,
          payload.previousNotes !== undefined && payload.previousNotes !== null
            ? String(payload.previousNotes)
            : null,
        ]
      );
      restoredMessage = `Cierre deshecho: ruta ${tRes.rows[0].trip_code} reabierta.`;
      break;
    }

    case "AUDIT_FLAG_STATUS": {
      const flagId = parsePositiveInt(payload.flagId, "Alerta");
      const previousStatus = String(payload.previousStatus || "OPEN");
      const nextStatus = String(payload.nextStatus || "");
      const fRes = await client.query<{ status: string; flag_code: string }>(
        `SELECT status, flag_code FROM erp.audit_flags WHERE flag_id = $1 FOR UPDATE`,
        [flagId]
      );
      if (fRes.rowCount === 0) {
        throw new ValidationError("Alerta no encontrada");
      }
      if (fRes.rows[0].status !== nextStatus) {
        throw new ValidationError(
          `La alerta #${flagId} ya cambió a estado ${formatAuditFlagStatusEs(fRes.rows[0].status)}`
        );
      }
      await client.query(
        `UPDATE erp.audit_flags
         SET status = $2,
             acknowledged_at = $3::timestamptz,
             acknowledged_by = $4,
             resolved_at = $5::timestamptz,
             resolved_by = $6,
             resolution_note = $7
         WHERE flag_id = $1`,
        [
          flagId,
          previousStatus,
          payload.previousAcknowledgedAt
            ? String(payload.previousAcknowledgedAt)
            : null,
          payload.previousAcknowledgedBy
            ? String(payload.previousAcknowledgedBy)
            : null,
          payload.previousResolvedAt ? String(payload.previousResolvedAt) : null,
          payload.previousResolvedBy ? String(payload.previousResolvedBy) : null,
          payload.previousResolutionNote !== undefined &&
          payload.previousResolutionNote !== null
            ? String(payload.previousResolutionNote)
            : null,
        ]
      );
      restoredMessage = `Alerta #${flagId} restaurada a estado ${formatAuditFlagStatusEs(previousStatus)}.`;
      break;
    }

    default:
      throw new ValidationError(
        `Tipo de acción reversible no soportado: ${row.action_type}`
      );
  }

  await client.query(
    `UPDATE erp.undoable_actions
     SET undone_at = NOW(),
         undone_by_user_id = $2,
         undone_reason = $3
     WHERE undo_id = $1`,
    [undoId, actor.userId, reason]
  );

  return {
    ok: true,
    undoId,
    actionType: row.action_type,
    entityCode: row.entity_code,
    restoredMessage,
  };
}
