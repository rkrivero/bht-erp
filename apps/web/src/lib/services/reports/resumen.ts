import type { PoolClient } from "pg";
import { DATA_CUT_SELECT, mapDataCutSummary } from "../operational-quality";
import {
  FILTER_OPTIONS_SELECT,
  FilterParamBuilder,
  mapFilterOptions,
  toNum,
  toOptNum,
} from "./shared";
import type { ReportFilters, ReportMonthlyPnlRow, ReportResumenData } from "./types";

export async function queryResumen(
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
        net_cash_flow_pen,
        admin_opex_pen,
        total_opex_pen,
        operating_result_pen,
        operating_result_pct,
        owner_salary_recorded_pen,
        owner_capex_debt_outflow_pen
      FROM analytics.v_report_monthly_pnl
      ORDER BY period_month ASC
    `;
  } else {
    const salesClauses = [
      "so.order_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26')",
      "so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')",
      ...pb.appendSalesFilters(filters, "so"),
    ];
    const collectionClauses = [
      "ap.voided_at IS NULL",
      "ap.payment_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26')",
      "so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')",
    ];
    if (filters.from) {
      collectionClauses.push(`ap.payment_date >= ${pb.add(filters.from)}::date`);
    }
    if (filters.to) {
      collectionClauses.push(`ap.payment_date <= ${pb.add(filters.to)}::date`);
    }
    if (filters.zone) {
      collectionClauses.push(
        `COALESCE(NULLIF(BTRIM(pa.city_zone), ''), NULLIF(BTRIM(rt.zone_name), ''), 'Sin zona') = ${pb.add(filters.zone)}`
      );
    }
    if (filters.sellerId === "UNASSIGNED") {
      collectionClauses.push("so.created_by_user_id IS NULL");
    } else if (filters.sellerId !== undefined) {
      collectionClauses.push(`so.created_by_user_id = ${pb.add(filters.sellerId)}`);
    }

    const activeCashGuards = [
      "NOT cl.is_reversal",
      "cl.expense_category IS DISTINCT FROM 'CONCILIACION_SALDO'",
      "NOT EXISTS (SELECT 1 FROM erp.cash_ledger rev WHERE rev.reversal_of_ledger_id = cl.ledger_id)",
    ];
    const cashClauses: string[] = [
      "cl.tx_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26')",
      ...activeCashGuards,
    ];
    const preRouteClauses: string[] = [
      "cl.tx_date < erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26')",
      ...activeCashGuards,
    ];
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

    const legacyAdminCatsSql = `'PAYROLL_ADVANCE', 'ACCOUNTING_OR_LEGAL', 'ACCOUNTING_SERVICE', 'LEGAL_NOTARIA', 'FINANCIAL_FEE', 'SUELDO_SOCIO', 'PLANILLA_PERSONAL', 'ALQUILER', 'SERVICIOS_BASICOS', 'IMPUESTOS_OPERATIVOS', 'SOFTWARE_OFICINA', 'OTROS_ADMIN'`;

    pnlSelectSql = `
      WITH filtered_orders AS (
        SELECT so.order_id, so.order_date, so.total_pen, so.global_discount_pen, so.paid_pen, so.balance_due_pen
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
          COALESCE(SUM(balance_due_pen), 0)::NUMERIC(14,2) AS ar_pending_pen
        FROM filtered_orders
        GROUP BY DATE_TRUNC('month', order_date)::DATE
      ),
      monthly_collections AS (
        SELECT
          DATE_TRUNC('month', ap.payment_date)::DATE AS period_month,
          COALESCE(SUM(ap.amount_pen), 0)::NUMERIC(14,2) AS effective_cash_collected_pen
        FROM erp.ar_payments ap
        JOIN erp.sales_orders so ON so.order_id = ap.order_id
        LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
        LEFT JOIN erp.route_trips rt ON rt.trip_id = so.trip_id
        WHERE ${collectionClauses.join(" AND ")}
        GROUP BY DATE_TRUNC('month', ap.payment_date)::DATE
      ),
      monthly_cogs AS (
        SELECT
          period_month,
          ROUND(COALESCE(SUM(net_line_total_pen) FILTER (WHERE has_cost), 0), 2)::NUMERIC(14,2) AS cost_covered_sales_pen,
          ROUND(COALESCE(SUM(line_cogs_pen) FILTER (WHERE has_cost), 0), 2)::NUMERIC(14,2) AS cogs_pen
        FROM (
          SELECT
            DATE_TRUNC('month', fo.order_date)::DATE AS period_month,
            (
              sol.line_total_pen * GREATEST(
                0::NUMERIC,
                1.0 - COALESCE(fo.global_discount_pen, 0)
                  / NULLIF(SUM(sol.line_total_pen) OVER (PARTITION BY sol.order_id), 0)
              )
            ) AS net_line_total_pen,
            (sol.quantity * sol.pack_factor_applied) * COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) AS line_cogs_pen,
            (COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL) AS has_cost
          FROM erp.sales_order_lines sol
          JOIN filtered_orders fo ON fo.order_id = sol.order_id
          JOIN erp.products p ON p.product_id = sol.product_id
        ) ln
        GROUP BY period_month
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
                : `COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND NOT cl.is_reversal AND cl.expense_category IS DISTINCT FROM 'CONCILIACION_SALDO' AND cl.expense_bucket = 'ROUTE_OPEX'${routeOpexZoneOnlyWhere}), 0)::NUMERIC(14,2)`
            } AS route_opex_pen,
            0::NUMERIC(14,2) AS admin_opex_bucket_pen,
            0::NUMERIC(14,2) AS legacy_admin_in_non_opex_pen,
            0::NUMERIC(14,2) AS owner_salary_recorded_pen,
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
            COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND NOT cl.is_reversal AND cl.expense_category IS DISTINCT FROM 'CONCILIACION_SALDO' AND cl.expense_bucket = 'MERCHANDISE_PAYMENT'), 0)::NUMERIC(14,2) AS merchandise_outflow_pen,
            COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND NOT cl.is_reversal AND cl.expense_category IS DISTINCT FROM 'CONCILIACION_SALDO' AND cl.expense_bucket = 'ROUTE_OPEX'), 0)::NUMERIC(14,2) AS route_opex_pen,
            COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND NOT cl.is_reversal AND cl.expense_category IS DISTINCT FROM 'CONCILIACION_SALDO' AND cl.expense_bucket = 'ADMIN_OPEX'), 0)::NUMERIC(14,2) AS admin_opex_bucket_pen,
            COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND NOT cl.is_reversal AND cl.expense_category IS DISTINCT FROM 'CONCILIACION_SALDO' AND cl.expense_bucket = 'NON_OPEX_OR_CAPEX' AND cl.expense_category IN (${legacyAdminCatsSql})), 0)::NUMERIC(14,2) AS legacy_admin_in_non_opex_pen,
            COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND NOT cl.is_reversal AND cl.expense_category = 'SUELDO_SOCIO'), 0)::NUMERIC(14,2) AS owner_salary_recorded_pen,
            COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND NOT cl.is_reversal AND cl.expense_category IS DISTINCT FROM 'CONCILIACION_SALDO' AND cl.expense_bucket = 'NON_OPEX_OR_CAPEX'), 0)::NUMERIC(14,2) AS non_opex_capex_drain_pen,
            COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.is_internal_transfer AND NOT cl.is_reversal AND cl.direction = 'OUT'), 0)::NUMERIC(14,2) AS internal_deposits_pen
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
        SELECT period_month FROM monthly_collections
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
          COALESCE(mcol.effective_cash_collected_pen, 0)::NUMERIC(14,2) AS cash_collected_pen,
          COALESCE(ms.ar_pending_pen, 0)::NUMERIC(14,2) AS ar_pending_pen,
          COALESCE(mc.merchandise_outflow_pen, 0)::NUMERIC(14,2) AS merchandise_outflow_pen,
          COALESCE(mc.non_opex_capex_drain_pen, 0)::NUMERIC(14,2) AS non_opex_capex_drain_pen,
          COALESCE(mc.internal_deposits_pen, 0)::NUMERIC(14,2) AS internal_deposits_pen,
          COALESCE(pr.pre_route_foundational_outflow_pen, 0)::NUMERIC(14,2) AS pre_route_foundational_outflow_pen,
          COALESCE(mc.admin_opex_bucket_pen, 0)::NUMERIC(14,2) AS admin_opex_bucket_pen,
          (COALESCE(mc.admin_opex_bucket_pen, 0) + COALESCE(mc.legacy_admin_in_non_opex_pen, 0))::NUMERIC(14,2) AS admin_opex_pen,
          COALESCE(mc.owner_salary_recorded_pen, 0)::NUMERIC(14,2) AS owner_salary_recorded_pen,
          GREATEST(COALESCE(mc.non_opex_capex_drain_pen, 0) - COALESCE(mc.legacy_admin_in_non_opex_pen, 0), 0)::NUMERIC(14,2) AS owner_capex_debt_outflow_pen
        FROM all_months m
        LEFT JOIN monthly_sales ms ON ms.period_month = m.period_month
        LEFT JOIN monthly_collections mcol ON mcol.period_month = m.period_month
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
        (j.cash_collected_pen - j.merchandise_outflow_pen - j.route_opex_pen - j.admin_opex_bucket_pen - j.non_opex_capex_drain_pen)::NUMERIC(14,2) AS net_cash_flow_pen,
        j.admin_opex_pen,
        (j.route_opex_pen + j.admin_opex_pen)::NUMERIC(14,2) AS total_opex_pen,
        (j.gross_margin_pen - j.route_opex_pen - j.admin_opex_pen)::NUMERIC(14,2) AS operating_result_pen,
        ROUND((j.gross_margin_pen - j.route_opex_pen - j.admin_opex_pen) * 100.0 / NULLIF(j.cost_covered_sales_pen, 0), 2) AS operating_result_pct,
        j.owner_salary_recorded_pen,
        j.owner_capex_debt_outflow_pen
      FROM joined j
      ORDER BY j.period_month ASC
    `;
  }

  const res = await client.query<{
    filter_options: unknown;
    data_cut: unknown;
    pnl_monthly: Array<Record<string, unknown>>;
    open_debtors_count: number;
  }>(
    `SELECT
       ${FILTER_OPTIONS_SELECT},
       ${DATA_CUT_SELECT} AS data_cut,
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
    admin_opex_pen: toNum(r.admin_opex_pen),
    total_opex_pen: toNum(r.total_opex_pen),
    operating_result_pen: toNum(r.operating_result_pen),
    operating_result_pct: toOptNum(r.operating_result_pct),
    owner_salary_recorded_pen: toNum(r.owner_salary_recorded_pen),
    owner_capex_debt_outflow_pen: toNum(r.owner_capex_debt_outflow_pen),
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
      adminOpexPen: s.adminOpexPen + r.admin_opex_pen,
      totalOpexPen: s.totalOpexPen + r.total_opex_pen,
      operatingResultPen: s.operatingResultPen + r.operating_result_pen,
      ownerSalaryRecordedPen: s.ownerSalaryRecordedPen + r.owner_salary_recorded_pen,
      ownerCapexDebtOutflowPen:
        s.ownerCapexDebtOutflowPen + r.owner_capex_debt_outflow_pen,
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
      adminOpexPen: 0,
      totalOpexPen: 0,
      operatingResultPen: 0,
      ownerSalaryRecordedPen: 0,
      ownerCapexDebtOutflowPen: 0,
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
    adminOpexPen: round2(acc.adminOpexPen),
    totalOpexPen: round2(acc.totalOpexPen),
    operatingResultPen: round2(acc.operatingResultPen),
    operatingResultPct:
      acc.costCoveredSalesPen > 0
        ? round2((acc.operatingResultPen * 100) / acc.costCoveredSalesPen)
        : null,
    ownerSalaryRecordedPen: round2(acc.ownerSalaryRecordedPen),
    ownerCapexDebtOutflowPen: round2(acc.ownerCapexDebtOutflowPen),
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
    dataCut: mapDataCutSummary(row?.data_cut),
    pnlMonthly,
    totals,
    momComparison,
    openDebtorsCount: Number(row?.open_debtors_count ?? 0),
  };
}
