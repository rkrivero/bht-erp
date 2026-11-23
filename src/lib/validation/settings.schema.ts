import { z } from "zod";

const settingValueSchema = z.union([
  z.number().finite(),
  z.boolean(),
  z.string().max(500),
  z.record(
    z.string().max(100),
    z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()])
  ),
]);

export const patchSystemSettingsSchema = z
  .object({
    settingKey: z.string().trim().min(1).max(100).optional(),
    settingValue: settingValueSchema.optional(),
    settings: z.record(z.string().max(100), settingValueSchema).optional(),
    updates: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(100),
          value: settingValueSchema,
        })
      )
      .max(50)
      .optional(),
  })
  .refine(
    (val) =>
      Boolean(val.settingKey && val.settingValue !== undefined) ||
      Boolean(val.settings && Object.keys(val.settings).length > 0) ||
      Boolean(val.updates && val.updates.length > 0),
    {
      message: "Debe enviar al menos un parámetro de configuración a actualizar",
    }
  );
