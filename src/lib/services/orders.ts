import type { PoolClient } from "pg";
import {
  assertRole,
  isPartnerRole,
  projectOrderForRole,
  projectProductForRole,
} from "../rbac";
import {
  ValidationError,
  type OrderOperationalStatus,
  type PaymentMode,
  type RawOrderLineRow,
  type RawOrderWithLines,
  type RawProductRow,
  type SessionUser,
} from "../types";

export interface CreateOrderInput {
  customerPartyId?: number | null;
  customerNameRaw: string;
  paymentMode: PaymentMode;
  collectOnDelivery?: boolean;
  creditDays?: number;
  promisedPaymentDate?: string | null;
  initialPaidPen?: number;
  paymentAccountId?: number;
  notes?: string;
  lines: Array<{
    productId: number;
    quantity: number;
    unitDiscountPen?: number;
    overrideBasePricePen?: number;
  }>;
}

export function getLimaDateString(offsetDays = 0): string {
  const now = new Date();
  const limaStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  if (offsetDays === 0) return limaStr;
  const [y, m, d] = limaStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return dt.toISOString().slice(0, 10);
}

async function getMainWarehouseId(client: PoolClient): Promise<number> {
  const res = await client.query(
    `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1`
  );
  if (res.rowCount === 0) {
    throw new Error("Warehouse MAIN not found");
  }
  return Number(res.rows[0].warehouse_id);
}

