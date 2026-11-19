import {
  AuthorizationError,
  type RawOrderWithLines,
  type RawProductRow,
  type SessionUser,
  type UserRole,
} from "./types";

export function assertRole(
  actor: SessionUser | null,
  allowed: UserRole[]
): SessionUser {
  if (!actor) {
    throw new AuthorizationError("Sesión no iniciada");
  }
  if (!allowed.includes(actor.role)) {
    throw new AuthorizationError(`Rol ${actor.role} no autorizado para esta operación`);
  }
  return actor;
}

export function isPartnerRole(role: UserRole): boolean {
  return role === "PARTNER_ADMIN" || role === "PARTNER_MANAGER";
}

export function projectProductForRole(
  product: RawProductRow,
  role: UserRole
): Record<string, unknown> {
  const base = {
    product_id: Number(product.product_id),
    sku: product.sku,
    name: product.name,
    unit_of_measure: product.unit_of_measure,
    fulfillment_mode: product.fulfillment_mode,
    stock_on_hand: Number(product.stock_on_hand),
  };

  if (role === "WAREHOUSE_DELIVERY") {
    return base;
  }

  const withPrices = {
    ...base,
    list_sale_price_pen:
      product.list_sale_price_pen !== null ? Number(product.list_sale_price_pen) : null,
    min_sale_price_pen:
      product.min_sale_price_pen !== null ? Number(product.min_sale_price_pen) : null,
  };

  if (role === "EXTERNAL_SELLER") {
    return withPrices;
  }

  return {
    ...withPrices,
    ref_cost_pen: product.ref_cost_pen !== null ? Number(product.ref_cost_pen) : null,
    cost_updated_at: product.cost_updated_at ?? null,
    default_supplier_party_id:
      product.default_supplier_party_id !== null &&
      product.default_supplier_party_id !== undefined
        ? Number(product.default_supplier_party_id)
        : null,
    lead_time_days:
      product.lead_time_days !== null && product.lead_time_days !== undefined
        ? Number(product.lead_time_days)
        : null,
    min_stock_qty:
      product.min_stock_qty !== null && product.min_stock_qty !== undefined
        ? Number(product.min_stock_qty)
        : null,
  };
}

