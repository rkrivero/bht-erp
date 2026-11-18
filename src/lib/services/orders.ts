import type { PoolClient } from "pg";
import {
  assertRole,
  isPartnerRole,
  projectOrderForRole,
  projectProductForRole,
} from "../rbac";
import {
  AuthorizationError,
  ValidationError,
  type OrderOperationalStatus,
  type PaymentMode,
  type RawOrderLineRow,
  type RawOrderWithLines,
  type RawProductRow,
  type SessionUser,
} from "../types";

const SALES_ORDER_COLUMNS = `
  order_id, order_code, order_date, trip_id, warehouse_id,
  customer_party_id, customer_name_raw, quote_id, payment_mode,
  historical_status_assumed, payment_status_raw, doc_ref, total_pen,
  paid_pen, balance_due_pen, is_settled, due_date, source_origin,
  source_file, source_sheet, source_row_num, source_row_hash, notes,
  created_at, operational_status, created_by_user_id, approved_by_user_id,
  approved_at, picked_by_user_id, picked_at, delivered_by_user_id,
  delivered_at, stock_deducted, promised_payment_date, updated_at,
  ops_seq, fin_seq`;

export interface CreateOrderInput {
  customerPartyId?: number | null;
  customerNameRaw: string;
  paymentMode: PaymentMode;
  collectOnDelivery?: boolean;
  creditDays?: number;
  promisedPaymentDate?: string | null;
  initialPaidPen?: number;
  paymentAccountId?: number;
  quoteId?: number | null;
  tripId?: number | null;
  notes?: string;
  lines: Array<{
    productId: number;
    quantity: number;
    packFactorApplied?: number;
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
  const targetId = explicitAccountId || actor.defaultCashAccountId || null;
  if (targetId) {
    const res = await client.query<{
      account_id: number;
      account_type: string;
      is_active: boolean;
    }>(
      `SELECT account_id, account_type, is_active
       FROM erp.cash_accounts
       WHERE account_id = $1
       LIMIT 1`,
      [targetId]
    );
    if (res.rowCount === 0 || !res.rows[0].is_active) {
      throw new ValidationError("Cuenta de caja inválida o inactiva");
    }
    if (
      actor.role === "EXTERNAL_SELLER" &&
      res.rows[0].account_type === "PARTNER_CUSTODY"
    ) {
      throw new AuthorizationError(
        "El Vendedor Externo no puede operar sobre cuentas de custodia de socio"
      );
    }
    return Number(res.rows[0].account_id);
  }
  const res = await client.query(
    `SELECT account_id FROM erp.cash_accounts WHERE code = 'CAJA_RUTA' AND is_active = TRUE LIMIT 1`
  );
  if (res.rowCount === 0) {
    throw new ValidationError("Cuenta de caja por defecto no encontrada");
  }
  return Number(res.rows[0].account_id);
}

async function deductStockForOrderLines(
  client: PoolClient,
  warehouseId: number,
  orderId: number,
  orderCode: string
): Promise<void> {
  // Single set-based INSERT keeps line_no order for BEFORE INSERT triggers
  // while skipping ON_DEMAND lines marked PENDING_SUPPLIER_PURCHASE.
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
     ORDER BY sol.line_no ASC`,
    [warehouseId, orderId, String(orderId), `Reserva/Salida venta ${orderCode}`]
  );
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
    packFactorApplied: number;
    requiredBaseQty: number;
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

  for (const item of input.lines) {
    if (!item.quantity || item.quantity <= 0) {
      throw new ValidationError("La cantidad debe ser mayor a 0");
    }
    const packFactorApplied =
      item.packFactorApplied !== undefined ? Number(item.packFactorApplied) : 1;
    if (!Number.isFinite(packFactorApplied) || packFactorApplied <= 0) {
      throw new ValidationError("El factor de empaque debe ser mayor a 0");
    }
    const unitDiscountPen = Number(item.unitDiscountPen ?? 0);
    if (unitDiscountPen < 0) {
      throw new ValidationError("El descuento en Soles no puede ser negativo");
    }
  }

  const uniqueProductIds = Array.from(
    new Set(input.lines.map((item) => Number(item.productId)))
  ).sort((a, b) => a - b);

  // Lock SKU rows in deterministic order before reading v_current_stock
  await client.query(
    `SELECT product_id
     FROM erp.products
     WHERE product_id = ANY($1::bigint[])
     ORDER BY product_id ASC
     FOR UPDATE`,
    [uniqueProductIds]
  );

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
     WHERE p.product_id = ANY($2::bigint[])`,
    [warehouseId, uniqueProductIds]
  );
  const productById = new Map<number, (typeof prodRes.rows)[number]>();
  for (const row of prodRes.rows) {
    productById.set(Number(row.product_id), row);
  }

