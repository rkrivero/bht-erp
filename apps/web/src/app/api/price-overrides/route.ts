import { NextRequest, NextResponse } from "next/server";
import { withAuthenticatedClient } from "@/lib/auth";
import { resolveHttpError } from "@/lib/http-errors";
import { listPriceOverrides } from "@/lib/services/price-audit";
import { parsePositiveInt } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  try {
    const limitParam = req.nextUrl.searchParams.get("limit");
    const entityTypeParam = req.nextUrl.searchParams.get("entity_type")?.toUpperCase();
    const productIdParam = req.nextUrl.searchParams.get("product_id");
    const customerIdParam = req.nextUrl.searchParams.get("customer_party_id");

    const limit = limitParam ? parsePositiveInt(limitParam, "Límite") : 100;
    const productId = productIdParam
      ? parsePositiveInt(productIdParam, "Producto")
      : null;
    const customerPartyId = customerIdParam
      ? parsePositiveInt(customerIdParam, "Cliente")
      : null;
    const entityType =
      entityTypeParam === "ORDER" || entityTypeParam === "QUOTE"
        ? entityTypeParam
        : "ALL";

    const overrides = await withAuthenticatedClient(
      req,
      ["PARTNER_ADMIN", "PARTNER_MANAGER"],
      async (client, actor) =>
        listPriceOverrides(client, actor, {
          limit,
          entityType,
          productId,
          customerPartyId,
        })
    );

    return NextResponse.json({ overrides }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error cargando historial de modificaciones de precio",
      "GET /api/price-overrides"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}
