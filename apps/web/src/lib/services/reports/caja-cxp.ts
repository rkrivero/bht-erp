import type { PoolClient } from "pg";
import { DATA_CUT_SELECT, mapDataCutSummary } from "../operational-quality";
import {
  FILTER_OPTIONS_SELECT,
  FilterParamBuilder,
  mapFilterOptions,
  toNum,
  toOptNum,
} from "./shared";
import type {
  ReportApDocRow,
  ReportApMaturityBucket,
  ReportCajaCxpData,
  ReportFilters,
} from "./types";

const AP_BUCKET_ORDER: ReportApMaturityBucket["bucket"][] = [
  "OVERDUE",
  "DUE_0_7",
  "DUE_8_15",
  "DUE_16_30",
  "DUE_31_PLUS",
  "NO_DUE_DATE",
];

export async function queryCajaCxp(
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
    data_cut: unknown;
    cash_accounts: Array<Record<string, unknown>>;
    ap_buckets: Array<Record<string, unknown>>;
    ap_docs: Array<Record<string, unknown>>;
    ap_suppliers: Array<Record<string, unknown>>;
    period_cash_mix: Record<string, unknown>;
  }>(
    `SELECT
       ${FILTER_OPTIONS_SELECT},
       ${DATA_CUT_SELECT} AS data_cut,
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
           'inflow_pen', COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.tx_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26') AND cl.direction = 'IN' AND NOT cl.is_internal_transfer), 0)::numeric(14,2),
           'merchandise_outflow_pen', COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.tx_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26') AND cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'MERCHANDISE_PAYMENT'), 0)::numeric(14,2),
           'route_opex_pen', COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.tx_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26') AND cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'ROUTE_OPEX'), 0)::numeric(14,2),
           'admin_opex_pen', COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.tx_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26') AND cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'ADMIN_OPEX'), 0)::numeric(14,2),
           'non_opex_drain_pen', COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.tx_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26') AND cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'NON_OPEX_OR_CAPEX'), 0)::numeric(14,2),
           'internal_transfers_pen', COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.tx_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26') AND cl.is_internal_transfer AND cl.direction = 'OUT'), 0)::numeric(14,2),
           'pre_route_outflow_pen', COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.tx_date < erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26') AND cl.direction = 'OUT' AND NOT cl.is_internal_transfer), 0)::numeric(14,2)
         )
         FROM erp.cash_ledger cl
         WHERE ${periodCond}
           AND NOT cl.is_reversal
           AND cl.expense_category IS DISTINCT FROM 'CONCILIACION_SALDO'
           AND NOT EXISTS (
             SELECT 1 FROM erp.cash_ledger rev
             WHERE rev.reversal_of_ledger_id = cl.ledger_id
           )
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
    dataCut: mapDataCutSummary(row?.data_cut),
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
