import fs from "node:fs";
import path from "node:path";

const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;
const COLOR_ALLOWLIST = new Set(["src/components/ui/Icons.tsx", "src/app/layout.tsx"]);
const MAX_PAGE_LINES = 1200;
const MAX_MODULE_LINES = 700;
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|ts)$/.test(e.name)) files.push(p);
  }
})("src");

const errors = [];
for (const f of files) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  if (f.endsWith(".tsx") && !COLOR_ALLOWLIST.has(f)) {
    lines.forEach(
      (l, i) =>
        COLOR.test(l) &&
        errors.push(`${f}:${i + 1} color literal (usa tokens de globals.css)`)
    );
  }
  lines.forEach(
    (l, i) =>
      /as unknown as/.test(l) && errors.push(`${f}:${i + 1} cast doble 'as unknown as'`)
  );
  if (/(^|\/)(socios|vendedor)\/page\.tsx$/.test(f) && lines.length > MAX_PAGE_LINES)
    errors.push(`${f}: ${lines.length} líneas (> ${MAX_PAGE_LINES})`);
  if (
    /^src\/(features\/(partners|seller)|components\/(socios|directory))\//.test(f) &&
    lines.length > MAX_MODULE_LINES
  )
    errors.push(`${f}: ${lines.length} líneas (> ${MAX_MODULE_LINES})`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Calidad de código verificada (tokens, casts, tamaño de módulos).");
