import { z } from "zod";

const settingValueSchema = z.union([
  z.number().finite(),
  z.boolean(),
  z.string(),
  z.record(z.string(), z.unknown()),
]);

export const patchSystemSettingsSchema = z
  .object({
    settingKey: z.string().trim().min(1).optional(),
    settingValue: settingValueSchema.optional(),
    settings: z.record(z.string(), settingValueSchema).optional(),
    updates: z
      .array(
        z.object({
          key: z.string().trim().min(1),
          value: settingValueSchema,
        })
      )
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
