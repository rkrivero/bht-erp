import type { PoolClient } from "pg";
import { ValidationError } from "../types";

export const REPORT_SECTIONS = [
  "resumen",
  "caja_cxp",
  "cartera",
  "comercial",
  "stock",
  "auditoria",
] as const;

export type ReportSection = (typeof REPORT_SECTIONS)[number];

export interface ReportFilters {
  from?: string;
  to?: string;
  zone?: string;
  sellerId?: number | "UNASSIGNED";
}

export interface ReportFilterOptions {
  zones: string[];
  sellers: Array<{ user_id: number; full_name: string }>;
  months: string[];
}

export interface ReportMonthlyPnlRow {
  period_month: string;
  order_count: number;
  sales_total_pen: number;
  cost_covered_sales_pen: number;
  cost_coverage_pct: number | null;
  cogs_pen: number;
  gross_margin_pen: number;
  gross_margin_pct: number | null;
  route_opex_pen: number;
  route_opex_pct: number | null;
  operating_ebitda_pen: number;
  operating_ebitda_pct: number | null;
  cash_collected_pen: number;
  ar_pending_pen: number;
  merchandise_outflow_pen: number;
  non_opex_capex_drain_pen: number;
  internal_deposits_pen: number;
  pre_route_foundational_outflow_pen: number;
  net_cash_flow_pen: number;
}

export interface ReportResumenData {
  filterOptions: ReportFilterOptions;
  pnlMonthly: ReportMonthlyPnlRow[];
  totals: {
    orderCount: number;
    salesTotalPen: number;
    costCoveredSalesPen: number;
    costCoveragePct: number | null;
    cogsPen: number;
    grossMarginPen: number;
    grossMarginPct: number | null;
    routeOpexPen: number;
    routeOpexPct: number | null;
    operatingEbitdaPen: number;
    operatingEbitdaPct: number | null;
    cashCollectedPen: number;
    arPendingPen: number;
    merchandiseOutflowPen: number;
    nonOpexCapexDrainPen: number;
    internalDepositsPen: number;
    preRouteFoundationalOutflowPen: number;
    netCashFlowPen: number;
    nonOpexVsReinvestmentPct: number;
  };
  momComparison: {
    currentMonth: string;
    previousMonth: string;
    salesDeltaPct: number | null;
    grossMarginDeltaPts: number | null;
    ebitdaDeltaPct: number | null;
    netCashFlowDeltaPen: number;
  } | null;
  openDebtorsCount: number;
}

export interface ReportApMaturityBucket {
  bucket:
    "OVERDUE" | "DUE_0_7" | "DUE_8_15" | "DUE_16_30" | "DUE_31_PLUS" | "NO_DUE_DATE";
  docsCount: number;
  balanceDuePen: number;
}

export interface ReportApDocRow {
  ap_id: number;
  purchase_id: number | null;
  supplier_party_id: number | null;
  supplier_name: string;
  supplier_doc_number: string | null;
  doc_ref: string;
  obligation_type: string;
  issue_date: string;
  due_date: string | null;
  original_amount_pen: number;
  paid_amount_pen: number;
  balance_due_pen: number;
  status: string;
  days_to_due: number | null;
  maturity_bucket: ReportApMaturityBucket["bucket"];
}

export interface ReportCajaCxpData {
  filterOptions: ReportFilterOptions;
  cashAccounts: Array<{
    account_id: number;
    code: string;
    name: string;
    account_type: string;
    total_in_pen: number;
    total_out_pen: number;
    net_balance_pen: number;
    period_in_pen: number;
    period_out_pen: number;
  }>;
  liquiditySummary: {
    liquidCashPen: number;
    partnerCustodyPen: number;
    totalCashPen: number;
    totalOpenApPen: number;
    overdueApPen: number;
    due0To7Pen: number;
    due8To15Pen: number;
    due16To30Pen: number;
    due31PlusPen: number;
    noDueDateApPen: number;
    dueWithin30dPen: number;
    netLiquidityAfter30dApPen: number;
  };
  apMaturityBuckets: ReportApMaturityBucket[];
  upcomingApDocs: ReportApDocRow[];
  apBySupplier: Array<{
    supplier_party_id: number | null;
    supplier_name: string;
    open_docs_count: number;
    total_billed_pen: number;
    total_paid_pen: number;
    total_balance_due_pen: number;
  }>;
  periodCashMix: {
    inflowPen: number;
    merchandiseOutflowPen: number;
    routeOpexPen: number;
    nonOpexDrainPen: number;
    internalTransfersPen: number;
    preRouteOutflowPen: number;
  };
}

export interface ReportArBucket {
  bucket: "0_15" | "16_30" | "31_60" | "GT_60";
  ordersCount: number;
  balanceDuePen: number;
}

export interface ReportArDocRow {
  order_id: number;
  order_code: string;
  order_date: string;
  due_date: string | null;
  customer_party_id: number | null;
  customer_name: string;
  customer_phone: string | null;
  effective_zone: string;
  payment_mode: string;
  total_pen: number;
  paid_pen: number;
  balance_due_pen: number;
  days_overdue: number;
  ar_bucket: ReportArBucket["bucket"];
  promised_payment_date: string | null;
  promise_status: string;
  created_by_name: string | null;
}

export interface ReportCarteraData {
  filterOptions: ReportFilterOptions;
  summary: {
    totalReceivablePen: number;
    openOrdersCount: number;
    openCustomersCount: number;
    overdueGt30Pen: number;
    overdueGt60Pen: number;
    brokenPromisesCount: number;
    brokenPromisesPen: number;
    dsoDays: number | null;
    avgOpenAgeDays: number;
    referenceSalesPen: number;
    referenceWindowDays: number;
  };
  agingBuckets: ReportArBucket[];
  byZone: Array<{
    effective_zone: string;
    orders_count: number;
    customers_count: number;
    balance_due_pen: number;
    overdue_gt_30_pen: number;
    broken_promises_count: number;
  }>;
  byCustomer: Array<{
    customer_party_id: number | null;
    customer_name: string;
    customer_phone: string | null;
    effective_zone: string;
    orders_count: number;
    max_days_overdue: number;
    balance_due_pen: number;
    next_promise_date: string | null;
  }>;
  collectionSheet: ReportArDocRow[];
}

export interface ReportComercialData {
  filterOptions: ReportFilterOptions;
  byZone: Array<{
    effective_zone: string;
    orders_count: number;
    customers_count: number;
    sales_total_pen: number;
    cash_collected_pen: number;
    ar_pending_pen: number;
    cost_covered_sales_pen: number;
    known_cogs_pen: number;
    gross_margin_pen: number;
    gross_margin_pct: number | null;
  }>;
  bySeller: Array<{
    seller_user_id: number | null;
    seller_name: string;
    orders_count: number;
    sales_total_pen: number;
    cash_collected_pen: number;
    collection_rate_pct: number | null;
    ar_pending_pen: number;
    gross_margin_pen: number;
    gross_margin_pct: number | null;
    discount_total_pen: number;
  }>;
  topCustomers: Array<{
    customer_party_id: number | null;
    customer_name: string;
    effective_zone: string;
    orders_count: number;
    total_sold_pen: number;
    total_paid_pen: number;
    total_due_pen: number;
    gross_margin_pen: number;
  }>;
  routeProfitability: Array<{
    trip_id: number;
    trip_code: string;
    trip_date: string;
    zone_name: string;
    driver_name: string | null;
    status: string;
    order_count: number;
    sales_total_pen: number;
    cash_collected_pen: number;
    gross_margin_pen: number;
    gross_margin_pct: number | null;
    route_opex_pen: number;
    route_opex_pct: number | null;
    trip_net_contribution_pen: number;
    trip_net_contribution_pct: number | null;
    route_opex_above_8pct_alert: boolean;
  }>;
  discountAudit: {
    summary: {
      discountedLinesCount: number;
      belowMinLinesCount: number;
      totalDiscountPen: number;
      discountedSalesPen: number;
    };
    topLines: Array<{
      order_line_id: number;
      order_code: string;
      order_date: string;
      customer_name: string;
      seller_name: string | null;
      sku: string;
      raw_description: string;
      quantity: number;
      base_unit_price_pen: number;
      unit_price_pen: number;
      unit_discount_pen: number;
      discount_line_total_pen: number;
      below_min_price_flag: boolean;
    }>;
  };
  inactiveCustomers: Array<{
    customer_party_id: number;
    customer_name: string;
    effective_zone: string;
    phone: string | null;
    orders_count: number;
    total_sold_pen: number;
    total_due_pen: number;
    last_order_date: string;
    days_since_last_order: number;
    inactivity_tier: "GT_60D" | "46_60D" | "31_45D" | "ACTIVE";
  }>;
}

export interface ReportStockSkuRow {
  product_id: number;
  sku: string;
  product_name: string;
  category: string | null;
  fulfillment_mode: string;
  unit_of_measure: string;
  stock_on_hand: number;
  positive_stock_qty: number;
  ref_cost_pen: number | null;
  list_sale_price_pen: number | null;
  valuation_pen: number;
  units_sold_total: number;
  units_sold_90d: number;
  order_frequency_total: number;
  order_frequency_90d: number;
  last_sale_date: string | null;
  days_since_last_sale: number | null;
  daily_velocity_90d: number;
  days_of_coverage: number | null;
  revenue_total_pen: number;
  real_gross_margin_pct: number | null;
  dead_stock_status: string;
}

export interface ReportStockData {
  filterOptions: ReportFilterOptions;
  valuationSummary: {
    totalValuationPen: number;
    positiveStockSkuCount: number;
    negativeStockSkuCount: number;
    positiveStockMissingCostCount: number;
    deadStock90dCount: number;
    deadStock90dPen: number;
    slowStock60dCount: number;
    slowStock60dPen: number;
    lowCoverageCount: number;
    lowMarginSkuCount: number;
    missingCostSoldSkuCount: number;
  };
  fulfillmentMix: Array<{
    fulfillment_mode: string;
    sku_count: number;
    units_on_hand: number;
    valuation_pen: number;
    units_sold_total: number;
    revenue_total_pen: number;
  }>;
  deadAndSlowStock: ReportStockSkuRow[];
  replenishmentAlerts: ReportStockSkuRow[];
  onDemandCandidates: ReportStockSkuRow[];
  marginRiskSkus: Array<{
    product_id: number;
    sku: string;
    product_name: string;
    fulfillment_mode: string;
    total_units_sold: number;
    total_revenue_pen: number;
    ref_cost_pen: number | null;
    real_gross_margin_pen: number | null;
    real_gross_margin_pct: number | null;
    low_margin_below_20pct_alert: boolean;
    missing_cost_alert: boolean;
  }>;
  topSkus: Array<{
    product_id: number;
    sku: string;
    product_name: string;
    fulfillment_mode: string;
    stock_on_hand: number;
    days_of_coverage: number | null;
    total_units_sold: number;
    total_revenue_pen: number;
    known_cogs_pen: number;
    real_gross_margin_pen: number | null;
    real_gross_margin_pct: number | null;
    low_margin_below_20pct_alert: boolean;
    missing_cost_alert: boolean;
  }>;
}

export interface ReportClosingCheck {
  code: string;
  label: string;
  count: number;
  severity: "BLOCKING" | "WARNING" | "OK";
  detail: string;
}

