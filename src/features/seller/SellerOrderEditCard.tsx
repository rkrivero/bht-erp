"use client";

import { Button, Card, FieldLabel, INPUT_CLASS } from "@/components/ui/Primitives";
import { ORDER_EDIT_REASONS } from "@/features/seller/seller-utils";
import type { SellerOrderFlow } from "@/features/seller/useSellerOrderFlow";

export default function SellerOrderEditCard({ flow }: { flow: SellerOrderFlow }) {
  const {
    editingOrderCode,
    editReasonCode,
    setEditReasonCode,
    editReasonNote,
    setEditReasonNote,
    customerNameRaw,
    openOrderStep,
    resetOrderDraft,
  } = flow;
  return (
    <Card className="space-y-3 border-[#A9C7E3] bg-[#F2F6FA] lg:col-span-12">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-[#0F2942]">Modificando {editingOrderCode}</p>
          <p className="text-xs text-[#5C5A55]">
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
      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={!customerNameRaw.trim()}
        onClick={() => openOrderStep("products")}
        className="w-full sm:w-auto"
      >
        Continuar a productos
      </Button>
    </Card>
  );
}
