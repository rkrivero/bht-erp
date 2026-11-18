import { ApiClientError, fetchJson } from "@/lib/api-client";
import type { SellerOrderDto } from "@/features/seller/types";
import type { SyncScope } from "@/lib/realtime/useLiveSync";
import type { LegacyPartnerTab } from "@/lib/navigation";

export type PartnerTab = LegacyPartnerTab;
export type MonitorStatusFilter = "ALL" | "PENDING" | "DELIVERED" | "CANCELLED";

export interface PartnerAbonoOrder {
  orderId: number;
  orderCode: string;
  customerName: string;
  totalPen: number;
  paidPen: number;
  balanceDuePen: number;
}

export interface PartnerFeedback {
  msg: string;
  isError?: boolean;
}

export type ShowFeedback = (msg: string, isError?: boolean) => void;

export type PurchaseTarget = {
  productId: number;
  quantity?: number;
  orderLineId?: number;
};

export type DebtDetailTarget =
  | {
      mode: "customer";
      customerKey: string;
      customerName: string;
      customerPartyId: number | null;
    }
  | { mode: "order"; orderId: number }
  | null;

export const SOCIOS_SYNC_SCOPES: SyncScope[] = [
  "orders",
  "inventory",
  "collections",
  "treasury",
  "purchases",
  "partners",
];

/** POSTs a JSON action and returns the parsed body; throws ApiClientError on failure. */
export function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Server-provided message for API errors, otherwise the network fallback. */
export function mutationErrorMessage(
  error: unknown,
  apiFallback: string,
  networkFallback: string
): string {
  return error instanceof ApiClientError
    ? error.message || apiFallback
    : networkFallback;
}

export function getMarginTone(
  marginPen: number,
  totalPen: number
): "danger" | "warning" | "success" {
  if (marginPen <= 0) return "danger";
  const pct = totalPen > 0 ? (marginPen / totalPen) * 100 : 0;
  if (pct < 20) return "warning";
  return "success";
}

export function getMarginTextClass(marginPen: number, totalPen: number): string {
  const tone = getMarginTone(marginPen, totalPen);
  if (tone === "danger") return "text-[#B91C1C]";
  if (tone === "warning") return "text-[#B45309]";
  return "text-[#15803D]";
}

export function formatActorName(rawName: unknown, fallback: string): string {
  const name = String(rawName ?? "").trim();
  if (!name) return fallback;
  if (/\bsocio\b/i.test(name) && /admin/i.test(name)) return "Ventas y Control";
  if (/\bsocio\b/i.test(name) && /gerente/i.test(name)) return "Gerencia";
  if (/vendedor/i.test(name) && /externo|ruta/i.test(name)) return "Vendedor";
  if (/^encargado de almac[eé]n$/i.test(name)) return "Almacén";
  if (/^(chofer|movilidad) y reparto$/i.test(name)) return "Almacén y Reparto";
  return name;
}

export function operationalStatusTone(
  status: unknown
): "neutral" | "brand" | "success" | "warning" | "danger" {
  const s = String(status ?? "");
  if (s === "DELIVERED") return "success";
  if (s === "READY" || s === "IN_ROUTE") return "brand";
  if (s === "PENDING_PARTNER_APPROVAL" || s === "REGISTERED" || s === "PICKING") {
    return "warning";
  }
  if (s === "CANCELLED") return "danger";
  return "neutral";
}

export function formatTraceabilitySummary(o: SellerOrderDto): string {
  const creator = formatActorName(o.created_by_name, "Histórico");
  const picker = formatActorName(o.picked_by_name, "");
  const driver = formatActorName(o.delivered_by_name, "");
  const steps = [`Tomó: ${creator}`];
  if (picker && picker !== "-") steps.push(`Preparó: ${picker}`);
  if (driver && driver !== "-") steps.push(`Entregó: ${driver}`);
  return steps.join(" · ");
}
