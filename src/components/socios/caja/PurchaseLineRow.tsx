"use client";

import React, { useDeferredValue, useMemo } from "react";
import { PlusIcon, TrashIcon } from "@/components/ui/Icons";
import { Button, Card, FieldLabel, INPUT_CLASS } from "@/components/ui/Primitives";
import { formatFulfillmentModeEs } from "@/lib/labels-es";
import { matchCatalogItem, resolveCatalogProductMatch } from "@/lib/product-matching";
import { formatPen, type PartnerCatalogItem, type PendingOnDemandItem } from "../types";
import type { PurchaseLineDraft } from "./caja-utils";

export const PurchaseLineRow = React.memo(function PurchaseLineRow({
  row,
  idx,
  catalog,
  canRemove,
  onSearchChange,
  onSelectProduct,
  onQuantityChange,
  onUnitCostChange,
  onRemove,
}: {
  row: PurchaseLineDraft;
  idx: number;
  catalog: PartnerCatalogItem[];
  canRemove: boolean;
  onSearchChange: (key: string, value: string) => void;
  onSelectProduct: (key: string, productIdStr: string) => void;
  onQuantityChange: (key: string, value: string) => void;
  onUnitCostChange: (key: string, value: string) => void;
  onRemove: (key: string) => void;
}) {
  const deferredSearch = useDeferredValue(row.search);

  const filteredMatches = useMemo(() => {
    const q = deferredSearch.trim();
    if (!q) {
      return catalog.map((product) => ({
        product,
        viaAlias: undefined as string | undefined,
      }));
    }
    const matches: Array<{ product: PartnerCatalogItem; viaAlias?: string }> = [];
    for (const p of catalog) {
      const m = matchCatalogItem(p, q);
      if (m.matched || p.product_id === row.productId) {
        matches.push({ product: p, viaAlias: m.matchedText });
      }
    }
    return matches;
  }, [catalog, deferredSearch, row.productId]);

  const deducedMatch = useMemo(() => {
    const q = deferredSearch.trim();
    if (!q || row.productId !== "") return null;
    const res = resolveCatalogProductMatch(catalog, { rawDescription: q });
    if (res.ok) return res;
    if (filteredMatches.length === 1 && q.length >= 4) {
      const only = filteredMatches[0].product;
      return {
        ok: true as const,
        productId: only.product_id,
        sku: only.sku,
        name: only.name,
        via: "canonical_alias" as const,
      };
    }
    return null;
  }, [catalog, deferredSearch, filteredMatches, row.productId]);

  const selectedProd = useMemo(
    () =>
      row.productId ? catalog.find((p) => p.product_id === row.productId) : undefined,
    [catalog, row.productId]
  );

  const lineSubtotal = Number(row.quantity || 0) * Number(row.unitCostPen || 0);
  const searchInputId = `pur-line-search-${row.key}`;
  const selectProdId = `pur-line-prod-${row.key}`;
  const qtyInputId = `pur-line-qty-${row.key}`;
  const costInputId = `pur-line-cost-${row.key}`;

  return (
    <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-bht-line bg-white p-3 sm:grid-cols-12 sm:items-end">
      <div className="min-w-0 space-y-1.5 sm:col-span-6">
        <FieldLabel htmlFor={searchInputId}>
          Producto #{idx + 1} (Filtra por código, nombre o alias de factura)
        </FieldLabel>
        <input
          id={searchInputId}
          type="text"
          value={row.search}
          onChange={(e) => onSearchChange(row.key, e.target.value)}
          placeholder="Buscar código, nombre o descripción de factura..."
          className={INPUT_CLASS}
        />
        <label htmlFor={selectProdId} className="sr-only">
          Seleccionar producto #{idx + 1}
        </label>
        <select
          id={selectProdId}
          required
          value={row.productId === "" ? "" : String(row.productId)}
          onChange={(e) => onSelectProduct(row.key, e.target.value)}
          className={`${INPUT_CLASS} min-w-0 font-medium`}
        >
          <option value="">-- Elegir producto --</option>
          {filteredMatches.map(({ product: p, viaAlias }) => (
            <option key={p.product_id} value={String(p.product_id)}>
              {p.sku} — {p.name}
              {viaAlias ? ` [vía: ${viaAlias}]` : ""} (Stock: {p.stock_on_hand}{" "}
              {p.unit_of_measure} · {formatFulfillmentModeEs(p.fulfillment_mode)})
            </option>
          ))}
        </select>
        {deducedMatch && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bht-info-line bg-bht-cobalt-bg/60 px-2.5 py-1.5 text-xs text-bht-navy-deep">
            <span className="min-w-0 truncate">
              Deducido a SKU único:{" "}
              <strong>
                {deducedMatch.sku} — {deducedMatch.name}
              </strong>
            </span>
            <button
              type="button"
              data-compact="true"
              onClick={() => onSelectProduct(row.key, String(deducedMatch.productId))}
              className="shrink-0 rounded-md border border-bht-cobalt bg-white px-2 py-0.5 text-xs font-semibold text-bht-cobalt-strong hover:bg-bht-cobalt-bg cursor-pointer"
            >
              Usar SKU único: {deducedMatch.sku}
            </button>
          </div>
        )}
        {selectedProd && (
          <p className="text-xs text-bht-ink-soft tabular-nums">
            Stock actual:{" "}
            <strong className="text-bht-ink-strong">
              {selectedProd.stock_on_hand}
            </strong>{" "}
            {selectedProd.unit_of_measure} · Costo ref:{" "}
            {selectedProd.ref_cost_pen !== null
              ? formatPen(selectedProd.ref_cost_pen)
              : "Sin costo"}
          </p>
        )}
      </div>

      <div className="min-w-0 sm:col-span-2">
        <FieldLabel htmlFor={qtyInputId} required>
          Cantidad{selectedProd ? ` (${selectedProd.unit_of_measure})` : ""}
        </FieldLabel>
        <input
          id={qtyInputId}
          type="number"
          step="any"
          min="0.01"
          required
          value={row.quantity}
          onChange={(e) => onQuantityChange(row.key, e.target.value)}
          className={`${INPUT_CLASS} mt-1 font-semibold tabular-nums`}
        />
      </div>

      <div className="sm:col-span-2">
        <FieldLabel htmlFor={costInputId} required>
          Costo Unit. (S/)
        </FieldLabel>
        <input
          id={costInputId}
          type="number"
          step="0.01"
          min="0"
          required
          value={row.unitCostPen}
          onChange={(e) => onUnitCostChange(row.key, e.target.value)}
          placeholder="0.00"
          className={`${INPUT_CLASS} mt-1 font-semibold tabular-nums`}
        />
      </div>

      <div className="flex items-center justify-between gap-2 sm:col-span-2 sm:flex-col sm:items-end">
        <span className="text-xs font-semibold text-bht-ink-strong tabular-nums">
          {formatPen(Number.isFinite(lineSubtotal) ? lineSubtotal : 0)}
        </span>
        {canRemove && (
          <button
            type="button"
            data-compact="true"
            aria-label={`Quitar producto #${idx + 1}`}
            onClick={() => onRemove(row.key)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-bht-danger hover:bg-bht-danger-bg cursor-pointer"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            Quitar
          </button>
        )}
      </div>
    </div>
  );
});

