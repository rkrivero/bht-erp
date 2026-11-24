import { z } from "zod";

const positiveInt = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
  z
    .number({ message: "Debe ser un entero positivo" })
    .int("Debe ser un número entero")
    .positive("Debe ser un entero positivo")
);

const optionalNum = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z.number().finite().optional()
);

export const createTripBodySchema = z.object({
  action: z.literal("create_trip"),
  tripDate: z.string().nullable().optional(),
  zoneName: z.string().nullable().optional(),
  driverName: z.string().nullable().optional(),
  cashAccountId: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().positive().nullable().optional()
  ),
  notes: z.string().nullable().optional(),
});

export const assignOrderToTripBodySchema = z.object({
  action: z.literal("assign_order"),
  tripId: positiveInt,
  orderId: positiveInt,
  advanceToInRoute: z.boolean().optional().default(false),
});

export const closeTripBodySchema = z.object({
  action: z.literal("close_trip"),
  tripId: positiveInt,
  nextStatus: z.enum(["CLOSED", "RECONCILED"]).optional().default("CLOSED"),
  declaredGrossSalesPen: optionalNum,
  declaredRouteOpexPen: optionalNum,
  declaredNetCashPen: optionalNum,
  notes: z.string().nullable().optional(),
});

export const tripsMutationSchema = z.discriminatedUnion("action", [
  createTripBodySchema,
  assignOrderToTripBodySchema,
  closeTripBodySchema,
]);
