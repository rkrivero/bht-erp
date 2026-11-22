import { z } from "zod";

const optionalPositiveInt = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z.number().int().positive().optional()
);

export const treasuryCashOutflowSchema = z.object({
  amountPen: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z
      .number({ message: "Monto de egreso inválido" })
      .positive("El monto debe ser mayor a 0")
  ),
  expenseBucket: z
    .enum(["ROUTE_OPEX", "ADMIN_OPEX", "MERCHANDISE_PAYMENT", "NON_OPEX_OR_CAPEX"])
    .nullable()
    .optional(),
  expenseCategory: z.string().trim().optional().default("GASTO_RUTA"),
  txDate: z.string().trim().optional(),
  description: z.string().optional().default(""),
  accountId: optionalPositiveInt,
  toAccountId: optionalPositiveInt,
  isInternalTransfer: z.boolean().optional().default(false),
  tripId: optionalPositiveInt,
});
