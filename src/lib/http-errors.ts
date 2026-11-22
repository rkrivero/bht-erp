import crypto from "crypto";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  PasswordChangeRequiredError,
  ValidationError,
  type ApiErrorResponse,
} from "./types";

export type ResolvedHttpError = ApiErrorResponse & { status: number };

const UNIQUE_CONSTRAINT_HINTS: Record<string, string> = {
  uq_parties_real_doc: "Ya existe un cliente o proveedor registrado con ese documento",
  uq_purchase_invoice_doc: "Ese comprobante de compra ya existe para este proveedor",
  products_sku_key: "Ya existe un producto con ese SKU",
  app_users_username_key: "Ese nombre de usuario ya está en uso",
  sales_orders_order_code_key: "El código de pedido ya existe; intente nuevamente",
  quotes_quote_code_key: "El código de cotización ya existe; intente nuevamente",
  route_trips_trip_code_key: "Ya existe una hoja de ruta con ese código",
  uq_audit_flags_open_dedup: "Ya existe una alerta abierta idéntica para ese registro",
};

export function resolveHttpError(
  err: unknown,
  fallbackMessage: string,
  context = "api"
): ResolvedHttpError {
  if (err instanceof AuthenticationError) {
    return { status: 401, error: err.message };
  }
  if (err instanceof PasswordChangeRequiredError) {
    return { status: 428, error: err.message };
  }
  if (err instanceof AuthorizationError) {
    return { status: 403, error: err.message };
  }
  if (err instanceof ValidationError) {
    return { status: 400, error: err.message };
  }
  if (err instanceof ConflictError) {
    return {
      status: 409,
      error: err.message,
      code: err.code,
      entityRef: err.entityRef,
    };
  }

  if (typeof err === "object" && err !== null && "code" in err) {
    const pgErr = err as { code?: unknown; constraint?: unknown; message?: unknown };
    const code = String(pgErr.code || "");
    const constraint = String(pgErr.constraint || "");
    if (code === "23505") {
      return {
        status: 409,
        error:
          UNIQUE_CONSTRAINT_HINTS[constraint] ??
          "Conflicto: ya existe un registro duplicado con esos datos",
      };
    }
    if (code === "23514" || code === "22P02" || code === "23503" || code === "23502") {
      const message = typeof pgErr.message === "string" ? pgErr.message : "";
      if (code === "23514" && /periodo cerrado/i.test(message)) {
        return {
          status: 409,
          error:
            message ||
            "Periodo cerrado: no se permiten movimientos en una fecha con cierre diario cerrado",
          code: "CLOSED_PERIOD",
        };
      }
      if (code === "23514" && message.toLowerCase().includes("stock")) {
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

  const errorId = crypto.randomUUID();
  console.error(`[api-error:${errorId}] ${context}`, err);
  return { status: 500, error: fallbackMessage, errorId };
}
