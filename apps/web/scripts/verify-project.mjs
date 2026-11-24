import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const migrationsDir = resolve(process.cwd(), "db", "migrations");
const entries = await readdir(migrationsDir).catch(() => []);
const duplicatedMigrations = entries.filter((name) => name.endsWith(".sql"));
if (duplicatedMigrations.length > 0) {
  throw new Error(
    `bht_neon no debe contener migraciones SQL. Muévelas a bht_data: ${duplicatedMigrations.join(", ")}`
  );
}

const branch = process.env.BHT_DB_BRANCH?.trim().toLowerCase();
if (branch && branch !== "dev" && branch !== "main") {
  throw new Error("BHT_DB_BRANCH debe ser dev o main");
}

const vercelEnv = process.env.VERCEL_ENV;
if (vercelEnv === "preview" || vercelEnv === "production") {
  const expectedBranch = vercelEnv === "preview" ? "dev" : "main";
  if (branch !== expectedBranch) {
    throw new Error(
      `Vercel ${vercelEnv} debe declarar BHT_DB_BRANCH=${expectedBranch}`
    );
  }

  const databaseUrl =
    expectedBranch === "dev"
      ? process.env.NEON_DATABASE_URL_DEV || process.env.DEV_DATABASE_URL
      : process.env.NEON_DATABASE_URL_MAIN || process.env.DATABASE_URL;
  if (!databaseUrl) {
    const expectedNames =
      expectedBranch === "dev"
        ? "NEON_DATABASE_URL_DEV o DEV_DATABASE_URL"
        : "NEON_DATABASE_URL_MAIN o DATABASE_URL";
    throw new Error(
      `Configura ${expectedNames} para Neon ${expectedBranch} en Vercel ${vercelEnv}`
    );
  }

  const authBaseUrl = process.env.NEON_AUTH_BASE_URL?.trim() || "";
  const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET?.trim() || "";
  if (
    !authBaseUrl.startsWith("https://") ||
    cookieSecret.length < 32 ||
    /replace-with|placeholder|changeme/i.test(cookieSecret)
  ) {
    throw new Error(
      `Configura NEON_AUTH_BASE_URL y NEON_AUTH_COOKIE_SECRET en Vercel ${vercelEnv}; la clave debe tener al menos 32 caracteres aleatorios`
    );
  }
}

const schemaSrc = await readFile(
  resolve(process.cwd(), "src", "lib", "schema-version.ts"),
  "utf8"
).catch(() => "");
const requiredSchemaMatch = schemaSrc.match(
  /REQUIRED_SCHEMA_VERSION\s*=\s*["']([^"']+)["']/
);
const requiredSchemaLabel = requiredSchemaMatch?.[1] ?? "desconocido";

console.log(
  `Configuración del proyecto verificada (schema mínimo ${requiredSchemaLabel}).\n`
);
