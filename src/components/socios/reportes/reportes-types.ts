import type { DataCutSummary, OperationalQualitySummary } from "../types";

export type ReportSectionId =
  "resumen" | "caja_cxp" | "cartera" | "comercial" | "stock" | "auditoria";

export type ReportPeriodPreset =
  "ALL" | "MONTH" | "THIS_MONTH" | "LAST_30D" | "LAST_90D" | "CUSTOM";

export interface ReportFilterState {
  preset: ReportPeriodPreset;
  month: string;
  from: string;
  to: string;
  zone: string;
  sellerId: string;
}

export const INITIAL_REPORT_FILTERS: ReportFilterState = {
  preset: "ALL",
  month: "",
  from: "",
  to: "",
  zone: "",
  sellerId: "",
};

export const REPORT_TAB_ITEMS: Array<{
  id: ReportSectionId;
  label: string;
  subtitle: string;
  concepts: Array<{ term: string; meaning: string }>;
}> = [
  {
    id: "resumen",
    label: "Resumen",
    subtitle: "Ventas, margen conocido y movimientos de caja registrados",
    concepts: [
      {
        term: "Resultado parcial",
        meaning:
          "Ventas con costo conocido menos mercadería y gastos de ruta registrados.",
      },
      {
        term: "Margen bruto",
        meaning: "Venta con costo conocido menos costo de mercadería.",
      },
      {
        term: "Contribución de ruta",
        meaning:
          "Margen bruto menos gastos de ruta. No incluye todos los gastos del negocio.",
      },
      {
        term: "Movimiento neto estimado",
        meaning:
          "Pagos acumulados en pedidos menos salidas registradas; requiere conciliación.",
      },
    ],
  },
  {
    id: "caja_cxp",
    label: "Caja y CxP",
    subtitle: "Saldos registrados vs. vencimientos 7/15/30d",
    concepts: [
      {
        term: "Saldo registrado",
        meaning: "Movimientos acumulados en el ERP; requiere conciliación bancaria.",
      },
      { term: "CxP", meaning: "Deudas pendientes con proveedores." },
      { term: "Vencimiento", meaning: "Fecha límite prevista para pagar." },
      {
        term: "Cobertura",
        meaning: "Cuánto de los compromisos cubren los saldos registrados.",
      },
    ],
  },
  {
    id: "cartera",
    label: "Cartera",
    subtitle: "Aging, DSO y hoja de cobranza",
    concepts: [
      { term: "CxC", meaning: "Saldo que los clientes aún deben pagar." },
      { term: "Aging", meaning: "Antigüedad de cada saldo pendiente." },
      {
        term: "DSO",
        meaning: "Días promedio estimados para convertir ventas en cobros.",
      },
      { term: "Promesa vencida", meaning: "Compromiso de pago cuya fecha ya pasó." },
    ],
  },
  {
    id: "comercial",
    label: "Comercial",
    subtitle: "Zonas, vendedores, viajes y descuentos",
    concepts: [
      { term: "Margen", meaning: "Venta menos costo conocido del producto." },
      {
        term: "Contribución de ruta",
        meaning: "Margen generado menos gasto operativo del viaje.",
      },
      { term: "Descuento", meaning: "Diferencia frente al precio de referencia." },
      { term: "Viaje", meaning: "Salida comercial u operativa asociada a una ruta." },
    ],
  },
  {
    id: "stock",
    label: "Stock",
    subtitle: "Valorización, cobertura y stock muerto",
    concepts: [
      {
        term: "Valorización",
        meaning: "Stock disponible multiplicado por su costo de referencia.",
      },
      {
        term: "Cobertura",
        meaning: "Días estimados que durará el inventario al ritmo reciente.",
      },
      {
        term: "Stock muerto",
        meaning: "Producto disponible sin movimiento de venta reciente.",
      },
      {
        term: "Capital inmovilizado",
        meaning: "Dinero invertido en inventario con baja rotación.",
      },
    ],
  },
  {
    id: "auditoria",
    label: "Auditoría",
    subtitle: "Semáforo de cierre y exportaciones",
    concepts: [
      {
        term: "Semáforo",
        meaning: "Estado de los controles necesarios para un cierre confiable.",
      },
      {
        term: "Brecha",
        meaning: "Dato faltante o inconsistente que requiere revisión.",
      },
      {
        term: "CSV",
        meaning: "Archivo descargable para revisar o trabajar los datos.",
      },
      {
        term: "Cierre",
        meaning: "Revisión final de consistencia antes de usar las cifras.",
      },
    ],
  },
];

