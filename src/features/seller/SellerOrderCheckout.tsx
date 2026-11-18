"use client";

import { ShoppingBagIcon } from "@/components/ui/Icons";
import {
  Button,
  Card,
  FieldLabel,
  INPUT_CLASS,
  SegmentedControl,
} from "@/components/ui/Primitives";
import { CREDIT_DAY_CHIPS } from "@/components/shared/CollectionControls";
import { formatPaymentModeEs } from "@/lib/labels-es";
import SellerCartLineCard from "@/features/seller/SellerCartLineCard";
import type { SellerOrderFlow } from "@/features/seller/useSellerOrderFlow";

export default function SellerOrderCheckout({ flow }: { flow: SellerOrderFlow }) {
  const {
    orderStep,
    cart,
    cartTotalPen,
    customerNameRaw,
    paymentMode,
    collectOnDelivery,
    setCollectOnDelivery,
    creditDays,
    setCreditDays,
    customPromiseDate,
    setCustomPromiseDate,
    showCustomPromiseDate,
    setShowCustomPromiseDate,
    initialPaidPen,
    setInitialPaidPen,
    notes,
    setNotes,
    editingOrderId,
    busyOrder,
    busyCreateQuote,
    busyCancelDraft,
    requiresPartnerApproval,
    openOrderStep,
    handleSelectPaymentMode,
    handleCreateQuoteFromCart,
    setCancelDraftOpen,
  } = flow;
  return (
    <div className="min-w-0 space-y-4 lg:col-span-5 lg:sticky lg:top-20">
      {cart.length === 0 && (
        <Card
          accent="horizon"
          className="hidden lg:flex lg:flex-col lg:items-center lg:justify-center lg:py-10 text-center"
        >
          <div
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F2F6FA] text-[#0F2942]"
          >
            <ShoppingBagIcon className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-semibold text-[#18181B]">
            3. Resumen, pago y envío
          </p>
          <p className="mt-1 max-w-xs text-xs text-[#5C5A55]">
            Elige cliente y agrega productos a la izquierda; luego confirma aquí la
            forma de pago y el envío.
          </p>
        </Card>
      )}
      {cart.length > 0 && (
        <Card
          id="cart-checkout-card"
          accent="horizon"
          className="space-y-3.5 shadow-[0_4px_16px_rgba(15,41,66,0.05)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D4E0EC] pb-2.5">
            <h2 className="text-sm font-semibold text-[#0F2942]">
              3. Resumen y pago · {cart.length} producto(s)
            </h2>
          </div>

          <div className="space-y-2.5">
            {cart.map((line, idx) => (
              <SellerCartLineCard
                key={line.product.product_id}
                line={line}
                idx={idx}
                flow={flow}
              />
            ))}
          </div>

          <div className="flex items-center justify-between rounded-xl bg-[#0F2942] px-4 py-3.5 text-white shadow-xs">
            <span className="text-sm font-medium text-[#D4E0EC]">Total del pedido</span>
            <span className="text-xl font-semibold tabular-nums">
              S/ {cartTotalPen.toFixed(2)}
            </span>
          </div>

          {/* Step 3b: Payment Condition decided once total is known */}
          <div
            id="seller-step-payment"
            className={`scroll-mt-24 space-y-3 rounded-xl border border-[#E7E5E0] bg-[#FAF9F6]/70 p-3.5 ${orderStep === "confirmation" ? "hidden" : ""}`}
          >
            <div>
              <p
                id="seller-payment-mode-label"
                className="block text-xs font-medium text-[#5C5A55]"
              >
                3. Condición de pago
              </p>
              <div
                role="group"
                aria-labelledby="seller-payment-mode-label"
                className="mt-1.5 grid grid-cols-2 gap-1.5"
              >
                {(
                  [
                    ["CASH", "Efectivo"],
                    ["YAPE_PLIN", "Yape / Plin"],
                    ["TRANSFER", "Transferencia"],
                    ["CREDIT", "A Crédito"],
                  ] as const
                ).map(([mode, label]) => {
                  const active = paymentMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={active}
                      onClick={() => handleSelectPaymentMode(mode)}
                      className={`min-h-[40px] rounded-xl border px-3 py-2 text-xs font-semibold transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 ${
                        active
                          ? "border-[#0F2942] bg-[#0F2942] text-white shadow-xs"
                          : "border-[#E7E5E0] bg-white text-[#5C5A55] hover:border-[#D4E0EC] hover:bg-[#F2F6FA] hover:text-[#0F2942]"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {paymentMode !== "CREDIT" && (
              <SegmentedControl
                ariaLabel="Momento de cobro"
                value={collectOnDelivery ? "cod" : "now"}
                onChange={(v) => setCollectOnDelivery(v === "cod")}
                options={[
                  { id: "cod", label: "Contra Entrega" },
                  { id: "now", label: "Ya pagó hoy" },
                ]}
              />
            )}

            {paymentMode === "CREDIT" && (
              <div className="space-y-3 rounded-xl border border-[#F3D9B1] bg-[#FDF8F0] p-3">
                <div>
                  <p
                    id="seller-credit-days-label"
                    className="block text-xs font-medium text-[#78350F]"
                  >
                    ¿Cuándo volvemos a cobrar?
                  </p>
                  <div
                    role="group"
                    aria-labelledby="seller-credit-days-label"
                    className="mt-1.5 flex flex-wrap gap-1.5"
                  >
                    {CREDIT_DAY_CHIPS.slice(0, 3).map((chip) => {
                      const active = creditDays === chip.days && !customPromiseDate;
                      return (
                        <button
                          key={chip.days}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            setCreditDays(chip.days);
                            setCustomPromiseDate("");
                            setShowCustomPromiseDate(false);
                          }}
                          className={`min-h-[34px] rounded-full border px-2.5 py-1 text-xs font-medium transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 ${
                            active
                              ? "border-[#0F2942] bg-[#0F2942] text-white"
                              : "border-[#E7D3B1] bg-white text-[#78350F] hover:bg-[#FAF9F6]"
                          }`}
                        >
                          {chip.label}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      aria-pressed={showCustomPromiseDate}
                      onClick={() => setShowCustomPromiseDate(true)}
                      className={`min-h-[34px] rounded-full border px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 ${showCustomPromiseDate ? "border-[#0F2942] bg-[#0F2942] text-white" : "border-[#E7D3B1] bg-white text-[#78350F]"}`}
                    >
                      Otra fecha
                    </button>
                  </div>
                  {showCustomPromiseDate && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label
                        htmlFor="seller-custom-date"
                        className="text-xs font-medium text-[#78350F]"
                      >
                        O fecha:
                      </label>
                      <input
                        id="seller-custom-date"
                        type="date"
                        value={customPromiseDate}
                        onChange={(e) => setCustomPromiseDate(e.target.value)}
                        className="min-h-[36px] rounded-lg border border-[#E7D3B1] bg-white px-2.5 py-1 text-xs font-medium text-[#18181B] focus:border-[#0F2942] focus:outline-none focus:ring-2 focus:ring-[#0F2942]/15"
                      />
                    </div>
                  )}
                </div>

                <div>
                  <FieldLabel htmlFor="seller-initial-paid" className="text-[#78350F]">
                    Adelanto inicial hoy (Opcional, S/)
                  </FieldLabel>
                  <input
                    id="seller-initial-paid"
                    type="number"
                    step="0.01"
                    min="0"
                    value={initialPaidPen}
                    onChange={(e) => setInitialPaidPen(e.target.value)}
                    placeholder="Ej. 200.00"
                    className={`${INPUT_CLASS} mt-1 tabular-nums`}
                  />
                </div>
              </div>
            )}
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => openOrderStep("confirmation")}
              className="w-full"
            >
              Revisar confirmación
            </Button>
          </div>

          <div>
            <FieldLabel htmlFor="seller-order-notes">
              Dirección o nota para almacén (opcional)
            </FieldLabel>
            <input
              id="seller-order-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Dirección de entrega o referencia..."
              className={`${INPUT_CLASS} mt-1.5`}
            />
          </div>

          <section
            id="seller-step-confirmation"
            aria-labelledby="seller-confirmation-heading"
            className={`scroll-mt-24 rounded-xl border border-[#D4E0EC] bg-white p-3 ${orderStep !== "confirmation" ? "hidden" : ""}`}
          >
            <h3
              id="seller-confirmation-heading"
              className="text-xs font-semibold text-[#0F2942]"
            >
              4. Confirma el destino del pedido
            </h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-[#5C5A55]">Cliente</dt>
              <dd className="text-right font-medium text-[#18181B]">
                {customerNameRaw.trim() || "Pendiente"}
              </dd>
              <dt className="text-[#5C5A55]">Total</dt>
              <dd className="text-right font-semibold tabular-nums text-[#18181B]">
                S/ {cartTotalPen.toFixed(2)}
              </dd>
              <dt className="text-[#5C5A55]">Modalidad</dt>
              <dd className="text-right font-medium text-[#18181B]">
                {formatPaymentModeEs(paymentMode)}
              </dd>
              <dt className="text-[#5C5A55]">Cobro inicial</dt>
              <dd className="text-right font-medium tabular-nums text-[#18181B]">
                {paymentMode === "CREDIT" && Number(initialPaidPen) > 0
                  ? `S/ ${Number(initialPaidPen).toFixed(2)}`
                  : paymentMode === "CREDIT"
                    ? "Sin adelanto"
                    : collectOnDelivery
                      ? "Contra entrega"
                      : "Pagado hoy"}
              </dd>
              <dt className="text-[#5C5A55]">Destino</dt>
              <dd className="text-right font-medium text-[#18181B]">
                {notes.trim() || "Almacén para alistamiento"}
              </dd>
            </dl>
            <button
              type="button"
              onClick={() => openOrderStep("payment")}
              className="mt-3 text-xs font-semibold text-[var(--bht-cobalt)] underline decoration-1 underline-offset-4"
            >
              Editar pago
            </button>
          </section>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="submit"
              variant={requiresPartnerApproval ? "primary" : "success"}
              size="lg"
              disabled={busyOrder || busyCreateQuote}
              className="flex-1"
            >
              {busyOrder
                ? editingOrderId !== null
                  ? "Guardando cambios..."
                  : "Guardando pedido..."
                : editingOrderId !== null
                  ? "Guardar cambios y enviar a alistamiento"
                  : requiresPartnerApproval
                    ? "Enviar Pedido a Aprobación de Socio o Gerencia"
                    : "Confirmar Pedido y Enviar a Almacén"}
            </Button>
            {editingOrderId === null && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={busyOrder || busyCreateQuote}
                onClick={handleCreateQuoteFromCart}
                className="sm:w-auto"
              >
                {busyCreateQuote ? "Cotizando..." : "Cotizar"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={busyOrder || busyCancelDraft}
              onClick={() => setCancelDraftOpen(true)}
              className="border-[#E7E5E0] bg-[#FAF9F6] text-[#5C5A55] hover:border-[#E8C5C5] hover:bg-[#FEF2F2]/65 hover:text-[#991B1B] sm:w-auto"
            >
              Descartar pedido
            </Button>
          </div>
        </Card>
      )}

      {cart.length === 0 &&
        (customerNameRaw.trim().length > 0 || notes.trim().length > 0) && (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busyCancelDraft}
              onClick={() => setCancelDraftOpen(true)}
              className="border-[#E7E5E0] bg-[#FAF9F6] text-[#5C5A55] hover:border-[#E8C5C5] hover:bg-[#FEF2F2]/65 hover:text-[#991B1B]"
            >
              Descartar pedido
            </Button>
          </div>
        )}
    </div>
  );
}
