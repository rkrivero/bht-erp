import { NextRequest, NextResponse } from "next/server";
import { withAuthenticatedClient, withAuthenticatedTransaction } from "@/lib/auth";
import { resolveHttpError } from "@/lib/http-errors";
import { runIdempotentMutation } from "@/lib/idempotency";
import {
  listSuppliersDirectory,
  updateSupplier,
  type CustomerStatusFilter,
} from "@/lib/services/customers";
import { createSupplier } from "@/lib/services/purchases-and-suppliers";
import { parseBody, readRawJsonBody } from "@/lib/validation/parse";
import {
  createSupplierDirectorySchema,
  updateSupplierDirectorySchema,
} from "@/lib/validation/suppliers.schema";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

const SUPPLIER_ROLES = ["PARTNER_ADMIN", "PARTNER_MANAGER"] as const;

function parseStatusFilter(raw: string | null): CustomerStatusFilter {
  const val = String(raw || "ALL").toUpperCase();
  if (val === "ACTIVE" || val === "INACTIVE" || val === "ALL") return val;
  return "ALL";
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;

    const data = await withAuthenticatedClient(
      req,
      [...SUPPLIER_ROLES],
      async (client, actor) => {
        return await listSuppliersDirectory(client, actor, {
          q: params.get("q") ?? undefined,
          status: parseStatusFilter(params.get("status")),
        });
      }
    );

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error cargando proveedores",
      "GET /api/suppliers"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await readRawJsonBody(req);

    const result = await withAuthenticatedTransaction(
      req,
      [...SUPPLIER_ROLES],
      async (client, actor) => {
        const body = parseBody(createSupplierDirectorySchema, rawBody);
        return runIdempotentMutation(
          client,
          req,
          actor,
          "suppliers:create",
          body,
          async () => {
            const legalName = String(body.legalName || body.tradeName || "").trim();
            const created = await createSupplier(client, actor, {
              legalName,
              tradeName: body.tradeName ?? null,
              docType:
                (body.docType as "NONE" | "RUC" | "DNI" | "CE" | "PASSPORT") || "NONE",
              docNumber: body.docNumber ?? null,
              phone: body.phone ?? null,
              address: body.address ?? null,
              notes: body.notes ?? null,
            });

            const cityZone =
              typeof body.cityZone === "string" && body.cityZone.trim()
                ? body.cityZone.trim().replace(/\s+/g, " ").toUpperCase()
                : null;
            const email =
              typeof body.email === "string" && body.email.trim()
                ? body.email.trim().toLowerCase()
                : null;
            if (cityZone || email) {
              return await updateSupplier(client, actor, created.supplier.party_id, {
                cityZone,
                email,
              });
            }
            const { suppliers } = await listSuppliersDirectory(client, actor, {
              status: "ALL",
            });
            const full = suppliers.find(
              (s) => s.party_id === created.supplier.party_id
            );
            return {
              supplier: full ?? {
                ...created.supplier,
                email: null,
                city_zone: null,
                is_active: true,
              },
            };
          }
        );
      }
    );

    return NextResponse.json(result, { status: 201, headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error creando proveedor",
      "POST /api/suppliers"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const rawBody = await readRawJsonBody(req);

    const result = await withAuthenticatedTransaction(
      req,
      [...SUPPLIER_ROLES],
      async (client, actor) => {
        const body = parseBody(updateSupplierDirectorySchema, rawBody);
        return runIdempotentMutation(client, req, actor, "suppliers:update", body, () =>
          updateSupplier(client, actor, body.partyId, {
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
          })
        );
      }
    );

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error actualizando proveedor",
      "PATCH /api/suppliers"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}