  for (let idx = 0; idx < input.lines.length; idx++) {
    const item = input.lines[idx];
    const unitDiscountPen = Number(item.unitDiscountPen ?? 0);
    const prod = productById.get(item.productId);
    if (!prod) {
      throw new ValidationError(`Producto ID ${item.productId} no encontrado`);
    }
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
    const referenceCostPen =
      prod.ref_cost_pen !== null ? Number(prod.ref_cost_pen) : null;
    const belowCostFlag =
      referenceCostPen !== null && unitPricePen < referenceCostPen - 0.0001;
    if (belowCostFlag && !isPartnerRole(actor.role)) {
      requiresApproval = true;
    }

    const lineTotalPen = Number((item.quantity * unitPricePen).toFixed(2));
    totalPen = Number((totalPen + lineTotalPen).toFixed(2));
    const packFactorApplied = Number(
      (item.packFactorApplied !== undefined
        ? Number(item.packFactorApplied)
        : 1
      ).toFixed(4)
    );
    const requiredBaseQty = Number(
      (Number(item.quantity) * packFactorApplied).toFixed(4)
    );

    preparedLines.push({
      lineNo: idx + 1,
      productId: Number(prod.product_id),
      sku: String(prod.sku),
      name: String(prod.name),
      quantity: Number(item.quantity),
      packFactorApplied,
      requiredBaseQty,
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

  let validatedTripId: number | null = null;
  if (input.tripId !== undefined && input.tripId !== null) {
    const tripId = Number(input.tripId);
    if (!Number.isInteger(tripId) || tripId <= 0) {
      throw new ValidationError("ID de ruta/viaje inválido");
    }
    const tripRes = await client.query<{ status: string }>(
      `SELECT status::text AS status FROM erp.route_trips WHERE trip_id = $1 LIMIT 1`,
      [tripId]
    );
    if (tripRes.rowCount === 0) {
      throw new ValidationError("Viaje/ruta no encontrado");
    }
    if (tripRes.rows[0].status !== "OPEN") {
      throw new ValidationError("Solo se puede asignar pedidos a una ruta OPEN");
    }
    validatedTripId = tripId;
  }

  let validatedQuoteId: number | null = null;
  if (input.quoteId !== undefined && input.quoteId !== null) {
    const quoteId = Number(input.quoteId);
    if (!Number.isInteger(quoteId) || quoteId <= 0) {
      throw new ValidationError("ID de cotización inválido");
    }
    const qRes = await client.query<{ status: string }>(
      `SELECT status::text AS status FROM erp.quotes WHERE quote_id = $1 LIMIT 1`,
      [quoteId]
    );
    if (qRes.rowCount === 0) {
      throw new ValidationError("Cotización no encontrada");
    }
    validatedQuoteId = quoteId;
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
       stock_deducted, trip_id, quote_id, source_origin, notes
     ) VALUES (
       $1, (NOW() AT TIME ZONE 'America/Lima')::date, $2, $3, $4,
       $5, $6, $7, 0,
       $11, $11,
       $8, $9, $10,
       $12, $13, $14, 'ERP_APP', $15
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
      validatedTripId,
      validatedQuoteId,
      input.notes ?? null,
    ]
  );
  const orderId = Number(orderInsert.rows[0].order_id);

  const remainingStockByProduct = new Map<number, number>();
  for (const line of preparedLines) {
    if (!remainingStockByProduct.has(line.productId)) {
      remainingStockByProduct.set(line.productId, line.stockOnHand);
    }
  }

  const lineValuesClauses: string[] = [];
  const lineParams: unknown[] = [];
  for (const line of preparedLines) {
    const availableStock = remainingStockByProduct.get(line.productId) ?? 0;
    const isPendingPurchase =
      line.fulfillmentMode === "ON_DEMAND" && availableStock < line.requiredBaseQty;
    const fulfillmentStatus = isPendingPurchase
      ? "PENDING_SUPPLIER_PURCHASE"
      : "FULFILLED";
    if (!isPendingPurchase) {
      remainingStockByProduct.set(
        line.productId,
        Number((availableStock - line.requiredBaseQty).toFixed(4))
      );
    }
    const offset = lineParams.length;
    lineValuesClauses.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13})`
    );
    lineParams.push(
      orderId,
      line.lineNo,
      line.productId,
      line.name,
      line.quantity,
      line.packFactorApplied,
      line.baseUnitPricePen,
      line.unitDiscountPen,
      line.unitPricePen,
      line.lineTotalPen,
      line.unitCostSnapshotPen,
      fulfillmentStatus,
      line.belowMinPriceFlag
    );
  }

  await client.query(
    `INSERT INTO erp.sales_order_lines (
       order_id, line_no, product_id, raw_description, quantity, pack_factor_applied,
       base_unit_price_pen, unit_discount_pen, unit_price_pen,
       line_total_pen, unit_cost_snapshot_pen, fulfillment_status,
       below_min_price_flag
     ) VALUES ${lineValuesClauses.join(", ")}`,
    lineParams
  );

  // Deduct stock immediately only if order is already REGISTERED (not PENDING_PARTNER_APPROVAL)
  if (!requiresApproval) {
    await deductStockForOrderLines(client, warehouseId, orderId, orderCode);
  }

  // Never collect before approval. Cost data stays hidden from the seller, so
  // the backend makes this decision without blocking the order form.

  const initialPaid = requiresApproval
    ? 0
    : input.paymentMode !== "CREDIT"
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
    const effectiveMode = input.paymentMode === "CREDIT" ? "CASH" : input.paymentMode;

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
       ) VALUES ($1, (NOW() AT TIME ZONE 'America/Lima')::date, $2, $3, $4, $5, $6, 'ERP_APP', $7)`,
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
        ? "Pedido registrado con precio bajo costo; pendiente de aprobación de Socio"
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
             SET fulfillment_status = $1::erp.line_fulfillment_status
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
}

export async function updateOrder(
  client: PoolClient,
  actor: SessionUser,
  orderId: number,
  input: Pick<CreateOrderInput, "lines"> & { reason: string }
): Promise<{
  orderId: number;
  orderCode: string;
  operationalStatus: OrderOperationalStatus;
  requiresApproval: boolean;
}> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"]);
  const reason = input.reason?.trim();
  if (!reason) throw new ValidationError("Indica el motivo de la modificación");
  if (!input.lines?.length) {
    throw new ValidationError("El pedido debe conservar al menos un producto");
  }

