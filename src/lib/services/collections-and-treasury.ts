import type { PoolClient } from "pg";
import { assertRole, isPartnerRole } from "../rbac";
import {
  AuthorizationError,
  ValidationError,
  type FulfillmentMode,
  type SessionUser,
} from "../types";

export interface OrderDebtItem {
  orderId: number;
  orderCode: string;
  orderDate: string;
  customerPartyId: number | null;
  customerName: string;
  paymentMode: string;
  operationalStatus: string;
  totalPen: number;
  paidPen: number;
  balanceDuePen: number;
  daysOverdue: number;
  agingBucket: "GREEN_0_7" | "AMBER_8_29" | "RED_30_PLUS";
  promisedPaymentDate: string | null;
  promiseStatus:
    | "DUE_TODAY_OR_TOMORROW"
    | "PROMISE_BROKEN"
    | "ON_SCHEDULE"
    | "NO_PROMISE_DATE";
  paymentCount: number;
  lastPaymentDate: string | null;
  createdByName: string | null;
}

export interface CustomerDebtSummary {
  customerKey: string;
  customerPartyId: number | null;
  customerName: string;
  openOrdersCount: number;
  totalSoldPen: number;
  totalPaidPen: number;
  totalBalanceDuePen: number;
  maxDaysOverdue: number;
  agingBucket: "GREEN_0_7" | "AMBER_8_29" | "RED_30_PLUS";
  earliestPromisedPaymentDate: string | null;
  promiseStatus:
    | "DUE_TODAY_OR_TOMORROW"
    | "PROMISE_BROKEN"
    | "ON_SCHEDULE"
    | "NO_PROMISE_DATE";
}

export interface PaymentTimelineEntry {
  arPaymentId: number;
  orderId: number;
  paymentDate: string;
  createdAt: string;
  amountPen: number;
  paymentMode: string;
  collectedByName: string | null;
  notes: string | null;
}

async function resolveCashAccountId(
  client: PoolClient,
  actor: SessionUser,
  explicitAccountId?: number
): Promise<number> {
  if (explicitAccountId) return explicitAccountId;
  if (actor.defaultCashAccountId) return actor.defaultCashAccountId;
  const res = await client.query(
    `SELECT account_id FROM erp.cash_accounts WHERE code = 'CAJA_RUTA' LIMIT 1`
  );
  return Number(res.rows[0].account_id);
}

