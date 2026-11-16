import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedERPActor,
  requireActiveSession,
} from "@/lib/auth";
import { withClient } from "@/lib/db";
import { assertRole } from "@/lib/rbac";
import {
  buildCsvWithBom,
  getBiSummary,
  getReportDatasetRows,
  isReportCsvDataset,
} from "@/lib/services/analytics-and-reports";
import { getLimaDateString } from "@/lib/services/orders";
import {
  resolveHttpError,
  ValidationError,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
    ]);

    const dataset = (req.nextUrl.searchParams.get("dataset") || "").trim();
    const format = (req.nextUrl.searchParams.get("format") || "json")
      .trim()
      .toLowerCase();

    if (!dataset) {
      throw new ValidationError("Parámetro 'dataset' es obligatorio");
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

    const { headers, rows } = await withClient(async (client) => {
      assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
      ]);
      return await getReportDatasetRows(client, dataset);
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
    const { status, error } = resolveHttpError(err, "Error generando reporte");
    return NextResponse.json(
      { error },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
