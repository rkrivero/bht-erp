export type UserRole =
  | "PARTNER_ADMIN"
  | "PARTNER_MANAGER"
  | "EXTERNAL_SELLER"
  | "WAREHOUSE_DELIVERY";

export type OrderOperationalStatus =
  | "PENDING_PARTNER_APPROVAL"
  | "REGISTERED"
  | "PICKING"
  | "READY"
  | "IN_ROUTE"
  | "DELIVERED"
  | "CANCELLED";

export type PaymentMode = "CASH" | "CREDIT" | "TRANSFER" | "YAPE_PLIN";
export type FulfillmentMode = "STOCKED" | "ON_DEMAND";
export type LineFulfillmentStatus =
  | "FULFILLED"
  | "PENDING_SUPPLIER_PURCHASE"
  | "CANCELLED";

export interface SessionUser {
  userId: number;
  username: string;
  fullName: string;
  role: UserRole;
  defaultCashAccountId: number | null;
}

export interface RawProductRow {
  product_id: number;
  sku: string;
  name: string;
  unit_of_measure: string;
  fulfillment_mode: FulfillmentMode;
  stock_on_hand: number;
  list_sale_price_pen: number | null;
  min_sale_price_pen: number | null;
  ref_cost_pen: number | null;
}

export interface RawOrderLineRow {
  order_line_id: number;
  line_no: number;
  product_id?: number;
  sku: string;
  raw_description: string;
  quantity: number;
  base_unit_price_pen: number;
  unit_discount_pen: number;
  unit_price_pen: number;
  line_total_pen: number;
  unit_cost_snapshot_pen: number | null;
  fulfillment_mode: FulfillmentMode;
  fulfillment_status: LineFulfillmentStatus;
  below_min_price_flag?: boolean;
}

export interface RawOrderWithLines {
  order_id: number;
  order_code: string;
  order_date: string;
  customer_party_id?: number | null;
  customer_name: string;
  operational_status: OrderOperationalStatus;
  payment_mode: PaymentMode;
  promised_payment_date?: string | null;
  total_pen: number;
  paid_pen: number;
  balance_due_pen: number;
  is_settled?: boolean;
  notes?: string | null;
  created_by_name: string | null;
  created_at?: string | null;
  approved_by_name?: string | null;
  approved_at?: string | null;
  picked_by_name: string | null;
  picked_at?: string | null;
  delivered_by_name: string | null;
  delivered_at?: string | null;
  lines: RawOrderLineRow[];
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}
