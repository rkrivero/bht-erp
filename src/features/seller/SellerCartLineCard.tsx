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
  const { expandedDiscountIds, setExpandedDiscountIds, setCart, isPartnerControlUser } =
    flow;
  const base = line.product.list_sale_price_pen ?? 0;
  const min = line.product.min_sale_price_pen ?? base;
  const fractional = isFractionalUom(line.product.unit_of_measure);
  const safeQty = Number.isFinite(line.quantity) ? Math.max(0, line.quantity) : 0;
  const safeDisc = Number.isFinite(line.unitDiscountPen)
    ? Math.max(0, line.unitDiscountPen)
    : 0;
  const finalUnit = Math.max(0, base - safeDisc);
  const belowMin = finalUnit < min - 0.001;
  const discountOpen =
    Boolean(expandedDiscountIds[line.product.product_id]) || safeDisc > 0;
  return (
    <div
      key={line.product.product_id}
      className={`space-y-3 rounded-xl border p-3.5 ${
        belowMin ? "border-[#F3D9B1] bg-[#FDF8F0]" : "border-[#D4E0EC] bg-[#F2F6FA]/55"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#18181B]">{line.product.name}</p>
          <p className="text-xs text-[#5C5A55] tabular-nums">
            Precio lista: S/ {base.toFixed(2)}{" "}
            <span title={formatUnitTitleEs(line.product.unit_of_measure || "NIU")}>
              / {line.product.unit_of_measure || "NIU"}
            </span>{" "}
            · Mín: S/ {min.toFixed(2)}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-expanded={discountOpen}
            onClick={() =>
              setExpandedDiscountIds((prev) => ({
                ...prev,
                [line.product.product_id]: !discountOpen,
              }))
            }
            className={`inline-flex min-h-[40px] items-center rounded-lg border px-3 py-1.5 text-xs font-medium transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 ${
              discountOpen
                ? "border-[#0F2942] bg-[#0F2942] text-white"
                : "border-[#D4E0EC] bg-white text-[#1E446B] hover:bg-[#F2F6FA]"
            }`}
          >
            {safeDisc > 0
              ? `Desc. S/ ${safeDisc.toFixed(2)}`
              : discountOpen
                ? "Ocultar desc."
                : "Descuento"}
          </button>
          <button
            type="button"
            onClick={() => {
              setExpandedDiscountIds((prev) => {
                const next = { ...prev };
                delete next[line.product.product_id];
                return next;
              });
              setCart((prev) => prev.filter((_, i) => i !== idx));
            }}
            aria-label={`Quitar ${line.product.name} del pedido`}
            className="inline-flex min-h-[40px] items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-[#B91C1C] transition hover:bg-[#FEF2F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B91C1C]/35 cursor-pointer"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            Quitar
          </button>
        </div>
      </div>

      <div
        className={`grid grid-cols-1 gap-3 ${
          discountOpen ? "sm:grid-cols-2" : "max-w-full sm:max-w-[260px]"
        }`}
      >
        <div>
          <FieldLabel htmlFor={`cart-qty-${line.product.product_id}`}>
            Cantidad ({line.product.unit_of_measure || "NIU"})
          </FieldLabel>
          <div className="mt-1 flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              aria-label={`Reducir cantidad de ${line.product.name}`}
              onClick={() =>
                setCart((prev) =>
                  prev.map((c, i) => {
                    if (i !== idx) return c;
                    const cur = Number.isFinite(c.quantity)
                      ? Math.max(0, c.quantity)
                      : 1;
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
                )
              }
              className="px-2.5"
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
                  setCart((prev) =>
                    prev.map((c, i) =>
                      i === idx
                        ? {
                            ...c,
                            quantity: 0,
                            quantityInput: "",
                          }
                        : c
                    )
                  );
                  return;
                }
                const parsed = Number(raw);
                if (!Number.isFinite(parsed) || parsed < 0) return;
                const nextQty = fractional ? parsed : Math.max(0, Math.floor(parsed));
                setCart((prev) =>
                  prev.map((c, i) =>
                    i === idx
                      ? {
                          ...c,
                          quantity: nextQty,
                          quantityInput: fractional ? raw : String(nextQty || ""),
                        }
                      : c
                  )
                );
              }}
              onBlur={() =>
                setCart((prev) =>
                  prev.map((c, i) => {
                    if (i !== idx) return c;
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
                )
              }
              className={`${INPUT_CLASS} min-w-0 flex-1 text-center font-semibold tabular-nums`}
            />
            <Button
              variant="outline"
              size="sm"
              aria-label={`Aumentar cantidad de ${line.product.name}`}
              onClick={() =>
                setCart((prev) =>
                  prev.map((c, i) => {
                    if (i !== idx) return c;
                    const cur = Number.isFinite(c.quantity)
                      ? Math.max(0, c.quantity)
                      : 0;
                    const nextQty = fractional
                      ? normalizeOrderQuantity(cur + 1, true) || 1
                      : Math.max(1, Math.floor(cur) + 1);
                    return {
                      ...c,
                      quantity: nextQty,
                      quantityInput: String(nextQty),
                    };
                  })
                )
              }
              className="px-2.5"
            >
              <PlusIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {discountOpen && (
          <div>
            <FieldLabel htmlFor={`cart-disc-${line.product.product_id}`}>
              Descuento S/ /{" "}
              <span title={formatUnitTitleEs(line.product.unit_of_measure || "NIU")}>
                {line.product.unit_of_measure || "NIU"}
              </span>
            </FieldLabel>
            <div className="mt-1 flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                aria-label={`Reducir descuento en 1 sol para ${line.product.name}`}
                onClick={() =>
                  setCart((prev) =>
                    prev.map((c, i) =>
                      i === idx
                        ? {
                            ...c,
                            unitDiscountPen: Math.max(
                              0,
                              (Number.isFinite(c.unitDiscountPen)
                                ? c.unitDiscountPen
                                : 0) - 1
                            ),
                          }
                        : c
                    )
                  )
                }
                className="px-2.5"
              >
                <MinusIcon className="h-3.5 w-3.5" />
              </Button>
              <input
                id={`cart-disc-${line.product.product_id}`}
                type="number"
                step="0.01"
                min={0}
                value={Number.isFinite(line.unitDiscountPen) ? line.unitDiscountPen : 0}
                onChange={(e) => {
                  const raw = e.target.value;
                  const parsed = raw === "" ? 0 : Number(raw);
                  if (!Number.isFinite(parsed)) return;
                  setCart((prev) =>
                    prev.map((c, i) =>
                      i === idx
                        ? {
                            ...c,
                            unitDiscountPen: Math.max(0, parsed),
                          }
                        : c
                    )
                  );
                }}
                className={`${INPUT_CLASS} min-w-0 flex-1 text-center font-semibold tabular-nums`}
              />
              <Button
                variant="outline"
                size="sm"
                aria-label={`Aumentar descuento en 1 sol para ${line.product.name}`}
                onClick={() =>
                  setCart((prev) =>
                    prev.map((c, i) =>
                      i === idx
                        ? {
                            ...c,
                            unitDiscountPen:
                              (Number.isFinite(c.unitDiscountPen)
                                ? c.unitDiscountPen
                                : 0) + 1,
                          }
                        : c
                    )
                  )
                }
                className="px-2.5"
              >
                <PlusIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E7E5E0]/80 pt-2 text-xs tabular-nums">
        <span className="text-[#5C5A55]">
          Final /{" "}
          <span title={formatUnitTitleEs(line.product.unit_of_measure || "NIU")}>
            {line.product.unit_of_measure || "NIU"}
          </span>
          : <strong className="text-[#18181B]">S/ {finalUnit.toFixed(2)}</strong>
        </span>
        <span className="text-sm font-semibold text-[#18181B]">
          Subtotal: S/ {(safeQty * finalUnit).toFixed(2)}
        </span>
      </div>

      {belowMin && !isPartnerControlUser && (
        <p className="flex items-start gap-1.5 text-xs font-medium text-[#B45309]">
          <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            Precio menor al mínimo comercial (S/ {min.toFixed(2)}
            ). Quedará registrado; solo requiere aprobación si baja del costo.
          </span>
        </p>
      )}
    </div>
  );
}
