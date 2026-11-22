import { z } from "zod";

const positiveInt = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
  z
    .number({ message: "Debe ser un entero positivo" })
    .int("Debe ser un número entero")
    .positive("Debe ser un entero positivo")
);

const optionalPositiveInt = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
  z.number().int().positive().nullable().optional()
);

const optionalNum = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z.number().finite().optional()
);

export const quoteLineInputSchema = z.object({
  productId: optionalPositiveInt,
  rawDescription: z.string().nullable().optional(),
  quantity: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z.number({ message: "La cantidad debe ser mayor a 0" }).positive("La cantidad debe ser mayor a 0")
  ),
  unitPricePen: optionalNum,
});

export const createQuoteBodySchema = z.object({
  action: z.literal("create_quote"),
  customerPartyId: optionalPositiveInt,
  customerNameRaw: z.string().nullable().optional(),
  currency: z.enum(["PEN", "USD"]).optional().default("PEN"),
  taxRegime: z.string().nullable().optional(),
  globalDiscountPen: optionalNum,
  notes: z.string().nullable().optional(),
  lines: z
    .array(quoteLineInputSchema, {
      message: "La cotización debe incluir al menos un producto",
    })
    .min(1, "La cotización debe incluir al menos un producto"),
});

export const updateQuoteBodySchema = z.object({
  action: z.literal("update_quote"),
  quoteId: positiveInt,
  customerPartyId: optionalPositiveInt,
  customerNameRaw: z.string().nullable().optional(),
  globalDiscountPen: optionalNum,
  notes: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  lines: z
    .array(quoteLineInputSchema, {
      message: "La cotización debe conservar al menos un producto",
    })
    .min(1, "La cotización debe conservar al menos un producto"),
});

export const updateQuoteStatusBodySchema = z.object({
  action: z.literal("update_status"),
  quoteId: positiveInt,
  nextStatus: z.enum(["OPEN", "EXPIRED", "CANCELLED"], {
    message: "Estado destino inválido (OPEN, EXPIRED o CANCELLED)",
  }),
});

export const convertQuoteToOrderBodySchema = z.object({
  action: z.literal("convert_to_order"),
  quoteId: positiveInt,
  paymentMode: z
    .enum(["CASH", "CREDIT", "TRANSFER", "YAPE_PLIN"])
    .optional()
    .default("CASH"),
  collectOnDelivery: z.boolean().optional(),
  creditDays: optionalNum,
  promisedPaymentDate: z.string().nullable().optional(),
  initialPaidPen: optionalNum,
  paymentAccountId: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    z.number().int().positive().optional()
  ),
  tripId: optionalPositiveInt,
  notes: z.string().nullable().optional(),
});

export const quotesMutationSchema = z.discriminatedUnion("action", [
  createQuoteBodySchema,
  updateQuoteBodySchema,
  updateQuoteStatusBodySchema,
  convertQuoteToOrderBodySchema,
]);
