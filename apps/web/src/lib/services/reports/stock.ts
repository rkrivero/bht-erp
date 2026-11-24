import type { PoolClient } from "pg";
import { DATA_CUT_SELECT, mapDataCutSummary } from "../operational-quality";
import { FILTER_OPTIONS_SELECT, mapFilterOptions, toNum, toOptNum } from "./shared";
import type { ReportFilters, ReportStockData, ReportStockSkuRow } from "./types";

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

export async function queryStock(
  client: PoolClient,
  filters: ReportFilters
): Promise<ReportStockData> {
  void filters;
  const res = await client.query<{
    filter_options: unknown;
    data_cut: unknown;
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
       ${DATA_CUT_SELECT} AS data_cut,
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
    dataCut: mapDataCutSummary(row?.data_cut),
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