function computeNextPromisedDate(
  nextCollectionDays?: number,
  nextPromisedPaymentDate?: string | null
): string | null {
  if (nextPromisedPaymentDate) return nextPromisedPaymentDate;
  if (nextCollectionDays && nextCollectionDays > 0) {
    const d = new Date();
    d.setDate(d.getDate() + nextCollectionDays);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

export async function registerOrderPayment(
  client: PoolClient,
  actor: SessionUser,
  input: {
    orderId: number;
    amountPen: number;
    paymentMode: "CASH" | "YAPE_PLIN" | "TRANSFER";
    accountId?: number;
    notes?: string;
    nextCollectionDays?: number;
    nextPromisedPaymentDate?: string | null;
  }
): Promise<{
  arPaymentId: number;
  newPaidPen: number;
  newBalanceDuePen: number;
  isSettled: boolean;
  promisedPaymentDate: string | null;
}> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"]);

  const amountPen = Number(input.amountPen);
  if (!amountPen || amountPen <= 0) {
    throw new ValidationError("El monto del abono debe ser mayor a S/ 0.00");
  }

  const orderRes = await client.query(
    `SELECT
       order_id, order_code, customer_party_id, customer_name_raw,
       total_pen, paid_pen, balance_due_pen, is_settled, promised_payment_date::text AS promised_payment_date
     FROM erp.sales_orders
     WHERE order_id = $1
     FOR UPDATE`,
    [input.orderId]
  );
  if (orderRes.rowCount === 0) {
    throw new ValidationError("Pedido no encontrado");
  }
  const order = orderRes.rows[0];
  const currentBalance = Number(order.balance_due_pen);
  if (amountPen > currentBalance + 0.05) {
    throw new ValidationError("El abono supera el saldo pendiente del pedido");
  }

  const accountId = await resolveCashAccountId(client, actor, input.accountId);

  const ledgerRes = await client.query(
    `INSERT INTO erp.cash_ledger (
       tx_date, account_id, party_id, direction, amount_pen,
       expense_category, is_internal_transfer, reference_table, reference_id,
       description, source_origin
     ) VALUES (
       CURRENT_DATE, $1, $2, 'IN', $3,
       'COBRANZA_VENTA', FALSE, 'erp.sales_orders', $4,
       $5, 'ERP_APP'
     ) RETURNING ledger_id`,
    [
      accountId,
      order.customer_party_id !== null ? Number(order.customer_party_id) : null,
      amountPen,
      String(order.order_id),
      `Abono pedido ${order.order_code} (${order.customer_name_raw})`,
    ]
  );

  const payRes = await client.query(
    `INSERT INTO erp.ar_payments (
       order_id, payment_date, amount_pen, payment_mode,
       account_id, reference_doc, collected_by_user_id,
       source_origin, notes
     ) VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, 'ERP_APP', $7)
     RETURNING ar_payment_id`,
    [
      input.orderId,
      amountPen,
      input.paymentMode,
      accountId,
      `LEDGER-${ledgerRes.rows[0].ledger_id}`,
      actor.userId,
      input.notes ?? "Abono registrado",
    ]
  );

  const nextPromised = computeNextPromisedDate(
    input.nextCollectionDays,
    input.nextPromisedPaymentDate
  );
  if (nextPromised) {
    await client.query(
      `UPDATE erp.sales_orders
       SET promised_payment_date = $1,
           due_date = $1
       WHERE order_id = $2`,
      [nextPromised, input.orderId]
    );
  }

  const updatedOrderRes = await client.query(
    `SELECT paid_pen, balance_due_pen, is_settled, promised_payment_date::text AS promised_payment_date
     FROM erp.sales_orders
     WHERE order_id = $1`,
    [input.orderId]
  );
  const updated = updatedOrderRes.rows[0];

  return {
    arPaymentId: Number(payRes.rows[0].ar_payment_id),
    newPaidPen: Number(updated.paid_pen),
    newBalanceDuePen: Number(updated.balance_due_pen),
    isSettled: Boolean(updated.is_settled),
    promisedPaymentDate: updated.promised_payment_date ?? null,
  };
}

export async function registerCustomerFifoPayment(
  client: PoolClient,
  actor: SessionUser,
  input: {
    customerPartyId: number;
    totalAmountPen: number;
    paymentMode: "CASH" | "YAPE_PLIN" | "TRANSFER";
    accountId?: number;
    notes?: string;
    nextCollectionDays?: number;
    nextPromisedPaymentDate?: string | null;
  }
): Promise<Array<{ orderId: number; orderCode: string; appliedPen: number }>> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"]);

  const totalAmount = Number(input.totalAmountPen);
  if (!totalAmount || totalAmount <= 0) {
    throw new ValidationError("El monto total a abonar debe ser mayor a S/ 0.00");
  }

  const openOrdersRes = await client.query(
    `SELECT order_id, order_code, balance_due_pen
     FROM erp.sales_orders
     WHERE customer_party_id = $1
       AND is_settled = FALSE
       AND balance_due_pen > 0.05
       AND operational_status <> 'CANCELLED'
     ORDER BY order_date ASC, order_id ASC
     FOR UPDATE`,
    [input.customerPartyId]
  );

  if (openOrdersRes.rowCount === 0) {
    throw new ValidationError("El cliente no tiene pedidos pendientes de cobro");
  }

  const totalCustomerDebt = openOrdersRes.rows.reduce(
    (sum, r) => sum + Number(r.balance_due_pen),
    0
  );
  if (totalAmount > totalCustomerDebt + 0.05) {
    throw new ValidationError(
      `El abono (S/ ${totalAmount.toFixed(2)}) supera la deuda total del cliente (S/ ${totalCustomerDebt.toFixed(2)})`
    );
  }

  let remaining = totalAmount;
  const allocations: Array<{
    orderId: number;
    orderCode: string;
    appliedPen: number;
  }> = [];

  for (const row of openOrdersRes.rows) {
    if (remaining <= 0.001) break;
    const orderBalance = Number(row.balance_due_pen);
    const appliedPen = Number(Math.min(remaining, orderBalance).toFixed(2));
    if (appliedPen <= 0) continue;

    await registerOrderPayment(client, actor, {
      orderId: Number(row.order_id),
      amountPen: appliedPen,
      paymentMode: input.paymentMode,
      accountId: input.accountId,
      notes: input.notes ?? "Abono general FIFO por cliente",
      nextCollectionDays:
        appliedPen < orderBalance - 0.05 ? input.nextCollectionDays : undefined,
      nextPromisedPaymentDate:
        appliedPen < orderBalance - 0.05
          ? input.nextPromisedPaymentDate
          : undefined,
    });

    allocations.push({
      orderId: Number(row.order_id),
      orderCode: String(row.order_code),
      appliedPen,
    });
    remaining = Number((remaining - appliedPen).toFixed(2));
  }

  return allocations;
}

