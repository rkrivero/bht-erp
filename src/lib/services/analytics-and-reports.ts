import type { PoolClient } from "pg";
import { ValidationError } from "../types";

export const REPORT_CSV_DATASETS = [
  "ventas_pedidos",
  "deudores_cartera",
  "margen_productos",
  "flujo_caja_egresos",
  "proveedores_cxp",
  "valorizacion_inventario_corte",
  "aging_cxc_cxp_corte",
] as const;

export type ReportCsvDataset = (typeof REPORT_CSV_DATASETS)[number];
export type ReportDataset = "bi_summary" | ReportCsvDataset;

export interface ReportCsvFilters {
  from?: string;
  to?: string;
  zone?: string;
}

export interface BiMonthlyPerformanceRow {
  period_month: string;
  order_count: number;
  sales_total_pen: number;
  cash_collected_pen: number;
  ar_pending_pen: number;
  route_opex_pen: number;
  merchandise_outflow_pen: number;
  non_opex_capex_drain_pen: number;
  internal_deposits_pen: number;
  pre_route_foundational_outflow_pen: number;
}

export interface BiCashAccountRow {
  account_id: number;
  code: string;
  name: string;
  account_type: string;
  total_in_pen: number;
  total_out_pen: number;
  net_balance_pen: number;
}

export interface BiTopCustomerRow {
  customer_party_id: number | null;
  customer_name: string;
  orders_count: number;
  total_sold_pen: number;
  total_paid_pen: number;
  total_due_pen: number;
}

export interface BiLowStockAlertRow {
  product_id: number;
  sku: string;
  name: string;
  stock_on_hand: number;
  unit_of_measure: string;
  total_units_sold: number;
  ref_cost_pen: number | null;
}

export interface BiMarginRiskSkuRow {
  product_id: number;
  sku: string;
  product_name: string;
  fulfillment_mode: string;
  total_units_sold: number;
  total_revenue_pen: number;
  avg_unit_sale_price_pen: number | null;
  ref_cost_pen: number | null;
  known_cogs_pen: number;
  real_gross_margin_pen: number | null;
  real_gross_margin_pct: number | null;
  low_margin_below_20pct_alert: boolean;
  missing_cost_alert: boolean;
}

export interface BiApSupplierSummaryRow {
  supplier_party_id: number | null;
  supplier_name: string;
  open_docs_count: number;
  total_billed_pen: number;
  total_paid_pen: number;
  total_balance_due_pen: number;
}

export interface BiSummary {
  monthlyPerformance: BiMonthlyPerformanceRow[];
  cashAccountsSummary: BiCashAccountRow[];
  topCustomers: BiTopCustomerRow[];
  lowStockAlerts: BiLowStockAlertRow[];
  marginRiskSkus: BiMarginRiskSkuRow[];
  apSummaryBySupplier: BiApSupplierSummaryRow[];
}

export function isReportCsvDataset(value: string): value is ReportCsvDataset {
  return (REPORT_CSV_DATASETS as readonly string[]).includes(value);
}

/** Escape a single cell according to RFC-4180 CSV rules with formula-injection protection. */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  const isNumericPrimitive = typeof value === "number" && Number.isFinite(value);
  const isPureNumericString =
    !isNumericPrimitive && /^-?\d+(?:\.\d+)?$/.test(str.trim());
  const safeStr =
    !isNumericPrimitive && !isPureNumericString && /^[\t\r\n ]*[=+\-@\t\r\n]/.test(str)
      ? `'${str}`
      : str;
  if (/[",\r\n]/.test(safeStr)) {
    return `"${safeStr.replace(/"/g, '""')}"`;
  }
  return safeStr;
}

/** Build an Excel-compatible UTF-8 BOM CSV string with CRLF line endings. */
export function buildCsvWithBom(
  headers: string[],
  rows: Array<Record<string, unknown>>
): string {
  const headerLine = headers.map((h) => escapeCsvCell(h)).join(",");
  const dataLines = rows.map((row) =>
    headers.map((h) => escapeCsvCell(row[h])).join(",")
  );
  return "\uFEFF" + [headerLine, ...dataLines].join("\r\n") + "\r\n";
}

