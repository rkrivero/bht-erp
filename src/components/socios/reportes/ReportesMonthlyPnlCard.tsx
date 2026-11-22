"use client";

import { Badge, Card, EmptyState } from "@/components/ui/Primitives";
import { formatMonthLabel, formatPen } from "../types";
import { type ReportResumenDto, formatPct } from "./reportes-types";

interface ReportesMonthlyPnlCardProps {
  pnlMonthly: ReportResumenDto["pnlMonthly"];
  totals: ReportResumenDto["totals"];
}

export default function ReportesMonthlyPnlCard({
  pnlMonthly,
  totals,
}: ReportesMonthlyPnlCardProps) {
  const maxSalesBar = Math.max(
    1,
    ...pnlMonthly.map((m) => Math.max(m.sales_total_pen, m.gross_margin_pen))
  );
  const maxCashBar = Math.max(
    1,
    ...pnlMonthly.flatMap((m) => [
      m.cash_collected_pen,
      m.merchandise_outflow_pen,
      m.non_opex_capex_drain_pen,
    ])
  );

  return (
    <Card padding="md" className="space-y-4">
      <div>
        <h3
          id="pnl-monthly-heading"
          className="text-base font-bold text-bht-ink-strong sm:text-lg"
        >
          Comparativo mensual de ventas y movimientos registrados
        </h3>
        <p className="mt-0.5 text-xs text-bht-ink-soft">
          Compara ventas con costo conocido, contribución de ruta y salidas registradas.
          Las cifras de caja requieren conciliación.
        </p>
      </div>

      {pnlMonthly.length === 0 ? (
        <EmptyState title="No hay movimientos en el período y filtros seleccionados" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4">
            {pnlMonthly.map((m) => {
              const salesBars = [
                {
                  label: "Ventas Totales",
                  val: m.sales_total_pen,
                  sub: `${m.order_count} ped.`,
                  color: "bg-bht-navy-deep",
                },
                {
                  label: "Margen Bruto",
                  val: Math.max(0, m.gross_margin_pen),
                  sub: formatPct(m.gross_margin_pct),
                  color: "bg-bht-success",
                },
                {
                  label: "Contribución Ruta",
                  val: Math.max(0, m.operating_ebitda_pen),
                  sub: formatPct(m.operating_ebitda_pct),
                  color: "bg-bht-navy-mid",
                },
                {
                  label: "Resultado Operativo",
                  val: Math.max(0, m.operating_result_pen),
                  sub: formatPct(m.operating_result_pct),
                  color: "bg-bht-cobalt",
                },
              ];
              const cashBars = [
                {
                  label: "Cobrado en Efectivo",
                  val: m.cash_collected_pen,
                  color: "bg-bht-success-strong",
                },
                {
                  label: "Pagos Mercadería",
                  val: m.merchandise_outflow_pen,
                  color: "bg-bht-warning",
                },
                {
                  label: "OpEx Ruta + Admin",
                  val: m.route_opex_pen + m.admin_opex_pen,
                  color: "bg-bht-ink-warm",
                },
                {
                  label: "Retiros / No OpEx",
                  val: m.non_opex_capex_drain_pen,
                  color: "bg-bht-danger-vivid",
                },
              ];
              return (
                <div
                  key={m.period_month}
                  className="rounded-2xl border border-bht-line bg-bht-paper/70 p-4 space-y-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bht-line pb-2.5">
                    <div>
                      <span className="text-sm font-extrabold uppercase tracking-wide text-bht-navy-deep">
                        {formatMonthLabel(m.period_month)}
                      </span>
                      <span className="ml-2 text-xs font-medium text-bht-ink-soft tabular-nums">
                        ({m.order_count} pedidos)
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
                      <Badge tone={m.operating_result_pen >= 0 ? "success" : "danger"}>
                        Resultado Op.: {formatPen(m.operating_result_pen)} (
                        {formatPct(m.operating_result_pct)})
                      </Badge>
                      <Badge tone={m.net_cash_flow_pen >= 0 ? "brand" : "warning"}>
                        Flujo neto: {formatPen(m.net_cash_flow_pen)}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {/* Panel 1: Commercial Profitability */}
                    <div className="space-y-2 rounded-xl border border-bht-line bg-white p-3">
                      <p className="text-xs font-bold uppercase tracking-[0.06em] text-bht-steel">
                        1. Rentabilidad Comercial (Devengado)
                      </p>
                      {salesBars.map((b) => {
                        const pct = Math.min(
                          100,
                          Math.max(b.val > 0 ? 3 : 0, (b.val / maxSalesBar) * 100)
                        );
                        return (
                          <div key={b.label} className="space-y-1">
                            <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
                              <span className="font-medium text-bht-ink-strong">
                                {b.label}{" "}
                                <span className="text-bht-ink-soft">({b.sub})</span>
                              </span>
                              <span className="font-bold text-bht-navy-deep">
                                {formatPen(b.val)}
                              </span>
                            </div>
                            <div className="h-3 w-full overflow-hidden rounded-full bg-bht-paper-alt">
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

                    {/* Panel 2: Cash Movements */}
                    <div className="space-y-2 rounded-xl border border-bht-line bg-white p-3">
                      <p className="text-xs font-bold uppercase tracking-[0.06em] text-bht-steel">
                        2. Flujo de Efectivo Registrado (Caja)
                      </p>
                      {cashBars.map((b) => {
                        const pct = Math.min(
                          100,
                          Math.max(b.val > 0 ? 3 : 0, (b.val / maxCashBar) * 100)
                        );
                        return (
                          <div key={b.label} className="space-y-1">
                            <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
                              <span className="font-medium text-bht-ink-strong">
                                {b.label}
                              </span>
                              <span className="font-bold text-bht-ink-strong">
                                {formatPen(b.val)}
                              </span>
                            </div>
                            <div className="h-3 w-full overflow-hidden rounded-full bg-bht-paper-alt">
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
                    Admin OpEx
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Resultado Op.
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
                    <td className="p-2 text-right text-bht-ink-soft tabular-nums">
                      {formatPen(m.admin_opex_pen)}
                    </td>
                    <td
                      className={`p-2 text-right font-semibold tabular-nums ${
                        m.operating_result_pen >= 0
                          ? "text-bht-navy-deep"
                          : "text-bht-danger"
                      }`}
                    >
                      {formatPen(m.operating_result_pen)}
                    </td>
                    <td className="p-2 text-right text-bht-success tabular-nums">
                      {formatPen(m.cash_collected_pen)}
                    </td>
                    <td className="p-2 text-right text-bht-navy-mid tabular-nums">
                      {formatPen(m.merchandise_outflow_pen)}
                    </td>
                    <td
                      className={`p-2 text-right font-semibold tabular-nums ${
                        m.net_cash_flow_pen >= 0 ? "text-bht-success" : "text-bht-danger"
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
                    <td className="p-2 text-right text-bht-ink-soft">
                      {formatPen(totals.adminOpexPen)}
                    </td>
                    <td
                      className={`p-2 text-right ${
                        totals.operatingResultPen >= 0
                          ? "text-bht-navy-deep"
                          : "text-bht-danger"
                      }`}
                    >
                      {formatPen(totals.operatingResultPen)}
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
  );
}
