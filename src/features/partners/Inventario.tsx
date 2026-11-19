"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { formatPen } from "@/components/socios/types";
import { CloseIcon, EditIcon, SearchIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLASS,
  SegmentedControl,
} from "@/components/ui/Primitives";
import { formatFulfillmentModeEs, formatUnitTitleEs } from "@/lib/labels-es";
import type { ShowFeedback } from "./partnerShared";
import type { InventoryAttentionFilter, InventoryFlow } from "./useInventoryFlow";

export { InventarioModals } from "@/components/socios/InventarioModals";

const PurchaseRegularizationPanel = dynamic(
  () => import("@/components/socios/PurchaseRegularizationPanel"),
  {
    loading: () => (
      <Card className="p-8 text-center text-sm text-bht-ink-soft" role="status">
        Cargando productos por regularizar compra…
      </Card>
    ),
  }
);

export type InventorySubView = "catalog" | "regularization";

interface InventarioProps {
  negStockCount: number;
  unpurchasedRegularizationCount: number;
  initialView?: InventorySubView | null;
  onClearInitialView?: () => void;
  refreshKey?: number;
  onGoToPurchaseProduct?: (target: { productId: number; quantity?: number }) => void;
  onFeedback: ShowFeedback;
  flow: InventoryFlow;
}

