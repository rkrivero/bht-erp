import { describe, expect, it } from "vitest";
import {
  REPORT_CSV_CARDS,
  REPORT_TAB_ITEMS,
  buildReportQueryString,
  computeMonthRange,
  computePeriodRange,
  formatArBucketEs,
  formatClosingStatusEs,
  formatDays,
  formatDeadStockStatusEs,
  formatMaturityBucketEs,
  formatPct,
} from "../src/components/socios/reportes/reportes-types";

describe("reportes-types pure helpers", () => {
  it("declares the 6 report sections and 7 CSV export cards", () => {
    expect(REPORT_TAB_ITEMS).toHaveLength(6);
    expect(REPORT_TAB_ITEMS.map((t) => t.id)).toEqual([
      "resumen",
      "comercial",
      "cartera",
      "caja_cxp",
      "stock",
      "auditoria",
    ]);
    expect(REPORT_CSV_CARDS).toHaveLength(7);
    expect(REPORT_CSV_CARDS.some((c) => c.id === "valorizacion_inventario_corte")).toBe(
      true
    );
    expect(REPORT_CSV_CARDS.some((c) => c.id === "aging_cxc_cxp_corte")).toBe(true);
  });

  it("computes deterministic period presets and month boundaries", () => {
    expect(computePeriodRange("ALL", "2026-09-29")).toEqual({ from: "", to: "" });
    expect(computePeriodRange("THIS_MONTH", "2026-09-29")).toEqual({
      from: "2026-09-01",
      to: "2026-09-29",
    });
    expect(computePeriodRange("LAST_30D", "2026-09-29")).toEqual({
      from: "2026-08-31",
      to: "2026-09-29",
    });
    expect(computePeriodRange("LAST_90D", "2026-09-29")).toEqual({
      from: "2026-07-02",
      to: "2026-09-29",
    });
    expect(computeMonthRange("2026-08-01")).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(computeMonthRange("2024-02-01")).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
  });

  it("builds URL query strings honoring includeZone and includeSeller options", () => {
    expect(
      buildReportQueryString({
        from: "2026-07-01",
        to: "2026-07-31",
        zone: "Laberinto",
        sellerId: "2",
      })
    ).toBe("from=2026-07-01&to=2026-07-31&zone=Laberinto&sellerId=2");

    expect(
      buildReportQueryString(
        {
          from: "2026-07-01",
          to: "2026-07-31",
          zone: "Laberinto",
          sellerId: "2",
        },
        { includeSeller: false, includeZone: true }
      )
    ).toBe("from=2026-07-01&to=2026-07-31&zone=Laberinto");
  });

  it("formats percentages, days, aging/maturity buckets, and closing statuses in Spanish", () => {
    expect(formatPct(24.36)).toBe("24.4%");
    expect(formatPct(null)).toBe("-");
    expect(formatDays(14.2)).toBe("14 d");
    expect(formatDays(null)).toBe("Sin rotación");
    expect(formatMaturityBucketEs("OVERDUE")).toBe("Vencidas");
    expect(formatMaturityBucketEs("DUE_0_7")).toBe("Vencen 0–7 d");
    expect(formatArBucketEs("GT_60")).toBe("> 60 días");
    expect(formatDeadStockStatusEs("DEAD_90D")).toBe("Stock muerto (≥90d)");
    expect(formatClosingStatusEs("READY")).toEqual({
      label: "Listo para Cierre",
      tone: "success",
    });
    expect(formatClosingStatusEs("BLOCKED").tone).toBe("danger");
  });
});
