"use client";

import React, { useState } from "react";
import { Badge, Button, Card, EmptyState } from "@/components/ui/Primitives";
import { formatRouteTripStatusEs } from "@/lib/labels-es";
import { formatPen } from "../types";
import { type ActiveReportConcept, ReportConceptModal } from "./ReportConceptModal";
import {
  type ReportComercialDto,
  formatInactivityTierEs,
  formatPct,
} from "./reportes-types";

interface ReportesComercialTabProps {
  data: ReportComercialDto;
}

export default function ReportesComercialTab({ data }: ReportesComercialTabProps) {
  const [activeConcept, setActiveConcept] = useState<ActiveReportConcept | null>(null);
  const {
    byZone,
    bySeller,
    routeProfitability,
    topCustomers,
    discountAudit,
    inactiveCustomers,
  } = data;

  const maxZoneSales = Math.max(1, ...byZone.map((z) => z.sales_total_pen));
  const maxSellerSales = Math.max(1, ...bySeller.map((s) => s.sales_total_pen));

  return (
    <div className="min-w-0 space-y-4">
      {/* Sales & Margin by Zone + by Seller */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card padding="md" className="space-y-3">
          <h3
            id="sales-zone-heading"
            className="text-base font-bold text-bht-ink-strong sm:text-lg"
          >
            Ventas y Margen por Zona ({byZone.length})
          </h3>
          {byZone.length === 0 ? (
            <EmptyState title="Sin ventas por zona en este filtro" />
          ) : (
            <>
              <div className="space-y-2 rounded-xl border border-bht-line bg-bht-paper/60 p-3">
                {byZone.slice(0, 6).map((z) => {
                  const pctWidth = Math.min(
                    100,
                    Math.max(4, (z.sales_total_pen / maxZoneSales) * 100)
                  );
                  const collectedShare =
                    z.sales_total_pen > 0
                      ? Math.min(
                          100,
                          Math.max(
                            0,
                            ((z.sales_total_pen - z.ar_pending_pen) /
                              z.sales_total_pen) *
                              100
                          )
                        )
                      : 100;
                  return (
                    <div key={`bar-${z.effective_zone}`} className="space-y-1 text-xs">
                      <div className="flex items-center justify-between gap-2 tabular-nums">
                        <span className="truncate font-semibold text-bht-ink-strong">
                          {z.effective_zone}{" "}
                          <span className="font-normal text-bht-ink-soft">
                            ({z.orders_count} ped. · Margen{" "}
                            {formatPct(z.gross_margin_pct)})
                          </span>
                        </span>
                        <span className="font-bold text-bht-navy-deep">
                          {formatPen(z.sales_total_pen)}
                        </span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-bht-line">
                        <div
                          className="flex h-full overflow-hidden rounded-full"
                          style={{ width: `${pctWidth}%` }}
                          aria-hidden="true"
                        >
                          <div
                            className="h-full bg-bht-navy-deep"
                            style={{ width: `${collectedShare}%` }}
                          />
                          <div
                            className="h-full bg-bht-danger-vivid"
                            style={{ width: `${100 - collectedShare}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center gap-4 pt-1 text-xs text-bht-ink-soft">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-bht-navy-deep" /> Cobrado
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-bht-danger-vivid" /> Por
                    cobrar
                  </span>
                </div>
              </div>
              <div
                tabIndex={0}
                role="region"
                aria-labelledby="sales-zone-heading"
                className="table-wrapper"
              >
              <table className="w-full text-left text-sm">
                <thead className="border-b border-bht-line bg-bht-paper text-xs font-semibold uppercase tracking-wide text-bht-ink-soft">
                  <tr>
                    <th scope="col" className="p-2">
                      Zona
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Ped. / Cli.
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Ventas
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Margen Bruto
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Por Cobrar
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bht-line">
                  {byZone.map((z) => (
                    <tr key={z.effective_zone} className="hover:bg-bht-paper">
                      <td className="p-2 font-semibold text-bht-ink-strong">
                        {z.effective_zone}
                      </td>
                      <td className="whitespace-nowrap p-2 text-right text-bht-ink-soft tabular-nums">
                        {z.orders_count} / {z.customers_count}
                      </td>
                      <td className="whitespace-nowrap p-2 text-right font-semibold tabular-nums">
                        {formatPen(z.sales_total_pen)}
                      </td>
                      <td className="whitespace-nowrap p-2 text-right font-semibold text-bht-success tabular-nums">
                        {formatPen(z.gross_margin_pen)} ({formatPct(z.gross_margin_pct)}
                        )
                      </td>
                      <td className="whitespace-nowrap p-2 text-right font-semibold text-bht-danger tabular-nums">
                        {formatPen(z.ar_pending_pen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </Card>

        <Card padding="md" className="space-y-3">
          <h3
            id="sales-seller-heading"
            className="text-base font-bold text-bht-ink-strong sm:text-lg"
          >
            Desempeño por Vendedor — Vendido vs. Cobrado ({bySeller.length})
          </h3>
          {bySeller.length === 0 ? (
            <EmptyState title="Sin ventas por vendedor en este filtro" />
          ) : (
            <>
              <div className="space-y-2 rounded-xl border border-bht-line bg-bht-paper/60 p-3">
                {bySeller.map((s) => {
                  const pctWidth = Math.min(
                    100,
                    Math.max(4, (s.sales_total_pen / maxSellerSales) * 100)
                  );
                  const collectedRate = Math.min(
                    100,
                    Math.max(0, s.collection_rate_pct ?? 0)
                  );
                  return (
                    <div
                      key={`bar-${s.seller_user_id ?? "unassigned"}-${s.seller_name}`}
                      className="space-y-1 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 tabular-nums">
                        <span className="truncate font-semibold text-bht-ink-strong">
                          {s.seller_name}{" "}
                          <span className="font-normal text-bht-ink-soft">
                            (Cobrado {formatPct(s.collection_rate_pct, 0)})
                          </span>
                        </span>
                        <span className="font-bold text-bht-navy-deep">
                          {formatPen(s.sales_total_pen)}
                        </span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-bht-line">
                        <div
                          className="flex h-full overflow-hidden rounded-full"
                          style={{ width: `${pctWidth}%` }}
                          aria-hidden="true"
                        >
                          <div
                            className="h-full bg-bht-success"
                            style={{ width: `${collectedRate}%` }}
                          />
                          <div
                            className="h-full bg-bht-tone-d97706"
                            style={{ width: `${100 - collectedRate}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div
                tabIndex={0}
                role="region"
                aria-labelledby="sales-seller-heading"
                className="table-wrapper"
              >
              <table className="w-full text-left text-sm">
                <thead className="border-b border-bht-line bg-bht-paper text-xs font-semibold uppercase tracking-wide text-bht-ink-soft">
                  <tr>
                    <th scope="col" className="p-2">
                      Vendedor
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Vendido
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Cobrado
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Margen %
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Desc. S/
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bht-line">
                  {bySeller.map((s) => (
                    <tr
                      key={`${s.seller_user_id ?? "unassigned"}-${s.seller_name}`}
                      className="hover:bg-bht-paper"
                    >
                      <td className="p-2">
                        <p className="font-semibold text-bht-ink-strong">
                          {s.seller_name}
                        </p>
                        <span className="text-bht-ink-soft tabular-nums">
                          {s.orders_count} ped.
                        </span>
                      </td>
                      <td className="whitespace-nowrap p-2 text-right font-semibold tabular-nums">
                        {formatPen(s.sales_total_pen)}
                      </td>
                      <td className="whitespace-nowrap p-2 text-right text-bht-success tabular-nums">
                        {formatPen(s.cash_collected_pen)} (
                        {formatPct(s.collection_rate_pct, 0)})
                      </td>
                      <td className="whitespace-nowrap p-2 text-right font-semibold text-bht-navy-deep tabular-nums">
                        {formatPct(s.gross_margin_pct)}
                      </td>
                      <td className="whitespace-nowrap p-2 text-right text-bht-warning tabular-nums">
                        {formatPen(s.discount_total_pen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </Card>
      </div>

      {/* Route Trip Profitability */}
      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3
              id="route-pnl-heading"
              className="text-base font-bold text-bht-ink-strong sm:text-lg"
            >
              Rentabilidad por Ruta / Viaje (Últimos {routeProfitability.length})
            </h3>
            <p className="mt-0.5 text-xs text-bht-ink-soft">
              Margen bruto generado en el viaje menos los gastos operativos de ruta.
              Meta de gasto de ruta &le; 8% sobre ventas.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            compact
            onClick={() =>
              setActiveConcept({
                id: "rentabilidad_ruta",
                currentValue: `${routeProfitability.length} viaje(s)`,
              })
            }
          >
            ¿Qué significa?
          </Button>
        </div>

        {routeProfitability.length === 0 ? (
          <EmptyState title="No hay viajes registrados para este filtro" />
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="route-pnl-heading"
            className="table-wrapper"
          >
            <table className="w-full text-left text-sm">
              <thead className="border-b border-bht-line bg-bht-paper text-xs font-semibold uppercase tracking-wide text-bht-ink-soft">
                <tr>
                  <th scope="col" className="p-2">
                    Viaje / Fecha
                  </th>
                  <th scope="col" className="p-2">
                    Zona / Chofer
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Ped.
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Ventas
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Margen Bruto
                  </th>
                  <th scope="col" className="p-2 text-right">
                    OpEx Ruta
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Contribución Neta
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bht-line">
                {routeProfitability.map((rp) => (
                  <tr key={rp.trip_id} className="hover:bg-bht-paper">
                    <td className="p-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-bht-navy-deep tabular-nums">
                          {rp.trip_code}
                        </span>
                        <Badge tone={rp.status === "OPEN" ? "warning" : "neutral"}>
                          {formatRouteTripStatusEs(rp.status)}
                        </Badge>
                      </div>
                      <span className="text-bht-ink-soft tabular-nums">
                        {rp.trip_date}
                      </span>
                    </td>
                    <td className="p-2">
                      <p className="font-medium text-bht-ink-strong">{rp.zone_name}</p>
                      <span className="text-bht-ink-soft">
                        {rp.driver_name || "Sin asignar"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap p-2 text-right tabular-nums">
                      {rp.order_count}
                    </td>
                    <td className="whitespace-nowrap p-2 text-right font-semibold tabular-nums">
                      {formatPen(rp.sales_total_pen)}
                    </td>
                    <td className="whitespace-nowrap p-2 text-right text-bht-success tabular-nums">
                      {formatPen(rp.gross_margin_pen)} ({formatPct(rp.gross_margin_pct)}
                      )
                    </td>
                    <td className="whitespace-nowrap p-2 text-right tabular-nums">
                      <span
                        className={
                          rp.route_opex_above_8pct_alert
                            ? "font-semibold text-bht-danger"
                            : "text-bht-warning"
                        }
                      >
                        {formatPen(rp.route_opex_pen)} ({formatPct(rp.route_opex_pct)})
                      </span>
                    </td>
                    <td
                      className={`whitespace-nowrap p-2 text-right font-semibold tabular-nums ${
                        rp.trip_net_contribution_pen >= 0
                          ? "text-bht-navy-deep"
                          : "text-bht-danger"
                      }`}
                    >
                      {formatPen(rp.trip_net_contribution_pen)} (
                      {formatPct(rp.trip_net_contribution_pct)})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Top Customers + Discount Audit & Inactive Customers */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card padding="md" className="space-y-3">
          <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
            Clientes Principales ({topCustomers.length})
          </h3>
          {topCustomers.length === 0 ? (
            <EmptyState title="Sin datos de clientes para este filtro" />
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {topCustomers.map((c, idx) => (
                <div
                  key={`${c.customer_name}-${idx}`}
                  className="rounded-xl border border-bht-line bg-bht-paper/60 p-3 text-xs space-y-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-bht-ink-strong">
                        {c.customer_name}
                      </p>
                      <span className="text-bht-ink-soft">
                        {c.effective_zone} · {c.orders_count} ped.
                      </span>
                    </div>
                    <strong className="text-bht-navy-deep tabular-nums">
                      {formatPen(c.total_sold_pen)}
                    </strong>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2 text-bht-ink-soft tabular-nums">
                    <span>Cobrado: {formatPen(c.total_paid_pen)}</span>
                    <span>Margen: {formatPen(c.gross_margin_pen)}</span>
                    <span
                      className={
                        c.total_due_pen > 0.05
                          ? "font-semibold text-bht-danger"
                          : "text-bht-success"
                      }
                    >
                      Deuda: {formatPen(c.total_due_pen)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card padding="md" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
                Auditoría de Descuentos en Ventas
              </h3>
              <p className="text-xs text-bht-ink-soft tabular-nums">
                {discountAudit.summary.discountedLinesCount} línea(s) · Total cedido:{" "}
                <strong>{formatPen(discountAudit.summary.totalDiscountPen)}</strong> ·{" "}
                Bajo piso mínimo: {discountAudit.summary.belowMinLinesCount}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              compact
              onClick={() =>
                setActiveConcept({
                  id: "auditoria_descuentos",
                  currentValue: formatPen(discountAudit.summary.totalDiscountPen),
                  currentSubtext: `${discountAudit.summary.discountedLinesCount} línea(s) con descuento · ${discountAudit.summary.belowMinLinesCount} bajo piso mínimo`,
                })
              }
            >
              ¿Qué significa?
            </Button>
          </div>

          {discountAudit.topLines.length === 0 ? (
            <EmptyState title="No se registran descuentos en el período seleccionado" />
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {discountAudit.topLines.map((dl) => (
                <div
                  key={dl.order_line_id}
                  className="rounded-xl border border-bht-line bg-bht-paper/60 p-3 text-xs space-y-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-bht-ink-strong">
                        {dl.sku} — {dl.raw_description}
                      </p>
                      <span className="text-bht-ink-soft">
                        {dl.order_code} · {dl.order_date} · {dl.customer_name}
                      </span>
                    </div>
                    <Badge tone={dl.below_min_price_flag ? "danger" : "warning"}>
                      -{formatPen(dl.discount_line_total_pen)}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-bht-ink-soft tabular-nums">
                    <span>
                      Base: {formatPen(dl.base_unit_price_pen)} → Vendido:{" "}
                      {formatPen(dl.unit_price_pen)} (×{dl.quantity})
                    </span>
                    {dl.below_min_price_flag && (
                      <strong className="text-bht-danger">Bajo piso</strong>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Inactive Customers Alert (>30/45/60d) */}
      <Card padding="md" className="space-y-3">
        <div>
          <h3
            id="inactive-customers-heading"
            className="text-base font-bold text-bht-ink-strong sm:text-lg"
          >
            Clientes Inactivos para Reactivación (&ge; 30 días sin pedido ·{" "}
            {inactiveCustomers.length})
          </h3>
          <p className="mt-0.5 text-xs text-bht-ink-soft">
            Ordenados desde mayor tiempo sin compra para seguimiento de vendedores.
          </p>
        </div>

        {inactiveCustomers.length === 0 ? (
          <EmptyState title="No hay clientes inactivos mayores a 30 días" />
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="inactive-customers-heading"
            className="table-wrapper"
          >
            <table className="w-full text-left text-sm">
              <thead className="border-b border-bht-line bg-bht-paper text-xs font-semibold uppercase tracking-wide text-bht-ink-soft">
                <tr>
                  <th scope="col" className="p-2">
                    Cliente
                  </th>
                  <th scope="col" className="p-2">
                    Zona / Teléfono
                  </th>
                  <th scope="col" className="p-2">
                    Último Pedido
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Inactividad
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Histórico Vendido
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Saldo Pend.
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bht-line">
                {inactiveCustomers.map((ic) => (
                  <tr key={ic.customer_party_id} className="hover:bg-bht-paper">
                    <td className="p-2 font-semibold text-bht-ink-strong">
                      {ic.customer_name}
                      <span className="block font-normal text-bht-ink-soft tabular-nums">
                        {ic.orders_count} pedido(s)
                      </span>
                    </td>
                    <td className="p-2 text-bht-ink-soft">
                      <span className="block text-bht-ink-strong">
                        {ic.effective_zone}
                      </span>
                      <span>{ic.phone || "Sin teléfono"}</span>
                    </td>
                    <td className="whitespace-nowrap p-2 tabular-nums text-bht-ink-soft">
                      {ic.last_order_date}
                    </td>
                    <td className="whitespace-nowrap p-2 text-right tabular-nums">
                      <Badge
                        tone={ic.inactivity_tier === "GT_60D" ? "danger" : "warning"}
                      >
                        {ic.days_since_last_order} d ·{" "}
                        {formatInactivityTierEs(ic.inactivity_tier)}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap p-2 text-right font-semibold tabular-nums">
                      {formatPen(ic.total_sold_pen)}
                    </td>
                    <td
                      className={`whitespace-nowrap p-2 text-right font-semibold tabular-nums ${
                        ic.total_due_pen > 0.05
                          ? "text-bht-danger"
                          : "text-bht-ink-soft"
                      }`}
                    >
                      {formatPen(ic.total_due_pen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ReportConceptModal
        concept={activeConcept}
        onClose={() => setActiveConcept(null)}
      />
    </div>
  );
}
