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

export const createPurchaseSupplierSchema = z.object({
  action: z.literal("create_supplier"),
  legalName: z.string().optional().default(""),
  tradeName: z.string().nullable().optional(),
  docType: z.string().optional().default("NONE"),
  docNumber: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const purchaseLineItemSchema = z.object({
  productId: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    z.number().int().positive().optional()
  ),
  sku: z.string().optional(),
  rawDescription: z.string().optional(),
  unitOfMeasure: z.string().optional(),
  quantity: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z.number({ message: "La cantidad debe ser mayor a 0" }).positive("La cantidad debe ser mayor a 0")
  ),
  unitCostPen: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z.number({ message: "El costo unitario debe ser válido" }).nonnegative("El costo unitario no puede ser negativo")
  ),
  listSalePricePen: optionalNum,
  minSalePricePen: optionalNum,
  fulfillmentMode: z.enum(["STOCKED", "ON_DEMAND"]).optional(),
});

export const registerPurchaseBodySchema = z.object({
  action: z.literal("register_purchase"),
  supplierPartyId: positiveInt,
  docType: z.string().optional().default("FACTURA"),
  docSeries: z.string().optional().default(""),
  docNumber: z.string().optional().default(""),
  issueDate: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  currency: z
    .string()
    .optional()
    .transform((v) => (v ? v.toUpperCase() : "PEN"))
    .pipe(z.enum(["PEN", "USD"])),
  exchangeRate: optionalNum,
  taxMode: z
    .string()
    .optional()
    .transform((v) => (v ? v.toUpperCase() : "NONE"))
    .pipe(z.enum(["NONE", "INCLUDED", "EXCLUDED"])),
  paymentCondition: z.enum(["CASH", "CREDIT", "PARTIAL"]).optional().default("CREDIT"),
  paidNowPen: optionalNum,
  accountId: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    z.number().int().positive().optional()
  ),
  notes: z.string().optional(),
  items: z
    .array(purchaseLineItemSchema, {
      message: "La compra debe incluir al menos un ítem",
    })
    .min(1, "La compra debe incluir al menos un ítem"),
  fulfillOrderLineIds: z
    .array(z.preprocess((v) => Number(v), z.number().int().positive()))
    .optional(),
});

export const payApObligationBodySchema = z.object({
  action: z.literal("pay_ap_obligation"),
  apId: positiveInt,
  amountPen: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z.number({ message: "Monto de pago inválido" }).positive("El monto debe ser mayor a 0")
  ),
  accountId: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    z.number().int().positive().optional()
  ),
  notes: z.string().optional(),
});

export const purchasesMutationSchema = z.discriminatedUnion("action", [
  createPurchaseSupplierSchema,
  registerPurchaseBodySchema,
  payApObligationBodySchema,
]);