export interface ReportAuditoriaData {
  filterOptions: ReportFilterOptions;
  closingReadiness: {
    status: "READY" | "ATTENTION" | "BLOCKED";
    checks: ReportClosingCheck[];
  };
  qualityGaps: Array<{
    metric_code: string;
    gap_count: number;
    impacted_amount_pen: number;
    recommended_action: string;
  }>;
  auditFlags: Array<{
    flag_id: number;
    flag_code: string;
    severity: string;
    entity_table: string;
    entity_id: string;
    message: string;
    status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
    source_origin: string;
    created_at: string;
    resolution_note: string | null;
  }>;
  auditFlagCounts: {
    open: number;
    acknowledged: number;
    resolved: number;
  };
}

export type ReportSectionPayloadMap = {
  resumen: ReportResumenData;
  caja_cxp: ReportCajaCxpData;
  cartera: ReportCarteraData;
  comercial: ReportComercialData;
  stock: ReportStockData;
  auditoria: ReportAuditoriaData;
};

export function isReportSection(value: string): value is ReportSection {
  return (REPORT_SECTIONS as readonly string[]).includes(value);
}

function parseIsoDateParam(raw: string | null, label: string): string | undefined {
  const value = (raw || "").trim();
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`Fecha '${label}' inválida (usa formato YYYY-MM-DD)`);
  }
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new ValidationError(`Fecha '${label}' fuera de calendario`);
  }
  return value;
}

export function parseReportFilters(params: URLSearchParams): ReportFilters {
  const from = parseIsoDateParam(params.get("from"), "desde");
  const to = parseIsoDateParam(params.get("to"), "hasta");
  if (from && to && from > to) {
    throw new ValidationError("La fecha 'desde' no puede ser posterior a 'hasta'");
  }

  const rawZone = (params.get("zone") || "").trim();
  if (rawZone.length > 80) {
    throw new ValidationError("El filtro de zona excede el máximo de 80 caracteres");
  }
  const zone = rawZone || undefined;

  const rawSeller = (params.get("sellerId") || "").trim();
  let sellerId: ReportFilters["sellerId"];
  if (rawSeller) {
    if (rawSeller === "UNASSIGNED") {
      sellerId = "UNASSIGNED";
    } else if (/^\d+$/.test(rawSeller) && Number(rawSeller) > 0) {
      const parsed = Number(rawSeller);
      if (!Number.isSafeInteger(parsed)) {
        throw new ValidationError("El identificador de vendedor es inválido");
      }
      sellerId = parsed;
    } else {
      throw new ValidationError("El identificador de vendedor es inválido");
    }
  }

  return { from, to, zone, sellerId };
}

const FILTER_OPTIONS_SELECT = `
  json_build_object(
    'zones', COALESCE((
      SELECT json_agg(z ORDER BY z ASC)
      FROM (
        SELECT DISTINCT COALESCE(NULLIF(BTRIM(pa.city_zone), ''), NULLIF(BTRIM(rt.zone_name), ''), 'Sin zona') AS z
        FROM erp.sales_orders so
        LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
        LEFT JOIN erp.route_trips rt ON rt.trip_id = so.trip_id
        WHERE so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
        UNION
        SELECT DISTINCT NULLIF(BTRIM(city_zone), '') AS z
        FROM erp.parties
        WHERE is_active = TRUE AND NULLIF(BTRIM(city_zone), '') IS NOT NULL
      ) zones_union
      WHERE z IS NOT NULL
    ), '[]'::json),
    'sellers', COALESCE((
      SELECT json_agg(s ORDER BY s.full_name ASC)
      FROM (
        SELECT DISTINCT u.user_id, u.full_name
        FROM erp.app_users u
        JOIN erp.sales_orders so ON so.created_by_user_id = u.user_id
        WHERE so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
        UNION
        SELECT u.user_id, u.full_name
        FROM erp.app_users u
        WHERE u.is_active = TRUE
          AND u.role IN ('PARTNER_ADMIN', 'PARTNER_MANAGER', 'EXTERNAL_SELLER')
      ) s
    ), '[]'::json),
    'months', COALESCE((
      SELECT json_agg(m.period_month ORDER BY m.period_month DESC)
      FROM (
        SELECT DISTINCT period_month::text AS period_month
        FROM analytics.v_report_monthly_pnl
      ) m
    ), '[]'::json)
  ) AS filter_options
`;