export const REPORT_CSV_CARDS = [
  {
    id: "ventas_pedidos",
    title: "1. Ventas y Pedidos",
    subtitle: "Órdenes, zonas, clientes, cobros, saldos y responsables",
    supportsDateFilter: true,
    supportsZoneFilter: true,
  },
  {
    id: "deudores_cartera",
    title: "2. Cartera de Deudores",
    subtitle: "Saldos por cobrar, antigüedad, zona y fechas pactadas",
    supportsDateFilter: true,
    supportsZoneFilter: true,
  },
  {
    id: "margen_productos",
    title: "3. Inventario, Costos y Márgenes",
    subtitle: "Catálogo, stock actual, costos conocidos y alertas",
    supportsDateFilter: false,
    supportsZoneFilter: false,
  },
  {
    id: "flujo_caja_egresos",
    title: "4. Movimientos de Caja y Egresos",
    subtitle: "Ingresos, OpEx ruta, compras, retiros y depósitos registrados",
    supportsDateFilter: true,
    supportsZoneFilter: false,
  },
  {
    id: "proveedores_cxp",
    title: "5. Cuentas por Pagar Proveedores",
    subtitle: "Obligaciones abiertas, parciales y pagadas por proveedor",
    supportsDateFilter: true,
    supportsZoneFilter: false,
  },
  {
    id: "valorizacion_inventario_corte",
    title: "6. Valorización Inventario Corte (Kardex)",
    subtitle: "Stock positivo valorizado, cobertura 90d y stock muerto",
    supportsDateFilter: false,
    supportsZoneFilter: false,
  },
  {
    id: "aging_cxc_cxp_corte",
    title: "7. Antigüedad CxC y CxP al Corte",
    subtitle: "Libro combinado de saldos por cobrar y pagar con tramos",
    supportsDateFilter: true,
    supportsZoneFilter: true,
  },
] as const;

export interface ReportFilterOptionsDto {
  zones: string[];
  sellers: Array<{ user_id: number; full_name: string }>;
  months: string[];
}

