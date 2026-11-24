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
import { SkeletonCards, SkeletonKpiStrip } from "@/components/ui/Skeleton";
import { formatActorName, getMarginTone, type PartnerTab } from "./partnerShared";
import type { PartnerData } from "./usePartnerData";
import type { OrderFlow } from "./useOrderFlow";
import type { CollectionsFlow } from "./useCollectionsFlow";
import type { PriorityItem } from "./types";
import { HoyDataStatusCard } from "./HoyDataStatusCard";
import { HoyMonitor } from "./HoyMonitor";
import { HoyPendingOnDemandCard } from "./HoyPendingOnDemandCard";
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
    loading,
    partnerData,
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
    cashFlowSummary,
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

  const isInitialLoading = loading && !partnerData;

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <div className="flex flex-col gap-4 px-1 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-bht-ink-strong sm:text-xl">
            Primero, resuelve lo que bloquea la operación
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-bht-ink-soft">
            Cola operativa del día, aprobaciones pendientes y monitor en vivo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            size="md"
            onClick={() => router.push("/vendedor")}
            className="min-h-[42px] px-5 shadow-sm"
          >
            <PlusIcon className="h-4 w-4" />
            <span>Tomar Nuevo Pedido</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={() => handleTabChange("kpis")}
            className="min-h-[42px] px-4"
          >
            Ir a Reportes →
          </Button>
        </div>
      </div>

      {isInitialLoading ? (
        <div className="space-y-6">
          <SkeletonKpiStrip count={4} />
          <SkeletonCards count={4} />
        </div>
      ) : (
        <>
          {/* Bento Grid: 2 cols for Priority Queue + 1 col for Operational Hub */}
          <div className="bht-contain-region grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-3 items-stretch">
            {/* Priority Queue (Bento Card — col-span-2) */}
            <Card
              id={pendingApprovals.length === 0 ? "discount-approval-queue" : undefined}
              padding="none"
              className="scroll-mt-24 overflow-hidden lg:col-span-2 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-3 border-b border-[var(--border-hairline)] bg-bht-rail px-5 py-3.5 sm:px-6">
                  <div>
                    <h3 className="text-base font-semibold tracking-tight text-bht-ink-strong">
                      Cola priorizada
                    </h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-bht-ink-soft">
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
                    {priorityItems.reduce((sum, item) => sum + item.entity.count, 0)}{" "}
                    pendientes
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
                        className="grid gap-4 px-6 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-8 sm:py-5 transition-colors duration-150 hover:bg-bht-cobalt-bg/35"
                      >
                        <span
                          className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                            item.level === "clear"
                              ? "bg-bht-mist text-bht-ink-soft"
                              : item.level === "critical"
                                ? "bg-bht-danger-bg text-bht-danger-strong"
                                : "bg-bht-warning-bg text-bht-warning-strong"
                          }`}
                          aria-hidden="true"
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-semibold tracking-tight text-bht-ink-strong sm:text-base">
                              {item.title}
                            </h4>
                            <span
                              className={`rounded-md px-2.5 py-0.5 text-xs font-semibold ${
                                item.level === "clear"
                                  ? "bg-bht-success-bg text-bht-success-strong"
                                  : item.level === "critical"
                                    ? "bg-bht-danger-bg text-bht-danger-strong"
                                    : "bg-bht-warning-bg text-bht-warning-strong"
                              }`}
                            >
                              {item.dueLabel}
                            </span>
                          </div>
                          <p className="mt-1 text-sm leading-relaxed text-bht-ink-soft">
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

            {/* Daily Cash Flow Hub (Bento Card — col-span-1) */}
            <Card
              padding="md"
              className="lg:col-span-1 flex flex-col justify-between bg-white border border-bht-line"
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-bold tracking-tight text-bht-ink-strong sm:text-lg">
                    Flujo de hoy
                  </h3>
                  <Badge tone="neutral" className="tabular-nums">
                    {cashFlowSummary?.asOfLimaDate
                      ? formatDatePe(cashFlowSummary.asOfLimaDate)
                      : "Hoy"}
                  </Badge>
                </div>
                <dl className="divide-y divide-bht-line text-sm tabular-nums">
                  <div className="flex items-center justify-between gap-2 py-2.5 first:pt-0">
                    <dt className="text-bht-ink-soft">Cobros recibidos hoy</dt>
                    <dd className="font-semibold text-bht-success-strong">
                      +{formatPen(cashFlowSummary?.inflowsTodayPen ?? 0)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2 py-2.5">
                    <dt className="text-bht-ink-soft">Salidas pagadas hoy</dt>
                    <dd className="font-semibold text-bht-ink-strong">
                      -{formatPen(cashFlowSummary?.outflowsTodayPen ?? 0)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2 py-2.5">
                    <dt className="font-semibold text-bht-ink-strong">Neto de hoy</dt>
                    <dd className="text-base font-bold text-bht-navy-deep">
                      {(cashFlowSummary?.netTodayPen ?? 0) >= 0 ? "+" : ""}
                      {formatPen(cashFlowSummary?.netTodayPen ?? 0)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-2.5 text-xs text-bht-ink-soft">
                    <dt>Flujo del mes</dt>
                    <dd className="font-semibold text-bht-ink-strong">
                      {(cashFlowSummary?.netMonthPen ?? 0) >= 0 ? "+" : ""}
                      {formatPen(cashFlowSummary?.netMonthPen ?? 0)}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {onOpenDailyClose && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onOpenDailyClose}
                    className="flex-1"
                  >
                    Cierre del día
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => router.push("/almacen")}
                  className="flex-1"
                >
                  Almacén →
                </Button>
              </div>
            </Card>
          </div>

          {/* 1-Tap Discount / Credit Limit Approval Queue — prioritized above KPIs when pending */}
          {pendingApprovals.length > 0 && (
            <Card
              id="discount-approval-queue"
              tone="warning"
              padding="md"
              className="bht-contain-region scroll-mt-24 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertTriangleIcon className="h-4 w-4 text-bht-warning" />
                  <h2 className="text-base sm:text-lg font-bold text-bht-ink-strong">
                    Aprobación de Descuentos y Excesos de Crédito
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
                  const creditExceeded = Boolean(
                    (o as { credit_limit_exceeded_flag?: boolean })
                      .credit_limit_exceeded_flag
                  );
                  const lines = Array.isArray(o.lines) ? o.lines : [];
                  const discountedLines = lines.filter(
                    (ln) =>
                      Number(ln.unit_discount_pen ?? 0) > 0 ||
                      Number(ln.is_below_min_floor ?? 0) > 0
                  );
                  const displayLines =
                    discountedLines.length > 0 ? discountedLines : lines;
                  return (
                    <div
                      key={String(o.order_id)}
                      className="rounded-xl border border-bht-line bg-white p-4 shadow-xs space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="text-xs font-medium text-bht-ink-soft">
                          <span className="font-mono font-semibold text-bht-navy-mid">
                            {String(o.order_code)}
                          </span>{" "}
                          · Vendedor:{" "}
                          <strong className="text-bht-ink-strong">
                            {formatActorName(o.created_by_name, "-")}
                          </strong>
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {creditExceeded && (
                            <Badge tone="danger">Excede límite de crédito</Badge>
                          )}
                          <Badge
                            tone={getMarginTone(marginVal, totalVal)}
                            className="tabular-nums"
                          >
                            Margen: {formatPen(marginVal)} ({marginPct.toFixed(1)}%)
                          </Badge>
                        </div>
                      </div>
                      <h3 className="text-sm sm:text-base font-semibold text-bht-ink-strong tabular-nums">
                        {String(o.customer_name)} — {formatPen(o.total_pen)}
                      </h3>
                      {displayLines.length > 0 && (
                        <div className="space-y-1 rounded-lg bg-bht-paper px-3 py-2 text-sm text-bht-ink-soft">
                          {displayLines.slice(0, 4).map((ln, idx) => (
                            <div
                              key={String(ln.order_line_id ?? idx)}
                              className="flex flex-wrap items-center justify-between gap-2 tabular-nums"
                            >
                              <span className="min-w-0 flex-1 truncate font-medium text-bht-ink-strong">
                                {String(ln.raw_description || ln.sku)}
                              </span>
                              <span>
                                {Number(ln.quantity)}{" "}
                                {String(ln.unit_of_measure || "NIU")} ×{" "}
                                {formatPen(ln.unit_price_pen)}
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
                          {isBusyThis ? "Aprobando..." : "Aprobar y Enviar a Almacén"}
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

          {/* Executive Business Summary (Bento Grid — 4 modular KPI Cards) */}
          <div className="bht-contain-region grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <button
              type="button"
              onClick={() => handleTabChange("kpis")}
              className="group flex flex-col justify-between rounded-2xl border border-bht-line bg-white p-5 text-left shadow-bht-elev-1 transition-all duration-150 hover:border-bht-cobalt/50 hover:shadow-bht-elev-16 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt"
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-bht-ink-soft">
                  Ventas y Cobranza
                </span>
                <span
                  className="text-xs text-bht-ink-soft transition-transform duration-150 group-hover:translate-x-1 group-hover:text-bht-cobalt"
                  aria-hidden="true"
                >
                  →
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight text-bht-ink-strong tabular-nums xl:text-[1.75rem]">
                {formatPen(kpiQ1?.total_sales_pen ?? 0)}
              </p>
              <p className="mt-2 text-xs font-medium leading-relaxed text-bht-ink-soft tabular-nums">
                Cobrado: {formatPen(kpiQ1?.collected_sales_pen ?? 0)} ·{" "}
                {totalOrdersCount} pedidos
                {(dataCut?.lastOrderDate || kpiQ1?.period_end) &&
                  ` · Corte: ${formatDatePe(dataCut?.lastOrderDate ?? kpiQ1?.period_end)}`}
              </p>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("deudores")}
              className="group flex flex-col justify-between rounded-2xl border border-bht-line bg-white p-5 text-left shadow-bht-elev-1 transition-all duration-150 hover:border-bht-danger/50 hover:shadow-bht-elev-16 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-danger"
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-bht-ink-soft">
                  Cartera por Cobrar
                </span>
                <span
                  className="text-xs text-bht-ink-soft transition-transform duration-150 group-hover:translate-x-1 group-hover:text-bht-danger"
                  aria-hidden="true"
                >
                  →
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight text-bht-danger-strong tabular-nums xl:text-[1.75rem]">
                {formatPen(totalReceivablePen)}
              </p>
              <p className="mt-2 text-xs font-medium leading-relaxed text-bht-ink-soft tabular-nums">
                {debtorsByOrder.length} pedido(s) · {brokenPromisesCount} vencida(s)
              </p>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("caja")}
              className="group flex flex-col justify-between rounded-2xl border border-bht-line bg-white p-5 text-left shadow-bht-elev-1 transition-all duration-150 hover:border-bht-cobalt/50 hover:shadow-bht-elev-16 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt"
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-bht-ink-soft">
                  Caja y Compras (CxP)
                </span>
                <span
                  className="text-xs text-bht-ink-soft transition-transform duration-150 group-hover:translate-x-1 group-hover:text-bht-cobalt"
                  aria-hidden="true"
                >
                  →
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight text-bht-ink-strong tabular-nums xl:text-[1.75rem]">
                {formatPen(totalCashPen)}
              </p>
              <p className="mt-2 text-xs font-medium leading-relaxed text-bht-ink-soft tabular-nums">
                Flujo de hoy: {(cashFlowSummary?.netTodayPen ?? 0) >= 0 ? "+" : ""}
                {formatPen(cashFlowSummary?.netTodayPen ?? 0)} · Por pagar:{" "}
                {formatPen(totalApPen)} ({openApCount} obl.)
              </p>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("stock")}
              className="group flex flex-col justify-between rounded-2xl border border-bht-line bg-white p-5 text-left shadow-bht-elev-1 transition-all duration-150 hover:border-bht-warning/60 hover:shadow-bht-elev-16 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-warning"
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-bht-ink-soft">
                  Inventario y Alertas
                </span>
                <span
                  className="text-xs text-bht-ink-soft transition-transform duration-150 group-hover:translate-x-1 group-hover:text-bht-warning"
                  aria-hidden="true"
                >
                  →
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight text-bht-warning-strong tabular-nums xl:text-[1.75rem]">
                {lowStockCount + marginRiskCount + negStockCount}
              </p>
              <p className="mt-2 text-xs font-medium leading-relaxed text-bht-ink-soft tabular-nums">
                {lowStockCount} stock bajo · {marginRiskCount} margen · {negStockCount}{" "}
                neg.
              </p>
            </button>
          </div>
        </>
      )}

      <HoyPendingOnDemandCard
        pendingOnDemand={pendingOnDemand}
        onGoToPurchaseProduct={handleGoToPurchaseProduct}
      />

      <div className="bht-contain-region">
        <HoyMonitor
          orders={orders}
          ordersPagination={ordersPagination}
          flow={flow}
          openAbonoForOrderRecord={openAbonoForOrderRecord}
          onOpenAllOrders={() => handleTabChange("pedidos")}
        />
      </div>

      <div className="bht-contain-region">
        <HoyRoutesQuotes
          routeTrips={routeTrips}
          partnerQuotes={partnerQuotes}
          flow={flow}
          onOpenReports={() => handleTabChange("kpis")}
          onOpenOrders={() => handleTabChange("pedidos")}
        />
      </div>

      <div className="bht-contain-region">
        <HoyDataStatusCard
          dataCut={dataCut}
          operationalQuality={operationalQuality}
          fallbackPeriodEnd={kpiQ1?.period_end}
          onOpenTab={handleTabChange}
          onOpenDailyClose={onOpenDailyClose}
        />
      </div>
    </div>
  );
}
