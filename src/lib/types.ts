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
  exp?: number;
  sessionVersion?: string;
}

export class AuthenticationError extends Error {
  constructor(message = "Sesión inválida o expirada") {
    super(message);
    this.name = "AuthenticationError";
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

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export function resolveHttpError(
  err: unknown,
  fallbackMessage: string
): { status: number; error: string } {
  if (err instanceof AuthenticationError) {
    return { status: 401, error: err.message };
  }
  if (err instanceof AuthorizationError) {
    return { status: 403, error: err.message };
  }
  if (err instanceof ValidationError) {
    return { status: 400, error: err.message };
  }
  if (err instanceof ConflictError) {
    return { status: 409, error: err.message };
  }

  if (typeof err === "object" && err !== null && "code" in err) {
    const pgErr = err as { code?: unknown; constraint?: unknown; message?: unknown };
    const code = String(pgErr.code || "");
    const constraint = String(pgErr.constraint || "");
    if (code === "23505") {
      const constraintHints: Record<string, string> = {
        uq_parties_real_doc: "Ya existe un cliente o proveedor registrado con ese documento",
        uq_purchase_invoice_doc: "Ese comprobante de compra ya existe para este proveedor",
        products_sku_key: "Ya existe un producto con ese SKU",
        app_users_username_key: "Ese nombre de usuario ya está en uso",
        sales_orders_order_code_key: "El código de pedido ya existe; intente nuevamente",
        quotes_quote_code_key: "El código de cotización ya existe; intente nuevamente",
        route_trips_trip_code_key: "Ya existe una hoja de ruta con ese código",
        uq_audit_flags_open_dedup: "Ya existe una alerta abierta idéntica para ese registro",
      };
      return {
        status: 409,
        error:
          constraintHints[constraint] ??
          "Conflicto: ya existe un registro duplicado con esos datos",
      };
    }
    if (code === "23514" || code === "22P02" || code === "23503" || code === "23502") {
      const msg = typeof pgErr.message === "string" ? pgErr.message : "";
      if (msg && code === "23514" && msg.toLowerCase().includes("stock")) {
        return {
          status: 400,
          error: "Stock insuficiente o movimiento inválido para esta operación",
        };
      }
      return {
        status: 400,
        error: "Datos inválidos o fuera de las reglas permitidas por el sistema",
      };
    }
  }

  return {
    status: 500,
    error: err instanceof Error ? err.message : fallbackMessage,
  };
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
