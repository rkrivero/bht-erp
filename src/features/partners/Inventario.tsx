"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { formatPen } from "@/components/socios/types";
import {
  ControlPanel,
  type ControlPanelFacet,
} from "@/components/ui/ControlPanel";
import { EditIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  SegmentedControl,
} from "@/components/ui/Primitives";
import {
  ResponsiveDataTable,
  type ResponsiveTableColumn,
} from "@/components/ui/ResponsiveDataTable";
import { formatFulfillmentModeEs, formatUnitTitleEs } from "@/lib/labels-es";
import type { RawProductRow } from "@/lib/types";
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

const ATTENTION_LABELS: Record<Exclude<InventoryAttentionFilter, "ALL">, string> = {
  OUT_OF_STOCK: "Agotados",
  LOW_STOCK: "Stock bajo",
  NO_COST: "Sin costo registrado",
  MARGIN_RISK: "Margen en riesgo",
};

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

  const facets: ControlPanelFacet[] = useMemo(() => {
    const list: ControlPanelFacet[] = [];
    if (attentionFilter !== "ALL") {
      list.push({
        id: "attention",
        label: "Alerta",
        value: ATTENTION_LABELS[attentionFilter],
        onRemove: () => {
          setAttentionFilter("ALL");
          setShowAllCatalog(false);
        },
      });
    }
    if (searchSku.trim()) {
      list.push({
        id: "sku",
        label: "Búsqueda",
        value: searchSku.trim(),
        onRemove: () => {
          setSearchSku("");
          setShowAllCatalog(false);
        },
      });
    }
    return list;
  }, [attentionFilter, setAttentionFilter, searchSku, setSearchSku, setShowAllCatalog]);

  const productColumns: ResponsiveTableColumn<RawProductRow>[] = useMemo(
    () => [
      {
        id: "product",
        header: "Código / Producto",
        sortable: true,
        sortValue: (p) => p.name,
        cell: (p) => (
          <div>
            <span className="font-semibold text-bht-ink-strong">{p.name}</span>
            <span className="block font-mono text-xs text-bht-ink-muted">
              {p.sku}
            </span>
          </div>
        ),
      },
      {
        id: "mode",
        header: "Modalidad",
        sortable: true,
        sortValue: (p) => p.fulfillment_mode,
        cell: (p) => (
          <Badge
            tone={p.fulfillment_mode === "ON_DEMAND" ? "warning" : "neutral"}
          >
            {formatFulfillmentModeEs(p.fulfillment_mode)}
          </Badge>
        ),
      },
      {
        id: "stock",
        header: "Inventario",
        align: "right",
        sortable: true,
        sortValue: (p) => Number(p.stock_on_hand ?? 0),
        cell: (p) => (
          <span
            className={`font-semibold tabular-nums ${
              p.stock_on_hand < 0 ? "text-bht-danger" : "text-bht-ink-strong"
            }`}
          >
            {p.stock_on_hand}{" "}
            <span
              title={formatUnitTitleEs(p.unit_of_measure)}
              className="text-xs font-normal text-bht-ink-muted"
            >
              {p.unit_of_measure}
            </span>
          </span>
        ),
      },
      {
        id: "cost",
        header: "Costo Real",
        align: "right",
        optional: true,
        sortable: true,
        sortValue: (p) =>
          p.ref_cost_pen !== null ? Number(p.ref_cost_pen) : -1,
        cell: (p) => (
          <span className="text-bht-ink-soft tabular-nums">
            {p.ref_cost_pen !== null ? formatPen(p.ref_cost_pen) : "Sin costo"}
          </span>
        ),
      },
      {
        id: "list_price",
        header: "Precio Normal",
        align: "right",
        sortable: true,
        sortValue: (p) => Number(p.list_sale_price_pen ?? 0),
        cell: (p) => (
          <span className="font-semibold text-bht-ink-strong tabular-nums">
            {formatPen(p.list_sale_price_pen ?? 0)} / {p.unit_of_measure}
          </span>
        ),
      },
      {
        id: "min_price",
        header: "Precio Mínimo",
        align: "right",
        optional: true,
        sortable: true,
        sortValue: (p) => Number(p.min_sale_price_pen ?? 0),
        cell: (p) => (
          <span className="font-semibold text-bht-navy-mid tabular-nums">
            {formatPen(p.min_sale_price_pen ?? 0)} / {p.unit_of_measure}
          </span>
        ),
      },
      {
        id: "action",
        header: "Acción",
        align: "right",
        stopRowClickPropagation: true,
        cell: (p) => (
          <Button
            variant="outline"
            size="sm"
            aria-label={`Editar ${p.sku} (${p.name})`}
            onClick={() => openEditProduct(p)}
          >
            <EditIcon className="h-3.5 w-3.5" />
            Editar
          </Button>
        ),
      },
    ],
    [openEditProduct]
  );

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
                  className="border-bht-warning text-bht-warning-strong"
                >
                  {busyResetStock
                    ? "Regularizando..."
                    : `Revisar ajuste de ${negStockCount} saldo(s)`}
                </Button>
              </div>
            </details>
          </Card>

          <ControlPanel
            title="Catálogo de Productos y Stock"
            subtitle="Precios mayoristas en Soles (S/), costos de referencia y existencias actuales."
            searchValue={searchSku}
            onSearchChange={(val) => {
              setSearchSku(val);
              setShowAllCatalog(false);
            }}
            searchPlaceholder="Buscar producto por nombre o código..."
            searchAriaLabel="Buscar producto en inventario"
            facets={facets}
            onClearAllFacets={() => {
              setAttentionFilter("ALL");
              setSearchSku("");
              setShowAllCatalog(false);
            }}
            secondaryActions={
              filteredCatalog.length > 40 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAllCatalog((prev) => !prev)}
                >
                  {showAllCatalog
                    ? "Ver primeros 40"
                    : `Ver todos (${filteredCatalog.length})`}
                </Button>
              ) : undefined
            }
            pagination={{
              shownCount: visibleCatalog.length,
              totalCount: filteredCatalog.length,
              itemLabel: "productos",
              hasMore: !showAllCatalog && filteredCatalog.length > 40,
              onLoadMore: () => setShowAllCatalog(true),
              loadMoreLabel: `Ver todos (${filteredCatalog.length})`,
            }}
          >
            <ResponsiveDataTable
              columns={productColumns}
              data={visibleCatalog}
              getRowKey={(p) => p.product_id}
              ariaLabel="Inventario y precios de catálogo"
              emptyTitle="No se encontraron productos para esta búsqueda"
            />
          </ControlPanel>
        </>
      )}
    </div>
  );
}
