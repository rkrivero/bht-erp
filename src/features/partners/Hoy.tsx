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
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 px-1 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-extrabold tracking-[-0.025em] text-[var(--bht-navy)] sm:text-2xl">
            Primero, resuelve lo que bloquea la operación
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-secondary)]">
            Cola operativa del día, aprobaciones pendientes y monitor en vivo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => router.push("/vendedor")}
            className="min-h-[40px] px-4 shadow-bht-elev-12"
          >
            <PlusIcon className="h-4 w-4" />
            <span>Tomar Nuevo Pedido</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleTabChange("kpis")}
            className="min-h-[40px]"
          >
            Ir a Reportes →
          </Button>
        </div>
      </div>

      {/* Priority Queue — Exception Queue First */}
      <Card
        id={pendingApprovals.length === 0 ? "discount-approval-queue" : undefined}
        padding="none"
        className="scroll-mt-24 overflow-hidden border-[var(--border-strong)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-hairline)] bg-bht-surface-cool/70 px-4 py-3.5 sm:px-5">
          <div>
            <h3 className="text-base font-extrabold tracking-[-0.02em] text-[var(--bht-navy)] sm:text-lg">
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
                  className={`flex h-9 w-9 items-center justify-center rounded-xl ${item.level === "clear" ? "bg-bht-mist text-[var(--bht-steel)]" : item.level === "critical" ? "bg-bht-danger-bg text-bht-danger" : "bg-bht-tone-fff7e8 text-bht-tone-9a5a00"}`}
                  aria-hidden="true"
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-bold text-[var(--bht-ink)] sm:text-base">
                      {item.title}
                    </h4>
                    <span className="rounded-md bg-bht-mist px-2 py-0.5 text-xs font-bold text-bht-navy-deep">
                      {item.dueLabel}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--ink-secondary)] sm:text-sm">
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

      {/* Executive Business Summary (4 compact KPIs) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => handleTabChange("kpis")}
          className="group rounded-2xl border border-bht-line bg-white p-4 text-left shadow-bht-elev-13 transition hover:border-bht-navy-mid/45 hover:shadow-bht-elev-14 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-bht-steel">
              Ventas y Cobranza
            </span>
            <span
              className="text-xs text-bht-ink-muted transition group-hover:translate-x-0.5 group-hover:text-bht-navy-deep"
              aria-hidden="true"
            >
              →
            </span>
          </div>
          <p className="mt-2 text-2xl font-extrabold tracking-[-0.03em] text-bht-navy-deep tabular-nums">
            {formatPen(kpiQ1?.total_sales_pen ?? 0)}
          </p>
          <p className="mt-1.5 text-xs font-medium text-bht-ink-soft tabular-nums">
            Cobrado: {formatPen(kpiQ1?.collected_sales_pen ?? 0)} · {totalOrdersCount}{" "}
            pedidos
            {(dataCut?.lastOrderDate || kpiQ1?.period_end) &&
              ` · Corte: ${formatDatePe(dataCut?.lastOrderDate ?? kpiQ1?.period_end)}`}
          </p>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("deudores")}
          className="group rounded-2xl border border-bht-line bg-white p-4 text-left shadow-bht-elev-13 transition hover:border-bht-navy-mid/45 hover:shadow-bht-elev-14 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-bht-steel">
              Cartera por Cobrar
            </span>
            <span
              className="text-xs text-bht-ink-muted transition group-hover:translate-x-0.5 group-hover:text-bht-navy-deep"
              aria-hidden="true"
            >
              →
            </span>
          </div>
          <p className="mt-2 text-2xl font-extrabold tracking-[-0.03em] text-bht-danger tabular-nums">
            {formatPen(totalReceivablePen)}
          </p>
          <p className="mt-1.5 text-xs font-medium text-bht-ink-soft tabular-nums">
            {debtorsByOrder.length} pedido(s) · {brokenPromisesCount} vencida(s)
          </p>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("caja")}
          className="group rounded-2xl border border-bht-line bg-white p-4 text-left shadow-bht-elev-13 transition hover:border-bht-navy-mid/45 hover:shadow-bht-elev-14 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-bht-steel">
              Caja y Compras (CxP)
            </span>
            <span
              className="text-xs text-bht-ink-muted transition group-hover:translate-x-0.5 group-hover:text-bht-navy-deep"
              aria-hidden="true"
            >
              →
            </span>
          </div>
          <p className="mt-2 text-2xl font-extrabold tracking-[-0.03em] text-bht-navy-mid tabular-nums">
            {formatPen(totalCashPen)}
          </p>
          <p className="mt-1.5 text-xs font-medium text-bht-ink-soft tabular-nums">
            {dataCut?.bankReconciled === false
              ? "Saldo registrado (no conciliado)"
              : "Saldo registrado"}{" "}
            · Por pagar: {formatPen(totalApPen)} ({openApCount} obl.)
          </p>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("stock")}
          className="group rounded-2xl border border-bht-line bg-white p-4 text-left shadow-bht-elev-13 transition hover:border-bht-navy-mid/45 hover:shadow-bht-elev-14 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-bht-steel">
              Inventario y Alertas
            </span>
            <span
              className="text-xs text-bht-ink-muted transition group-hover:translate-x-0.5 group-hover:text-bht-navy-deep"
              aria-hidden="true"
            >
              →
            </span>
          </div>
          <p className="mt-2 text-2xl font-extrabold tracking-[-0.03em] text-bht-warning tabular-nums">
            {lowStockCount + marginRiskCount + negStockCount}
          </p>
          <p className="mt-1.5 text-xs font-medium text-bht-ink-soft tabular-nums">
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