function toNum(value: unknown, fallback = 0): number {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function toOptNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapFilterOptions(raw: unknown): ReportFilterOptions {
  const obj = (raw && typeof raw === "object" ? raw : {}) as {
    zones?: unknown[];
    sellers?: Array<{ user_id: unknown; full_name: unknown }>;
    months?: unknown[];
  };
  return {
    zones: Array.isArray(obj.zones) ? obj.zones.map((z) => String(z)) : [],
    sellers: Array.isArray(obj.sellers)
      ? obj.sellers.map((s) => ({
          user_id: Number(s.user_id),
          full_name: String(s.full_name),
        }))
      : [],
    months: Array.isArray(obj.months) ? obj.months.map((m) => String(m)) : [],
  };
}

class FilterParamBuilder {
  readonly params: unknown[] = [];

  add(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  appendSalesFilters(
    filters: ReportFilters,
    alias = "so",
    options?: { includeZone?: boolean; includeSeller?: boolean }
  ): string[] {
    const clauses: string[] = [];
    if (filters.from) {
      clauses.push(`${alias}.order_date >= ${this.add(filters.from)}::date`);
    }
    if (filters.to) {
      clauses.push(`${alias}.order_date <= ${this.add(filters.to)}::date`);
    }
    if (options?.includeZone !== false && filters.zone) {
      clauses.push(
        `COALESCE(NULLIF(BTRIM(pa.city_zone), ''), NULLIF(BTRIM(rt.zone_name), ''), 'Sin zona') = ${this.add(filters.zone)}`
      );
    }
    if (options?.includeSeller !== false && filters.sellerId !== undefined) {
      if (filters.sellerId === "UNASSIGNED") {
        clauses.push(`${alias}.created_by_user_id IS NULL`);
      } else {
        clauses.push(`${alias}.created_by_user_id = ${this.add(filters.sellerId)}`);
      }
    }
    return clauses;
  }
}

async function queryResumen(
  client: PoolClient,
  filters: ReportFilters
): Promise<ReportResumenData> {
  const hasFilters = Boolean(
    filters.from || filters.to || filters.zone || filters.sellerId !== undefined
  );
  const pb = new FilterParamBuilder();

  let pnlSelectSql: string;
  let debtorsWhereSql = "1=1";

  if (!hasFilters) {
    pnlSelectSql = `
      SELECT
        period_month::text AS period_month,
        order_count,
        sales_total_pen,
        cost_covered_sales_pen,
        cost_coverage_pct,
        cogs_pen,
        gross_margin_pen,
        gross_margin_pct,
        route_opex_pen,
        route_opex_pct,
        operating_ebitda_pen,
        operating_ebitda_pct,
        cash_collected_pen,
        ar_pending_pen,
        merchandise_outflow_pen,
        non_opex_capex_drain_pen,
        internal_deposits_pen,
        pre_route_foundational_outflow_pen,
        net_cash_flow_pen
      FROM analytics.v_report_monthly_pnl
      ORDER BY period_month ASC
    `;
  } else {
    const salesClauses = [
      "so.order_date >= DATE '2026-06-26'",
      "so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')",
      ...pb.appendSalesFilters(filters, "so"),
    ];
    const cashClauses: string[] = ["cl.tx_date >= DATE '2026-06-26'"];
    const preRouteClauses: string[] = ["cl.tx_date < DATE '2026-06-26'"];
    if (filters.from) {
      const pFrom = pb.add(filters.from);
      cashClauses.push(`cl.tx_date >= ${pFrom}::date`);
      preRouteClauses.push(`cl.tx_date >= ${pFrom}::date`);
    }
    if (filters.to) {
      const pTo = pb.add(filters.to);
      cashClauses.push(`cl.tx_date <= ${pTo}::date`);
      preRouteClauses.push(`cl.tx_date <= ${pTo}::date`);
    }
    const excludeGlobalCashForScope = Boolean(
      filters.zone || filters.sellerId !== undefined
    );
    const includeRouteOpexByZone = Boolean(
      filters.zone && filters.sellerId === undefined
    );
    const routeOpexZoneOnlyJoin = includeRouteOpexByZone
      ? "LEFT JOIN erp.route_trips rt_cl ON rt_cl.trip_id = cl.trip_id"
      : "";
    const routeOpexZoneOnlyWhere = includeRouteOpexByZone
      ? ` AND COALESCE(NULLIF(BTRIM(rt_cl.zone_name), ''), 'Sin zona') = ${pb.add(filters.zone)}`
      : "";

    const debtorClauses: string[] = [];
    if (filters.from)
      debtorClauses.push(`d.order_date >= ${pb.add(filters.from)}::date`);
    if (filters.to) debtorClauses.push(`d.order_date <= ${pb.add(filters.to)}::date`);
    if (filters.zone) debtorClauses.push(`d.effective_zone = ${pb.add(filters.zone)}`);
    if (filters.sellerId === "UNASSIGNED") {
      debtorClauses.push("d.created_by_user_id IS NULL");
    } else if (filters.sellerId !== undefined) {
      debtorClauses.push(`d.created_by_user_id = ${pb.add(filters.sellerId)}`);
    }
    if (debtorClauses.length > 0) {
      debtorsWhereSql = debtorClauses.join(" AND ");
    }

    pnlSelectSql = `
      WITH filtered_orders AS (
        SELECT so.order_id, so.order_date, so.total_pen, so.paid_pen, so.balance_due_pen
        FROM erp.sales_orders so
        LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
        LEFT JOIN erp.route_trips rt ON rt.trip_id = so.trip_id
        WHERE ${salesClauses.join(" AND ")}
      ),
      monthly_sales AS (
        SELECT
          DATE_TRUNC('month', order_date)::DATE AS period_month,
          COUNT(*)::int AS order_count,
          COALESCE(SUM(total_pen), 0)::NUMERIC(14,2) AS sales_total_pen,
          COALESCE(SUM(paid_pen), 0)::NUMERIC(14,2) AS cash_collected_pen,
          COALESCE(SUM(balance_due_pen), 0)::NUMERIC(14,2) AS ar_pending_pen
        FROM filtered_orders
        GROUP BY DATE_TRUNC('month', order_date)::DATE
      ),
      monthly_cogs AS (
        SELECT
          DATE_TRUNC('month', fo.order_date)::DATE AS period_month,
          COALESCE(SUM(sol.line_total_pen) FILTER (WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL), 0)::NUMERIC(14,2) AS cost_covered_sales_pen,
          COALESCE(SUM((sol.quantity * sol.pack_factor_applied) * COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen)) FILTER (WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL), 0)::NUMERIC(14,2) AS cogs_pen
        FROM erp.sales_order_lines sol
        JOIN filtered_orders fo ON fo.order_id = sol.order_id
        JOIN erp.products p ON p.product_id = sol.product_id
        GROUP BY DATE_TRUNC('month', fo.order_date)::DATE
      ),
      monthly_cash AS (
        ${
          excludeGlobalCashForScope
            ? `
          SELECT
            DATE_TRUNC('month', cl.tx_date)::DATE AS period_month,
            0::NUMERIC(14,2) AS merchandise_outflow_pen,
            ${
              filters.sellerId !== undefined
                ? "0::NUMERIC(14,2)"
                : `COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'ROUTE_OPEX'${routeOpexZoneOnlyWhere}), 0)::NUMERIC(14,2)`
            } AS route_opex_pen,
            0::NUMERIC(14,2) AS non_opex_capex_drain_pen,
            0::NUMERIC(14,2) AS internal_deposits_pen
          FROM erp.cash_ledger cl
          ${routeOpexZoneOnlyJoin}
          WHERE ${cashClauses.join(" AND ")}
          GROUP BY DATE_TRUNC('month', cl.tx_date)::DATE
        `
            : `
          SELECT
            DATE_TRUNC('month', cl.tx_date)::DATE AS period_month,
            COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'MERCHANDISE_PAYMENT'), 0)::NUMERIC(14,2) AS merchandise_outflow_pen,
            COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'ROUTE_OPEX'), 0)::NUMERIC(14,2) AS route_opex_pen,
            COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'NON_OPEX_OR_CAPEX'), 0)::NUMERIC(14,2) AS non_opex_capex_drain_pen,
            COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.is_internal_transfer AND cl.direction = 'OUT'), 0)::NUMERIC(14,2) AS internal_deposits_pen
          FROM erp.cash_ledger cl
          WHERE ${cashClauses.join(" AND ")}
          GROUP BY DATE_TRUNC('month', cl.tx_date)::DATE
        `
        }
      ),
      pre_route AS (
        ${
          excludeGlobalCashForScope
            ? "SELECT NULL::DATE AS period_month, 0::NUMERIC(14,2) AS pre_route_foundational_outflow_pen WHERE FALSE"
            : `
          SELECT
            DATE_TRUNC('month', cl.tx_date)::DATE AS period_month,
            COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer), 0)::NUMERIC(14,2) AS pre_route_foundational_outflow_pen
          FROM erp.cash_ledger cl
          WHERE ${preRouteClauses.join(" AND ")}
          GROUP BY DATE_TRUNC('month', cl.tx_date)::DATE
        `
        }
      ),
      all_months AS (
        SELECT period_month FROM monthly_sales
        UNION
        SELECT period_month FROM pre_route
        ${
          excludeGlobalCashForScope ? "" : "UNION SELECT period_month FROM monthly_cash"
        }
      ),
      joined AS (
        SELECT
          m.period_month,
          COALESCE(ms.order_count, 0)::int AS order_count,
          COALESCE(ms.sales_total_pen, 0)::NUMERIC(14,2) AS sales_total_pen,
          COALESCE(mcog.cost_covered_sales_pen, 0)::NUMERIC(14,2) AS cost_covered_sales_pen,
          COALESCE(mcog.cogs_pen, 0)::NUMERIC(14,2) AS cogs_pen,
          (COALESCE(mcog.cost_covered_sales_pen, 0) - COALESCE(mcog.cogs_pen, 0))::NUMERIC(14,2) AS gross_margin_pen,
          COALESCE(mc.route_opex_pen, 0)::NUMERIC(14,2) AS route_opex_pen,
          COALESCE(ms.cash_collected_pen, 0)::NUMERIC(14,2) AS cash_collected_pen,
          COALESCE(ms.ar_pending_pen, 0)::NUMERIC(14,2) AS ar_pending_pen,
          COALESCE(mc.merchandise_outflow_pen, 0)::NUMERIC(14,2) AS merchandise_outflow_pen,
          COALESCE(mc.non_opex_capex_drain_pen, 0)::NUMERIC(14,2) AS non_opex_capex_drain_pen,
          COALESCE(mc.internal_deposits_pen, 0)::NUMERIC(14,2) AS internal_deposits_pen,
          COALESCE(pr.pre_route_foundational_outflow_pen, 0)::NUMERIC(14,2) AS pre_route_foundational_outflow_pen
        FROM all_months m
        LEFT JOIN monthly_sales ms ON ms.period_month = m.period_month
        LEFT JOIN monthly_cogs mcog ON mcog.period_month = m.period_month
        LEFT JOIN monthly_cash mc ON mc.period_month = m.period_month
        LEFT JOIN pre_route pr ON pr.period_month = m.period_month
      )
      SELECT
        j.period_month::text AS period_month,
        j.order_count,
        j.sales_total_pen,
        j.cost_covered_sales_pen,
        ROUND(j.cost_covered_sales_pen * 100.0 / NULLIF(j.sales_total_pen, 0), 2) AS cost_coverage_pct,
        j.cogs_pen,
        j.gross_margin_pen,
        ROUND(j.gross_margin_pen * 100.0 / NULLIF(j.cost_covered_sales_pen, 0), 2) AS gross_margin_pct,
        j.route_opex_pen,
        ROUND(j.route_opex_pen * 100.0 / NULLIF(j.sales_total_pen, 0), 2) AS route_opex_pct,
        (j.gross_margin_pen - j.route_opex_pen)::NUMERIC(14,2) AS operating_ebitda_pen,
        ROUND((j.gross_margin_pen - j.route_opex_pen) * 100.0 / NULLIF(j.cost_covered_sales_pen, 0), 2) AS operating_ebitda_pct,
        j.cash_collected_pen,
        j.ar_pending_pen,
        j.merchandise_outflow_pen,
        j.non_opex_capex_drain_pen,
        j.internal_deposits_pen,
        j.pre_route_foundational_outflow_pen,
        (j.cash_collected_pen - j.merchandise_outflow_pen - j.route_opex_pen - j.non_opex_capex_drain_pen)::NUMERIC(14,2) AS net_cash_flow_pen
      FROM joined j
      ORDER BY j.period_month ASC
    `;
  }

  const res = await client.query<{
    filter_options: unknown;
    pnl_monthly: Array<Record<string, unknown>>;
    open_debtors_count: number;
  }>(
    `SELECT
       ${FILTER_OPTIONS_SELECT},
       COALESCE((SELECT json_agg(t) FROM (${pnlSelectSql}) t), '[]'::json) AS pnl_monthly,
       COALESCE((
         SELECT COUNT(*)::int
         FROM analytics.v_report_ar_aging_detail d
         WHERE ${debtorsWhereSql}
       ), 0) AS open_debtors_count`,
    pb.params
  );

  const row = res.rows[0];
  const pnlMonthly: ReportMonthlyPnlRow[] = (row?.pnl_monthly ?? []).map((r) => ({
    period_month: String(r.period_month),
    order_count: toNum(r.order_count),
    sales_total_pen: toNum(r.sales_total_pen),
    cost_covered_sales_pen: toNum(r.cost_covered_sales_pen),
    cost_coverage_pct: toOptNum(r.cost_coverage_pct),
    cogs_pen: toNum(r.cogs_pen),
    gross_margin_pen: toNum(r.gross_margin_pen),
    gross_margin_pct: toOptNum(r.gross_margin_pct),
    route_opex_pen: toNum(r.route_opex_pen),
    route_opex_pct: toOptNum(r.route_opex_pct),
    operating_ebitda_pen: toNum(r.operating_ebitda_pen),
    operating_ebitda_pct: toOptNum(r.operating_ebitda_pct),
    cash_collected_pen: toNum(r.cash_collected_pen),
    ar_pending_pen: toNum(r.ar_pending_pen),
    merchandise_outflow_pen: toNum(r.merchandise_outflow_pen),
    non_opex_capex_drain_pen: toNum(r.non_opex_capex_drain_pen),
    internal_deposits_pen: toNum(r.internal_deposits_pen),
    pre_route_foundational_outflow_pen: toNum(r.pre_route_foundational_outflow_pen),
    net_cash_flow_pen: toNum(r.net_cash_flow_pen),
  }));

  const acc = pnlMonthly.reduce(
    (s, r) => ({
      orderCount: s.orderCount + r.order_count,
      salesTotalPen: s.salesTotalPen + r.sales_total_pen,
      costCoveredSalesPen: s.costCoveredSalesPen + r.cost_covered_sales_pen,
      cogsPen: s.cogsPen + r.cogs_pen,
      grossMarginPen: s.grossMarginPen + r.gross_margin_pen,
      routeOpexPen: s.routeOpexPen + r.route_opex_pen,
      operatingEbitdaPen: s.operatingEbitdaPen + r.operating_ebitda_pen,
      cashCollectedPen: s.cashCollectedPen + r.cash_collected_pen,
      arPendingPen: s.arPendingPen + r.ar_pending_pen,
      merchandiseOutflowPen: s.merchandiseOutflowPen + r.merchandise_outflow_pen,
      nonOpexCapexDrainPen: s.nonOpexCapexDrainPen + r.non_opex_capex_drain_pen,
      internalDepositsPen: s.internalDepositsPen + r.internal_deposits_pen,
      preRouteFoundationalOutflowPen:
        s.preRouteFoundationalOutflowPen + r.pre_route_foundational_outflow_pen,
      netCashFlowPen: s.netCashFlowPen + r.net_cash_flow_pen,
    }),
    {
      orderCount: 0,
      salesTotalPen: 0,
      costCoveredSalesPen: 0,
      cogsPen: 0,
      grossMarginPen: 0,
      routeOpexPen: 0,
      operatingEbitdaPen: 0,
      cashCollectedPen: 0,
      arPendingPen: 0,
      merchandiseOutflowPen: 0,
      nonOpexCapexDrainPen: 0,
      internalDepositsPen: 0,
      preRouteFoundationalOutflowPen: 0,
      netCashFlowPen: 0,
    }
  );

  const round2 = (v: number) => Number(v.toFixed(2));
  const totals: ReportResumenData["totals"] = {
    orderCount: acc.orderCount,
    salesTotalPen: round2(acc.salesTotalPen),
    costCoveredSalesPen: round2(acc.costCoveredSalesPen),
    costCoveragePct:
      acc.salesTotalPen > 0
        ? round2((acc.costCoveredSalesPen * 100) / acc.salesTotalPen)
        : null,
    cogsPen: round2(acc.cogsPen),
    grossMarginPen: round2(acc.grossMarginPen),
    grossMarginPct:
      acc.costCoveredSalesPen > 0
        ? round2((acc.grossMarginPen * 100) / acc.costCoveredSalesPen)
        : null,
    routeOpexPen: round2(acc.routeOpexPen),
    routeOpexPct:
      acc.salesTotalPen > 0
        ? round2((acc.routeOpexPen * 100) / acc.salesTotalPen)
        : null,
    operatingEbitdaPen: round2(acc.operatingEbitdaPen),
    operatingEbitdaPct:
      acc.costCoveredSalesPen > 0
        ? round2((acc.operatingEbitdaPen * 100) / acc.costCoveredSalesPen)
        : null,
    cashCollectedPen: round2(acc.cashCollectedPen),
    arPendingPen: round2(acc.arPendingPen),
    merchandiseOutflowPen: round2(acc.merchandiseOutflowPen),
    nonOpexCapexDrainPen: round2(acc.nonOpexCapexDrainPen),
    internalDepositsPen: round2(acc.internalDepositsPen),
    preRouteFoundationalOutflowPen: round2(acc.preRouteFoundationalOutflowPen),
    netCashFlowPen: round2(acc.netCashFlowPen),
    nonOpexVsReinvestmentPct:
      acc.merchandiseOutflowPen + acc.nonOpexCapexDrainPen > 0
        ? round2(
            (acc.nonOpexCapexDrainPen * 100) /
              (acc.merchandiseOutflowPen + acc.nonOpexCapexDrainPen)
          )
        : 0,
  };

  let momComparison: ReportResumenData["momComparison"] = null;
  const activeMonths = pnlMonthly.filter(
    (m) => m.order_count > 0 || m.sales_total_pen > 0
  );
  if (activeMonths.length >= 2) {
    const prev = activeMonths[activeMonths.length - 2];
    const curr = activeMonths[activeMonths.length - 1];
    momComparison = {
      currentMonth: curr.period_month,
      previousMonth: prev.period_month,
      salesDeltaPct:
        prev.sales_total_pen > 0
          ? round2(
              ((curr.sales_total_pen - prev.sales_total_pen) * 100) /
                prev.sales_total_pen
            )
          : null,
      grossMarginDeltaPts:
        curr.gross_margin_pct !== null && prev.gross_margin_pct !== null
          ? round2(curr.gross_margin_pct - prev.gross_margin_pct)
          : null,
      ebitdaDeltaPct:
        Math.abs(prev.operating_ebitda_pen) > 0
          ? round2(
              ((curr.operating_ebitda_pen - prev.operating_ebitda_pen) * 100) /
                Math.abs(prev.operating_ebitda_pen)
            )
          : null,
      netCashFlowDeltaPen: round2(curr.net_cash_flow_pen - prev.net_cash_flow_pen),
    };
  }

  return {
    filterOptions: mapFilterOptions(row?.filter_options),
    pnlMonthly,
    totals,
    momComparison,
    openDebtorsCount: Number(row?.open_debtors_count ?? 0),
  };
}

