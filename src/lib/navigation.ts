export type SellerSection = "sell" | "sales" | "collections" | "more";
export type PartnerSection =
  "today" | "sales" | "collections" | "inventory" | "finance" | "access";

export type LegacySellerTab =
  "nuevo" | "cotizaciones" | "deudores" | "pedidos" | "gastos";
export type LegacyPartnerTab =
  "control" | "pedidos" | "deudores" | "stock" | "caja" | "kpis" | "accesos";

export type SellerSubView = "orders" | "quotes" | "expenses";
export type PartnerSubView = "operations" | "analytics";

const SELLER_SECTIONS = new Set<SellerSection>([
  "sell",
  "sales",
  "collections",
  "more",
]);
const PARTNER_SECTIONS = new Set<PartnerSection>([
  "today",
  "sales",
  "collections",
  "inventory",
  "finance",
  "access",
]);

const SELLER_ALIASES: Record<LegacySellerTab, SellerSection> = {
  nuevo: "sell",
  cotizaciones: "sales",
  pedidos: "sales",
  deudores: "collections",
  gastos: "more",
};

const PARTNER_ALIASES: Record<LegacyPartnerTab, PartnerSection> = {
  control: "today",
  pedidos: "sales",
  deudores: "collections",
  stock: "inventory",
  caja: "finance",
  kpis: "finance",
  accesos: "access",
};

export function resolveSellerNavigation(params: URLSearchParams): {
  section: SellerSection;
  legacyTab: LegacySellerTab;
  view?: SellerSubView;
} {
  const raw = params.get("tab") ?? "sell";
  const section = SELLER_SECTIONS.has(raw as SellerSection)
    ? (raw as SellerSection)
    : (SELLER_ALIASES[raw as LegacySellerTab] ?? "sell");

  if (section === "sales") {
    const view =
      params.get("view") === "quotes" || raw === "cotizaciones" ? "quotes" : "orders";
    return { section, legacyTab: view === "quotes" ? "cotizaciones" : "pedidos", view };
  }
  if (section === "collections") return { section, legacyTab: "deudores" };
  if (section === "more") return { section, legacyTab: "gastos", view: "expenses" };
  return { section: "sell", legacyTab: "nuevo" };
}

export function resolvePartnerNavigation(params: URLSearchParams): {
  section: PartnerSection;
  legacyTab: LegacyPartnerTab;
  view?: PartnerSubView;
} {
  const raw = params.get("tab") ?? "today";
  const section = PARTNER_SECTIONS.has(raw as PartnerSection)
    ? (raw as PartnerSection)
    : (PARTNER_ALIASES[raw as LegacyPartnerTab] ?? "today");

  if (section === "finance") {
    const view =
      params.get("view") === "analytics" || raw === "kpis" ? "analytics" : "operations";
    return { section, legacyTab: view === "analytics" ? "kpis" : "caja", view };
  }
  if (section === "sales") return { section, legacyTab: "pedidos" };
  if (section === "collections") return { section, legacyTab: "deudores" };
  if (section === "inventory") return { section, legacyTab: "stock" };
  if (section === "access") return { section, legacyTab: "accesos" };
  return { section: "today", legacyTab: "control" };
}

export function sellerUrlForLegacyTab(url: URL, tab: LegacySellerTab): URL {
  const next = new URL(url);
  const section = SELLER_ALIASES[tab];
  next.searchParams.set("tab", section);
  next.searchParams.delete("view");
  if (tab === "cotizaciones") next.searchParams.set("view", "quotes");
  if (tab === "pedidos") next.searchParams.set("view", "orders");
  if (tab === "gastos") next.searchParams.set("view", "expenses");
  return next;
}

export function partnerUrlForLegacyTab(url: URL, tab: LegacyPartnerTab): URL {
  const next = new URL(url);
  const section = PARTNER_ALIASES[tab];
  next.searchParams.set("tab", section);
  next.searchParams.delete("view");
  if (tab === "caja") next.searchParams.set("view", "operations");
  if (tab === "kpis") next.searchParams.set("view", "analytics");
  return next;
}

export function canonicalSellerUrl(url: URL): URL {
  return sellerUrlForLegacyTab(
    url,
    resolveSellerNavigation(url.searchParams).legacyTab
  );
}

export function canonicalPartnerUrl(url: URL): URL {
  return partnerUrlForLegacyTab(
    url,
    resolvePartnerNavigation(url.searchParams).legacyTab
  );
}
