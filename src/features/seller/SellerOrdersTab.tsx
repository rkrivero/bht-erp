"use client";

import { ChevronRightIcon, PackageIcon } from "@/components/ui/Icons";
import { Badge, Button, Card, EmptyState } from "@/components/ui/Primitives";
import {
  formatFulfillmentModeEs,
  formatOperationalStatusEs,
  formatPaymentModeEs,
} from "@/lib/labels-es";
import type { SellerOrderDto, StateSetter } from "./types";

interface SellerOrdersTabProps {
  orders: SellerOrderDto[];
  expandedOrderId: number | null;
  setExpandedOrderId: StateSetter<number | null>;
  currentUserId?: number;
  onEdit: (order: SellerOrderDto) => void;
}

export default function SellerOrdersTab({
  orders,
  expandedOrderId,
  setExpandedOrderId,
  currentUserId,
  onEdit,
}: SellerOrdersTabProps) {
  if (orders.length === 0) {
    return (
      <section aria-label="Mis pedidos" className="space-y-3">
        <EmptyState
          icon={<PackageIcon className="h-5 w-5" />}
          title="Aún no hay pedidos registrados"
        />
      </section>
    );
  }

  return (
    <section aria-label="Mis pedidos" className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
        {orders.map((order) => {
          const expanded = expandedOrderId === order.order_id;
          const auditHistory = order.audit_history ?? [];
          const modified = auditHistory.some((entry) => entry.action === "EDIT");
          return (
            <Card key={order.order_id} padding="md" className="space-y-2.5">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() =>
                  setExpandedOrderId((previous) =>
                    previous === order.order_id ? null : order.order_id
                  )
                }
                className="w-full cursor-pointer space-y-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#1E446B] tabular-nums">
                    {order.order_code} · {order.order_date}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {order.trip_code && <Badge tone="brand">{order.trip_code}</Badge>}
                    {modified && <Badge tone="warning">Modificado</Badge>}
                    <Badge tone="neutral">
                      {formatOperationalStatusEs(order.operational_status)}
                    </Badge>
                    <ChevronRightIcon
                      className={`h-4 w-4 text-[#5C5A55] transition-transform ${expanded ? "rotate-90 text-[#0F2942]" : ""}`}
                    />
                  </div>
                </div>
                <h2 className="text-sm font-semibold text-[#18181B] sm:text-base">
                  {order.customer_name}
                </h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#5C5A55] tabular-nums">
                  <span>
                    Total:{" "}
                    <strong className="text-[#18181B]">
                      S/ {order.total_pen.toFixed(2)}
                    </strong>
                  </span>
                  <span>
                    Pagado:{" "}
                    <strong className="text-[#15803D]">
                      S/ {order.paid_pen.toFixed(2)}
                    </strong>
                  </span>
                  <span>
                    Saldo:{" "}
                    <strong
                      className={
                        order.balance_due_pen > 0.05
                          ? "text-[#B91C1C]"
                          : "text-[#15803D]"
                      }
                    >
                      S/ {order.balance_due_pen.toFixed(2)}
                    </strong>
                  </span>
                </div>
                <p className="rounded-lg bg-[#F2F6FA]/70 px-2.5 py-1.5 text-xs text-[#1E446B]">
                  Tomó: {order.created_by_name || "-"} · Preparó:{" "}
                  {order.picked_by_name || "Pendiente"} · Entregó:{" "}
                  {order.delivered_by_name || "Pendiente"}
                </p>
              </button>

              {expanded && (
                <div className="space-y-2 border-t border-[#E7E5E0] pt-2.5 text-xs">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-[#5C5A55]">
                    <span>
                      Detalle comprado ({order.lines.length}{" "}
                      {order.lines.length === 1 ? "ítem" : "ítems"})
                    </span>
                    <span>{formatPaymentModeEs(order.payment_mode)}</span>
                  </div>
                  {order.lines.length === 0 ? (
                    <p className="text-[#5C5A55]">
                      Sin líneas de producto registradas.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {order.lines.map((line) => (
                        <div
                          key={line.order_line_id}
                          className="flex items-start justify-between gap-2 rounded-lg border border-[#E7E5E0] bg-[#FAF9F6] px-2.5 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-[#18181B]">
                              {line.raw_description || line.sku}
                            </p>
                            <p className="text-xs text-[#5C5A55] tabular-nums">
                              {line.quantity} {line.unit_of_measure || "NIU"} × S/{" "}
                              {line.unit_price_pen.toFixed(2)}
                              {line.unit_discount_pen > 0
                                ? ` (desc. S/ ${line.unit_discount_pen.toFixed(2)}/u)`
                                : ""}{" "}
                              · {formatFulfillmentModeEs(line.fulfillment_mode)}
                            </p>
                          </div>
                          <span className="flex-shrink-0 font-semibold text-[#18181B] tabular-nums">
                            S/ {line.line_total_pen.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {order.notes && (
                    <p className="rounded-lg bg-[#FAF9F6] px-2.5 py-1.5 text-xs text-[#5C5A55]">
                      Nota: {order.notes}
                    </p>
                  )}
                  {auditHistory.length > 0 && (
                    <details className="rounded-lg border border-[#D4E0EC] bg-[#F2F6FA]/60 p-2.5">
                      <summary className="cursor-pointer font-semibold text-[#0F2942]">
                        Historial de cambios ({auditHistory.length})
                      </summary>
                      <div className="mt-2 space-y-2">
                        {auditHistory.map((entry) => (
                          <div
                            key={entry.audit_id}
                            className="border-t border-[#D4E0EC] pt-2 text-xs text-[#5C5A55]"
                          >
                            <p className="font-medium text-[#18181B]">
                              {entry.action === "CANCEL" ? "Anulación" : "Modificación"}{" "}
                              · {entry.reason}
                            </p>
                            <p>
                              {entry.actor_name || "Usuario"} ·{" "}
                              {new Date(entry.created_at).toLocaleString("es-PE")}
                            </p>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {!(["DELIVERED", "CANCELLED"] as string[]).includes(
                    order.operational_status
                  ) &&
                    order.created_by_user_id === currentUserId && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onEdit(order)}
                        className="w-full"
                      >
                        Modificar pedido
                      </Button>
                    )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
