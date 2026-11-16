import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedERPActor,
  requireActiveSession,
} from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
import { assertRole } from "@/lib/rbac";
import {
  assignOrderToTrip,
  closeRouteTrip,
  createRouteTrip,
  listRouteTrips,
} from "@/lib/services/operations-and-modules";
import { resolveHttpError, ValidationError } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
      "WAREHOUSE_DELIVERY",
      "EXTERNAL_SELLER",
    ]);
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 40;

    const data = await withClient(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
        "WAREHOUSE_DELIVERY",
        "EXTERNAL_SELLER",
      ]);
      const trips = await listRouteTrips(client, actor, limit);
      return { trips };
    });

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, error } = resolveHttpError(err, "Error cargando rutas de reparto");
    return NextResponse.json(
      { error },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsedActor = assertRole(await getAuthenticatedERPActor(), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
      "WAREHOUSE_DELIVERY",
    ]);

    const body = await req.json();
    const action = String(body.action || "");

    const result = await withTransaction(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
        "WAREHOUSE_DELIVERY",
      ]);
      if (action === "create_trip") {
        return await createRouteTrip(client, actor, {
          tripDate: body.tripDate ?? null,
          zoneName: body.zoneName ?? null,
          driverName: body.driverName ?? null,
          cashAccountId:
            body.cashAccountId !== undefined && body.cashAccountId !== ""
              ? Number(body.cashAccountId)
              : null,
          notes: body.notes ?? null,
        });
      }
      if (action === "assign_order") {
        return await assignOrderToTrip(client, actor, {
          tripId: Number(body.tripId),
          orderId: Number(body.orderId),
          advanceToInRoute: Boolean(body.advanceToInRoute),
        });
      }
      if (action === "close_trip") {
        return await closeRouteTrip(client, actor, {
          tripId: Number(body.tripId),
          nextStatus: body.nextStatus || "CLOSED",
          declaredGrossSalesPen:
            body.declaredGrossSalesPen !== undefined && body.declaredGrossSalesPen !== ""
              ? Number(body.declaredGrossSalesPen)
              : undefined,
          declaredRouteOpexPen:
            body.declaredRouteOpexPen !== undefined && body.declaredRouteOpexPen !== ""
              ? Number(body.declaredRouteOpexPen)
              : undefined,
          declaredNetCashPen:
            body.declaredNetCashPen !== undefined && body.declaredNetCashPen !== ""
              ? Number(body.declaredNetCashPen)
              : undefined,
          notes: body.notes ?? null,
        });
      }
      throw new ValidationError(`Acción de ruta desconocida: ${action}`);
    });

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, error } = resolveHttpError(err, "Error operando ruta de reparto");
    return NextResponse.json(
      { error },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
