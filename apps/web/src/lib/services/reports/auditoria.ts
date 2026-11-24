import type { PoolClient } from "pg";
import {
  DATA_CUT_SELECT,
  OPERATIONAL_QUALITY_SELECT,
  mapDataCutSummary,
  mapOperationalQualitySummary,
} from "../operational-quality";
import { FILTER_OPTIONS_SELECT, mapFilterOptions, toNum } from "./shared";
import type { ReportAuditoriaData, ReportClosingCheck, ReportFilters } from "./types";

export async function queryAuditoria(
  client: PoolClient,
  filters: ReportFilters
): Promise<ReportAuditoriaData> {
  void filters;
  const res = await client.query<{
    filter_options: unknown;
    data_cut: unknown;
    operational_quality: unknown;
    closing_counts: Record<string, unknown>;
    quality_gaps: Array<Record<string, unknown>>;
    audit_flags: Array<Record<string, unknown>>;
    flag_counts: Record<string, unknown>;
  }>(
    `SELECT
       ${FILTER_OPTIONS_SELECT},
       ${DATA_CUT_SELECT} AS data_cut,
       ${OPERATIONAL_QUALITY_SELECT} AS operational_quality,
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
    dataCut: mapDataCutSummary(row?.data_cut),
    operationalQuality: mapOperationalQualitySummary(row?.operational_quality),
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
