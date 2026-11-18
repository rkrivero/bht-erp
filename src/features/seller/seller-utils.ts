import { ApiClientError, fetchJson, type ResponseValidator } from "@/lib/api-client";
import { normalizeZone } from "@/lib/geo";
import type { SyncScope } from "@/lib/realtime/useLiveSync";
import type { CustomerDirectoryItem } from "@/lib/services/customers";
import type { SellerCatalogItemDto, SellerCustomerDto } from "./types";

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

export function directoryItemToSellerCustomer(
  item: CustomerDirectoryItem
): SellerCustomerDto {
  return {
    party_id: item.party_id,
    name: item.display_name,
    legal_name: item.legal_name,
    trade_name: item.trade_name,
    doc_type: item.doc_type,
    doc_number: item.doc_number,
    is_generic_doc: item.is_generic_doc,
    phone: item.phone,
    email: item.email,
    address: item.address,
    city_zone: item.city_zone,
    notes: item.notes,
    geo_lat: item.geo_lat,
    geo_lng: item.geo_lng,
    has_orders: item.has_orders,
    aliases: item.aliases,
  };
}

/**
 * Filter customers matching all space-separated tokens across alias/trade_name,
 * legal_name, aliases, RUC/DNI, phone, and city_zone.
 */
export function filterSellerCustomers(
  customers: SellerCustomerDto[],
  query: string,
  limit = 8
): SellerCustomerDto[] {
  const q = normalizeSearchText(query);
  if (!q) return customers.slice(0, limit);
  const tokens = q.split(/\s+/).filter(Boolean);
  return customers
    .filter((c) => {
      const haystack = normalizeSearchText(
        [
          c.name,
          c.trade_name ?? "",
          c.legal_name ?? "",
          c.doc_number ?? "",
          c.phone ?? "",
          c.city_zone ?? "",
          ...(c.aliases ?? []),
        ].join(" ")
      );
      return tokens.every((tok) => haystack.includes(tok));
    })
    .slice(0, limit);
}

/**
 * Collect distinct customer zones ordered by frequency in the customer list.
 */
export function extractKnownZones(customers: SellerCustomerDto[]): string[] {
  const counts = new Map<string, number>();
  for (const c of customers) {
    const z = normalizeZone(c.city_zone);
    if (z) counts.set(z, (counts.get(z) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([zone]) => zone);
}

export interface NormalizedCatalogEntry {
  item: SellerCatalogItemDto;
  normName: string;
  normSku: string;
  searchText: string;
}

export function buildNormalizedCatalog(
  catalog: SellerCatalogItemDto[]
): NormalizedCatalogEntry[] {
  return catalog.map((item) => ({
    item,
    normName: normalizeSearchText(item.name),
    normSku: normalizeSearchText(item.sku),
    searchText: normalizeSearchText(`${item.name} ${item.sku}`),
  }));
}

export function filterCatalogProducts(
  catalog: SellerCatalogItemDto[],
  normalizedCatalog: NormalizedCatalogEntry[],
  searchProduct: string
): SellerCatalogItemDto[] {
  const query = normalizeSearchText(searchProduct);
  if (!query) {
    return [...catalog].sort((a, b) => {
      const aInStock = a.stock_on_hand > 0 ? 0 : 1;
      const bInStock = b.stock_on_hand > 0 ? 0 : 1;
      if (aInStock !== bInStock) return aInStock - bInStock;
      return a.name.localeCompare(b.name, "es");
    });
  }
  const tokens = query.split(/\s+/).filter(Boolean);
  const scored: Array<{ item: SellerCatalogItemDto; score: number }> = [];
  for (const entry of normalizedCatalog) {
    if (!tokens.every((tok) => entry.searchText.includes(tok))) continue;
    let score = 0;
    if (entry.normSku === query) score += 100;
    else if (entry.normSku.startsWith(query)) score += 60;
    if (entry.normName.startsWith(query)) score += 50;
    else if (entry.normName.includes(query)) score += 25;
    if (entry.item.stock_on_hand > 0) score += 15;
    scored.push({ item: entry.item, score });
  }
  scored.sort(
    (a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, "es")
  );
  return scored.map((s) => s.item);
}
