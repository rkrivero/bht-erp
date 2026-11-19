import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedERPActor, requireActiveSession } from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
import { resolveHttpError } from "@/lib/http-errors";
import { assertRole } from "@/lib/rbac";
import {
  createCustomer,
  listCustomers,
  updateCustomer,
  type CustomerGeoFilter,
  type CustomerStatusFilter,
} from "@/lib/services/customers";
import { ValidationError } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function parseStatusFilter(raw: string | null): CustomerStatusFilter {
  const val = String(raw || "ACTIVE").toUpperCase();
  if (val === "INACTIVE" || val === "ALL" || val === "ACTIVE") return val;
  return "ACTIVE";
}

function parseGeoFilter(raw: string | null): CustomerGeoFilter {
  const val = String(raw || "ALL").toUpperCase();
  if (val === "WITH_GEO" || val === "WITHOUT_GEO" || val === "ALL") return val;
  return "ALL";
}

export async function GET(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(req), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
      "EXTERNAL_SELLER",
    ]);

    const params = req.nextUrl.searchParams;
    const limitParam = Number(params.get("limit") || 100);
    const offsetParam = Number(params.get("offset") || 0);

    const data = await withClient(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
        "EXTERNAL_SELLER",
      ]);
      return await listCustomers(client, actor, {
        q: params.get("q") ?? undefined,
        zone: params.get("zone") ?? undefined,
        status: parseStatusFilter(params.get("status")),
        hasGeo: parseGeoFilter(params.get("hasGeo")),
        withDebt: params.get("withDebt") === "1" || params.get("withDebt") === "true",
        limit: Number.isFinite(limitParam) ? limitParam : 100,
        offset: Number.isFinite(offsetParam) ? offsetParam : 0,
      });
    });

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error cargando clientes",
      "GET /api/customers"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(req), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
      "EXTERNAL_SELLER",
    ]);

    const body = (await req.json()) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      throw new ValidationError("Cuerpo JSON inválido");
    }

    const result = await withTransaction(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
        "EXTERNAL_SELLER",
      ]);
      return await createCustomer(client, actor, {
        tradeName: body.tradeName as string | null | undefined,
        legalName: body.legalName as string | null | undefined,
        docType: body.docType as string | null | undefined,
        docNumber: body.docNumber as string | null | undefined,
        phone: body.phone as string | null | undefined,
        email: body.email as string | null | undefined,
        address: body.address as string | null | undefined,
        cityZone: body.cityZone as string | null | undefined,
        notes: body.notes as string | null | undefined,
        geoLat:
          body.geoLat !== undefined && body.geoLat !== null && body.geoLat !== ""
            ? Number(body.geoLat)
            : null,
        geoLng:
          body.geoLng !== undefined && body.geoLng !== null && body.geoLng !== ""
            ? Number(body.geoLng)
            : null,
        geoAccuracyM:
          body.geoAccuracyM !== undefined &&
          body.geoAccuracyM !== null &&
          body.geoAccuracyM !== ""
            ? Number(body.geoAccuracyM)
            : null,
        creditDaysAgreed:
          body.creditDaysAgreed !== undefined &&
          body.creditDaysAgreed !== null &&
          body.creditDaysAgreed !== ""
            ? Number(body.creditDaysAgreed)
            : null,
        creditLimitPen:
          body.creditLimitPen !== undefined &&
          body.creditLimitPen !== null &&
          body.creditLimitPen !== ""
            ? Number(body.creditLimitPen)
            : null,
        lastContactDate: body.lastContactDate as string | null | undefined,
      });
    });

    return NextResponse.json(result, { status: 201, headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error creando cliente",
      "POST /api/customers"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(req), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
      "EXTERNAL_SELLER",
      "WAREHOUSE_DELIVERY",
    ]);

    const body = (await req.json()) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      throw new ValidationError("Cuerpo JSON inválido");
    }

    const result = await withTransaction(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
        "EXTERNAL_SELLER",
        "WAREHOUSE_DELIVERY",
      ]);

      return await updateCustomer(client, actor, body.partyId, {
        tradeName: body.tradeName as string | null | undefined,
        legalName: body.legalName as string | null | undefined,
        docType: body.docType as string | null | undefined,
        docNumber: body.docNumber as string | null | undefined,
        phone: body.phone as string | null | undefined,
        email: body.email as string | null | undefined,
        address: body.address as string | null | undefined,
        cityZone: body.cityZone as string | null | undefined,
        notes: body.notes as string | null | undefined,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
        geoLat:
          body.geoLat === undefined
            ? undefined
            : body.geoLat === null || body.geoLat === ""
              ? null
              : Number(body.geoLat),
        geoLng:
          body.geoLng === undefined
            ? undefined
            : body.geoLng === null || body.geoLng === ""
              ? null
              : Number(body.geoLng),
        geoAccuracyM:
          body.geoAccuracyM === undefined
            ? undefined
            : body.geoAccuracyM === null || body.geoAccuracyM === ""
              ? null
              : Number(body.geoAccuracyM),
        creditDaysAgreed:
          body.creditDaysAgreed === undefined
            ? undefined
            : body.creditDaysAgreed === null || body.creditDaysAgreed === ""
              ? null
              : Number(body.creditDaysAgreed),
        creditLimitPen:
          body.creditLimitPen === undefined
            ? undefined
            : body.creditLimitPen === null || body.creditLimitPen === ""
              ? null
              : Number(body.creditLimitPen),
        lastContactDate: body.lastContactDate as string | null | undefined,
      });
    });

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error actualizando cliente",
      "PATCH /api/customers"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}
