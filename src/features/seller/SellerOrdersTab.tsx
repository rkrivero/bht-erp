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
                className="w-full cursor-pointer space-y-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep/45"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-bht-navy-mid tabular-nums">
                    {order.order_code} · {order.order_date}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {order.trip_code && <Badge tone="brand">{order.trip_code}</Badge>}
                    {modified && <Badge tone="warning">Modificado</Badge>}
                    <Badge tone="neutral">
                      {formatOperationalStatusEs(order.operational_status)}
                    </Badge>
                    <ChevronRightIcon
                      className={`h-4 w-4 text-bht-ink-soft transition-transform ${expanded ? "rotate-90 text-bht-navy-deep" : ""}`}
                    />
                  </div>
                </div>
                <h2 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
                  {order.customer_name}
                </h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-bht-ink-soft tabular-nums">
                  <span>
                    Total:{" "}
                    <strong className="text-bht-ink-strong">
                      S/ {order.total_pen.toFixed(2)}
                    </strong>
                  </span>
                  <span>
                    Pagado:{" "}
                    <strong className="text-bht-success">
                      S/ {order.paid_pen.toFixed(2)}
                    </strong>
                  </span>
                  <span>
                    Saldo:{" "}
                    <strong
                      className={
                        order.balance_due_pen > 0.05
                          ? "text-bht-danger"
                          : "text-bht-success"
                      }
                    >
                      S/ {order.balance_due_pen.toFixed(2)}
                    </strong>
                  </span>
                </div>
                <p className="rounded-lg bg-bht-mist/70 px-2.5 py-1.5 text-xs text-bht-navy-mid">
                  Tomó: {order.created_by_name || "-"} · Preparó:{" "}
                  {order.picked_by_name || "Pendiente"} · Entregó:{" "}
                  {order.delivered_by_name || "Pendiente"}
                </p>
              </button>

              {expanded && (
                <div className="space-y-2 border-t border-bht-line pt-2.5 text-xs">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-bht-ink-soft">
                    <span>
                      Detalle comprado ({order.lines.length}{" "}
                      {order.lines.length === 1 ? "ítem" : "ítems"})
                    </span>
                    <span>{formatPaymentModeEs(order.payment_mode)}</span>
                  </div>
                  {order.lines.length === 0 ? (
                    <p className="text-bht-ink-soft">
                      Sin líneas de producto registradas.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {order.lines.map((line) => (
                        <div
                          key={line.order_line_id}
                          className="flex items-start justify-between gap-2 rounded-lg border border-bht-line bg-bht-paper px-2.5 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-bht-ink-strong">
                              {line.raw_description || line.sku}
                            </p>
                            <p className="text-xs text-bht-ink-soft tabular-nums">
                              {line.quantity} {line.unit_of_measure || "NIU"} × S/{" "}
                              {line.unit_price_pen.toFixed(2)}
                              {line.unit_discount_pen > 0
                                ? ` (desc. S/ ${line.unit_discount_pen.toFixed(2)}/u)`
                                : ""}{" "}
                              · {formatFulfillmentModeEs(line.fulfillment_mode)}
                            </p>
                          </div>
                          <span className="flex-shrink-0 font-semibold text-bht-ink-strong tabular-nums">
                            S/ {line.line_total_pen.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {order.notes && (
                    <p className="rounded-lg bg-bht-paper px-2.5 py-1.5 text-xs text-bht-ink-soft">
                      Nota: {order.notes}
                    </p>
                  )}
                  {auditHistory.length > 0 && (
                    <details className="rounded-lg border border-bht-line-blue bg-bht-mist/60 p-2.5">
                      <summary className="cursor-pointer font-semibold text-bht-navy-deep">
                        Historial de cambios ({auditHistory.length})
                      </summary>
                      <div className="mt-2 space-y-2">
                        {auditHistory.map((entry) => (
                          <div
                            key={entry.audit_id}
                            className="border-t border-bht-line-blue pt-2 text-xs text-bht-ink-soft"
                          >
                            <p className="font-medium text-bht-ink-strong">
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
