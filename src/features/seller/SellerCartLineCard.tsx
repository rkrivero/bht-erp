"use client";

import {
  AlertTriangleIcon,
  MinusIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/ui/Icons";
import { Button, FieldLabel, INPUT_CLASS } from "@/components/ui/Primitives";
import { formatUnitTitleEs } from "@/lib/labels-es";
import {
  isFractionalUom,
  normalizeOrderQuantity,
} from "@/features/seller/seller-utils";
import type { SellerCartLine } from "@/features/seller/types";
import type { SellerOrderFlow } from "@/features/seller/useSellerOrderFlow";

export default function SellerCartLineCard({
  line,
  idx,
  flow,
}: {
  line: SellerCartLine;
  idx: number;
  flow: SellerOrderFlow;
}) {
  const { setCart, isPartnerControlUser } = flow;
  const listPrice = Number(line.product.list_sale_price_pen ?? 0);
  const minPrice = Number(line.product.min_sale_price_pen ?? listPrice);
  const uom = line.product.unit_of_measure || "NIU";
  const fractional = isFractionalUom(uom);
  const safeQty = Number.isFinite(line.quantity) ? Math.max(0, line.quantity) : 0;
  const safeUnit = Number.isFinite(line.unitPricePen)
    ? Math.max(0, line.unitPricePen)
    : 0;
  const delta = Number((safeUnit - listPrice).toFixed(2));
  const priceModified = listPrice > 0 && Math.abs(delta) > 0.005;
  const belowMin = safeUnit > 0 && safeUnit < minPrice - 0.001;

  function updateLine(updater: (current: SellerCartLine) => SellerCartLine) {
    setCart((prev) => prev.map((c, i) => (i === idx ? updater(c) : c)));
  }

  return (
    <div
      className={`space-y-2.5 rounded-xl border p-3.5 transition-all duration-120 ${
        belowMin
          ? "border-amber-300/80 bg-amber-50/40"
          : "border-[var(--border-hairline)] bg-white shadow-2xs"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-bht-ink-strong">
            {line.product.name}
          </p>
          <p className="text-xs text-bht-ink-soft tabular-nums">
            Lista: S/ {listPrice.toFixed(2)}{" "}
            <span title={formatUnitTitleEs(uom)}>/ {uom}</span>
            {priceModified && (
              <>
                {" · "}
                <span
                  className={
                    delta < 0
                      ? "font-semibold text-bht-warning-text"
                      : "font-semibold text-bht-success"
                  }
                >
                  {delta > 0
                    ? `+S/ ${delta.toFixed(2)}`
                    : `-S/ ${Math.abs(delta).toFixed(2)}`}
                </span>
                {" · "}
                <button
                  type="button"
                  data-compact="true"
                  onClick={() =>
                    updateLine((c) => ({
                      ...c,
                      unitPricePen: listPrice,
                      unitPriceInput: listPrice.toFixed(2),
                    }))
                  }
                  className="font-medium text-bht-cobalt underline decoration-1 underline-offset-2 cursor-pointer"
                >
                  Restaurar
                </button>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          data-compact="true"
          onClick={() => setCart((prev) => prev.filter((_, i) => i !== idx))}
          aria-label={`Quitar ${line.product.name}`}
          className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-bht-ink-muted transition hover:bg-bht-danger-bg hover:text-bht-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-danger/35 cursor-pointer"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <FieldLabel htmlFor={`cart-qty-${line.product.product_id}`}>
            Cantidad ({uom})
          </FieldLabel>
          <div className="mt-1 flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              aria-label={`Reducir cantidad de ${line.product.name}`}
              onClick={() =>
                updateLine((c) => {
                  const cur = Number.isFinite(c.quantity) ? Math.max(0, c.quantity) : 1;
                  const nextQty = fractional
                    ? Math.max(
                        0.01,
                        normalizeOrderQuantity(
                          cur > 1 ? cur - 1 : cur > 0.5 ? cur - 0.5 : cur - 0.1,
                          true
                        ) || 0.01
                      )
                    : Math.max(1, Math.floor(cur) - 1);
                  return {
                    ...c,
                    quantity: nextQty,
                    quantityInput: String(nextQty),
                  };
                })
              }
              className="px-2"
            >
              <MinusIcon className="h-3.5 w-3.5" />
            </Button>
            <input
              id={`cart-qty-${line.product.product_id}`}
              type="number"
              inputMode={fractional ? "decimal" : "numeric"}
              min={fractional ? "0.01" : 1}
              step={fractional ? "any" : 1}
              value={line.quantityInput}
              onChange={(e) => {
                const raw = e.target.value.replace(",", ".");
                if (raw.trim() === "") {
                  updateLine((c) => ({ ...c, quantity: 0, quantityInput: "" }));
                  return;
                }
                const parsed = Number(raw);
                if (!Number.isFinite(parsed) || parsed < 0) return;
                const nextQty = fractional ? parsed : Math.max(0, Math.floor(parsed));
                updateLine((c) => ({
                  ...c,
                  quantity: nextQty,
                  quantityInput: fractional ? raw : String(nextQty || ""),
                }));
              }}
              onBlur={() =>
                updateLine((c) => {
                  const normalized = fractional
                    ? normalizeOrderQuantity(c.quantity, true)
                    : Math.floor(c.quantity);
                  const valid =
                    Number.isFinite(normalized) && normalized > 0
                      ? fractional
                        ? normalized
                        : Math.max(1, normalized)
                      : 1;
                  return {
                    ...c,
                    quantity: valid,
                    quantityInput: String(valid),
                  };
                })
              }
              className={`${INPUT_CLASS} min-w-0 flex-1 px-1.5 text-center font-semibold tabular-nums`}
            />
            <Button
              variant="outline"
              size="sm"
              aria-label={`Aumentar cantidad de ${line.product.name}`}
              onClick={() =>
                updateLine((c) => {
                  const cur = Number.isFinite(c.quantity) ? Math.max(0, c.quantity) : 0;
                  const nextQty = fractional
                    ? normalizeOrderQuantity(cur + 1, true) || 1
                    : Math.max(1, Math.floor(cur) + 1);
                  return {
                    ...c,
                    quantity: nextQty,
                    quantityInput: String(nextQty),
                  };
                })
              }
              className="px-2"
            >
              <PlusIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div>
          <FieldLabel htmlFor={`cart-price-${line.product.product_id}`}>
            Precio S/ ({uom})
          </FieldLabel>
          <div className="relative mt-1">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs font-medium text-bht-ink-muted"
            >
              S/
            </span>
            <input
              id={`cart-price-${line.product.product_id}`}
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              value={line.unitPriceInput}
              onChange={(e) => {
                const raw = e.target.value.replace(",", ".");
                if (raw.trim() === "") {
                  updateLine((c) => ({ ...c, unitPricePen: 0, unitPriceInput: "" }));
                  return;
                }
                const parsed = Number(raw);
                if (!Number.isFinite(parsed) || parsed < 0) return;
                updateLine((c) => ({
                  ...c,
                  unitPricePen: parsed,
                  unitPriceInput: raw,
                }));
              }}
              onBlur={() =>
                updateLine((c) => {
                  const fallback = listPrice > 0 ? listPrice : 0.01;
                  const valid =
                    Number.isFinite(c.unitPricePen) && c.unitPricePen > 0
                      ? Number(c.unitPricePen.toFixed(2))
                      : fallback;
                  return {
                    ...c,
                    unitPricePen: valid,
                    unitPriceInput: valid.toFixed(2),
                  };
                })
              }
              className={`${INPUT_CLASS} pl-7 pr-2.5 text-right font-semibold tabular-nums`}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-bht-line/70 pt-2 text-xs tabular-nums">
        <span className="text-bht-ink-soft">
          {safeQty} {uom} × S/ {safeUnit.toFixed(2)}
        </span>
        <span className="text-sm font-semibold text-bht-ink-strong">
          S/ {(safeQty * safeUnit).toFixed(2)}
        </span>
      </div>

      {belowMin && !isPartnerControlUser && (
        <p className="flex items-start gap-1.5 text-xs font-medium text-bht-warning-text">
          <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            Debajo del mínimo comercial (S/ {minPrice.toFixed(2)}). Quedará registrado;
            requiere aprobación solo si baja del costo.
          </span>
        </p>
      )}
    </div>
  );
}
