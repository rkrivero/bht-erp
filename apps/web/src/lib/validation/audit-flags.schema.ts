import { z } from "zod";

export const auditFlagsMutationSchema = z.object({
  action: z
    .enum(["update_status", "acknowledge", "resolve", "reopen"], {
      message: "Acción de alerta desconocida",
    })
    .optional()
    .default("update_status"),
  flagId: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z
      .number({ message: "Alerta debe ser un entero positivo" })
      .int("Alerta debe ser un entero positivo")
      .positive("Alerta debe ser un entero positivo")
  ),
  nextStatus: z
    .enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"], {
      message: "Estado destino inválido (OPEN, ACKNOWLEDGED o RESOLVED)",
    })
    .optional(),
  resolutionNote: z.string().nullable().optional(),
});
