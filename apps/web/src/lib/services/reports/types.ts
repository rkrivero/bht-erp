import type {
  DataCutSummary,
  OperationalQualitySummary,
} from "@/features/partners/components/types";

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
  admin_opex_pen: number;
  total_opex_pen: number;
  operating_result_pen: number;
  operating_result_pct: number | null;
  owner_salary_recorded_pen: number;
  owner_capex_debt_outflow_pen: number;
}

export interface ReportResumenData {
  filterOptions: ReportFilterOptions;
  dataCut: DataCutSummary;
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
    adminOpexPen: number;
    totalOpexPen: number;
    operatingResultPen: number;
    operatingResultPct: number | null;
    ownerSalaryRecordedPen: number;
    ownerCapexDebtOutflowPen: number;
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
  dataCut: DataCutSummary;
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
  invoice_age_days: number;
  days_past_due: number | null;
  due_status: string;
  ar_bucket: ReportArBucket["bucket"];
  promised_payment_date: string | null;
  promise_status: string;
  created_by_name: string | null;
}

export interface ReportCarteraData {
  filterOptions: ReportFilterOptions;
  dataCut: DataCutSummary;
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
    pastDueExplicitPen: number;
    noDueDatePen: number;
    avgInvoiceAgeDays: number;
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
  dataCut: DataCutSummary;
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
  dataCut: DataCutSummary;
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
  dataCut: DataCutSummary;
  operationalQuality: OperationalQualitySummary;
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
