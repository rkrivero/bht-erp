import type { PoolClient } from "pg";
import { assertRole, isPartnerRole } from "../../rbac";
import {
  AuthorizationError,
  ValidationError,
  type OrderOperationalStatus,
  type SessionUser,
} from "../../types";
import { recordPriceOverrides } from "../price-audit";
import { getStringSetting } from "../settings";
import {
  SALES_ORDER_COLUMNS,
  deductStockForOrderLines,
  upsertCreditLimitAuditFlag,
  type CreateOrderInput,
} from "./shared";

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
  if (actor.role === "EXTERNAL_SELLER") {
    if (Number(order.created_by_user_id) !== actor.userId) {
      throw new AuthorizationError("Solo puedes modificar tus propios pedidos");
    }
    if (!["REGISTERED", "PENDING_PARTNER_APPROVAL"].includes(String(order.status))) {
      throw new AuthorizationError(
        "Solo un socio puede modificar pedidos que ya pasaron a almacén o reparto"
      );
    }
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
  const lockProductIds = Array.from(
    new Set([
      ...productIds,
      ...beforeLines.rows.map((r) => Number(r.product_id)).filter(Number.isFinite),
    ])
  ).sort((a, b) => a - b);
  await client.query(
    `SELECT product_id FROM erp.products
     WHERE product_id = ANY($1::bigint[])
     ORDER BY product_id FOR UPDATE`,
    [lockProductIds]
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
    const catalogPrice = Number(
      (Number(product.list_sale_price_pen ?? 0) * packFactor).toFixed(4)
    );
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
    if (
      cost !== null &&
      unitPrice < cost * packFactor - 0.0001 &&
      !isPartnerRole(actor.role)
    ) {
      requiresApproval = true;
    }
    const minimum =
      product.min_sale_price_pen === null
        ? basePrice
        : Number((Number(product.min_sale_price_pen) * packFactor).toFixed(4));
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
  const subtotalPen = totalPen;
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

  if (globalDiscountPen > 0 && !isPartnerRole(actor.role)) {
    let hasKnownCost = false;
    let totalKnownCostPen = 0;
    let knownCostLinesRevenue = 0;
    for (const line of prepared) {
      if (line.cost !== null) {
        hasKnownCost = true;
        totalKnownCostPen += line.quantity * line.packFactor * line.cost;
        knownCostLinesRevenue += line.lineTotal;
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
  if (requiresApproval && Number(order.paid_pen) > 0.005) {
    throw new ValidationError(
      "No puedes enviar a aprobación un pedido que ya tiene cobros registrados; ajusta el precio o anula el cobro primero"
    );
  }
  if (totalPen < Number(order.paid_pen) - 0.05) {
    throw new ValidationError(
      "El nuevo total no puede ser menor a lo ya cobrado; registra primero la devolución"
    );
  }

  let creditLimitExceededFlag = false;
  let creditLimitDetails: {
    creditLimitPen: number;
    openArBalancePen: number;
    projectedBalancePen: number;
  } | null = null;
  if (String(order.payment_mode) === "CREDIT" && order.customer_party_id !== null) {
    const customerId = Number(order.customer_party_id);
    await client.query(
      `SELECT party_id FROM erp.parties WHERE party_id = $1 FOR UPDATE`,
      [customerId]
    );
    const partyCreditRes = await client.query<{
      credit_limit_pen: string | number | null;
      open_ar_balance_pen: string | number;
    }>(
      `SELECT
         pa.credit_limit_pen,
         COALESCE((
           SELECT SUM(so.balance_due_pen)
           FROM erp.sales_orders so
           WHERE so.customer_party_id = pa.party_id
             AND so.order_id <> $2
             AND so.is_settled = FALSE
             AND so.balance_due_pen > 0.05
             AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
         ), 0)::NUMERIC(14,2) AS open_ar_balance_pen
       FROM erp.parties pa
       WHERE pa.party_id = $1
       LIMIT 1`,
      [customerId, orderId]
    );
    const partyRow = partyCreditRes.rows[0];
    if (
      partyRow?.credit_limit_pen !== null &&
      partyRow?.credit_limit_pen !== undefined &&
      Number(partyRow.credit_limit_pen) > 0
    ) {
      const creditLimitPen = Number(partyRow.credit_limit_pen);
      const openArBalancePen = Number(partyRow.open_ar_balance_pen ?? 0);
      const orderCreditExposure = Math.max(
        0,
        Number((totalPen - Number(order.paid_pen ?? 0)).toFixed(2))
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

  const postReversalStockRes = await client.query<{
    product_id: string | number;
    stock_on_hand: string | number;
  }>(
    `SELECT product_id, COALESCE(stock_on_hand, 0) AS stock_on_hand
     FROM erp.v_current_stock
     WHERE warehouse_id = $1 AND product_id = ANY($2::bigint[])`,
    [Number(order.warehouse_id), productIds]
  );
  const available = new Map<number, number>();
  for (const row of postReversalStockRes.rows) {
    available.set(Number(row.product_id), Number(row.stock_on_hand ?? 0));
  }
  for (const line of prepared) {
    if (!available.has(line.productId)) available.set(line.productId, 0);
  }
  const updateLineValuesClauses: string[] = [];
  const updateLineParams: unknown[] = [];
  for (const line of prepared) {
    const stock = available.get(line.productId) ?? 0;
    const required = line.quantity * line.packFactor;
    const pendingPurchase = line.fulfillmentMode === "ON_DEMAND" && stock < required;
    if (!pendingPurchase) available.set(line.productId, stock - required);
    const offset = updateLineParams.length;
    updateLineValuesClauses.push(
      `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11},$${offset + 12},$${offset + 13})`
    );
    updateLineParams.push(
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
      line.belowMinimum
    );
  }

  const updatedInsertedRes = await client.query<{
    order_line_id: number;
    line_no: number;
    product_id: number;
    fulfillment_status: string;
  }>(
    `INSERT INTO erp.sales_order_lines (
       order_id, line_no, product_id, raw_description, quantity,
       pack_factor_applied, base_unit_price_pen, unit_discount_pen,
       unit_price_pen, line_total_pen, unit_cost_snapshot_pen,
       fulfillment_status, below_min_price_flag
     ) VALUES ${updateLineValuesClauses.join(", ")}
     RETURNING order_line_id, line_no, product_id, fulfillment_status::text AS fulfillment_status`,
    updateLineParams
  );

  for (const insertedLine of updatedInsertedRes.rows ?? []) {
    if (insertedLine.fulfillment_status !== "PENDING_SUPPLIER_PURCHASE") continue;
    const matched = prepared.find((pl) => pl.lineNo === Number(insertedLine.line_no));
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
          warehouse_id: Number(order.warehouse_id),
          required_base_qty: matched ? matched.quantity * matched.packFactor : null,
        }),
      ]
    );
  }

  const nextStatus: OrderOperationalStatus = requiresApproval
    ? "PENDING_PARTNER_APPROVAL"
    : "REGISTERED";
  await client.query(
    `UPDATE erp.sales_orders
     SET total_pen = $1, global_discount_pen = $7, operational_status = $2, stock_deducted = FALSE,
         credit_limit_exceeded_flag = $8,
         trip_id = NULL, picked_by_user_id = NULL, picked_at = NULL,
         delivered_by_user_id = NULL, delivered_at = NULL,
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
      creditLimitExceededFlag,
    ]
  );

  if (creditLimitExceededFlag && creditLimitDetails) {
    await upsertCreditLimitAuditFlag(client, actor, {
      orderId,
      orderCode: String(order.order_code),
      customerPartyId:
        order.customer_party_id !== null && order.customer_party_id !== undefined
          ? Number(order.customer_party_id)
          : null,
      customerName: String(order.customer_name_raw || "CLIENTE"),
      creditLimitPen: creditLimitDetails.creditLimitPen,
      openArBalancePen: creditLimitDetails.openArBalancePen,
      orderTotalPen: totalPen,
      projectedBalancePen: creditLimitDetails.projectedBalancePen,
    });
  } else {
    await client.query(
      `UPDATE erp.audit_flags
       SET status = 'RESOLVED',
           resolved_at = NOW(),
           resolved_by = $2
       WHERE flag_code = 'CREDIT_LIMIT_EXCEEDED'
         AND entity_table = 'erp.sales_orders'
         AND entity_id = $1
         AND status = 'OPEN'`,
      [String(orderId), actor.username]
    );
  }

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
