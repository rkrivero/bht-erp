import type { PoolClient } from "pg";
import { resolveActiveCashAccount } from "./cash-account-resolver";
import { formatOperationalStatusEs } from "../labels-es";
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
import { recordPriceOverrides } from "./price-audit";
import { getNumericSetting } from "./settings";
import { recordUndoableAction, type UndoActionReceipt } from "./undo";

const SALES_ORDER_COLUMNS = `
  order_id, order_code, order_date, trip_id, warehouse_id,
  customer_party_id, customer_name_raw, quote_id, payment_mode,
  historical_status_assumed, payment_status_raw, doc_ref, total_pen,
  global_discount_pen, paid_pen, balance_due_pen, is_settled, due_date, source_origin,
  source_file, source_sheet, source_row_num, source_row_hash, notes,
  created_at, operational_status, created_by_user_id, approved_by_user_id,
  approved_at, picked_by_user_id, picked_at, delivered_by_user_id,
  delivered_at, stock_deducted, promised_payment_date, credit_limit_exceeded_flag,
  updated_at, ops_seq, fin_seq`;

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
  globalDiscountPen?: number;
  orderDate?: string | null;
  initialOperationalStatus?: "REGISTERED" | "DELIVERED";
  notes?: string;
  lines: Array<{
    productId: number;
    quantity: number;
    packFactorApplied?: number;
    unitPricePen?: number;
    unitDiscountPen?: number;
    overrideBasePricePen?: number;
  }>;
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
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
  const resolved = await resolveActiveCashAccount(client, actor, explicitAccountId);
  return resolved.accountId;
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
  input: CreateOrderInput,
  options: { skipUndoLog?: boolean } = {}
): Promise<{
  orderId: number;
  orderCode: string;
  operationalStatus: OrderOperationalStatus;
  requiresApproval: boolean;
  creditLimitExceeded?: boolean;
  undoAction?: UndoActionReceipt;
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
    const prod = productById.get(item.productId);
    if (!prod) {
      throw new ValidationError(`Producto ID ${item.productId} no encontrado`);
    }
    const catalogPricePen = Number(prod.list_sale_price_pen ?? 0);
    let baseUnitPricePen: number;
    let unitPricePen: number;
    let unitDiscountPen: number;

    if (item.unitPricePen !== undefined && item.unitPricePen !== null) {
      const parsedPrice = Number(item.unitPricePen);
      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        throw new ValidationError("El precio unitario debe ser mayor a S/ 0.00");
      }
      baseUnitPricePen = catalogPricePen > 0 ? catalogPricePen : parsedPrice;
      unitPricePen = Number(parsedPrice.toFixed(4));
      unitDiscountPen = Math.max(
        0,
        Number((baseUnitPricePen - unitPricePen).toFixed(4))
      );
    } else {
      unitDiscountPen = Number(item.unitDiscountPen ?? 0);
      baseUnitPricePen =
        isPartnerRole(actor.role) && item.overrideBasePricePen !== undefined
          ? Number(item.overrideBasePricePen)
          : catalogPricePen;
      unitPricePen = Number((baseUnitPricePen - unitDiscountPen).toFixed(4));
    }
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

  const globalDiscountPen = Number((input.globalDiscountPen ?? 0).toFixed(2));
  if (!Number.isFinite(globalDiscountPen) || globalDiscountPen < 0) {
    throw new ValidationError("El descuento global no puede ser negativo");
  }
  if (globalDiscountPen >= totalPen) {
    throw new ValidationError(
      "El descuento global debe ser menor al subtotal del pedido"
    );
  }
  totalPen = Number((totalPen - globalDiscountPen).toFixed(2));

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

  // Compute promised_payment_date and evaluate credit_limit_pen gate for CREDIT orders
  let promisedPaymentDate: string | null = null;
  let creditLimitExceededFlag = false;
  let creditLimitDetails: {
    creditLimitPen: number;
    openArBalancePen: number;
    projectedBalancePen: number;
  } | null = null;

  const effectiveOrderDate =
    input.orderDate && /^\d{4}-\d{2}-\d{2}$/.test(input.orderDate)
      ? input.orderDate
      : getLimaDateString(0);

  if (input.paymentMode === "CREDIT") {
    let agreedCreditDays: number | null = null;
    if (input.customerPartyId) {
      const partyCreditRes = await client.query<{
        credit_days_agreed: number | null;
        credit_limit_pen: string | number | null;
        open_ar_balance_pen: string | number;
      }>(
        `SELECT
           pa.credit_days_agreed,
           pa.credit_limit_pen,
           COALESCE((
             SELECT SUM(so.balance_due_pen)
             FROM erp.sales_orders so
             WHERE so.customer_party_id = pa.party_id
               AND so.is_settled = FALSE
               AND so.balance_due_pen > 0.05
               AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
           ), 0)::NUMERIC(14,2) AS open_ar_balance_pen
         FROM erp.parties pa
         WHERE pa.party_id = $1
         LIMIT 1`,
        [input.customerPartyId]
      );
      const partyRow = partyCreditRes.rows[0];
      if (
        partyRow?.credit_days_agreed !== null &&
        partyRow?.credit_days_agreed !== undefined &&
        Number(partyRow.credit_days_agreed) >= 0
      ) {
        agreedCreditDays = Number(partyRow.credit_days_agreed);
      }
      if (
        partyRow?.credit_limit_pen !== null &&
        partyRow?.credit_limit_pen !== undefined &&
        Number(partyRow.credit_limit_pen) > 0
      ) {
        const creditLimitPen = Number(partyRow.credit_limit_pen);
        const openArBalancePen = Number(partyRow.open_ar_balance_pen ?? 0);
        const initialAdvance = Math.max(0, Number(input.initialPaidPen ?? 0));
        const orderCreditExposure = Math.max(
          0,
          Number((totalPen - initialAdvance).toFixed(2))
        );
        const projectedBalancePen = Number(
          (openArBalancePen + orderCreditExposure).toFixed(2)
        );
        if (projectedBalancePen > creditLimitPen + 0.005) {
          creditLimitExceededFlag = true;
          creditLimitDetails = {
            creditLimitPen,
            openArBalancePen,
            projectedBalancePen,
          };
          if (!isPartnerRole(actor.role)) {
            requiresApproval = true;
          }
        }
      }
    }

    if (input.promisedPaymentDate) {
      promisedPaymentDate = input.promisedPaymentDate;
    } else if (input.creditDays && input.creditDays > 0) {
      promisedPaymentDate = addDaysToIsoDate(effectiveOrderDate, input.creditDays);
    } else {
      const defaultDays = await getNumericSetting(client, "default_credit_days", 7);
      const days = agreedCreditDays !== null ? agreedCreditDays : defaultDays;
      promisedPaymentDate = addDaysToIsoDate(effectiveOrderDate, days);
    }
  } else if (input.collectOnDelivery) {
    promisedPaymentDate = effectiveOrderDate;
  }

  const operationalStatus: OrderOperationalStatus = requiresApproval
    ? "PENDING_PARTNER_APPROVAL"
    : (input.initialOperationalStatus ?? "REGISTERED");
  const stockDeducted = !requiresApproval;

  const periodKey = effectiveOrderDate.replace(/-/g, "");
  const seqRes = await client.query<{ code: string }>(
    `SELECT erp.fn_next_document_code('SALES_ORDER', 'SO', $1, 4) AS code`,
    [periodKey]
  );
  const orderCode = String(seqRes.rows[0].code);

  const isDeliveredOnCreate = operationalStatus === "DELIVERED";
  const deliveredAtIso = isDeliveredOnCreate ? new Date().toISOString() : null;

  const orderInsert = await client.query(
    `INSERT INTO erp.sales_orders (
       order_code, order_date, warehouse_id, customer_party_id, customer_name_raw,
       payment_mode, operational_status, total_pen, global_discount_pen, paid_pen,
       due_date, promised_payment_date,
       created_by_user_id, approved_by_user_id, approved_at,
       delivered_by_user_id, delivered_at,
       stock_deducted, trip_id, quote_id, credit_limit_exceeded_flag,
       source_origin, notes
     ) VALUES (
       $1, $18::date, $2, $3, $4,
       $5, $6, $7, $16, 0,
       $11, $11,
       $8, $9, $10,
       $19, $20,
       $12, $13, $14, $17,
       'ERP_APP', $15
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
      globalDiscountPen,
      creditLimitExceededFlag,
      effectiveOrderDate,
      isDeliveredOnCreate ? actor.userId : null,
      deliveredAtIso,
    ]
  );
  const orderId = Number(orderInsert.rows[0].order_id);

  if (creditLimitExceededFlag && creditLimitDetails) {
    await client.query(
      `INSERT INTO erp.audit_flags (
         flag_code, severity, entity_table, entity_id,
         message, details, status, source_origin
       ) VALUES (
         'CREDIT_LIMIT_EXCEEDED',
         'WARNING',
         'erp.sales_orders',
         $1,
         $2,
         $3::jsonb,
         'OPEN',
         'ERP_APP'
       )
       ON CONFLICT (flag_code, entity_table, entity_id)
       WHERE status = 'OPEN'
       DO UPDATE SET
         message = EXCLUDED.message,
         details = EXCLUDED.details`,
      [
        String(orderId),
        `Pedido ${orderCode} (${input.customerNameRaw.trim()}) excede límite de crédito: proyectado S/ ${creditLimitDetails.projectedBalancePen.toFixed(2)} > límite S/ ${creditLimitDetails.creditLimitPen.toFixed(2)}`,
        JSON.stringify({
          order_id: orderId,
          order_code: orderCode,
          customer_party_id: input.customerPartyId ?? null,
          customer_name: input.customerNameRaw.trim(),
          credit_limit_pen: creditLimitDetails.creditLimitPen,
          open_ar_balance_pen: creditLimitDetails.openArBalancePen,
          order_total_pen: totalPen,
          projected_balance_pen: creditLimitDetails.projectedBalancePen,
          actor_user_id: actor.userId,
          actor_role: actor.role,
        }),
      ]
    );
  }

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

  await recordPriceOverrides(
    client,
    actor,
    preparedLines.map((line) => ({
      entityType: "ORDER",
      entityId: orderId,
      entityCode: orderCode,
      lineNo: line.lineNo,
      productId: line.productId,
      sku: line.sku,
      productName: line.name,
      customerPartyId: input.customerPartyId ?? null,
      customerName: input.customerNameRaw.trim(),
      catalogPricePen: line.baseUnitPricePen,
      appliedPricePen: line.unitPricePen,
      quantity: line.quantity,
      reason: input.notes?.trim() || null,
    }))
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
         $6::date, $1, $2, 'IN', $3,
         'COBRANZA_VENTA', FALSE, 'erp.sales_orders', $4,
         $5, 'ERP_APP'
       ) RETURNING ledger_id`,
      [
        accountId,
        input.customerPartyId ?? null,
        initialPaid,
        String(orderId),
        `Cobro inicial pedido ${orderCode} (${input.customerNameRaw.trim()})`,
        effectiveOrderDate,
      ]
    );

    await client.query(
      `INSERT INTO erp.ar_payments (
         order_id, payment_date, amount_pen, payment_mode,
         account_id, reference_doc, collected_by_user_id,
         source_origin, notes
       ) VALUES ($1, $8::date, $2, $3, $4, $5, $6, 'ERP_APP', $7)`,
      [
        orderId,
        initialPaid,
        effectiveMode,
        accountId,
        `LEDGER-${ledgerRes.rows[0].ledger_id}`,
        actor.userId,
        input.paymentMode === "CREDIT" ? "Adelanto inicial" : "Pago al contado",
        effectiveOrderDate,
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
        ? creditLimitExceededFlag
          ? "Pedido registrado con exceso de línea de crédito; pendiente de aprobación de Socio"
          : "Pedido registrado con precio bajo costo; pendiente de aprobación de Socio"
        : isDeliveredOnCreate
          ? "Pedido registrado y entregado (conversión de cotización)"
          : "Pedido registrado",
    ]
  );

  const undoAction = options.skipUndoLog
    ? undefined
    : await recordUndoableAction(client, actor, {
        actionType: "ORDER_CREATE",
        entityTable: "erp.sales_orders",
        entityId: orderId,
        entityCode: orderCode,
        summary: `Registró pedido ${orderCode} (${input.customerNameRaw.trim()}) por S/ ${totalPen.toFixed(2)}`,
        undoPayload: {
          orderId,
          orderCode,
          operationalStatus,
          customerName: input.customerNameRaw.trim(),
          totalPen,
        },
      });

  return {
    orderId,
    orderCode,
    operationalStatus,
    requiresApproval,
    creditLimitExceeded: creditLimitExceededFlag,
    undoAction,
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

export async function updateOrder(
  client: PoolClient,
  actor: SessionUser,
  orderId: number,
  input: Pick<CreateOrderInput, "lines" | "globalDiscountPen"> & { reason: string }
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
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new ValidationError("La cantidad debe ser mayor a 0");
    }
    if (!Number.isFinite(packFactor) || packFactor <= 0) {
      throw new ValidationError("Factor de empaque inválido");
    }
    const catalogPrice = Number(product.list_sale_price_pen ?? 0);
    let basePrice: number;
    let unitPrice: number;
    let discount: number;
    if (line.unitPricePen !== undefined && line.unitPricePen !== null) {
      const parsedPrice = Number(line.unitPricePen);
      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        throw new ValidationError("El precio unitario debe ser mayor a cero");
      }
      basePrice = catalogPrice > 0 ? catalogPrice : parsedPrice;
      unitPrice = Number(parsedPrice.toFixed(4));
      discount = Math.max(0, Number((basePrice - unitPrice).toFixed(4)));
    } else {
      discount = Number(line.unitDiscountPen ?? 0);
      if (!Number.isFinite(discount) || discount < 0) {
        throw new ValidationError("Cantidad, empaque o descuento inválido");
      }
      basePrice = catalogPrice;
      unitPrice = Number((basePrice - discount).toFixed(4));
    }
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
      sku: String(product.sku),
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
  const globalDiscountPen = Number(
    (input.globalDiscountPen !== undefined
      ? input.globalDiscountPen
      : Number(order.global_discount_pen ?? 0)
    ).toFixed(2)
  );
  if (!Number.isFinite(globalDiscountPen) || globalDiscountPen < 0) {
    throw new ValidationError("El descuento global no puede ser negativo");
  }
  if (globalDiscountPen >= totalPen) {
    throw new ValidationError(
      "El descuento global debe ser menor al subtotal del pedido"
    );
  }
  totalPen = Number((totalPen - globalDiscountPen).toFixed(2));
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
     SET total_pen = $1, global_discount_pen = $7, operational_status = $2, stock_deducted = FALSE,
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
      globalDiscountPen,
    ]
  );

  await recordPriceOverrides(
    client,
    actor,
    prepared.map((line) => ({
      entityType: "ORDER",
      entityId: orderId,
      entityCode: String(order.order_code),
      lineNo: line.lineNo,
      productId: line.productId,
      sku: line.sku,
      productName: line.name,
      customerPartyId:
        order.customer_party_id !== null && order.customer_party_id !== undefined
          ? Number(order.customer_party_id)
          : null,
      customerName: String(order.customer_name_raw || "CLIENTE"),
      catalogPricePen: line.basePrice,
      appliedPricePen: line.unitPrice,
      quantity: line.quantity,
      reason: `Modificación de pedido: ${reason}`,
    }))
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
