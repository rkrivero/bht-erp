"use client";

import SellerOrderCheckout from "@/features/seller/SellerOrderCheckout";
import SellerOrderClientStep from "@/features/seller/SellerOrderClientStep";
import SellerOrderEditCard from "@/features/seller/SellerOrderEditCard";
import SellerOrderProductsStep from "@/features/seller/SellerOrderProductsStep";
import type { SellerOrderStep } from "@/features/seller/types";
import type { SellerOrderFlow } from "@/features/seller/useSellerOrderFlow";

export default function SellerProgressiveOrder({ flow }: { flow: SellerOrderFlow }) {
  const {
    orderStep,
    cart,
    customerNameRaw,
    editingOrderId,
    openOrderStep,
    handleSubmitOrder,
  } = flow;
  return (
    <section aria-label="Nuevo pedido" className="space-y-4">
      <nav
        aria-label="Progreso del pedido"
        className="grid grid-cols-4 gap-1 rounded-2xl border border-[var(--border-hairline)] bg-white p-1.5"
      >
        {(
          [
            ["client", "Cliente", Boolean(customerNameRaw.trim())],
            ["products", "Productos", cart.length > 0],
            ["payment", "Pago", cart.length > 0],
            [
              "confirmation",
              "Confirmación",
              cart.length > 0 && Boolean(customerNameRaw.trim()),
            ],
          ] as Array<[SellerOrderStep, string, boolean]>
        ).map(([id, label, complete]) => (
          <button
            key={id}
            type="button"
            aria-current={orderStep === id ? "step" : undefined}
            onClick={() => openOrderStep(id)}
            className={`min-h-11 rounded-xl px-1.5 text-xs font-semibold transition-colors sm:text-xs ${orderStep === id ? "bg-[var(--bht-cobalt)] text-white" : complete ? "bg-[var(--bht-sky)] text-[var(--bht-navy)]" : "text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)]"}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <form
        onSubmit={handleSubmitOrder}
        className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start lg:gap-5"
      >
        {editingOrderId !== null && <SellerOrderEditCard flow={flow} />}
        <div className="min-w-0 space-y-4 lg:col-span-7">
          <SellerOrderClientStep flow={flow} />
          <SellerOrderProductsStep flow={flow} />
        </div>
        <SellerOrderCheckout flow={flow} />
      </form>
    </section>
  );
}