export function projectOrderForRole(
  order: RawOrderWithLines,
  role: UserRole
): Record<string, unknown> {
  if (role === "WAREHOUSE_DELIVERY") {
    return {
      order_id: Number(order.order_id),
      order_code: order.order_code,
      order_date: order.order_date,
      operational_status: order.operational_status,
      trip_id: order.trip_id ?? null,
      trip_code: order.trip_code ?? null,
      customer_party_id: order.customer_party_id ?? null,
      customer_name: order.customer_name,
      customer_zone: order.customer_zone ?? null,
      customer_address: order.customer_address ?? null,
      customer_phone: order.customer_phone ?? null,
      customer_geo_lat: order.customer_geo_lat ?? null,
      customer_geo_lng: order.customer_geo_lng ?? null,
      was_modified: Boolean(
        order.audit_history?.some((entry) => entry.action === "EDIT")
      ),
      notes: order.notes ?? null,
      created_by_name: order.created_by_name,
      created_at: order.created_at ?? null,
      picked_by_name: order.picked_by_name,
      picked_at: order.picked_at ?? null,
      delivered_by_name: order.delivered_by_name,
      delivered_at: order.delivered_at ?? null,
      lines: order.lines.map((line) => ({
        order_line_id: Number(line.order_line_id),
        line_no: Number(line.line_no),
        sku: line.sku,
        raw_description: line.raw_description,
        unit_of_measure: line.unit_of_measure || "NIU",
        quantity: Number(line.quantity),
        pack_factor_applied: Number(line.pack_factor_applied ?? 1),
        fulfillment_mode: line.fulfillment_mode,
        fulfillment_status: line.fulfillment_status,
        needs_supplier_pickup:
          line.fulfillment_mode === "ON_DEMAND" &&
          line.fulfillment_status === "PENDING_SUPPLIER_PURCHASE",
      })),
    };
  }

  if (role === "EXTERNAL_SELLER") {
    return {
      order_id: Number(order.order_id),
      order_code: order.order_code,
      order_date: order.order_date,
      customer_party_id: order.customer_party_id ?? null,
      customer_name: order.customer_name,
      customer_legal_name: order.customer_legal_name ?? null,
      customer_trade_name: order.customer_trade_name ?? null,
      customer_zone: order.customer_zone ?? null,
      customer_address: order.customer_address ?? null,
      customer_phone: order.customer_phone ?? null,
      customer_geo_lat: order.customer_geo_lat ?? null,
      customer_geo_lng: order.customer_geo_lng ?? null,
      operational_status: order.operational_status,
      trip_id: order.trip_id ?? null,
      trip_code: order.trip_code ?? null,
      quote_id: order.quote_id ?? null,
      payment_mode: order.payment_mode,
      promised_payment_date: order.promised_payment_date ?? null,
      total_pen: Number(order.total_pen),
      paid_pen: Number(order.paid_pen),
      balance_due_pen: Number(order.balance_due_pen),
      is_settled: Boolean(order.is_settled),
      notes: order.notes ?? null,
      created_by_user_id: order.created_by_user_id ?? null,
      created_by_name: order.created_by_name,
      audit_history: order.audit_history ?? [],
      created_at: order.created_at ?? null,
      approved_by_name: order.approved_by_name ?? null,
      approved_at: order.approved_at ?? null,
      picked_by_name: order.picked_by_name,
      picked_at: order.picked_at ?? null,
      delivered_by_name: order.delivered_by_name,
      delivered_at: order.delivered_at ?? null,
      lines: order.lines.map((line) => ({
        order_line_id: Number(line.order_line_id),
        line_no: Number(line.line_no),
        sku: line.sku,
        raw_description: line.raw_description,
        unit_of_measure: line.unit_of_measure || "NIU",
        quantity: Number(line.quantity),
        pack_factor_applied: Number(line.pack_factor_applied ?? 1),
        base_unit_price_pen: Number(line.base_unit_price_pen),
        unit_discount_pen: Number(line.unit_discount_pen),
        unit_price_pen: Number(line.unit_price_pen),
        line_total_pen: Number(line.line_total_pen),
        fulfillment_mode: line.fulfillment_mode,
        fulfillment_status: line.fulfillment_status,
        below_min_price_flag: Boolean(line.below_min_price_flag),
      })),
    };
  }

  // PARTNER_ADMIN & PARTNER_MANAGER: include unit cost snapshot and real gross margin in S/
  let totalMarginPen = 0;
  const partnerLines = order.lines.map((line) => {
    const qty = Number(line.quantity);
    const unitPrice = Number(line.unit_price_pen);
    const unitCost =
      line.unit_cost_snapshot_pen !== null ? Number(line.unit_cost_snapshot_pen) : null;
    const lineMarginPen =
      unitCost !== null ? Number(((unitPrice - unitCost) * qty).toFixed(2)) : null;
    if (lineMarginPen !== null) {
      totalMarginPen += lineMarginPen;
    }
    return {
      order_line_id: Number(line.order_line_id),
      line_no: Number(line.line_no),
      sku: line.sku,
      raw_description: line.raw_description,
      unit_of_measure: line.unit_of_measure || "NIU",
      quantity: qty,
      pack_factor_applied: Number(line.pack_factor_applied ?? 1),
      base_unit_price_pen: Number(line.base_unit_price_pen),
      unit_discount_pen: Number(line.unit_discount_pen),
      unit_price_pen: unitPrice,
      line_total_pen: Number(line.line_total_pen),
      unit_cost_snapshot_pen: unitCost,
      line_margin_pen: lineMarginPen,
      fulfillment_mode: line.fulfillment_mode,
      fulfillment_status: line.fulfillment_status,
      below_min_price_flag: Boolean(line.below_min_price_flag),
    };
  });

  return {
    order_id: Number(order.order_id),
    order_code: order.order_code,
    order_date: order.order_date,
    customer_party_id: order.customer_party_id ?? null,
    customer_name: order.customer_name,
    customer_legal_name: order.customer_legal_name ?? null,
    customer_trade_name: order.customer_trade_name ?? null,
    customer_zone: order.customer_zone ?? null,
    customer_address: order.customer_address ?? null,
    customer_phone: order.customer_phone ?? null,
    customer_geo_lat: order.customer_geo_lat ?? null,
    customer_geo_lng: order.customer_geo_lng ?? null,
    operational_status: order.operational_status,
    trip_id: order.trip_id ?? null,
    trip_code: order.trip_code ?? null,
    quote_id: order.quote_id ?? null,
    payment_mode: order.payment_mode,
    promised_payment_date: order.promised_payment_date ?? null,
    total_pen: Number(order.total_pen),
    paid_pen: Number(order.paid_pen),
    balance_due_pen: Number(order.balance_due_pen),
    is_settled: Boolean(order.is_settled),
    order_margin_pen: Number(totalMarginPen.toFixed(2)),
    notes: order.notes ?? null,
    created_by_user_id: order.created_by_user_id ?? null,
    created_by_name: order.created_by_name,
    audit_history: order.audit_history ?? [],
    created_at: order.created_at ?? null,
    approved_by_name: order.approved_by_name ?? null,
    approved_at: order.approved_at ?? null,
    picked_by_name: order.picked_by_name,
    picked_at: order.picked_at ?? null,
    delivered_by_name: order.delivered_by_name,
    delivered_at: order.delivered_at ?? null,
    lines: partnerLines,
  };
}
