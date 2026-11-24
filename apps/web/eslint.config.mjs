import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    // Existing data-loading effects are migrated incrementally in the PWA and
    // feature-module phases; React 19's new compiler rules are not build gates yet.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "node_modules/**",
    ".agent/**",
    ".agents/**",
    ".playwright-mcp/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    "public/sw.js",
  ]),
]);