export async function listDebtors(
  client: PoolClient,
  actor: SessionUser
): Promise<{
  byCustomer: CustomerDebtSummary[];
  byOrder: OrderDebtItem[];
}> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"]);

  const res = await client.query(
    `SELECT
       order_id,
       order_code,
       order_date::text AS order_date,
       customer_party_id,
       customer_name,
       payment_mode,
       operational_status,
       total_pen,
       paid_pen,
       balance_due_pen,
       days_overdue,
       aging_bucket,
       promised_payment_date::text AS promised_payment_date,
       promise_status,
       payment_count,
       last_payment_date::text AS last_payment_date,
       created_by_name
     FROM analytics.v_debtors_aging
     ORDER BY
       CASE promise_status
         WHEN 'PROMISE_BROKEN' THEN 0
         WHEN 'DUE_TODAY_OR_TOMORROW' THEN 1
         WHEN 'ON_SCHEDULE' THEN 2
         ELSE 3
       END ASC,
       days_overdue DESC,
       order_id ASC`
  );

  const byOrder: OrderDebtItem[] = res.rows.map((r) => ({
    orderId: Number(r.order_id),
    orderCode: String(r.order_code),
    orderDate: String(r.order_date),
    customerPartyId:
      r.customer_party_id !== null ? Number(r.customer_party_id) : null,
    customerName: String(r.customer_name),
    paymentMode: String(r.payment_mode),
    operationalStatus: String(r.operational_status),
    totalPen: Number(r.total_pen),
    paidPen: Number(r.paid_pen),
    balanceDuePen: Number(r.balance_due_pen),
    daysOverdue: Number(r.days_overdue),
    agingBucket: r.aging_bucket,
    promisedPaymentDate: r.promised_payment_date ?? null,
    promiseStatus: r.promise_status,
    paymentCount: Number(r.payment_count),
    lastPaymentDate: r.last_payment_date ?? null,
    createdByName: r.created_by_name ?? null,
  }));

  const customerMap = new Map<string, CustomerDebtSummary>();
  for (const item of byOrder) {
    const key =
      item.customerPartyId !== null
        ? `PARTY-${item.customerPartyId}`
        : `RAW-${item.customerName.toUpperCase()}`;

    if (!customerMap.has(key)) {
      customerMap.set(key, {
        customerKey: key,
        customerPartyId: item.customerPartyId,
        customerName: item.customerName,
        openOrdersCount: 0,
        totalSoldPen: 0,
        totalPaidPen: 0,
        totalBalanceDuePen: 0,
        maxDaysOverdue: 0,
        agingBucket: "GREEN_0_7",
        earliestPromisedPaymentDate: item.promisedPaymentDate,
        promiseStatus: item.promiseStatus,
      });
    }
    const cust = customerMap.get(key)!;
    cust.openOrdersCount += 1;
    cust.totalSoldPen = Number((cust.totalSoldPen + item.totalPen).toFixed(2));
    cust.totalPaidPen = Number((cust.totalPaidPen + item.paidPen).toFixed(2));
    cust.totalBalanceDuePen = Number(
      (cust.totalBalanceDuePen + item.balanceDuePen).toFixed(2)
    );
    if (item.daysOverdue > cust.maxDaysOverdue) {
      cust.maxDaysOverdue = item.daysOverdue;
      cust.agingBucket = item.agingBucket;
    }
    if (
      item.promisedPaymentDate &&
      (!cust.earliestPromisedPaymentDate ||
        item.promisedPaymentDate < cust.earliestPromisedPaymentDate)
    ) {
      cust.earliestPromisedPaymentDate = item.promisedPaymentDate;
    }
    if (item.promiseStatus === "PROMISE_BROKEN") {
      cust.promiseStatus = "PROMISE_BROKEN";
    } else if (
      item.promiseStatus === "DUE_TODAY_OR_TOMORROW" &&
      cust.promiseStatus !== "PROMISE_BROKEN"
    ) {
      cust.promiseStatus = "DUE_TODAY_OR_TOMORROW";
    }
  }

  const byCustomer = Array.from(customerMap.values()).sort(
    (a, b) => b.totalBalanceDuePen - a.totalBalanceDuePen
  );

  return { byCustomer, byOrder };
}

