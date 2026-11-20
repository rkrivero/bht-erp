"use client";

import { Button, Card, FieldLabel, INPUT_CLASS } from "@/components/ui/Primitives";
import { ORDER_EDIT_REASONS } from "@/features/seller/seller-utils";
import type { SellerOrderFlow } from "@/features/seller/useSellerOrderFlow";

export default function SellerOrderEditCard({ flow }: { flow: SellerOrderFlow }) {
  const {
    editingOrderId,
    editingOrderCode,
    editingQuoteId,
    editingQuoteCode,
    quoteEditReason,
    setQuoteEditReason,
    editReasonCode,
    setEditReasonCode,
    editReasonNote,
    setEditReasonNote,
    resetOrderDraft,
  } = flow;

  if (editingQuoteId !== null) {
    return (
      <Card className="space-y-3 border-bht-tone-a9c7e3 bg-bht-mist lg:col-span-12">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-semibold text-bht-navy-deep">
              Editando cotización {editingQuoteCode}
            </p>
            <p className="text-xs text-bht-ink-soft">
              Ajusta productos, cantidades, precios o descuento global. La modificación
              quedará registrada en el historial.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={resetOrderDraft}>
            Cancelar edición
          </Button>
        </div>
        <div>
          <FieldLabel htmlFor="quote-edit-reason">
            Motivo de la modificación (opcional)
          </FieldLabel>
          <input
            id="quote-edit-reason"
            type="text"
            value={quoteEditReason}
            onChange={(event) => setQuoteEditReason(event.target.value)}
            placeholder="Ej. Cliente pidió ajustar cantidades o rebaja en cemento..."
            className={`${INPUT_CLASS} mt-1.5`}
          />
        </div>
      </Card>
    );
  }

  if (editingOrderId === null) return null;

  return (
    <Card className="space-y-3 border-bht-tone-a9c7e3 bg-bht-mist lg:col-span-12">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-bht-navy-deep">
            Modificando pedido {editingOrderCode}
          </p>
          <p className="text-xs text-bht-ink-soft">
            El pedido volverá a alistamiento y se guardará la versión anterior.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={resetOrderDraft}>
          Cancelar edición
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor="order-edit-reason">Motivo del cambio</FieldLabel>
          <select
            id="order-edit-reason"
            value={editReasonCode}
            onChange={(event) => setEditReasonCode(event.target.value)}
            className={`${INPUT_CLASS} mt-1.5`}
          >
            {ORDER_EDIT_REASONS.map((reason) => (
              <option key={reason.code} value={reason.code}>
                {reason.label}
              </option>
            ))}
          </select>
        </div>
        {editReasonCode === "OTHER" && (
          <div>
            <FieldLabel htmlFor="order-edit-note" required>
              Describe el motivo
            </FieldLabel>
            <input
              id="order-edit-note"
              value={editReasonNote}
              onChange={(event) => setEditReasonNote(event.target.value)}
              className={`${INPUT_CLASS} mt-1.5`}
              required
            />
          </div>
        )}
      </div>
    </Card>
  );
}