  const orderRes = await client.query(
    `SELECT ${SALES_ORDER_COLUMNS}, operational_status::text AS status
     FROM erp.sales_orders
     WHERE order_id = $1
     FOR UPDATE`,
    [orderId]
  );
  if (orderRes.rowCount === 0) throw new ValidationError("Pedido no encontrado");
  const order = orderRes.rows[0];
  if (order.source_origin !== "ERP_APP") {
    throw new ValidationError(
      "Los pedidos históricos no se modifican desde la aplicación"
    );
  }
  if (["DELIVERED", "CANCELLED"].includes(String(order.status))) {
    throw new ValidationError(
      "Un pedido entregado o anulado requiere una corrección administrativa"
    );
  }
  if (
    actor.role === "EXTERNAL_SELLER" &&
    Number(order.created_by_user_id) !== actor.userId
  ) {
    throw new AuthorizationError("Solo puedes modificar tus propios pedidos");
  }

  const beforeLines = await client.query(
    `SELECT order_line_id, line_no, product_id, raw_description, quantity,
            pack_factor_applied, base_unit_price_pen, unit_discount_pen,
            unit_price_pen, line_total_pen, unit_cost_snapshot_pen,
            fulfillment_status::text, below_min_price_flag
     FROM erp.sales_order_lines WHERE order_id = $1 ORDER BY line_no`,
    [orderId]
  );
  const beforeData = { order, lines: beforeLines.rows };

