import { NextRequest, NextResponse } from "next/server";
import { withAuthenticatedClient, withAuthenticatedTransaction } from "@/lib/auth";
import { resolveHttpError } from "@/lib/http-errors";
import { runIdempotentMutation } from "@/lib/idempotency";
import { assertRole } from "@/lib/rbac";
import {
  createCustomer,
  getCustomerCreditSuggestion,
  listCustomers,
  updateCustomer,
  type CustomerGeoFilter,
  type CustomerStatusFilter,
} from "@/lib/services/customers";
import {
  createCustomerSchema,
  updateCustomerSchema,
} from "@/lib/validation/customers.schema";
import { parseBody, readRawJsonBody } from "@/lib/validation/parse";

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
    const params = req.nextUrl.searchParams;
    const action = params.get("action");

    if (action === "credit_suggestion") {
      const partyIdRaw = params.get("party_id") ?? params.get("partyId");
      const data = await withAuthenticatedClient(
        req,
        ["PARTNER_ADMIN", "PARTNER_MANAGER"],
        async (client, actor) => {
          assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);
          const suggestion = await getCustomerCreditSuggestion(
            client,
            actor,
            partyIdRaw
          );
          return { suggestion, ...suggestion };
        }
      );
      return NextResponse.json(data, { headers: NO_STORE_HEADERS });
    }

    const limitRaw = Number(params.get("limit") ?? 100);
    const offsetRaw = Number(params.get("offset") ?? 0);
    const limit =
      Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 200 ? limitRaw : 100;
    const offset = Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

    const data = await withAuthenticatedClient(
      req,
      ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"],
      async (client, actor) => {
        return await listCustomers(client, actor, {
          q: params.get("q") ?? undefined,
          zone: params.get("zone") ?? undefined,
          status: parseStatusFilter(params.get("status")),
          hasGeo: parseGeoFilter(params.get("hasGeo")),
          withDebt: params.get("withDebt") === "1" || params.get("withDebt") === "true",
          limit,
          offset,
        });
      }
    );

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
    const rawBody = await readRawJsonBody(req);

    const result = await withAuthenticatedTransaction(
      req,
      ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"],
      async (client, actor) => {
        const body = parseBody(createCustomerSchema, rawBody);
        return runIdempotentMutation(client, req, actor, "customers:create", body, () =>
          createCustomer(client, actor, {
            tradeName: body.tradeName,
            legalName: body.legalName,
            docType: body.docType,
            docNumber: body.docNumber,
            phone: body.phone,
            email: body.email,
            address: body.address,
            cityZone: body.cityZone,
            notes: body.notes,
            geoLat: body.geoLat ?? null,
            geoLng: body.geoLng ?? null,
            geoAccuracyM: body.geoAccuracyM ?? null,
            creditDaysAgreed: body.creditDaysAgreed ?? null,
            creditLimitPen: body.creditLimitPen ?? null,
            lastContactDate: body.lastContactDate,
          })
        );
      }
    );

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
    const rawBody = await readRawJsonBody(req);

    const result = await withAuthenticatedTransaction(
      req,
      ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER", "WAREHOUSE_DELIVERY"],
      async (client, actor) => {
        const body = parseBody(updateCustomerSchema, rawBody);
        return runIdempotentMutation(client, req, actor, "customers:update", body, () =>
          updateCustomer(client, actor, body.partyId, {
            tradeName: body.tradeName,
            legalName: body.legalName,
            docType: body.docType,
            docNumber: body.docNumber,
            phone: body.phone,
            email: body.email,
            address: body.address,
            cityZone: body.cityZone,
            notes: body.notes,
            isActive: body.isActive,
            geoLat: body.geoLat,
            geoLng: body.geoLng,
            geoAccuracyM: body.geoAccuracyM,
            creditDaysAgreed: body.creditDaysAgreed,
            creditLimitPen: body.creditLimitPen,
            lastContactDate: body.lastContactDate,
          })
        );
      }
    );

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