const AP_BUCKET_ORDER: ReportApMaturityBucket["bucket"][] = [
  "OVERDUE",
  "DUE_0_7",
  "DUE_8_15",
  "DUE_16_30",
  "DUE_31_PLUS",
  "NO_DUE_DATE",
];

async function queryCajaCxp(
  client: PoolClient,
  filters: ReportFilters
): Promise<ReportCajaCxpData> {
  const pb = new FilterParamBuilder();
  const ledgerPeriodClauses: string[] = [];
  if (filters.from) {
    ledgerPeriodClauses.push(`cl.tx_date >= ${pb.add(filters.from)}::date`);
  }
  if (filters.to) {
    ledgerPeriodClauses.push(`cl.tx_date <= ${pb.add(filters.to)}::date`);
  }
  const periodCond =
    ledgerPeriodClauses.length > 0 ? ledgerPeriodClauses.join(" AND ") : "TRUE";

  const res = await client.query<{
    filter_options: unknown;
    cash_accounts: Array<Record<string, unknown>>;
    ap_buckets: Array<Record<string, unknown>>;
    ap_docs: Array<Record<string, unknown>>;
    ap_suppliers: Array<Record<string, unknown>>;
    period_cash_mix: Record<string, unknown>;
  }>(
    `SELECT
       ${FILTER_OPTIONS_SELECT},
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             ca.account_id,
             ca.code,
             ca.name,
             ca.account_type,
             COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'IN'), 0)::numeric(14,2) AS total_in_pen,
             COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT'), 0)::numeric(14,2) AS total_out_pen,
             COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'IN' AND (${periodCond})), 0)::numeric(14,2) AS period_in_pen,
             COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND (${periodCond})), 0)::numeric(14,2) AS period_out_pen
           FROM erp.cash_accounts ca
           LEFT JOIN erp.cash_ledger cl ON cl.account_id = ca.account_id
           WHERE ca.is_active = TRUE
           GROUP BY ca.account_id, ca.code, ca.name, ca.account_type
           ORDER BY ca.account_id ASC
         ) t
       ), '[]'::json) AS cash_accounts,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             maturity_bucket,
             COUNT(*)::int AS docs_count,
             COALESCE(SUM(balance_due_pen), 0)::numeric(14,2) AS balance_due_pen
           FROM analytics.v_report_ap_maturity
           GROUP BY maturity_bucket
         ) t
       ), '[]'::json) AS ap_buckets,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             ap_id,
             purchase_id,
             supplier_party_id,
             supplier_name,
             supplier_doc_number,
             doc_ref,
             obligation_type,
             issue_date::text AS issue_date,
             due_date::text AS due_date,
             original_amount_pen,
             paid_amount_pen,
             balance_due_pen,
             status,
             days_to_due,
             maturity_bucket
           FROM analytics.v_report_ap_maturity
           LIMIT 50
         ) t
       ), '[]'::json) AS ap_docs,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             ap.supplier_party_id,
             COALESCE(NULLIF(BTRIM(pa.trade_name), ''), pa.legal_name, 'Proveedor sin especificar') AS supplier_name,
             COUNT(*) FILTER (WHERE ap.status IN ('OPEN', 'PARTIAL') AND ap.balance_due_pen > 0.05)::int AS open_docs_count,
             COALESCE(SUM(ap.original_amount_pen), 0)::numeric(14,2) AS total_billed_pen,
             COALESCE(SUM(ap.paid_amount_pen), 0)::numeric(14,2) AS total_paid_pen,
             COALESCE(SUM(CASE WHEN ap.status IN ('OPEN', 'PARTIAL') AND ap.balance_due_pen > 0.05 THEN ap.balance_due_pen ELSE 0 END), 0)::numeric(14,2) AS total_balance_due_pen
           FROM erp.ap_obligations ap
           LEFT JOIN erp.parties pa ON pa.party_id = ap.supplier_party_id
           WHERE ap.status <> 'CANCELLED'
           GROUP BY ap.supplier_party_id, COALESCE(NULLIF(BTRIM(pa.trade_name), ''), pa.legal_name, 'Proveedor sin especificar')
           ORDER BY total_balance_due_pen DESC, total_billed_pen DESC
         ) t
       ), '[]'::json) AS ap_suppliers,
       (
         SELECT json_build_object(
           'inflow_pen', COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.tx_date >= DATE '2026-06-26' AND cl.direction = 'IN' AND NOT cl.is_internal_transfer), 0)::numeric(14,2),
           'merchandise_outflow_pen', COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.tx_date >= DATE '2026-06-26' AND cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'MERCHANDISE_PAYMENT'), 0)::numeric(14,2),
           'route_opex_pen', COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.tx_date >= DATE '2026-06-26' AND cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'ROUTE_OPEX'), 0)::numeric(14,2),
           'non_opex_drain_pen', COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.tx_date >= DATE '2026-06-26' AND cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'NON_OPEX_OR_CAPEX'), 0)::numeric(14,2),
           'internal_transfers_pen', COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.tx_date >= DATE '2026-06-26' AND cl.is_internal_transfer AND cl.direction = 'OUT'), 0)::numeric(14,2),
           'pre_route_outflow_pen', COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.tx_date < DATE '2026-06-26' AND cl.direction = 'OUT' AND NOT cl.is_internal_transfer), 0)::numeric(14,2)
         )
         FROM erp.cash_ledger cl
         WHERE ${periodCond}
       ) AS period_cash_mix`,
    pb.params
  );

  const row = res.rows[0];
  const cashAccounts = (row?.cash_accounts ?? []).map((a) => {
    const totalIn = toNum(a.total_in_pen);
    const totalOut = toNum(a.total_out_pen);
    return {
      account_id: Number(a.account_id),
      code: String(a.code),
      name: String(a.name),
      account_type: String(a.account_type),
      total_in_pen: totalIn,
      total_out_pen: totalOut,
      net_balance_pen: Number((totalIn - totalOut).toFixed(2)),
      period_in_pen: toNum(a.period_in_pen),
      period_out_pen: toNum(a.period_out_pen),
    };
  });

  const upcomingApDocs: ReportApDocRow[] = (row?.ap_docs ?? []).map((d) => ({
    ap_id: Number(d.ap_id),
    purchase_id: d.purchase_id ? Number(d.purchase_id) : null,
    supplier_party_id: d.supplier_party_id ? Number(d.supplier_party_id) : null,
    supplier_name: String(d.supplier_name),
    supplier_doc_number: d.supplier_doc_number ? String(d.supplier_doc_number) : null,
    doc_ref: String(d.doc_ref),
    obligation_type: String(d.obligation_type),
    issue_date: String(d.issue_date),
    due_date: d.due_date ? String(d.due_date) : null,
    original_amount_pen: toNum(d.original_amount_pen),
    paid_amount_pen: toNum(d.paid_amount_pen),
    balance_due_pen: toNum(d.balance_due_pen),
    status: String(d.status),
    days_to_due: toOptNum(d.days_to_due),
    maturity_bucket: String(d.maturity_bucket) as ReportApMaturityBucket["bucket"],
  }));

  const bucketMap = new Map<
    ReportApMaturityBucket["bucket"],
    { docsCount: number; balanceDuePen: number }
  >(AP_BUCKET_ORDER.map((b) => [b, { docsCount: 0, balanceDuePen: 0 }]));

  for (const bRow of row?.ap_buckets ?? []) {
    const key = String(bRow.maturity_bucket) as ReportApMaturityBucket["bucket"];
    if (bucketMap.has(key)) {
      bucketMap.set(key, {
        docsCount: Number(bRow.docs_count ?? 0),
        balanceDuePen: toNum(bRow.balance_due_pen),
      });
    }
  }
  const apMaturityBuckets: ReportApMaturityBucket[] = AP_BUCKET_ORDER.map((bucket) => ({
    bucket,
    docsCount: bucketMap.get(bucket)?.docsCount ?? 0,
    balanceDuePen: bucketMap.get(bucket)?.balanceDuePen ?? 0,
  }));

  const liquidCashPen = Number(
    cashAccounts
      .filter((a) => a.account_type !== "PARTNER_CUSTODY")
      .reduce((s, a) => s + a.net_balance_pen, 0)
      .toFixed(2)
  );
  const partnerCustodyPen = Number(
    cashAccounts
      .filter((a) => a.account_type === "PARTNER_CUSTODY")
      .reduce((s, a) => s + a.net_balance_pen, 0)
      .toFixed(2)
  );
  const totalCashPen = Number((liquidCashPen + partnerCustodyPen).toFixed(2));
  const overdueApPen = bucketMap.get("OVERDUE")?.balanceDuePen ?? 0;
  const due0To7Pen = bucketMap.get("DUE_0_7")?.balanceDuePen ?? 0;
  const due8To15Pen = bucketMap.get("DUE_8_15")?.balanceDuePen ?? 0;
  const due16To30Pen = bucketMap.get("DUE_16_30")?.balanceDuePen ?? 0;
  const due31PlusPen = bucketMap.get("DUE_31_PLUS")?.balanceDuePen ?? 0;
  const noDueDateApPen = bucketMap.get("NO_DUE_DATE")?.balanceDuePen ?? 0;
  const totalOpenApPen = Number(
    (
      overdueApPen +
      due0To7Pen +
      due8To15Pen +
      due16To30Pen +
      due31PlusPen +
      noDueDateApPen
    ).toFixed(2)
  );
  const dueWithin30dPen = Number(
    (overdueApPen + due0To7Pen + due8To15Pen + due16To30Pen).toFixed(2)
  );
  const mix = row?.period_cash_mix ?? {};

  return {
    filterOptions: mapFilterOptions(row?.filter_options),
    cashAccounts,
    liquiditySummary: {
      liquidCashPen,
      partnerCustodyPen,
      totalCashPen,
      totalOpenApPen,
      overdueApPen,
      due0To7Pen,
      due8To15Pen,
      due16To30Pen,
      due31PlusPen,
      noDueDateApPen,
      dueWithin30dPen,
      netLiquidityAfter30dApPen: Number((liquidCashPen - dueWithin30dPen).toFixed(2)),
    },
    apMaturityBuckets,
    upcomingApDocs,
    apBySupplier: (row?.ap_suppliers ?? []).map((s) => ({
      supplier_party_id: s.supplier_party_id ? Number(s.supplier_party_id) : null,
      supplier_name: String(s.supplier_name),
      open_docs_count: Number(s.open_docs_count ?? 0),
      total_billed_pen: toNum(s.total_billed_pen),
      total_paid_pen: toNum(s.total_paid_pen),
      total_balance_due_pen: toNum(s.total_balance_due_pen),
    })),
    periodCashMix: {
      inflowPen: toNum(mix.inflow_pen),
      merchandiseOutflowPen: toNum(mix.merchandise_outflow_pen),
      routeOpexPen: toNum(mix.route_opex_pen),
      nonOpexDrainPen: toNum(mix.non_opex_drain_pen),
      internalTransfersPen: toNum(mix.internal_transfers_pen),
      preRouteOutflowPen: toNum(mix.pre_route_outflow_pen),
    },
  };
}