  const productIds = Array.from(
    new Set(input.lines.map((line) => Number(line.productId)))
  ).sort((a, b) => a - b);
  await client.query(
    `SELECT product_id FROM erp.products
     WHERE product_id = ANY($1::bigint[])
     ORDER BY product_id FOR UPDATE`,
    [productIds]
  );
  const products = await client.query(
    `SELECT p.product_id, p.sku, p.name,
            p.fulfillment_mode::text AS fulfillment_mode,
            p.list_sale_price_pen, p.min_sale_price_pen, p.ref_cost_pen,
            COALESCE(vcs.stock_on_hand, 0) AS stock_on_hand
     FROM erp.products p
     LEFT JOIN erp.v_current_stock vcs
       ON vcs.warehouse_id = $1 AND vcs.product_id = p.product_id
     WHERE p.product_id = ANY($2::bigint[])`,
    [Number(order.warehouse_id), productIds]
  );
  const productById = new Map(
    products.rows.map((product) => [Number(product.product_id), product])
  );
  let totalPen = 0;
  let requiresApproval = false;
  const prepared = input.lines.map((line, index) => {
    const product = productById.get(Number(line.productId));
    if (!product)
      throw new ValidationError("Uno de los productos ya no está disponible");
    const quantity = Number(line.quantity);
    const packFactor = Number(line.packFactorApplied ?? 1);
    const discount = Number(line.unitDiscountPen ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new ValidationError("La cantidad debe ser mayor a 0");
    }
    if (!Number.isFinite(packFactor) || packFactor <= 0 || discount < 0) {
      throw new ValidationError("Cantidad, empaque o descuento inválido");
    }
    const basePrice = Number(product.list_sale_price_pen ?? 0);
    const unitPrice = Number((basePrice - discount).toFixed(4));
    if (unitPrice <= 0)
      throw new ValidationError("El precio final debe ser mayor a cero");
    const cost = product.ref_cost_pen === null ? null : Number(product.ref_cost_pen);
    if (cost !== null && unitPrice < cost - 0.0001 && !isPartnerRole(actor.role)) {
      requiresApproval = true;
    }
    const minimum =
      product.min_sale_price_pen === null
        ? basePrice
        : Number(product.min_sale_price_pen);
    const lineTotal = Number((quantity * unitPrice).toFixed(2));
    totalPen = Number((totalPen + lineTotal).toFixed(2));
    return {
      lineNo: index + 1,
      productId: Number(product.product_id),
      name: String(product.name),
      quantity,
      packFactor,
      basePrice,
      discount,
      unitPrice,
      lineTotal,
      cost,
      fulfillmentMode: String(product.fulfillment_mode),
      stockOnHand: Number(product.stock_on_hand),
      belowMinimum: unitPrice < minimum - 0.0001,
    };
  });
  if (totalPen < Number(order.paid_pen) - 0.05) {
    throw new ValidationError(
      "El nuevo total no puede ser menor a lo ya cobrado; registra primero la devolución"
    );
  }

