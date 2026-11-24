import type { PoolClient } from "pg";
import { assertRole } from "../../rbac";
import { ValidationError, type SessionUser } from "../../types";
import { recordUndoableAction, type UndoActionReceipt } from "../undo";
import { SALES_ORDER_COLUMNS } from "./shared";

export async function cancelOrder(
  client: PoolClient,
  actor: SessionUser,
  orderId: number,
  reason: string
): Promise<{ orderId: number; orderCode: string; undoAction?: UndoActionReceipt }> {
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
  if (order.status === "CANCELLED") {
    return { orderId, orderCode: String(order.order_code) };
  }
  if (order.status === "DELIVERED") {
    throw new ValidationError(
      "Un pedido entregado requiere una devolución o corrección administrativa"
    );
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

  // Only restore stock if stock was actually deducted
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
        Number(order.warehouse_id),
        String(orderId),
        `Reingreso por anulación de ${order.order_code}: ${reason}`,
      ]
    );
  }

  // Keep every payment and cash entry. Voiding an AR payment creates a
  // compensating cash movement instead of deleting financial history.
  const activePayments = await client.query(
    `SELECT p.ar_payment_id, p.amount_pen, p.account_id, p.reference_doc,
            p.payment_mode::text AS payment_mode, p.payment_date::text AS payment_date,
            p.notes, p.collected_by_user_id
     FROM erp.ar_payments p
     WHERE p.order_id = $1 AND p.voided_at IS NULL
     ORDER BY p.ar_payment_id
     FOR UPDATE`,
    [orderId]
  );
  const voidedPaymentsSnapshot: Array<{
    arPaymentId: number;
    amountPen: number;
    paymentMode: string;
    accountId: number | null;
    paymentDate: string | null;
    notes: string | null;
    collectedByUserId: number | null;
  }> = [];
  for (const payment of activePayments.rows) {
    let reversalLedgerId: number | null = null;
    if (payment.account_id !== null) {
      const sourceLedgerMatch = String(payment.reference_doc ?? "").match(
        /^LEDGER-(\d+)$/
      );
      const sourceLedgerId = sourceLedgerMatch ? Number(sourceLedgerMatch[1]) : null;
      const reversal = await client.query(
        `INSERT INTO erp.cash_ledger (
         tx_date, account_id, party_id, direction, amount_pen,
         expense_bucket, expense_category, is_internal_transfer,
         reference_table, reference_id, description, source_origin,
         created_by_user_id, reversal_of_ledger_id, is_reversal
       ) VALUES (
         (NOW() AT TIME ZONE 'America/Lima')::date, $1, $2, 'OUT', $3,
         'NON_OPEX_OR_CAPEX', 'REVERSA_COBRANZA_VENTA', FALSE,
         'erp.ar_payments', $4, $5, 'ERP_APP', $6, $7, TRUE
       ) RETURNING ledger_id`,
        [
          Number(payment.account_id),
          order.customer_party_id !== null ? Number(order.customer_party_id) : null,
          Number(payment.amount_pen),
          String(payment.ar_payment_id),
          `Reversa por anulación de ${order.order_code}: ${reason}`,
          actor.userId,
          sourceLedgerId,
        ]
      );
      reversalLedgerId = Number(reversal.rows[0].ledger_id);
    }
    await client.query(
      `UPDATE erp.ar_payments
       SET voided_at = NOW(), voided_by_user_id = $2, void_reason = $3,
           reversal_ledger_id = $4
       WHERE ar_payment_id = $1`,
      [payment.ar_payment_id, actor.userId, reason, reversalLedgerId]
    );
    voidedPaymentsSnapshot.push({
      arPaymentId: Number(payment.ar_payment_id),
      amountPen: Number(payment.amount_pen),
      paymentMode: String(payment.payment_mode || "CASH"),
      accountId: payment.account_id !== null ? Number(payment.account_id) : null,
      paymentDate: payment.payment_date ? String(payment.payment_date) : null,
      notes: payment.notes ? String(payment.notes) : null,
      collectedByUserId:
        payment.collected_by_user_id !== null
          ? Number(payment.collected_by_user_id)
          : null,
    });
  }

  // Close open ON_DEMAND purchase and CREDIT_LIMIT_EXCEEDED flags tied to cancelled order
  await client.query(
    `UPDATE erp.audit_flags
     SET status = 'RESOLVED',
         resolved_at = NOW(),
         resolved_by = $2
     WHERE (
         (flag_code = 'ON_DEMAND_PENDING_PURCHASE'
          AND entity_table = 'erp.sales_order_lines'
          AND entity_id IN (
            SELECT order_line_id::text
            FROM erp.sales_order_lines
            WHERE order_id = $1
          ))
         OR (flag_code = 'CREDIT_LIMIT_EXCEEDED'
          AND entity_table = 'erp.sales_orders'
          AND entity_id = $1::text)
       )
       AND status = 'OPEN'`,
    [orderId, actor.username]
  );

  // Resolve stock deficit flags for SKUs on this order if stock returned to >= 0
  await client.query(
    `UPDATE erp.audit_flags af
     SET status = 'RESOLVED',
         resolved_at = NOW(),
         resolved_by = $3
     FROM erp.sales_order_lines sol
     LEFT JOIN erp.v_current_stock vcs
       ON vcs.warehouse_id = $2 AND vcs.product_id = sol.product_id
     WHERE sol.order_id = $1
       AND af.flag_code IN ('ON_DEMAND_STOCK_DEFICIT', 'UNPURCHASED_STOCK_DEFICIT')
       AND af.entity_table = 'erp.products'
       AND af.entity_id = (sol.product_id::text || '@' || $2::text)
       AND af.status = 'OPEN'
       AND COALESCE(vcs.stock_on_hand, 0) >= 0`,
    [orderId, Number(order.warehouse_id), actor.username]
  );

  await client.query(
    `UPDATE erp.sales_order_lines
     SET fulfillment_status = 'CANCELLED'
     WHERE order_id = $1`,
    [orderId]
  );

  await client.query(
    `UPDATE erp.sales_orders
     SET operational_status = 'CANCELLED',
         stock_deducted = FALSE,
         notes = COALESCE(notes || ' | ', '') || $1
     WHERE order_id = $2`,
    [`ANULADO: ${reason}`, orderId]
  );

  await client.query(
    `INSERT INTO erp.sales_order_events (order_id, from_status, to_status, actor_user_id, notes)
     VALUES ($1, $2, 'CANCELLED', $3, $4)`,
    [orderId, order.status, actor.userId, reason]
  );

  const afterOrder = await client.query(
    `SELECT ${SALES_ORDER_COLUMNS}
     FROM erp.sales_orders WHERE order_id = $1`,
    [orderId]
  );
  const afterLines = await client.query(
    `SELECT order_line_id, line_no, product_id, raw_description, quantity,
            pack_factor_applied, base_unit_price_pen, unit_discount_pen,
            unit_price_pen, line_total_pen, fulfillment_status::text
     FROM erp.sales_order_lines
     WHERE order_id = $1
     ORDER BY line_no`,
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

  const undoAction = await recordUndoableAction(client, actor, {
    actionType: "ORDER_CANCEL",
    entityTable: "erp.sales_orders",
    entityId: orderId,
    entityCode: String(order.order_code),
    summary: `Anuló pedido ${order.order_code} (${order.customer_name_raw || "CLIENTE"})`,
    undoPayload: {
      orderId,
      orderCode: String(order.order_code),
      previousStatus: String(order.status),
      previousStockDeducted: Boolean(order.stock_deducted),
      previousNotes: order.notes ?? null,
      lineStatuses: beforeLines.rows.map((ln) => ({
        orderLineId: Number(ln.order_line_id),
        fulfillmentStatus: String(ln.fulfillment_status || "FULFILLED"),
      })),
      voidedPayments: voidedPaymentsSnapshot,
    },
  });

  return { orderId, orderCode: String(order.order_code), undoAction };
}
