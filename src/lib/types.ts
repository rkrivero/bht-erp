export type UserRole =
  "PARTNER_ADMIN" | "PARTNER_MANAGER" | "EXTERNAL_SELLER" | "WAREHOUSE_DELIVERY";

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
  "FULFILLED" | "PENDING_SUPPLIER_PURCHASE" | "CANCELLED";

export interface SessionUser {
  userId: number;
  username: string;
  fullName: string;
  role: UserRole;
  defaultCashAccountId: number | null;
  exp?: number;
  sessionVersion?: string;
  mustChangePassword?: boolean;
}

export class AuthenticationError extends Error {
  constructor(message = "Sesión inválida o expirada") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class PasswordChangeRequiredError extends Error {
  constructor(message = "Debes cambiar tu contraseña temporal antes de continuar") {
    super(message);
    this.name = "PasswordChangeRequiredError";
  }
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
  unit_of_measure?: string;
  quantity: number;
  base_unit_price_pen: number;
  unit_discount_pen: number;
  unit_price_pen: number;
  line_total_pen: number;
  unit_cost_snapshot_pen: number | null;
  fulfillment_mode: FulfillmentMode;
  fulfillment_status: LineFulfillmentStatus;
  pack_factor_applied?: number;
  below_min_price_flag?: boolean;
}

export interface RawOrderWithLines {
  order_id: number;
  order_code: string;
  order_date: string;
  trip_id?: number | null;
  trip_code?: string | null;
  quote_id?: number | null;
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
  created_by_user_id?: number | null;
  created_by_name: string | null;
  audit_history?: Array<{
    audit_id: number;
    action: string;
    actor_name: string | null;
    actor_role: string;
    reason: string;
    created_at: string;
  }>;
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

export class ConflictError extends Error {
  constructor(
    message: string,
    public readonly code = "CONFLICT",
    public readonly entityRef?: string
  ) {
    super(message);
    this.name = "ConflictError";
  }
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
  entityRef?: string;
  errorId?: string;
}

export function parsePositiveInt(value: unknown, label: string): number {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new ValidationError(`${label} debe ser un entero positivo`);
  }
  return num;
}

export function parsePositiveNumber(value: unknown, label: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new ValidationError(`${label} debe ser un número mayor a 0`);
  }
  return num;
}

export function parseNonNegativeNumber(value: unknown, label: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new ValidationError(`${label} no puede ser negativo`);
  }
  return num;
}