  if (order.stock_deducted) {
    await client.query(
      `INSERT INTO erp.inventory_movements (
         warehouse_id, product_id, movement_date, movement_type,
         quantity_delta, unit_cost_pen, reference_table, reference_id,
         source_origin, notes
       )
       SELECT $1, product_id, NOW(), 'RETURN_IN', ABS(SUM(quantity_delta)),
              MAX(unit_cost_pen), 'erp.sales_orders', $2, 'ERP_APP', $3
       FROM erp.inventory_movements
       WHERE reference_table = 'erp.sales_orders' AND reference_id = $2
       GROUP BY product_id HAVING SUM(quantity_delta) < 0`,
      [
        Number(order.warehouse_id),
        String(orderId),
        `Reversa previa a modificación de ${order.order_code}: ${reason}`,
      ]
    );
  }
  await client.query(
    `UPDATE erp.audit_flags
     SET status = 'RESOLVED', resolved_at = NOW(), resolved_by = $2
     WHERE flag_code = 'ON_DEMAND_PENDING_PURCHASE'
       AND entity_table = 'erp.sales_order_lines' AND status = 'OPEN'
       AND entity_id IN (
         SELECT order_line_id::text FROM erp.sales_order_lines WHERE order_id = $1
       )`,
    [orderId, actor.username]
  );
  await client.query(`DELETE FROM erp.sales_order_lines WHERE order_id = $1`, [
    orderId,
  ]);

  const available = new Map<number, number>();
  for (const line of prepared) {
    if (!available.has(line.productId)) available.set(line.productId, line.stockOnHand);
  }
  for (const line of prepared) {
    const stock = available.get(line.productId) ?? 0;
    const required = line.quantity * line.packFactor;
    const pendingPurchase = line.fulfillmentMode === "ON_DEMAND" && stock < required;
    if (!pendingPurchase) available.set(line.productId, stock - required);
    await client.query(
      `INSERT INTO erp.sales_order_lines (
         order_id, line_no, product_id, raw_description, quantity,
         pack_factor_applied, base_unit_price_pen, unit_discount_pen,
         unit_price_pen, line_total_pen, unit_cost_snapshot_pen,
         fulfillment_status, below_min_price_flag
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        orderId,
        line.lineNo,
        line.productId,
        line.name,
        line.quantity,
        line.packFactor,
        line.basePrice,
        line.discount,
        line.unitPrice,
        line.lineTotal,
        line.cost,
        pendingPurchase ? "PENDING_SUPPLIER_PURCHASE" : "FULFILLED",
        line.belowMinimum,
      ]
    );
  }

  const nextStatus: OrderOperationalStatus = requiresApproval
    ? "PENDING_PARTNER_APPROVAL"
    : "REGISTERED";
  await client.query(
    `UPDATE erp.sales_orders
     SET total_pen = $1, operational_status = $2, stock_deducted = FALSE,
         trip_id = NULL, picked_by_user_id = NULL, picked_at = NULL,
         approved_by_user_id = $3, approved_at = $4,
         notes = COALESCE(notes || ' | ', '') || $5
     WHERE order_id = $6`,
    [
      totalPen,
      nextStatus,
      isPartnerRole(actor.role) ? actor.userId : null,
      isPartnerRole(actor.role) ? new Date().toISOString() : null,
      `MODIFICADO: ${reason}`,
      orderId,
    ]
  );
  if (!requiresApproval) {
    await deductStockForOrderLines(
      client,
      Number(order.warehouse_id),
      orderId,
      String(order.order_code)
    );
    await client.query(
      `UPDATE erp.sales_orders SET stock_deducted = TRUE WHERE order_id = $1`,
      [orderId]
    );
  }

  await client.query(
    `INSERT INTO erp.sales_order_events
       (order_id, from_status, to_status, actor_user_id, notes)
     VALUES ($1, $2, $3, $4, $5)`,
    [orderId, order.status, nextStatus, actor.userId, `Modificación: ${reason}`]
  );
  const afterOrder = await client.query(
    `SELECT ${SALES_ORDER_COLUMNS}
     FROM erp.sales_orders WHERE order_id = $1`,
    [orderId]
  );
  const afterLines = await client.query(
    `SELECT order_line_id, line_no, product_id, raw_description, quantity,
            pack_factor_applied, base_unit_price_pen, unit_discount_pen,
            unit_price_pen, line_total_pen, unit_cost_snapshot_pen,
            fulfillment_status::text, below_min_price_flag
     FROM erp.sales_order_lines WHERE order_id = $1 ORDER BY line_no`,
    [orderId]
  );
  await client.query(
    `INSERT INTO erp.sales_order_audit_log
       (order_id, action, actor_user_id, actor_role, reason, before_data, after_data)
     VALUES ($1, 'EDIT', $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      orderId,
      actor.userId,
      actor.role,
      reason,
      JSON.stringify(beforeData),
      JSON.stringify({ order: afterOrder.rows[0], lines: afterLines.rows }),
    ]
  );
  return {
    orderId,
    orderCode: String(order.order_code),
    operationalStatus: nextStatus,
    requiresApproval,
  };
}

export async function cancelOrder(
  client: PoolClient,
  actor: SessionUser,
  orderId: number,
  reason: string
): Promise<void> {
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
    return;
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
       HAVING SUM(quantity_delta) < 0`,
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
    `SELECT p.ar_payment_id, p.amount_pen, p.account_id, p.reference_doc
     FROM erp.ar_payments p
     WHERE p.order_id = $1 AND p.voided_at IS NULL
     ORDER BY p.ar_payment_id
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
  }