const AR_BUCKET_ORDER: ReportArBucket["bucket"][] = ["0_15", "16_30", "31_60", "GT_60"];

async function queryCartera(
  client: PoolClient,
  filters: ReportFilters
): Promise<ReportCarteraData> {
  const pb = new FilterParamBuilder();
  const detailClauses: string[] = ["1=1"];
  if (filters.from) detailClauses.push(`d.order_date >= ${pb.add(filters.from)}::date`);
  if (filters.to) detailClauses.push(`d.order_date <= ${pb.add(filters.to)}::date`);
  if (filters.zone) detailClauses.push(`d.effective_zone = ${pb.add(filters.zone)}`);
  if (filters.sellerId === "UNASSIGNED") {
    detailClauses.push("d.created_by_user_id IS NULL");
  } else if (filters.sellerId !== undefined) {
    detailClauses.push(`d.created_by_user_id = ${pb.add(filters.sellerId)}`);
  }
  const detailWhere = detailClauses.join(" AND ");

  const refClauses: string[] = [
    "so.order_date >= DATE '2026-06-26'",
    "so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')",
  ];
  if (filters.zone) {
    refClauses.push(
      `COALESCE(NULLIF(BTRIM(pa.city_zone), ''), NULLIF(BTRIM(rt.zone_name), ''), 'Sin zona') = ${pb.add(filters.zone)}`
    );
  }
  if (filters.sellerId === "UNASSIGNED") {
    refClauses.push("so.created_by_user_id IS NULL");
  } else if (filters.sellerId !== undefined) {
    refClauses.push(`so.created_by_user_id = ${pb.add(filters.sellerId)}`);
  }
  const refFromParam = filters.from ? pb.add(filters.from) : null;
  const refToParam = filters.to ? pb.add(filters.to) : null;

  const res = await client.query<{
    filter_options: unknown;
    summary_stats: Record<string, unknown>;
    aging_buckets: Array<Record<string, unknown>>;
    by_zone: Array<Record<string, unknown>>;
    by_customer: Array<Record<string, unknown>>;
    collection_sheet: Array<Record<string, unknown>>;
    dso_ref: Record<string, unknown>;
  }>(
    `WITH filtered_ar AS (
       SELECT *
       FROM analytics.v_report_ar_aging_detail d
       WHERE ${detailWhere}
     ),
     dso_anchor AS (
       SELECT
         ${refToParam ? `${refToParam}::date` : "COALESCE(MAX(so.order_date), (NOW() AT TIME ZONE 'America/Lima')::date)"} AS win_end
       FROM erp.sales_orders so
       LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
       LEFT JOIN erp.route_trips rt ON rt.trip_id = so.trip_id
       WHERE ${refClauses.join(" AND ")}
     ),
     dso_window AS (
       SELECT
         COALESCE(${refFromParam ? `${refFromParam}::date` : "NULL::date"}, (da.win_end - 89)) AS win_start,
         da.win_end
       FROM dso_anchor da
     ),
     dso_sales AS (
       SELECT
         COALESCE(SUM(so.total_pen), 0)::numeric(14,2) AS ref_sales_pen,
         GREATEST(1, (dw.win_end - dw.win_start + 1))::int AS ref_days
       FROM dso_window dw
       LEFT JOIN erp.sales_orders so
         ON so.order_date BETWEEN dw.win_start AND dw.win_end
        AND ${refClauses.join(" AND ")}
       LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
       LEFT JOIN erp.route_trips rt ON rt.trip_id = so.trip_id
       GROUP BY dw.win_end, dw.win_start
     )
     SELECT
       ${FILTER_OPTIONS_SELECT},
       (
         SELECT json_build_object(
           'total_receivable_pen', COALESCE(SUM(balance_due_pen), 0)::numeric(14,2),
           'open_orders_count', COUNT(*)::int,
           'open_customers_count', COUNT(DISTINCT COALESCE(customer_party_id::text, customer_name))::int,
           'overdue_gt_30_pen', COALESCE(SUM(balance_due_pen) FILTER (WHERE days_overdue > 30), 0)::numeric(14,2),
           'overdue_gt_60_pen', COALESCE(SUM(balance_due_pen) FILTER (WHERE days_overdue > 60), 0)::numeric(14,2),
           'broken_promises_count', COUNT(*) FILTER (WHERE promise_status = 'PROMISE_BROKEN')::int,
           'broken_promises_pen', COALESCE(SUM(balance_due_pen) FILTER (WHERE promise_status = 'PROMISE_BROKEN'), 0)::numeric(14,2),
           'avg_open_age_days', COALESCE(ROUND(SUM(balance_due_pen * days_overdue) / NULLIF(SUM(balance_due_pen), 0), 1), 0)
         )
         FROM filtered_ar
       ) AS summary_stats,
       (SELECT row_to_json(dso_sales) FROM dso_sales) AS dso_ref,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             ar_bucket,
             COUNT(*)::int AS orders_count,
             COALESCE(SUM(balance_due_pen), 0)::numeric(14,2) AS balance_due_pen
           FROM filtered_ar
           GROUP BY ar_bucket
         ) t
       ), '[]'::json) AS aging_buckets,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             effective_zone,
             COUNT(*)::int AS orders_count,
             COUNT(DISTINCT COALESCE(customer_party_id::text, customer_name))::int AS customers_count,
             COALESCE(SUM(balance_due_pen), 0)::numeric(14,2) AS balance_due_pen,
             COALESCE(SUM(balance_due_pen) FILTER (WHERE days_overdue > 30), 0)::numeric(14,2) AS overdue_gt_30_pen,
             COUNT(*) FILTER (WHERE promise_status = 'PROMISE_BROKEN')::int AS broken_promises_count
           FROM filtered_ar
           GROUP BY effective_zone
           ORDER BY balance_due_pen DESC, effective_zone ASC
         ) t
       ), '[]'::json) AS by_zone,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             MAX(customer_party_id) AS customer_party_id,
             customer_name,
             MAX(customer_phone) AS customer_phone,
             effective_zone,
             COUNT(*)::int AS orders_count,
             MAX(days_overdue)::int AS max_days_overdue,
             COALESCE(SUM(balance_due_pen), 0)::numeric(14,2) AS balance_due_pen,
             MIN(promised_payment_date)::text AS next_promise_date
           FROM filtered_ar
           GROUP BY customer_name, effective_zone
           ORDER BY balance_due_pen DESC, max_days_overdue DESC
           LIMIT 40
         ) t
       ), '[]'::json) AS by_customer,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             order_id,
             order_code,
             order_date::text AS order_date,
             due_date::text AS due_date,
             customer_party_id,
             customer_name,
             customer_phone,
             effective_zone,
             payment_mode,
             total_pen,
             paid_pen,
             balance_due_pen,
             days_overdue,
             ar_bucket,
             promised_payment_date::text AS promised_payment_date,
             promise_status,
             created_by_name
           FROM filtered_ar
           ORDER BY effective_zone ASC, days_overdue DESC, order_id ASC
           LIMIT 150
         ) t
       ), '[]'::json) AS collection_sheet`,
    pb.params
  );

  const row = res.rows[0];
  const stats = row?.summary_stats ?? {};
  const dsoRef = row?.dso_ref ?? {};
  const collectionSheet: ReportArDocRow[] = (row?.collection_sheet ?? []).map((r) => ({
    order_id: Number(r.order_id),
    order_code: String(r.order_code),
    order_date: String(r.order_date),
    due_date: r.due_date ? String(r.due_date) : null,
    customer_party_id: r.customer_party_id ? Number(r.customer_party_id) : null,
    customer_name: String(r.customer_name),
    customer_phone: r.customer_phone ? String(r.customer_phone) : null,
    effective_zone: String(r.effective_zone),
    payment_mode: String(r.payment_mode),
    total_pen: toNum(r.total_pen),
    paid_pen: toNum(r.paid_pen),
    balance_due_pen: toNum(r.balance_due_pen),
    days_overdue: Number(r.days_overdue ?? 0),
    ar_bucket: String(r.ar_bucket) as ReportArBucket["bucket"],
    promised_payment_date: r.promised_payment_date
      ? String(r.promised_payment_date)
      : null,
    promise_status: String(r.promise_status),
    created_by_name: r.created_by_name ? String(r.created_by_name) : null,
  }));

  const arBucketMap = new Map<
    ReportArBucket["bucket"],
    { ordersCount: number; balanceDuePen: number }
  >(AR_BUCKET_ORDER.map((b) => [b, { ordersCount: 0, balanceDuePen: 0 }]));
  for (const bRow of row?.aging_buckets ?? []) {
    const key = String(bRow.ar_bucket) as ReportArBucket["bucket"];
    if (arBucketMap.has(key)) {
      arBucketMap.set(key, {
        ordersCount: Number(bRow.orders_count ?? 0),
        balanceDuePen: toNum(bRow.balance_due_pen),
      });
    }
  }
  const agingBuckets: ReportArBucket[] = AR_BUCKET_ORDER.map((bucket) => ({
    bucket,
    ordersCount: arBucketMap.get(bucket)?.ordersCount ?? 0,
    balanceDuePen: arBucketMap.get(bucket)?.balanceDuePen ?? 0,
  }));

  const totalReceivablePen = toNum(stats.total_receivable_pen);
  const referenceSalesPen = toNum(dsoRef.ref_sales_pen);
  const referenceWindowDays = Math.max(1, Number(dsoRef.ref_days ?? 90));
  const dsoDays =
    referenceSalesPen > 0
      ? Number(
          ((totalReceivablePen / referenceSalesPen) * referenceWindowDays).toFixed(1)
        )
      : null;

  return {
    filterOptions: mapFilterOptions(row?.filter_options),
    summary: {
      totalReceivablePen,
      openOrdersCount: Number(stats.open_orders_count ?? 0),
      openCustomersCount: Number(stats.open_customers_count ?? 0),
      overdueGt30Pen: toNum(stats.overdue_gt_30_pen),
      overdueGt60Pen: toNum(stats.overdue_gt_60_pen),
      brokenPromisesCount: Number(stats.broken_promises_count ?? 0),
      brokenPromisesPen: toNum(stats.broken_promises_pen),
      dsoDays,
      avgOpenAgeDays: toNum(stats.avg_open_age_days),
      referenceSalesPen,
      referenceWindowDays,
    },
    agingBuckets,
    byZone: (row?.by_zone ?? []).map((z) => ({
      effective_zone: String(z.effective_zone),
      orders_count: Number(z.orders_count ?? 0),
      customers_count: Number(z.customers_count ?? 0),
      balance_due_pen: toNum(z.balance_due_pen),
      overdue_gt_30_pen: toNum(z.overdue_gt_30_pen),
      broken_promises_count: Number(z.broken_promises_count ?? 0),
    })),
    byCustomer: (row?.by_customer ?? []).map((c) => ({
      customer_party_id: c.customer_party_id ? Number(c.customer_party_id) : null,
      customer_name: String(c.customer_name),
      customer_phone: c.customer_phone ? String(c.customer_phone) : null,
      effective_zone: String(c.effective_zone),
      orders_count: Number(c.orders_count ?? 0),
      max_days_overdue: Number(c.max_days_overdue ?? 0),
      balance_due_pen: toNum(c.balance_due_pen),
      next_promise_date: c.next_promise_date ? String(c.next_promise_date) : null,
    })),
    collectionSheet,
  };
}

