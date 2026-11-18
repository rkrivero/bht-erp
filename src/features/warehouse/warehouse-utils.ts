import type { CurrentUserInfo } from "@/components/socios/types";
import type { WarehouseOrderDto } from "@/lib/contracts";
import type { CheckedLines, WarehouseStage } from "./types";

export function toWarehouseStage(
  status: WarehouseOrderDto["operational_status"]
): WarehouseStage {
  if (status === "DELIVERED") return "DELIVERED";
  if (status === "READY" || status === "IN_ROUTE") return "READY";
  return "PREPARING";
}

export function formatWarehouseRoleBadge(user: CurrentUserInfo | null): string {
  if (!user) return "Almacén y Reparto";
  const area =
    user.role === "PARTNER_ADMIN" ||
    user.role === "PARTNER_MANAGER" ||
    user.username === "almacen1"
      ? "Almacén"
      : "Almacén y Reparto";
  const cleanName = user.fullName?.trim();
  const isLegacySeed =
    cleanName === "Encargado de Almacén" || cleanName === "Chofer y Reparto";
  if (cleanName && !isLegacySeed) {
    return `${cleanName} · ${area}`;
  }
  return area;
}

export function isCheckedLines(value: unknown): value is CheckedLines {
  return typeof value === "object" && value !== null;
}
