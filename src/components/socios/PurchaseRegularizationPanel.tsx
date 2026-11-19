"use client";

import { useCallback, useDeferredValue, useEffect, useState } from "react";
import { CloseIcon, DownloadIcon, PlusIcon, SearchIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLASS,
  SegmentedControl,
} from "@/components/ui/Primitives";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import type {
  RegularizationMode,
  UnpurchasedRegularizationResult,
} from "@/lib/services/purchase-regularization";
import { formatDatePe, formatPen } from "./types";

interface PurchaseRegularizationPanelProps {
  refreshKey?: number;
  onGoToPurchaseProduct?: (target: { productId: number; quantity?: number }) => void;
  onFeedback: (msg: string, isError?: boolean) => void;
}

export default function PurchaseRegularizationPanel({
  refreshKey = 0,
  onGoToPurchaseProduct,
  onFeedback,
}: PurchaseRegularizationPanelProps) {
  const [mode, setMode] = useState<RegularizationMode>("sold");
  const [supplier, setSupplier] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [data, setData] = useState<UnpurchasedRegularizationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const loadRegularization = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams({ mode });
      if (supplier) params.set("supplier", supplier);
      if (deferredSearch.trim()) params.set("search", deferredSearch.trim());
      const res = await fetchJson<UnpurchasedRegularizationResult>(
        `/api/purchases/regularization?${params.toString()}`,
        { cache: "no-store" }
      );
      setData(res);
    } catch (error) {
      setErrorMsg(
        error instanceof ApiClientError
          ? error.message
          : "No se pudo cargar el listado por regularizar compra."
      );
    } finally {
      setLoading(false);
    }
  }, [mode, supplier, deferredSearch]);

  useEffect(() => {
    void loadRegularization();
  }, [loadRegularization, refreshKey]);

  async function handleExportExcel() {
    if (exporting) return;
    setExporting(true);
    try {
      const params = new URLSearchParams({ mode, format: "xlsx" });
      if (supplier) params.set("supplier", supplier);
      if (deferredSearch.trim()) params.set("search", deferredSearch.trim());
      const res = await fetch(`/api/purchases/regularization?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        let message = "No se pudo generar el archivo Excel.";
        try {
          const payload = await res.json();
          if (payload?.error) message = String(payload.error);
        } catch {
          // ignore non-json body
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const nameMatch = disposition.match(/filename="([^"]+)"/i);
      const filename = nameMatch?.[1] || `bht_por_regularizar_compra_${mode}.xlsx`;

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      onFeedback(`Excel descargado: ${filename}`);
    } catch (error) {
      onFeedback(
        error instanceof Error
          ? error.message
          : "Error de red al exportar el archivo Excel.",
        true
      );
    } finally {
      setExporting(false);
    }
  }

  const items = data?.items ?? [];
  const summary = data?.summary;
  const suppliers = data?.suppliers ?? [];
  const isProjected = mode === "projected";

  return (
    <div className="space-y-4">
      <Card accent="horizon" padding="md" className="space-y-3.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <Badge tone="warning">Facturación de Proveedor</Badge>
            <h2 className="text-base font-bold text-bht-ink-strong sm:text-lg">
              Productos por Regularizar Compra
            </h2>
            <p className="max-w-2xl text-xs leading-relaxed text-bht-ink-soft sm:text-sm">
              Agrupa automáticamente las cantidades vendidas que superan las facturas de
              compra registradas y el stock inicial al 26/06/2026. Exporta a Excel para
              solicitar la factura formal a tu proveedor.
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={exporting || loading || items.length === 0}
            onClick={() => void handleExportExcel()}
            className="shrink-0"
          >
            <DownloadIcon className="h-4 w-4" />
            {exporting ? "Generando Excel..." : "Exportar a Excel (.xlsx)"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <SegmentedControl<RegularizationMode>
            ariaLabel="Modo de cálculo por regularizar compra"
            value={mode}
            onChange={(next) => {
              setMode(next);
              setSupplier("");
            }}
            options={[
              {
                id: "sold",
                label: "Ya vendido sin factura",
                count: summary?.soldDeficitSkus,
              },
              {
                id: "projected",
                label: "Incluir cotizaciones abiertas",
                count: summary?.projectedDeficitSkus,
              },
            ]}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void loadRegularization()}
          >
            {loading ? "Actualizando..." : "Actualizar"}
          </Button>
        </div>

        {summary && (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div className="rounded-xl border border-bht-line bg-bht-paper p-3">
              <span className="block text-xs font-medium text-bht-ink-soft">
                {isProjected
                  ? "Productos con déficit proyectado"
                  : "Productos vendidos sin compra formal"}
              </span>
              <strong className="mt-1 block text-xl font-bold text-bht-navy-deep tabular-nums">
                {isProjected ? summary.projectedDeficitSkus : summary.soldDeficitSkus}
              </strong>
              {summary.missingCostSkus > 0 && (
                <span className="text-xs text-bht-warning-strong">
                  {summary.missingCostSkus} sin costo de referencia
                </span>
              )}
            </div>
            <div className="rounded-xl border border-bht-line bg-bht-paper p-3">
              <span className="block text-xs font-medium text-bht-ink-soft">
                {isProjected ? "Unidades totales proyectadas" : "Unidades por facturar"}
              </span>
              <strong className="mt-1 block text-xl font-bold text-bht-danger tabular-nums">
                {(isProjected
                  ? summary.totalProjectedUnits
                  : summary.totalUnitsToRegularize
                ).toLocaleString("es-PE", { maximumFractionDigits: 2 })}
              </strong>
              <span className="text-xs text-bht-ink-soft">
                Prioriza siempre el stock de facturas reales
              </span>
            </div>
            <div className="rounded-xl border border-bht-line bg-bht-paper p-3">
              <span className="block text-xs font-medium text-bht-ink-soft">
                {isProjected
                  ? "Monto estimado proyectado"
                  : "Monto estimado de factura"}
              </span>
              <strong className="mt-1 block text-xl font-bold text-bht-ink-strong tabular-nums">
                {formatPen(
                  isProjected
                    ? summary.totalProjectedPurchasePen
                    : summary.totalEstimatedPurchasePen
                )}
              </strong>
              <span className="text-xs text-bht-ink-soft">
                Calculado al costo de referencia actual
              </span>
            </div>
          </div>
        )}
      </Card>

      <Card padding="md" className="space-y-3.5">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_minmax(220px,300px)]">
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-bht-ink-muted">
              <SearchIcon className="h-4 w-4" />
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar producto por regularizar"
              placeholder="Buscar por código SKU, producto o categoría..."
              className={`${INPUT_CLASS} pl-10 pr-8`}
            />
            {search && (
              <button
                type="button"
                data-compact="true"
                aria-label="Limpiar búsqueda"
                onClick={() => setSearch("")}
                className="absolute inset-y-0 right-2.5 flex items-center text-bht-ink-muted hover:text-bht-ink-strong cursor-pointer"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            )}
          </div>
          <select
            aria-label="Filtrar por proveedor referencial"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            className={`${INPUT_CLASS} font-medium`}
          >
            <option value="">Todos los proveedores ({suppliers.length})</option>
            {suppliers.map((sup) => (
              <option key={sup} value={sup}>
                {sup}
              </option>
            ))}
          </select>
        </div>

        {loading && !data ? (
          <p className="py-8 text-center text-sm text-bht-ink-soft">
            Calculando déficit de compras formales...
          </p>
        ) : errorMsg ? (
          <EmptyState title={errorMsg} />
        ) : items.length === 0 ? (
          <EmptyState
            title="Sin productos pendientes de regularizar"
            description="Todas las ventas registradas en este filtro ya cuentan con respaldo de factura de compra o stock inicial."
          />
        ) : (
          <>
            {/* Mobile view */}
            <div className="space-y-2.5 md:hidden">
              {items.map((item) => {
                const targetQty = isProjected
                  ? item.projected_qty_to_regularize
                  : item.qty_to_regularize;
                const estPen = isProjected
                  ? item.projected_purchase_pen
                  : item.estimated_purchase_pen;
                return (
                  <div
                    key={item.product_id}
                    className="space-y-2 rounded-xl border border-bht-line bg-bht-paper p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-bht-ink-strong">
                          {item.product_name}
                        </p>
                        <p className="text-xs text-bht-ink-muted tabular-nums">
                          {item.sku} · {item.last_supplier_name}
                        </p>
                      </div>
                      <Badge tone="danger" className="tabular-nums">
                        Falta {targetQty} {item.unit_of_measure}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 border-t border-bht-line/80 pt-2 text-xs tabular-nums">
                      <div>
                        <span className="block text-bht-ink-soft">
                          Facturado + Inicial
                        </span>
                        <strong className="text-bht-ink-strong">
                          {item.formal_backed_qty} {item.unit_of_measure}
                        </strong>
                      </div>
                      <div>
                        <span className="block text-bht-ink-soft">Total vendido</span>
                        <strong className="text-bht-ink-strong">
                          {item.sold_qty} {item.unit_of_measure}
                        </strong>
                      </div>
                      <div>
                        <span className="block text-bht-ink-soft">
                          Costo ref. unit.
                        </span>
                        <strong className="text-bht-ink-strong">
                          {item.ref_cost_pen !== null
                            ? formatPen(item.ref_cost_pen)
                            : "Sin costo"}
                        </strong>
                      </div>
                      <div>
                        <span className="block text-bht-ink-soft">Subtotal est.</span>
                        <strong className="text-bht-navy-deep">
                          {estPen !== null ? formatPen(estPen) : "-"}
                        </strong>
                      </div>
                    </div>
                    {onGoToPurchaseProduct && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() =>
                          onGoToPurchaseProduct({
                            productId: item.product_id,
                            quantity: targetQty,
                          })
                        }
                      >
                        <PlusIcon className="h-3.5 w-3.5" />
                        Registrar compra ({targetQty} {item.unit_of_measure})
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div
              tabIndex={0}
              role="region"
              aria-label="Tabla de productos por regularizar compra"
              className="table-wrapper hidden md:block"
            >
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="border-b border-bht-line bg-bht-paper text-xs font-semibold uppercase tracking-wide text-bht-ink-soft">
                  <tr>
                    <th scope="col" className="whitespace-nowrap p-2.5">
                      Código / Producto
                    </th>
                    <th scope="col" className="whitespace-nowrap p-2.5 text-right">
                      Respaldado
                    </th>
                    <th scope="col" className="whitespace-nowrap p-2.5 text-right">
                      Vendido
                    </th>
                    {isProjected && (
                      <th scope="col" className="whitespace-nowrap p-2.5 text-right">
                        Cotizado
                      </th>
                    )}
                    <th scope="col" className="whitespace-nowrap p-2.5 text-right">
                      Por Regularizar
                    </th>
                    <th scope="col" className="whitespace-nowrap p-2.5 text-right">
                      Costo Ref.
                    </th>
                    <th scope="col" className="whitespace-nowrap p-2.5 text-right">
                      Subtotal Est.
                    </th>
                    <th scope="col" className="whitespace-nowrap p-2.5">
                      Proveedor Ref.
                    </th>
                    {onGoToPurchaseProduct && (
                      <th scope="col" className="whitespace-nowrap p-2.5 text-right">
                        Acción
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-bht-line">
                  {items.map((item) => {
                    const targetQty = isProjected
                      ? item.projected_qty_to_regularize
                      : item.qty_to_regularize;
                    const estPen = isProjected
                      ? item.projected_purchase_pen
                      : item.estimated_purchase_pen;
                    return (
                      <tr
                        key={item.product_id}
                        className="transition hover:bg-bht-paper"
                      >
                        <td className="min-w-[200px] p-2.5">
                          <span className="block font-medium text-bht-ink-strong">
                            {item.product_name}
                          </span>
                          <span className="block text-xs text-bht-ink-muted tabular-nums">
                            {item.sku} · {item.unit_of_measure}
                            {item.last_sale_date
                              ? ` · Últ. venta ${formatDatePe(item.last_sale_date)}`
                              : ""}
                          </span>
                        </td>
                        <td className="whitespace-nowrap p-2.5 text-right text-bht-ink-soft tabular-nums">
                          {item.formal_backed_qty}
                        </td>
                        <td className="whitespace-nowrap p-2.5 text-right font-medium text-bht-ink-strong tabular-nums">
                          {item.sold_qty}
                        </td>
                        {isProjected && (
                          <td className="whitespace-nowrap p-2.5 text-right text-bht-ink-soft tabular-nums">
                            {item.open_quoted_qty}
                          </td>
                        )}
                        <td className="whitespace-nowrap p-2.5 text-right font-bold text-bht-danger tabular-nums">
                          {targetQty} {item.unit_of_measure}
                        </td>
                        <td className="whitespace-nowrap p-2.5 text-right text-bht-ink-soft tabular-nums">
                          {item.ref_cost_pen !== null
                            ? formatPen(item.ref_cost_pen)
                            : "Sin costo"}
                        </td>
                        <td className="whitespace-nowrap p-2.5 text-right font-semibold text-bht-ink-strong tabular-nums">
                          {estPen !== null ? formatPen(estPen) : "-"}
                        </td>
                        <td className="max-w-[200px] truncate p-2.5 text-xs text-bht-ink-soft">
                          {item.last_supplier_name}
                        </td>
                        {onGoToPurchaseProduct && (
                          <td className="whitespace-nowrap p-2.5 text-right">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              data-compact="true"
                              onClick={() =>
                                onGoToPurchaseProduct({
                                  productId: item.product_id,
                                  quantity: targetQty,
                                })
                              }
                            >
                              <PlusIcon className="h-3.5 w-3.5" />
                              Comprar
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
