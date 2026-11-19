import { describe, expect, it } from "vitest";
import {
  matchCatalogItem,
  normalizeProductText,
  resolveCatalogProductMatch,
  stripConsolidatedVariantTokens,
} from "../src/lib/product-matching";
import { formatCountdownMmSs, getRemainingSeconds, parseIsoTimestampMs } from "../src/lib/undo-client";

const SAMPLE_CATALOG = [
  {
    product_id: 101,
    sku: "47730-26120",
    name: "CALIPER PARA TOYOTA BUFALO",
    aliases: [
      "47750-26120",
      "CALIPER BUFALO",
      "CALIPER PARA TOYOTA BUFALO 47750-26120 LADO DERECHO",
    ],
  },
  {
    product_id: 102,
    sku: "47730-20480",
    name: "CALIPER PARA TOYOTA 57-25",
    aliases: [
      "47730-20480 L",
      "47750-20480 R",
      'CALIPER PARA TOYOTA LASER 57-25 47750-20480 LADO DERECHO "NUEVO"',
      'CALIPER PARA TOYOTA LASER 57-25 47730-20480 LADO IZQUIERDO "NUEVO"',
    ],
  },
  {
    product_id: 103,
    sku: "31410-20150",
    name: "BOMBA DE FRENO PARA TOYOTA 31410-20150",
    aliases: ["31410-20150 LEFT-NEW", "31410-20150 RIGHT-NEW"],
  },
  {
    product_id: 104,
    sku: "D562-SET",
    name: "PASTILLA DE FRENO TOYOTA D562",
    aliases: [],
  },
];

describe("Canonical SKU & Supplier Invoice Description Matching", () => {
  it("normalizes accents, quotes and strips consolidated left/right/nuevo/laser tokens", () => {
    expect(normalizeProductText('  Caliper para Toyota Laser 57-25 "Nuevo"  ')).toBe(
      "CALIPER PARA TOYOTA LASER 57-25 NUEVO"
    );
    expect(
      stripConsolidatedVariantTokens(
        'CALIPER PARA TOYOTA LASER 57-25 LADO IZQUIERDO "NUEVO"'
      )
    ).toBe("CALIPER PARA TOYOTA 57-25");
    expect(stripConsolidatedVariantTokens("47750-26120 LADO DERECHO")).toBe(
      "47730-26120"
    );
  });

  it("matches consolidated Búfalo, 57-25 and side-less brake pump variants in UI filter", () => {
    const bufaloSearch = SAMPLE_CATALOG.filter(
      (item) => matchCatalogItem(item, "47750-26120").matched
    );
    expect(bufaloSearch.map((i) => i.sku)).toEqual(["47730-26120"]);

    const bufaloDescSearch = SAMPLE_CATALOG.filter(
      (item) =>
        matchCatalogItem(item, "CALIPER PARA TOYOTA BUFALO LADO DERECHO").matched
    );
    expect(bufaloDescSearch.map((i) => i.sku)).toEqual(["47730-26120"]);

    const caliper5725Search = SAMPLE_CATALOG.filter(
      (item) =>
        matchCatalogItem(
          item,
          'CALIPER PARA TOYOTA LASER 57-25 LADO IZQUIERDO "NUEVO"'
        ).matched
    );
    expect(caliper5725Search.map((i) => i.sku)).toEqual(["47730-20480"]);

    const pumpSearch = SAMPLE_CATALOG.filter(
      (item) => matchCatalogItem(item, "31410-20150 LEFT-NEW").matched
    );
    expect(pumpSearch.map((i) => i.sku)).toEqual(["31410-20150"]);
  });

  it("resolves supplier invoice lines deterministically to a single canonical SKU", () => {
    const rBufaloSku = resolveCatalogProductMatch(SAMPLE_CATALOG, {
      sku: "47750-26120",
    });
    expect(rBufaloSku.ok && rBufaloSku.sku).toBe("47730-26120");

    const rBufaloDesc = resolveCatalogProductMatch(SAMPLE_CATALOG, {
      rawDescription: "CALIPER PARA TOYOTA BUFALO LADO DERECHO",
    });
    expect(rBufaloDesc.ok && rBufaloDesc.sku).toBe("47730-26120");

    const r5725Sku = resolveCatalogProductMatch(SAMPLE_CATALOG, {
      sku: "47750-20480",
    });
    expect(r5725Sku.ok && r5725Sku.sku).toBe("47730-20480");

    const r5725Desc = resolveCatalogProductMatch(SAMPLE_CATALOG, {
      rawDescription: 'CALIPER PARA TOYOTA LASER 57-25 LADO IZQUIERDO "NUEVO"',
    });
    expect(r5725Desc.ok && r5725Desc.sku).toBe("47730-20480");

    const rPump = resolveCatalogProductMatch(SAMPLE_CATALOG, {
      sku: "31410-20150 LEFT-NEW",
    });
    expect(rPump.ok && rPump.sku).toBe("31410-20150");

    const missing = resolveCatalogProductMatch(SAMPLE_CATALOG, {
      rawDescription: "REPUESTO INEXISTENTE XYZ",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.reason).toBe("not_found");
    }
  });

  it("parses strict UTC ISO timestamps and Postgres-style timestamps consistently (Safari-safe)", () => {
    const utcMs = parseIsoTimestampMs("2026-11-19T10:36:12.123Z");
    const pgMs = parseIsoTimestampMs("2026-11-19 10:36:12.123+00");
    expect(Number.isFinite(utcMs)).toBe(true);
    expect(pgMs).toBe(utcMs);
    expect(
      getRemainingSeconds("2026-11-19T10:36:12.123Z", utcMs - 125_000)
    ).toBe(125);
    expect(formatCountdownMmSs(125)).toBe("2:05");
  });
});
