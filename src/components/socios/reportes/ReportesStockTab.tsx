"use client";

import React, { useDeferredValue, useMemo, useState } from "react";
import { CloseIcon, EditIcon, PlusIcon, SearchIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLASS,
} from "@/components/ui/Primitives";
import { formatFulfillmentModeEs, formatMarginStatusEs } from "@/lib/labels-es";
import { formatPen } from "../types";
import {
  type ReportStockDto,
  formatDays,
  formatDeadStockStatusEs,
  formatPct,
} from "./reportes-types";

interface ReportesStockTabProps {
  data: ReportStockDto;
  onGoToPurchaseProduct: (productId: number) => void;
  onGoToEditProduct: (sku: string) => void;
}

export default function ReportesStockTab({
  data,
  onGoToPurchaseProduct,
  onGoToEditProduct,
}: ReportesStockTabProps) {
  const [skuSearch, setSkuSearch] = useState("");
  const deferredSearch = useDeferredValue(skuSearch);

  const filteredTopSkus = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return data.topSkus;
    return data.topSkus.filter(
      (s) => s.product_name.toLowerCase().includes(q) || s.sku.toLowerCase().includes(q)
    );
  }, [data.topSkus, deferredSearch]);

  const {
    valuationSummary,
    fulfillmentMix,
    replenishmentAlerts,
    deadAndSlowStock,
    onDemandCandidates,
    marginRiskSkus,
  } = data;

  return (
    <div className="min-w-0 space-y-4">
      {/* Valuation & Dead Stock KPI Row */}
      <section
        aria-label="Indicadores de valorización de stock"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Card padding="md" className="space-y-1.5">
          <span className="text-xs font-medium text-bht-ink-soft">
            Valorización Inventario (Stock Positivo)
          </span>
          <p className="text-2xl font-semibold text-bht-navy-deep tabular-nums">
            {formatPen(valuationSummary.totalValuationPen)}
          </p>
          <span className="block text-xs text-bht-ink-soft tabular-nums">
            {valuationSummary.positiveStockSkuCount} SKU(s) con stock ·{" "}
            {valuationSummary.positiveStockMissingCostCount} sin costo
          </span>
        </Card>

        <Card padding="md" className="space-y-1.5">
          <span className="text-xs font-medium text-bht-ink-soft">
            Stock Muerto (&ge; 90 días sin venta)
          </span>
          <p className="text-2xl font-semibold text-bht-warning tabular-nums">
            {formatPen(valuationSummary.deadStock90dPen)}
          </p>
          <span className="block text-xs text-bht-ink-soft tabular-nums">
            {valuationSummary.deadStock90dCount} SKU(s) &ge;90d · Lento 60–89d:{" "}
            {valuationSummary.slowStock60dCount} (
            {formatPen(valuationSummary.slowStock60dPen)})
          </span>
        </Card>

        <Card padding="md" className="space-y-1.5">
          <span className="text-xs font-medium text-bht-ink-soft">
            Reposición Urgente (&le; 14d cobertura)
          </span>
          <p className="text-2xl font-semibold text-bht-navy-mid tabular-nums">
            {valuationSummary.lowCoverageCount}
          </p>
          <span className="block text-xs text-bht-ink-soft tabular-nums">
            Saldos negativos históricos: {valuationSummary.negativeStockSkuCount}
          </span>
        </Card>

        <Card
          tone={
            valuationSummary.missingCostSoldSkuCount +
              valuationSummary.lowMarginSkuCount >
            0
              ? "warning"
              : "default"
          }
          padding="md"
          className="space-y-1.5"
        >
          <span className="text-xs font-medium text-bht-ink-soft">
            Riesgo de Margen (&lt; 20% o sin costo)
          </span>
          <p className="text-2xl font-semibold text-bht-danger tabular-nums">
            {valuationSummary.lowMarginSkuCount +
              valuationSummary.missingCostSoldSkuCount}
          </p>
          <span className="block text-xs text-bht-ink-soft tabular-nums">
            {valuationSummary.lowMarginSkuCount} margen &lt;20% ·{" "}
            {valuationSummary.missingCostSoldSkuCount} vendidos sin costo
          </span>
        </Card>
      </section>

      {/* Mix STOCKED vs ON_DEMAND + ON_DEMAND Promotion Candidates */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card padding="md" className="space-y-3">
          <h3 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
            Mix Inventario: Stock Permanente vs. Bajo Pedido
          </h3>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {fulfillmentMix.map((fm) => (
              <div
                key={fm.fulfillment_mode}
                className="rounded-xl border border-bht-line bg-bht-paper/60 p-3 text-xs space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={fm.fulfillment_mode === "STOCKED" ? "brand" : "indigo"}>
                    {formatFulfillmentModeEs(fm.fulfillment_mode)}
                  </Badge>
                  <span className="text-bht-ink-soft tabular-nums">
                    {fm.sku_count} SKUs
                  </span>
                </div>
                <p className="text-base font-semibold text-bht-ink-strong tabular-nums">
                  Stock: {formatPen(fm.valuation_pen)}
                </p>
                <p className="text-bht-ink-soft tabular-nums">
                  Ventas acumuladas: {formatPen(fm.revenue_total_pen)} (
                  {Number(fm.units_sold_total).toFixed(0)} u.)
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card padding="md" className="space-y-3">
          <h3 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
            Candidatos <code>ON_DEMAND</code> Frecuentes para Pasar a Stock (
            {onDemandCandidates.length})
          </h3>
          {onDemandCandidates.length === 0 ? (
            <EmptyState title="Sin ventas ON_DEMAND registradas" />
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {onDemandCandidates.slice(0, 12).map((item) => (
                <div
                  key={item.product_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bht-line bg-bht-paper/60 p-2.5 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-bht-ink-strong">
                      {item.product_name}
                    </p>
                    <span className="text-bht-ink-soft tabular-nums">
                      {item.sku} · {item.order_frequency_total} pedido(s) ·{" "}
                      {Number(item.units_sold_total)} u. ·{" "}
                      {formatPen(item.revenue_total_pen)}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onGoToEditProduct(item.sku)}
                  >
                    <EditIcon className="h-3.5 w-3.5" />
                    Editar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Replenishment by Days of Coverage + Dead Stock 60/90d */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card padding="md" className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
              Reposición por Días de Cobertura ({replenishmentAlerts.length})
            </h3>
            <p className="mt-0.5 text-xs text-bht-ink-soft">
              Prioriza SKUs con alta rotación reciente en últimos 90 días.
            </p>
          </div>
          {replenishmentAlerts.length === 0 ? (
            <EmptyState title="No hay SKUs STOCKED en riesgo de cobertura" />
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {replenishmentAlerts.map((item) => (
                <div
                  key={item.product_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bht-line bg-bht-paper/60 p-2.5 text-xs sm:flex-nowrap"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-semibold text-bht-ink-strong">
                        {item.product_name}
                      </p>
                      <Badge tone={item.stock_on_hand <= 0 ? "danger" : "warning"}>
                        {formatDays(item.days_of_coverage)}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-bht-ink-soft tabular-nums">
                      {item.sku} · Stock: <strong>{item.stock_on_hand}</strong>{" "}
                      {item.unit_of_measure} · 90d: {item.units_sold_90d} u. · Costo:{" "}
                      {item.ref_cost_pen !== null
                        ? formatPen(item.ref_cost_pen)
                        : "Sin costo"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => onGoToPurchaseProduct(item.product_id)}
                    className="flex-shrink-0"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    Comprar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card padding="md" className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
              Capital Inmovilizado — Stock Lento y Muerto ({deadAndSlowStock.length})
            </h3>
            <p className="mt-0.5 text-xs text-bht-ink-soft">
              Productos con stock positivo y 60+ o 90+ días sin venta.
            </p>
          </div>
          {deadAndSlowStock.length === 0 ? (
            <EmptyState title="No hay stock lento ni inmovilizado mayor a 60 días" />
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {deadAndSlowStock.map((item) => (
                <div
                  key={item.product_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bht-line bg-bht-paper/60 p-2.5 text-xs sm:flex-nowrap"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-semibold text-bht-ink-strong">
                        {item.product_name}
                      </p>
                      <Badge
                        tone={
                          item.dead_stock_status === "DEAD_90D" ? "danger" : "warning"
                        }
                      >
                        {formatDeadStockStatusEs(item.dead_stock_status)}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-bht-ink-soft tabular-nums">
                      {item.sku} · Stock: {item.positive_stock_qty} · Valor:{" "}
                      <strong className="text-bht-ink-strong">
                        {formatPen(item.valuation_pen)}
                      </strong>{" "}
                      · Últ. venta: {item.last_sale_date || "Sin ventas"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onGoToEditProduct(item.sku)}
                    className="flex-shrink-0"
                  >
                    <EditIcon className="h-3.5 w-3.5" />
                    Editar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Margin Risk SKUs */}
      {marginRiskSkus.length > 0 && (
        <Card tone="warning" padding="md" className="space-y-3">
          <h3 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
            SKUs con Margen &lt; 20% o Sin Costo ({marginRiskSkus.length})
          </h3>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {marginRiskSkus.map((m) => (
              <div
                key={m.sku}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bht-line bg-white p-3 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Badge tone={m.missing_cost_alert ? "danger" : "warning"}>
                      {m.missing_cost_alert ? "Sin costo" : "Margen < 20%"}
                    </Badge>
                    <span className="text-bht-ink-muted">{m.sku}</span>
                  </div>
                  <p className="mt-1 font-semibold text-bht-ink-strong">
                    {m.product_name}
                  </p>
                  <span className="text-bht-ink-soft tabular-nums">
                    Ventas: {formatPen(m.total_revenue_pen)} · Margen:{" "}
                    {formatPct(m.real_gross_margin_pct)}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onGoToEditProduct(m.sku)}
                >
                  <EditIcon className="h-3.5 w-3.5" />
                  Editar
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Top SKUs Table with Search */}
      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3
            id="stock-top-skus-heading"
            className="text-sm font-semibold text-bht-ink-strong sm:text-base"
          >
            Productos Líderes por Ingresos y Margen Real ({filteredTopSkus.length})
          </h3>
          <div className="relative w-full sm:w-64">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-bht-ink-muted">
              <SearchIcon className="h-3.5 w-3.5" />
            </span>
            <input
              type="text"
              value={skuSearch}
              onChange={(e) => setSkuSearch(e.target.value)}
              aria-label="Filtrar productos líderes por código o nombre"
              placeholder="Filtrar SKU o producto..."
              className={`${INPUT_CLASS} pl-9 pr-8`}
            />
            {skuSearch && (
              <button
                type="button"
                data-compact="true"
                aria-label="Limpiar filtro de productos líderes"
                onClick={() => setSkuSearch("")}
                className="absolute inset-y-0 right-2 flex items-center text-bht-ink-muted hover:text-bht-ink-strong cursor-pointer"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {filteredTopSkus.length === 0 ? (
          <EmptyState title="No hay productos que coincidan con la búsqueda" />
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="stock-top-skus-heading"
            className="table-wrapper"
          >
            <table className="w-full text-left text-xs">
              <thead className="border-b border-bht-line bg-bht-paper text-xs font-semibold uppercase tracking-wide text-bht-ink-soft">
                <tr>
                  <th scope="col" className="p-2">
                    SKU / Producto
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Stock
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Cobertura
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Ingresos
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Margen
                  </th>
                  <th scope="col" className="p-2">
                    Estado
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Acción
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bht-line">
                {filteredTopSkus.map((sku) => {
                  const statusCode = sku.missing_cost_alert
                    ? "SIN_COSTO"
                    : sku.low_margin_below_20pct_alert
                      ? "BAJO_20%"
                      : "OK_20%+";
                  return (
                    <tr key={sku.sku} className="hover:bg-bht-paper">
                      <td className="p-2">
                        <p className="font-medium text-bht-ink-strong">
                          {sku.product_name}
                        </p>
                        <span className="text-bht-ink-muted">
                          {sku.sku} · {sku.total_units_sold} u. vendidas
                        </span>
                      </td>
                      <td className="whitespace-nowrap p-2 text-right tabular-nums">
                        {sku.stock_on_hand}
                      </td>
                      <td className="whitespace-nowrap p-2 text-right text-bht-ink-soft tabular-nums">
                        {formatDays(sku.days_of_coverage)}
                      </td>
                      <td className="whitespace-nowrap p-2 text-right font-semibold tabular-nums">
                        {formatPen(sku.total_revenue_pen)}
                      </td>
                      <td
                        className={`whitespace-nowrap p-2 text-right font-semibold tabular-nums ${
                          sku.missing_cost_alert
                            ? "text-bht-danger"
                            : sku.low_margin_below_20pct_alert
                              ? "text-bht-warning"
                              : "text-bht-success"
                        }`}
                      >
                        {sku.real_gross_margin_pen !== null
                          ? `${formatPen(sku.real_gross_margin_pen)} (${formatPct(
                              sku.real_gross_margin_pct
                            )})`
                          : "-"}
                      </td>
                      <td className="whitespace-nowrap p-2">
                        <Badge tone="neutral">{formatMarginStatusEs(statusCode)}</Badge>
                      </td>
                      <td className="whitespace-nowrap p-2 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onGoToEditProduct(sku.sku)}
                        >
                          <EditIcon className="h-3.5 w-3.5" />
                          Editar
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
