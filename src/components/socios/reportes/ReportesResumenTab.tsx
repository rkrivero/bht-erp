"use client";

import React, { useState } from "react";
import { Badge, Card, EmptyState } from "@/components/ui/Primitives";
import { formatMonthLabel, formatPen } from "../types";
import {
  type ActiveReportConcept,
  ConceptCardButton,
  ReportConceptModal,
} from "./ReportConceptModal";
import { type ReportResumenDto, formatPct } from "./reportes-types";

interface ReportesResumenTabProps {
  data: ReportResumenDto;
  hasScopeFilter: boolean;
}

export default function ReportesResumenTab({
  data,
  hasScopeFilter,
}: ReportesResumenTabProps) {
  const [activeConcept, setActiveConcept] = useState<ActiveReportConcept | null>(null);
  const { totals, pnlMonthly, momComparison, openDebtorsCount } = data;
  const maxBar = Math.max(
    1,
    ...pnlMonthly.flatMap((m) => [
      m.sales_total_pen,
      m.gross_margin_pen,
      m.operating_ebitda_pen,
      m.cash_collected_pen,
      m.merchandise_outflow_pen,
      m.route_opex_pen,
      m.non_opex_capex_drain_pen,
      m.pre_route_foundational_outflow_pen,
    ])
  );

  return (
    <div className="min-w-0 space-y-4">
      {hasScopeFilter && (
        <Card tone="brand" padding="sm" className="text-xs text-bht-ink-strong">
          <strong>Vista segmentada por Zona / Vendedor:</strong> Las compras de
          mercadería, retiros e inversión pre-ruta corresponden a caja global y no se
          asignan a un vendedor individual.
        </Card>
      )}

      <Card tone="warning" padding="sm" className="text-xs text-bht-ink-strong">
        <strong>Lectura responsable:</strong> este resumen usa costos y movimientos
        disponibles en el ERP. No reemplaza un estado de resultados ni una conciliación
        bancaria completa.
      </Card>

      {/* Partial operating result */}
      <section aria-label="Resultado comercial parcial" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <h3 className="text-base sm:text-lg font-bold text-bht-navy-deep">
            Resultado comercial parcial
          </h3>
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ConceptCardButton
            onClick={() =>
              setActiveConcept({
                id: "ventas_totales",
                currentValue: formatPen(totals.salesTotalPen),
                currentSubtext: `${totals.orderCount} pedido(s) · Cobertura de costo: ${formatPct(totals.costCoveragePct)}`,
              })
            }
          >
            <span className="text-sm font-semibold text-bht-ink-soft">
              Ventas Totales ({totals.orderCount} ped.)
            </span>
            <p className="text-2xl font-semibold text-bht-navy-deep tabular-nums">
              {formatPen(totals.salesTotalPen)}
            </p>
            <span className="inline-flex items-center rounded-lg border border-bht-line-blue bg-bht-mist px-2 py-0.5 text-xs font-semibold text-bht-navy-deep tabular-nums">
              Cobertura de costo: {formatPct(totals.costCoveragePct)}
            </span>
          </ConceptCardButton>

          <ConceptCardButton
            onClick={() =>
              setActiveConcept({
                id: "margen_bruto_con_costo",
                currentValue: formatPen(totals.grossMarginPen),
                currentSubtext: `${formatPct(totals.grossMarginPct)} margen · COGS: ${formatPen(totals.cogsPen)}`,
              })
            }
          >
            <span className="text-sm font-semibold text-bht-ink-soft">
              Margen bruto sobre ventas con costo
            </span>
            <p className="text-2xl font-semibold text-bht-success tabular-nums">
              {formatPen(totals.grossMarginPen)}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-bht-ink-soft tabular-nums">
              <Badge tone="success">{formatPct(totals.grossMarginPct)} margen</Badge>
              <span>COGS: {formatPen(totals.cogsPen)}</span>
            </div>
          </ConceptCardButton>

          <ConceptCardButton
            onClick={() =>
              setActiveConcept({
                id: "gastos_operativos_ruta",
                currentValue: formatPen(totals.routeOpexPen),
                currentSubtext: `${formatPct(totals.routeOpexPct)} sobre ventas (Meta ≤ 8%)`,
              })
            }
          >
            <span className="text-sm font-semibold text-bht-ink-soft">
              Gastos Operativos de Ruta (OpEx)
            </span>
            <p className="text-2xl font-semibold text-bht-warning tabular-nums">
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
            onClick={() =>
              setActiveConcept({
                id: "contribucion_ruta",
                currentValue: formatPen(totals.operatingEbitdaPen),
                currentSubtext: `${formatPct(totals.operatingEbitdaPct)} sobre venta con costo`,
              })
            }
          >
            <span className="text-sm font-semibold text-bht-ink-soft">
              Contribución después de gastos de ruta
            </span>
            <p
              className={`text-2xl font-semibold tabular-nums ${
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
        </div>
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
                title: "Pagado en pedidos",
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
                sub: "Cobros − Merc. − Ruta − Retiros",
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
                cls: "text-bht-tone-4338ca",
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

      {/* Monthly P&L vs Cash Comparison Cards + Table */}
      <Card padding="md" className="space-y-4">
        <div>
          <h3
            id="pnl-monthly-heading"
            className="text-base font-bold text-bht-ink-strong sm:text-lg"
          >
            Comparativo mensual de ventas y movimientos registrados
          </h3>
          <p className="mt-0.5 text-xs text-bht-ink-soft">
            Compara ventas con costo conocido, contribución de ruta y salidas
            registradas. Las cifras de caja requieren conciliación.
          </p>
        </div>

        {pnlMonthly.length === 0 ? (
          <EmptyState title="No hay movimientos en el período y filtros seleccionados" />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {pnlMonthly.map((m) => {
                const bars = [
                  {
                    label: "Ventas",
                    val: m.sales_total_pen,
                    color: "bg-bht-navy-deep",
                  },
                  {
                    label: "Margen Bruto",
                    val: Math.max(0, m.gross_margin_pen),
                    color: "bg-bht-success",
                  },
                  {
                    label: "Contribución ruta",
                    val: Math.max(0, m.operating_ebitda_pen),
                    color: "bg-bht-navy-mid",
                  },
                  {
                    label: "Cobrado",
                    val: m.cash_collected_pen,
                    color: "bg-bht-tone-047857",
                  },
                  {
                    label: "Mercadería",
                    val: m.merchandise_outflow_pen,
                    color: "bg-bht-tone-d97706",
                  },
                  {
                    label: "No Operativos",
                    val: m.non_opex_capex_drain_pen,
                    color: "bg-bht-danger-vivid",
                  },
                ];
                return (
                  <div
                    key={m.period_month}
                    className="rounded-xl border border-bht-line bg-bht-paper/60 p-3.5 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-bht-ink-strong">
                        {formatMonthLabel(m.period_month)}
                      </span>
                      <span className="text-xs font-medium text-bht-ink-soft tabular-nums">
                        {m.order_count} ped. · Contribución:{" "}
                        <strong
                          className={
                            m.operating_ebitda_pen >= 0
                              ? "text-bht-success"
                              : "text-bht-danger"
                          }
                        >
                          {formatPen(m.operating_ebitda_pen)} (
                          {formatPct(m.operating_ebitda_pct)})
                        </strong>
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {bars.map((b) => {
                        const pct = Math.min(
                          100,
                          Math.max(b.val > 0 ? 2 : 0, (b.val / maxBar) * 100)
                        );
                        return (
                          <div key={b.label} className="space-y-0.5">
                            <div className="flex justify-between text-xs tabular-nums">
                              <span className="text-bht-ink-soft">{b.label}</span>
                              <span className="font-semibold text-bht-ink-strong">
                                {formatPen(b.val)}
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-bht-line">
                              <div
                                className={`h-full rounded-full ${b.color}`}
                                style={{ width: `${pct}%` }}
                                aria-hidden="true"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              tabIndex={0}
              role="region"
              aria-labelledby="pnl-monthly-heading"
              className="table-wrapper hidden md:block"
            >
              <table className="w-full text-left text-sm">
                <thead className="border-b border-bht-line bg-bht-paper text-xs font-semibold uppercase tracking-wide text-bht-ink-soft">
                  <tr>
                    <th scope="col" className="p-2">
                      Mes
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Ventas
                    </th>
                    <th scope="col" className="p-2 text-right">
                      COGS
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Margen %
                    </th>
                    <th scope="col" className="p-2 text-right">
                      OpEx Ruta
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Contribución ruta
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Cobrado
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Compra Stock
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Movimiento neto estimado
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bht-line">
                  {pnlMonthly.map((m) => (
                    <tr key={m.period_month} className="hover:bg-bht-paper">
                      <td className="p-2 font-semibold text-bht-ink-strong">
                        {formatMonthLabel(m.period_month)}
                      </td>
                      <td className="p-2 text-right font-semibold tabular-nums">
                        {formatPen(m.sales_total_pen)}
                      </td>
                      <td className="p-2 text-right text-bht-ink-soft tabular-nums">
                        {formatPen(m.cogs_pen)}
                      </td>
                      <td className="p-2 text-right font-semibold text-bht-success tabular-nums">
                        {formatPct(m.gross_margin_pct)}
                      </td>
                      <td className="p-2 text-right text-bht-warning tabular-nums">
                        {formatPen(m.route_opex_pen)}
                      </td>
                      <td
                        className={`p-2 text-right font-semibold tabular-nums ${
                          m.operating_ebitda_pen >= 0
                            ? "text-bht-navy-deep"
                            : "text-bht-danger"
                        }`}
                      >
                        {formatPen(m.operating_ebitda_pen)}
                      </td>
                      <td className="p-2 text-right text-bht-success tabular-nums">
                        {formatPen(m.cash_collected_pen)}
                      </td>
                      <td className="p-2 text-right text-bht-navy-mid tabular-nums">
                        {formatPen(m.merchandise_outflow_pen)}
                      </td>
                      <td
                        className={`p-2 text-right font-semibold tabular-nums ${
                          m.net_cash_flow_pen >= 0
                            ? "text-bht-success"
                            : "text-bht-danger"
                        }`}
                      >
                        {formatPen(m.net_cash_flow_pen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {pnlMonthly.length > 1 && (
                  <tfoot className="border-t-2 border-bht-line-stronger bg-bht-paper text-xs font-semibold tabular-nums">
                    <tr>
                      <td className="p-2 text-bht-ink-strong">TOTAL</td>
                      <td className="p-2 text-right">
                        {formatPen(totals.salesTotalPen)}
                      </td>
                      <td className="p-2 text-right text-bht-ink-soft">
                        {formatPen(totals.cogsPen)}
                      </td>
                      <td className="p-2 text-right text-bht-success">
                        {formatPct(totals.grossMarginPct)}
                      </td>
                      <td className="p-2 text-right text-bht-warning">
                        {formatPen(totals.routeOpexPen)}
                      </td>
                      <td className="p-2 text-right text-bht-navy-deep">
                        {formatPen(totals.operatingEbitdaPen)}
                      </td>
                      <td className="p-2 text-right text-bht-success">
                        {formatPen(totals.cashCollectedPen)}
                      </td>
                      <td className="p-2 text-right text-bht-navy-mid">
                        {formatPen(totals.merchandiseOutflowPen)}
                      </td>
                      <td
                        className={`p-2 text-right ${
                          totals.netCashFlowPen >= 0
                            ? "text-bht-success"
                            : "text-bht-danger"
                        }`}
                      >
                        {formatPen(totals.netCashFlowPen)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </Card>

      <ReportConceptModal
        concept={activeConcept}
        onClose={() => setActiveConcept(null)}
      />
    </div>
  );
}