  // Close open ON_DEMAND purchase flags tied to cancelled order lines
  await client.query(
    `UPDATE erp.audit_flags
     SET status = 'RESOLVED',
         resolved_at = NOW(),
         resolved_by = $2
     WHERE flag_code = 'ON_DEMAND_PENDING_PURCHASE'
       AND entity_table = 'erp.sales_order_lines'
       AND status = 'OPEN'
       AND entity_id IN (
         SELECT order_line_id::text
         FROM erp.sales_order_lines
         WHERE order_id = $1
       )`,
    [orderId, actor.username]
  );

  // Resolve ON_DEMAND_STOCK_DEFICIT flags for SKUs on this order if stock returned to >= 0
  await client.query(
    `UPDATE erp.audit_flags af
     SET status = 'RESOLVED',
         resolved_at = NOW(),
         resolved_by = $3
     FROM erp.sales_order_lines sol
     LEFT JOIN erp.v_current_stock vcs
       ON vcs.warehouse_id = $2 AND vcs.product_id = sol.product_id
     WHERE sol.order_id = $1
       AND af.flag_code = 'ON_DEMAND_STOCK_DEFICIT'
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
}

export interface OrdersPaginationMeta {
  limit: number;
  offset: number;
  totalCount: number;
  hasMore: boolean;
}

export async function listOrdersPaginatedForRole(
  client: PoolClient,
  actor: SessionUser,
  limit = 60,
  offset = 0
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

  const filterClause =
    actor.role === "WAREHOUSE_DELIVERY"
      ? `WHERE so.operational_status NOT IN ('PENDING_PARTNER_APPROVAL', 'CANCELLED') AND so.source_origin = 'ERP_APP'`
      : actor.role === "EXTERNAL_SELLER"
        ? `WHERE so.operational_status <> 'CANCELLED'`
        : `WHERE TRUE`;

  const countRes = await client.query<{ total_count: number }>(
    `SELECT COUNT(*)::int AS total_count
     FROM erp.sales_orders so
     ${filterClause}`
  );
  const totalCount = Number(countRes.rows[0]?.total_count ?? 0);

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
       so.paid_pen,
       so.balance_due_pen,
       so.is_settled,
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
     ${filterClause}
     ORDER BY
       CASE WHEN so.source_origin = 'ERP_APP' THEN 0 ELSE 1 END ASC,
       so.order_date DESC,
       so.order_id DESC
     LIMIT $1 OFFSET $2`,
    [safeLimit, safeOffset]
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
      paid_pen: Number(row.paid_pen),
      balance_due_pen: Number(row.balance_due_pen),
      is_settled: Boolean(row.is_settled),
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
       p.ref_cost_pen
     FROM erp.products p
     JOIN erp.warehouses w
       ON w.code = 'MAIN' AND w.is_active = TRUE
     LEFT JOIN erp.v_current_stock vcs
       ON vcs.warehouse_id = w.warehouse_id AND vcs.product_id = p.product_id
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
      } satisfies RawProductRow,
      actor.role
    )
  );
}
