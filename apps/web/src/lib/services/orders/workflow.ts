import type { PoolClient } from "pg";
import { formatOperationalStatusEs } from "../../labels-es";
import { assertRole } from "../../rbac";
import {
  ValidationError,
  type OrderOperationalStatus,
  type SessionUser,
} from "../../types";
import { recordUndoableAction, type UndoActionReceipt } from "../undo";
import { SALES_ORDER_COLUMNS, deductStockForOrderLines } from "./shared";

export async function approveDiscountedOrder(
  client: PoolClient,
  actor: SessionUser,
  orderId: number
): Promise<{ orderId: number; operationalStatus: "REGISTERED" }> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);

  const res = await client.query(
    `SELECT ${SALES_ORDER_COLUMNS}, operational_status::text AS status
     FROM erp.sales_orders
     WHERE order_id = $1
     FOR UPDATE`,
    [orderId]
  );
  if (res.rowCount === 0) {
    throw new ValidationError("Pedido no encontrado");
  }
  const order = res.rows[0];
  if (order.status !== "PENDING_PARTNER_APPROVAL") {
    throw new ValidationError(
      `El pedido no está pendiente de aprobación (estado actual: ${order.status})`
    );
  }

  const warehouseId = Number(order.warehouse_id);

  // Re-evaluate live stock under deterministic SKU locks before deducting
  const linesRes = await client.query<{
    order_line_id: number;
    line_no: number;
    product_id: number;
    sku: string;
    quantity: string | number;
    pack_factor_applied: string | number;
    fulfillment_mode: "STOCKED" | "ON_DEMAND";
    fulfillment_status: string;
  }>(
    `SELECT
       sol.order_line_id,
       sol.line_no,
       sol.product_id,
       p.sku,
       sol.quantity,
       sol.pack_factor_applied,
       p.fulfillment_mode::text AS fulfillment_mode,
       sol.fulfillment_status::text AS fulfillment_status
     FROM erp.sales_order_lines sol
     JOIN erp.products p ON p.product_id = sol.product_id
     WHERE sol.order_id = $1
     ORDER BY sol.line_no ASC
     FOR UPDATE OF sol`,
    [orderId]
  );

  const uniqueProductIds = Array.from(
    new Set(linesRes.rows.map((l) => Number(l.product_id)))
  ).sort((a, b) => a - b);

  if (uniqueProductIds.length > 0) {
    await client.query(
      `SELECT product_id
       FROM erp.products
       WHERE product_id = ANY($1::bigint[])
       ORDER BY product_id ASC
       FOR UPDATE`,
      [uniqueProductIds]
    );

    const stockRes = await client.query<{
      product_id: number;
      stock_on_hand: string | number;
    }>(
      `SELECT product_id, COALESCE(stock_on_hand, 0) AS stock_on_hand
       FROM erp.v_current_stock
       WHERE warehouse_id = $1 AND product_id = ANY($2::bigint[])`,
      [warehouseId, uniqueProductIds]
    );
    const remainingStockByProduct = new Map<number, number>();
    for (const row of stockRes.rows) {
      remainingStockByProduct.set(Number(row.product_id), Number(row.stock_on_hand));
    }

    for (const line of linesRes.rows) {
      const pid = Number(line.product_id);
      const requiredQty = Number(line.quantity) * Number(line.pack_factor_applied || 1);
      const availableStock = remainingStockByProduct.get(pid) ?? 0;

      if (line.fulfillment_mode === "ON_DEMAND") {
        const nextStatus =
          availableStock >= requiredQty ? "FULFILLED" : "PENDING_SUPPLIER_PURCHASE";

        if (nextStatus !== line.fulfillment_status) {
          await client.query(
            `UPDATE erp.sales_order_lines
             SET fulfillment_status = $1::erp.fulfillment_status
             WHERE order_line_id = $2`,
            [nextStatus, Number(line.order_line_id)]
          );
        }

        if (nextStatus === "PENDING_SUPPLIER_PURCHASE") {
          await client.query(
            `INSERT INTO erp.audit_flags (
               flag_code, severity, entity_table, entity_id,
               message, details, source_origin
             ) VALUES (
               'ON_DEMAND_PENDING_PURCHASE',
               'WARNING',
               'erp.sales_order_lines',
               $1,
               $2,
               $3::jsonb,
               'ERP_APP'
             )
             ON CONFLICT (flag_code, entity_table, entity_id)
             WHERE status = 'OPEN'
             DO UPDATE SET
               message = EXCLUDED.message,
               details = EXCLUDED.details`,
            [
              String(line.order_line_id),
              `ON_DEMAND sale line #${line.order_line_id} for SKU ${line.sku} awaiting supplier purchase (on_hand=${availableStock}, required=${requiredQty})`,
              JSON.stringify({
                order_id: orderId,
                order_line_id: Number(line.order_line_id),
                product_id: pid,
                sku: line.sku,
                warehouse_id: warehouseId,
                on_hand_at_order: availableStock,
                required_base_qty: requiredQty,
              }),
            ]
          );
        } else {
          remainingStockByProduct.set(
            pid,
            Number((availableStock - requiredQty).toFixed(4))
          );
        }
      } else {
        remainingStockByProduct.set(
          pid,
          Number((availableStock - requiredQty).toFixed(4))
        );
      }
    }
  }

  if (!order.stock_deducted) {
    await deductStockForOrderLines(
      client,
      warehouseId,
      orderId,
      String(order.order_code)
    );
  }

  await client.query(
    `UPDATE erp.sales_orders
     SET operational_status = 'REGISTERED',
         approved_by_user_id = $1,
         approved_at = NOW(),
         stock_deducted = TRUE
     WHERE order_id = $2`,
    [actor.userId, orderId]
  );

  await client.query(
    `UPDATE erp.audit_flags
     SET status = 'RESOLVED',
         resolved_at = NOW(),
         resolved_by = $2,
         resolution_note = COALESCE(resolution_note, 'Aprobado por Socio')
     WHERE flag_code = 'CREDIT_LIMIT_EXCEEDED'
       AND entity_table = 'erp.sales_orders'
       AND entity_id = $1
       AND status = 'OPEN'`,
    [String(orderId), actor.username]
  );

  await client.query(
    `INSERT INTO erp.sales_order_events (order_id, from_status, to_status, actor_user_id, notes)
     VALUES ($1, 'PENDING_PARTNER_APPROVAL', 'REGISTERED', $2, 'Descuento aprobado por Socio')`,
    [orderId, actor.userId]
  );

  return { orderId, operationalStatus: "REGISTERED" };
}

