"use client";

import SellerOrderCheckout from "@/features/seller/SellerOrderCheckout";
import SellerOrderClientStep from "@/features/seller/SellerOrderClientStep";
import SellerOrderEditCard from "@/features/seller/SellerOrderEditCard";
import SellerOrderProductsStep from "@/features/seller/SellerOrderProductsStep";
import type { SellerOrderFlow } from "@/features/seller/useSellerOrderFlow";

export default function SellerProgressiveOrder({ flow }: { flow: SellerOrderFlow }) {
  const { editingOrderId, editingQuoteId, handleSubmitOrder } = flow;
  const isEditing = editingOrderId !== null || editingQuoteId !== null;

  return (
    <section aria-label="Toma de pedidos y cotizaciones" className="space-y-4">
      <form
        onSubmit={handleSubmitOrder}
        className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start lg:gap-5"
      >
        {isEditing && <SellerOrderEditCard flow={flow} />}
        <div className="min-w-0 space-y-4 lg:col-span-7">
          <SellerOrderClientStep flow={flow} />
          <SellerOrderProductsStep flow={flow} />
        </div>
        <SellerOrderCheckout flow={flow} />
      </form>
    </section>
  );
}
