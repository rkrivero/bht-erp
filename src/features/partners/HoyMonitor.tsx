"use client";

import React from "react";
import { formatPen } from "@/components/socios/types";
import {} from "@/components/shared/CollectionControls";
import { CloseIcon, SearchIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  INPUT_CLASS,
  SegmentedControl,
} from "@/components/ui/Primitives";
import { formatOperationalStatusEs } from "@/lib/labels-es";
import {
  formatTraceabilitySummary,
  getMarginTextClass,
  operationalStatusTone,
  type MonitorStatusFilter,
} from "./partnerShared";
import type { PartnerData } from "./usePartnerData";
import type { OrderFlow } from "./useOrderFlow";
import type { CollectionsFlow } from "./useCollectionsFlow";

interface HoyMonitorProps {
  orders: PartnerData["orders"];
  ordersPagination: PartnerData["ordersPagination"];
  flow: OrderFlow;
  openAbonoForOrderRecord: CollectionsFlow["openAbonoForOrderRecord"];
}

export function HoyMonitor({
  orders,
  ordersPagination,
  flow,
  openAbonoForOrderRecord,
}: HoyMonitorProps) {
  const {
    showAllMonitor,
    setShowAllMonitor,
    recentMonitorOrders,
    monitorSearch,
    setMonitorSearch,
    monitorStatusFilter,
    setMonitorStatusFilter,
    setSelectedMonitorOrder,
    setCancelOrderReason,
    setConfirmCancelOrder,
    loadingMoreOrders,
    handleLoadMoreOrders,
  } = flow;
  return (
    <Card padding="md" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2
            id="monitor-table-heading"
            className="text-sm sm:text-base font-semibold text-[#18181B]"
          >
            Monitor en Tiempo Real
          </h2>
          <p className="text-xs text-[#5C5A55]">
            {showAllMonitor || recentMonitorOrders.length <= 15
              ? `Mostrando ${recentMonitorOrders.length} pedidos`
              : `Mostrando 15 de ${recentMonitorOrders.length} pedidos`}{" "}
            · Toca una fila para ver detalle, abonar o anular.
          </p>
        </div>
        {recentMonitorOrders.length > 15 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAllMonitor((prev) => !prev)}
          >
            {showAllMonitor
              ? "Ver últimos 15"
              : `Ver todos (${recentMonitorOrders.length})`}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#6D6A64]">
            <SearchIcon className="h-4 w-4" />
          </span>
          <input
            type="text"
            value={monitorSearch}
            onChange={(e) => setMonitorSearch(e.target.value)}
            aria-label="Buscar en monitor de pedidos"
            placeholder="Buscar por pedido, cliente o vendedor..."
            className={`${INPUT_CLASS} py-2 pl-10 pr-8 text-xs`}
          />
          {monitorSearch && (
            <button
              type="button"
              data-compact="true"
              aria-label="Limpiar búsqueda de monitor"
              onClick={() => setMonitorSearch("")}
              className="absolute inset-y-0 right-2.5 flex items-center text-[#6D6A64] hover:text-[#18181B] cursor-pointer"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <SegmentedControl<MonitorStatusFilter>
          ariaLabel="Filtrar estado en monitor"
          value={monitorStatusFilter}
          onChange={setMonitorStatusFilter}
          options={[
            { id: "ALL", label: "Todos" },
            { id: "PENDING", label: "Pendientes" },
            { id: "DELIVERED", label: "Entregados" },
            { id: "CANCELLED", label: "Anulados" },
          ]}
        />
      </div>

      {/* Mobile card view */}
      <div className="space-y-2.5 md:hidden">
        {(showAllMonitor ? recentMonitorOrders : recentMonitorOrders.slice(0, 15)).map(
          (o) => {
            const marginVal = Number(o.order_margin_pen ?? 0);
            const totalVal = Number(o.total_pen ?? 0);
            const debtVal = Number(o.balance_due_pen ?? 0);
            const statusStr = String(o.operational_status ?? "");
            const wasModified =
              Array.isArray(o.audit_history) &&
              o.audit_history.some((entry) => entry.action === "EDIT");
            const canAbonar =
              debtVal > 0.05 &&
              statusStr !== "CANCELLED" &&
              statusStr !== "PENDING_PARTNER_APPROVAL";
            const canCancel = statusStr !== "CANCELLED" && statusStr !== "DELIVERED";
            return (
              <div
                key={String(o.order_id)}
                className="rounded-xl border border-[#E7E5E0] bg-[#FAF9F6] p-3.5 space-y-2.5 text-xs"
              >
                <button
                  type="button"
                  onClick={() => setSelectedMonitorOrder(o)}
                  aria-label={`Ver detalle del pedido ${String(o.order_code)} de ${String(o.customer_name)}`}
                  className="w-full text-left space-y-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 cursor-pointer"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-[#1E446B] tabular-nums">
                      {String(o.order_code)} · {String(o.order_date)}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {wasModified && <Badge tone="warning">Modificado</Badge>}
                      <Badge tone={operationalStatusTone(o.operational_status)}>
                        {formatOperationalStatusEs(o.operational_status)}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-[#18181B]">
                    {String(o.customer_name)}
                  </p>
                  <p className="text-xs text-[#5C5A55]">
                    <span className="text-[#6D6A64]">Equipo:</span>{" "}
                    <span className="font-medium text-[#18181B]">
                      {formatTraceabilitySummary(o)}
                    </span>
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[#E7E5E0] pt-2 tabular-nums">
                    <span>
                      Venta:{" "}
                      <strong className="text-[#18181B]">{formatPen(totalVal)}</strong>
                    </span>
                    <span
                      className={`font-semibold ${getMarginTextClass(
                        marginVal,
                        totalVal
                      )}`}
                    >
                      Margen: {formatPen(marginVal)}
                    </span>
                    <span
                      className={
                        debtVal > 0.05
                          ? "font-semibold text-[#B91C1C]"
                          : "font-medium text-[#15803D]"
                      }
                    >
                      {debtVal > 0.05 ? `Debe: ${formatPen(debtVal)}` : "Al día"}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-[#1E446B]">
                    Toca para ver productos comprados (
                    {Array.isArray(o.lines) ? o.lines.length : 0})
                  </p>
                </button>
                {(canAbonar || canCancel) && (
                  <div className="flex flex-wrap gap-2 border-t border-[#E7E5E0]/80 pt-2">
                    {canAbonar && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => openAbonoForOrderRecord(o)}
                        className="flex-1"
                      >
                        Abonar
                      </Button>
                    )}
                    {canCancel && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setCancelOrderReason("");
                          setConfirmCancelOrder(o);
                        }}
                        className="border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2]"
                      >
                        Anular
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          }
        )}
      </div>

      {/* Desktop table view */}
      <div
        tabIndex={0}
        role="region"
        aria-labelledby="monitor-table-heading"
        className="table-wrapper hidden md:block"
      >
        <table className="w-full text-left text-xs">
          <thead className="border-b border-[#E7E5E0] bg-[#FAF9F6] text-xs font-semibold uppercase tracking-wide text-[#5C5A55]">
            <tr>
              <th scope="col" className="whitespace-nowrap p-3">
                Pedido / Fecha
              </th>
              <th scope="col" className="whitespace-nowrap p-3">
                Cliente
              </th>
              <th scope="col" className="whitespace-nowrap p-3">
                Estado
              </th>
              <th scope="col" className="whitespace-nowrap p-3">
                Responsables
              </th>
              <th scope="col" className="whitespace-nowrap p-3 text-right">
                Venta
              </th>
              <th scope="col" className="whitespace-nowrap p-3 text-right">
                Margen Real
              </th>
              <th scope="col" className="whitespace-nowrap p-3 text-right">
                Saldo Debe
              </th>
              <th scope="col" className="whitespace-nowrap p-3 text-right">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E7E5E0]">
            {(showAllMonitor
              ? recentMonitorOrders
              : recentMonitorOrders.slice(0, 15)
            ).map((o) => {
              const marginVal = Number(o.order_margin_pen ?? 0);
              const totalVal = Number(o.total_pen ?? 0);
              const debtVal = Number(o.balance_due_pen ?? 0);
              const statusStr = String(o.operational_status ?? "");
              const wasModified =
                Array.isArray(o.audit_history) &&
                o.audit_history.some((entry) => entry.action === "EDIT");
              const canAbonar =
                debtVal > 0.05 &&
                statusStr !== "CANCELLED" &&
                statusStr !== "PENDING_PARTNER_APPROVAL";
              const canCancel = statusStr !== "CANCELLED" && statusStr !== "DELIVERED";
              return (
                <tr
                  key={String(o.order_id)}
                  onClick={() => setSelectedMonitorOrder(o)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedMonitorOrder(o);
                    }
                  }}
                  aria-label={`Ver detalle del pedido ${String(o.order_code)}`}
                  className="cursor-pointer transition hover:bg-[#F2F6FA]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0F2942]/45"
                >
                  <td className="whitespace-nowrap p-3 font-semibold text-[#1E446B] tabular-nums">
                    {String(o.order_code)}
                    <span className="block text-xs font-normal text-[#6D6A64]">
                      {String(o.order_date)}
                    </span>
                  </td>
                  <td className="min-w-[160px] p-3 font-medium text-[#18181B]">
                    {String(o.customer_name)}
                  </td>
                  <td className="whitespace-nowrap p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={operationalStatusTone(o.operational_status)}>
                        {formatOperationalStatusEs(o.operational_status)}
                      </Badge>
                      {wasModified && <Badge tone="warning">Modificado</Badge>}
                    </div>
                  </td>
                  <td className="min-w-[200px] p-3 text-[#5C5A55]">
                    {formatTraceabilitySummary(o)}
                  </td>
                  <td className="whitespace-nowrap p-3 text-right font-semibold text-[#18181B] tabular-nums">
                    {formatPen(totalVal)}
                  </td>
                  <td
                    className={`whitespace-nowrap p-3 text-right font-semibold tabular-nums ${getMarginTextClass(
                      marginVal,
                      totalVal
                    )}`}
                  >
                    {formatPen(marginVal)}
                  </td>
                  <td
                    className={`whitespace-nowrap p-3 text-right tabular-nums ${
                      debtVal > 0.05
                        ? "font-semibold text-[#B91C1C]"
                        : "font-medium text-[#15803D]"
                    }`}
                  >
                    {formatPen(debtVal)}
                  </td>
                  <td
                    className="whitespace-nowrap p-3 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="inline-flex items-center justify-end gap-1.5">
                      {canAbonar && (
                        <Button
                          variant="primary"
                          size="sm"
                          data-compact="true"
                          onClick={() => openAbonoForOrderRecord(o)}
                        >
                          Abonar
                        </Button>
                      )}
                      {canCancel && (
                        <Button
                          variant="outline"
                          size="sm"
                          data-compact="true"
                          onClick={() => {
                            setCancelOrderReason("");
                            setConfirmCancelOrder(o);
                          }}
                          className="border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2]"
                        >
                          Anular
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {ordersPagination?.hasMore && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E7E5E0] pt-3 text-xs text-[#5C5A55]">
          <span>
            Mostrando {orders.length} de {ordersPagination.totalCount} pedidos
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
  );
}
