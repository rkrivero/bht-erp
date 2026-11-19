import type { PoolClient } from "pg";

export const REQUIRED_SCHEMA_VERSION = "019_daily_closure_correction_audit";

const verifiedBranches = new Set<"dev" | "main">();

export async function assertRequiredSchema(
  client: PoolClient,
  branch: "dev" | "main"
): Promise<void> {
  if (verifiedBranches.has(branch) || process.env.NODE_ENV === "test") return;
  const result = await client.query<{ present: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM public.schema_migrations
       WHERE version = $1
     ) AS present`,
    [REQUIRED_SCHEMA_VERSION]
  );
  if (!result.rows[0]?.present) {
    throw new Error(
      `Esquema Neon desactualizado: se requiere ${REQUIRED_SCHEMA_VERSION}. Ejecuta las migraciones desde bht_data.`
    );
  }
  verifiedBranches.add(branch);
}