async function queryComercial(
  client: PoolClient,
  filters: ReportFilters
): Promise<ReportComercialData> {
  const pb = new FilterParamBuilder();
  const orderClauses = [
    "so.order_date >= DATE '2026-06-26'",
    "so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')",
    ...pb.appendSalesFilters(filters, "so"),
  ];
  const tripClauses: string[] = ["1=1"];
  if (filters.from) tripClauses.push(`rp.trip_date >= ${pb.add(filters.from)}::date`);
  if (filters.to) tripClauses.push(`rp.trip_date <= ${pb.add(filters.to)}::date`);
  if (filters.zone) tripClauses.push(`rp.zone_name = ${pb.add(filters.zone)}`);

  const inactiveClauses = ["ic.days_since_last_order >= 30"];
  if (filters.zone) inactiveClauses.push(`ic.effective_zone = ${pb.add(filters.zone)}`);

  const res = await client.query<{
    filter_options: unknown;
    by_zone: Array<Record<string, unknown>>;
    by_seller: Array<Record<string, unknown>>;
    top_customers: Array<Record<string, unknown>>;
    route_profitability: Array<Record<string, unknown>>;
    discount_summary: Record<string, unknown>;
    discount_lines: Array<Record<string, unknown>>;
    inactive_customers: Array<Record<string, unknown>>;
  }>(
    `WITH scoped_orders AS (
       SELECT
         so.order_id,
         so.order_code,
         so.order_date,
         so.customer_party_id,
         COALESCE(NULLIF(BTRIM(pa.trade_name), ''), pa.legal_name, so.customer_name_raw, 'CLIENTE SIN NOMBRE') AS customer_name,
         COALESCE(NULLIF(BTRIM(pa.city_zone), ''), NULLIF(BTRIM(rt.zone_name), ''), 'Sin zona') AS effective_zone,
         so.created_by_user_id AS seller_user_id,
         COALESCE(u.full_name, 'Sin vendedor asignado (Histórico)') AS seller_name,
         so.total_pen,
         so.paid_pen,
         so.balance_due_pen
       FROM erp.sales_orders so
       LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
       LEFT JOIN erp.route_trips rt ON rt.trip_id = so.trip_id
       LEFT JOIN erp.app_users u ON u.user_id = so.created_by_user_id
       WHERE ${orderClauses.join(" AND ")}
     ),
     order_line_agg AS (
       SELECT
         sol.order_id,
         COALESCE(SUM(sol.line_total_pen) FILTER (WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL), 0)::numeric(14,2) AS cost_covered_sales_pen,
         COALESCE(SUM((sol.quantity * sol.pack_factor_applied) * COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen)) FILTER (WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL), 0)::numeric(14,2) AS known_cogs_pen,
         COALESCE(SUM(sol.quantity * COALESCE(sol.unit_discount_pen, 0)), 0)::numeric(14,2) AS discount_total_pen
       FROM erp.sales_order_lines sol
       JOIN scoped_orders sco ON sco.order_id = sol.order_id
       JOIN erp.products p ON p.product_id = sol.product_id
       GROUP BY sol.order_id
     ),
     discounted_lines AS (
       SELECT
         sol.order_line_id,
         sco.order_code,
         sco.order_date::text AS order_date,
         sco.customer_name,
         sco.seller_name,
         p.sku,
         sol.raw_description,
         sol.quantity,
         COALESCE(sol.base_unit_price_pen, sol.unit_price_pen) AS base_unit_price_pen,
         sol.unit_price_pen,
         COALESCE(sol.unit_discount_pen, 0) AS unit_discount_pen,
         ROUND(sol.quantity * COALESCE(sol.unit_discount_pen, 0), 2) AS discount_line_total_pen,
         sol.line_total_pen,
         sol.below_min_price_flag
       FROM erp.sales_order_lines sol
       JOIN scoped_orders sco ON sco.order_id = sol.order_id
       JOIN erp.products p ON p.product_id = sol.product_id
       WHERE COALESCE(sol.unit_discount_pen, 0) > 0 OR sol.below_min_price_flag = TRUE
     )
     SELECT
       ${FILTER_OPTIONS_SELECT},
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             sco.effective_zone,
             COUNT(*)::int AS orders_count,
             COUNT(DISTINCT COALESCE(sco.customer_party_id::text, sco.customer_name))::int AS customers_count,
             COALESCE(SUM(sco.total_pen), 0)::numeric(14,2) AS sales_total_pen,
             COALESCE(SUM(sco.paid_pen), 0)::numeric(14,2) AS cash_collected_pen,
             COALESCE(SUM(sco.balance_due_pen), 0)::numeric(14,2) AS ar_pending_pen,
             COALESCE(SUM(ola.cost_covered_sales_pen), 0)::numeric(14,2) AS cost_covered_sales_pen,
             COALESCE(SUM(ola.known_cogs_pen), 0)::numeric(14,2) AS known_cogs_pen,
             (COALESCE(SUM(ola.cost_covered_sales_pen), 0) - COALESCE(SUM(ola.known_cogs_pen), 0))::numeric(14,2) AS gross_margin_pen,
             ROUND((COALESCE(SUM(ola.cost_covered_sales_pen), 0) - COALESCE(SUM(ola.known_cogs_pen), 0)) * 100.0 / NULLIF(COALESCE(SUM(ola.cost_covered_sales_pen), 0), 0), 2) AS gross_margin_pct
           FROM scoped_orders sco
           LEFT JOIN order_line_agg ola ON ola.order_id = sco.order_id
           GROUP BY sco.effective_zone
           ORDER BY sales_total_pen DESC, sco.effective_zone ASC
         ) t
       ), '[]'::json) AS by_zone,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             sco.seller_user_id,
             sco.seller_name,
             COUNT(*)::int AS orders_count,
             COALESCE(SUM(sco.total_pen), 0)::numeric(14,2) AS sales_total_pen,
             COALESCE(SUM(sco.paid_pen), 0)::numeric(14,2) AS cash_collected_pen,
             ROUND(COALESCE(SUM(sco.paid_pen), 0) * 100.0 / NULLIF(COALESCE(SUM(sco.total_pen), 0), 0), 2) AS collection_rate_pct,
             COALESCE(SUM(sco.balance_due_pen), 0)::numeric(14,2) AS ar_pending_pen,
             (COALESCE(SUM(ola.cost_covered_sales_pen), 0) - COALESCE(SUM(ola.known_cogs_pen), 0))::numeric(14,2) AS gross_margin_pen,
             ROUND((COALESCE(SUM(ola.cost_covered_sales_pen), 0) - COALESCE(SUM(ola.known_cogs_pen), 0)) * 100.0 / NULLIF(COALESCE(SUM(ola.cost_covered_sales_pen), 0), 0), 2) AS gross_margin_pct,
             COALESCE(SUM(ola.discount_total_pen), 0)::numeric(14,2) AS discount_total_pen
           FROM scoped_orders sco
           LEFT JOIN order_line_agg ola ON ola.order_id = sco.order_id
           GROUP BY sco.seller_user_id, sco.seller_name
           ORDER BY sales_total_pen DESC, sco.seller_name ASC
         ) t
       ), '[]'::json) AS by_seller,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             MAX(sco.customer_party_id) AS customer_party_id,
             sco.customer_name,
             MAX(sco.effective_zone) AS effective_zone,
             COUNT(*)::int AS orders_count,
             COALESCE(SUM(sco.total_pen), 0)::numeric(14,2) AS total_sold_pen,
             COALESCE(SUM(sco.paid_pen), 0)::numeric(14,2) AS total_paid_pen,
             COALESCE(SUM(sco.balance_due_pen), 0)::numeric(14,2) AS total_due_pen,
             (COALESCE(SUM(ola.cost_covered_sales_pen), 0) - COALESCE(SUM(ola.known_cogs_pen), 0))::numeric(14,2) AS gross_margin_pen
           FROM scoped_orders sco
           LEFT JOIN order_line_agg ola ON ola.order_id = sco.order_id
           GROUP BY sco.customer_name
           ORDER BY total_sold_pen DESC, sco.customer_name ASC
           LIMIT 20
         ) t
       ), '[]'::json) AS top_customers,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             rp.trip_id,
             rp.trip_code,
             rp.trip_date::text AS trip_date,
             rp.zone_name,
             rp.driver_name,
             rp.status,
             rp.order_count,
             rp.sales_total_pen,
             rp.cash_collected_pen,
             rp.gross_margin_pen,
             rp.gross_margin_pct,
             rp.route_opex_pen,
             rp.route_opex_pct,
             rp.trip_net_contribution_pen,
             rp.trip_net_contribution_pct,
             rp.route_opex_above_8pct_alert
           FROM analytics.v_report_route_profitability rp
           WHERE ${tripClauses.join(" AND ")}
           ORDER BY rp.trip_date DESC, rp.trip_id DESC
           LIMIT 50
         ) t
       ), '[]'::json) AS route_profitability,
       (
         SELECT json_build_object(
           'discounted_lines_count', COUNT(*)::int,
           'below_min_lines_count', COUNT(*) FILTER (WHERE below_min_price_flag)::int,
           'total_discount_pen', COALESCE(SUM(discount_line_total_pen), 0)::numeric(14,2),
           'discounted_sales_pen', COALESCE(SUM(line_total_pen), 0)::numeric(14,2)
         )
         FROM discounted_lines
       ) AS discount_summary,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT * FROM discounted_lines
           ORDER BY discount_line_total_pen DESC, order_line_id DESC
           LIMIT 25
         ) t
       ), '[]'::json) AS discount_lines,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             ic.customer_party_id,
             ic.customer_name,
             ic.effective_zone,
             ic.phone,
             ic.orders_count,
             ic.total_sold_pen,
             ic.total_due_pen,
             ic.last_order_date::text AS last_order_date,
             ic.days_since_last_order,
             ic.inactivity_tier
           FROM analytics.v_report_inactive_customers ic
           WHERE ${inactiveClauses.join(" AND ")}
           ORDER BY ic.days_since_last_order DESC, ic.total_sold_pen DESC
           LIMIT 30
         ) t
       ), '[]'::json) AS inactive_customers`,
    pb.params
  );

  const row = res.rows[0];
  const dsum = row?.discount_summary ?? {};
  return {
    filterOptions: mapFilterOptions(row?.filter_options),
    byZone: (row?.by_zone ?? []).map((z) => ({
      effective_zone: String(z.effective_zone),
      orders_count: Number(z.orders_count ?? 0),
      customers_count: Number(z.customers_count ?? 0),
      sales_total_pen: toNum(z.sales_total_pen),
      cash_collected_pen: toNum(z.cash_collected_pen),
      ar_pending_pen: toNum(z.ar_pending_pen),
      cost_covered_sales_pen: toNum(z.cost_covered_sales_pen),
      known_cogs_pen: toNum(z.known_cogs_pen),
      gross_margin_pen: toNum(z.gross_margin_pen),
      gross_margin_pct: toOptNum(z.gross_margin_pct),
    })),
    bySeller: (row?.by_seller ?? []).map((s) => ({
      seller_user_id: s.seller_user_id ? Number(s.seller_user_id) : null,
      seller_name: String(s.seller_name),
      orders_count: Number(s.orders_count ?? 0),
      sales_total_pen: toNum(s.sales_total_pen),
      cash_collected_pen: toNum(s.cash_collected_pen),
      collection_rate_pct: toOptNum(s.collection_rate_pct),
      ar_pending_pen: toNum(s.ar_pending_pen),
      gross_margin_pen: toNum(s.gross_margin_pen),
      gross_margin_pct: toOptNum(s.gross_margin_pct),
      discount_total_pen: toNum(s.discount_total_pen),
    })),
    topCustomers: (row?.top_customers ?? []).map((c) => ({
      customer_party_id: c.customer_party_id ? Number(c.customer_party_id) : null,
      customer_name: String(c.customer_name),
      effective_zone: String(c.effective_zone),
      orders_count: Number(c.orders_count ?? 0),
      total_sold_pen: toNum(c.total_sold_pen),
      total_paid_pen: toNum(c.total_paid_pen),
      total_due_pen: toNum(c.total_due_pen),
      gross_margin_pen: toNum(c.gross_margin_pen),
    })),
    routeProfitability: (row?.route_profitability ?? []).map((rp) => ({
      trip_id: Number(rp.trip_id),
      trip_code: String(rp.trip_code),
      trip_date: String(rp.trip_date),
      zone_name: String(rp.zone_name),
      driver_name: rp.driver_name ? String(rp.driver_name) : null,
      status: String(rp.status),
      order_count: Number(rp.order_count ?? 0),
      sales_total_pen: toNum(rp.sales_total_pen),
      cash_collected_pen: toNum(rp.cash_collected_pen),
      gross_margin_pen: toNum(rp.gross_margin_pen),
      gross_margin_pct: toOptNum(rp.gross_margin_pct),
      route_opex_pen: toNum(rp.route_opex_pen),
      route_opex_pct: toOptNum(rp.route_opex_pct),
      trip_net_contribution_pen: toNum(rp.trip_net_contribution_pen),
      trip_net_contribution_pct: toOptNum(rp.trip_net_contribution_pct),
      route_opex_above_8pct_alert: Boolean(rp.route_opex_above_8pct_alert),
    })),
    discountAudit: {
      summary: {
        discountedLinesCount: Number(dsum.discounted_lines_count ?? 0),
        belowMinLinesCount: Number(dsum.below_min_lines_count ?? 0),
        totalDiscountPen: toNum(dsum.total_discount_pen),
        discountedSalesPen: toNum(dsum.discounted_sales_pen),
      },
      topLines: (row?.discount_lines ?? []).map((dl) => ({
        order_line_id: Number(dl.order_line_id),
        order_code: String(dl.order_code),
        order_date: String(dl.order_date),
        customer_name: String(dl.customer_name),
        seller_name: dl.seller_name ? String(dl.seller_name) : null,
        sku: String(dl.sku),
        raw_description: String(dl.raw_description),
        quantity: toNum(dl.quantity),
        base_unit_price_pen: toNum(dl.base_unit_price_pen),
        unit_price_pen: toNum(dl.unit_price_pen),
        unit_discount_pen: toNum(dl.unit_discount_pen),
        discount_line_total_pen: toNum(dl.discount_line_total_pen),
        below_min_price_flag: Boolean(dl.below_min_price_flag),
      })),
    },
    inactiveCustomers: (row?.inactive_customers ?? []).map((ic) => ({
      customer_party_id: Number(ic.customer_party_id),
      customer_name: String(ic.customer_name),
      effective_zone: String(ic.effective_zone),
      phone: ic.phone ? String(ic.phone) : null,
      orders_count: Number(ic.orders_count ?? 0),
      total_sold_pen: toNum(ic.total_sold_pen),
      total_due_pen: toNum(ic.total_due_pen),
      last_order_date: String(ic.last_order_date),
      days_since_last_order: Number(ic.days_since_last_order ?? 0),
      inactivity_tier: String(
        ic.inactivity_tier
      ) as ReportComercialData["inactiveCustomers"][number]["inactivity_tier"],
    })),
  };
}

