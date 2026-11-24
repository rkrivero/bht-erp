import type { PoolClient } from "pg";
import { DATA_CUT_SELECT, mapDataCutSummary } from "../operational-quality";
import {
  FILTER_OPTIONS_SELECT,
  FilterParamBuilder,
  mapFilterOptions,
  toNum,
} from "./shared";
import type {
  ReportArBucket,
  ReportArDocRow,
  ReportCarteraData,
  ReportFilters,
} from "./types";

const AR_BUCKET_ORDER: ReportArBucket["bucket"][] = ["0_15", "16_30", "31_60", "GT_60"];

export async function queryCartera(
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
    "so.order_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26')",
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
    data_cut: unknown;
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
       ${
         refToParam
           ? `SELECT ${refToParam}::date AS win_end`
           : `SELECT COALESCE(MAX(so.order_date), (NOW() AT TIME ZONE 'America/Lima')::date) AS win_end
       FROM erp.sales_orders so
       LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
       LEFT JOIN erp.route_trips rt ON rt.trip_id = so.trip_id
       WHERE ${refClauses.join(" AND ")}`
       }
     ),
     dso_window AS (
       SELECT
         COALESCE(${refFromParam ? `${refFromParam}::date` : "NULL::date"}, (da.win_end - 89)) AS win_start,
         da.win_end
       FROM dso_anchor da
     ),
     dso_sales AS (
       SELECT
         COALESCE(SUM(s.total_pen), 0)::numeric(14,2) AS ref_sales_pen,
         GREATEST(1, (dw.win_end - dw.win_start + 1))::int AS ref_days
       FROM dso_window dw
       LEFT JOIN (
         SELECT so.order_date, so.total_pen
         FROM erp.sales_orders so
         LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
         LEFT JOIN erp.route_trips rt ON rt.trip_id = so.trip_id
         WHERE ${refClauses.join(" AND ")}
       ) s ON s.order_date BETWEEN dw.win_start AND dw.win_end
       GROUP BY dw.win_end, dw.win_start
     )
     SELECT
       ${FILTER_OPTIONS_SELECT},
       ${DATA_CUT_SELECT} AS data_cut,
       (
         SELECT json_build_object(
           'total_receivable_pen', COALESCE(SUM(balance_due_pen), 0)::numeric(14,2),
           'open_orders_count', COUNT(*)::int,
           'open_customers_count', COUNT(DISTINCT COALESCE(customer_party_id::text, customer_name))::int,
           'overdue_gt_30_pen', COALESCE(SUM(balance_due_pen) FILTER (WHERE days_overdue > 30), 0)::numeric(14,2),
           'overdue_gt_60_pen', COALESCE(SUM(balance_due_pen) FILTER (WHERE days_overdue > 60), 0)::numeric(14,2),
           'broken_promises_count', COUNT(*) FILTER (WHERE promise_status = 'PROMISE_BROKEN')::int,
           'broken_promises_pen', COALESCE(SUM(balance_due_pen) FILTER (WHERE promise_status = 'PROMISE_BROKEN'), 0)::numeric(14,2),
           'avg_open_age_days', COALESCE(ROUND(SUM(balance_due_pen * days_overdue) / NULLIF(SUM(balance_due_pen), 0), 1), 0),
           'past_due_explicit_pen', COALESCE(SUM(balance_due_pen) FILTER (WHERE due_status = 'OVERDUE'), 0)::numeric(14,2),
           'no_due_date_pen', COALESCE(SUM(balance_due_pen) FILTER (WHERE due_status = 'NO_DUE_DATE'), 0)::numeric(14,2),
           'avg_invoice_age_days', COALESCE(ROUND(SUM(balance_due_pen * invoice_age_days) / NULLIF(SUM(balance_due_pen), 0), 1), 0)
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
             invoice_age_days,
             days_past_due,
             due_status,
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
    invoice_age_days: Number(r.invoice_age_days ?? r.days_overdue ?? 0),
    days_past_due:
      r.days_past_due !== null && r.days_past_due !== undefined
        ? Number(r.days_past_due)
        : null,
    due_status: String(r.due_status || "NO_DUE_DATE"),
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
    dataCut: mapDataCutSummary(row?.data_cut),
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
      pastDueExplicitPen: toNum(stats.past_due_explicit_pen),
      noDueDatePen: toNum(stats.no_due_date_pen),
      avgInvoiceAgeDays: toNum(stats.avg_invoice_age_days),
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
