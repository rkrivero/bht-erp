import type { PoolClient } from "pg";

export const REQUIRED_SCHEMA_VERSION =
  "032_ola1_period_locks_and_valuation_fix";

const COMPATIBLE_SCHEMA_VERSIONS = [REQUIRED_SCHEMA_VERSION] as const;

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
       WHERE version = ANY($1::text[])
     ) AS present`,
    [COMPATIBLE_SCHEMA_VERSIONS]
  );
  if (!result.rows[0]?.present) {
    throw new Error(
      `Esquema Neon desactualizado: se requiere ${REQUIRED_SCHEMA_VERSION}. Ejecuta las migraciones desde data/ (uv run bht-etl migrate).`
    );
  }
  verifiedBranches.add(branch);
}
