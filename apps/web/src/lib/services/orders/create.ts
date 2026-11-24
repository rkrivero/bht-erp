import type { PoolClient } from "pg";
import { assertRole, isPartnerRole } from "../../rbac";
import {
  ValidationError,
  type OrderOperationalStatus,
  type SessionUser,
} from "../../types";
import { recordPriceOverrides } from "../price-audit";
import { getNumericSetting, getStringSetting } from "../settings";
import { recordUndoableAction, type UndoActionReceipt } from "../undo";
import {
  addDaysToIsoDate,
  deductStockForOrderLines,
  getDefaultCashAccountId,
  getLimaDateString,
  getMainWarehouseId,
  upsertCreditLimitAuditFlag,
  type CreateOrderInput,
} from "./shared";

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
    const packFactorApplied = Number(
      (item.packFactorApplied !== undefined
        ? Number(item.packFactorApplied)
        : 1
      ).toFixed(4)
    );
    if (!Number.isFinite(packFactorApplied) || packFactorApplied <= 0) {
      throw new ValidationError("Factor de empaque inválido");
    }
    const catalogPricePen = Number(
      (Number(prod.list_sale_price_pen ?? 0) * packFactorApplied).toFixed(4)
    );
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
        ? Number((Number(prod.min_sale_price_pen) * packFactorApplied).toFixed(4))
        : baseUnitPricePen;
    const belowMinPriceFlag = unitPricePen < minSalePricePen - 0.0001;
    const requiredBaseQty = Number(
      (Number(item.quantity) * packFactorApplied).toFixed(4)
    );
    const referenceCostPen =
      prod.ref_cost_pen !== null ? Number(prod.ref_cost_pen) : null;
    const belowCostFlag =
      referenceCostPen !== null &&
      unitPricePen < referenceCostPen * packFactorApplied - 0.0001;
    if (belowCostFlag && !isPartnerRole(actor.role)) {
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

  const subtotalPen = totalPen;
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

  if (globalDiscountPen > 0 && !isPartnerRole(actor.role)) {
    let hasKnownCost = false;
    let totalKnownCostPen = 0;
    let knownCostLinesRevenue = 0;
    for (const line of preparedLines) {
      if (line.unitCostSnapshotPen !== null) {
        hasKnownCost = true;
        totalKnownCostPen += line.requiredBaseQty * line.unitCostSnapshotPen;
        knownCostLinesRevenue += line.lineTotalPen;
      }
    }
    if (hasKnownCost) {
      const proratedGlobalDiscount =
        subtotalPen > 0 ? globalDiscountPen * (knownCostLinesRevenue / subtotalPen) : 0;
      const netKnownCostRevenue = knownCostLinesRevenue - proratedGlobalDiscount;
      if (netKnownCostRevenue < totalKnownCostPen - 0.01) {
        requiresApproval = true;
      }
    }
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
      await client.query(
        `SELECT party_id FROM erp.parties WHERE party_id = $1 FOR UPDATE`,
        [input.customerPartyId]
      );
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
        const initialAdvance = requiresApproval
          ? 0
          : Math.max(0, Number(input.initialPaidPen ?? 0));
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
          const creditLimitMode = await getStringSetting(
            client,
            "credit_limit_mode",
            "APPROVAL_GATE"
          );
          if (creditLimitMode === "STRICT_BLOCK" && !isPartnerRole(actor.role)) {
            throw new ValidationError(
              `El cliente excede su límite de crédito (S/ ${creditLimitPen.toFixed(2)})`
            );
          }
          if (creditLimitMode === "APPROVAL_GATE" && !isPartnerRole(actor.role)) {
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
    await upsertCreditLimitAuditFlag(client, actor, {
      orderId,
      orderCode,
      customerPartyId: input.customerPartyId ?? null,
      customerName: input.customerNameRaw.trim(),
      creditLimitPen: creditLimitDetails.creditLimitPen,
      openArBalancePen: creditLimitDetails.openArBalancePen,
      orderTotalPen: totalPen,
      projectedBalancePen: creditLimitDetails.projectedBalancePen,
    });
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

  const insertedLinesRes = await client.query<{
    order_line_id: number;
    line_no: number;
    product_id: number;
    sku: string;
    fulfillment_status: string;
  }>(
    `INSERT INTO erp.sales_order_lines (
       order_id, line_no, product_id, raw_description, quantity, pack_factor_applied,
       base_unit_price_pen, unit_discount_pen, unit_price_pen,
       line_total_pen, unit_cost_snapshot_pen, fulfillment_status,
       below_min_price_flag
     ) VALUES ${lineValuesClauses.join(", ")}
     RETURNING order_line_id, line_no, product_id, fulfillment_status::text AS fulfillment_status`,
    lineParams
  );

  for (const insertedLine of insertedLinesRes.rows ?? []) {
    if (insertedLine.fulfillment_status !== "PENDING_SUPPLIER_PURCHASE") continue;
    const matched = preparedLines.find(
      (pl) => pl.lineNo === Number(insertedLine.line_no)
    );
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
        String(insertedLine.order_line_id),
        `ON_DEMAND sale line #${insertedLine.order_line_id} for SKU ${matched?.sku ?? insertedLine.product_id} awaiting supplier purchase`,
        JSON.stringify({
          order_id: orderId,
          order_line_id: Number(insertedLine.order_line_id),
          product_id: Number(insertedLine.product_id),
          sku: matched?.sku ?? null,
          warehouse_id: warehouseId,
          required_base_qty: matched?.requiredBaseQty ?? null,
        }),
      ]
    );
  }

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

  if (input.initialPaidPen !== undefined && input.initialPaidPen !== null) {
    const parsedInitialPaid = Number(input.initialPaidPen);
    if (!Number.isFinite(parsedInitialPaid) || parsedInitialPaid < 0) {
      throw new ValidationError("El pago inicial no puede ser negativo");
    }
  }

  const rawInitialPaid = requiresApproval
    ? 0
    : input.paymentMode !== "CREDIT"
      ? input.initialPaidPen !== undefined && input.initialPaidPen !== null
        ? Number(input.initialPaidPen)
        : input.collectOnDelivery
          ? 0
          : totalPen
      : Number(input.initialPaidPen ?? 0);
  const initialPaid = Number(rawInitialPaid.toFixed(2));

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
