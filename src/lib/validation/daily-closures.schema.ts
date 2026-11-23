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
    (v) =>
      v === "" || v === null || v === undefined
        ? null
        : typeof v === "string"
          ? Number(v.trim())
          : v,
    z
      .number({ message: "El saldo contado debe ser un número válido" })
      .finite()
      .nullable()
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

export const reopenDailyClosureSchema = z.object({
  closureDate: z.string().trim().min(10, "Fecha de cierre inválida"),
  reason: z.string().trim().min(3, "Indica el motivo para reabrir el día"),
});
