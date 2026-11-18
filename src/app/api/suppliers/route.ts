import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedERPActor, requireActiveSession } from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
import { resolveHttpError } from "@/lib/http-errors";
import { assertRole } from "@/lib/rbac";
import {
  listSuppliersDirectory,
  updateSupplier,
  type CustomerStatusFilter,
} from "@/lib/services/customers";
import { createSupplier } from "@/lib/services/purchases-and-suppliers";
import { ValidationError } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function parseStatusFilter(raw: string | null): CustomerStatusFilter {
  const val = String(raw || "ALL").toUpperCase();
  if (val === "ACTIVE" || val === "INACTIVE" || val === "ALL") return val;
  return "ALL";
}

export async function GET(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(req), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
    ]);
    const params = req.nextUrl.searchParams;

    const data = await withClient(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
      ]);
      return await listSuppliersDirectory(client, actor, {
        q: params.get("q") ?? undefined,
        status: parseStatusFilter(params.get("status")),
      });
    });

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
    const parsedActor = assertRole(await getAuthenticatedERPActor(req), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
    ]);
    const body = (await req.json()) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      throw new ValidationError("Cuerpo JSON inválido");
    }

    const result = await withTransaction(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
      ]);
      const legalName = String(body.legalName || body.tradeName || "").trim();
      const created = await createSupplier(client, actor, {
        legalName,
        tradeName:
          body.tradeName !== undefined && body.tradeName !== null
            ? String(body.tradeName)
            : null,
        docType: (body.docType as "NONE" | "RUC" | "DNI" | "CE" | "PASSPORT") || "NONE",
        docNumber:
          body.docNumber !== undefined && body.docNumber !== null
            ? String(body.docNumber)
            : null,
        phone:
          body.phone !== undefined && body.phone !== null ? String(body.phone) : null,
        address:
          body.address !== undefined && body.address !== null
            ? String(body.address)
            : null,
        notes:
          body.notes !== undefined && body.notes !== null ? String(body.notes) : null,
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
      const full = suppliers.find((s) => s.party_id === created.supplier.party_id);
      return {
        supplier: full ?? {
          ...created.supplier,
          email: null,
          city_zone: null,
          is_active: true,
        },
      };
    });

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
    const parsedActor = assertRole(await getAuthenticatedERPActor(req), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
    ]);
    const body = (await req.json()) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      throw new ValidationError("Cuerpo JSON inválido");
    }

    const result = await withTransaction(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
      ]);
      return await updateSupplier(client, actor, body.partyId, {
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
      });
    });

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
