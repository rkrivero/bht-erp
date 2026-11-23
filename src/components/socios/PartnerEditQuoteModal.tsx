"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangleIcon,
  MinusIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/ui/Icons";
import {
  Button,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
} from "@/components/ui/Primitives";
import type { SellerQuoteDto, SellerQuoteUpdatePayload } from "@/features/seller/types";
import { formatUnitTitleEs } from "@/lib/labels-es";
import { formatPen } from "./types";

interface EditableLine {
  quote_line_id: number;
  product_id: number;
  sku: string | null;
  raw_description: string;
  unit_of_measure: string;
  quantity: number;
  quantityInput: string;
  unitPricePen: number;
  unitPriceInput: string;
  baseUnitPricePen: number;
}

interface PartnerEditQuoteModalProps {
  quote: SellerQuoteDto | null;
  open: boolean;
  onClose: () => void;
  onSave: (payload: SellerQuoteUpdatePayload) => Promise<void>;
  isSaving: boolean;
}

export function PartnerEditQuoteModal({
  quote,
  open,
  onClose,
  onSave,
  isSaving,
}: PartnerEditQuoteModalProps) {
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [globalDiscountInput, setGlobalDiscountInput] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!quote || !open) return;
    const initialLines: EditableLine[] = (quote.lines || []).map((l) => {
      const qty = Number(l.quantity) || 1;
      const unit = Number(l.unit_price_pen) || 0;
      const base = Number(l.base_unit_price_pen ?? l.unit_price_pen) || unit;
      return {
        quote_line_id: l.quote_line_id,
        product_id: Number(l.product_id) || 0,
        sku: l.sku ?? null,
        raw_description: l.raw_description,
        unit_of_measure: l.unit_of_measure || "NIU",
        quantity: qty,
        quantityInput: String(qty),
        unitPricePen: unit,
        unitPriceInput: unit.toFixed(2),
        baseUnitPricePen: base,
      };
    });
    setLines(initialLines);
    setGlobalDiscountInput(
      Number(quote.global_discount_pen ?? 0) > 0
        ? Number(quote.global_discount_pen).toFixed(2)
        : ""
    );
    setNotes(quote.notes ?? "");
    setReason("");
    setError(null);
  }, [quote, open]);

  if (!quote) return null;

  const subtotalPen = lines.reduce(
    (acc, l) =>
      acc +
      (Number.isFinite(l.quantity) ? l.quantity : 0) *
        (Number.isFinite(l.unitPricePen) ? l.unitPricePen : 0),
    0
  );
  const parsedGlobalDiscount = Math.max(0, Number(globalDiscountInput) || 0);
  const totalPen = Math.max(0, subtotalPen - parsedGlobalDiscount);

  function updateLine(idx: number, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeLine(idx: number) {
    if (lines.length <= 1) {
      setError("La cotización debe tener al menos un producto.");
      return;
    }
    setError(null);
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!quote) return;
    setError(null);
    if (!reason.trim()) {
      setError("Indica el motivo de la modificación (obligatorio para la auditoría).");
      return;
    }
    if (lines.length === 0) {
      setError("Agrega al menos un producto.");
      return;
    }
    for (const l of lines) {
      if (!Number.isFinite(l.quantity) || l.quantity <= 0) {
        setError(`Revisa la cantidad de "${l.raw_description}". Debe ser mayor a 0.`);
        return;
      }
      if (!Number.isFinite(l.unitPricePen) || l.unitPricePen <= 0) {
        setError(
          `El precio unitario de "${l.raw_description}" debe ser mayor a S/ 0.00.`
        );
        return;
      }
    }
    if (parsedGlobalDiscount >= subtotalPen && subtotalPen > 0) {
      setError("El descuento global no puede ser mayor o igual al subtotal.");
      return;
    }

    const payload: SellerQuoteUpdatePayload = {
      action: "update_quote",
      quoteId: quote.quote_id,
      customerPartyId: quote.customer_party_id ?? null,
      customerNameRaw: quote.customer_name,
      globalDiscountPen: parsedGlobalDiscount,
      notes: notes.trim() || undefined,
      reason: reason.trim(),
      lines: lines.map((l) => ({
        productId: l.product_id,
        rawDescription: l.raw_description,
        quantity: l.quantity,
        unitPricePen: Number(l.unitPricePen.toFixed(4)),
      })),
    };

    try {
      await onSave(payload);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al guardar la cotización.");
    }
  }

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={`Modificar cotización ${quote.quote_code}`}
      subtitle={`${quote.customer_name} · Registrada el ${quote.issue_date}`}
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-sm">
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-bht-danger-line bg-bht-danger-bg p-3 text-xs font-medium text-bht-danger">
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <FieldLabel htmlFor="edit-quote-reason" required>
            Motivo de la modificación (auditoría obligatoria)
          </FieldLabel>
          <input
            id="edit-quote-reason"
            type="text"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej. Rebaja autorizada por volumen, cambio de cantidad, actualización de precio..."
            className={`${INPUT_CLASS} mt-1`}
          />
        </div>

        <div className="space-y-2">
          <FieldLabel>Productos y precios negociados ({lines.length})</FieldLabel>
          <div className="space-y-2">
            {lines.map((l, idx) => {
              const diff = Number((l.unitPricePen - l.baseUnitPricePen).toFixed(2));
              const hasDiff = Math.abs(diff) > 0.005 && l.baseUnitPricePen > 0;
              return (
                <div
                  key={l.quote_line_id || idx}
                  className="rounded-xl border border-bht-line bg-bht-paper/70 p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-bht-ink-strong">
                        {l.raw_description}
                      </p>
                      <p className="text-xs text-bht-ink-soft tabular-nums">
                        Lista original: S/ {l.baseUnitPricePen.toFixed(2)}{" "}
                        <span title={formatUnitTitleEs(l.unit_of_measure)}>
                          / {l.unit_of_measure}
                        </span>
                        {hasDiff && (
                          <>
                            {" · "}
                            <span
                              className={
                                diff < 0
                                  ? "font-semibold text-bht-warning-text"
                                  : "font-semibold text-bht-success"
                              }
                            >
                              {diff > 0
                                ? `+S/ ${diff.toFixed(2)}`
                                : `-S/ ${Math.abs(diff).toFixed(2)}`}
                            </span>
                            {" · "}
                            <button
                              type="button"
                              onClick={() =>
                                updateLine(idx, {
                                  unitPricePen: l.baseUnitPricePen,
                                  unitPriceInput: l.baseUnitPricePen.toFixed(2),
                                })
                              }
                              className="font-medium text-bht-cobalt underline decoration-1 underline-offset-2 cursor-pointer"
                            >
                              Restaurar
                            </button>
                          </>
                        )}
                      </p>
                    </div>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        aria-label={`Quitar ${l.raw_description}`}
                        className="rounded-lg p-1.5 text-bht-ink-muted hover:bg-bht-danger-bg hover:text-bht-danger cursor-pointer"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <FieldLabel htmlFor={`edit-qty-${idx}`}>
                        Cantidad ({l.unit_of_measure})
                      </FieldLabel>
                      <div className="mt-1 flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const cur = Number.isFinite(l.quantity) ? l.quantity : 1;
                            const next = Math.max(1, cur - 1);
                            updateLine(idx, {
                              quantity: next,
                              quantityInput: String(next),
                            });
                          }}
                          className="px-2"
                        >
                          <MinusIcon className="h-3 w-3" />
                        </Button>
                        <input
                          id={`edit-qty-${idx}`}
                          type="number"
                          step="any"
                          min="0.01"
                          value={l.quantityInput}
                          onChange={(e) => {
                            const raw = e.target.value.replace(",", ".");
                            const parsed = Number(raw);
                            updateLine(idx, {
                              quantity:
                                Number.isFinite(parsed) && parsed > 0 ? parsed : 0,
                              quantityInput: raw,
                            });
                          }}
                          className={`${INPUT_CLASS} min-w-0 flex-1 px-1.5 text-center font-semibold tabular-nums`}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const cur = Number.isFinite(l.quantity) ? l.quantity : 0;
                            const next = cur + 1;
                            updateLine(idx, {
                              quantity: next,
                              quantityInput: String(next),
                            });
                          }}
                          className="px-2"
                        >
                          <PlusIcon className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    <div>
                      <FieldLabel htmlFor={`edit-price-${idx}`}>
                        Precio unitario (S/)
                      </FieldLabel>
                      <div className="relative mt-1">
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs font-medium text-bht-ink-muted"
                        >
                          S/
                        </span>
                        <input
                          id={`edit-price-${idx}`}
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={l.unitPriceInput}
                          onChange={(e) => {
                            const raw = e.target.value.replace(",", ".");
                            const parsed = Number(raw);
                            updateLine(idx, {
                              unitPricePen:
                                Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
                              unitPriceInput: raw,
                            });
                          }}
                          className={`${INPUT_CLASS} pl-7 pr-2.5 text-right font-semibold tabular-nums`}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-bht-line pt-1.5 text-xs tabular-nums">
                    <span className="text-bht-ink-soft">Subtotal línea</span>
                    <strong className="text-bht-ink-strong">
                      {formatPen(l.quantity * l.unitPricePen)}
                    </strong>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="edit-global-discount">
              Descuento global (S/ opcional)
            </FieldLabel>
            <div className="relative mt-1">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-medium text-bht-ink-muted"
              >
                S/
              </span>
              <input
                id="edit-global-discount"
                type="number"
                step="0.01"
                min="0"
                value={globalDiscountInput}
                onChange={(e) => setGlobalDiscountInput(e.target.value)}
                placeholder="0.00"
                className={`${INPUT_CLASS} pl-8 text-right font-semibold tabular-nums`}
              />
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="edit-quote-notes">
              Notas o condiciones (opcional)
            </FieldLabel>
            <input
              id="edit-quote-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Vigencia, condiciones de pago..."
              className={`${INPUT_CLASS} mt-1`}
            />
          </div>
        </div>

        <div className="rounded-xl bg-bht-navy-deep px-4 py-3 text-white tabular-nums">
          {parsedGlobalDiscount > 0 && (
            <>
              <div className="flex items-center justify-between text-xs text-bht-line-blue">
                <span>Subtotal productos</span>
                <span>{formatPen(subtotalPen)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-bht-sky">
                <span>Descuento global</span>
                <span>-{formatPen(parsedGlobalDiscount)}</span>
              </div>
            </>
          )}
          <div className="flex items-center justify-between pt-0.5">
            <span className="text-sm font-medium text-bht-line-blue">
              Total cotización modificado
            </span>
            <span className="text-xl font-bold">{formatPen(totalPen)}</span>
          </div>
        </div>

        {Array.isArray(quote.audit_history) && quote.audit_history.length > 0 && (
          <details className="rounded-xl border border-bht-line bg-bht-mist/60 p-3 text-xs">
            <summary className="cursor-pointer font-semibold text-bht-navy-deep">
              Historial de modificaciones anteriores ({quote.audit_history.length})
            </summary>
            <div className="mt-2 space-y-1.5 border-t border-bht-line-blue pt-2 text-bht-ink-soft">
              {quote.audit_history.map((entry) => (
                <div key={entry.audit_id}>
                  <p className="font-semibold text-bht-ink-strong">{entry.reason}</p>
                  <p>
                    {entry.actor_name || "Usuario"} ·{" "}
                    {new Date(entry.created_at).toLocaleString("es-PE")}
                  </p>
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={isSaving || !reason.trim()}
          >
            {isSaving ? "Guardando..." : "Guardar modificación"}
          </Button>
        </div>
      </form>
    </ModalSheet>
  );
}
