"use client";

import React from "react";
import { formatPen } from "@/features/partners/components/types";
import { PlusIcon } from "@/components/ui/Icons";
import { Button, Card } from "@/components/ui/Primitives";
import type { PartnerData } from "./usePartnerData";

interface HoyPendingOnDemandCardProps {
  pendingOnDemand: PartnerData["pendingOnDemand"];
  onGoToPurchaseProduct: (target: {
    productId: number;
    quantity?: number;
    orderLineId?: number;
  }) => void;
}

export function HoyPendingOnDemandCard({
  pendingOnDemand,
  onGoToPurchaseProduct,
}: HoyPendingOnDemandCardProps) {
  if (pendingOnDemand.length === 0) return null;

  return (
    <Card
      tone="horizon"
      accent="horizon"
      padding="md"
      className="bht-contain-region space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base sm:text-lg font-bold text-bht-navy-deep">
          Pedidos Bajo Pedido Pendientes de Compra ({pendingOnDemand.length})
        </h2>
      </div>
      <div className="grid gap-2.5 md:grid-cols-2">
        {pendingOnDemand.map((od) => (
          <div
            key={od.order_line_id}
            className="flex items-center justify-between gap-3 rounded-xl border border-bht-line-blue bg-white p-3 text-xs"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-bht-ink-strong">
                {od.sku} — {od.product_name} (×{Number(od.quantity)}{" "}
                {od.unit_of_measure || "NIU"})
              </p>
              <p className="mt-0.5 truncate text-bht-ink-soft tabular-nums">
                {od.order_code} · {od.customer_name || od.customer_name_raw || "-"} ·{" "}
                {formatPen(od.line_total_pen)}
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              aria-label={`Comprar ${od.sku} (${od.product_name})`}
              onClick={() =>
                onGoToPurchaseProduct({
                  productId: Number(od.product_id),
                  quantity: Number(od.quantity || 1),
                  orderLineId: Number(od.order_line_id),
                })
              }
              className="flex-shrink-0"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Comprar
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
