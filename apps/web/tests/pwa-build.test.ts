import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeCacheHashFromEntries } from "../scripts/generate-sw.mjs";

describe("PWA build artifacts", () => {
  it("changes the cache version when a source input changes", () => {
    const first = computeCacheHashFromEntries([
      { name: "src/app/page.tsx", content: Buffer.from("first") },
    ]);
    const second = computeCacheHashFromEntries([
      { name: "src/app/page.tsx", content: Buffer.from("second") },
    ]);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[a-f0-9]{16}$/);
  });

  it("excludes APIs, deletes old caches, and caches only hashed static assets", async () => {
    const template = await readFile(
      resolve(process.cwd(), "public", "sw.template.js"),
      "utf8"
    );
    expect(template).toContain('url.pathname.startsWith("/api/")');
    expect(template).toContain("key !== CACHE_NAME");
    expect(template).toContain("isHashedStaticAsset");
    expect(template).toContain('url.pathname.startsWith("/_next/static/")');
  });
});
