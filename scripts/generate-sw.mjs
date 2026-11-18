import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = resolve(projectRoot, "public", "sw.template.js");
const outputPath = resolve(projectRoot, "public", "sw.js");
const HASH_INPUTS = [
  resolve(projectRoot, "src"),
  templatePath,
  resolve(projectRoot, "package-lock.json"),
  resolve(projectRoot, "next.config.ts"),
];

async function collectFiles(entry) {
  const directoryEntries = await readdir(entry, { withFileTypes: true }).catch(
    () => null
  );
  if (!directoryEntries) return [entry];
  const children = await Promise.all(
    directoryEntries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child) => collectFiles(resolve(entry, child.name)))
  );
  return children.flat();
}

export function computeCacheHashFromEntries(entries) {
  const hash = createHash("sha256");
  for (const { name, content } of entries) {
    hash.update(name);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

export async function generateServiceWorker() {
  const files = (await Promise.all(HASH_INPUTS.map(collectFiles))).flat().sort();
  const entries = await Promise.all(
    files.map(async (file) => ({
      name: relative(projectRoot, file),
      content: await readFile(file),
    }))
  );
  const cacheHash = computeCacheHashFromEntries(entries);
  const template = await readFile(templatePath, "utf8");
  if (!template.includes("__BHT_CACHE_HASH__")) {
    throw new Error("La plantilla del service worker no contiene el marcador de hash");
  }
  await writeFile(
    outputPath,
    template.replaceAll("__BHT_CACHE_HASH__", cacheHash),
    "utf8"
  );
  return cacheHash;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const cacheHash = await generateServiceWorker();
  console.log(`Service worker generado: bht-shell-${cacheHash}`);
}
