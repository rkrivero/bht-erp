import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const nextDir = resolve(root, ".next");
const routes = {
  socios: { budget: 650_000, source: "src/features/partners/PartnerWorkspace.tsx" },
  vendedor: { budget: 640_000, source: "src/features/seller/SellerWorkspace.tsx" },
  almacen: { budget: 570_000, source: "src/features/warehouse/WarehouseWorkspace.tsx" },
  login: { budget: 730_000, source: "src/app/login/page.tsx" },
};

function parseRscManifest(source) {
  const assignment = source.indexOf('={"moduleLoading"');
  if (assignment < 0) throw new Error("Formato RSC manifest no reconocido");
  return JSON.parse(source.slice(assignment + 1, source.lastIndexOf(";")));
}

function moduleChunks(manifest, sourceSuffix) {
  const entry = Object.entries(manifest.clientModules).find(([file]) =>
    file.endsWith(sourceSuffix)
  );
  if (!entry) throw new Error(`No se encontró ${sourceSuffix} en el manifest`);
  return entry[1].chunks.filter(
    (chunk) => typeof chunk === "string" && chunk.endsWith(".js")
  );
}

async function sizeOf(chunks) {
  const unique = [...new Set(chunks)];
  const sizes = await Promise.all(
    unique.map((chunk) => stat(resolve(nextDir, chunk)).then((item) => item.size))
  );
  return sizes.reduce((total, size) => total + size, 0);
}

const buildManifest = JSON.parse(
  await readFile(resolve(nextDir, "build-manifest.json"), "utf8")
);
const rootChunks = buildManifest.rootMainFiles;
let failed = false;

for (const [route, config] of Object.entries(routes)) {
  const manifestSource = await readFile(
    resolve(nextDir, "server", "app", route, "page_client-reference-manifest.js"),
    "utf8"
  );
  const manifest = parseRscManifest(manifestSource);
  const routeChunks = moduleChunks(manifest, config.source);
  const initialChunks = [...new Set([...rootChunks, ...routeChunks])];
  const bytes = await sizeOf(initialChunks);
  const authInInitial =
    route !== "login" &&
    (
      await Promise.all(
        initialChunks.map((chunk) =>
          readFile(resolve(nextDir, chunk), "utf8").then(
            (content) =>
              content.includes("@neon/auth") || content.includes("createAuthClient")
          )
        )
      )
    ).some(Boolean);

  console.log(
    `${route.padEnd(9)} ${String(bytes).padStart(7)} B / ${config.budget} B${
      authInInitial ? " · auth inicial detectado" : ""
    }`
  );
  if (bytes > config.budget || authInInitial) failed = true;
}

if (failed) {
  throw new Error("Uno o más bundles exceden el presupuesto o incluyen auth inicial");
}