function mapStockSkuRow(r: Record<string, unknown>): ReportStockSkuRow {
  return {
    product_id: Number(r.product_id),
    sku: String(r.sku),
    product_name: String(r.product_name),
    category: r.category ? String(r.category) : null,
    fulfillment_mode: String(r.fulfillment_mode),
    unit_of_measure: String(r.unit_of_measure),
    stock_on_hand: toNum(r.stock_on_hand),
    positive_stock_qty: toNum(r.positive_stock_qty),
    ref_cost_pen: toOptNum(r.ref_cost_pen),
    list_sale_price_pen: toOptNum(r.list_sale_price_pen),
    valuation_pen: toNum(r.valuation_pen),
    units_sold_total: toNum(r.units_sold_total),
    units_sold_90d: toNum(r.units_sold_90d),
    order_frequency_total: Number(r.order_frequency_total ?? 0),
    order_frequency_90d: Number(r.order_frequency_90d ?? 0),
    last_sale_date: r.last_sale_date ? String(r.last_sale_date) : null,
    days_since_last_sale: toOptNum(r.days_since_last_sale),
    daily_velocity_90d: toNum(r.daily_velocity_90d),
    days_of_coverage: toOptNum(r.days_of_coverage),
    revenue_total_pen: toNum(r.revenue_total_pen),
    real_gross_margin_pct: toOptNum(r.real_gross_margin_pct),
    dead_stock_status: String(r.dead_stock_status),
  };
}

async function queryStock(
  client: PoolClient,
  filters: ReportFilters
): Promise<ReportStockData> {
  void filters;
  const res = await client.query<{
    filter_options: unknown;
    val_summary: Record<string, unknown>;
    fulfillment_mix: Array<Record<string, unknown>>;
    dead_slow: Array<Record<string, unknown>>;
    replenishment: Array<Record<string, unknown>>;
    on_demand: Array<Record<string, unknown>>;
    margin_risk: Array<Record<string, unknown>>;
    top_skus: Array<Record<string, unknown>>;
  }>(
    `SELECT
       ${FILTER_OPTIONS_SELECT},
       (
         SELECT json_build_object(
           'total_valuation_pen', COALESCE(SUM(valuation_pen), 0)::numeric(14,2),
           'positive_stock_sku_count', COUNT(*) FILTER (WHERE stock_on_hand > 0)::int,
           'negative_stock_sku_count', COUNT(*) FILTER (WHERE stock_on_hand < -0.0001)::int,
           'positive_stock_missing_cost_count', COUNT(*) FILTER (WHERE stock_on_hand > 0 AND ref_cost_pen IS NULL)::int,
           'dead_stock_90d_count', COUNT(*) FILTER (WHERE dead_stock_status = 'DEAD_90D')::int,
           'dead_stock_90d_pen', COALESCE(SUM(valuation_pen) FILTER (WHERE dead_stock_status = 'DEAD_90D'), 0)::numeric(14,2),
           'slow_stock_60d_count', COUNT(*) FILTER (WHERE dead_stock_status = 'SLOW_60D')::int,
           'slow_stock_60d_pen', COALESCE(SUM(valuation_pen) FILTER (WHERE dead_stock_status = 'SLOW_60D'), 0)::numeric(14,2),
           'low_coverage_count', COUNT(*) FILTER (WHERE dead_stock_status = 'LOW_COVERAGE')::int,
           'low_margin_sku_count', (SELECT COUNT(*)::int FROM analytics.v_kpi_sku_margin_and_opex WHERE low_margin_below_20pct_alert = TRUE),
           'missing_cost_sold_sku_count', (SELECT COUNT(*)::int FROM analytics.v_kpi_sku_margin_and_opex WHERE missing_cost_alert = TRUE)
         )
         FROM analytics.v_report_inventory_valuation
       ) AS val_summary,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             fulfillment_mode,
             COUNT(*)::int AS sku_count,
             COALESCE(SUM(positive_stock_qty), 0)::numeric(14,4) AS units_on_hand,
             COALESCE(SUM(valuation_pen), 0)::numeric(14,2) AS valuation_pen,
             COALESCE(SUM(units_sold_total), 0)::numeric(14,4) AS units_sold_total,
             COALESCE(SUM(revenue_total_pen), 0)::numeric(14,2) AS revenue_total_pen
           FROM analytics.v_report_inventory_valuation
           GROUP BY fulfillment_mode
           ORDER BY revenue_total_pen DESC
         ) t
       ), '[]'::json) AS fulfillment_mix,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT *
           FROM analytics.v_report_inventory_valuation
           WHERE dead_stock_status IN ('DEAD_90D', 'SLOW_60D')
           ORDER BY valuation_pen DESC, days_since_last_sale DESC NULLS FIRST
           LIMIT 30
         ) t
       ), '[]'::json) AS dead_slow,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT *
           FROM analytics.v_report_inventory_valuation
           WHERE fulfillment_mode = 'STOCKED'
             AND (
               dead_stock_status IN ('LOW_COVERAGE', 'NEGATIVE_STOCK')
               OR (positive_stock_qty <= 5 AND units_sold_total > 0)
             )
           ORDER BY days_of_coverage ASC NULLS LAST, units_sold_90d DESC, units_sold_total DESC
           LIMIT 30
         ) t
       ), '[]'::json) AS replenishment,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT *
           FROM analytics.v_report_inventory_valuation
           WHERE fulfillment_mode = 'ON_DEMAND'
             AND order_frequency_total >= 1
           ORDER BY order_frequency_total DESC, revenue_total_pen DESC
           LIMIT 25
         ) t
       ), '[]'::json) AS on_demand,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             product_id,
             sku,
             product_name,
             fulfillment_mode::text AS fulfillment_mode,
             total_units_sold,
             total_revenue_pen,
             ref_cost_pen,
             real_gross_margin_pen,
             real_gross_margin_pct,
             low_margin_below_20pct_alert,
             missing_cost_alert
           FROM analytics.v_kpi_sku_margin_and_opex
           WHERE missing_cost_alert = TRUE OR low_margin_below_20pct_alert = TRUE
           ORDER BY total_revenue_pen DESC, product_id ASC
           LIMIT 30
         ) t
       ), '[]'::json) AS margin_risk,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             km.product_id,
             km.sku,
             km.product_name,
             km.fulfillment_mode::text AS fulfillment_mode,
             COALESCE(iv.stock_on_hand, 0)::numeric(14,4) AS stock_on_hand,
             iv.days_of_coverage,
             km.total_units_sold,
             km.total_revenue_pen,
             km.known_cogs_pen,
             km.real_gross_margin_pen,
             km.real_gross_margin_pct,
             km.low_margin_below_20pct_alert,
             km.missing_cost_alert
           FROM analytics.v_kpi_sku_margin_and_opex km
           LEFT JOIN analytics.v_report_inventory_valuation iv ON iv.product_id = km.product_id
           ORDER BY km.total_revenue_pen DESC
           LIMIT 40
         ) t
       ), '[]'::json) AS top_skus`
  );

  const row = res.rows[0];
  const vs = row?.val_summary ?? {};
  return {
    filterOptions: mapFilterOptions(row?.filter_options),
    valuationSummary: {
      totalValuationPen: toNum(vs.total_valuation_pen),
      positiveStockSkuCount: Number(vs.positive_stock_sku_count ?? 0),
      negativeStockSkuCount: Number(vs.negative_stock_sku_count ?? 0),
      positiveStockMissingCostCount: Number(vs.positive_stock_missing_cost_count ?? 0),
      deadStock90dCount: Number(vs.dead_stock_90d_count ?? 0),
      deadStock90dPen: toNum(vs.dead_stock_90d_pen),
      slowStock60dCount: Number(vs.slow_stock_60d_count ?? 0),
      slowStock60dPen: toNum(vs.slow_stock_60d_pen),
      lowCoverageCount: Number(vs.low_coverage_count ?? 0),
      lowMarginSkuCount: Number(vs.low_margin_sku_count ?? 0),
      missingCostSoldSkuCount: Number(vs.missing_cost_sold_sku_count ?? 0),
    },
    fulfillmentMix: (row?.fulfillment_mix ?? []).map((fm) => ({
      fulfillment_mode: String(fm.fulfillment_mode),
      sku_count: Number(fm.sku_count ?? 0),
      units_on_hand: toNum(fm.units_on_hand),
      valuation_pen: toNum(fm.valuation_pen),
      units_sold_total: toNum(fm.units_sold_total),
      revenue_total_pen: toNum(fm.revenue_total_pen),
    })),
    deadAndSlowStock: (row?.dead_slow ?? []).map(mapStockSkuRow),
    replenishmentAlerts: (row?.replenishment ?? []).map(mapStockSkuRow),
    onDemandCandidates: (row?.on_demand ?? []).map(mapStockSkuRow),
    marginRiskSkus: (row?.margin_risk ?? []).map((m) => ({
      product_id: Number(m.product_id),
      sku: String(m.sku),
      product_name: String(m.product_name),
      fulfillment_mode: String(m.fulfillment_mode),
      total_units_sold: toNum(m.total_units_sold),
      total_revenue_pen: toNum(m.total_revenue_pen),
      ref_cost_pen: toOptNum(m.ref_cost_pen),
      real_gross_margin_pen: toOptNum(m.real_gross_margin_pen),
      real_gross_margin_pct: toOptNum(m.real_gross_margin_pct),
      low_margin_below_20pct_alert: Boolean(m.low_margin_below_20pct_alert),
      missing_cost_alert: Boolean(m.missing_cost_alert),
    })),
    topSkus: (row?.top_skus ?? []).map((s) => ({
      product_id: Number(s.product_id),
      sku: String(s.sku),
      product_name: String(s.product_name),
      fulfillment_mode: String(s.fulfillment_mode),
      stock_on_hand: toNum(s.stock_on_hand),
      days_of_coverage: toOptNum(s.days_of_coverage),
      total_units_sold: toNum(s.total_units_sold),
      total_revenue_pen: toNum(s.total_revenue_pen),
      known_cogs_pen: toNum(s.known_cogs_pen),
      real_gross_margin_pen: toOptNum(s.real_gross_margin_pen),
      real_gross_margin_pct: toOptNum(s.real_gross_margin_pct),
      low_margin_below_20pct_alert: Boolean(s.low_margin_below_20pct_alert),
      missing_cost_alert: Boolean(s.missing_cost_alert),
    })),
  };
}

