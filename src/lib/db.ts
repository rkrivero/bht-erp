import fs from "fs";
import path from "path";
import { Pool, PoolClient } from "pg";

const pools: Partial<Record<"dev" | "main", Pool>> = {};

function loadFallbackEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../bht_data/.env"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in result)) {
        result[key] = val;
      }
    }
  }
  return result;
}

export function resolveDatabaseUrl(branch: "dev" | "main" = "main"): string {
  const fallback = loadFallbackEnv();
  const envKey =
    branch === "dev" ? "NEON_DATABASE_URL_DEV" : "NEON_DATABASE_URL_MAIN";
  const url =
    process.env[envKey] ||
    fallback[envKey] ||
    process.env.DATABASE_URL ||
    fallback.DATABASE_URL;
  if (!url) {
    throw new Error(`Missing database URL for branch ${branch}`);
  }
  return url;
}

export function getPool(branch: "dev" | "main" = "main"): Pool {
  if (!pools[branch]) {
    pools[branch] = new Pool({
      connectionString: resolveDatabaseUrl(branch),
      max: 6,
      idleTimeoutMillis: 15000,
    });
  }
  return pools[branch]!;
}

export async function withClient<T>(
  fn: (client: PoolClient) => Promise<T>,
  branch: "dev" | "main" = (process.env.BHT_DB_BRANCH as "dev" | "main") || "main"
): Promise<T> {
  const pool = getPool(branch);
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  branch: "dev" | "main" = (process.env.BHT_DB_BRANCH as "dev" | "main") || "main"
): Promise<T> {
  const pool = getPool(branch);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
