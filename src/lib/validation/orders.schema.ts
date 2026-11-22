import { z } from "zod";

const optionalNum = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z.number({ message: "Debe ser un número válido" }).finite().optional()
);

const nullableNum = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
  z.number({ message: "Debe ser un número válido" }).finite().nullable().optional()
);

const positiveInt = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
  z
    .number({ message: "Debe ser un entero positivo" })
    .int("Debe ser un número entero")
    .positive("Debe ser un entero positivo")
);

export const orderLineInputSchema = z.object({
  productId: positiveInt,
  quantity: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z
      .number({ message: "La cantidad debe ser mayor a 0" })
      .positive("La cantidad debe ser mayor a 0")
  ),
  packFactorApplied: optionalNum,
  unitPricePen: optionalNum,
  unitDiscountPen: optionalNum,
  overrideBasePricePen: optionalNum,
});

export const createOrderBodySchema = z.object({
  action: z.literal("create").optional().default("create"),
  customerPartyId: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().positive().nullable().optional()
  ),
  customerNameRaw: z
    .string({ message: "Nombre del cliente es obligatorio" })
    .trim()
    .min(1, "Nombre del cliente es obligatorio"),
  paymentMode: z.enum(["CASH", "CREDIT", "TRANSFER", "YAPE_PLIN"], {
    message: "Modalidad de pago inválida",
  }),
  collectOnDelivery: z.boolean().optional(),
  creditDays: optionalNum,
  promisedPaymentDate: z.string().trim().nullable().optional(),
  initialPaidPen: optionalNum,
  paymentAccountId: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    z.number().int().positive().optional()
  ),
  quoteId: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().positive().nullable().optional()
  ),
  tripId: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().positive().nullable().optional()
  ),
  globalDiscountPen: optionalNum,
  notes: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? undefined),
  lines: z
    .array(orderLineInputSchema, {
      message: "El pedido debe incluir al menos un producto",
    })
    .min(1, "El pedido debe incluir al menos un producto"),
});

export const updateOrderBodySchema = z.object({
  action: z.literal("update"),
  orderId: positiveInt,
  lines: z
    .array(orderLineInputSchema, {
      message: "El pedido debe conservar al menos un producto",
    })
    .min(1, "El pedido debe conservar al menos un producto"),
  globalDiscountPen: optionalNum,
  reason: z.string().optional(),
});

export const approveOrderBodySchema = z.object({
  action: z.literal("approve"),
  orderId: positiveInt,
});

export const advanceOrderBodySchema = z.object({
  action: z.literal("advance"),
  orderId: positiveInt,
  nextStatus: z.enum(["PICKING", "READY", "IN_ROUTE", "DELIVERED"], {
    message: "Estado operativo de almacén inválido",
  }),
});

export const cancelOrderBodySchema = z.object({
  action: z.literal("cancel"),
  orderId: positiveInt,
  reason: z.string().optional(),
});

export const logCancelledDraftBodySchema = z.object({
  action: z.literal("log_cancelled_draft"),
  reasonCode: z.string().trim().min(1, "Selecciona un motivo de cancelación"),
  reasonLabel: z.string().trim().min(1, "Selecciona un motivo de cancelación"),
  customerName: z.string().nullable().optional(),
  paymentMode: z.string().nullable().optional(),
  estimatedTotalPen: optionalNum,
  itemCount: optionalNum,
  items: z.array(z.unknown()).optional(),
  notes: z.string().nullable().optional(),
});

export const createOrderCustomerBodySchema = z.object({
  action: z.literal("create_customer"),
  tradeName: z.string().nullable().optional(),
  legalName: z.string().nullable().optional(),
  docType: z.string().nullable().optional(),
  docNumber: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  cityZone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  geoLat: nullableNum,
  geoLng: nullableNum,
  geoAccuracyM: nullableNum,
});

export const ordersMutationSchema = z.union([
  createOrderBodySchema,
  updateOrderBodySchema,
  approveOrderBodySchema,
  advanceOrderBodySchema,
  cancelOrderBodySchema,
  logCancelledDraftBodySchema,
  createOrderCustomerBodySchema,
]);