export function Inventario({
  negStockCount,
  unpurchasedRegularizationCount,
  initialView = null,
  onClearInitialView,
  refreshKey = 0,
  onGoToPurchaseProduct,
  onFeedback,
  flow,
}: InventarioProps) {
  const [subView, setSubView] = useState<InventorySubView>("catalog");

  useEffect(() => {
    if (initialView) {
      setSubView(initialView);
      onClearInitialView?.();
    }
  }, [initialView, onClearInitialView]);

  const {
    inventorySummary,
    busyResetStock,
    setConfirmResetNegativeOpen,
    searchSku,
    setSearchSku,
    attentionFilter,
    setAttentionFilter,
    setShowAllCatalog,
    showAllCatalog,
    visibleCatalog,
    filteredCatalog,
    openEditProduct,
  } = flow;
  const attentionCards: Array<{
    id: Exclude<InventoryAttentionFilter, "ALL">;
    label: string;
    description: string;
    count: number;
    tone: "warning" | "danger";
  }> = [
    {
      id: "OUT_OF_STOCK",
      label: "Agotados",
      description: "Stock propio igual a 0",
      count: inventorySummary.outOfStock,
      tone: "danger",
    },
    {
      id: "LOW_STOCK",
      label: "Stock bajo",
      description: "Entre 1 y 5 unidades",
      count: inventorySummary.lowStock,
      tone: "warning",
    },
    {
      id: "NO_COST",
      label: "Sin costo registrado",
      description: "Falta costo de referencia",
      count: inventorySummary.noCost,
      tone: "danger",
    },
    {
      id: "MARGIN_RISK",
      label: "Margen en riesgo",
      description: "Precio mínimo ≤ costo",
      count: inventorySummary.marginRisk,
      tone: "danger",
    },
  ];
  return (
    <div className="space-y-4">
      <SegmentedControl<InventorySubView>
        ariaLabel="Secciones de Inventario"
        value={subView}
        onChange={setSubView}
        className="w-full sm:w-auto"
        options={[
          { id: "catalog", label: "Catálogo y Stock" },
          {
            id: "regularization",
            label: "Por Regularizar Compra",
            count: unpurchasedRegularizationCount,
          },
        ]}
      />

      {subView === "regularization" ? (
        <PurchaseRegularizationPanel
          refreshKey={refreshKey}
          onGoToPurchaseProduct={onGoToPurchaseProduct}
          onFeedback={onFeedback}
        />
      ) : (
        <>
          <div
            className="grid grid-cols-2 gap-2 lg:grid-cols-4"
            aria-label="Indicadores y filtros de inventario"
          >
            {attentionCards.map((item) => {
              const active = attentionFilter === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${item.label}: ${item.count}. ${item.description}. ${
                    active ? "Filtro activo; quitar filtro" : "Filtrar inventario"
                  }`}
                  onClick={() => {
                    setAttentionFilter(active ? "ALL" : item.id);
                    setShowAllCatalog(false);
                  }}
                  className={`min-h-[76px] rounded-xl border p-3 text-left shadow-bht-elev-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt focus-visible:ring-offset-2 cursor-pointer ${
                    active
                      ? "border-bht-cobalt bg-bht-cobalt-bg"
                      : "border-bht-slate-line bg-white hover:border-bht-line-blue hover:bg-bht-surface-cool"
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span
                      className={`text-sm font-semibold leading-snug ${
                        active ? "text-bht-cobalt-strong" : "text-bht-ink-strong"
                      }`}
                    >
                      {item.label}
                    </span>
                    <Badge tone={item.tone} className="tabular-nums">
                      {item.count}
                    </Badge>
                  </span>
                  <span className="mt-1 block text-xs leading-snug text-bht-ink-soft">
                    {item.description}
                  </span>
                </button>
              );
            })}
          </div>
          <Card tone={negStockCount > 0 ? "warning" : "default"} padding="md">
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep">
                <div>
                  <h2 className="text-base font-bold text-bht-ink-strong sm:text-lg">
                    Administración · Regularización histórica
                  </h2>
                  <p className="mt-0.5 text-xs text-bht-ink-soft">
                    {negStockCount} saldo(s) negativo(s) de la carga inicial
                  </p>
                </div>
                <span
                  aria-hidden="true"
                  className="text-bht-ink-soft group-open:rotate-180"
                >
                  ▾
                </span>
              </summary>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-bht-line pt-3">
                <p className="max-w-2xl text-xs leading-relaxed text-bht-ink-soft">
                  Esta acción administrativa crea ajustes auditables para llevar a cero
                  saldos históricos por ventas sin compra previa. No se usa en la
                  operación cotidiana.
                </p>
                <Button
                  variant="outline"
                  size="md"
                  disabled={busyResetStock || negStockCount === 0}
                  onClick={() => setConfirmResetNegativeOpen(true)}
                  className="border-bht-tone-f59e0b text-bht-warning-strong"
                >
                  {busyResetStock
                    ? "Regularizando..."
                    : `Revisar ajuste de ${negStockCount} saldo(s)`}
                </Button>
              </div>
            </details>
          </Card>

          <Card padding="md" className="space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="relative w-full sm:w-auto sm:min-w-[220px] sm:flex-1">
                <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-bht-ink-muted">
                  <SearchIcon className="h-4 w-4" />
                </span>
                <input
                  type="text"
                  value={searchSku}
                  onChange={(e) => {
                    setSearchSku(e.target.value);
                    setShowAllCatalog(false);
                  }}
                  aria-label="Buscar producto en inventario"
                  placeholder="Buscar producto por nombre o código..."
                  className={`${INPUT_CLASS} pl-10 pr-8`}
                />
                {searchSku && (
                  <button
                    type="button"
                    data-compact="true"
                    aria-label="Limpiar búsqueda de producto"
                    onClick={() => {
                      setSearchSku("");
                      setShowAllCatalog(false);
                    }}
                    className="absolute inset-y-0 right-2.5 flex items-center text-bht-ink-muted hover:text-bht-ink-strong cursor-pointer"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-bht-ink-soft tabular-nums">
                  Mostrando {visibleCatalog.length} de {filteredCatalog.length}{" "}
                  productos
                </span>
                {filteredCatalog.length > 40 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAllCatalog((prev) => !prev)}
                  >
                    {showAllCatalog
                      ? "Ver 40"
                      : `Ver todos (${filteredCatalog.length})`}
                  </Button>
                )}
              </div>
            </div>

            {visibleCatalog.length === 0 ? (
              <EmptyState title="No se encontraron productos para esta búsqueda" />
            ) : (
              <>
                {/* Mobile catalog cards */}
                <div className="space-y-2.5 md:hidden">
                  {visibleCatalog.map((p) => (
                    <div
                      key={p.product_id}
                      className="rounded-xl border border-bht-line bg-bht-paper p-3 space-y-2 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-base font-bold text-bht-ink-strong">
                            {p.name}
                          </p>
                          <p className="text-xs text-bht-ink-muted">{p.sku}</p>
                        </div>
                        <Badge
                          tone={
                            p.fulfillment_mode === "ON_DEMAND" ? "warning" : "neutral"
                          }
                        >
                          {formatFulfillmentModeEs(p.fulfillment_mode)}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 border-t border-bht-line/80 pt-2 tabular-nums">
                        <div>
                          <span className="block text-xs text-bht-ink-soft">
                            Stock actual
                          </span>
                          <span
                            className={`font-semibold ${
                              p.stock_on_hand < 0
                                ? "text-bht-danger"
                                : "text-bht-ink-strong"
                            }`}
                          >
                            {p.stock_on_hand}{" "}
                            <span
                              title={formatUnitTitleEs(p.unit_of_measure)}
                              className="text-xs font-medium text-bht-ink-muted"
                            >
                              {p.unit_of_measure}
                            </span>
                          </span>
                        </div>
                        <div>
                          <span className="block text-xs text-bht-ink-soft">
                            Costo real
                          </span>
                          <span className="font-semibold text-bht-ink-strong">
                            {p.ref_cost_pen !== null
                              ? formatPen(p.ref_cost_pen)
                              : "Sin costo"}
                          </span>
                        </div>
                        <div>
                          <span className="block text-xs text-bht-ink-soft">
                            Precio normal
                          </span>
                          <span className="font-semibold text-bht-ink-strong">
                            {formatPen(p.list_sale_price_pen ?? 0)} /{" "}
                            {p.unit_of_measure}
                          </span>
                        </div>
                        <div>
                          <span className="block text-xs text-bht-ink-soft">
                            Precio mínimo
                          </span>
                          <span className="font-semibold text-bht-navy-mid">
                            {formatPen(p.min_sale_price_pen ?? 0)} / {p.unit_of_measure}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Editar precio o stock de ${p.sku} (${p.name})`}
                        onClick={() => openEditProduct(p)}
                        className="w-full"
                      >
                        <EditIcon className="h-3.5 w-3.5" />
                        Editar precio / stock
                      </Button>
                    </div>
                  ))}
                </div>

                {/* Desktop catalog table */}
                <div
                  tabIndex={0}
                  role="region"
                  aria-label="Inventario y precios de catálogo"
                  className="table-wrapper hidden md:block"
                >
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-bht-line bg-bht-paper text-xs font-semibold uppercase tracking-wide text-bht-ink-soft">
                      <tr>
                        <th scope="col" className="whitespace-nowrap p-2.5">
                          Código / Producto
                        </th>
                        <th scope="col" className="whitespace-nowrap p-2.5">
                          Modalidad
                        </th>
                        <th scope="col" className="whitespace-nowrap p-2.5 text-right">
                          Inventario
                        </th>
                        <th scope="col" className="whitespace-nowrap p-2.5 text-right">
                          Costo Real
                        </th>
                        <th scope="col" className="whitespace-nowrap p-2.5 text-right">
                          Precio Normal
                        </th>
                        <th scope="col" className="whitespace-nowrap p-2.5 text-right">
                          Precio Mínimo
                        </th>
                        <th scope="col" className="whitespace-nowrap p-2.5 text-right">
                          Acción
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-bht-line">
                      {visibleCatalog.map((p) => (
                        <tr
                          key={p.product_id}
                          className="transition hover:bg-bht-paper"
                        >
                          <td className="min-w-[180px] p-2.5 font-medium text-bht-ink-strong">
                            {p.name}
                            <span className="block text-xs font-normal text-bht-ink-muted">
                              {p.sku}
                            </span>
                          </td>
                          <td className="whitespace-nowrap p-2.5">
                            <Badge
                              tone={
                                p.fulfillment_mode === "ON_DEMAND"
                                  ? "warning"
                                  : "neutral"
                              }
                            >
                              {formatFulfillmentModeEs(p.fulfillment_mode)}
                            </Badge>
                          </td>
                          <td
                            className={`whitespace-nowrap p-2.5 text-right font-semibold tabular-nums ${
                              p.stock_on_hand < 0
                                ? "text-bht-danger"
                                : "text-bht-ink-strong"
                            }`}
                          >
                            {p.stock_on_hand}{" "}
                            <span
                              title={formatUnitTitleEs(p.unit_of_measure)}
                              className="text-xs font-normal text-bht-ink-muted"
                            >
                              {p.unit_of_measure}
                            </span>
                          </td>
                          <td className="whitespace-nowrap p-2.5 text-right text-bht-ink-soft tabular-nums">
                            {p.ref_cost_pen !== null
                              ? formatPen(p.ref_cost_pen)
                              : "Sin costo"}
                          </td>
                          <td className="p-2.5 text-right font-semibold text-bht-ink-strong tabular-nums">
                            {formatPen(p.list_sale_price_pen ?? 0)} /{" "}
                            {p.unit_of_measure}
                          </td>
                          <td className="p-2.5 text-right font-semibold text-bht-navy-mid tabular-nums">
                            {formatPen(p.min_sale_price_pen ?? 0)} / {p.unit_of_measure}
                          </td>
                          <td className="p-2.5 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              aria-label={`Editar ${p.sku} (${p.name})`}
                              onClick={() => openEditProduct(p)}
                            >
                              <EditIcon className="h-3.5 w-3.5" />
                              Editar
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
