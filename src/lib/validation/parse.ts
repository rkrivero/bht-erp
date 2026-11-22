import type { z } from "zod";
import { ValidationError } from "../types";

export function parseBody<T>(schema: z.ZodType<T>, raw: unknown): T {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("Cuerpo JSON inválido");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const pathLabel =
      issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    const msg = issue?.message || "Datos de entrada inválidos";
    throw new ValidationError(`${pathLabel}${msg}`);
  }
  return result.data;
}

export async function readRawJsonBody(req: {
  json(): Promise<unknown>;
}): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ValidationError("Cuerpo JSON inválido");
  }
}
