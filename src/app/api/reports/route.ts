import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedERPActor, requireActiveSession } from "@/lib/auth";
import { withClient } from "@/lib/db";
import { resolveHttpError } from "@/lib/http-errors";
import { assertRole } from "@/lib/rbac";
import {
  buildCsvWithBom,
  getBiSummary,
  getReportDatasetRows,
  isReportCsvDataset,
} from "@/lib/services/analytics-and-reports";
import {
  getReportSectionData,
  isReportSection,
  parseReportFilters,
} from "@/lib/services/report-sections";
import { getLimaDateString } from "@/lib/services/orders";
import { ValidationError } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(req), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
    ]);

    const section = (req.nextUrl.searchParams.get("section") || "").trim();
    const dataset = (req.nextUrl.searchParams.get("dataset") || "").trim();
    const format = (req.nextUrl.searchParams.get("format") || "json")
      .trim()
      .toLowerCase();

    if (section) {
      if (!isReportSection(section)) {
        throw new ValidationError(`Sección de reporte inválida: ${section}`);
      }
      if (format !== "json") {
        throw new ValidationError(
          "Las secciones de reportes solo soportan formato JSON"
        );
      }
      const filters = parseReportFilters(req.nextUrl.searchParams);
      const data = await withClient(async (client) => {
        assertRole(await requireActiveSession(client, parsedActor), [
          "PARTNER_ADMIN",
          "PARTNER_MANAGER",
        ]);
        return await getReportSectionData(client, section, filters);
      });
      return NextResponse.json(
        { section, filters, data },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (!dataset) {
      throw new ValidationError("Parámetro 'section' o 'dataset' es obligatorio");
    }

    if (dataset === "bi_summary") {
      if (format === "csv") {
        throw new ValidationError("El dataset 'bi_summary' solo soporta formato JSON");
      }
      if (format !== "json") {
        throw new ValidationError(`Formato no soportado: ${format}`);
      }
      const biSummary = await withClient(async (client) => {
        assertRole(await requireActiveSession(client, parsedActor), [
          "PARTNER_ADMIN",
          "PARTNER_MANAGER",
        ]);
        return await getBiSummary(client);
      });
      return NextResponse.json({ biSummary }, { headers: NO_STORE_HEADERS });
    }

    if (!isReportCsvDataset(dataset)) {
      throw new ValidationError(`Dataset inválido: ${dataset}`);
    }

    if (format !== "csv" && format !== "json") {
      throw new ValidationError(`Formato no soportado: ${format}`);
    }

    const csvFilters = parseReportFilters(req.nextUrl.searchParams);
    const { headers, rows } = await withClient(async (client) => {
      assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
      ]);
      return await getReportDatasetRows(client, dataset, {
        from: csvFilters.from,
        to: csvFilters.to,
        zone: csvFilters.zone,
      });
    });

    if (format === "csv") {
      const csv = buildCsvWithBom(headers, rows);
      const todayLima = getLimaDateString(0);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="bht_${dataset}_${todayLima}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({ dataset, headers, rows }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error generando reporte",
      "GET /api/reports"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}
