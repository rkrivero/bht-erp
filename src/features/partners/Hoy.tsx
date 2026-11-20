"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { formatDatePe, formatPen } from "@/components/socios/types";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckIcon,
  PlusIcon,
  ShoppingBagIcon,
  WalletIcon,
} from "@/components/ui/Icons";
import { Badge, Button, Card } from "@/components/ui/Primitives";
import { formatActorName, getMarginTone, type PartnerTab } from "./partnerShared";
import type { PartnerData } from "./usePartnerData";
import type { OrderFlow } from "./useOrderFlow";
import type { CollectionsFlow } from "./useCollectionsFlow";
import type { PriorityItem } from "./types";
import { HoyDataStatusCard } from "./HoyDataStatusCard";
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
  onOpenDailyClose?: () => void;
}

export function Hoy({
  data,
  flow,
  openAbonoForOrderRecord,
  handleTabChange,
  handleGoToPurchaseProduct,
  onOpenDailyClose,
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
    kpiQ1,
    biSummary,
    dataCut,
    operationalQuality,
    accounts,
    apObligations,
    openApCount,
  } = data;

  const totalReceivablePen = React.useMemo(
    () =>
      debtorsByOrder.length > 0
        ? debtorsByOrder.reduce((sum, item) => sum + Number(item.balanceDuePen ?? 0), 0)
        : Number(kpiQ1?.accounts_receivable_pen ?? 0),
    [debtorsByOrder, kpiQ1?.accounts_receivable_pen]
  );

  const totalCashPen = React.useMemo(
    () => accounts.reduce((sum, acc) => sum + Number(acc.current_balance_pen ?? 0), 0),
    [accounts]
  );

  const totalApPen = React.useMemo(
    () =>
      apObligations
        .filter((ap) => ap.status === "OPEN" || ap.status === "PARTIAL")
        .reduce((sum, ap) => sum + Number(ap.balance_due_pen ?? 0), 0),
    [apObligations]
  );

  const lowStockCount = biSummary?.lowStockAlerts?.length ?? 0;
  const marginRiskCount = biSummary?.marginRiskSkus?.length ?? 0;
  const totalOrdersCount = ordersPagination?.totalCount ?? orders.length;
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
    <div className="flex flex-col gap-6 sm:gap-8">
      <div className="flex flex-col gap-4 px-1 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[#1c2127] sm:text-3xl">
            Primero, resuelve lo que bloquea la operación
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-[#5a6578]">
            Cola operativa del día, aprobaciones pendientes y monitor en vivo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            size="md"
            onClick={() => router.push("/vendedor")}
            className="min-h-[42px] px-5 shadow-sm transition-all duration-300 ease-in-out"
          >
            <PlusIcon className="h-4 w-4" />
            <span>Tomar Nuevo Pedido</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={() => handleTabChange("kpis")}
            className="min-h-[42px] px-4 transition-all duration-300 ease-in-out"
          >
            Ir a Reportes →
          </Button>
        </div>
      </div>

      {/* Bento Grid: 2 cols for Priority Queue + 1 col for Operational Hub */}
      <div className="grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-3 items-stretch">
        {/* Priority Queue (Bento Card — col-span-2) */}
        <Card
          id={pendingApprovals.length === 0 ? "discount-approval-queue" : undefined}
          padding="none"
          className="scroll-mt-24 overflow-hidden lg:col-span-2 flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border-hairline)] bg-[#f8fafc] px-6 py-4 sm:px-8 sm:py-5">
              <div>
                <h3 className="text-lg font-bold tracking-tight text-[#1c2127]">
                  Cola priorizada
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-[#5a6578]">
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
                    className="grid gap-4 px-6 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-8 sm:py-5 transition-all duration-300 ease-in-out hover:bg-[#f1f6fb]/60"
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-xl ${item.level === "clear" ? "bg-[#f1f5f9] text-[#5a6578]" : item.level === "critical" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}`}
                      aria-hidden="true"
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold tracking-tight text-[#1c2127] sm:text-base">
                          {item.title}
                        </h4>
                        <span className="rounded-md bg-[#e7f1fb] px-2.5 py-0.5 text-xs font-semibold text-[#3373b0]">
                          {item.dueLabel}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-[#5a6578] sm:text-sm">
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
          </div>
        </Card>

        {/* Operational Hub & Quick Navigation (Bento Card — col-span-1) */}
        <Card
          padding="md"
          className="lg:col-span-1 flex flex-col justify-between p-6 sm:p-8 bg-[#f8fafc]/90 border border-black/[0.06]"
        >
          <div className="space-y-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7f1fb] px-3 py-1 text-xs font-semibold text-[#3373b0]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#3373b0]" aria-hidden="true" />
              Acciones de Despacho
            </span>
            <h3 className="text-lg font-bold tracking-tight text-[#1c2127]">
              Flujo Operativo
            </h3>
            <p className="text-xs leading-relaxed text-[#5a6578]">
              Acceso directo para ventas mayoristas en campo, alistamiento en almacén y arqueos de caja.
            </p>
          </div>
          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={() => router.push("/vendedor")}
              className="flex w-full items-center justify-between rounded-xl bg-white p-4 text-left shadow-2xs border border-black/[0.06] transition-all duration-300 ease-in-out hover:border-[#3373b0] hover:shadow-xs group cursor-pointer"
            >
              <div>
                <p className="text-sm font-semibold tracking-tight text-[#1c2127]">
                  Tomar Pedido Mayorista
                </p>
                <p className="text-xs leading-relaxed text-[#5a6578]">
                  Catálogo con stock disponible en Soles (S/)
                </p>
              </div>
              <span className="text-sm font-bold text-[#3373b0] transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true">
                →
              </span>
            </button>
            <button
              type="button"
              onClick={() => router.push("/almacen")}
              className="flex w-full items-center justify-between rounded-xl bg-white p-4 text-left shadow-2xs border border-black/[0.06] transition-all duration-300 ease-in-out hover:border-[#3373b0] hover:shadow-xs group cursor-pointer"
            >
              <div>
                <p className="text-sm font-semibold tracking-tight text-[#1c2127]">
                  Almacén y Reparto
                </p>
                <p className="text-xs leading-relaxed text-[#5a6578]">
                  Alistamiento por etapas y rutas de entrega
                </p>
              </div>
              <span className="text-sm font-bold text-[#3373b0] transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true">
                →
              </span>
            </button>
          </div>
        </Card>
      </div>

      {/* Executive Business Summary (Bento Grid — 4 modular KPI Cards) */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => handleTabChange("kpis")}
          className="group rounded-2xl border border-black/[0.06] bg-white p-6 sm:p-8 text-left shadow-xs transition-all duration-300 ease-in-out hover:border-[#3373b0]/50 hover:-translate-y-1 hover:shadow-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3373b0]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#5a6578]">
              Ventas y Cobranza
            </span>
            <span
              className="text-xs text-[#5a6578] transition-transform duration-300 group-hover:translate-x-1 group-hover:text-[#3373b0]"
              aria-hidden="true"
            >
              →
            </span>
          </div>
          <p className="mt-3 text-3xl font-bold tracking-tight text-[#1c2127] tabular-nums">
            {formatPen(kpiQ1?.total_sales_pen ?? 0)}
          </p>
          <p className="mt-2 text-xs font-medium leading-relaxed text-[#5a6578] tabular-nums">
            Cobrado: {formatPen(kpiQ1?.collected_sales_pen ?? 0)} · {totalOrdersCount}{" "}
            pedidos
            {(dataCut?.lastOrderDate || kpiQ1?.period_end) &&
              ` · Corte: ${formatDatePe(dataCut?.lastOrderDate ?? kpiQ1?.period_end)}`}
          </p>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("deudores")}
          className="group rounded-2xl border border-black/[0.06] bg-white p-6 sm:p-8 text-left shadow-xs transition-all duration-300 ease-in-out hover:border-rose-400 hover:-translate-y-1 hover:shadow-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#5a6578]">
              Cartera por Cobrar
            </span>
            <span
              className="text-xs text-[#5a6578] transition-transform duration-300 group-hover:translate-x-1 group-hover:text-rose-600"
              aria-hidden="true"
            >
              →
            </span>
          </div>
          <p className="mt-3 text-3xl font-bold tracking-tight text-rose-700 tabular-nums">
            {formatPen(totalReceivablePen)}
          </p>
          <p className="mt-2 text-xs font-medium leading-relaxed text-[#5a6578] tabular-nums">
            {debtorsByOrder.length} pedido(s) · {brokenPromisesCount} vencida(s)
          </p>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("caja")}
          className="group rounded-2xl border border-black/[0.06] bg-white p-6 sm:p-8 text-left shadow-xs transition-all duration-300 ease-in-out hover:border-[#3373b0]/50 hover:-translate-y-1 hover:shadow-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3373b0]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#5a6578]">
              Caja y Compras (CxP)
            </span>
            <span
              className="text-xs text-[#5a6578] transition-transform duration-300 group-hover:translate-x-1 group-hover:text-[#3373b0]"
              aria-hidden="true"
            >
              →
            </span>
          </div>
          <p className="mt-3 text-3xl font-bold tracking-tight text-[#3373b0] tabular-nums">
            {formatPen(totalCashPen)}
          </p>
          <p className="mt-2 text-xs font-medium leading-relaxed text-[#5a6578] tabular-nums">
            {dataCut?.bankReconciled === false
              ? "Saldo registrado (no conciliado)"
              : "Saldo registrado"}{" "}
            · Por pagar: {formatPen(totalApPen)} ({openApCount} obl.)
          </p>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("stock")}
          className="group rounded-2xl border border-black/[0.06] bg-white p-6 sm:p-8 text-left shadow-xs transition-all duration-300 ease-in-out hover:border-amber-400 hover:-translate-y-1 hover:shadow-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#5a6578]">
              Inventario y Alertas
            </span>
            <span
              className="text-xs text-[#5a6578] transition-transform duration-300 group-hover:translate-x-1 group-hover:text-amber-600"
              aria-hidden="true"
            >
              →
            </span>
          </div>
          <p className="mt-3 text-3xl font-bold tracking-tight text-amber-800 tabular-nums">
            {lowStockCount + marginRiskCount + negStockCount}
          </p>
          <p className="mt-2 text-xs font-medium leading-relaxed text-[#5a6578] tabular-nums">
            {lowStockCount} stock bajo · {marginRiskCount} margen · {negStockCount} neg.
          </p>
        </button>
      </div>

      {/* 1-Tap Discount Approval Queue — only rendered when there are pending approvals */}
      {pendingApprovals.length > 0 && (
        <Card
          id="discount-approval-queue"
          tone="warning"
          padding="md"
          className="scroll-mt-24 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangleIcon className="h-4 w-4 text-bht-warning" />
              <h2 className="text-base sm:text-lg font-bold text-bht-ink-strong">
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
                  className="rounded-xl border border-bht-line bg-white p-3.5 shadow-xs space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="text-xs font-medium text-bht-ink-soft">
                      {String(o.order_code)} · Vendedor:{" "}
                      <strong className="text-bht-ink-strong">
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
                  <h3 className="text-sm font-semibold text-bht-ink-strong tabular-nums">
                    {String(o.customer_name)} — {formatPen(o.total_pen)}
                  </h3>
                  {displayLines.length > 0 && (
                    <div className="space-y-1 rounded-lg bg-bht-paper px-2.5 py-2 text-xs text-bht-ink-soft">
                      {displayLines.slice(0, 4).map((ln, idx) => (
                        <div
                          key={String(ln.order_line_id ?? idx)}
                          className="flex flex-wrap items-center justify-between gap-2 tabular-nums"
                        >
                          <span className="min-w-0 flex-1 truncate font-medium text-bht-ink-strong">
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
                        <p className="text-xs font-medium text-bht-ink-muted">
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
                      className="border-bht-danger-line text-bht-danger hover:bg-bht-danger-bg"
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
        <Card tone="horizon" accent="horizon" padding="md" className="space-y-3">
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
        onOpenAllOrders={() => handleTabChange("pedidos")}
      />

      <HoyRoutesQuotes
        routeTrips={routeTrips}
        partnerQuotes={partnerQuotes}
        flow={flow}
        onOpenReports={() => handleTabChange("kpis")}
        onOpenOrders={() => handleTabChange("pedidos")}
      />

      <HoyDataStatusCard
        dataCut={dataCut}
        operationalQuality={operationalQuality}
        fallbackPeriodEnd={kpiQ1?.period_end}
        onOpenTab={handleTabChange}
        onOpenDailyClose={onOpenDailyClose}
      />
    </div>
  );
}