async function queryAuditoria(
  client: PoolClient,
  filters: ReportFilters
): Promise<ReportAuditoriaData> {
  void filters;
  const res = await client.query<{
    filter_options: unknown;
    closing_counts: Record<string, unknown>;
    quality_gaps: Array<Record<string, unknown>>;
    audit_flags: Array<Record<string, unknown>>;
    flag_counts: Record<string, unknown>;
  }>(
    `SELECT
       ${FILTER_OPTIONS_SELECT},
       json_build_object(
         'missing_sku_cost', COALESCE((SELECT item_count FROM analytics.v_data_quality_gaps WHERE gap_category = 'SALES_MISSING_SKU_COST'), 0)::int,
         'critical_open_flags', COALESCE((SELECT COUNT(*)::int FROM erp.audit_flags WHERE status = 'OPEN' AND severity = 'CRITICAL'), 0),
         'negative_stock_skus', COALESCE((SELECT COUNT(*)::int FROM erp.v_current_stock WHERE warehouse_code = 'MAIN' AND stock_on_hand < -0.0001), 0),
         'pending_on_demand', COALESCE((SELECT COUNT(*)::int FROM analytics.v_pending_on_demand_orders), 0),
         'pending_approvals', COALESCE((SELECT COUNT(*)::int FROM erp.sales_orders WHERE operational_status = 'PENDING_PARTNER_APPROVAL'), 0),
         'open_route_trips', COALESCE((SELECT COUNT(*)::int FROM erp.route_trips WHERE status = 'OPEN'), 0),
         'overdue_ap_docs', COALESCE((SELECT COUNT(*)::int FROM analytics.v_report_ap_maturity WHERE maturity_bucket = 'OVERDUE'), 0)
       ) AS closing_counts,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             gap_category AS metric_code,
             item_count AS gap_count,
             impacted_pen AS impacted_amount_pen,
             description AS recommended_action
           FROM analytics.v_data_quality_gaps
           ORDER BY gap_category ASC
         ) t
       ), '[]'::json) AS quality_gaps,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             flag_id,
             flag_code,
             severity::text AS severity,
             entity_table,
             entity_id,
             message,
             status,
             source_origin::text AS source_origin,
             created_at::text AS created_at,
             resolution_note
           FROM erp.audit_flags
           ORDER BY
             CASE WHEN status = 'OPEN' THEN 0 WHEN status = 'ACKNOWLEDGED' THEN 1 ELSE 2 END ASC,
             created_at DESC,
             flag_id DESC
           LIMIT 50
         ) t
       ), '[]'::json) AS audit_flags,
       (
         SELECT json_build_object(
           'open', COUNT(*) FILTER (WHERE status = 'OPEN')::int,
           'acknowledged', COUNT(*) FILTER (WHERE status = 'ACKNOWLEDGED')::int,
           'resolved', COUNT(*) FILTER (WHERE status = 'RESOLVED')::int
         )
         FROM erp.audit_flags
       ) AS flag_counts`
  );

  const row = res.rows[0];
  const cc = row?.closing_counts ?? {};
  const missingCostCount = Number(cc.missing_sku_cost ?? 0);
  const criticalFlags = Number(cc.critical_open_flags ?? 0);
  const negStockCount = Number(cc.negative_stock_skus ?? 0);
  const pendingOnDemandCount = Number(cc.pending_on_demand ?? 0);
  const pendingApprovalCount = Number(cc.pending_approvals ?? 0);
  const openTripsCount = Number(cc.open_route_trips ?? 0);
  const overdueApCount = Number(cc.overdue_ap_docs ?? 0);

  const checks: ReportClosingCheck[] = [
    {
      code: "MISSING_SKU_COST",
      label: "SKUs vendidos con costo registrado",
      count: missingCostCount,
      severity: missingCostCount > 0 ? "BLOCKING" : "OK",
      detail:
        missingCostCount > 0
          ? `${missingCostCount} SKU(s) vendidos aún no tienen costo de referencia.`
          : "Todos los SKUs vendidos cuentan con costo para márgenes exactos.",
    },
    {
      code: "CRITICAL_OPEN_FLAGS",
      label: "Sin alertas críticas abiertas",
      count: criticalFlags,
      severity: criticalFlags > 0 ? "BLOCKING" : "OK",
      detail:
        criticalFlags > 0
          ? `${criticalFlags} alerta(s) críticas abiertas requieren resolución.`
          : "0 alertas críticas abiertas en auditoría.",
    },
    {
      code: "NEGATIVE_STOCK_SKUS",
      label: "Saldos de inventario regularizados",
      count: negStockCount,
      severity: negStockCount > 0 ? "WARNING" : "OK",
      detail:
        negStockCount > 0
          ? `${negStockCount} SKU(s) presentan saldo negativo histórico en almacén principal.`
          : "Sin saldos negativos en almacén principal.",
    },
    {
      code: "PENDING_ON_DEMAND",
      label: "Líneas bajo pedido enlazadas a compra",
      count: pendingOnDemandCount,
      severity: pendingOnDemandCount > 0 ? "WARNING" : "OK",
      detail:
        pendingOnDemandCount > 0
          ? `${pendingOnDemandCount} línea(s) ON_DEMAND esperan factura de proveedor.`
          : "Todas las líneas ON_DEMAND están enlazadas.",
    },
    {
      code: "PENDING_APPROVALS",
      label: "Descuentos pendientes de aprobación",
      count: pendingApprovalCount,
      severity: pendingApprovalCount > 0 ? "WARNING" : "OK",
      detail:
        pendingApprovalCount > 0
          ? `${pendingApprovalCount} pedido(s) esperan aprobación gerencial.`
          : "0 pedidos retenidos por aprobación.",
    },
    {
      code: "OPEN_ROUTE_TRIPS",
      label: "Hojas de ruta cerradas y rendidas",
      count: openTripsCount,
      severity: openTripsCount > 0 ? "WARNING" : "OK",
      detail:
        openTripsCount > 0
          ? `${openTripsCount} viaje(s) en estado En Ruta sin cierre final.`
          : "Todas las rutas registradas están cerradas.",
    },
    {
      code: "OVERDUE_AP_DOCS",
      label: "Obligaciones CxP al día",
      count: overdueApCount,
      severity: overdueApCount > 0 ? "WARNING" : "OK",
      detail:
        overdueApCount > 0
          ? `${overdueApCount} documento(s) por pagar tienen fecha vencida.`
          : "Sin documentos CxP vencidos.",
    },
  ];

  const hasBlocking = checks.some((c) => c.severity === "BLOCKING");
  const hasWarning = checks.some((c) => c.severity === "WARNING");
  const status: ReportAuditoriaData["closingReadiness"]["status"] = hasBlocking
    ? "BLOCKED"
    : hasWarning
      ? "ATTENTION"
      : "READY";

  const fc = row?.flag_counts ?? {};
  return {
    filterOptions: mapFilterOptions(row?.filter_options),
    closingReadiness: {
      status,
      checks,
    },
    qualityGaps: (row?.quality_gaps ?? []).map((g) => ({
      metric_code: String(g.metric_code),
      gap_count: Number(g.gap_count ?? 0),
      impacted_amount_pen: toNum(g.impacted_amount_pen),
      recommended_action: String(g.recommended_action),
    })),
    auditFlags: (row?.audit_flags ?? []).map((f) => ({
      flag_id: Number(f.flag_id),
      flag_code: String(f.flag_code),
      severity: String(f.severity),
      entity_table: String(f.entity_table),
      entity_id: String(f.entity_id),
      message: String(f.message),
      status: String(f.status) as "OPEN" | "ACKNOWLEDGED" | "RESOLVED",
      source_origin: String(f.source_origin),
      created_at: String(f.created_at),
      resolution_note: f.resolution_note ? String(f.resolution_note) : null,
    })),
    auditFlagCounts: {
      open: Number(fc.open ?? 0),
      acknowledged: Number(fc.acknowledged ?? 0),
      resolved: Number(fc.resolved ?? 0),
    },
  };
}

export async function getReportSectionData<S extends ReportSection>(
  client: PoolClient,
  section: S,
  filters: ReportFilters = {}
): Promise<ReportSectionPayloadMap[S]> {
  switch (section) {
    case "resumen":
      return (await queryResumen(client, filters)) as ReportSectionPayloadMap[S];
    case "caja_cxp":
      return (await queryCajaCxp(client, filters)) as ReportSectionPayloadMap[S];
    case "cartera":
      return (await queryCartera(client, filters)) as ReportSectionPayloadMap[S];
    case "comercial":
      return (await queryComercial(client, filters)) as ReportSectionPayloadMap[S];
    case "stock":
      return (await queryStock(client, filters)) as ReportSectionPayloadMap[S];
    case "auditoria":
      return (await queryAuditoria(client, filters)) as ReportSectionPayloadMap[S];
    default:
      throw new ValidationError(`Sección de reporte inválida: ${String(section)}`);
  }
}