export async function getOrderPaymentTimeline(
  client: PoolClient,
  actor: SessionUser,
  orderId: number
): Promise<PaymentTimelineEntry[]> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"]);

  const res = await client.query(
    `SELECT
       p.ar_payment_id,
       p.order_id,
       p.payment_date::text AS payment_date,
       p.created_at::text AS created_at,
       p.amount_pen,
       p.payment_mode::text AS payment_mode,
       u.full_name AS collected_by_name,
       p.notes
     FROM erp.ar_payments p
     LEFT JOIN erp.app_users u ON u.user_id = p.collected_by_user_id
     WHERE p.order_id = $1
     ORDER BY p.payment_date ASC, p.ar_payment_id ASC`,
    [orderId]
  );

  return res.rows.map((r) => ({
    arPaymentId: Number(r.ar_payment_id),
    orderId: Number(r.order_id),
    paymentDate: String(r.payment_date),
    createdAt: String(r.created_at),
    amountPen: Number(r.amount_pen),
    paymentMode: String(r.payment_mode),
    collectedByName: r.collected_by_name ?? null,
    notes: r.notes ?? null,
  }));
}

export async function registerCashOutflow(
  client: PoolClient,
  actor: SessionUser,
  input: {
    amountPen: number;
    expenseBucket: "ROUTE_OPEX" | "MERCHANDISE_PAYMENT" | "NON_OPEX_OR_CAPEX";
    expenseCategory: string;
    description: string;
    accountId?: number;
    isInternalTransfer?: boolean;
  }
): Promise<{ ledgerId: number }> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"]);

  if (actor.role === "EXTERNAL_SELLER" && input.expenseBucket !== "ROUTE_OPEX") {
    throw new AuthorizationError(
      "El Vendedor Externo solo puede registrar gastos operativos de ruta (ROUTE_OPEX)"
    );
  }

  const amountPen = Number(input.amountPen);
  if (!amountPen || amountPen <= 0) {
    throw new ValidationError("El monto del egreso debe ser mayor a S/ 0.00");
  }
  if (!input.description?.trim()) {
    throw new ValidationError("La descripción del gasto es obligatoria");
  }

  const accountId = await resolveCashAccountId(client, actor, input.accountId);
  const res = await client.query(
    `INSERT INTO erp.cash_ledger (
       tx_date, account_id, direction, amount_pen,
       expense_bucket, expense_category, is_internal_transfer,
       description, source_origin
     ) VALUES (
       CURRENT_DATE, $1, 'OUT', $2,
       $3, $4, $5,
       $6, 'ERP_APP'
     ) RETURNING ledger_id`,
    [
      accountId,
      amountPen,
      input.expenseBucket,
      input.expenseCategory.trim().toUpperCase(),
      Boolean(input.isInternalTransfer),
      input.description.trim(),
    ]
  );

  return { ledgerId: Number(res.rows[0].ledger_id) };
}

