"use client";

import {
  Button,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
} from "@/components/ui/Primitives";
import { CANCEL_DRAFT_REASONS } from "@/features/seller/seller-utils";
import type { SellerOrderFlow } from "@/features/seller/useSellerOrderFlow";

export function SellerCancelDraftModal({ flow }: { flow: SellerOrderFlow }) {
  const {
    cancelDraftOpen,
    setCancelDraftOpen,
    cancelReasonCode,
    setCancelReasonCode,
    cancelCustomNote,
    setCancelCustomNote,
    busyCancelDraft,
    handleConfirmCancelDraft,
  } = flow;
  return (
    <ModalSheet
      open={cancelDraftOpen}
      onClose={() => setCancelDraftOpen(false)}
      title="¿Por qué se canceló este pedido?"
      subtitle="Guardaremos el motivo para análisis comercial y limpiaremos el formulario."
    >
      <form onSubmit={handleConfirmCancelDraft} className="space-y-4">
        <div className="space-y-2" role="radiogroup" aria-label="Motivo de cancelación">
          {CANCEL_DRAFT_REASONS.map((r) => {
            const selected = cancelReasonCode === r.code;
            return (
              <button
                key={r.code}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setCancelReasonCode(r.code)}
                className={`flex min-h-[42px] w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-xs font-medium transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep/45 ${
                  selected
                    ? "border-bht-navy-deep bg-bht-mist text-bht-navy-deep font-semibold"
                    : "border-bht-line bg-white text-bht-ink-strong hover:border-bht-line-blue hover:bg-bht-paper"
                }`}
              >
                <span>{r.label}</span>
                <span
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 rounded-full border ${
                    selected
                      ? "border-bht-navy-deep bg-bht-navy-deep"
                      : "border-bht-line-stronger bg-white"
                  }`}
                />
              </button>
            );
          })}
        </div>

        <div>
          <FieldLabel htmlFor="cancel-draft-note">
            Detalle adicional (opcional)
          </FieldLabel>
          <input
            id="cancel-draft-note"
            type="text"
            value={cancelCustomNote}
            onChange={(e) => setCancelCustomNote(e.target.value)}
            placeholder="Ej. Competencia ofreció menor precio en tubo..."
            className={`${INPUT_CLASS} mt-1.5`}
          />
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => setCancelDraftOpen(false)}
            disabled={busyCancelDraft}
          >
            Seguir editando
          </Button>
          <Button type="submit" variant="primary" disabled={busyCancelDraft}>
            {busyCancelDraft ? "Registrando..." : "Registrar cancelación y limpiar"}
          </Button>
        </div>
      </form>
    </ModalSheet>
  );
}

export function SellerMobileCartBar({ flow }: { flow: SellerOrderFlow }) {
  const { cart, cartTotalPen } = flow;
  return (
    <div
      aria-label="Resumen móvil del pedido"
      className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] z-30 border-t border-bht-line-blue bg-white px-3.5 py-2 shadow-bht-elev-3 md:hidden"
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-bht-ink-soft">
            {cart.length} {cart.length === 1 ? "producto" : "productos"} en pedido
          </p>
          <p className="text-base font-semibold text-bht-navy-deep tabular-nums">
            Total: S/ {cartTotalPen.toFixed(2)}
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => {
            document
              .getElementById("cart-checkout-card")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          Ver carrito ({cart.length})
        </Button>
      </div>
    </div>
  );
}
