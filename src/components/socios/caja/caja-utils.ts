import type { CashAccountItem, CashLedgerEntry } from "../types";

export type CajaSubTab = "cuentas" | "cierre" | "compras" | "gastos";

export function formatNullablePen(
  value: number | null | undefined,
  emptyLabel = "Sin conteo"
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return emptyLabel;
  }
  return `S/ ${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function resolveYapePlinAccountId(
  accounts: CashAccountItem[],
  channel: "YAPE" | "PLIN"
): number | null {
  const targetCode = channel === "YAPE" ? "BCP_BHT" : "INTERBANK_BHT";
  const match = accounts.find(
    (acc) => acc.code === targetCode && acc.is_active !== false
  );
  return match ? Number(match.account_id) : null;
}

export interface PurchaseLineDraft {
  key: string;
  productId: number | "";
  search: string;
  quantity: string;
  unitCostPen: string;
}

export function getTodayLimaIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
  }).format(new Date());
}

export function calculatePurchaseTotals(
  items: PurchaseLineDraft[],
  currency: "PEN" | "USD",
  exchangeRate: number,
  taxMode: "NONE" | "INCLUDED" | "EXCLUDED"
): {
  origBase: number;
  subtotalPen: number;
  igvPen: number;
  totalPen: number;
  origTotal: number;
} {
  const origBase = items.reduce((sum, item) => {
    const qty = Number(item.quantity || 0);
    const cost = Number(item.unitCostPen || 0);
    if (!Number.isFinite(qty) || !Number.isFinite(cost)) return sum;
    return sum + Math.max(0, qty) * Math.max(0, cost);
  }, 0);

  const effectiveRate = currency === "USD" ? (exchangeRate > 0 ? exchangeRate : 0) : 1;
  const rawNetPen = Number((origBase * effectiveRate).toFixed(2));

  if (taxMode === "INCLUDED") {
    const tot = rawNetPen;
    const sub = Number((tot / 1.18).toFixed(2));
    const igv = Number((tot - sub).toFixed(2));
    return {
      origBase,
      subtotalPen: sub,
      igvPen: igv,
      totalPen: tot,
      origTotal: Number(origBase.toFixed(2)),
    };
  }

  if (taxMode === "EXCLUDED") {
    const sub = rawNetPen;
    const igv = Number((sub * 0.18).toFixed(2));
    const tot = Number((sub + igv).toFixed(2));
    return {
      origBase,
      subtotalPen: sub,
      igvPen: igv,
      totalPen: tot,
      origTotal: Number((origBase * 1.18).toFixed(2)),
    };
  }

  return {
    origBase,
    subtotalPen: rawNetPen,
    igvPen: 0,
    totalPen: rawNetPen,
    origTotal: Number(origBase.toFixed(2)),
  };
}

export function formatExpenseBucketEs(
  bucket?: string | null,
  isTransfer?: boolean
): string {
  if (isTransfer) return "Traslado interno";
  if (bucket === "ROUTE_OPEX") return "Gasto operativo de ruta";
  if (bucket === "ADMIN_OPEX") return "Gasto fijo / administrativo";
  if (bucket === "MERCHANDISE_PAYMENT") return "Pago de mercadería";
  if (bucket === "NON_OPEX_OR_CAPEX") return "Retiro / No operativo";
  return "Movimiento de caja";
}

export function formatAccountTypeEs(accountType?: string | null): string {
  if (accountType === "PARTNER_CUSTODY") return "Custodia";
  if (accountType === "BANK") return "Banco";
  if (accountType === "CASH" || accountType === "CASH_BOX") return "Caja";
  if (accountType === "WALLET") return "Billetera";
  return accountType || "Cuenta";
}

export function isExpenseLedgerEntry(entry: CashLedgerEntry): boolean {
  return (
    entry.direction === "OUT" &&
    !entry.is_internal_transfer &&
    (entry.expense_bucket === "ROUTE_OPEX" ||
      entry.expense_bucket === "ADMIN_OPEX" ||
      entry.expense_bucket === "NON_OPEX_OR_CAPEX")
  );
}
