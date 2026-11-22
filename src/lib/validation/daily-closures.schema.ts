import { z } from "zod";

export const dailyClosureAccountInputSchema = z.object({
  accountId: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z
      .number({ message: "ID de cuenta inválido en el cierre" })
      .int("ID de cuenta inválido en el cierre")
      .positive("ID de cuenta inválido en el cierre")
  ),
  countedBalancePen: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z.number({ message: "El saldo contado debe ser un número válido" }).finite()
  ),
  notes: z.string().nullable().optional(),
});

export const saveDailyClosureSchema = z.object({
  closureDate: z.string().trim().optional(),
  accounts: z
    .array(dailyClosureAccountInputSchema, {
      message: "Ingresa el saldo contado de al menos una cuenta",
    })
    .min(1, "Ingresa el saldo contado de al menos una cuenta"),
  applyReconciliationAdjustments: z.boolean().optional().default(false),
  nextDayNotes: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  correctionReason: z.string().nullable().optional(),
});
