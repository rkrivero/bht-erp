export interface CatalogMatchCandidate {
  product_id?: number;
  sku: string;
  name: string;
  aliases?: string[];
}

export type CatalogMatchVia =
  "sku" | "name" | "alias" | "canonical_sku" | "canonical_name" | "canonical_alias";

export interface CatalogSearchMatch {
  matched: boolean;
  via?: CatalogMatchVia;
  matchedText?: string;
}

export type CatalogResolutionResult =
  | {
      ok: true;
      productId: number;
      sku: string;
      name: string;
      via: CatalogMatchVia;
    }
  | {
      ok: false;
      reason: "not_found" | "ambiguous";
      candidates: Array<{ productId: number; sku: string; name: string }>;
    };

const LEGACY_SKU_CANONICAL_MAP: ReadonlyArray<[RegExp, string]> = [
  [/\b47750-26120\b/g, "47730-26120"],
  [/\b47750-20480(?:\s+[LR])?\b/g, "47730-20480"],
  [/\b47730-20480\s+[LR]\b/g, "47730-20480"],
  [/\b31410-20150\s+(?:LEFT|RIGHT)(?:-NEW|\s+NEW)\b/g, "31410-20150"],
];

/** Normalizes accents, quotes and spacing while preserving slashes and SKU hyphens. */
export function normalizeProductText(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/["'“”‘’]/g, " ")
    .replace(/[^A-Z0-9/\-.\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strips legacy side/new tokens (LADO DERECHO, LEFT-NEW, NUEVO, LASER 57-25) and
 * rewrites consolidated historical SKUs to their canonical product equivalent.
 */
export function stripConsolidatedVariantTokens(value: string): string {
  let out = normalizeProductText(value);
  if (!out) return "";

  for (const [pattern, replacement] of LEGACY_SKU_CANONICAL_MAP) {
    out = out.replace(pattern, replacement);
  }

  out = out
    .replace(/\bLADO\s+(?:IZQUIERDO|IZQUIERDA|DERECHO|DERECHA|IZQ|DER)\b/g, " ")
    .replace(/\b(?:LEFT|RIGHT)(?:-NEW|\s+NEW)?\b/g, " ")
    .replace(/\b(?:IZQUIERDO|IZQUIERDA|DERECHO|DERECHA|IZQ|DER|LH|RH)\b/g, " ")
    .replace(/\bNUEVO\b/g, " ");

  if (/\bCALIPER\b/.test(out) && /\b57-?25\b/.test(out)) {
    out = out.replace(/\bLASER\b/g, " ");
  }

  return out.replace(/\s+/g, " ").trim();
}

function getAllCandidateTerms(product: CatalogMatchCandidate): Array<{
  raw: string;
  viaExact: CatalogMatchVia;
  viaCanonical: CatalogMatchVia;
}> {
  const seen = new Set<string>();
  const terms: Array<{
    raw: string;
    viaExact: CatalogMatchVia;
    viaCanonical: CatalogMatchVia;
  }> = [];

  const pushTerm = (
    raw: string,
    viaExact: CatalogMatchVia,
    viaCanonical: CatalogMatchVia
  ) => {
    const clean = String(raw || "").trim();
    if (!clean) return;
    const key = `${viaExact}:${clean.toUpperCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    terms.push({ raw: clean, viaExact, viaCanonical });
  };

  pushTerm(product.sku, "sku", "canonical_sku");
  pushTerm(product.name, "name", "canonical_name");
  for (const alias of product.aliases ?? []) {
    pushTerm(alias, "alias", "canonical_alias");
  }
  return terms;
}

export function matchCatalogItem(
  product: CatalogMatchCandidate,
  query: string
): CatalogSearchMatch {
  const qNorm = normalizeProductText(query);
  if (!qNorm) return { matched: true };

  const qStripped = stripConsolidatedVariantTokens(query);
  const terms = getAllCandidateTerms(product);

  for (const term of terms) {
    const tNorm = normalizeProductText(term.raw);
    if (tNorm.includes(qNorm)) {
      return {
        matched: true,
        via: term.viaExact,
        matchedText: term.viaExact === "alias" ? term.raw : undefined,
      };
    }
  }

  if (qStripped.length >= 3) {
    for (const term of terms) {
      const tStripped = stripConsolidatedVariantTokens(term.raw);
      if (tStripped && tStripped.includes(qStripped)) {
        return {
          matched: true,
          via: term.viaCanonical,
          matchedText: term.viaCanonical === "canonical_alias" ? term.raw : undefined,
        };
      }
      if (
        term.viaExact !== "alias" &&
        tStripped.length >= 4 &&
        qStripped.includes(tStripped)
      ) {
        return {
          matched: true,
          via: term.viaCanonical,
          matchedText: term.raw,
        };
      }
    }
  }

  return { matched: false };
}

function resolveSingleQuery(
  candidates: Array<CatalogMatchCandidate & { product_id: number }>,
  rawQuery: string
): CatalogResolutionResult {
  const qNorm = normalizeProductText(rawQuery);
  const qStripped = stripConsolidatedVariantTokens(rawQuery);
  if (!qNorm) {
    return { ok: false, reason: "not_found", candidates: [] };
  }

  const exactMatchResult = (
    matched: Array<{
      item: CatalogMatchCandidate & { product_id: number };
      via: CatalogMatchVia;
    }>
  ): CatalogResolutionResult | null => {
    if (matched.length === 0) return null;
    const uniqueById = new Map<
      number,
      { item: CatalogMatchCandidate & { product_id: number }; via: CatalogMatchVia }
    >();
    for (const entry of matched) {
      if (!uniqueById.has(entry.item.product_id)) {
        uniqueById.set(entry.item.product_id, entry);
      }
    }
    const entries = Array.from(uniqueById.values());
    if (entries.length === 1) {
      const hit = entries[0];
      return {
        ok: true,
        productId: hit.item.product_id,
        sku: hit.item.sku,
        name: hit.item.name,
        via: hit.via,
      };
    }
    return {
      ok: false,
      reason: "ambiguous",
      candidates: entries.map((e) => ({
        productId: e.item.product_id,
        sku: e.item.sku,
        name: e.item.name,
      })),
    };
  };

  // Tier 1: exact normalized SKU
  const tier1 = candidates
    .filter((c) => normalizeProductText(c.sku) === qNorm)
    .map((item) => ({ item, via: "sku" as const }));
  const r1 = exactMatchResult(tier1);
  if (r1) return r1;

  // Tier 2: exact normalized product name
  const tier2 = candidates
    .filter((c) => normalizeProductText(c.name) === qNorm)
    .map((item) => ({ item, via: "name" as const }));
  const r2 = exactMatchResult(tier2);
  if (r2) return r2;

  // Tier 3: exact normalized alias
  const tier3 = candidates
    .filter((c) => (c.aliases ?? []).some((a) => normalizeProductText(a) === qNorm))
    .map((item) => ({ item, via: "alias" as const }));
  const r3 = exactMatchResult(tier3);
  if (r3) return r3;

  // Tier 4: stripped canonical SKU / name / alias (deducing consolidated left/right/legacy variants)
  if (qStripped.length >= 3) {
    const tier4: Array<{
      item: CatalogMatchCandidate & { product_id: number };
      via: CatalogMatchVia;
    }> = [];
    for (const c of candidates) {
      if (stripConsolidatedVariantTokens(c.sku) === qStripped) {
        tier4.push({ item: c, via: "canonical_sku" });
      } else if (stripConsolidatedVariantTokens(c.name) === qStripped) {
        tier4.push({ item: c, via: "canonical_name" });
      } else if (
        (c.aliases ?? []).some((a) => stripConsolidatedVariantTokens(a) === qStripped)
      ) {
        tier4.push({ item: c, via: "canonical_alias" });
      }
    }
    const r4 = exactMatchResult(tier4);
    if (r4) return r4;

    // Also inspect embedded legacy SKUs inside a longer supplier invoice description
    for (const [, canonicalSku] of LEGACY_SKU_CANONICAL_MAP) {
      if (qStripped.includes(canonicalSku)) {
        const hit = candidates.filter(
          (c) => normalizeProductText(c.sku) === canonicalSku
        );
        const rSku = exactMatchResult(
          hit.map((item) => ({ item, via: "canonical_sku" as const }))
        );
        if (rSku) return rSku;
      }
    }
  }

  return { ok: false, reason: "not_found", candidates: [] };
}

export function resolveCatalogProductMatch(
  candidates: Array<CatalogMatchCandidate & { product_id: number }>,
  input: { sku?: string | null; rawDescription?: string | null }
): CatalogResolutionResult {
  const skuText = String(input.sku || "").trim();
  const descText = String(input.rawDescription || "").trim();

  if (skuText) {
    const bySku = resolveSingleQuery(candidates, skuText);
    if (bySku.ok || !descText) return bySku;
  }
  if (descText) {
    return resolveSingleQuery(candidates, descText);
  }
  return { ok: false, reason: "not_found", candidates: [] };
}
