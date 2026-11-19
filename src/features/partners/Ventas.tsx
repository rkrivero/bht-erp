"use client";

import React from "react";
import { PartnerQuotesPanel } from "@/components/socios/PartnerQuotesPanel";
import { formatPen } from "@/components/socios/types";
import { SearchIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
  SegmentedControl,
} from "@/components/ui/Primitives";
import {
  formatFulfillmentModeEs,
  formatOperationalStatusEs,
  formatQuoteStatusEs,
  formatUnitTitleEs,
} from "@/lib/labels-es";
import {
  formatActorName,
  getMarginTextClass,
  operationalStatusTone,
  type MonitorStatusFilter,
} from "./partnerShared";
import type { PartnerData } from "./usePartnerData";
import type { OrderFlow } from "./useOrderFlow";
import type { CollectionsFlow } from "./useCollectionsFlow";

interface VentasProps {
  orders: PartnerData["orders"];
  ordersPagination: PartnerData["ordersPagination"];
  partnerQuotes: PartnerData["partnerQuotes"];
  flow: OrderFlow;
}

export function Ventas({ orders, ordersPagination, partnerQuotes, flow }: VentasProps) {
  const [salesView, setSalesView] = React.useState<"orders" | "quotes">("orders");
  const {
    monitorSearch,
    setMonitorSearch,
    monitorStatusFilter,
    setMonitorStatusFilter,
    monitorFilteredOrders,
    setSelectedMonitorOrder,
    loadingMoreOrders,
    handleLoadMoreOrders,
    busyQuoteId,
    setSelectedPartnerQuote,
    handlePartnerConvertQuote,
    handlePartnerCancelQuote,
    customerOrderScope,
    customerOrdersError,
    loadingCustomerOrders,
    visibleOrders,
    visibleOrdersPagination,
    clearCustomerOrderScope,
  } = flow;
  return (
    <div className="space-y-4">
      <SegmentedControl<"orders" | "quotes">
        ariaLabel="Vista de pedidos y cotizaciones"
        value={salesView}
        onChange={setSalesView}
        className="w-full sm:w-auto"
        options={[
          {
            id: "orders",
            label: "Pedidos",
            count: ordersPagination?.totalCount ?? orders.length,
          },
          {
            id: "quotes",
            label: "Cotizaciones",
            count: partnerQuotes.filter((q) => q.status === "OPEN").length,
          },
        ]}
      />

      {salesView === "quotes" ? (
        <PartnerQuotesPanel
          quotes={partnerQuotes}
          busyQuoteId={busyQuoteId}
          onSelectQuote={setSelectedPartnerQuote}
          onConvertQuote={handlePartnerConvertQuote}
          onCancelQuote={handlePartnerCancelQuote}
        />
      ) : (
        <Card padding="md" className="space-y-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-bht-ink-strong">
              {customerOrderScope
                ? `Pedidos de ${customerOrderScope.name}`
                : "Todos los Pedidos"}
            </h2>
            <p className="text-xs text-bht-ink-soft">
              Consulta el historial completo, filtra por estado y abre cualquier pedido
              para revisar sus productos y trazabilidad.
            </p>
          </div>

          {customerOrderScope && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bht-line-blue bg-bht-mist px-3 py-2 text-xs text-bht-navy-mid">
              <span>
                Historial exacto por cliente ·{" "}
                {visibleOrdersPagination?.totalCount ?? 0} pedido(s)
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-compact="true"
                onClick={clearCustomerOrderScope}
              >
                Ver todos
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(320px,1fr)_auto] xl:items-center">
            <div className="relative min-w-0">
              <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-bht-ink-muted">
                <SearchIcon className="h-4 w-4" />
              </span>
              <input
                type="text"
                value={monitorSearch}
                onChange={(e) => setMonitorSearch(e.target.value)}
                aria-label="Buscar pedidos y ventas"
                placeholder="Buscar por pedido, cliente o vendedor..."
                className={`${INPUT_CLASS} pl-10 pr-8`}
              />
            </div>
            <SegmentedControl<MonitorStatusFilter>
              ariaLabel="Filtrar pedidos y ventas por estado"
              value={monitorStatusFilter}
              onChange={setMonitorStatusFilter}
              className="w-full xl:w-auto"
              options={[
                { id: "ALL", label: "Todos" },
                { id: "PENDING", label: "Pendientes" },
                { id: "DELIVERED", label: "Entregados" },
                { id: "CANCELLED", label: "Anulados" },
              ]}
            />
          </div>

          {loadingCustomerOrders ? (
            <EmptyState title="Cargando pedidos del cliente..." />
          ) : customerOrdersError ? (
            <EmptyState title={customerOrdersError} />
          ) : monitorFilteredOrders.length === 0 ? (
            <EmptyState title="No hay pedidos que coincidan con el filtro" />
          ) : (
            <div className="space-y-2">
              {monitorFilteredOrders.map((order) => (
                <button
                  key={String(order.order_id)}
                  type="button"
                  onClick={() => setSelectedMonitorOrder(order)}
                  className="flex w-full flex-col gap-2 rounded-xl border border-bht-line bg-white p-3 text-left transition hover:border-bht-line-blue hover:bg-bht-mist/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 break-words text-base font-bold leading-snug text-bht-ink-strong sm:text-lg">
                      {String(order.customer_name)}
                    </h3>
                    <Badge tone={operationalStatusTone(order.operational_status)}>
                      {formatOperationalStatusEs(order.operational_status)}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold text-bht-cobalt-strong tabular-nums">
                        Pedido {String(order.order_code)}
                      </span>
                      <span className="text-bht-ink-soft tabular-nums">
                        Fecha: {String(order.order_date)}
                      </span>
                    </div>
                    <span className="font-semibold text-bht-ink-strong tabular-nums">
                      {formatPen(order.total_pen)}
                    </span>
                  </div>
                  <span className="text-xs text-bht-ink-soft">
                    Vendedor: {formatActorName(order.created_by_name, "-")} ·{" "}
                    {Array.isArray(order.lines) ? order.lines.length : 0} producto(s)
                  </span>
                </button>
              ))}
            </div>
          )}

          {visibleOrdersPagination?.hasMore && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-bht-line pt-3 text-xs text-bht-ink-soft">
              <span>
                Mostrando {visibleOrders.length} de {visibleOrdersPagination.totalCount}{" "}
                pedidos
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingMoreOrders}
                onClick={handleLoadMoreOrders}
              >
                {loadingMoreOrders ? "Cargando..." : "Cargar más pedidos"}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

interface VentasModalsProps {
  flow: OrderFlow;
  openAbonoForOrderRecord: CollectionsFlow["openAbonoForOrderRecord"];
}

export function VentasModals({ flow, openAbonoForOrderRecord }: VentasModalsProps) {
  const {
    selectedPartnerQuote,
    setSelectedPartnerQuote,
    selectedMonitorOrder,
    setSelectedMonitorOrder,
    confirmCancelOrder,
    setConfirmCancelOrder,
    cancelOrderReason,
    setCancelOrderReason,
    busyCancelOrderId,
    handleConfirmCancelOrder,
  } = flow;
  return (
    <>
      <ModalSheet
        open={Boolean(selectedPartnerQuote)}
        onClose={() => setSelectedPartnerQuote(null)}
        title={
          selectedPartnerQuote
            ? `Detalle de venta ${String(selectedPartnerQuote.quote_code)}`
            : "Detalle de venta"
        }
        subtitle={
          selectedPartnerQuote
            ? `${String(selectedPartnerQuote.issue_date)} · ${String(
                selectedPartnerQuote.customer_name
              )}`
            : undefined
        }
        maxWidth="lg"
      >
        {selectedPartnerQuote && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-1 gap-2 rounded-xl border border-bht-line-blue bg-bht-mist/70 p-3 sm:grid-cols-3">
              <div>
                <span className="block text-xs text-bht-ink-soft">Estado</span>
                <strong className="text-sm text-bht-ink-strong">
                  {formatQuoteStatusEs(selectedPartnerQuote.status)}
                </strong>
              </div>
              <div>
                <span className="block text-xs text-bht-ink-soft">Vendedor</span>
                <strong className="text-sm text-bht-ink-strong">
                  {String(selectedPartnerQuote.seller_name || "-")}
                </strong>
              </div>
              <div>
                <span className="block text-xs text-bht-ink-soft">Total</span>
                <strong className="text-sm text-bht-ink-strong tabular-nums">
                  {formatPen(selectedPartnerQuote.total_pen)}
                </strong>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="font-semibold text-bht-navy-deep">
                Productos (
                {Array.isArray(selectedPartnerQuote.lines)
                  ? selectedPartnerQuote.lines.length
                  : 0}
                )
              </p>
              {Array.isArray(selectedPartnerQuote.lines) &&
              selectedPartnerQuote.lines.length > 0 ? (
                selectedPartnerQuote.lines.map((line, index) => (
                  <div
                    key={String(line.quote_line_id ?? index)}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bht-line bg-bht-paper px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-bht-ink-strong">
                        {String(line.raw_description || line.sku || "Producto")}
                      </p>
                      <p className="text-xs text-bht-ink-soft tabular-nums">
                        {Number(line.quantity)} {String(line.unit_of_measure || "NIU")}{" "}
                        × {formatPen(line.unit_price_pen)}
                      </p>
                    </div>
                    <strong className="tabular-nums text-bht-ink-strong">
                      {formatPen(line.line_total_pen)}
                    </strong>
                  </div>
                ))
              ) : (
                <p className="text-bht-ink-soft">Sin líneas registradas.</p>
              )}
            </div>

            {selectedPartnerQuote.converted_order_code ? (
              <p className="rounded-lg border border-bht-line-blue bg-bht-mist/70 px-3 py-2 text-bht-ink-soft">
                Pedido generado:{" "}
                <strong className="text-bht-navy-deep">
                  {String(selectedPartnerQuote.converted_order_code)}
                </strong>
              </p>
            ) : null}
            {selectedPartnerQuote.notes ? (
              <p className="rounded-lg border border-bht-line bg-white px-3 py-2 text-bht-ink-soft">
                Nota: {String(selectedPartnerQuote.notes)}
              </p>
            ) : null}
          </div>
        )}
      </ModalSheet>

      <ModalSheet
        open={Boolean(selectedMonitorOrder)}
        onClose={() => setSelectedMonitorOrder(null)}
        title={
          selectedMonitorOrder
            ? `Detalle ${String(selectedMonitorOrder.order_code)} · ${String(
                selectedMonitorOrder.customer_name
              )}`
            : "Detalle del pedido"
        }
        subtitle={
          selectedMonitorOrder
            ? `${String(selectedMonitorOrder.order_date)} · Estado: ${formatOperationalStatusEs(
                selectedMonitorOrder.operational_status
              )}`
            : undefined
        }
        maxWidth="lg"
      >
        {selectedMonitorOrder &&
          (() => {
            const marginVal = Number(selectedMonitorOrder.order_margin_pen ?? 0);
            const totalVal = Number(selectedMonitorOrder.total_pen ?? 0);
            const debtVal = Number(selectedMonitorOrder.balance_due_pen ?? 0);
            const statusStr = String(selectedMonitorOrder.operational_status ?? "");
            const canAbonar =
              debtVal > 0.05 &&
              statusStr !== "CANCELLED" &&
              statusStr !== "PENDING_PARTNER_APPROVAL";
            const canCancel = statusStr !== "CANCELLED" && statusStr !== "DELIVERED";
            return (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-1 gap-2 rounded-xl border border-bht-line-blue bg-bht-mist/70 p-3 sm:grid-cols-3 tabular-nums">
                  <div>
                    <span className="block text-xs text-bht-ink-soft">Venta</span>
                    <strong className="text-sm text-bht-ink-strong">
                      {formatPen(totalVal)}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-xs text-bht-ink-soft">Margen</span>
                    <strong
                      className={`text-sm ${getMarginTextClass(marginVal, totalVal)}`}
                    >
                      {formatPen(marginVal)}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-xs text-bht-ink-soft">Saldo</span>
                    <strong
                      className={`text-sm ${
                        debtVal > 0.05 ? "text-bht-danger" : "text-bht-success"
                      }`}
                    >
                      {formatPen(debtVal)}
                    </strong>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="font-semibold text-bht-navy-deep">
                    Productos comprados (
                    {Array.isArray(selectedMonitorOrder.lines)
                      ? selectedMonitorOrder.lines.length
                      : 0}
                    )
                  </p>
                  <div className="space-y-1.5">
                    {Array.isArray(selectedMonitorOrder.lines) &&
                    selectedMonitorOrder.lines.length > 0 ? (
                      selectedMonitorOrder.lines.map((ln) => (
                        <div
                          key={String(ln.order_line_id)}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bht-line bg-bht-paper px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-bht-ink-strong">
                              {String(ln.raw_description || ln.sku)}
                            </p>
                            <p className="text-xs text-bht-ink-soft tabular-nums">
                              {Number(ln.quantity)}{" "}
                              <span title={formatUnitTitleEs(ln.unit_of_measure)}>
                                {String(ln.unit_of_measure || "NIU")}
                              </span>{" "}
                              × {formatPen(ln.unit_price_pen)}
                              {Number(ln.unit_discount_pen || 0) > 0
                                ? ` (desc. ${formatPen(ln.unit_discount_pen)}/u)`
                                : ""}{" "}
                              · {formatFulfillmentModeEs(ln.fulfillment_mode)}
                            </p>
                          </div>
                          <div className="text-right tabular-nums">
                            <span className="block font-semibold text-bht-ink-strong">
                              {formatPen(ln.line_total_pen)}
                            </span>
                            {ln.line_margin_pen !== null &&
                              ln.line_margin_pen !== undefined && (
                                <span
                                  className={`block text-xs font-medium ${
                                    Number(ln.line_margin_pen) <= 0
                                      ? "text-bht-danger"
                                      : "text-bht-success"
                                  }`}
                                >
                                  {Number(ln.line_margin_pen) >= 0 ? "+" : ""}
                                  {formatPen(ln.line_margin_pen)}
                                </span>
                              )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-bht-ink-soft">Sin líneas registradas.</p>
                    )}
                  </div>
                </div>

                {selectedMonitorOrder.notes ? (
                  <p className="rounded-lg border border-bht-line bg-white px-3 py-2 text-bht-ink-soft">
                    Nota: {String(selectedMonitorOrder.notes)}
                  </p>
                ) : null}

                {Array.isArray(selectedMonitorOrder.audit_history) &&
                  selectedMonitorOrder.audit_history.length > 0 && (
                    <details className="rounded-lg border border-bht-line-blue bg-bht-mist/60 p-3">
                      <summary className="cursor-pointer font-semibold text-bht-navy-deep">
                        Historial de cambios (
                        {selectedMonitorOrder.audit_history.length})
                      </summary>
                      <div className="mt-2 space-y-2">
                        {selectedMonitorOrder.audit_history.map((entry) => (
                          <div
                            key={String(entry.audit_id)}
                            className="border-t border-bht-line-blue pt-2 text-xs text-bht-ink-soft"
                          >
                            <p className="font-medium text-bht-ink-strong">
                              {String(entry.action) === "CANCEL"
                                ? "Anulación"
                                : String(entry.action) === "UNDO_CANCEL"
                                  ? "Reversión de anulación"
                                  : String(entry.action) === "UNDO_STATUS"
                                    ? "Reversión de estado"
                                    : "Modificación"}{" "}
                              · {String(entry.reason)}
                            </p>
                            <p>
                              {String(entry.actor_name || "Usuario")} ·{" "}
                              {new Date(String(entry.created_at)).toLocaleString(
                                "es-PE"
                              )}
                            </p>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                {(canAbonar || canCancel) && (
                  <div className="flex flex-col-reverse gap-2 border-t border-bht-line pt-3 sm:flex-row sm:justify-end">
                    {canCancel && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const target = selectedMonitorOrder;
                          setSelectedMonitorOrder(null);
                          setCancelOrderReason("");
                          setConfirmCancelOrder(target);
                        }}
                        className="border-bht-danger-line text-bht-danger hover:bg-bht-danger-bg"
                      >
                        Anular Pedido
                      </Button>
                    )}
                    {canAbonar && (
                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => {
                          const target = selectedMonitorOrder;
                          setSelectedMonitorOrder(null);
                          openAbonoForOrderRecord(target);
                        }}
                      >
                        Registrar Abono ({formatPen(debtVal)})
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
      </ModalSheet>

      <ModalSheet
        open={Boolean(confirmCancelOrder)}
        onClose={() => {
          if (busyCancelOrderId === null) {
            setConfirmCancelOrder(null);
            setCancelOrderReason("");
          }
        }}
        title={
          confirmCancelOrder
            ? `Anular pedido ${String(confirmCancelOrder.order_code ?? "")}`
            : "Anular pedido"
        }
        subtitle={
          confirmCancelOrder
            ? `${String(confirmCancelOrder.customer_name ?? "")} · ${formatPen(
                confirmCancelOrder.total_pen
              )}`
            : undefined
        }
      >
        {confirmCancelOrder && (
          <form onSubmit={handleConfirmCancelOrder} className="space-y-4">
            <p className="rounded-xl border border-bht-danger-line bg-bht-danger-bg px-3 py-2.5 text-xs text-bht-danger-strong">
              Esta acción anulará el pedido, revertirá sus movimientos pendientes de
              inventario / cobros asociados y cerrará alertas pendientes.
            </p>
            <div>
              <FieldLabel htmlFor="cancel-order-reason">
                Motivo de anulación (opcional)
              </FieldLabel>
              <input
                id="cancel-order-reason"
                type="text"
                value={cancelOrderReason}
                onChange={(e) => setCancelOrderReason(e.target.value)}
                placeholder="Ej. Cliente desistió / error de registro"
                className={`${INPUT_CLASS} mt-1.5`}
              />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={busyCancelOrderId !== null}
                onClick={() => {
                  setConfirmCancelOrder(null);
                  setCancelOrderReason("");
                }}
              >
                Volver
              </Button>
              <Button
                type="submit"
                variant="danger"
                disabled={busyCancelOrderId !== null}
              >
                {busyCancelOrderId !== null ? "Anulando..." : "Confirmar anulación"}
              </Button>
            </div>
          </form>
        )}
      </ModalSheet>
    </>
  );
}