/** Fetch all 6 BI summary panels used by the Partner dashboard in a single DB roundtrip set. */
export const BI_SOLD_QTY_CTE = `sold_qty AS (
  SELECT
    sol.product_id,
    COALESCE(SUM(sol.quantity * sol.pack_factor_applied), 0)::numeric(14,4) AS total_units_sold
  FROM erp.sales_order_lines sol
  JOIN erp.sales_orders so ON so.order_id = sol.order_id
  WHERE so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
  GROUP BY sol.product_id
)`;

export const BI_NON_MONTHLY_SELECTS = `
  COALESCE((
    SELECT json_agg(t)
    FROM (
      SELECT
        ca.account_id,
        ca.code,
        ca.name,
        ca.account_type,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'IN'), 0)::numeric(14,2) AS total_in_pen,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT'), 0)::numeric(14,2) AS total_out_pen
      FROM erp.cash_accounts ca
      LEFT JOIN erp.cash_ledger cl ON cl.account_id = ca.account_id
      WHERE ca.is_active = TRUE
      GROUP BY ca.account_id, ca.code, ca.name, ca.account_type
      ORDER BY ca.account_id ASC
    ) t
  ), '[]'::json) AS cash_accounts_summary,
  COALESCE((
    SELECT json_agg(t)
    FROM (
      SELECT
        MAX(so.customer_party_id) AS customer_party_id,
        COALESCE(pa.trade_name, pa.legal_name, so.customer_name_raw, 'CLIENTE SIN NOMBRE') AS customer_name,
        COUNT(*)::int AS orders_count,
        COALESCE(SUM(so.total_pen), 0)::numeric(14,2) AS total_sold_pen,
        COALESCE(SUM(so.paid_pen), 0)::numeric(14,2) AS total_paid_pen,
        COALESCE(SUM(so.balance_due_pen), 0)::numeric(14,2) AS total_due_pen
      FROM erp.sales_orders so
      LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
      WHERE so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
      GROUP BY COALESCE(pa.trade_name, pa.legal_name, so.customer_name_raw, 'CLIENTE SIN NOMBRE')
      ORDER BY total_sold_pen DESC, customer_name ASC
      LIMIT 15
    ) t
  ), '[]'::json) AS top_customers,
  COALESCE((
    SELECT json_agg(t)
    FROM (
      SELECT
        p.product_id,
        p.sku,
        p.name,
        COALESCE(vcs.stock_on_hand, 0)::numeric(14,4) AS stock_on_hand,
        p.unit_of_measure,
        COALESCE(sq.total_units_sold, 0)::numeric(14,4) AS total_units_sold,
        p.ref_cost_pen
      FROM erp.products p
      JOIN erp.warehouses w ON w.code = 'MAIN' AND w.is_active = TRUE
      LEFT JOIN erp.v_current_stock vcs
        ON vcs.warehouse_id = w.warehouse_id
       AND vcs.product_id = p.product_id
      LEFT JOIN sold_qty sq ON sq.product_id = p.product_id
      WHERE p.is_active = TRUE
        AND p.fulfillment_mode = 'STOCKED'
        AND COALESCE(vcs.stock_on_hand, 0) <= 5
      ORDER BY COALESCE(sq.total_units_sold, 0) DESC, COALESCE(vcs.stock_on_hand, 0) ASC, p.product_id ASC
      LIMIT 25
    ) t
  ), '[]'::json) AS low_stock_alerts,
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
        avg_unit_sale_price_pen,
        ref_cost_pen,
        known_cogs_pen,
        real_gross_margin_pen,
        real_gross_margin_pct,
        low_margin_below_20pct_alert,
        missing_cost_alert
      FROM analytics.v_kpi_sku_margin_and_opex
      WHERE missing_cost_alert = TRUE OR low_margin_below_20pct_alert = TRUE
      ORDER BY total_revenue_pen DESC, product_id ASC
      LIMIT 25
    ) t
  ), '[]'::json) AS margin_risk_skus,
  COALESCE((
    SELECT json_agg(t)
    FROM (
      SELECT
        ap.supplier_party_id,
        COALESCE(pa.trade_name, pa.legal_name, 'Proveedor sin especificar') AS supplier_name,
        COUNT(*) FILTER (WHERE ap.status IN ('OPEN', 'PARTIAL') AND ap.balance_due_pen > 0.05)::int AS open_docs_count,
        COALESCE(SUM(ap.original_amount_pen), 0)::numeric(14,2) AS total_billed_pen,
        COALESCE(SUM(ap.paid_amount_pen), 0)::numeric(14,2) AS total_paid_pen,
        COALESCE(SUM(CASE WHEN ap.status IN ('OPEN', 'PARTIAL') AND ap.balance_due_pen > 0.05 THEN ap.balance_due_pen ELSE 0 END), 0)::numeric(14,2) AS total_balance_due_pen
      FROM erp.ap_obligations ap
      LEFT JOIN erp.parties pa ON pa.party_id = ap.supplier_party_id
      WHERE ap.status <> 'CANCELLED'
      GROUP BY ap.supplier_party_id, COALESCE(pa.trade_name, pa.legal_name, 'Proveedor sin especificar')
      ORDER BY total_balance_due_pen DESC, total_billed_pen DESC
    ) t
  ), '[]'::json) AS ap_summary_by_supplier`;

