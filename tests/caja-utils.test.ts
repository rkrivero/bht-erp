import { describe, expect, it } from "vitest";
import {
  calculatePurchaseTotals,
  formatAccountTypeEs,
  formatExpenseBucketEs,
  isExpenseLedgerEntry,
  type PurchaseLineDraft,
} from "../src/components/socios/caja/caja-utils";
import type { CashLedgerEntry } from "../src/components/socios/types";

describe("caja utilities & purchase totals", () => {
  const sampleItems: PurchaseLineDraft[] = [
    { key: "1", productId: 10, search: "", quantity: "2", unitCostPen: "50" },
    { key: "2", productId: 11, search: "", quantity: "1", unitCostPen: "18" },
  ];

  it("calculates PEN purchase totals for NONE, INCLUDED, and EXCLUDED IGV", () => {
    expect(calculatePurchaseTotals(sampleItems, "PEN", 1, "NONE")).toEqual({
      origBase: 118,
      subtotalPen: 118,
      igvPen: 0,
      totalPen: 118,
      origTotal: 118,
    });

    expect(calculatePurchaseTotals(sampleItems, "PEN", 1, "INCLUDED")).toEqual({
      origBase: 118,
      subtotalPen: 100,
      igvPen: 18,
      totalPen: 118,
      origTotal: 118,
    });

    const excludedItems: PurchaseLineDraft[] = [
      { key: "1", productId: 10, search: "", quantity: "2", unitCostPen: "50" },
    ];
    expect(calculatePurchaseTotals(excludedItems, "PEN", 1, "EXCLUDED")).toEqual({
      origBase: 100,
      subtotalPen: 100,
      igvPen: 18,
      totalPen: 118,
      origTotal: 118,
    });
  });

  it("applies exchange rate cleanly for USD purchases", () => {
    const usdItems: PurchaseLineDraft[] = [
      { key: "1", productId: 10, search: "", quantity: "2", unitCostPen: "50" },
    ];
    expect(calculatePurchaseTotals(usdItems, "USD", 3.75, "NONE")).toEqual({
      origBase: 100,
      subtotalPen: 375,
      igvPen: 0,
      totalPen: 375,
      origTotal: 100,
    });
  });

  it("filters expense entries and formats buckets/accounts in Spanish", () => {
    const makeEntry = (overrides: Partial<CashLedgerEntry>): CashLedgerEntry => ({
      ledger_id: 1,
      tx_date: "2026-11-18",
      account_name: "Caja Ruta",
      direction: "OUT",
      amount_pen: 50,
      expense_bucket: "ROUTE_OPEX",
      expense_category: "COMBUSTIBLE",
      is_internal_transfer: false,
      description: "Test",
      ...overrides,
    });

    expect(isExpenseLedgerEntry(makeEntry({}))).toBe(true);
    expect(
      isExpenseLedgerEntry(makeEntry({ expense_bucket: "NON_OPEX_OR_CAPEX" }))
    ).toBe(true);
    expect(isExpenseLedgerEntry(makeEntry({ direction: "IN" }))).toBe(false);
    expect(isExpenseLedgerEntry(makeEntry({ is_internal_transfer: true }))).toBe(false);
    expect(
      isExpenseLedgerEntry(makeEntry({ expense_bucket: "MERCHANDISE_PAYMENT" }))
    ).toBe(false);

    expect(formatExpenseBucketEs(null, true)).toBe("Traslado interno");
    expect(formatExpenseBucketEs("ROUTE_OPEX", false)).toBe("Gasto operativo de ruta");
    expect(formatExpenseBucketEs("NON_OPEX_OR_CAPEX", false)).toBe(
      "Retiro / No operativo"
    );
    expect(formatAccountTypeEs("PARTNER_CUSTODY")).toBe("Custodia");
    expect(formatAccountTypeEs("BANK")).toBe("Banco");
    expect(formatAccountTypeEs("CASH")).toBe("Caja");
  });
});
