import { describe, expect, it } from "vitest";
import {
  canonicalPartnerUrl,
  canonicalSellerUrl,
  partnerUrlForLegacyTab,
  resolvePartnerNavigation,
  resolveSellerNavigation,
  sellerUrlForLegacyTab,
} from "@/lib/navigation";

describe("navigation aliases", () => {
  it.each([
    ["nuevo", "sell", "nuevo"],
    ["cotizaciones", "sales", "cotizaciones"],
    ["pedidos", "sales", "pedidos"],
    ["deudores", "collections", "deudores"],
    ["gastos", "more", "gastos"],
  ])("maps seller alias %s", (alias, section, legacyTab) => {
    const result = resolveSellerNavigation(new URLSearchParams({ tab: alias }));
    expect(result).toMatchObject({ section, legacyTab });
  });

  it.each([
    ["control", "today", "control"],
    ["pedidos", "sales", "pedidos"],
    ["deudores", "collections", "deudores"],
    ["stock", "inventory", "stock"],
    ["caja", "finance", "caja"],
    ["kpis", "finance", "kpis"],
  ])("maps partner alias %s", (alias, section, legacyTab) => {
    const result = resolvePartnerNavigation(new URLSearchParams({ tab: alias }));
    expect(result).toMatchObject({ section, legacyTab });
  });

  it("preserves unrelated seller filters while canonicalizing", () => {
    const source = new URL("https://erp.test/vendedor?tab=cotizaciones&status=OPEN");
    const result = canonicalSellerUrl(source);
    expect(result.searchParams.get("tab")).toBe("sales");
    expect(result.searchParams.get("view")).toBe("quotes");
    expect(result.searchParams.get("status")).toBe("OPEN");
  });

  it("preserves unrelated partner filters while canonicalizing", () => {
    const source = new URL("https://erp.test/socios?tab=kpis&period=month");
    const result = canonicalPartnerUrl(source);
    expect(result.searchParams.get("tab")).toBe("finance");
    expect(result.searchParams.get("view")).toBe("analytics");
    expect(result.searchParams.get("period")).toBe("month");
  });

  it("builds canonical URLs from the incumbent internal tabs", () => {
    const base = new URL("https://erp.test/socios?customer=42");
    expect(partnerUrlForLegacyTab(base, "control").searchParams.get("tab")).toBe(
      "today"
    );
    expect(sellerUrlForLegacyTab(base, "pedidos").searchParams.get("view")).toBe(
      "orders"
    );
  });

  it("resolves the partner access section", () => {
    const result = resolvePartnerNavigation(new URLSearchParams({ tab: "access" }));
    expect(result.legacyTab).toBe("accesos");
    expect(
      resolvePartnerNavigation(new URLSearchParams({ tab: "accesos" })).section
    ).toBe("access");
  });

  it("resolves the partner directory section", () => {
    const result = resolvePartnerNavigation(new URLSearchParams({ tab: "directory" }));
    expect(result.legacyTab).toBe("directorio");
    expect(
      resolvePartnerNavigation(new URLSearchParams({ tab: "directorio" })).section
    ).toBe("directory");
  });
});
