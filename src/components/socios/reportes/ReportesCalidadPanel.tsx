"use client";

import React from "react";
import { Badge, Button, Card } from "@/components/ui/Primitives";
import {
  formatDatePe,
  formatPen,
  type DataCutSummary,
  type OperationalQualitySummary,
  type StartupChecklistItem,
} from "../types";

interface ReportesCalidadPanelProps {
  dataCut?: DataCutSummary;
  quality: OperationalQualitySummary;
  onOpenInventory?: () => void;
  onOpenCaja?: () => void;
  onOpenDirectory?: () => void;
  onOpenCollections?: () => void;
  onOpenSeller?: () => void;
}

export function ReportesCalidadPanel({
  dataCut,
  quality,
  onOpenInventory,
  onOpenCaja,
  onOpenDirectory,
  onOpenCollections,
  onOpenSeller,
}: ReportesCalidadPanelProps) {
  const coverage = quality.registrationCoverage24h;
  const doneCount = quality.startupChecklist.filter((item) => item.done).length;

  function resolveTargetAction(
    targetTab: StartupChecklistItem["targetTab"]
  ): { label: string; handler: () => void } | null {
    if (targetTab === "stock" && onOpenInventory) {
      return { label: "Ir a Inventario", handler: onOpenInventory };
    }
    if (targetTab === "caja" && onOpenCaja) {
      return { label: "Ir a Caja", handler: onOpenCaja };
    }
    if (targetTab === "directorio" && onOpenDirectory) {
      return { label: "Ir a Directorio", handler: onOpenDirectory };
    }
    if (targetTab === "deudores" && onOpenCollections) {
      return { label: "Ir a Cobranza", handler: onOpenCollections };
    }
    if (targetTab === "vendedor" && onOpenSeller) {
      return { label: "Ir a Ventas", handler: onOpenSeller };
    }
    return null;
  }

  const actionableIndicators = [
    {
      label: "Ventas registradas desde la app",
      value: `${quality.erpAppOrdersCount} / ${quality.totalOrdersCount}`,
      detail:
        quality.erpAppOrdersCount === 0
          ? "Todo el historial proviene de carga inicial; faltan ventas en vivo."
          : "Pedidos originados directamente desde el ERP.",
      tone: quality.erpAppOrdersCount > 0 ? ("success" as const) : ("warning" as const),
    },
    {
      label: "Productos sin costo",
      value: `${quality.soldSkusMissingCostCount} vendidos (${formatPen(quality.soldSkusMissingCostPen)})`,
      detail: `${quality.productsMissingCostCount} de ${quality.activeProductsCount} productos activos no tienen costo de referencia.`,
      tone:
        quality.soldSkusMissingCostCount > 0
          ? ("danger" as const)
          : ("success" as const),
    },
    {
      label: "Compras sin detalle por producto",
      value: `${quality.purchasesWithoutDetailCount} / ${quality.purchasesTotalCount}`,
      detail: "Facturas registradas sin líneas de mercadería detalladas.",
      tone:
        quality.purchasesWithoutDetailCount > 0
          ? ("warning" as const)
          : ("success" as const),
    },
    {
      label: "Clientes sin teléfono, zona o GPS",
      value: `${quality.customersMissingPhoneCount} sin tel. · ${quality.customersMissingZoneCount} sin zona`,
      detail: `${quality.customersMissingGeoCount} de ${quality.activeCustomersCount} clientes activos sin ubicación GPS.`,
      tone:
        quality.customersMissingPhoneCount > 0 || quality.customersMissingZoneCount > 0
          ? ("warning" as const)
          : ("success" as const),
    },
    {
      label: "Operaciones sin responsable",
      value: `${quality.ordersMissingSellerCount} / ${quality.totalOrdersCount}`,
      detail: "Pedidos históricos sin vendedor asignado en el registro.",
      tone:
        quality.ordersMissingSellerCount > 0
          ? ("warning" as const)
          : ("success" as const),
    },
    {
      label: "Rutas sin conciliación",
      value: `${quality.tripsWithoutReconciliationCount} / ${quality.tripsTotalCount}`,
      detail: "Viajes de reparto sin efectivo neto declarado para cuadre.",
      tone:
        quality.tripsWithoutReconciliationCount > 0
          ? ("warning" as const)
          : ("success" as const),
    },
    {
      label: "Último cierre diario",
      value: quality.latestDailyClosure
        ? formatDatePe(quality.latestDailyClosure.closureDate)
        : "Sin cierre registrado",
      detail: quality.latestDailyClosure
        ? `Por ${quality.latestDailyClosure.closedByName} · Diferencia: ${formatPen(quality.latestDailyClosure.varianceTotalPen)}`
        : "Usa Caja → Cierre diario para conciliar saldos al fin del día.",
      tone: quality.latestDailyClosure
        ? Math.abs(quality.latestDailyClosure.varianceTotalPen) < 0.01
          ? ("success" as const)
          : ("warning" as const)
        : ("warning" as const),
    },
    {
      label: "Última fecha registrada",
      value: dataCut?.lastOrderDate
        ? `Ventas: ${formatDatePe(dataCut.lastOrderDate)}`
        : "Sin ventas",
      detail: dataCut
        ? `Caja: ${formatDatePe(dataCut.lastCashLedgerDate)} · Cobros: ${formatDatePe(dataCut.lastPaymentDate)} · Compras: ${formatDatePe(dataCut.lastPurchaseDate)}`
        : "Verifica la vigencia de cada módulo antes de usar los reportes.",
      tone: dataCut?.isStale ? ("warning" as const) : ("horizon" as const),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Primary 4-week metric: 24h Complete Registration Coverage */}
      <Card
        accent="horizon"
        tone={
          coverage.baselineMode === "NO_APP_ORDERS"
            ? "warning"
            : coverage.coveragePct !== null && coverage.coveragePct >= 90
              ? "success"
              : "warning"
        }
        padding="md"
        className="space-y-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
              Cobertura de registro completo en 24 h
            </h3>
            <p className="text-xs text-bht-ink-soft">
              Métrica principal de arranque (4 semanas): pedidos creados en el ERP
              dentro de 24 h con cliente, costo conocido, responsable, cuenta de ingreso
              y fecha si queda saldo.
            </p>
          </div>
          <Badge tone="horizon">Meta S2 ≥ 90% · S4 ≥ 98%</Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-bht-line bg-white p-3">
            <span className="text-xs font-medium text-bht-ink-soft">
              Completas / Realizadas (ERP)
            </span>
            <p className="mt-1 text-2xl font-bold text-bht-navy-deep tabular-nums">
              {coverage.numerator} / {coverage.denominator}
            </p>
          </div>

          <div className="rounded-xl border border-bht-line bg-white p-3">
            <span className="text-xs font-medium text-bht-ink-soft">
              Cobertura lograda
            </span>
            <p className="mt-1 text-2xl font-bold text-bht-navy-deep tabular-nums">
              {coverage.coveragePct !== null
                ? `${coverage.coveragePct.toFixed(1)}%`
                : "Sin base aún"}
            </p>
          </div>

          <div className="rounded-xl border border-bht-line bg-white p-3">
            <span className="text-xs font-medium text-bht-ink-soft">Estado actual</span>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge
                tone={
                  coverage.baselineMode === "NO_APP_ORDERS"
                    ? "warning"
                    : coverage.coveragePct !== null && coverage.coveragePct >= 90
                      ? "success"
                      : "warning"
                }
              >
                {coverage.baselineMode === "NO_APP_ORDERS"
                  ? "Línea base: 0 ventas ERP"
                  : coverage.incompleteOrders.length === 0
                    ? "100% completas"
                    : `${coverage.incompleteOrders.length} por completar`}
              </Badge>
            </div>
          </div>

          <div className="rounded-xl border border-bht-line bg-white p-3">
            <span className="text-xs font-medium text-bht-ink-soft">
              Tasa de correcciones
            </span>
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-1.5">
              <p className="text-2xl font-bold text-bht-navy-deep tabular-nums">
                {coverage.correctionRatePct !== null
                  ? `${coverage.correctionRatePct.toFixed(1)}%`
                  : "0.0%"}
              </p>
              <Badge
                tone={(coverage.correctionRatePct ?? 0) < 2 ? "success" : "danger"}
              >
                Meta &lt; 2%
              </Badge>
            </div>
          </div>
        </div>

        {coverage.weeklyCohorts.length > 0 && (
          <div className="rounded-xl border border-bht-line bg-white p-3 space-y-2">
            <p className="text-xs font-semibold text-bht-ink-strong">
              Cohortes semanales (últimas semanas):
            </p>
            <div className="space-y-1.5">
              {coverage.weeklyCohorts.map((cohort) => (
                <div
                  key={cohort.weekStart}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bht-paper px-2.5 py-1.5 text-xs tabular-nums"
                >
                  <span className="font-semibold text-bht-navy-deep">
                    Sem. {formatDatePe(cohort.weekStart)}
                  </span>
                  <span className="text-bht-ink-soft">
                    {cohort.completeOrders} / {cohort.totalOrders} (
                    {cohort.coveragePct.toFixed(1)}%) · Correcciones:{" "}
                    {cohort.correctionCount}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {coverage.incompleteOrders.length > 0 && (
          <div className="rounded-xl border border-bht-line bg-white p-3 space-y-2">
            <p className="text-xs font-semibold text-bht-ink-strong">
              Operaciones ERP incompletas o fuera de 24 h (primeras{" "}
              {Math.min(5, coverage.incompleteOrders.length)}):
            </p>
            <div className="space-y-1.5">
              {coverage.incompleteOrders.slice(0, 5).map((order) => (
                <div
                  key={order.orderId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bht-paper px-2.5 py-1.5 text-xs"
                >
                  <span className="font-semibold text-bht-navy-deep tabular-nums">
                    {order.orderCode} · {formatDatePe(order.orderDate)}
                  </span>
                  <span className="text-bht-ink-soft">
                    {order.missingFields.join(" · ")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Actionable Data Quality Indicators */}
      <Card padding="md" className="space-y-3">
        <div>
          <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
            Panel de Calidad del Dato (Indicadores Accionables)
          </h3>
          <p className="mt-0.5 text-xs text-bht-ink-soft">
            Brechas detectadas actualmente en la base operativa antes de usar los
            reportes para decisiones comerciales.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {actionableIndicators.map((indicator) => (
            <div
              key={indicator.label}
              className="rounded-xl border border-bht-line bg-bht-paper p-3 text-xs space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-bht-ink-soft">{indicator.label}</span>
                <Badge tone={indicator.tone}>
                  {indicator.tone === "success" ? "OK" : "Revisar"}
                </Badge>
              </div>
              <p className="text-sm font-semibold text-bht-ink-strong tabular-nums">
                {indicator.value}
              </p>
              <p className="text-xs text-bht-ink-soft">{indicator.detail}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Operational Startup Checklist */}
      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
              Lista de Verificación de Inicio Operativo
            </h3>
            <p className="mt-0.5 text-xs text-bht-ink-soft">
              Controles previos recomendados para trabajar sobre una fuente de verdad
              confiable.
            </p>
          </div>
          <Badge
            tone={doneCount === quality.startupChecklist.length ? "success" : "warning"}
          >
            {doneCount} / {quality.startupChecklist.length} listos
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {quality.startupChecklist.map((item) => {
            const action = resolveTargetAction(item.targetTab);
            return (
              <div
                key={item.code}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bht-line bg-bht-paper p-3 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={item.done ? "success" : "warning"}>
                      {item.done ? "Listo" : "Pendiente"}
                    </Badge>
                    <span className="font-semibold text-bht-ink-strong">
                      {item.label}
                    </span>
                  </div>
                  <p className="text-bht-ink-soft">{item.detail}</p>
                </div>
                {!item.done && action && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={action.handler}
                  >
                    {action.label}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
