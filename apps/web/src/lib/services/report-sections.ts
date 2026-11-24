import type { PoolClient } from "pg";
import { ValidationError } from "../types";
import { queryAuditoria } from "./reports/auditoria";
import { queryCajaCxp } from "./reports/caja-cxp";
import { queryCartera } from "./reports/cartera";
import { queryComercial } from "./reports/comercial";
import { queryResumen } from "./reports/resumen";
import { queryStock } from "./reports/stock";
import type {
  ReportFilters,
  ReportSection,
  ReportSectionPayloadMap,
} from "./reports/types";

export * from "./reports/types";
export { isReportSection, parseReportFilters } from "./reports/shared";

export async function getReportSectionData<S extends ReportSection>(
  client: PoolClient,
  section: S,
  filters: ReportFilters = {}
): Promise<ReportSectionPayloadMap[S]> {
  switch (section) {
    case "resumen":
      return (await queryResumen(client, filters)) as ReportSectionPayloadMap[S];
    case "caja_cxp":
      return (await queryCajaCxp(client, filters)) as ReportSectionPayloadMap[S];
    case "cartera":
      return (await queryCartera(client, filters)) as ReportSectionPayloadMap[S];
    case "comercial":
      return (await queryComercial(client, filters)) as ReportSectionPayloadMap[S];
    case "stock":
      return (await queryStock(client, filters)) as ReportSectionPayloadMap[S];
    case "auditoria":
      return (await queryAuditoria(client, filters)) as ReportSectionPayloadMap[S];
    default:
      throw new ValidationError(`Sección de reporte inválida: ${String(section)}`);
  }
}
