import type { PoolClient } from "pg";
import { resolveActiveCashAccount } from "../cash-account-resolver";
import type { PaymentMode, SessionUser } from "../../types";

export const SALES_ORDER_COLUMNS = `
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

export async function getMainWarehouseId(client: PoolClient): Promise<number> {
  const res = await client.query(
    `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1`
  );
  if (res.rowCount === 0) {
    throw new Error("Warehouse MAIN not found");
  }
  return Number(res.rows[0].warehouse_id);
}

export async function getDefaultCashAccountId(
  client: PoolClient,
  actor: SessionUser,
  explicitAccountId?: number
): Promise<number> {
  const resolved = await resolveActiveCashAccount(client, actor, explicitAccountId);
  return resolved.accountId;
}

export async function deductStockForOrderLines(
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

export async function upsertCreditLimitAuditFlag(
  client: PoolClient,
  actor: SessionUser,
  params: {
    orderId: number;
    orderCode: string;
    customerPartyId: number | null;
    customerName: string;
    creditLimitPen: number;
    openArBalancePen: number;
    orderTotalPen: number;
    projectedBalancePen: number;
  }
): Promise<void> {
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
      String(params.orderId),
      `Pedido ${params.orderCode} (${params.customerName}) excede límite de crédito: proyectado S/ ${params.projectedBalancePen.toFixed(2)} > límite S/ ${params.creditLimitPen.toFixed(2)}`,
      JSON.stringify({
        order_id: params.orderId,
        order_code: params.orderCode,
        customer_party_id: params.customerPartyId,
        customer_name: params.customerName,
        credit_limit_pen: params.creditLimitPen,
        open_ar_balance_pen: params.openArBalancePen,
        order_total_pen: params.orderTotalPen,
        projected_balance_pen: params.projectedBalancePen,
        actor_user_id: actor.userId,
        actor_role: actor.role,
      }),
    ]
  );
}
