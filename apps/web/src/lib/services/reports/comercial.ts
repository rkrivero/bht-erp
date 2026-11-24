import type { PoolClient } from "pg";
import { DATA_CUT_SELECT, mapDataCutSummary } from "../operational-quality";
import {
  FILTER_OPTIONS_SELECT,
  FilterParamBuilder,
  mapFilterOptions,
  toNum,
  toOptNum,
} from "./shared";
import type { ReportComercialData, ReportFilters } from "./types";

export async function queryComercial(
  client: PoolClient,
  filters: ReportFilters
): Promise<ReportComercialData> {
  const pb = new FilterParamBuilder();
  const orderClauses = [
    "so.order_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26')",
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
    data_cut: unknown;
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
         so.global_discount_pen,
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
         order_id,
         ROUND(COALESCE(SUM(net_line_total_pen) FILTER (WHERE has_cost), 0), 2)::numeric(14,2) AS cost_covered_sales_pen,
         ROUND(COALESCE(SUM(line_cogs_pen) FILTER (WHERE has_cost), 0), 2)::numeric(14,2) AS known_cogs_pen,
         ROUND(COALESCE(SUM(line_unit_discount_pen), 0) + COALESCE(MAX(global_discount_pen), 0), 2)::numeric(14,2) AS discount_total_pen
       FROM (
         SELECT
           sol.order_id,
           sco.global_discount_pen,
           (
             sol.line_total_pen * GREATEST(
               0::NUMERIC,
               1.0 - COALESCE(sco.global_discount_pen, 0)
                 / NULLIF(SUM(sol.line_total_pen) OVER (PARTITION BY sol.order_id), 0)
             )
           ) AS net_line_total_pen,
           (sol.quantity * sol.pack_factor_applied) * COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) AS line_cogs_pen,
           (COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL) AS has_cost,
           sol.quantity * COALESCE(sol.unit_discount_pen, 0) AS line_unit_discount_pen
         FROM erp.sales_order_lines sol
         JOIN scoped_orders sco ON sco.order_id = sol.order_id
         JOIN erp.products p ON p.product_id = sol.product_id
       ) ln
       GROUP BY order_id
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
       ${DATA_CUT_SELECT} AS data_cut,
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
    dataCut: mapDataCutSummary(row?.data_cut),
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