export function PurchaseOnDemandSection({
  matchingOnDemandLines,
  otherOnDemandLines,
  fulfillOrderLineIds,
  onSelectAllMatching,
  onToggleLineId,
  onAddOnDemandProduct,
}: {
  matchingOnDemandLines: PendingOnDemandItem[];
  otherOnDemandLines: PendingOnDemandItem[];
  fulfillOrderLineIds: number[];
  onSelectAllMatching: (ids: number[]) => void;
  onToggleLineId: (id: number, checked: boolean) => void;
  onAddOnDemandProduct: (od: PendingOnDemandItem) => void;
}) {
  return (
    <>
      {matchingOnDemandLines.length > 0 && (
        <Card tone="brand" padding="sm" className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-bht-ink-strong">
              Cierre Automático Bajo Pedido ({matchingOnDemandLines.length}{" "}
              coincidencia(s))
            </h4>
            <Button
              variant="brand"
              size="sm"
              onClick={() =>
                onSelectAllMatching(matchingOnDemandLines.map((m) => m.order_line_id))
              }
            >
              Seleccionar todos
            </Button>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {matchingOnDemandLines.map((od) => {
              const checked = fulfillOrderLineIds.includes(od.order_line_id);
              return (
                <label
                  key={od.order_line_id}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 text-xs transition ${
                    checked
                      ? "border-bht-cobalt bg-white ring-1 ring-bht-cobalt"
                      : "border-bht-info-line bg-white/80"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onToggleLineId(od.order_line_id, e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-bht-line-stronger"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-bht-ink-strong">
                      {od.sku} · ×{Number(od.quantity)} {od.unit_of_measure || "NIU"} —{" "}
                      {od.product_name}
                    </p>
                    <p className="text-xs text-bht-ink-soft tabular-nums">
                      {od.order_code} ·{" "}
                      {od.customer_name || od.customer_name_raw || "-"} ·{" "}
                      {formatPen(od.line_total_pen)}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </Card>
      )}

      {otherOnDemandLines.length > 0 && (
        <Card tone="warning" padding="sm" className="space-y-2">
          <p className="text-xs font-semibold text-bht-ink-strong">
            Otros pedidos bajo pedido pendientes ({otherOnDemandLines.length}):
          </p>
          <div className="flex flex-wrap gap-1.5">
            {otherOnDemandLines.slice(0, 8).map((od) => (
              <Button
                key={od.order_line_id}
                variant="outline"
                size="sm"
                onClick={() => onAddOnDemandProduct(od)}
              >
                <PlusIcon className="h-3 w-3" />
                {od.sku} (×{Number(od.quantity)} {od.unit_of_measure || "NIU"} ·{" "}
                {od.order_code})
              </Button>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
