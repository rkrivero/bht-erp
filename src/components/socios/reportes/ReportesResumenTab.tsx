"use client";

import React, { useState } from "react";
import { Badge, Card } from "@/components/ui/Primitives";
import { formatMonthLabel, formatPen } from "../types";
import {
  type ActiveReportConcept,
  ConceptCardButton,
  ReportConceptModal,
} from "./ReportConceptModal";
import ReportesMonthlyPnlCard from "./ReportesMonthlyPnlCard";
import { type ReportResumenDto, formatPct } from "./reportes-types";

interface ReportesResumenTabProps {
  data: ReportResumenDto;
  hasScopeFilter: boolean;
  onResetFilters?: () => void;
}

export default function ReportesResumenTab({
  data,
  hasScopeFilter,
  onResetFilters,
}: ReportesResumenTabProps) {
  const [activeConcept, setActiveConcept] = useState<ActiveReportConcept | null>(null);
  const { totals, pnlMonthly, momComparison, openDebtorsCount } = data;

  const revenueBase = Math.max(1, totals.costCoveredSalesPen || totals.salesTotalPen);
  const cogsSharePct = Math.min(100, Math.max(0, (totals.cogsPen / revenueBase) * 100));
  const routeSharePct = Math.min(
    100 - cogsSharePct,
    Math.max(0, (totals.routeOpexPen / revenueBase) * 100)
  );
  const adminSharePct = Math.min(
    100 - cogsSharePct - routeSharePct,
    Math.max(0, (totals.adminOpexPen / revenueBase) * 100)
  );
  const opResultSharePct = Math.max(
    0,
    100 - cogsSharePct - routeSharePct - adminSharePct
  );

  return (
    <div className="min-w-0 space-y-5">
      {hasScopeFilter && (
        <div className="rounded-xl border border-bht-info-line bg-bht-mist px-3.5 py-2.5 text-xs text-bht-ink-strong">
          <strong>Vista segmentada por Zona / Vendedor:</strong> Las compras de
          mercadería, gastos fijos administrativos, retiros e inversión pre-ruta
          corresponden a caja global y no se asignan a un vendedor individual.
        </div>
      )}

      {/* Partial operating result */}
      <section aria-label="Resultado comercial parcial" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2 px-1">
          <div>
            <h3 className="text-base font-bold tracking-[-0.02em] text-bht-navy-deep sm:text-lg">
              Resultado comercial y operativo
            </h3>
            <p className="mt-0.5 text-sm text-bht-ink-soft">
              Usa costos y movimientos del ERP. No reemplaza un estado de resultados ni
              una conciliación bancaria completa.
              {totals.ownerSalaryRecordedPen === 0 &&
                " · Sin sueldo de socio registrado en Caja → Gastos."}
            </p>
          </div>
          {momComparison && (
            <Badge tone="horizon" className="tabular-nums">
              Últ. mes ({formatMonthLabel(momComparison.currentMonth)} vs.{" "}
              {formatMonthLabel(momComparison.previousMonth)}): Ventas{" "}
              {momComparison.salesDeltaPct !== null
                ? `${momComparison.salesDeltaPct >= 0 ? "+" : ""}${momComparison.salesDeltaPct.toFixed(1)}%`
                : "-"}
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-bht-line bg-bht-line sm:grid-cols-2 lg:grid-cols-3">
          <ConceptCardButton
            variant="cell"
            onClick={() =>
              setActiveConcept({
                id: "ventas_totales",
                currentValue: formatPen(totals.salesTotalPen),
                currentSubtext: `${totals.orderCount} pedido(s) · Cobertura de costo: ${formatPct(totals.costCoveragePct)}`,
              })
            }
          >
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-bht-steel">
              Ventas Totales ({totals.orderCount} ped.)
            </span>
            <p className="text-2xl font-bold tracking-[-0.03em] text-bht-navy-deep tabular-nums">
              {formatPen(totals.salesTotalPen)}
            </p>
            <span className="inline-flex items-center rounded-md border border-bht-line-blue bg-bht-mist px-2 py-0.5 text-xs font-semibold text-bht-navy-deep tabular-nums">
              Cobertura de costo: {formatPct(totals.costCoveragePct)}
            </span>
          </ConceptCardButton>

          <ConceptCardButton
            variant="cell"
            onClick={() =>
              setActiveConcept({
                id: "margen_bruto_con_costo",
                currentValue: formatPen(totals.grossMarginPen),
                currentSubtext: `${formatPct(totals.grossMarginPct)} margen · Costo: ${formatPen(totals.cogsPen)}`,
              })
            }
          >
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-bht-steel">
              Margen bruto sobre ventas con costo
            </span>
            <p className="text-2xl font-bold tracking-[-0.03em] text-bht-success tabular-nums">
              {formatPen(totals.grossMarginPen)}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-bht-ink-soft tabular-nums">
              <Badge tone="success">{formatPct(totals.grossMarginPct)} margen</Badge>
              <span>Costo: {formatPen(totals.cogsPen)}</span>
            </div>
          </ConceptCardButton>

          <ConceptCardButton
            variant="cell"
            onClick={() =>
              setActiveConcept({
                id: "gastos_operativos_ruta",
                currentValue: formatPen(totals.routeOpexPen),
                currentSubtext: `${formatPct(totals.routeOpexPct)} sobre ventas (Meta ≤ 8%)`,
              })
            }
          >
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-bht-steel">
              Gastos Operativos de Ruta
            </span>
            <p className="text-2xl font-bold tracking-[-0.03em] text-bht-warning tabular-nums">
              {formatPen(totals.routeOpexPen)}
            </p>
            <Badge
              tone={
                totals.routeOpexPct !== null && totals.routeOpexPct > 8
                  ? "danger"
                  : "neutral"
              }
            >
              {formatPct(totals.routeOpexPct)} sobre ventas (Meta &le; 8%)
            </Badge>
          </ConceptCardButton>

          <ConceptCardButton
            variant="cell"
            onClick={() =>
              setActiveConcept({
                id: "contribucion_ruta",
                currentValue: formatPen(totals.operatingEbitdaPen),
                currentSubtext: `${formatPct(totals.operatingEbitdaPct)} sobre venta con costo`,
              })
            }
          >
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-bht-steel">
              Contribución después de gastos de ruta
            </span>
            <p
              className={`text-2xl font-bold tracking-[-0.03em] tabular-nums ${
                totals.operatingEbitdaPen >= 0
                  ? "text-bht-navy-deep"
                  : "text-bht-danger"
              }`}
            >
              {formatPen(totals.operatingEbitdaPen)}
            </p>
            <Badge
              tone={
                totals.operatingEbitdaPen >= 0
                  ? totals.operatingEbitdaPct !== null &&
                    totals.operatingEbitdaPct >= 15
                    ? "success"
                    : "brand"
                  : "danger"
              }
            >
              {formatPct(totals.operatingEbitdaPct)} sobre venta con costo
            </Badge>
          </ConceptCardButton>

          <ConceptCardButton
            variant="cell"
            onClick={() =>
              setActiveConcept({
                id: "gastos_fijos_admin",
                currentValue: formatPen(totals.adminOpexPen),
                currentSubtext: `Sueldo socio: ${formatPen(totals.ownerSalaryRecordedPen)} · Total gastos: ${formatPen(totals.totalOpexPen)}`,
              })
            }
          >
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-bht-steel">
              Gastos Fijos / Admin
            </span>
            <p className="text-2xl font-bold tracking-[-0.03em] text-bht-ink-strong tabular-nums">
              {formatPen(totals.adminOpexPen)}
            </p>
            <span className="block text-xs text-bht-ink-soft tabular-nums">
              Sueldo socio: {formatPen(totals.ownerSalaryRecordedPen)}
            </span>
          </ConceptCardButton>

          <ConceptCardButton
            variant="cell"
            onClick={() =>
              setActiveConcept({
                id: "resultado_operativo_registrado",
                currentValue: formatPen(totals.operatingResultPen),
                currentSubtext: `${formatPct(totals.operatingResultPct)} sobre venta con costo · Total gastos: ${formatPen(totals.totalOpexPen)}`,
              })
            }
          >
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-bht-steel">
              Resultado Operativo Registrado
            </span>
            <p
              className={`text-2xl font-bold tracking-[-0.03em] tabular-nums ${
                totals.operatingResultPen >= 0
                  ? "text-bht-navy-deep"
                  : "text-bht-danger"
              }`}
            >
              {formatPen(totals.operatingResultPen)}
            </p>
            <Badge
              tone={
                totals.operatingResultPen >= 0
                  ? totals.operatingResultPct !== null &&
                    totals.operatingResultPct >= 10
                    ? "success"
                    : "brand"
                  : "danger"
              }
            >
              {formatPct(totals.operatingResultPct)} sobre venta con costo
            </Badge>
          </ConceptCardButton>
        </div>

        {/* Visual Revenue Breakdown Chart */}
        {totals.salesTotalPen > 0 && (
          <Card padding="md" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-bht-navy-deep">
                  Estructura de cada S/ 100 de venta con costo conocido
                </h4>
                <p className="text-xs text-bht-ink-soft">
                  Proporción entre costo de mercadería (COGS), logística de ruta, gastos
                  fijos y resultado operativo.
                </p>
              </div>
              <span className="text-xs font-bold text-bht-navy-deep tabular-nums">
                Base con costo: {formatPen(totals.costCoveredSalesPen)}
              </span>
            </div>

            <div
              className="flex h-4 w-full overflow-hidden rounded-full bg-bht-line p-0.5 gap-0.5"
              aria-hidden="true"
            >
              {cogsSharePct > 0 && (
                <div
                  className="h-full rounded-l-full bg-bht-navy-mid transition-all"
                  style={{ width: `${cogsSharePct}%` }}
                />
              )}
              {routeSharePct > 0 && (
                <div
                  className="h-full bg-bht-warning transition-all"
                  style={{ width: `${routeSharePct}%` }}
                />
              )}
              {adminSharePct > 0 && (
                <div
                  className="h-full bg-bht-steel transition-all"
                  style={{ width: `${adminSharePct}%` }}
                />
              )}
              {opResultSharePct > 0 && (
                <div
                  className="h-full rounded-r-full bg-bht-success transition-all"
                  style={{ width: `${opResultSharePct}%` }}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div className="flex items-center gap-2 rounded-lg bg-bht-paper px-2.5 py-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-bht-navy-mid" />
                <div className="min-w-0">
                  <span className="block text-xs font-medium text-bht-ink-soft">
                    Costo Mercadería
                  </span>
                  <strong className="text-bht-ink-strong tabular-nums">
                    {cogsSharePct.toFixed(1)}% · {formatPen(totals.cogsPen)}
                  </strong>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-bht-paper px-2.5 py-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-bht-warning" />
                <div className="min-w-0">
                  <span className="block text-xs font-medium text-bht-ink-soft">
                    Gastos Ruta
                  </span>
                  <strong className="text-bht-ink-strong tabular-nums">
                    {routeSharePct.toFixed(1)}% · {formatPen(totals.routeOpexPen)}
                  </strong>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-bht-paper px-2.5 py-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-bht-steel" />
                <div className="min-w-0">
                  <span className="block text-xs font-medium text-bht-ink-soft">
                    Gastos Admin
                  </span>
                  <strong className="text-bht-ink-strong tabular-nums">
                    {adminSharePct.toFixed(1)}% · {formatPen(totals.adminOpexPen)}
                  </strong>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-bht-paper px-2.5 py-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-bht-success" />
                <div className="min-w-0">
                  <span className="block text-xs font-medium text-bht-ink-soft">
                    Resultado Op.
                  </span>
                  <strong className="text-bht-success tabular-nums">
                    {opResultSharePct.toFixed(1)}% ·{" "}
                    {formatPen(totals.operatingResultPen)}
                  </strong>
                </div>
              </div>
            </div>
          </Card>
        )}
      </section>

      {/* Cash Flow Summary */}
      <section aria-label="Movimientos de caja registrados" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <h3 className="text-base sm:text-lg font-bold text-bht-navy-deep">
            Movimientos de caja registrados
          </h3>
          <Badge
            tone={totals.nonOpexVsReinvestmentPct > 30 ? "danger" : "success"}
            className="tabular-nums"
          >
            Retiros vs. Reinversión: {totals.nonOpexVsReinvestmentPct.toFixed(1)}% (Meta
            &lt; 30%)
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              {
                conceptId: "pagado_en_pedidos",
                title: "Cobros efectivos del período",
                value: formatPen(totals.cashCollectedPen),
                sub: `Por cobrar: ${formatPen(totals.arPendingPen)} (${openDebtorsCount} pendientes)`,
                cls: "text-bht-success",
              },
              {
                conceptId: "compra_mercaderia",
                title: "Compra Mercadería",
                value: formatPen(totals.merchandiseOutflowPen),
                sub: "Pagos a proveedores e inventario",
                cls: "text-bht-navy-mid",
              },
              {
                conceptId: "retiros_no_opex",
                title: "Retiros / No OpEx",
                value: formatPen(totals.nonOpexCapexDrainPen),
                sub: "Retiros socios y egresos ajenos",
                cls: "text-bht-danger",
              },
              {
                conceptId: "movimiento_neto_estimado",
                title: "Movimiento neto estimado",
                value: formatPen(totals.netCashFlowPen),
                sub: "Cobros − Merc. − Ruta − Admin − Retiros",
                cls:
                  totals.netCashFlowPen >= 0 ? "text-bht-navy-deep" : "text-bht-danger",
              },
              {
                conceptId: "depositos_internos",
                title: "Depósitos Internos",
                value: formatPen(totals.internalDepositsPen),
                sub: "Traslados entre cajas/bancos",
                cls: "text-bht-ink-strong",
              },
              {
                conceptId: "pre_ruta",
                title: "Pre-Ruta (Jun 23–25)",
                value: formatPen(totals.preRouteFoundationalOutflowPen),
                sub: "Inversión fundacional inicial",
                cls: "text-bht-navy-deep",
              },
            ] as const
          ).map((item) => (
            <ConceptCardButton
              key={item.title}
              padding="sm"
              className="text-xs"
              onClick={() =>
                setActiveConcept({
                  id: item.conceptId,
                  currentValue: item.value,
                  currentSubtext: item.sub,
                })
              }
            >
              <span className="block font-medium text-bht-ink-soft">{item.title}</span>
              <p className={`text-base font-semibold tabular-nums ${item.cls}`}>
                {item.value}
              </p>
              <span className="block text-xs text-bht-ink-muted tabular-nums">
                {item.sub}
              </span>
            </ConceptCardButton>
          ))}
        </div>
      </section>

      <ReportesMonthlyPnlCard
        pnlMonthly={pnlMonthly}
        totals={totals}
        onResetFilters={onResetFilters}
      />

      <ReportConceptModal
        concept={activeConcept}
        onClose={() => setActiveConcept(null)}
      />
    </div>
  );
}