async function getDefaultCashAccountId(
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

async function deductStockForOrderLines(
  client: PoolClient,
  warehouseId: number,
  orderId: number,
  orderCode: string
): Promise<void> {
  const linesRes = await client.query(
    `SELECT
       sol.order_line_id,
       sol.product_id,
       sol.quantity,
       sol.unit_cost_snapshot_pen,
       p.fulfillment_mode::text AS fulfillment_mode,
       COALESCE(vcs.stock_on_hand, 0) AS stock_on_hand
     FROM erp.sales_order_lines sol
     JOIN erp.products p ON p.product_id = sol.product_id
     LEFT JOIN erp.v_current_stock vcs
       ON vcs.warehouse_id = $1 AND vcs.product_id = sol.product_id
     WHERE sol.order_id = $2
     ORDER BY sol.line_no ASC`,
    [warehouseId, orderId]
  );

  for (const row of linesRes.rows) {
    const qty = Number(row.quantity);
    const stockOnHand = Number(row.stock_on_hand);
    const mode = String(row.fulfillment_mode);
    if (mode === "ON_DEMAND" && stockOnHand < qty) {
      // ON_DEMAND without physical stock: trigger on sales_order_lines already marked PENDING_SUPPLIER_PURCHASE
      continue;
    }
    await client.query(
      `INSERT INTO erp.inventory_movements (
         warehouse_id, product_id, movement_date, movement_type,
         quantity_delta, unit_cost_pen, reference_table, reference_id,
         source_origin, notes
       ) VALUES ($1, $2, NOW(), 'SALE_OUT', $3, $4, 'erp.sales_orders', $5, 'ERP_APP', $6)`,
      [
        warehouseId,
        Number(row.product_id),
        -qty,
        row.unit_cost_snapshot_pen !== null ? Number(row.unit_cost_snapshot_pen) : null,
        String(orderId),
        `Reserva/Salida venta ${orderCode}`,
      ]
    );
  }
}

export async function createOrder(
  client: PoolClient,
  actor: SessionUser,
  input: CreateOrderInput
): Promise<{
  orderId: number;
  orderCode: string;
  operationalStatus: OrderOperationalStatus;
  requiresApproval: boolean;
}> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"]);

  if (!input.customerNameRaw?.trim()) {
    throw new ValidationError("Nombre del cliente es obligatorio");
  }
  if (!input.lines || input.lines.length === 0) {
    throw new ValidationError("El pedido debe incluir al menos un producto");
  }

  const warehouseId = await getMainWarehouseId(client);
  let requiresApproval = false;
  let totalPen = 0;

  interface PreparedLine {
    lineNo: number;
    productId: number;
    sku: string;
    name: string;
    quantity: number;
    baseUnitPricePen: number;
    unitDiscountPen: number;
    unitPricePen: number;
    lineTotalPen: number;
    unitCostSnapshotPen: number | null;
    fulfillmentMode: "STOCKED" | "ON_DEMAND";
    stockOnHand: number;
    belowMinPriceFlag: boolean;
  }

  const preparedLines: PreparedLine[] = [];

  for (let idx = 0; idx < input.lines.length; idx++) {
    const item = input.lines[idx];
    if (!item.quantity || item.quantity <= 0) {
      throw new ValidationError("La cantidad debe ser mayor a 0");
    }
    const unitDiscountPen = Number(item.unitDiscountPen ?? 0);
    if (unitDiscountPen < 0) {
      throw new ValidationError("El descuento en Soles no puede ser negativo");
    }

    const prodRes = await client.query(
      `SELECT
         p.product_id,
         p.sku,
         p.name,
         p.fulfillment_mode::text AS fulfillment_mode,
         p.list_sale_price_pen,
         p.min_sale_price_pen,
         p.ref_cost_pen,
         COALESCE(vcs.stock_on_hand, 0) AS stock_on_hand
       FROM erp.products p
       LEFT JOIN erp.v_current_stock vcs
         ON vcs.warehouse_id = $1 AND vcs.product_id = p.product_id
       WHERE p.product_id = $2
       LIMIT 1`,
      [warehouseId, item.productId]
    );
    if (prodRes.rowCount === 0) {
      throw new ValidationError(`Producto ID ${item.productId} no encontrado`);
    }
    const prod = prodRes.rows[0];
    const baseUnitPricePen =
      isPartnerRole(actor.role) && item.overrideBasePricePen !== undefined
        ? Number(item.overrideBasePricePen)
        : Number(prod.list_sale_price_pen ?? 0);

    const unitPricePen = Number((baseUnitPricePen - unitDiscountPen).toFixed(4));
    if (unitPricePen <= 0) {
      throw new ValidationError("Precio final debe ser mayor a S/ 0.00");
    }

    const minSalePricePen =
      prod.min_sale_price_pen !== null
        ? Number(prod.min_sale_price_pen)
        : baseUnitPricePen;
    const belowMinPriceFlag = unitPricePen < minSalePricePen - 0.0001;
    if (belowMinPriceFlag && !isPartnerRole(actor.role)) {
      requiresApproval = true;
    }

    const lineTotalPen = Number((item.quantity * unitPricePen).toFixed(2));
    totalPen = Number((totalPen + lineTotalPen).toFixed(2));

    preparedLines.push({
      lineNo: idx + 1,
      productId: Number(prod.product_id),
      sku: String(prod.sku),
      name: String(prod.name),
      quantity: Number(item.quantity),
      baseUnitPricePen,
      unitDiscountPen,
      unitPricePen,
      lineTotalPen,
      unitCostSnapshotPen:
        prod.ref_cost_pen !== null ? Number(prod.ref_cost_pen) : null,
      fulfillmentMode: prod.fulfillment_mode as "STOCKED" | "ON_DEMAND",
      stockOnHand: Number(prod.stock_on_hand),
      belowMinPriceFlag,
    });
  }

  const operationalStatus: OrderOperationalStatus = requiresApproval
    ? "PENDING_PARTNER_APPROVAL"
    : "REGISTERED";
  const stockDeducted = !requiresApproval;

  // Compute promised_payment_date for CREDIT or Contra Entrega orders in America/Lima timezone
  let promisedPaymentDate: string | null = null;
  if (input.paymentMode === "CREDIT") {
    if (input.promisedPaymentDate) {
      promisedPaymentDate = input.promisedPaymentDate;
    } else {
      const days = input.creditDays && input.creditDays > 0 ? input.creditDays : 7;
      promisedPaymentDate = getLimaDateString(days);
    }
  } else if (input.collectOnDelivery) {
    promisedPaymentDate = getLimaDateString(0);
  }

  const orderCode = `SO-${getLimaDateString(0).replace(/-/g, "")}-${Math.floor(
    100000 + Math.random() * 900000
  )}`;

  const orderInsert = await client.query(
    `INSERT INTO erp.sales_orders (
       order_code, order_date, warehouse_id, customer_party_id, customer_name_raw,
       payment_mode, operational_status, total_pen, paid_pen,
       due_date, promised_payment_date,
       created_by_user_id, approved_by_user_id, approved_at,
       stock_deducted, source_origin, notes
     ) VALUES (
       $1, CURRENT_DATE, $2, $3, $4,
       $5, $6, $7, 0,
       $11, $11,
       $8, $9, $10,
       $12, 'ERP_APP', $13
     ) RETURNING order_id`,
    [
      orderCode,
      warehouseId,
      input.customerPartyId ?? null,
      input.customerNameRaw.trim(),
      input.paymentMode,
      operationalStatus,
      totalPen,
      actor.userId,
      isPartnerRole(actor.role) ? actor.userId : null,
      isPartnerRole(actor.role) ? new Date().toISOString() : null,
      promisedPaymentDate,
      stockDeducted,
      input.notes ?? null,
    ]
  );
  const orderId = Number(orderInsert.rows[0].order_id);

  for (const line of preparedLines) {
    const fulfillmentStatus =
      line.fulfillmentMode === "ON_DEMAND" && line.stockOnHand < line.quantity
        ? "PENDING_SUPPLIER_PURCHASE"
        : "FULFILLED";

    await client.query(
      `INSERT INTO erp.sales_order_lines (
         order_id, line_no, product_id, raw_description, quantity,
         base_unit_price_pen, unit_discount_pen, unit_price_pen,
         line_total_pen, unit_cost_snapshot_pen, fulfillment_status,
         below_min_price_flag
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        orderId,
        line.lineNo,
        line.productId,
        line.name,
        line.quantity,
        line.baseUnitPricePen,
        line.unitDiscountPen,
        line.unitPricePen,
        line.lineTotalPen,
        line.unitCostSnapshotPen,
        fulfillmentStatus,
        line.belowMinPriceFlag,
      ]
    );
  }

  // Deduct stock immediately only if order is already REGISTERED (not PENDING_PARTNER_APPROVAL)
  if (!requiresApproval) {
    await deductStockForOrderLines(client, warehouseId, orderId, orderCode);
  }

  // Record initial payment if paid upfront or CREDIT with initial down payment (Adelanto)
  // If collectOnDelivery is true (Contra Entrega), initialPaid defaults to 0 so the order stays open for collection upon delivery
  const initialPaid =
    input.paymentMode !== "CREDIT"
      ? input.initialPaidPen !== undefined
        ? Number(input.initialPaidPen)
        : input.collectOnDelivery
        ? 0
        : totalPen
      : Number(input.initialPaidPen ?? 0);

  if (initialPaid > 0) {
    if (initialPaid > totalPen + 0.05) {
      throw new ValidationError("El pago inicial no puede superar el total del pedido");
    }
    const accountId = await getDefaultCashAccountId(
      client,
      actor,
      input.paymentAccountId
    );
    const effectiveMode =
      input.paymentMode === "CREDIT" ? "CASH" : input.paymentMode;

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
        input.customerPartyId ?? null,
        initialPaid,
        String(orderId),
        `Cobro inicial pedido ${orderCode} (${input.customerNameRaw.trim()})`,
      ]
    );

    await client.query(
      `INSERT INTO erp.ar_payments (
         order_id, payment_date, amount_pen, payment_mode,
         account_id, reference_doc, collected_by_user_id,
         source_origin, notes
       ) VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, 'ERP_APP', $7)`,
      [
        orderId,
        initialPaid,
        effectiveMode,
        accountId,
        `LEDGER-${ledgerRes.rows[0].ledger_id}`,
        actor.userId,
        input.paymentMode === "CREDIT" ? "Adelanto inicial" : "Pago al contado",
      ]
    );
  }

  await client.query(
    `INSERT INTO erp.sales_order_events (order_id, from_status, to_status, actor_user_id, notes)
     VALUES ($1, NULL, $2, $3, $4)`,
    [
      orderId,
      operationalStatus,
      actor.userId,
      requiresApproval
        ? "Pedido registrado con descuento bajo el mínimo; pendiente de aprobación de Socio"
        : "Pedido registrado",
    ]
  );

  return {
    orderId,
    orderCode,
    operationalStatus,
    requiresApproval,
  };
}

export async function approveDiscountedOrder(
  client: PoolClient,
  actor: SessionUser,
  orderId: number
): Promise<{ orderId: number; operationalStatus: "REGISTERED" }> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);

  const res = await client.query(
    `SELECT order_id, order_code, warehouse_id, operational_status::text AS status, stock_deducted
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

  if (!order.stock_deducted) {
    await deductStockForOrderLines(
      client,
      Number(order.warehouse_id),
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
  nextStatus: "PICKING" | "READY" | "IN_ROUTE" | "DELIVERED"
): Promise<void> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "WAREHOUSE_DELIVERY"]);

  const res = await client.query(
    `SELECT order_id, operational_status::text AS status
     FROM erp.sales_orders
     WHERE order_id = $1
     FOR UPDATE`,
    [orderId]
  );
  if (res.rowCount === 0) {
    throw new ValidationError("Pedido no encontrado");
  }
  const currentStatus = String(res.rows[0].status) as OrderOperationalStatus;
  const expectedNextByCurrent: Partial<Record<OrderOperationalStatus, OrderOperationalStatus>> = {
    REGISTERED: "PICKING",
    PICKING: "READY",
    READY: "IN_ROUTE",
    IN_ROUTE: "DELIVERED",
  };

  if (expectedNextByCurrent[currentStatus] !== nextStatus) {
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
}

export async function cancelOrder(
  client: PoolClient,
  actor: SessionUser,
  orderId: number,
  reason: string
): Promise<void> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);

  const res = await client.query(
    `SELECT order_id, order_code, warehouse_id, operational_status::text AS status, stock_deducted
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
    return;
  }

  // Only restore stock if stock was actually deducted
  if (order.stock_deducted) {
    const moveRes = await client.query(
      `SELECT product_id, SUM(quantity_delta) AS net_delta, MAX(unit_cost_pen) AS unit_cost_pen
       FROM erp.inventory_movements
       WHERE reference_table = 'erp.sales_orders'
         AND reference_id = $1
       GROUP BY product_id`,
      [String(orderId)]
    );
    for (const mv of moveRes.rows) {
      const netDelta = Number(mv.net_delta);
      if (netDelta < 0) {
        await client.query(
          `INSERT INTO erp.inventory_movements (
             warehouse_id, product_id, movement_date, movement_type,
             quantity_delta, unit_cost_pen, reference_table, reference_id,
             source_origin, notes
           ) VALUES ($1, $2, NOW(), 'RETURN_IN', $3, $4, 'erp.sales_orders', $5, 'ERP_APP', $6)`,
          [
            Number(order.warehouse_id),
            Number(mv.product_id),
            Math.abs(netDelta),
            mv.unit_cost_pen !== null ? Number(mv.unit_cost_pen) : null,
            String(orderId),
            `Reingreso por anulación de ${order.order_code}: ${reason}`,
          ]
        );
      }
    }
  }

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
}

export async function listOrdersForRole(
  client: PoolClient,
  actor: SessionUser,
  limit = 60
): Promise<Record<string, unknown>[]> {
  assertRole(actor, [
    "PARTNER_ADMIN",
    "PARTNER_MANAGER",
    "EXTERNAL_SELLER",
    "WAREHOUSE_DELIVERY",
  ]);

  const filterClause =
    actor.role === "WAREHOUSE_DELIVERY"
      ? `WHERE so.operational_status NOT IN ('PENDING_PARTNER_APPROVAL', 'CANCELLED') AND so.source_origin = 'ERP_APP'`
      : `WHERE so.operational_status <> 'CANCELLED'`;

  const ordersRes = await client.query(
    `SELECT
       so.order_id,
       so.order_code,
       so.order_date::text AS order_date,
       so.customer_party_id,
       COALESCE(pa.trade_name, pa.legal_name, so.customer_name_raw, 'CLIENTE') AS customer_name,
       so.operational_status::text AS operational_status,
       so.payment_mode::text AS payment_mode,
       so.promised_payment_date::text AS promised_payment_date,
       so.total_pen,
       so.paid_pen,
       so.balance_due_pen,
       so.is_settled,
       so.notes,
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
     LEFT JOIN erp.app_users u_create ON u_create.user_id = so.created_by_user_id
     LEFT JOIN erp.app_users u_app ON u_app.user_id = so.approved_by_user_id
     LEFT JOIN erp.app_users u_pick ON u_pick.user_id = so.picked_by_user_id
     LEFT JOIN erp.app_users u_deliv ON u_deliv.user_id = so.delivered_by_user_id
     ${filterClause}
     ORDER BY
       CASE WHEN so.source_origin = 'ERP_APP' THEN 0 ELSE 1 END ASC,
       so.order_date DESC,
       so.order_id DESC
     LIMIT $1`,
    [limit]
  );

  if (ordersRes.rowCount === 0) return [];

  const orderIds = ordersRes.rows.map((r) => Number(r.order_id));
  const linesRes = await client.query(
    `SELECT
       sol.order_id,
       sol.order_line_id,
       sol.line_no,
       sol.product_id,
       p.sku,
       sol.raw_description,
       sol.quantity,
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
      quantity: Number(row.quantity),
      base_unit_price_pen: Number(row.base_unit_price_pen),
      unit_discount_pen: Number(row.unit_discount_pen),
      unit_price_pen: Number(row.unit_price_pen),
      line_total_pen: Number(row.line_total_pen),
      unit_cost_snapshot_pen:
        row.unit_cost_snapshot_pen !== null
          ? Number(row.unit_cost_snapshot_pen)
          : null,
      fulfillment_mode: row.fulfillment_mode,
      fulfillment_status: row.fulfillment_status,
      below_min_price_flag: Boolean(row.below_min_price_flag),
    });
  }

  return ordersRes.rows.map((row) => {
    const rawOrder: RawOrderWithLines = {
      order_id: Number(row.order_id),
      order_code: String(row.order_code),
      order_date: String(row.order_date),
      customer_party_id:
        row.customer_party_id !== null ? Number(row.customer_party_id) : null,
      customer_name: String(row.customer_name),
      operational_status: row.operational_status,
      payment_mode: row.payment_mode,
      promised_payment_date: row.promised_payment_date ?? null,
      total_pen: Number(row.total_pen),
      paid_pen: Number(row.paid_pen),
      balance_due_pen: Number(row.balance_due_pen),
      is_settled: Boolean(row.is_settled),
      notes: row.notes ?? null,
      created_by_name: row.created_by_name ?? null,
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
  const warehouseId = await getMainWarehouseId(client);
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
       p.ref_cost_pen
     FROM erp.products p
     LEFT JOIN erp.v_current_stock vcs
       ON vcs.warehouse_id = $1 AND vcs.product_id = p.product_id
     WHERE p.is_active = TRUE
     ORDER BY p.name ASC`,
    [warehouseId]
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
      } satisfies RawProductRow,
      actor.role
    )
  );
}