export interface BiNonMonthlyPanelsRow {
  cash_accounts_summary: Array<Record<string, unknown>>;
  top_customers: Array<Record<string, unknown>>;
  low_stock_alerts: Array<Record<string, unknown>>;
  margin_risk_skus: Array<Record<string, unknown>>;
  ap_summary_by_supplier: Array<Record<string, unknown>>;
}

type BiSummaryRow = BiNonMonthlyPanelsRow & {
  monthly_performance: Array<Record<string, unknown>>;
};

export function mapBiMonthlyRows(
  rows: Array<Record<string, unknown>>
): BiMonthlyPerformanceRow[] {
  return rows.map((r) => ({
    period_month: String(r.period_month),
    order_count: Number(r.order_count ?? 0),
    sales_total_pen: Number(r.sales_total_pen ?? 0),
    cash_collected_pen: Number(r.cash_collected_pen ?? 0),
    ar_pending_pen: Number(r.ar_pending_pen ?? 0),
    route_opex_pen: Number(r.route_opex_pen ?? 0),
    merchandise_outflow_pen: Number(r.merchandise_outflow_pen ?? 0),
    non_opex_capex_drain_pen: Number(r.non_opex_capex_drain_pen ?? 0),
    internal_deposits_pen: Number(r.internal_deposits_pen ?? 0),
    pre_route_foundational_outflow_pen: Number(
      r.pre_route_foundational_outflow_pen ?? 0
    ),
  }));
}

export function mapBiSummaryFromPanels(
  bundle: Partial<BiNonMonthlyPanelsRow>,
  monthlyPerformance: BiMonthlyPerformanceRow[]
): BiSummary {
  return {
    monthlyPerformance,
    cashAccountsSummary: (bundle.cash_accounts_summary ?? []).map((r) => {
      const totalIn = Number(r.total_in_pen ?? 0);
      const totalOut = Number(r.total_out_pen ?? 0);
      return {
        account_id: Number(r.account_id),
        code: String(r.code),
        name: String(r.name),
        account_type: String(r.account_type),
        total_in_pen: totalIn,
        total_out_pen: totalOut,
        net_balance_pen: Number((totalIn - totalOut).toFixed(2)),
      };
    }),
    topCustomers: (bundle.top_customers ?? []).map((r) => ({
      customer_party_id:
        r.customer_party_id !== null && r.customer_party_id !== undefined
          ? Number(r.customer_party_id)
          : null,
      customer_name: String(r.customer_name),
      orders_count: Number(r.orders_count ?? 0),
      total_sold_pen: Number(r.total_sold_pen ?? 0),
      total_paid_pen: Number(r.total_paid_pen ?? 0),
      total_due_pen: Number(r.total_due_pen ?? 0),
    })),
    lowStockAlerts: (bundle.low_stock_alerts ?? []).map((r) => ({
      product_id: Number(r.product_id),
      sku: String(r.sku),
      name: String(r.name),
      stock_on_hand: Number(r.stock_on_hand ?? 0),
      unit_of_measure: String(r.unit_of_measure),
      total_units_sold: Number(r.total_units_sold ?? 0),
      ref_cost_pen:
        r.ref_cost_pen !== null && r.ref_cost_pen !== undefined
          ? Number(r.ref_cost_pen)
          : null,
    })),
    marginRiskSkus: (bundle.margin_risk_skus ?? []).map((r) => ({
      product_id: Number(r.product_id),
      sku: String(r.sku),
      product_name: String(r.product_name),
      fulfillment_mode: String(r.fulfillment_mode),
      total_units_sold: Number(r.total_units_sold ?? 0),
      total_revenue_pen: Number(r.total_revenue_pen ?? 0),
      avg_unit_sale_price_pen:
        r.avg_unit_sale_price_pen !== null && r.avg_unit_sale_price_pen !== undefined
          ? Number(r.avg_unit_sale_price_pen)
          : null,
      ref_cost_pen:
        r.ref_cost_pen !== null && r.ref_cost_pen !== undefined
          ? Number(r.ref_cost_pen)
          : null,
      known_cogs_pen: Number(r.known_cogs_pen ?? 0),
      real_gross_margin_pen:
        r.real_gross_margin_pen !== null && r.real_gross_margin_pen !== undefined
          ? Number(r.real_gross_margin_pen)
          : null,
      real_gross_margin_pct:
        r.real_gross_margin_pct !== null && r.real_gross_margin_pct !== undefined
          ? Number(r.real_gross_margin_pct)
          : null,
      low_margin_below_20pct_alert: Boolean(r.low_margin_below_20pct_alert),
      missing_cost_alert: Boolean(r.missing_cost_alert),
    })),
    apSummaryBySupplier: (bundle.ap_summary_by_supplier ?? []).map((r) => ({
      supplier_party_id:
        r.supplier_party_id !== null && r.supplier_party_id !== undefined
          ? Number(r.supplier_party_id)
          : null,
      supplier_name: String(r.supplier_name),
      open_docs_count: Number(r.open_docs_count ?? 0),
      total_billed_pen: Number(r.total_billed_pen ?? 0),
      total_paid_pen: Number(r.total_paid_pen ?? 0),
      total_balance_due_pen: Number(r.total_balance_due_pen ?? 0),
    })),
  };
}