export async function advanceWarehouseStatus(
  client: PoolClient,
  actor: SessionUser,
  orderId: number,
  nextStatus: "PICKING" | "READY" | "IN_ROUTE" | "DELIVERED",
  options: { previousTripIdOverride?: number | null; skipUndoLog?: boolean } = {}
): Promise<{
  orderId: number;
  orderCode: string;
  fromStatus: OrderOperationalStatus;
  toStatus: "PICKING" | "READY" | "IN_ROUTE" | "DELIVERED";
  undoAction?: UndoActionReceipt;
}> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "WAREHOUSE_DELIVERY"]);

  const res = await client.query<{
    order_id: string;
    order_code: string;
    customer_name_raw: string | null;
    status: string;
    picked_by_user_id: string | null;
    picked_at: string | null;
    delivered_by_user_id: string | null;
    delivered_at: string | null;
    trip_id: string | null;
  }>(
    `SELECT
       order_id::text,
       order_code,
       customer_name_raw,
       operational_status::text AS status,
       picked_by_user_id::text,
       picked_at::text,
       delivered_by_user_id::text,
       delivered_at::text,
       trip_id::text
     FROM erp.sales_orders
     WHERE order_id = $1
     FOR UPDATE`,
    [orderId]
  );
  if (res.rowCount === 0) {
    throw new ValidationError("Pedido no encontrado");
  }
  const existing = res.rows[0];
  const currentStatus = String(existing.status) as OrderOperationalStatus;
  const allowedNextByCurrent: Partial<
    Record<
      OrderOperationalStatus,
      ReadonlyArray<"PICKING" | "READY" | "IN_ROUTE" | "DELIVERED">
    >
  > = {
    REGISTERED: ["PICKING", "READY"],
    PICKING: ["READY"],
    READY: ["IN_ROUTE", "DELIVERED"],
    IN_ROUTE: ["DELIVERED"],
  };

  if (!allowedNextByCurrent[currentStatus]?.includes(nextStatus)) {
    throw new ValidationError(
      `Transición inválida de ${currentStatus} a ${nextStatus}`
    );
  }

  if (nextStatus === "READY" || nextStatus === "PICKING") {
    await client.query(
      `UPDATE erp.sales_orders
       SET operational_status = $1,
           picked_by_user_id = $2,
           picked_at = NOW()
       WHERE order_id = $3`,
      [nextStatus, actor.userId, orderId]
    );
  } else if (nextStatus === "IN_ROUTE") {
    await client.query(
      `UPDATE erp.sales_orders
       SET operational_status = $1,
           delivered_by_user_id = $2
       WHERE order_id = $3`,
      [nextStatus, actor.userId, orderId]
    );
  } else if (nextStatus === "DELIVERED") {
    await client.query(
      `UPDATE erp.sales_orders
       SET operational_status = $1,
           delivered_by_user_id = $2,
           delivered_at = NOW()
       WHERE order_id = $3`,
      [nextStatus, actor.userId, orderId]
    );
  }

  await client.query(
    `INSERT INTO erp.sales_order_events (order_id, from_status, to_status, actor_user_id, notes)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      orderId,
      currentStatus,
      nextStatus,
      actor.userId,
      `Avance operativo a ${nextStatus}`,
    ]
  );

  const prevTripId =
    options.previousTripIdOverride !== undefined
      ? options.previousTripIdOverride
      : existing.trip_id !== null
        ? Number(existing.trip_id)
        : null;

  const undoAction = options.skipUndoLog
    ? undefined
    : await recordUndoableAction(client, actor, {
        actionType: "ORDER_STATUS_ADVANCE",
        entityTable: "erp.sales_orders",
        entityId: orderId,
        entityCode: existing.order_code,
        summary: `Avanzó pedido ${existing.order_code} (${existing.customer_name_raw || "CLIENTE"}) de ${formatOperationalStatusEs(currentStatus)} a ${formatOperationalStatusEs(nextStatus)}`,
        undoPayload: {
          orderId,
          orderCode: existing.order_code,
          fromStatus: currentStatus,
          toStatus: nextStatus,
          previousPickedByUserId:
            existing.picked_by_user_id !== null
              ? Number(existing.picked_by_user_id)
              : null,
          previousPickedAt: existing.picked_at ?? null,
          previousDeliveredByUserId:
            existing.delivered_by_user_id !== null
              ? Number(existing.delivered_by_user_id)
              : null,
          previousDeliveredAt: existing.delivered_at ?? null,
          previousTripId: prevTripId,
        },
      });

  return {
    orderId,
    orderCode: existing.order_code,
    fromStatus: currentStatus,
    toStatus: nextStatus,
    undoAction,
  };
}
