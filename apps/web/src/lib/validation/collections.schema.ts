import { z } from "zod";

const positiveInt = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
  z
    .number({ message: "Debe ser un entero positivo" })
    .int("Debe ser un número entero")
    .positive("Debe ser un entero positivo")
);

const optionalAccountId = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z.number().int().positive().optional()
);

const nextCollectionDaysSchema = z.preprocess(
  (v) => (v === null ? null : v === "" || v === undefined ? undefined : Number(v)),
  z.number().int().min(0).max(365).nullable().optional()
);

export const singleOrderCollectionSchema = z.object({
  mode: z.literal("single_order").optional().default("single_order"),
  orderId: positiveInt,
  amountPen: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z
      .number({ message: "Monto de abono inválido" })
      .positive("El monto debe ser mayor a 0")
  ),
  paymentMode: z.enum(["CASH", "TRANSFER", "YAPE_PLIN"]).optional().default("CASH"),
  accountId: optionalAccountId,
  notes: z.string().optional(),
  nextCollectionDays: nextCollectionDaysSchema,
  nextPromisedPaymentDate: z.string().nullable().optional(),
});

export const fifoCustomerCollectionSchema = z.object({
  mode: z.literal("fifo_customer"),
  customerPartyId: positiveInt,
  totalAmountPen: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z
      .number({ message: "Monto total de abono inválido" })
      .positive("El monto debe ser mayor a 0")
  ),
  paymentMode: z.enum(["CASH", "TRANSFER", "YAPE_PLIN"]).optional().default("CASH"),
  accountId: optionalAccountId,
  notes: z.string().optional(),
  nextCollectionDays: nextCollectionDaysSchema,
  nextPromisedPaymentDate: z.string().nullable().optional(),
});

export const collectionsMutationSchema = z.union([
  fifoCustomerCollectionSchema,
  singleOrderCollectionSchema,
]);
