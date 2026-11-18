import { ApiClientError, fetchJson, type ResponseValidator } from "@/lib/api-client";
import type { SyncScope } from "@/lib/realtime/useLiveSync";

export const SELLER_SYNC_SCOPES: SyncScope[] = [
  "orders",
  "inventory",
  "collections",
  "treasury",
];
export const SELLER_DRAFT_STORAGE_KEY = "bht_vendedor_order_draft_v1";
export const SELLER_DRAFT_ACTOR_STORAGE_KEY = "bht_vendedor_order_draft_actor_v1";
export const SELLER_LAST_ACTOR_STORAGE_KEY = "bht_vendedor_last_actor_v1";

export const CANCEL_DRAFT_REASONS = [
  { code: "PRICE_TOO_HIGH", label: "Precio alto o competencia" },
  { code: "NO_STOCK_OR_DELAY", label: "Sin stock o demora de entrega" },
  { code: "NO_LIQUIDITY", label: "Sin liquidez / crédito no aprobado" },
  { code: "CHANGED_MIND", label: "Cliente postergó o cambió de opinión" },
  { code: "ORDER_ERROR", label: "Error al armar el pedido" },
  { code: "OTHER", label: "Otro motivo" },
] as const;

export const ORDER_EDIT_REASONS = [
  { code: "CUSTOMER_INCREASED", label: "Aumentó el pedido" },
  { code: "ENTRY_ERROR", label: "Error al registrar" },
  { code: "PRODUCT_CHANGE", label: "Cambió productos" },
  { code: "PRODUCT_QUALITY", label: "Calidad del producto" },
  { code: "BETTER_PRICE_ELSEWHERE", label: "Consiguió otro precio" },
  { code: "CHANGED_MIND", label: "Cambio de opinión" },
  { code: "OTHER", label: "Otro" },
] as const;

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const FRACTIONAL_UOMS = new Set(["KGM", "MTR"]);

export function isFractionalUom(uom?: string | null): boolean {
  return FRACTIONAL_UOMS.has((uom || "NIU").trim().toUpperCase());
}

export function normalizeOrderQuantity(qty: number, fractional: boolean): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return fractional ? Math.round(qty * 1000) / 1000 : Math.floor(qty);
}

/** HTTP status carried by ApiClientError or by offline-outbox errors. */
export function errorStatus(error: unknown): number {
  if (error instanceof ApiClientError) return error.status;
  if (typeof error === "object" && error !== null && "status" in error) {
    return Number(error.status ?? 0);
  }
  return 0;
}

export function isAuthError(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 401 || status === 403;
}

export function postJson<T>(
  url: string,
  body: object,
  validate?: ResponseValidator<T>
): Promise<T> {
  return fetchJson<T>(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    validate
  );
}

/** Server-provided message for API failures; `fallback` for network errors. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}
