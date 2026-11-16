import fs from "fs";
import path from "path";
import { Pool, PoolClient } from "pg";

declare global {
  var __bhtPgPools: Partial<Record<"dev" | "main", Pool>> | undefined;
}

const pools: Partial<Record<"dev" | "main", Pool>> =
  globalThis.__bhtPgPools ?? (globalThis.__bhtPgPools = {});

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

function getDefaultBranch(): "dev" | "main" {
  const raw = process.env.BHT_DB_BRANCH?.trim().toLowerCase();
  if (!raw || raw === "main") return "main";
  if (raw === "dev") return "dev";
  throw new Error(`Unsupported BHT_DB_BRANCH: ${process.env.BHT_DB_BRANCH}`);
}

export function resolveDatabaseUrl(branch: "dev" | "main" = "main"): string {
  const fallback = loadFallbackEnv();
  if (branch === "dev") {
    const url =
      process.env.NEON_DATABASE_URL_DEV ||
      process.env.DEV_DATABASE_URL ||
      fallback.NEON_DATABASE_URL_DEV ||
      fallback.DEV_DATABASE_URL;
    if (!url) {
      throw new Error(
        "Missing database URL for branch dev (NEON_DATABASE_URL_DEV or DEV_DATABASE_URL)"
      );
    }
    return url;
  }

  const url =
    process.env.NEON_DATABASE_URL_MAIN ||
    process.env.DATABASE_URL ||
    fallback.NEON_DATABASE_URL_MAIN ||
    fallback.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Missing database URL for branch main (NEON_DATABASE_URL_MAIN or DATABASE_URL)"
    );
  }
  return url;
}

export function getPool(branch: "dev" | "main" = "main"): Pool {
  if (!pools[branch]) {
    const pool = new Pool({
      connectionString: resolveDatabaseUrl(branch),
      max: 6,
      idleTimeoutMillis: 15000,
    });
    pool.on("error", (err) => {
      console.error(`[pg-pool:${branch}] idle client error:`, err?.message || err);
    });
    pools[branch] = pool;
  }
  return pools[branch]!;
}

export function shouldDestroyClientOnError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const errName = typeof (err as { name?: unknown }).name === "string" ? (err as { name: string }).name : "";
  if (
    errName === "ValidationError" ||
    errName === "AuthorizationError" ||
    errName === "AuthenticationError" ||
    errName === "ConflictError"
  ) {
    return false;
  }
  const code = typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : "";
  if (
    code.startsWith("08") ||
    code.startsWith("57P") ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EPIPE" ||
    code === "ENOTFOUND" ||
    code === "EHOSTUNREACH"
  ) {
    return true;
  }
  const message = typeof (err as { message?: unknown }).message === "string" ? (err as { message: string }).message : "";
  return /connection terminated|client has encountered a connection error|terminating connection|socket hang up/i.test(
    message
  );
}

export async function withClient<T>(
  fn: (client: PoolClient) => Promise<T>,
  branch: "dev" | "main" = getDefaultBranch()
): Promise<T> {
  const pool = getPool(branch);
  const client = await pool.connect();
  let releaseErr: Error | undefined;
  try {
    return await fn(client);
  } catch (err) {
    if (shouldDestroyClientOnError(err)) {
      releaseErr = err instanceof Error ? err : new Error(String(err));
    }
    throw err;
  } finally {
    client.release(releaseErr);
  }
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  branch: "dev" | "main" = getDefaultBranch()
): Promise<T> {
  const pool = getPool(branch);
  const client = await pool.connect();
  let releaseErr: Error | undefined;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rbErr) {
      releaseErr = rbErr instanceof Error ? rbErr : new Error(String(rbErr));
    }
    throw err;
  } finally {
    client.release(releaseErr);
  }
}
