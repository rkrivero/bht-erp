import { NextRequest, NextResponse } from "next/server";
import {
  withAuthenticatedClient,
  withAuthenticatedTransaction,
} from "@/lib/auth";
import { resolveHttpError } from "@/lib/http-errors";
import { runIdempotentMutation } from "@/lib/idempotency";
import {
  assignOrderToTrip,
  closeRouteTrip,
  createRouteTrip,
  listRouteTrips,
} from "@/lib/services/operations-and-modules";
import { parseBody, readRawJsonBody } from "@/lib/validation/parse";
import { tripsMutationSchema } from "@/lib/validation/trips.schema";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  try {
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 40;

    const data = await withAuthenticatedClient(
      req,
      [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
        "WAREHOUSE_DELIVERY",
        "EXTERNAL_SELLER",
      ],
      async (client, actor) => {
        const trips = await listRouteTrips(client, actor, limit);
        return { trips };
      }
    );

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error cargando rutas de reparto",
      "GET /api/trips"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await readRawJsonBody(req);

    const result = await withAuthenticatedTransaction(
      req,
      ["PARTNER_ADMIN", "PARTNER_MANAGER", "WAREHOUSE_DELIVERY"],
      async (client, actor) => {
        const body = parseBody(tripsMutationSchema, rawBody);
        return runIdempotentMutation(
          client,
          req,
          actor,
          `trips:${body.action}`,
          body,
          async () => {
            if (body.action === "create_trip") {
              return await createRouteTrip(client, actor, {
                tripDate: body.tripDate ?? null,
                zoneName: body.zoneName ?? null,
                driverName: body.driverName ?? null,
                cashAccountId: body.cashAccountId ?? null,
                notes: body.notes ?? null,
              });
            }
            if (body.action === "assign_order") {
              return await assignOrderToTrip(client, actor, {
                tripId: body.tripId,
                orderId: body.orderId,
                advanceToInRoute: Boolean(body.advanceToInRoute),
              });
            }
            return await closeRouteTrip(client, actor, {
              tripId: body.tripId,
              nextStatus: body.nextStatus || "CLOSED",
              declaredGrossSalesPen: body.declaredGrossSalesPen,
              declaredRouteOpexPen: body.declaredRouteOpexPen,
              declaredNetCashPen: body.declaredNetCashPen,
              notes: body.notes ?? null,
            });
          }
        );
      }
    );

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error operando ruta de reparto",
      "POST /api/trips"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}
