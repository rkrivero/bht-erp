"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { formatPen } from "@/components/socios/types";
import {} from "@/components/shared/CollectionControls";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckIcon,
  PlusIcon,
  ShoppingBagIcon,
  WalletIcon,
} from "@/components/ui/Icons";
import { Badge, Button, Card } from "@/components/ui/Primitives";
import {} from "@/lib/labels-es";
import { formatActorName, getMarginTone, type PartnerTab } from "./partnerShared";
import type { PartnerData } from "./usePartnerData";
import type { OrderFlow } from "./useOrderFlow";
import type { CollectionsFlow } from "./useCollectionsFlow";
import type { PriorityItem } from "./types";
import { HoyMonitor } from "./HoyMonitor";
import { HoyRoutesQuotes } from "./HoyRoutesQuotes";

interface HoyProps {
  data: PartnerData;
  flow: OrderFlow;
  openAbonoForOrderRecord: CollectionsFlow["openAbonoForOrderRecord"];
  handleTabChange: (tab: PartnerTab) => void;
  handleGoToPurchaseProduct: (target: {
    productId: number;
    quantity?: number;
    orderLineId?: number;
  }) => void;
}

export function Hoy({
  data,
  flow,
  openAbonoForOrderRecord,
  handleTabChange,
  handleGoToPurchaseProduct,
}: HoyProps) {
  const router = useRouter();
  const {
    orders,
    ordersPagination,
    routeTrips,
    partnerQuotes,
    debtorsByOrder,
    pendingApprovals,
    pendingOnDemand,
    negStockCount,
    brokenPromisesCount,
  } = data;
  const {
    busyApproveOrderId,
    busyCancelOrderId,
    handleApproveDiscount,
    setCancelOrderReason,
    setConfirmCancelOrder,
  } = flow;

  const priorityItems: PriorityItem[] = React.useMemo(
    () => [
      {
        id: "discount-decisions",
        category: "decision",
        level: pendingApprovals.length > 0 ? "critical" : "clear",
        title: "Descuentos y bloqueos",
        summary:
          pendingApprovals.length > 0
            ? `${pendingApprovals.length} pedido(s) requieren una decisión autorizada.`
            : "No hay decisiones pendientes en este momento.",
        dueLabel: pendingApprovals.length > 0 ? "Ahora" : "Al día",
        entity: { type: "order", count: pendingApprovals.length },
        allowedAction: "review-decisions",
      },
      {
        id: "broken-promises",
        category: "cash",
        level: brokenPromisesCount > 0 ? "due" : "clear",
        title: "Promesas de pago vencidas",
        summary:
          brokenPromisesCount > 0
            ? `${brokenPromisesCount} compromiso(s) requieren seguimiento.`
            : "No hay promesas vencidas registradas.",
        dueLabel: brokenPromisesCount > 0 ? "Vencido" : "Al día",
        entity: { type: "collection", count: brokenPromisesCount },
        allowedAction: "open-collections",
      },
      {
        id: "pending-purchases",
        category: "operation",
        level: pendingOnDemand.length > 0 ? "attention" : "clear",
        title: "Compras bajo pedido",
        summary:
          pendingOnDemand.length > 0
            ? `${pendingOnDemand.length} línea(s) esperan gestión con proveedor.`
            : "No hay compras bajo pedido pendientes.",
        dueLabel: pendingOnDemand.length > 0 ? "Pendiente" : "Al día",
        entity: { type: "purchase", count: pendingOnDemand.length },
        allowedAction: "open-finance",
      },
      {
        id: "inventory-risks",
        category: "risk",
        level: negStockCount > 0 ? "attention" : "clear",
        title: "Riesgos de inventario",
        summary:
          negStockCount > 0
            ? `${negStockCount} saldo(s) negativos requieren revisión.`
            : "No hay saldos negativos históricos pendientes.",
        dueLabel: negStockCount > 0 ? "Revisar" : "Al día",
        entity: { type: "inventory", count: negStockCount },
        allowedAction: "open-inventory",
      },
    ],
    [
      brokenPromisesCount,
      negStockCount,
      pendingApprovals.length,
      pendingOnDemand.length,
    ]
  );

  const handlePriorityAction = React.useCallback(
    (action: PriorityItem["allowedAction"]) => {
      if (action === "open-collections") return handleTabChange("deudores");
      if (action === "open-finance") return handleTabChange("caja");
      if (action === "open-inventory") return handleTabChange("stock");
      document.getElementById("discount-approval-queue")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    },
    [handleTabChange]
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="order-0 flex flex-col gap-1 px-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--bht-navy)] sm:text-2xl">
            Primero, resuelve lo que bloquea la operación
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-secondary)]">
            Decisiones, caja, operación y riesgos ordenados por acción.
          </p>
        </div>
        <span className="mt-2 text-xs font-medium text-[var(--ink-secondary)] sm:mt-0">
          Hoy · America/Lima
        </span>
      </div>
      <Card
        padding="none"
        className="order-1 overflow-hidden border-[var(--border-strong)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-hairline)] px-4 py-3.5 sm:px-5">
          <div>
            <h3 className="text-base font-bold text-[var(--bht-navy)]">
              Cola priorizada
            </h3>
            <p className="mt-0.5 text-xs text-[var(--ink-secondary)]">
              Ordenada por impacto, vencimiento y acción permitida.
            </p>
          </div>
          <Badge
            tone={
              priorityItems.some((item) => item.entity.count > 0)
                ? "warning"
                : "success"
            }
          >
            {priorityItems.reduce((sum, item) => sum + item.entity.count, 0)} pendientes
          </Badge>
        </div>
        <div className="divide-y divide-[var(--border-hairline)]">
          {priorityItems.map((item) => {
            const Icon =
              item.category === "decision"
                ? ActivityIcon
                : item.category === "cash"
                  ? WalletIcon
                  : item.category === "operation"
                    ? ShoppingBagIcon
                    : AlertTriangleIcon;
            return (
              <div
                key={item.id}
                className="grid gap-3 px-4 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-5"
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-xl ${item.level === "clear" ? "bg-[#F2F6FA] text-[var(--bht-steel)]" : item.level === "critical" ? "bg-[#FEF2F2] text-[#B91C1C]" : "bg-[#FFF7E8] text-[#9A5A00]"}`}
                  aria-hidden="true"
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-[var(--bht-ink)]">
                      {item.title}
                    </h4>
                    <span className="text-xs font-semibold text-[var(--ink-secondary)]">
                      {item.dueLabel}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--ink-secondary)]">
                    {item.summary}
                  </p>
                </div>
                <Button
                  variant={item.entity.count > 0 ? "primary" : "outline"}
                  size="sm"
                  onClick={() => handlePriorityAction(item.allowedAction)}
                  className="w-full sm:w-auto"
                >
                  {item.entity.count > 0 ? "Resolver" : "Revisar"}
                </Button>
              </div>
            );
          })}
        </div>
      </Card>
      {/* Primary Order Intake Action Hub */}
      <Card
        accent="horizon"
        padding="md"
        className="order-4 border-[var(--border-hairline)] bg-white"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#0F2942] text-white shadow-[0_2px_6px_rgba(15,41,66,0.18)]">
              <ShoppingBagIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-semibold text-[#0F2942]">
                Toma Rápida de Pedidos y Ventas
              </h2>
              <p className="mt-0.5 text-xs text-[#5C5A55]">
                Registra pedidos nuevos, busca clientes y cobra en ruta directamente.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:flex-shrink-0">
            <Button
              variant="primary"
              size="md"
              onClick={() => router.push("/vendedor")}
              className="flex-1 sm:flex-initial min-h-[44px] px-5 shadow-[0_2px_10px_rgba(15,41,66,0.18)]"
            >
              <PlusIcon className="h-4 w-4" />
              <span>Tomar Nuevo Pedido</span>
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => router.push("/almacen")}
              className="sm:hidden min-h-[44px]"
            >
              Almacén
            </Button>
          </div>
        </div>
      </Card>

      {/* Executive Quick Glance Strip ordered by operational priority */}
      <div className="order-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => handleTabChange("control")}
          className="group rounded-2xl border border-[#E7E5E0] bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,41,66,0.03)] transition hover:border-[#1E446B]/45 hover:shadow-[0_2px_8px_rgba(15,41,66,0.06)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#4A4843]">Pend. Aprobación</span>
            <span
              className="text-xs text-[#6D6A64] transition group-hover:translate-x-0.5 group-hover:text-[#0F2942]"
              aria-hidden="true"
            >
              →
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-[#0F2942] tabular-nums">
            {pendingApprovals.length}
          </p>
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("deudores")}
          className="group rounded-2xl border border-[#E7E5E0] bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,41,66,0.03)] transition hover:border-[#1E446B]/45 hover:shadow-[0_2px_8px_rgba(15,41,66,0.06)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#4A4843]">
              Pedidos por cobrar
            </span>
            <span
              className="text-xs text-[#6D6A64] transition group-hover:translate-x-0.5 group-hover:text-[#0F2942]"
              aria-hidden="true"
            >
              →
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-[#B91C1C] tabular-nums">
            {debtorsByOrder.length}
          </p>
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("caja")}
          className="group rounded-2xl border border-[#E7E5E0] bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,41,66,0.03)] transition hover:border-[#1E446B]/45 hover:shadow-[0_2px_8px_rgba(15,41,66,0.06)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#4A4843]">
              Bajo pedido pendientes
            </span>
            <span
              className="text-xs text-[#6D6A64] transition group-hover:translate-x-0.5 group-hover:text-[#0F2942]"
              aria-hidden="true"
            >
              →
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-[#1E446B] tabular-nums">
            {pendingOnDemand.length}
          </p>
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("stock")}
          className="group rounded-2xl border border-[#E7E5E0] bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,41,66,0.03)] transition hover:border-[#1E446B]/45 hover:shadow-[0_2px_8px_rgba(15,41,66,0.06)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#4A4843]">
              Saldos negativos Día 1
            </span>
            <span
              className="text-xs text-[#6D6A64] transition group-hover:translate-x-0.5 group-hover:text-[#0F2942]"
              aria-hidden="true"
            >
              →
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-[#B45309] tabular-nums">
            {negStockCount}
          </p>
        </button>
      </div>

      {/* 1-Tap Discount Approval Queue — calm slim banner when 0 pending */}
      {pendingApprovals.length === 0 ? (
        <div
          id="discount-approval-queue"
          className="order-2 flex scroll-mt-24 items-center justify-between gap-2 rounded-2xl border border-[#D5E0E9] bg-white px-4 py-4 text-sm text-[#486581]"
        >
          <span className="flex items-center gap-2">
            <CheckIcon className="h-3.5 w-3.5 text-[#15803D]" />
            No hay pedidos retenidos por descuento en este momento.
          </span>
          <Badge tone="neutral">0 pendientes</Badge>
        </div>
      ) : (
        <Card
          id="discount-approval-queue"
          tone="warning"
          padding="md"
          className="order-2 scroll-mt-24 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangleIcon className="h-4 w-4 text-[#B45309]" />
              <h2 className="text-sm sm:text-base font-semibold text-[#18181B]">
                Aprobación de Descuentos bajo el Precio Mínimo
              </h2>
            </div>
            <Badge tone="warning">{pendingApprovals.length} pendiente(s)</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {pendingApprovals.map((o) => {
              const orderId = Number(o.order_id);
              const isBusyThis = busyApproveOrderId === orderId;
              const marginVal = Number(o.order_margin_pen ?? 0);
              const totalVal = Number(o.total_pen ?? 0);
              const marginPct = totalVal > 0 ? (marginVal / totalVal) * 100 : 0;
              const lines = Array.isArray(o.lines) ? o.lines : [];
              const discountedLines = lines.filter(
                (ln) =>
                  Number(ln.unit_discount_pen ?? 0) > 0 ||
                  Number(ln.is_below_min_floor ?? 0) > 0
              );
              const displayLines = discountedLines.length > 0 ? discountedLines : lines;
              return (
                <div
                  key={String(o.order_id)}
                  className="rounded-xl border border-[#E7E5E0] bg-white p-3.5 shadow-xs space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="text-xs font-medium text-[#5C5A55]">
                      {String(o.order_code)} · Vendedor:{" "}
                      <strong className="text-[#18181B]">
                        {formatActorName(o.created_by_name, "-")}
                      </strong>
                    </span>
                    <Badge
                      tone={getMarginTone(marginVal, totalVal)}
                      className="tabular-nums"
                    >
                      Margen: {formatPen(marginVal)} ({marginPct.toFixed(1)}%)
                    </Badge>
                  </div>
                  <h3 className="text-sm font-semibold text-[#18181B] tabular-nums">
                    {String(o.customer_name)} — {formatPen(o.total_pen)}
                  </h3>
                  {displayLines.length > 0 && (
                    <div className="space-y-1 rounded-lg bg-[#FAF9F6] px-2.5 py-2 text-xs text-[#5C5A55]">
                      {displayLines.slice(0, 4).map((ln, idx) => (
                        <div
                          key={String(ln.order_line_id ?? idx)}
                          className="flex flex-wrap items-center justify-between gap-2 tabular-nums"
                        >
                          <span className="min-w-0 flex-1 truncate font-medium text-[#18181B]">
                            {String(ln.raw_description || ln.sku)}
                          </span>
                          <span>
                            {Number(ln.quantity)} {String(ln.unit_of_measure || "NIU")}{" "}
                            × {formatPen(ln.unit_price_pen)}
                            {Number(ln.unit_discount_pen || 0) > 0
                              ? ` (-${formatPen(ln.unit_discount_pen)})`
                              : ""}
                          </span>
                        </div>
                      ))}
                      {displayLines.length > 4 && (
                        <p className="text-xs font-medium text-[#6D6A64]">
                          +{displayLines.length - 4} línea(s) adicional(es)
                        </p>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="success"
                      size="sm"
                      disabled={
                        busyApproveOrderId !== null || busyCancelOrderId !== null
                      }
                      aria-label={`Aprobar pedido ${String(o.order_code)} de ${String(o.customer_name)} y enviar a Almacén`}
                      onClick={() => handleApproveDiscount(orderId)}
                      className="flex-1"
                    >
                      <CheckIcon className="h-3.5 w-3.5" />
                      {isBusyThis
                        ? "Aprobando..."
                        : "Aprobar con 1 Toque y Enviar a Almacén"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        busyApproveOrderId !== null || busyCancelOrderId !== null
                      }
                      onClick={() => {
                        setCancelOrderReason("");
                        setConfirmCancelOrder(o);
                      }}
                      className="border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2]"
                    >
                      Anular
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ON_DEMAND Pending Supplier Purchases */}
      {pendingOnDemand.length > 0 && (
        <Card
          tone="horizon"
          accent="horizon"
          padding="md"
          className="order-5 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm sm:text-base font-semibold text-[#0F2942]">
              Pedidos Bajo Pedido Pendientes de Compra ({pendingOnDemand.length})
            </h2>
          </div>
          <div className="grid gap-2.5 md:grid-cols-2">
            {pendingOnDemand.map((od) => (
              <div
                key={od.order_line_id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#D4E0EC] bg-white p-3 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-[#18181B]">
                    {od.sku} — {od.product_name} (×{Number(od.quantity)}{" "}
                    {od.unit_of_measure || "NIU"})
                  </p>
                  <p className="mt-0.5 truncate text-[#5C5A55] tabular-nums">
                    {od.order_code} · {od.customer_name || od.customer_name_raw || "-"}{" "}
                    · {formatPen(od.line_total_pen)}
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  aria-label={`Comprar ${od.sku} (${od.product_name})`}
                  onClick={() =>
                    handleGoToPurchaseProduct({
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
      )}

      <HoyMonitor
        orders={orders}
        ordersPagination={ordersPagination}
        flow={flow}
        openAbonoForOrderRecord={openAbonoForOrderRecord}
      />

      <HoyRoutesQuotes
        routeTrips={routeTrips}
        partnerQuotes={partnerQuotes}
        flow={flow}
      />
    </div>
  );
}
