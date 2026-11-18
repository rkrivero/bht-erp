export interface PartnerCatalogItem {
  product_id: number;
  sku: string;
  name: string;
  unit_of_measure: string;
  fulfillment_mode: "STOCKED" | "ON_DEMAND";
  stock_on_hand: number;
  list_sale_price_pen: number | null;
  min_sale_price_pen: number | null;
  ref_cost_pen: number | null;
}

export interface CurrentUserInfo {
  userId: number;
  username: string;
  fullName: string;
  role: string;
}

export interface CashAccountItem {
  account_id: number;
  code: string;
  name: string;
  account_type: string;
  current_balance_pen?: number | string;
  is_active?: boolean;
}

export interface CashLedgerEntry {
  ledger_id: number;
  tx_date: string;
  account_id?: number;
  account_code?: string;
  account_name: string;
  trip_id?: number | null;
  trip_code?: string | null;
  trip_zone?: string | null;
  party_name?: string | null;
  direction: string;
  amount_pen: number | string;
  expense_bucket: string | null;
  expense_category: string;
  is_internal_transfer: boolean;
  reference_table?: string | null;
  reference_id?: string | null;
  source_origin?: string | null;
  created_at?: string | null;
  description: string;
}

export interface PurchaseInvoiceLineItem {
  purchase_line_id: number;
  line_no: number;
  product_id: number | null;
  sku: string | null;
  raw_description: string;
  unit_of_measure: string;
  quantity: number | string;
  unit_cost_pen: number | string;
  line_total_pen: number | string;
}

export interface ApPaymentHistoryItem {
  ledger_id: number;
  tx_date: string;
  account_name: string;
  amount_pen: number | string;
  description: string;
}

export interface ApObligationItem {
  ap_id: number;
  purchase_id?: number | null;
  supplier_party_id: number | null;
  supplier_name: string;
  doc_ref: string;
  obligation_type?: string;
  doc_type?: string | null;
  expense_category?: string | null;
  issue_date: string;
  due_date?: string | null;
  original_amount_pen: number | string;
  paid_amount_pen: number | string;
  balance_due_pen: number | string;
  status: string;
  notes?: string | null;
  line_count?: number;
  lines?: PurchaseInvoiceLineItem[];
  payments?: ApPaymentHistoryItem[];
}

export interface SupplierItem {
  party_id: number;
  legal_name: string;
  trade_name?: string | null;
  doc_type?: string | null;
  doc_number?: string | null;
  phone?: string | null;
  address?: string | null;
  open_ap_balance_pen?: number | string;
  open_docs_count?: number;
}

