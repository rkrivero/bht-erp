import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedERPActor, requireActiveSession } from "@/lib/auth";
import { withClient } from "@/lib/db";
import { resolveHttpError } from "@/lib/http-errors";
import { assertRole } from "@/lib/rbac";
import { getLimaDateString } from "@/lib/services/orders";
import {
  buildRegularizationWorkbookBuffer,
  listUnpurchasedSalesRegularization,
  parseRegularizationMode,
} from "@/lib/services/purchase-regularization";
import { ValidationError } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(req), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
    ]);

    const mode = parseRegularizationMode(req.nextUrl.searchParams.get("mode"));
    const supplier = req.nextUrl.searchParams.get("supplier")?.trim() || null;
    const search = req.nextUrl.searchParams.get("search")?.trim() || null;
    const format = (req.nextUrl.searchParams.get("format") || "json")
      .trim()
      .toLowerCase();

    if (format !== "json" && format !== "xlsx") {
      throw new ValidationError("Formato inválido (use 'json' o 'xlsx')");
    }

    const result = await withClient(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
      ]);
      return await listUnpurchasedSalesRegularization(client, actor, {
        mode,
        supplier,
        search,
      });
    });

    if (format === "xlsx") {
      const todayLima = getLimaDateString(0);
      const buffer = buildRegularizationWorkbookBuffer(result, {
        supplierFilter: supplier,
        searchFilter: search,
        generatedDateLima: todayLima,
      });
      const suffix = mode === "projected" ? "proyectado" : "vendido";
      const filename = `bht_por_regularizar_compra_${suffix}_${todayLima}.xlsx`;
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error cargando productos por regularizar compra",
      "GET /api/purchases/regularization"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}
