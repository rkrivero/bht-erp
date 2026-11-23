import type { PoolClient } from "pg";
import { assertRole, isPartnerRole } from "../rbac";
import { isCategoryAllowedForBucket, type OutflowBucket } from "../treasury-constants";
import { getLimaDateString } from "./orders";
import {
  AuthorizationError,
  ValidationError,
  parsePositiveInt,
  type FulfillmentMode,
  type LineFulfillmentStatus,
  type SessionUser,
} from "../types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface OrderDebtLineItem {
  orderLineId: number;
  lineNo: number;
  productId: number;
  sku: string;
  rawDescription: string;
  unitOfMeasure: string;
  quantity: number;
  baseUnitPricePen: number;
  unitDiscountPen: number;
  unitPricePen: number;
  lineTotalPen: number;
  fulfillmentMode: FulfillmentMode;
  fulfillmentStatus: LineFulfillmentStatus;
}

export interface OrderDebtItem {
  orderId: number;
  orderCode: string;
  orderDate: string;
  dueDate: string | null;
  customerKey: string;
  customerPartyId: number | null;
  customerName: string;
  paymentMode: string;
  operationalStatus: string;
  totalPen: number;
  paidPen: number;
  balanceDuePen: number;
  daysOverdue: number;
  invoiceAgeDays: number;
  daysPastDue: number | null;
  dueStatus: "OVERDUE" | "DUE_SOON" | "CURRENT" | "NO_DUE_DATE";
  agingBucket: "GREEN_0_7" | "AMBER_8_29" | "RED_30_PLUS";
  promisedPaymentDate: string | null;
  promiseStatus:
    "DUE_TODAY_OR_TOMORROW" | "PROMISE_BROKEN" | "ON_SCHEDULE" | "NO_PROMISE_DATE";
  paymentCount: number;
  lastPaymentDate: string | null;
  createdByName: string | null;
  lines: OrderDebtLineItem[];
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
  maxInvoiceAgeDays: number;
  hasExplicitDueDate: boolean;
  agingBucket: "GREEN_0_7" | "AMBER_8_29" | "RED_30_PLUS";
  earliestPromisedPaymentDate: string | null;
  promiseStatus:
    "DUE_TODAY_OR_TOMORROW" | "PROMISE_BROKEN" | "ON_SCHEDULE" | "NO_PROMISE_DATE";
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
): Promise<{ accountId: number; name: string; accountType: string }> {
  const { resolveActiveCashAccount } = await import("./cash-account-resolver");
  const resolved = await resolveActiveCashAccount(client, actor, explicitAccountId);
  return {
    accountId: resolved.accountId,
    name: resolved.name,
    accountType: resolved.accountType,
  };
}

