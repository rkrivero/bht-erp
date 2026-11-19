"use client";

import React from "react";
import { Badge, Card, EmptyState } from "@/components/ui/Primitives";
import { formatMonthLabel, formatPen } from "../types";
import { type ReportResumenDto, formatPct } from "./reportes-types";

interface ReportesResumenTabProps {
  data: ReportResumenDto;
  hasScopeFilter: boolean;
}

export default function ReportesResumenTab({
  data,
  hasScopeFilter,
}: ReportesResumenTabProps) {
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

      {/* Accrual P&L Executive Row */}
      <section aria-label="Rentabilidad devengada P&L" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <h3 className="text-sm font-bold text-bht-navy-deep">
            P&amp;L Gerencial (Rentabilidad Devengada: Venta − COGS − OpEx Ruta)
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
          <Card padding="md" className="space-y-1.5">
            <span className="text-xs font-medium text-bht-ink-soft">
              Ventas Totales ({totals.orderCount} ped.)
            </span>
            <p className="text-2xl font-semibold text-bht-navy-deep tabular-nums">
              {formatPen(totals.salesTotalPen)}
            </p>
            <span className="inline-flex items-center rounded-lg border border-bht-line-blue bg-bht-mist px-2 py-0.5 text-xs font-semibold text-bht-navy-deep tabular-nums">
              Cobertura de costo: {formatPct(totals.costCoveragePct)}
            </span>
          </Card>

          <Card padding="md" className="space-y-1.5">
            <span className="text-xs font-medium text-bht-ink-soft">
              Margen Bruto Real (s/ venta con costo)
            </span>
            <p className="text-2xl font-semibold text-bht-success tabular-nums">
              {formatPen(totals.grossMarginPen)}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-bht-ink-soft tabular-nums">
              <Badge tone="success">{formatPct(totals.grossMarginPct)} margen</Badge>
              <span>COGS: {formatPen(totals.cogsPen)}</span>
            </div>
          </Card>

          <Card padding="md" className="space-y-1.5">
            <span className="text-xs font-medium text-bht-ink-soft">
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
          </Card>

          <Card padding="md" className="space-y-1.5">
            <span className="text-xs font-medium text-bht-ink-soft">
              EBITDA Operativo Estimado
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
              {formatPct(totals.operatingEbitdaPct)} EBITDA
            </Badge>
          </Card>
        </div>
      </section>

      {/* Cash Flow Summary */}
      <section aria-label="Flujo de caja" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <h3 className="text-sm font-bold text-bht-navy-deep">
            Flujo de Caja Real (Cobros, Compras de Stock y Retiros)
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
          {[
            {
              title: "Cobrado Ventas",
              value: formatPen(totals.cashCollectedPen),
              sub: `Por cobrar: ${formatPen(totals.arPendingPen)} (${openDebtorsCount} open)`,
              cls: "text-bht-success",
            },
            {
              title: "Compra Mercadería",
              value: formatPen(totals.merchandiseOutflowPen),
              sub: "Pagos a proveedores e inventario",
              cls: "text-bht-navy-mid",
            },
            {
              title: "Retiros / No OpEx",
              value: formatPen(totals.nonOpexCapexDrainPen),
              sub: "Retiros socios y egresos ajenos",
              cls: "text-bht-danger",
            },
            {
              title: "Flujo Neto Caja",
              value: formatPen(totals.netCashFlowPen),
              sub: "Cobros − Merc. − Ruta − Retiros",
              cls:
                totals.netCashFlowPen >= 0 ? "text-bht-navy-deep" : "text-bht-danger",
            },
            {
              title: "Depósitos Internos",
              value: formatPen(totals.internalDepositsPen),
              sub: "Traslados entre cajas/bancos",
              cls: "text-bht-ink-strong",
            },
            {
              title: "Pre-Ruta (Jun 23–25)",
              value: formatPen(totals.preRouteFoundationalOutflowPen),
              sub: "Inversión fundacional inicial",
              cls: "text-bht-tone-4338ca",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-bht-line bg-white p-3 text-xs space-y-1"
            >
              <span className="block font-medium text-bht-ink-soft">{item.title}</span>
              <p className={`text-base font-semibold tabular-nums ${item.cls}`}>
                {item.value}
              </p>
              <span className="block text-xs text-bht-ink-muted tabular-nums">
                {item.sub}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Monthly P&L vs Cash Comparison Cards + Table */}
      <Card padding="md" className="space-y-4">
        <div>
          <h3
            id="pnl-monthly-heading"
            className="text-sm font-semibold text-bht-ink-strong sm:text-base"
          >
            Comparativo Mensual — Rentabilidad Devengada vs. Caja
          </h3>
          <p className="mt-0.5 text-xs text-bht-ink-soft">
            Separa lo ganado por ventas (EBITDA) de las salidas puntuales para comprar
            mercadería o retiros.
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
                    label: "EBITDA Op.",
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
                        {m.order_count} ped. · EBITDA:{" "}
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
              <table className="w-full text-left text-xs">
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
                      EBITDA Op.
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Cobrado
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Compra Stock
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Flujo Neto Caja
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
    </div>
  );
}
