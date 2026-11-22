"use client";

import React, { useEffect, useMemo } from "react";
import { PartnerQuotesPanel } from "@/components/socios/PartnerQuotesPanel";
import { PartnerEditQuoteModal } from "@/components/socios/PartnerEditQuoteModal";
import { OrderDetailSheet } from "@/components/socios/ventas/OrderDetailSheet";
import { formatPen } from "@/components/socios/types";
import {
  ControlPanel,
  type ControlPanelFacet,
  readControlPanelUrlParam,
  syncControlPanelUrlParams,
} from "@/components/ui/ControlPanel";
import { EditIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  EmptyState,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
  SegmentedControl,
} from "@/components/ui/Primitives";
import {
  ResponsiveDataTable,
  type ResponsiveTableColumn,
} from "@/components/ui/ResponsiveDataTable";
import {
  formatOperationalStatusEs,
  formatQuoteStatusEs,
} from "@/lib/labels-es";
import type { SellerOrderDto } from "@/features/seller/types";
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

const STATUS_LABELS: Record<MonitorStatusFilter, string> = {
  ALL: "Todos",
  PENDING: "Pendientes",
  DELIVERED: "Entregados",
  CANCELLED: "Anulados",
};

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
    setEditingPartnerQuote,
    handlePartnerConvertQuote,
    handlePartnerCancelQuote,
    customerOrderScope,
    customerOrdersError,
    loadingCustomerOrders,
    visibleOrders,
    visibleOrdersPagination,
    clearCustomerOrderScope,
  } = flow;

  useEffect(() => {
    const initialQ = readControlPanelUrlParam("q");
    const initialStatus = readControlPanelUrlParam("status").toUpperCase();
    if (initialQ) setMonitorSearch(initialQ);
    if (
      initialStatus === "PENDING" ||
      initialStatus === "DELIVERED" ||
      initialStatus === "CANCELLED"
    ) {
      setMonitorStatusFilter(initialStatus);
    }
  }, [setMonitorSearch, setMonitorStatusFilter]);

  useEffect(() => {
    syncControlPanelUrlParams({
      q: monitorSearch,
      status: monitorStatusFilter === "ALL" ? null : monitorStatusFilter,
    });
  }, [monitorSearch, monitorStatusFilter]);

  const facets: ControlPanelFacet[] = useMemo(() => {
    const list: ControlPanelFacet[] = [];
    if (customerOrderScope) {
      list.push({
        id: "customer",
        label: "Cliente",
        value: customerOrderScope.name,
        onRemove: clearCustomerOrderScope,
      });
    }
    if (monitorStatusFilter !== "ALL") {
      list.push({
        id: "status",
        label: "Estado",
        value: STATUS_LABELS[monitorStatusFilter],
        onRemove: () => setMonitorStatusFilter("ALL"),
      });
    }
    if (monitorSearch.trim()) {
      list.push({
        id: "q",
        label: "Búsqueda",
        value: monitorSearch.trim(),
        onRemove: () => setMonitorSearch(""),
      });
    }
    return list;
  }, [
    customerOrderScope,
    clearCustomerOrderScope,
    monitorStatusFilter,
    setMonitorStatusFilter,
    monitorSearch,
    setMonitorSearch,
  ]);

  const orderColumns: ResponsiveTableColumn<SellerOrderDto>[] = useMemo(
    () => [
      {
        id: "code",
        header: "Pedido / Fecha",
        sortable: true,
        sortValue: (o) => String(o.order_code ?? ""),
        cell: (o) => (
          <div>
            <span className="font-semibold text-bht-cobalt-strong tabular-nums">
              {String(o.order_code)}
            </span>
            <span className="block text-xs text-bht-ink-muted tabular-nums">
              {String(o.order_date)}
            </span>
          </div>
        ),
      },
      {
        id: "customer",
        header: "Cliente",
        sortable: true,
        sortValue: (o) => String(o.customer_name ?? ""),
        cell: (o) => (
          <span className="font-bold text-bht-ink-strong">
            {String(o.customer_name)}
          </span>
        ),
      },
      {
        id: "status",
        header: "Estado",
        sortable: true,
        sortValue: (o) => String(o.operational_status ?? ""),
        cell: (o) => {
          const creditExceeded = Boolean(
            (o as { credit_limit_exceeded_flag?: boolean }).credit_limit_exceeded_flag
          );
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={operationalStatusTone(o.operational_status)}>
                {formatOperationalStatusEs(o.operational_status)}
              </Badge>
              {creditExceeded && (
                <Badge tone="danger">Excede límite de crédito</Badge>
              )}
            </div>
          );
        },
      },
      {
        id: "seller",
        header: "Vendedor",
        optional: true,
        sortable: true,
        sortValue: (o) => formatActorName(o.created_by_name, "-"),
        cell: (o) => (
          <span className="text-xs text-bht-ink-soft">
            {formatActorName(o.created_by_name, "-")} ·{" "}
            {Array.isArray(o.lines) ? o.lines.length : 0} prod.
          </span>
        ),
      },
      {
        id: "margin",
        header: "Margen",
        align: "right",
        optional: true,
        sortable: true,
        sortValue: (o) => Number(o.order_margin_pen ?? 0),
        cell: (o) => {
          const marginVal = Number(o.order_margin_pen ?? 0);
          const totalVal = Number(o.total_pen ?? 0);
          return (
            <span
              className={`font-semibold tabular-nums ${getMarginTextClass(
                marginVal,
                totalVal
              )}`}
            >
              {formatPen(marginVal)}
            </span>
          );
        },
      },
      {
        id: "total",
        header: "Total",
        align: "right",
        sortable: true,
        sortValue: (o) => Number(o.total_pen ?? 0),
        cell: (o) => (
          <span className="font-semibold text-bht-ink-strong tabular-nums">
            {formatPen(o.total_pen)}
          </span>
        ),
      },
      {
        id: "balance",
        header: "Saldo",
        align: "right",
        optional: true,
        sortable: true,
        sortValue: (o) => Number(o.balance_due_pen ?? 0),
        cell: (o) => {
          const debt = Number(o.balance_due_pen ?? 0);
          return (
            <span
              className={`tabular-nums ${
                debt > 0.05
                  ? "font-semibold text-bht-danger"
                  : "text-xs text-bht-success"
              }`}
            >
              {debt > 0.05 ? formatPen(debt) : "Al día"}
            </span>
          );
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <ControlPanel<"orders" | "quotes">
        title={
          salesView === "quotes"
            ? "Cotizaciones Comerciales"
            : customerOrderScope
              ? `Pedidos de ${customerOrderScope.name}`
              : "Todos los Pedidos"
        }
        subtitle="Consulta el historial completo, filtra por estado y abre cualquier pedido en vista documento."
        viewMode={salesView}
        onViewModeChange={setSalesView}
        viewAriaLabel="Vista de pedidos y cotizaciones"
        viewOptions={[
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
        searchValue={salesView === "orders" ? monitorSearch : undefined}
        onSearchChange={salesView === "orders" ? setMonitorSearch : undefined}
        searchPlaceholder="Buscar por pedido, cliente o vendedor..."
        searchAriaLabel="Buscar pedidos y ventas"
        facets={salesView === "orders" ? facets : []}
        onClearAllFacets={() => {
          clearCustomerOrderScope();
          setMonitorStatusFilter("ALL");
          setMonitorSearch("");
        }}
        quickFilters={
          salesView === "orders" ? (
            <SegmentedControl<MonitorStatusFilter>
              ariaLabel="Filtrar pedidos y ventas por estado"
              value={monitorStatusFilter}
              onChange={setMonitorStatusFilter}
              className="w-full sm:w-auto"
              options={[
                { id: "ALL", label: "Todos" },
                { id: "PENDING", label: "Pendientes" },
                { id: "DELIVERED", label: "Entregados" },
                { id: "CANCELLED", label: "Anulados" },
              ]}
            />
          ) : undefined
        }
        pagination={
          salesView === "orders"
            ? {
                shownCount: monitorFilteredOrders.length,
                totalCount:
                  visibleOrdersPagination?.totalCount ?? visibleOrders.length,
                itemLabel: "pedidos",
                hasMore: Boolean(visibleOrdersPagination?.hasMore),
                loadingMore: loadingMoreOrders,
                onLoadMore: handleLoadMoreOrders,
                loadMoreLabel: "Cargar más pedidos",
              }
            : undefined
        }
      >
        {salesView === "quotes" ? (
          <PartnerQuotesPanel
            quotes={partnerQuotes}
            busyQuoteId={busyQuoteId}
            onSelectQuote={setSelectedPartnerQuote}
            onEditQuote={setEditingPartnerQuote}
            onConvertQuote={handlePartnerConvertQuote}
            onCancelQuote={handlePartnerCancelQuote}
          />
        ) : loadingCustomerOrders ? (
          <EmptyState title="Cargando pedidos del cliente..." />
        ) : customerOrdersError ? (
          <EmptyState title={customerOrdersError} />
        ) : (
          <ResponsiveDataTable
            columns={orderColumns}
            data={monitorFilteredOrders}
            getRowKey={(o) => String(o.order_id)}
            ariaLabel="Tabla de pedidos y ventas"
            onRowClick={(o) => setSelectedMonitorOrder(o)}
            getRowAriaLabel={(o) =>
              `Ver detalle del pedido ${String(o.order_code)} de ${String(
                o.customer_name
              )}`
            }
            emptyTitle="No hay pedidos que coincidan con el filtro"
          />
        )}
      </ControlPanel>
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
    editingPartnerQuote,
    setEditingPartnerQuote,
    handlePartnerUpdateQuote,
    busyQuoteId,
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

            {Number(selectedPartnerQuote.global_discount_pen ?? 0) > 0 && (
              <div className="flex items-center justify-between rounded-lg border border-bht-warning-line bg-bht-warning-bg px-3 py-2 text-xs text-bht-warning-text tabular-nums">
                <span>Descuento global aplicado</span>
                <strong>-{formatPen(selectedPartnerQuote.global_discount_pen)}</strong>
              </div>
            )}

            {Array.isArray(selectedPartnerQuote.audit_history) &&
              selectedPartnerQuote.audit_history.length > 0 && (
                <details className="rounded-lg border border-bht-line-blue bg-bht-mist/60 p-3">
                  <summary className="cursor-pointer font-semibold text-bht-navy-deep">
                    Historial de modificaciones ({selectedPartnerQuote.audit_history.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {selectedPartnerQuote.audit_history.map((entry) => (
                      <div
                        key={String(entry.audit_id)}
                        className="border-t border-bht-line-blue pt-2 text-xs text-bht-ink-soft"
                      >
                        <p className="font-medium text-bht-ink-strong">
                          Modificación · {String(entry.reason)}
                        </p>
                        <p>
                          {String(entry.actor_name || "Usuario")} ·{" "}
                          {new Date(String(entry.created_at)).toLocaleString("es-PE")}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              )}

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

            {selectedPartnerQuote.status === "OPEN" && (
              <div className="flex flex-wrap justify-end gap-2 border-t border-bht-line pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const q = selectedPartnerQuote;
                    setSelectedPartnerQuote(null);
                    setEditingPartnerQuote(q);
                  }}
                >
                  <EditIcon className="h-3.5 w-3.5" />
                  Modificar cotización
                </Button>
              </div>
            )}
          </div>
        )}
      </ModalSheet>

      <PartnerEditQuoteModal
        quote={editingPartnerQuote}
        open={Boolean(editingPartnerQuote)}
        onClose={() => setEditingPartnerQuote(null)}
        onSave={handlePartnerUpdateQuote}
        isSaving={busyQuoteId === editingPartnerQuote?.quote_id}
      />

      <ModalSheet
        open={Boolean(selectedMonitorOrder)}
        onClose={() => setSelectedMonitorOrder(null)}
        title={
          selectedMonitorOrder
            ? `Ficha de Pedido · ${String(selectedMonitorOrder.order_code)}`
            : "Detalle del pedido"
        }
        subtitle={
          selectedMonitorOrder
            ? `${String(selectedMonitorOrder.customer_name)} · ${String(
                selectedMonitorOrder.order_date
              )}`
            : undefined
        }
        maxWidth="6xl"
      >
        {selectedMonitorOrder && (
          <OrderDetailSheet
            order={selectedMonitorOrder}
            onAbonar={() => {
              const target = selectedMonitorOrder;
              setSelectedMonitorOrder(null);
              openAbonoForOrderRecord(target);
            }}
            onCancel={() => {
              const target = selectedMonitorOrder;
              setSelectedMonitorOrder(null);
              setCancelOrderReason("");
              setConfirmCancelOrder(target);
            }}
          />
        )}
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