function computeNextPromisedDate(
  nextCollectionDays?: number | null,
  nextPromisedPaymentDate?: string | null
): string | null {
  if (nextCollectionDays === null) return null;
  if (nextPromisedPaymentDate) return nextPromisedPaymentDate;
  if (nextCollectionDays && nextCollectionDays > 0) {
    return getLimaDateString(nextCollectionDays);
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
    nextCollectionDays?: number | null;
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
       operational_status::text AS operational_status,
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
  if (
    order.operational_status === "PENDING_PARTNER_APPROVAL" ||
    order.operational_status === "CANCELLED"
  ) {
    throw new ValidationError(
      "No se puede registrar abonos en pedidos pendientes de aprobación o anulados"
    );
  }
  const currentBalance = Number(order.balance_due_pen);
  if (amountPen > currentBalance + 0.05) {
    throw new ValidationError("El abono supera el saldo pendiente del pedido");
  }

  const { accountId } = await resolveCashAccountId(client, actor, input.accountId);

  const ledgerRes = await client.query(
    `INSERT INTO erp.cash_ledger (
       tx_date, account_id, party_id, direction, amount_pen,
       expense_category, is_internal_transfer, reference_table, reference_id,
       description, source_origin
     ) VALUES (
       (NOW() AT TIME ZONE 'America/Lima')::date, $1, $2, 'IN', $3,
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
     ) VALUES ($1, (NOW() AT TIME ZONE 'America/Lima')::date, $2, $3, $4, $5, $6, 'ERP_APP', $7)
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

  const updatedAfterPayRes = await client.query(
    `SELECT is_settled FROM erp.sales_orders WHERE order_id = $1`,
    [input.orderId]
  );
  const nowSettled = Boolean(updatedAfterPayRes.rows[0]?.is_settled);

  if (nowSettled || input.nextCollectionDays === null) {
    if (nowSettled) {
      await client.query(
        `UPDATE erp.sales_orders
         SET promised_payment_date = NULL
         WHERE order_id = $1`,
        [input.orderId]
      );
    }
  } else {
    const nextPromised = computeNextPromisedDate(
      input.nextCollectionDays,
      input.nextPromisedPaymentDate
    );
    if (nextPromised) {
      await client.query(
        `UPDATE erp.sales_orders
         SET promised_payment_date = $1,
             due_date = COALESCE(due_date, $1)
         WHERE order_id = $2`,
        [nextPromised, input.orderId]
      );
    }
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
    nextCollectionDays?: number | null;
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
       AND operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
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

  let remaining = Number(totalAmount.toFixed(2));
  const allocations: Array<{
    orderId: number;
    orderCode: string;
    appliedPen: number;
  }> = [];

  for (let i = 0; i < openOrdersRes.rows.length; i++) {
    if (remaining <= 0.001) break;
    const row = openOrdersRes.rows[i];
    const isLastOpenOrder = i === openOrdersRes.rows.length - 1;
    const orderBalance = Number(row.balance_due_pen);
    const maxApplicable = isLastOpenOrder
      ? Number((orderBalance + 0.05).toFixed(2))
      : orderBalance;
    const appliedPen = Number(Math.min(remaining, maxApplicable).toFixed(2));
    if (appliedPen <= 0) continue;

    const settlesOrder = appliedPen >= orderBalance - 0.05;
    await registerOrderPayment(client, actor, {
      orderId: Number(row.order_id),
      amountPen: appliedPen,
      paymentMode: input.paymentMode,
      accountId: input.accountId,
      notes: input.notes ?? "Abono general FIFO por cliente",
      nextCollectionDays: settlesOrder ? null : input.nextCollectionDays,
      nextPromisedPaymentDate: settlesOrder ? null : input.nextPromisedPaymentDate,
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
       due_date::text AS due_date,
       customer_party_id,
       customer_name,
       payment_mode,
       operational_status,
       total_pen,
       paid_pen,
       balance_due_pen,
       days_overdue,
       invoice_age_days,
       days_past_due,
       due_status,
       aging_bucket,
       promised_payment_date::text AS promised_payment_date,
       promise_status,
       payment_count,
       last_payment_date::text AS last_payment_date,
       created_by_name
     FROM analytics.v_debtors_aging
     WHERE operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
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

  const orderIds = res.rows.map((r) => Number(r.order_id));
  const linesByOrder = new Map<number, OrderDebtLineItem[]>();
  if (orderIds.length > 0) {
    // Load line-item product breakdown without cost/margin so EXTERNAL_SELLER stays RBAC-isolated.
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
         COALESCE(sol.base_unit_price_pen, sol.unit_price_pen) AS base_unit_price_pen,
         COALESCE(sol.unit_discount_pen, 0) AS unit_discount_pen,
         sol.unit_price_pen,
         sol.line_total_pen,
         p.fulfillment_mode::text AS fulfillment_mode,
         sol.fulfillment_status::text AS fulfillment_status
       FROM erp.sales_order_lines sol
       JOIN erp.products p ON p.product_id = sol.product_id
       WHERE sol.order_id = ANY($1::bigint[])
       ORDER BY sol.order_id ASC, sol.line_no ASC`,
      [orderIds]
    );
    for (const row of linesRes.rows) {
      const oid = Number(row.order_id);
      if (!linesByOrder.has(oid)) linesByOrder.set(oid, []);
      linesByOrder.get(oid)!.push({
        orderLineId: Number(row.order_line_id),
        lineNo: Number(row.line_no),
        productId: Number(row.product_id),
        sku: String(row.sku),
        rawDescription: String(row.raw_description),
        unitOfMeasure: String(row.unit_of_measure || "NIU"),
        quantity: Number(row.quantity),
        baseUnitPricePen: Number(row.base_unit_price_pen),
        unitDiscountPen: Number(row.unit_discount_pen),
        unitPricePen: Number(row.unit_price_pen),
        lineTotalPen: Number(row.line_total_pen),
        fulfillmentMode: row.fulfillment_mode,
        fulfillmentStatus: row.fulfillment_status,
      });
    }
  }

  const byOrder: OrderDebtItem[] = res.rows.map((r) => {
    const orderId = Number(r.order_id);
    const customerPartyId =
      r.customer_party_id !== null ? Number(r.customer_party_id) : null;
    const customerName = String(r.customer_name);
    const customerKey =
      customerPartyId !== null
        ? `PARTY-${customerPartyId}`
        : `RAW-${customerName.toUpperCase()}`;
    return {
      orderId,
      orderCode: String(r.order_code),
      orderDate: String(r.order_date),
      dueDate: r.due_date ? String(r.due_date) : null,
      customerKey,
      customerPartyId,
      customerName,
      paymentMode: String(r.payment_mode),
      operationalStatus: String(r.operational_status),
      totalPen: Number(r.total_pen),
      paidPen: Number(r.paid_pen),
      balanceDuePen: Number(r.balance_due_pen),
      daysOverdue: Number(r.days_overdue),
      invoiceAgeDays: Number(r.invoice_age_days ?? r.days_overdue ?? 0),
      daysPastDue:
        r.days_past_due !== null && r.days_past_due !== undefined
          ? Number(r.days_past_due)
          : null,
      dueStatus: (r.due_status || "NO_DUE_DATE") as OrderDebtItem["dueStatus"],
      agingBucket: r.aging_bucket,
      promisedPaymentDate: r.promised_payment_date ?? null,
      promiseStatus: r.promise_status,
      paymentCount: Number(r.payment_count),
      lastPaymentDate: r.last_payment_date ?? null,
      createdByName: r.created_by_name ?? null,
      lines: linesByOrder.get(orderId) ?? [],
    };
  });

  const customerMap = new Map<string, CustomerDebtSummary>();
  for (const item of byOrder) {
    const key = item.customerKey;

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
        maxInvoiceAgeDays: 0,
        hasExplicitDueDate: false,
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
    if (item.invoiceAgeDays > cust.maxInvoiceAgeDays) {
      cust.maxInvoiceAgeDays = item.invoiceAgeDays;
    }
    if (item.dueDate) {
      cust.hasExplicitDueDate = true;
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

  const orderRes = await client.query<{ operational_status: string }>(
    `SELECT operational_status::text AS operational_status
     FROM erp.sales_orders
     WHERE order_id = $1
     LIMIT 1`,
    [orderId]
  );
  if (orderRes.rowCount === 0) {
    throw new ValidationError("Pedido no encontrado");
  }
  if (
    actor.role === "EXTERNAL_SELLER" &&
    orderRes.rows[0].operational_status === "CANCELLED"
  ) {
    throw new AuthorizationError("No puedes consultar pagos de un pedido anulado");
  }

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
       AND p.voided_at IS NULL
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
    expenseBucket?: OutflowBucket | null;
    expenseCategory: string;
    txDate?: string;
    description: string;
    accountId?: number;
    toAccountId?: number;
    isInternalTransfer?: boolean;
    tripId?: number | null;
  }
): Promise<{ ledgerId: number; transferInLedgerId?: number }> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"]);

  const isTransfer = Boolean(input.isInternalTransfer);
  if (actor.role === "EXTERNAL_SELLER") {
    if (isTransfer) {
      throw new AuthorizationError(
        "El Vendedor Externo no puede registrar traslados internos entre cuentas"
      );
    }
    if (input.expenseBucket !== "ROUTE_OPEX") {
      throw new AuthorizationError(
        "El Vendedor Externo solo puede registrar gastos operativos de ruta (ROUTE_OPEX)"
      );
    }
  }

  const amountPen = Number(input.amountPen);
  if (!Number.isFinite(amountPen) || amountPen <= 0) {
    throw new ValidationError("El monto del egreso debe ser mayor a S/ 0.00");
  }
  if (!input.description?.trim()) {
    throw new ValidationError("La descripción del movimiento es obligatoria");
  }
  const txDate = input.txDate?.trim() || getLimaDateString(0);
  if (!DATE_RE.test(txDate)) {
    throw new ValidationError("La fecha del gasto debe tener formato YYYY-MM-DD");
  }

  const fromAcc = await resolveCashAccountId(client, actor, input.accountId);

  if (isTransfer) {
    if (!input.toAccountId) {
      throw new ValidationError(
        "Selecciona una cuenta destino para el traslado interno"
      );
    }
    const toAcc = await resolveCashAccountId(client, actor, input.toAccountId);
    if (toAcc.accountId === fromAcc.accountId) {
      throw new ValidationError(
        "La cuenta destino debe ser distinta a la cuenta origen"
      );
    }
    const descBase = input.description.trim();
    const outRes = await client.query<{ ledger_id: string }>(
      `INSERT INTO erp.cash_ledger (
         tx_date, account_id, direction, amount_pen,
         expense_bucket, expense_category, is_internal_transfer,
         reference_table, reference_id,
         description, source_origin
       ) VALUES (
         $1::date, $2, 'OUT', $3,
         NULL, 'TRASLADO_INTERNO', TRUE,
         'erp.cash_accounts', $4,
         $5, 'ERP_APP'
       ) RETURNING ledger_id`,
      [
        txDate,
        fromAcc.accountId,
        amountPen,
        String(toAcc.accountId),
        `Traslado a ${toAcc.name}: ${descBase}`,
      ]
    );
    const outLedgerId = Number(outRes.rows[0].ledger_id);
    const inRes = await client.query<{ ledger_id: string }>(
      `INSERT INTO erp.cash_ledger (
         tx_date, account_id, direction, amount_pen,
         expense_bucket, expense_category, is_internal_transfer,
         reference_table, reference_id,
         description, source_origin
       ) VALUES (
         $1::date, $2, 'IN', $3,
         NULL, 'TRASLADO_INTERNO', TRUE,
         'erp.cash_ledger', $4,
         $5, 'ERP_APP'
       ) RETURNING ledger_id`,
      [
        txDate,
        toAcc.accountId,
        amountPen,
        String(outLedgerId),
        `Ingreso por traslado desde ${fromAcc.name}: ${descBase}`,
      ]
    );
    return {
      ledgerId: outLedgerId,
      transferInLedgerId: Number(inRes.rows[0].ledger_id),
    };
  }

  const bucket = input.expenseBucket || "ROUTE_OPEX";
  if (
    bucket !== "ROUTE_OPEX" &&
    bucket !== "ADMIN_OPEX" &&
    bucket !== "MERCHANDISE_PAYMENT" &&
    bucket !== "NON_OPEX_OR_CAPEX"
  ) {
    throw new ValidationError("Tipo de salida inválido");
  }
  const normalizedCategory = input.expenseCategory.trim().toUpperCase();
  if (!normalizedCategory || !isCategoryAllowedForBucket(bucket, normalizedCategory)) {
    throw new ValidationError(
      `La categoría '${normalizedCategory || "(vacía)"}' no corresponde al tipo de salida ${bucket}`
    );
  }

  let resolvedTripId: number | null = null;
  if (bucket === "ROUTE_OPEX" && input.tripId !== undefined && input.tripId !== null) {
    const tripIdInt = parsePositiveInt(input.tripId, "Ruta / viaje");
    const tripRes = await client.query(
      `SELECT 1 FROM erp.route_trips WHERE trip_id = $1 LIMIT 1`,
      [tripIdInt]
    );
    if (tripRes.rowCount === 0) {
      throw new ValidationError("La ruta seleccionada no existe");
    }
    resolvedTripId = tripIdInt;
  }

  const res = await client.query(
    `INSERT INTO erp.cash_ledger (
       tx_date, account_id, trip_id, direction, amount_pen,
       expense_bucket, expense_category, is_internal_transfer,
       description, source_origin
     ) VALUES (
       $1::date, $2, $3, 'OUT', $4,
       $5, $6, FALSE,
       $7, 'ERP_APP'
     ) RETURNING ledger_id`,
    [
      txDate,
      fromAcc.accountId,
      resolvedTripId,
      amountPen,
      bucket,
      normalizedCategory,
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

  await client.query(
    `SELECT p.product_id
     FROM erp.v_current_stock vcs
     JOIN erp.products p ON p.product_id = vcs.product_id
     WHERE vcs.stock_on_hand < -0.0001
     ORDER BY p.product_id ASC
     FOR UPDATE OF p`
  );

  const insertRes = await client.query(
    `INSERT INTO erp.inventory_movements (
       warehouse_id, product_id, movement_date, movement_type,
       quantity_delta, source_origin, notes
     )
     SELECT
       warehouse_id,
       product_id,
       NOW(),
       'ADJUSTMENT',
       ABS(stock_on_hand),
       'ERP_APP',
       'RESET_HISTORICAL_DEFICIT by ' || $1 || ' (' || sku || ')'
     FROM erp.v_current_stock
     WHERE warehouse_code = 'MAIN'
       AND stock_on_hand < -0.0001
     ORDER BY product_id ASC`,
    [actor.username]
  );

  return { adjustedSkuCount: insertRes.rowCount ?? 0 };
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
    minStockQty?: number | null;
    leadTimeDays?: number | null;
    defaultSupplierPartyId?: number | null;
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

  const hasMinStockQty = input.minStockQty !== undefined;
  let validatedMinStockQty: number | null = null;
  if (hasMinStockQty && input.minStockQty !== null) {
    const val = Number(input.minStockQty);
    if (!Number.isFinite(val) || val < 0) {
      throw new ValidationError("El stock mínimo no puede ser negativo");
    }
    validatedMinStockQty = Number(val.toFixed(4));
  }

  const hasLeadTimeDays = input.leadTimeDays !== undefined;
  let validatedLeadTimeDays: number | null = null;
  if (hasLeadTimeDays && input.leadTimeDays !== null) {
    const val = Number(input.leadTimeDays);
    if (!Number.isInteger(val) || val < 0 || val > 365) {
      throw new ValidationError("El plazo de reposición debe estar entre 0 y 365 días");
    }
    validatedLeadTimeDays = val;
  }

  const hasDefaultSupplier = input.defaultSupplierPartyId !== undefined;
  let validatedDefaultSupplierId: number | null = null;
  if (hasDefaultSupplier && input.defaultSupplierPartyId !== null) {
    const supId = parsePositiveInt(input.defaultSupplierPartyId, "Proveedor habitual");
    const supCheck = await client.query(
      `SELECT 1 FROM erp.parties WHERE party_id = $1 AND party_type IN ('SUPPLIER', 'BOTH') LIMIT 1`,
      [supId]
    );
    if (supCheck.rowCount === 0) {
      throw new ValidationError("El proveedor habitual seleccionado no existe");
    }
    validatedDefaultSupplierId = supId;
  }

  if (
    input.refCostPen !== undefined ||
    input.listSalePricePen !== undefined ||
    input.minSalePricePen !== undefined ||
    input.fulfillmentMode !== undefined ||
    hasMinStockQty ||
    hasLeadTimeDays ||
    hasDefaultSupplier
  ) {
    await client.query(
      `UPDATE erp.products
       SET ref_cost_pen = COALESCE($1, ref_cost_pen),
           cost_source = CASE WHEN $1 IS NOT NULL THEN 'MANUAL_PARTNER' ELSE cost_source END,
           cost_updated_at = CASE WHEN $1 IS NOT NULL THEN NOW() ELSE cost_updated_at END,
           list_sale_price_pen = COALESCE($2, list_sale_price_pen),
           min_sale_price_pen = COALESCE($3, min_sale_price_pen),
           fulfillment_mode = COALESCE($4::erp.fulfillment_mode, fulfillment_mode),
           min_stock_qty = CASE WHEN $6::boolean THEN $7::numeric(14,4) ELSE min_stock_qty END,
           lead_time_days = CASE WHEN $8::boolean THEN $9::int ELSE lead_time_days END,
           default_supplier_party_id = CASE WHEN $10::boolean THEN $11::bigint ELSE default_supplier_party_id END,
           updated_at = NOW()
       WHERE product_id = $5`,
      [
        input.refCostPen ?? null,
        input.listSalePricePen ?? null,
        input.minSalePricePen ?? null,
        input.fulfillmentMode ?? null,
        input.productId,
        hasMinStockQty,
        validatedMinStockQty,
        hasLeadTimeDays,
        validatedLeadTimeDays,
        hasDefaultSupplier,
        validatedDefaultSupplierId,
      ]
    );
  }

  if (input.physicalStock !== undefined) {
    if (input.physicalStock < 0) {
      throw new ValidationError("El stock físico no puede ser negativo");
    }
    await client.query(
      `SELECT product_id FROM erp.products WHERE product_id = $1 FOR UPDATE`,
      [input.productId]
    );
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