export async function resetHistoricalNegativeStock(
  client: PoolClient,
  actor: SessionUser
): Promise<{ adjustedSkuCount: number }> {
  if (!isPartnerRole(actor.role)) {
    throw new AuthorizationError(
      "Solo los Socios pueden poner en 0 los saldos negativos históricos"
    );
  }

  const negRes = await client.query(
    `SELECT warehouse_id, product_id, sku, stock_on_hand
     FROM erp.v_current_stock
     WHERE stock_on_hand < -0.0001
     ORDER BY product_id ASC`
  );

  let count = 0;
  for (const row of negRes.rows) {
    const deficit = Math.abs(Number(row.stock_on_hand));
    await client.query(
      `INSERT INTO erp.inventory_movements (
         warehouse_id, product_id, movement_date, movement_type,
         quantity_delta, source_origin, notes
       ) VALUES ($1, $2, NOW(), 'ADJUSTMENT', $3, 'ERP_APP', $4)`,
      [
        Number(row.warehouse_id),
        Number(row.product_id),
        deficit,
        `RESET_HISTORICAL_DEFICIT by ${actor.username} (${row.sku})`,
      ]
    );
    count += 1;
  }

  return { adjustedSkuCount: count };
}

export async function updateProductStockAndPricing(
  client: PoolClient,
  actor: SessionUser,
  input: {
    productId: number;
    physicalStock?: number;
    refCostPen?: number;
    listSalePricePen?: number;
    minSalePricePen?: number;
    fulfillmentMode?: FulfillmentMode;
  }
): Promise<void> {
  if (!isPartnerRole(actor.role)) {
    throw new AuthorizationError(
      "Solo los Socios pueden actualizar costos, precios mínimos y stock físico"
    );
  }

  const whRes = await client.query(
    `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1`
  );
  const warehouseId = Number(whRes.rows[0].warehouse_id);

  if (
    input.refCostPen !== undefined ||
    input.listSalePricePen !== undefined ||
    input.minSalePricePen !== undefined ||
    input.fulfillmentMode !== undefined
  ) {
    await client.query(
      `UPDATE erp.products
       SET ref_cost_pen = COALESCE($1, ref_cost_pen),
           cost_source = CASE WHEN $1 IS NOT NULL THEN 'MANUAL_PARTNER' ELSE cost_source END,
           list_sale_price_pen = COALESCE($2, list_sale_price_pen),
           min_sale_price_pen = COALESCE($3, min_sale_price_pen),
           fulfillment_mode = COALESCE($4::erp.fulfillment_mode, fulfillment_mode),
           updated_at = NOW()
       WHERE product_id = $5`,
      [
        input.refCostPen ?? null,
        input.listSalePricePen ?? null,
        input.minSalePricePen ?? null,
        input.fulfillmentMode ?? null,
        input.productId,
      ]
    );
  }

  if (input.physicalStock !== undefined) {
    if (input.physicalStock < 0) {
      throw new ValidationError("El stock físico no puede ser negativo");
    }
    const stockRes = await client.query(
      `SELECT COALESCE(stock_on_hand, 0) AS stock_on_hand
       FROM erp.v_current_stock
       WHERE warehouse_id = $1 AND product_id = $2`,
      [warehouseId, input.productId]
    );
    const currentStock =
      stockRes.rowCount && stockRes.rowCount > 0
        ? Number(stockRes.rows[0].stock_on_hand)
        : 0;
    const delta = Number((input.physicalStock - currentStock).toFixed(4));
    if (Math.abs(delta) > 0.0001) {
      await client.query(
        `INSERT INTO erp.inventory_movements (
           warehouse_id, product_id, movement_date, movement_type,
           quantity_delta, unit_cost_pen, source_origin, notes
         ) VALUES ($1, $2, NOW(), 'ADJUSTMENT', $3, $4, 'ERP_APP', $5)`,
        [
          warehouseId,
          input.productId,
          delta,
          input.refCostPen ?? null,
          `CONTEO_FISICO_DIA_1 by ${actor.username} (target=${input.physicalStock})`,
        ]
      );
    }
  }
}
