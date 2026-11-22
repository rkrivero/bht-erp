"use client";

import { useState } from "react";
import { CloseIcon, ShoppingBagIcon } from "@/components/ui/Icons";
import {
  Button,
  Card,
  FieldLabel,
  INPUT_CLASS,
  SegmentedControl,
} from "@/components/ui/Primitives";
import { CREDIT_DAY_CHIPS } from "@/components/shared/CollectionControls";
import SellerCartLineCard from "@/features/seller/SellerCartLineCard";
import type { SellerOrderFlow } from "@/features/seller/useSellerOrderFlow";

export default function SellerOrderCheckout({ flow }: { flow: SellerOrderFlow }) {
  const {
    cart,
    cartSubtotalPen,
    parsedGlobalDiscountPen,
    cartTotalPen,
    customerNameRaw,
    paymentMode,
    paymentAccountId,
    setPaymentAccountId,
    yapePlinChannel,
    sellerAccounts,
    handleSelectYapePlin,
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
    globalDiscountPen,
    setGlobalDiscountPen,
    notes,
    setNotes,
    editingOrderId,
    editingQuoteId,
    editingQuoteCode,
    busyOrder,
    busyCreateQuote,
    busyCancelDraft,
    requiresPartnerApproval,
    handleSelectPaymentMode,
    handleCreateQuoteFromCart,
    resetOrderDraft,
    setCancelDraftOpen,
  } = flow;

  const [globalDiscountOpen, setGlobalDiscountOpen] = useState(false);
  const showGlobalDiscountInput = globalDiscountOpen || parsedGlobalDiscountPen > 0;
  const isEditingQuote = editingQuoteId !== null;
  const isEditingOrder = editingOrderId !== null;

  return (
    <div className="min-w-0 space-y-4 lg:col-span-5 lg:sticky lg:top-20">
      {cart.length === 0 ? (
        <Card
          accent="horizon"
          className="hidden lg:flex lg:flex-col lg:items-center lg:justify-center lg:py-10 text-center"
        >
          <div
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-bht-mist text-bht-navy-deep"
          >
            <ShoppingBagIcon className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-semibold text-bht-ink-strong">
            Resumen del pedido
          </p>
          <p className="mt-1 max-w-xs text-xs text-bht-ink-soft">
            Elige un cliente y agrega productos a la izquierda. Podrás ajustar cada
            precio unitario, aplicar un descuento global y registrar o cotizar directo
            aquí.
          </p>
        </Card>
      ) : (
        <Card
          id="cart-checkout-card"
          accent="horizon"
          className="space-y-3.5 shadow-bht-elev-16"
        >
          <div className="flex items-center justify-between gap-2 border-b border-bht-line pb-2.5">
            <h2 className="text-sm font-semibold text-bht-navy-deep">
              {isEditingQuote
                ? `Cotización ${editingQuoteCode}`
                : isEditingOrder
                  ? "Detalle del pedido"
                  : "Pedido actual"}{" "}
              · {cart.length} {cart.length === 1 ? "ítem" : "ítems"}
            </h2>
            {!showGlobalDiscountInput && (
              <button
                type="button"
                data-compact="true"
                onClick={() => setGlobalDiscountOpen(true)}
                className="text-xs font-semibold text-bht-cobalt hover:underline cursor-pointer"
              >
                + Descuento global
              </button>
            )}
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

          {showGlobalDiscountInput && (
            <div className="flex items-end gap-2 rounded-xl border border-bht-line bg-bht-paper/70 p-2.5">
              <div className="min-w-0 flex-1">
                <FieldLabel htmlFor="seller-global-discount">
                  Descuento global (S/)
                </FieldLabel>
                <div className="relative mt-1">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-medium text-bht-ink-muted"
                  >
                    S/
                  </span>
                  <input
                    id="seller-global-discount"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={globalDiscountPen}
                    onChange={(e) => setGlobalDiscountPen(e.target.value)}
                    placeholder="0.00"
                    className={`${INPUT_CLASS} pl-8 text-right font-semibold tabular-nums`}
                  />
                </div>
              </div>
              <button
                type="button"
                data-compact="true"
                aria-label="Quitar descuento global"
                onClick={() => {
                  setGlobalDiscountPen("");
                  setGlobalDiscountOpen(false);
                }}
                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-bht-line bg-white text-bht-ink-soft hover:bg-bht-danger-bg hover:text-bht-danger cursor-pointer"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="space-y-1 rounded-xl bg-bht-navy-deep px-4 py-3 text-white shadow-xs tabular-nums">
            {parsedGlobalDiscountPen > 0 && (
              <>
                <div className="flex items-center justify-between text-xs text-bht-line-blue">
                  <span>Subtotal</span>
                  <span>S/ {cartSubtotalPen.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-bht-sky">
                  <span>Descuento global</span>
                  <span>-S/ {parsedGlobalDiscountPen.toFixed(2)}</span>
                </div>
              </>
            )}
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-sm font-medium text-bht-line-blue">
                {isEditingQuote ? "Total cotización" : "Total"}
              </span>
              <span className="text-xl font-semibold">
                S/ {cartTotalPen.toFixed(2)}
              </span>
            </div>
          </div>

          {!isEditingQuote && (
            <div
              id="seller-step-payment"
              className="space-y-3 rounded-xl border border-bht-line bg-bht-paper/70 p-3"
            >
              <div>
                <p
                  id="seller-payment-mode-label"
                  className="block text-xs font-medium text-bht-ink-soft"
                >
                  Condición de pago
                </p>
                <div
                  role="group"
                  aria-labelledby="seller-payment-mode-label"
                  className="mt-1.5 grid grid-cols-2 gap-1.5"
                >
                  {(
                    [
                      { id: "CASH", label: "Efectivo", mode: "CASH", channel: null },
                      { id: "YAPE", label: "Yape", mode: "YAPE_PLIN", channel: "YAPE" },
                      { id: "PLIN", label: "Plin", mode: "YAPE_PLIN", channel: "PLIN" },
                      {
                        id: "TRANSFER",
                        label: "Transferencia",
                        mode: "TRANSFER",
                        channel: null,
                      },
                      {
                        id: "CREDIT",
                        label: "A Crédito",
                        mode: "CREDIT",
                        channel: null,
                      },
                    ] as const
                  ).map((opt) => {
                    const active =
                      opt.mode === "YAPE_PLIN"
                        ? paymentMode === "YAPE_PLIN" && yapePlinChannel === opt.channel
                        : paymentMode === opt.mode;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          opt.channel
                            ? handleSelectYapePlin(opt.channel)
                            : handleSelectPaymentMode(opt.mode)
                        }
                        className={`min-h-[40px] rounded-xl border px-3 py-2 text-xs font-semibold transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep/45 ${
                          active
                            ? "border-bht-navy-deep bg-bht-navy-deep text-white shadow-xs"
                            : "border-bht-line bg-white text-bht-ink-soft hover:border-bht-line-blue hover:bg-bht-mist hover:text-bht-navy-deep"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {(paymentMode === "YAPE_PLIN" || paymentMode === "TRANSFER") &&
                  sellerAccounts.filter((a) => a.is_active !== false).length > 0 && (
                    <div className="mt-2">
                      <FieldLabel htmlFor="seller-payment-account">
                        Cuenta bancaria destino
                      </FieldLabel>
                      <select
                        id="seller-payment-account"
                        value={paymentAccountId ?? ""}
                        onChange={(e) =>
                          setPaymentAccountId(
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                        className={`${INPUT_CLASS} mt-1 min-h-[40px]`}
                      >
                        <option value="">Por defecto del sistema</option>
                        {sellerAccounts
                          .filter(
                            (a) => a.is_active !== false && a.code !== "CAJA_RUTA"
                          )
                          .map((acc) => (
                            <option key={acc.account_id} value={acc.account_id}>
                              {acc.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
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
                <div className="space-y-3 rounded-xl border border-bht-amber-line bg-bht-amber-bg p-3">
                  <div>
                    <p
                      id="seller-credit-days-label"
                      className="block text-xs font-medium text-bht-warning-text"
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
                            className={`min-h-[34px] rounded-full border px-2.5 py-1 text-xs font-medium transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep/45 ${
                              active
                                ? "border-bht-navy-deep bg-bht-navy-deep text-white"
                                : "border-bht-tone-e7d3b1 bg-white text-bht-warning-text hover:bg-bht-paper"
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
                        className={`min-h-[34px] rounded-full border px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep/45 ${
                          showCustomPromiseDate
                            ? "border-bht-navy-deep bg-bht-navy-deep text-white"
                            : "border-bht-tone-e7d3b1 bg-white text-bht-warning-text"
                        }`}
                      >
                        Otra fecha
                      </button>
                    </div>
                    {showCustomPromiseDate && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <label
                          htmlFor="seller-custom-date"
                          className="text-xs font-medium text-bht-warning-text"
                        >
                          Fecha:
                        </label>
                        <input
                          id="seller-custom-date"
                          type="date"
                          value={customPromiseDate}
                          onChange={(e) => setCustomPromiseDate(e.target.value)}
                          className="min-h-[36px] rounded-lg border border-bht-tone-e7d3b1 bg-white px-2.5 py-1 text-xs font-medium text-bht-ink-strong focus:border-bht-navy-deep focus:outline-none focus:ring-2 focus:ring-bht-navy-deep/15"
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <FieldLabel
                      htmlFor="seller-initial-paid"
                      className="text-bht-warning-text"
                    >
                      Adelanto inicial hoy (opcional, S/)
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
            </div>
          )}

          <div>
            <FieldLabel htmlFor="seller-order-notes">
              {isEditingQuote
                ? "Nota de cotización (opcional)"
                : "Dirección o nota para almacén (opcional)"}
            </FieldLabel>
            <input
              id="seller-order-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                isEditingQuote
                  ? "Condiciones, vigencia o referencia..."
                  : "Dirección de entrega o referencia..."
              }
              className={`${INPUT_CLASS} mt-1.5`}
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            {isEditingQuote ? (
              <>
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={busyCreateQuote}
                  className="flex-1"
                >
                  {busyCreateQuote
                    ? "Guardando cotización..."
                    : `Guardar cambios (${editingQuoteCode})`}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  disabled={busyCreateQuote}
                  onClick={resetOrderDraft}
                  className="sm:w-auto"
                >
                  Cancelar
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="submit"
                  variant={requiresPartnerApproval ? "primary" : "success"}
                  size="lg"
                  disabled={busyOrder || busyCreateQuote}
                  className="flex-1"
                >
                  {busyOrder
                    ? isEditingOrder
                      ? "Guardando cambios..."
                      : "Guardando pedido..."
                    : isEditingOrder
                      ? "Guardar cambios"
                      : "Registrar pedido"}
                </Button>
                {!isEditingOrder && (
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
                  onClick={() =>
                    isEditingOrder ? resetOrderDraft() : setCancelDraftOpen(true)
                  }
                  className="border-bht-line bg-bht-paper text-bht-ink-soft hover:border-bht-tone-e8c5c5 hover:bg-bht-danger-bg/65 hover:text-bht-danger-strong sm:w-auto"
                >
                  {isEditingOrder ? "Cancelar" : "Descartar"}
                </Button>
              </>
            )}
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
              className="border-bht-line bg-bht-paper text-bht-ink-soft hover:border-bht-tone-e8c5c5 hover:bg-bht-danger-bg/65 hover:text-bht-danger-strong"
            >
              Descartar borrador
            </Button>
          </div>
        )}
    </div>
  );
}