export interface AuditFlagItem {
  flag_id: number;
  flag_code: string;
  severity: string;
  entity_table: string;
  entity_id: string;
  message: string;
  details?: Record<string, unknown>;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  source_origin: string;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

export interface AuditFlagCounts {
  open: number;
  acknowledged: number;
  resolved: number;
}

export interface RecentPurchaseItem {
  purchase_id: number;
  supplier_party_id?: number | null;
  supplier_name?: string;
  supplier_ruc?: string;
  doc_type: string;
  doc_series: string;
  doc_number: string;
  issue_date: string;
  due_date?: string | null;
  total_pen: number | string;
  expense_bucket?: string;
  expense_category?: string;
  line_count?: number;
  source_origin?: string;
  raw_notes?: string | null;
  lines?: PurchaseInvoiceLineItem[];
}

export interface PendingOnDemandItem {
  order_line_id: number;
  order_id: number;
  order_code: string;
  order_date: string;
  customer_name?: string;
  customer_name_raw?: string;
  product_id: number;
  sku: string;
  product_name: string;
  unit_of_measure?: string;
  quantity: number | string;
  required_base_qty?: number | string;
  current_stock_on_hand?: number | string;
  line_total_pen: number | string;
  fulfillment_status?: string;
  days_pending?: number;
}

export interface BiMonthlyRow {
  period_month: string;
  order_count?: number;
  sales_total_pen: number | string;
  cash_collected_pen: number | string;
  ar_pending_pen: number | string;
  route_opex_pen: number | string;
  merchandise_outflow_pen: number | string;
  non_opex_capex_drain_pen: number | string;
  internal_deposits_pen: number | string;
  pre_route_foundational_outflow_pen: number | string;
}

export interface BiCashAccountSummary {
  account_id: number;
  code: string;
  name: string;
  account_type: string;
  total_in_pen: number | string;
  total_out_pen: number | string;
  net_balance_pen: number | string;
}

export interface BiTopCustomer {
  customer_party_id?: number | null;
  customer_name: string;
  orders_count: number;
  total_sold_pen: number | string;
  total_paid_pen: number | string;
  total_due_pen: number | string;
}

export interface BiLowStockAlert {
  product_id: number;
  sku: string;
  name: string;
  stock_on_hand: number | string;
  unit_of_measure: string;
  total_units_sold: number | string;
  ref_cost_pen: number | string | null;
}

export interface BiMarginRiskSku {
  product_id?: number;
  sku: string;
  product_name: string;
  total_units_sold?: number | string;
  total_revenue_pen: number | string;
  ref_cost_pen?: number | string | null;
  real_gross_margin_pen?: number | string | null;
  real_gross_margin_pct?: number | string | null;
  low_margin_below_20pct_alert?: boolean;
  missing_cost_alert?: boolean;
}

export interface BiSupplierApSummary {
  supplier_party_id: number | null;
  supplier_name: string;
  open_docs_count: number;
  total_billed_pen: number | string;
  total_paid_pen: number | string;
  total_balance_due_pen: number | string;
}

export interface BiSummary {
  monthlyPerformance: BiMonthlyRow[];
  cashAccountsSummary: BiCashAccountSummary[];
  topCustomers: BiTopCustomer[];
  lowStockAlerts: BiLowStockAlert[];
  marginRiskSkus: BiMarginRiskSku[];
  apSummaryBySupplier: BiSupplierApSummary[];
}

export interface KpiQ1Summary {
  period_start: string;
  period_end: string;
  total_sales_pen: number;
  collected_sales_pen: number;
  accounts_receivable_pen: number;
  open_debtors_count?: number;
  route_opex_pen?: number;
  merchandise_outflow_pen?: number;
  non_opex_capex_drain_pen?: number;
  internal_deposits_pen?: number;
  pre_route_foundational_outflow_pen?: number;
  declared_net_cash_pen?: number;
  expected_net_cash_pen?: number;
  non_opex_vs_reinvestment_ratio_pct: number;
  reinvestment_health_flag: string;
  reconciliation_gap_pen: number;
  reconciliation_gap_pct: number;
  reconciliation_health_flag: string;
  monthlyRows?: BiMonthlyRow[];
}

export interface AppUserItem {
  user_id: number;
  username: string;
  full_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
}

export interface UserAccessAuditItem {
  audit_id: number;
  action: string;
  target_user_id: number;
  target_username: string;
  target_name: string;
  actor_username: string;
  actor_name: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown>;
  created_at: string;
}

export function formatPen(value: unknown): string {
  const num = Number(value ?? 0);
  const safe = Number.isFinite(num) ? num : 0;
  return `S/ ${safe.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatMonthLabel(periodMonth: string): string {
  if (!periodMonth) return "-";
  const clean = periodMonth.slice(0, 7);
  const [y, m] = clean.split("-");
  const months: Record<string, string> = {
    "01": "Ene",
    "02": "Feb",
    "03": "Mar",
    "04": "Abr",
    "05": "May",
    "06": "Jun",
    "07": "Jul",
    "08": "Ago",
    "09": "Sep",
    "10": "Oct",
    "11": "Nov",
    "12": "Dic",
  };
  return `${months[m] || m} ${y}`;
}