export async function getBiSummary(client: PoolClient): Promise<BiSummary> {
  // Batch all 6 independent BI aggregates into one round-trip on the caller's client
  // so it works inside transactions and avoids pg@9 single-client Promise.all deprecation.
  const res = await client.query<BiSummaryRow>(
    `WITH ${BI_SOLD_QTY_CTE}
     SELECT
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             period_month::text AS period_month,
             order_count,
             sales_total_pen,
             cash_collected_pen,
             ar_pending_pen,
             route_opex_pen,
             merchandise_outflow_pen,
             non_opex_capex_drain_pen,
             internal_deposits_pen,
             pre_route_foundational_outflow_pen
           FROM analytics.v_kpi_cash_and_reinvestment
           ORDER BY period_month ASC
         ) t
       ), '[]'::json) AS monthly_performance,
       ${BI_NON_MONTHLY_SELECTS}`
  );

  const bundle = res.rows[0] ?? {};
  return mapBiSummaryFromPanels(
    bundle,
    mapBiMonthlyRows(bundle.monthly_performance ?? [])
  );
}

function buildSqlFilters(
  filters: ReportCsvFilters | undefined,
  cols: { fromCol?: string; toCol?: string; zoneExpr?: string },
  initialParams: unknown[] = []
): { whereSql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params = [...initialParams];
  const pushParam = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters?.from && cols.fromCol) {
    clauses.push(`${cols.fromCol} >= ${pushParam(filters.from)}::date`);
  }
  if (filters?.to && cols.toCol) {
    clauses.push(`${cols.toCol} <= ${pushParam(filters.to)}::date`);
  }
  if (filters?.zone && cols.zoneExpr) {
    clauses.push(`${cols.zoneExpr} = ${pushParam(filters.zone)}`);
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

/** Query one of the 7 structured accountant/Excel export datasets. */
export async function getReportDatasetRows(
  client: PoolClient,
  dataset: ReportCsvDataset,
  filters?: ReportCsvFilters
): Promise<{ headers: string[]; rows: Array<Record<string, unknown>> }> {
  switch (dataset) {
    case "ventas_pedidos": {
      const zoneExpr =
        "COALESCE(NULLIF(BTRIM(pa.city_zone), ''), NULLIF(BTRIM(rt.zone_name), ''), 'Sin zona')";
      const { whereSql, params } = buildSqlFilters(filters, {
        fromCol: "so.order_date",
        toCol: "so.order_date",
        zoneExpr,
      });
      const res = await client.query(
        `SELECT
           so.order_id,
           so.order_code,
           so.order_date::text AS order_date,
           COALESCE(pa.trade_name, pa.legal_name, so.customer_name_raw, 'CLIENTE SIN NOMBRE') AS customer_name,
           so.payment_mode::text AS payment_mode,
           so.operational_status::text AS operational_status,
           so.total_pen,
           so.paid_pen,
           so.balance_due_pen,
           so.is_settled,
           so.promised_payment_date::text AS promised_payment_date,
           u_create.full_name AS created_by_name,
           u_app.full_name AS approved_by_name,
           u_pick.full_name AS picked_by_name,
           u_deliv.full_name AS delivered_by_name,
           so.source_origin::text AS source_origin,
           so.notes,
           ${zoneExpr} AS city_zone
         FROM erp.sales_orders so
         LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
         LEFT JOIN erp.route_trips rt ON rt.trip_id = so.trip_id
         LEFT JOIN erp.app_users u_create ON u_create.user_id = so.created_by_user_id
         LEFT JOIN erp.app_users u_app ON u_app.user_id = so.approved_by_user_id
         LEFT JOIN erp.app_users u_pick ON u_pick.user_id = so.picked_by_user_id
         LEFT JOIN erp.app_users u_deliv ON u_deliv.user_id = so.delivered_by_user_id
         ${whereSql}
         ORDER BY so.order_date DESC, so.order_id DESC`,
        params
      );
      return {
        headers: [
          "order_id",
          "order_code",
          "order_date",
          "customer_name",
          "payment_mode",
          "operational_status",
          "total_pen",
          "paid_pen",
          "balance_due_pen",
          "is_settled",
          "promised_payment_date",
          "created_by_name",
          "approved_by_name",
          "picked_by_name",
          "delivered_by_name",
          "source_origin",
          "notes",
          "city_zone",
        ],
        rows: res.rows,
      };
    }

    case "deudores_cartera": {
      const clauses: string[] = [
        "d.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')",
      ];
      const params: unknown[] = [];
      const pushParam = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      if (filters?.from) {
        clauses.push(`d.order_date >= ${pushParam(filters.from)}::date`);
      }
      if (filters?.to) {
        clauses.push(`d.order_date <= ${pushParam(filters.to)}::date`);
      }
      if (filters?.zone) {
        clauses.push(
          `COALESCE(det.effective_zone, 'Sin zona') = ${pushParam(filters.zone)}`
        );
      }
      const res = await client.query(
        `SELECT
           d.order_id,
           d.order_code,
           d.order_date::text AS order_date,
           d.customer_name,
           d.payment_mode,
           d.operational_status,
           d.total_pen,
           d.paid_pen,
           d.balance_due_pen,
           d.days_overdue,
           d.aging_bucket,
           d.promised_payment_date::text AS promised_payment_date,
           d.promise_status,
           d.payment_count,
           d.last_payment_date::text AS last_payment_date,
           d.created_by_name,
           COALESCE(det.effective_zone, 'Sin zona') AS effective_zone,
           det.ar_bucket
         FROM analytics.v_debtors_aging d
         LEFT JOIN analytics.v_report_ar_aging_detail det ON det.order_id = d.order_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY d.days_overdue DESC, d.order_id ASC`,
        params
      );
      return {
        headers: [
          "order_id",
          "order_code",
          "order_date",
          "customer_name",
          "payment_mode",
          "operational_status",
          "total_pen",
          "paid_pen",
          "balance_due_pen",
          "days_overdue",
          "aging_bucket",
          "promised_payment_date",
          "promise_status",
          "payment_count",
          "last_payment_date",
          "created_by_name",
          "effective_zone",
          "ar_bucket",
        ],
        rows: res.rows,
      };
    }

    case "margen_productos": {
      const res = await client.query(
        `SELECT
           p.product_id,
           p.sku,
           p.name,
           p.category,
           p.fulfillment_mode::text AS fulfillment_mode,
           p.unit_of_measure,
           COALESCE(vcs.stock_on_hand, 0)::numeric(14,4) AS stock_on_hand,
           p.list_sale_price_pen,
           p.min_sale_price_pen,
           p.ref_cost_pen,
           p.cost_source,
           COALESCE(km.total_units_sold, 0)::numeric(14,4) AS total_units_sold,
           COALESCE(km.total_revenue_pen, 0)::numeric(14,2) AS total_revenue_pen,
           COALESCE(km.known_cogs_pen, 0)::numeric(14,2) AS known_cogs_pen,
           km.real_gross_margin_pen,
           km.real_gross_margin_pct,
           CASE
             WHEN km.missing_cost_alert THEN 'SIN_COSTO'
             WHEN km.low_margin_below_20pct_alert THEN 'BAJO_20%'
             WHEN km.product_id IS NULL THEN 'SIN_VENTAS'
             ELSE 'OK_20%+'
           END AS margin_alert
         FROM erp.products p
         JOIN erp.warehouses w ON w.code = 'MAIN' AND w.is_active = TRUE
         LEFT JOIN erp.v_current_stock vcs
           ON vcs.warehouse_id = w.warehouse_id
          AND vcs.product_id = p.product_id
         LEFT JOIN analytics.v_kpi_sku_margin_and_opex km
           ON km.product_id = p.product_id
         WHERE p.is_active = TRUE
         ORDER BY COALESCE(km.total_revenue_pen, 0) DESC, p.name ASC`
      );
      return {
        headers: [
          "product_id",
          "sku",
          "name",
          "category",
          "fulfillment_mode",
          "unit_of_measure",
          "stock_on_hand",
          "list_sale_price_pen",
          "min_sale_price_pen",
          "ref_cost_pen",
          "cost_source",
          "total_units_sold",
          "total_revenue_pen",
          "known_cogs_pen",
          "real_gross_margin_pen",
          "real_gross_margin_pct",
          "margin_alert",
        ],
        rows: res.rows,
      };
    }

    case "flujo_caja_egresos": {
      const { whereSql, params } = buildSqlFilters(filters, {
        fromCol: "cl.tx_date",
        toCol: "cl.tx_date",
      });
      const res = await client.query(
        `SELECT
           cl.ledger_id,
           cl.tx_date::text AS tx_date,
           ca.code AS account_code,
           ca.name AS account_name,
           cl.direction::text AS direction,
           cl.amount_pen,
           cl.expense_bucket::text AS expense_bucket,
           cl.expense_category,
           cl.is_internal_transfer,
           cl.is_reversal,
           cl.reversal_of_ledger_id,
           EXISTS (
             SELECT 1 FROM erp.cash_ledger rev
             WHERE rev.reversal_of_ledger_id = cl.ledger_id
           ) AS is_reversed,
           COALESCE(pa.trade_name, pa.legal_name) AS party_name,
           cl.reference_table,
           cl.reference_id,
           cl.description,
           cl.source_origin::text AS source_origin
         FROM erp.cash_ledger cl
         JOIN erp.cash_accounts ca ON ca.account_id = cl.account_id
         LEFT JOIN erp.parties pa ON pa.party_id = cl.party_id
         ${whereSql}
         ORDER BY cl.tx_date DESC, cl.ledger_id DESC`,
        params
      );
      return {
        headers: [
          "ledger_id",
          "tx_date",
          "account_code",
          "account_name",
          "direction",
          "amount_pen",
          "expense_bucket",
          "expense_category",
          "is_internal_transfer",
          "is_reversal",
          "reversal_of_ledger_id",
          "is_reversed",
          "party_name",
          "reference_table",
          "reference_id",
          "description",
          "source_origin",
        ],
        rows: res.rows,
      };
    }

    case "proveedores_cxp": {
      const { whereSql, params } = buildSqlFilters(filters, {
        fromCol: "ap.issue_date",
        toCol: "ap.issue_date",
      });
      const res = await client.query(
        `SELECT
           ap.ap_id,
           ap.supplier_party_id,
           COALESCE(pa.trade_name, pa.legal_name, 'Proveedor sin especificar') AS supplier_name,
           pa.doc_number AS supplier_doc_number,
           ap.doc_ref,
           ap.obligation_type,
           ap.issue_date::text AS issue_date,
           ap.due_date::text AS due_date,
           ap.original_amount_pen,
           ap.paid_amount_pen,
           ap.balance_due_pen,
           ap.status::text AS status,
           ap.source_origin::text AS source_origin,
           ap.notes
         FROM erp.ap_obligations ap
         LEFT JOIN erp.parties pa ON pa.party_id = ap.supplier_party_id
         ${whereSql}
         ORDER BY
           CASE WHEN ap.status IN ('OPEN', 'PARTIAL') THEN 0 ELSE 1 END ASC,
           ap.balance_due_pen DESC,
           ap.issue_date ASC`,
        params
      );
      return {
        headers: [
          "ap_id",
          "supplier_party_id",
          "supplier_name",
          "supplier_doc_number",
          "doc_ref",
          "obligation_type",
          "issue_date",
          "due_date",
          "original_amount_pen",
          "paid_amount_pen",
          "balance_due_pen",
          "status",
          "source_origin",
          "notes",
        ],
        rows: res.rows,
      };
    }

    case "valorizacion_inventario_corte": {
      const res = await client.query(
        `SELECT
           product_id,
           sku,
           product_name,
           category,
           fulfillment_mode,
           unit_of_measure,
           stock_on_hand,
           positive_stock_qty,
           ref_cost_pen,
           cost_source,
           valuation_pen,
           units_sold_90d,
           daily_velocity_90d,
           days_of_coverage,
           last_sale_date::text AS last_sale_date,
           days_since_last_sale,
           dead_stock_status
         FROM analytics.v_report_inventory_valuation
         ORDER BY valuation_pen DESC, revenue_total_pen DESC, product_id ASC`
      );
      return {
        headers: [
          "product_id",
          "sku",
          "product_name",
          "category",
          "fulfillment_mode",
          "unit_of_measure",
          "stock_on_hand",
          "positive_stock_qty",
          "ref_cost_pen",
          "cost_source",
          "valuation_pen",
          "units_sold_90d",
          "daily_velocity_90d",
          "days_of_coverage",
          "last_sale_date",
          "days_since_last_sale",
          "dead_stock_status",
        ],
        rows: res.rows,
      };
    }

    case "aging_cxc_cxp_corte": {
      const params: unknown[] = [];
      const arClauses: string[] = [];
      const apClauses: string[] = [];
      const pushParam = (value: unknown) => {
        params.push(value);
        return `$${params.length}`;
      };
      if (filters?.from) {
        const ref = pushParam(filters.from);
        arClauses.push(`order_date >= ${ref}::date`);
        apClauses.push(`issue_date >= ${ref}::date`);
      }
      if (filters?.to) {
        const ref = pushParam(filters.to);
        arClauses.push(`order_date <= ${ref}::date`);
        apClauses.push(`issue_date <= ${ref}::date`);
      }
      if (filters?.zone) {
        const ref = pushParam(filters.zone);
        arClauses.push(`effective_zone = ${ref}`);
      }
      const arWhere = arClauses.length > 0 ? `WHERE ${arClauses.join(" AND ")}` : "";
      const apWhere = apClauses.length > 0 ? `WHERE ${apClauses.join(" AND ")}` : "";

      const res = await client.query(
        `SELECT * FROM (
           SELECT
             'CXC'::text AS ledger_side,
             order_id AS doc_id,
             order_code AS doc_ref,
             order_date::text AS issue_date,
             due_date::text AS due_date,
             customer_party_id AS party_id,
             customer_name AS party_name,
             effective_zone AS city_zone,
             operational_status AS status,
             total_pen AS original_amount_pen,
             paid_pen AS paid_amount_pen,
             balance_due_pen,
             days_overdue AS days_reference,
             ar_bucket AS aging_bucket,
             promised_payment_date::text AS promised_payment_date,
             promise_status
           FROM analytics.v_report_ar_aging_detail
           ${arWhere}
           UNION ALL
           SELECT
             'CXP'::text AS ledger_side,
             ap_id AS doc_id,
             doc_ref,
             issue_date::text AS issue_date,
             due_date::text AS due_date,
             supplier_party_id AS party_id,
             supplier_name AS party_name,
             'Proveedor'::text AS city_zone,
             status,
             original_amount_pen,
             paid_amount_pen,
             balance_due_pen,
             days_to_due AS days_reference,
             maturity_bucket AS aging_bucket,
             due_date::text AS promised_payment_date,
             maturity_bucket AS promise_status
           FROM analytics.v_report_ap_maturity
           ${apWhere}
         ) combined
         ORDER BY ledger_side ASC, balance_due_pen DESC, doc_id ASC`,
        params
      );
      return {
        headers: [
          "ledger_side",
          "doc_id",
          "doc_ref",
          "issue_date",
          "due_date",
          "party_id",
          "party_name",
          "city_zone",
          "status",
          "original_amount_pen",
          "paid_amount_pen",
          "balance_due_pen",
          "days_reference",
          "aging_bucket",
          "promised_payment_date",
          "promise_status",
        ],
        rows: res.rows,
      };
    }

    default: {
      throw new ValidationError(`Dataset de reporte inválido: ${String(dataset)}`);
    }
  }
}
