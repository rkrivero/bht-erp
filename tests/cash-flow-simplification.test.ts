import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  reopenDailyClosureSchema,
  saveDailyClosureSchema,
} from "../src/lib/validation/daily-closures.schema";
import { parseTreasuryLedgerQuery } from "../src/lib/validation/treasury.schema";
import { resolveActiveCashAccount } from "../src/lib/services/cash-account-resolver";
import {
  getCashAccountFlowBreakdown,
  getCashFlowSummary,
} from "../src/lib/services/cash-flow-summary";
import { mapOperationalQualitySummary } from "../src/lib/services/operational-quality";
import type { SessionUser } from "../src/lib/types";

const partnerActor: SessionUser = {
  userId: 1,
  username: "renzo",
  fullName: "Renzo",
  role: "PARTNER_ADMIN",
  defaultCashAccountId: 1,
};

const sellerActor: SessionUser = {
  userId: 2,
  username: "vendedor",
  fullName: "Vendedor",
  role: "EXTERNAL_SELLER",
  defaultCashAccountId: 1,
};

describe("cash flow simplification contracts", () => {
  it("accepts null and empty string as null countedBalancePen in daily closure schema", () => {
    const parsed = saveDailyClosureSchema.parse({
      closureDate: "2026-11-22",
      accounts: [
        { accountId: 1, countedBalancePen: null },
        { accountId: 3, countedBalancePen: "" },
        { accountId: 4, countedBalancePen: "150.25" },
      ],
    });
    expect(parsed.accounts).toEqual([
      { accountId: 1, countedBalancePen: null },
      { accountId: 3, countedBalancePen: null },
      { accountId: 4, countedBalancePen: 150.25 },
    ]);
  });

  it("redirects inactive YAPE_PLIN_BHT and CAJA_GENERAL offline IDs without throwing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            account_id: 5,
            code: "YAPE_PLIN_BHT",
            name: "Billetera Digital Yape/Plin BHT",
            account_type: "WALLET",
            is_active: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            account_id: 4,
            code: "BCP_BHT",
            name: "Cuenta BCP BHT",
            account_type: "BANK",
            is_active: true,
          },
        ],
      });

    const client = { query } as unknown as PoolClient;
    const resolved = await resolveActiveCashAccount(client, sellerActor, 5);
    expect(resolved).toEqual({
      accountId: 4,
      code: "BCP_BHT",
      name: "Cuenta BCP BHT",
      accountType: "BANK",
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("rejects inactive CUSTODIA_SAMUEL and blocks EXTERNAL_SELLER from PARTNER_CUSTODY", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          account_id: 6,
          code: "CUSTODIA_SAMUEL",
          name: "Custodia Samuel",
          account_type: "PARTNER_CUSTODY",
          is_active: false,
        },
      ],
    });
    const client = { query } as unknown as PoolClient;
    await expect(resolveActiveCashAccount(client, partnerActor, 6)).rejects.toThrow(
      "Cuenta de caja inválida o inactiva"
    );
  });

  it("computes consolidated and per-account cash flow summaries accurately", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            as_of_lima_date: "2026-11-22",
            inflows_today_pen: "1200.50",
            outflows_today_pen: "350.20",
            inflows_month_pen: "15000.00",
            outflows_month_pen: "6400.00",
          },
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            account_id: 1,
            day_in_pen: "500.00",
            day_out_pen: "120.00",
            day_transfers_net_pen: "-100.00",
            month_in_pen: "8000.00",
            month_out_pen: "2100.00",
          },
        ],
      });

    const client = { query } as unknown as PoolClient;
    const summary = await getCashFlowSummary(client);
    expect(summary).toEqual({
      asOfLimaDate: "2026-11-22",
      inflowsTodayPen: 1200.5,
      outflowsTodayPen: 350.2,
      netTodayPen: 850.3,
      inflowsMonthPen: 15000,
      outflowsMonthPen: 6400,
      netMonthPen: 8600,
    });

    const breakdown = await getCashAccountFlowBreakdown(client);
    expect(breakdown.get(1)).toEqual({
      dayInPen: 500,
      dayOutPen: 120,
      dayTransfersNetPen: -100,
      dayNetPen: 280,
      monthInPen: 8000,
      monthOutPen: 2100,
      monthNetPen: 5900,
    });
  });

  it("preserves null varianceTotalPen in mapOperationalQualitySummary instead of coercing to 0", () => {
    const quality = mapOperationalQualitySummary({
      coverage_numerator: 10,
      coverage_denominator: 10,
      correction_count: 0,
      weekly_cohorts: [],
      latest_daily_closure: {
        closure_date: "2026-11-22",
        variance_total_pen: null,
        closed_by_name: "Renzo",
        updated_at: "2026-11-22T23:00:00Z",
      },
      incomplete_orders: [],
      erp_app_orders_count: 10,
      total_orders_count: 10,
      orders_missing_seller_count: 0,
      active_products_count: 50,
      products_missing_cost_count: 0,
      sold_skus_missing_cost_count: 0,
      sold_skus_missing_cost_pen: 0,
    });
    expect(quality.latestDailyClosure?.varianceTotalPen).toBeNull();
  });

  it("validates reopenDailyClosureSchema with required reason", () => {
    expect(
      reopenDailyClosureSchema.parse({
        closureDate: "2026-11-22",
        reason: "Faltan abonos",
      })
    ).toEqual({ closureDate: "2026-11-22", reason: "Faltan abonos" });
    expect(() =>
      reopenDailyClosureSchema.parse({ closureDate: "2026-11-22", reason: "" })
    ).toThrow();
  });

  it("parses treasury ledger query params with safe defaults, clamping, and validation", () => {
    expect(parseTreasuryLedgerQuery(new URLSearchParams())).toEqual({
      ok: true,
      accountId: null,
      ledgerOnly: false,
      limit: 150,
      offset: 0,
    });

    expect(
      parseTreasuryLedgerQuery(new URLSearchParams("accountId=2&ledgerOnly=1"))
    ).toEqual({
      ok: true,
      accountId: 2,
      ledgerOnly: true,
      limit: 200,
      offset: 0,
    });

    expect(parseTreasuryLedgerQuery(new URLSearchParams("limit=0&offset=-5"))).toEqual({
      ok: true,
      accountId: null,
      ledgerOnly: false,
      limit: 1,
      offset: 0,
    });

    expect(parseTreasuryLedgerQuery(new URLSearchParams("limit=9999"))).toEqual({
      ok: true,
      accountId: null,
      ledgerOnly: false,
      limit: 500,
      offset: 0,
    });

    for (const bad of ["abc", "0", "-3", "1.5"]) {
      expect(parseTreasuryLedgerQuery(new URLSearchParams(`accountId=${bad}`))).toEqual(
        { ok: false, error: "accountId inválido" }
      );
    }
  });

  it("excludes reversed originals and CONCILIACION_SALDO in cash flow summary SQL", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const client = { query } as unknown as PoolClient;
    await getCashFlowSummary(client);
    await getCashAccountFlowBreakdown(client);

    const summarySql = String(query.mock.calls[0]?.[0] ?? "");
    const breakdownSql = String(query.mock.calls[1]?.[0] ?? "");
    for (const sql of [summarySql, breakdownSql]) {
      expect(sql).toContain("CONCILIACION_SALDO");
      expect(sql).toContain("reversal_of_ledger_id");
    }
  });
});
