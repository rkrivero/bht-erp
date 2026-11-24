import { z } from "zod";

export const undoMutationSchema = z.object({
  undoId: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z
      .number({ message: "Acción a deshacer debe ser un entero positivo" })
      .int("Acción a deshacer debe ser un entero positivo")
      .positive("Acción a deshacer debe ser un entero positivo")
  ),
  reason: z.string().nullable().optional(),
});