export interface ReportMonthlyPnlDto {
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

export interface ReportResumenDto {
  filterOptions: ReportFilterOptionsDto;
  dataCut?: DataCutSummary;
  pnlMonthly: ReportMonthlyPnlDto[];
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

export type ApMaturityBucketId =
  "OVERDUE" | "DUE_0_7" | "DUE_8_15" | "DUE_16_30" | "DUE_31_PLUS" | "NO_DUE_DATE";

export interface ReportCajaCxpDto {
  filterOptions: ReportFilterOptionsDto;
  dataCut?: DataCutSummary;
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
  apMaturityBuckets: Array<{
    bucket: ApMaturityBucketId;
    docsCount: number;
    balanceDuePen: number;
  }>;
  upcomingApDocs: Array<{
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
    maturity_bucket: ApMaturityBucketId;
  }>;
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

export type ArAgingBucketId = "0_15" | "16_30" | "31_60" | "GT_60";

export interface ReportCarteraDto {
  filterOptions: ReportFilterOptionsDto;
  dataCut?: DataCutSummary;
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
  agingBuckets: Array<{
    bucket: ArAgingBucketId;
    ordersCount: number;
    balanceDuePen: number;
  }>;
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
  collectionSheet: Array<{
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
    ar_bucket: ArAgingBucketId;
    promised_payment_date: string | null;
    promise_status: string;
    created_by_name: string | null;
  }>;
}

export interface ReportComercialDto {
  filterOptions: ReportFilterOptionsDto;
  dataCut?: DataCutSummary;
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

export interface ReportStockSkuDto {
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

export interface ReportStockDto {
  filterOptions: ReportFilterOptionsDto;
  dataCut?: DataCutSummary;
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
  deadAndSlowStock: ReportStockSkuDto[];
  replenishmentAlerts: ReportStockSkuDto[];
  onDemandCandidates: ReportStockSkuDto[];
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

export interface ReportAuditoriaDto {
  filterOptions: ReportFilterOptionsDto;
  dataCut?: DataCutSummary;
  operationalQuality?: OperationalQualitySummary;
  closingReadiness: {
    status: "READY" | "ATTENTION" | "BLOCKED";
    checks: Array<{
      code: string;
      label: string;
      count: number;
      severity: "BLOCKING" | "WARNING" | "OK";
      detail: string;
    }>;
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

export function getLimaTodayIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function shiftIsoDays(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d + deltaDays);
  const dt = new Date(utc);
  return dt.toISOString().slice(0, 10);
}

export function computeMonthRange(periodMonth: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}/.test(periodMonth)) return { from: "", to: "" };
  const y = Number(periodMonth.slice(0, 4));
  const m = Number(periodMonth.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return { from: "", to: "" };
  }
  const firstDay = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const lastDayDate = new Date(Date.UTC(y, m, 0));
  return {
    from: firstDay,
    to: lastDayDate.toISOString().slice(0, 10),
  };
}

export function computePeriodRange(
  preset: Exclude<ReportPeriodPreset, "MONTH" | "CUSTOM">,
  referenceDate = getLimaTodayIso()
): { from: string; to: string } {
  if (preset === "ALL") return { from: "", to: "" };
  if (preset === "THIS_MONTH") {
    return {
      from: `${referenceDate.slice(0, 7)}-01`,
      to: referenceDate,
    };
  }
  if (preset === "LAST_30D") {
    return {
      from: shiftIsoDays(referenceDate, -29),
      to: referenceDate,
    };
  }
  return {
    from: shiftIsoDays(referenceDate, -89),
    to: referenceDate,
  };
}

export function buildReportQueryString(
  filters: Pick<ReportFilterState, "from" | "to" | "zone" | "sellerId">,
  options?: { includeSeller?: boolean; includeZone?: boolean }
): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (options?.includeZone !== false && filters.zone) {
    params.set("zone", filters.zone);
  }
  if (options?.includeSeller !== false && filters.sellerId) {
    params.set("sellerId", filters.sellerId);
  }
  return params.toString();
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "-";
  }
  return `${Number(value).toFixed(digits)}%`;
}

export function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "Sin rotación";
  }
  return `${Math.round(Number(value))} d`;
}

const MATURITY_BUCKET_LABELS_ES: Record<ApMaturityBucketId, string> = {
  OVERDUE: "Vencidas",
  DUE_0_7: "Vencen 0–7 d",
  DUE_8_15: "Vencen 8–15 d",
  DUE_16_30: "Vencen 16–30 d",
  DUE_31_PLUS: "Mayor a 30 d",
  NO_DUE_DATE: "Sin fecha pactada",
};

export function formatMaturityBucketEs(bucket: string): string {
  return MATURITY_BUCKET_LABELS_ES[bucket as ApMaturityBucketId] ?? bucket;
}

const AR_BUCKET_LABELS_ES: Record<ArAgingBucketId, string> = {
  "0_15": "0–15 días",
  "16_30": "16–30 días",
  "31_60": "31–60 días",
  GT_60: "> 60 días",
};

export function formatArBucketEs(bucket: string): string {
  return AR_BUCKET_LABELS_ES[bucket as ArAgingBucketId] ?? bucket;
}

const DEAD_STOCK_LABELS_ES: Record<string, string> = {
  DEAD_90D: "Stock muerto (≥90d)",
  SLOW_60D: "Lento (60–89d)",
  LOW_COVERAGE: "Baja cobertura",
  NEGATIVE_STOCK: "Saldo negativo",
  HEALTHY: "Saludable",
  NO_STOCK: "Sin stock",
};

export function formatDeadStockStatusEs(status: string): string {
  return DEAD_STOCK_LABELS_ES[status] ?? status;
}

const INACTIVITY_LABELS_ES: Record<string, string> = {
  GT_60D: "> 60 días",
  "46_60D": "46–60 días",
  "31_45D": "31–45 días",
  ACTIVE: "Activo (< 31d)",
};

export function formatInactivityTierEs(tier: string): string {
  return INACTIVITY_LABELS_ES[tier] ?? tier;
}

const CLOSING_STATUS_ES: Record<
  string,
  { label: string; tone: "success" | "warning" | "danger" }
> = {
  READY: { label: "Listo para Cierre", tone: "success" },
  ATTENTION: { label: "Cierre con Observaciones", tone: "warning" },
  BLOCKED: { label: "Bloqueado (Faltan Costos / Críticas)", tone: "danger" },
};

export function formatClosingStatusEs(status: string): {
  label: string;
  tone: "success" | "warning" | "danger";
} {
  return CLOSING_STATUS_ES[status] ?? { label: status, tone: "warning" };
}
