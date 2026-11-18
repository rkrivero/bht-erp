"use client";

import React from "react";
import { formatPen } from "@/components/socios/types";
import {} from "@/components/shared/CollectionControls";
import { CloseIcon, EditIcon, SearchIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
} from "@/components/ui/Primitives";
import { formatFulfillmentModeEs, formatUnitTitleEs } from "@/lib/labels-es";
import {} from "./partnerShared";
import type { InventoryFlow } from "./useInventoryFlow";

interface InventarioProps {
  negStockCount: number;
  flow: InventoryFlow;
}

export function Inventario({ negStockCount, flow }: InventarioProps) {
  const {
    inventorySummary,
    busyResetStock,
    setConfirmResetNegativeOpen,
    searchSku,
    setSearchSku,
    setShowAllCatalog,
    showAllCatalog,
    visibleCatalog,
    filteredCatalog,
    openEditProduct,
  } = flow;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {[
          {
            label: "Stock bajo (≤5)",
            count: inventorySummary.lowStock,
            tone: "warning" as const,
          },
          {
            label: "Productos sin costo",
            count: inventorySummary.noCost,
            tone: "danger" as const,
          },
          {
            label: "Mínimo sin margen",
            count: inventorySummary.marginRisk,
            tone: "danger" as const,
          },
        ].map((item) => (
          <Card
            key={item.label}
            padding="sm"
            className="flex items-center justify-between gap-3"
          >
            <span className="text-xs font-medium text-bht-ink-soft">{item.label}</span>
            <Badge tone={item.tone} className="tabular-nums">
              {item.count}
            </Badge>
          </Card>
        ))}
      </div>
      <Card tone={negStockCount > 0 ? "warning" : "default"} padding="md">
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep">
            <div>
              <h2 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
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
              saldos históricos por ventas sin compra previa. No se usa en la operación
              cotidiana.
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
              Mostrando {visibleCatalog.length} de {filteredCatalog.length} productos
            </span>
            {filteredCatalog.length > 40 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAllCatalog((prev) => !prev)}
              >
                {showAllCatalog ? "Ver 40" : `Ver todos (${filteredCatalog.length})`}
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
                  className="rounded-xl border border-bht-line bg-bht-paper p-3 space-y-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-bht-ink-strong">
                        {p.name}
                      </p>
                      <p className="text-xs text-bht-ink-muted">{p.sku}</p>
                    </div>
                    <Badge
                      tone={p.fulfillment_mode === "ON_DEMAND" ? "warning" : "neutral"}
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
                        {formatPen(p.list_sale_price_pen ?? 0)} / {p.unit_of_measure}
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
              <table className="w-full text-left text-xs">
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
                    <tr key={p.product_id} className="transition hover:bg-bht-paper">
                      <td className="min-w-[180px] p-2.5 font-medium text-bht-ink-strong">
                        {p.name}
                        <span className="block text-xs font-normal text-bht-ink-muted">
                          {p.sku}
                        </span>
                      </td>
                      <td className="whitespace-nowrap p-2.5">
                        <Badge
                          tone={
                            p.fulfillment_mode === "ON_DEMAND" ? "warning" : "neutral"
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
                        {formatPen(p.list_sale_price_pen ?? 0)} / {p.unit_of_measure}
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
    </div>
  );
}

interface InventarioModalsProps {
  negStockCount: number;
  flow: InventoryFlow;
}

export function InventarioModals({ negStockCount, flow }: InventarioModalsProps) {
  const {
    editingProd,
    setEditingProd,
    editStock,
    setEditStock,
    editCost,
    setEditCost,
    editPrice,
    setEditPrice,
    editMinPrice,
    setEditMinPrice,
    editMode,
    setEditMode,
    busySaveProduct,
    handleSaveProduct,
    busyResetStock,
    confirmResetNegativeOpen,
    setConfirmResetNegativeOpen,
    handleResetNegativeStock,
  } = flow;

  // Live margin preview when editing product
  const previewCost = Number(editCost);
  const previewPrice = Number(editPrice);
  const previewMin = Number(editMinPrice);
  const hasPreviewCost = editCost.trim() !== "" && Number.isFinite(previewCost);

  return (
    <>
      <ModalSheet
        open={Boolean(editingProd)}
        onClose={() => setEditingProd(null)}
        title={editingProd ? `Editar producto · ${editingProd.sku}` : "Editar producto"}
        subtitle={editingProd?.name}
        maxWidth="2xl"
      >
        {editingProd && (
          <form onSubmit={handleSaveProduct} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="edit-prod-stock">
                  Inventario físico real ({editingProd.unit_of_measure})
                </FieldLabel>
                <input
                  id="edit-prod-stock"
                  type="number"
                  step="0.01"
                  value={editStock}
                  onChange={(e) => setEditStock(e.target.value)}
                  className={`${INPUT_CLASS} mt-1.5 font-semibold tabular-nums`}
                />
              </div>
              <div>
                <FieldLabel htmlFor="edit-prod-cost">Costo real (S/)</FieldLabel>
                <input
                  id="edit-prod-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  value={editCost}
                  onChange={(e) => setEditCost(e.target.value)}
                  placeholder="Sin costo"
                  className={`${INPUT_CLASS} mt-1.5 font-semibold tabular-nums`}
                />
              </div>
              <div>
                <FieldLabel htmlFor="edit-prod-price">Precio normal (S/)</FieldLabel>
                <input
                  id="edit-prod-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  className={`${INPUT_CLASS} mt-1.5 font-semibold tabular-nums`}
                />
              </div>
              <div>
                <FieldLabel htmlFor="edit-prod-min">Precio mínimo (S/)</FieldLabel>
                <input
                  id="edit-prod-min"
                  type="number"
                  step="0.01"
                  min="0"
                  value={editMinPrice}
                  onChange={(e) => setEditMinPrice(e.target.value)}
                  className={`${INPUT_CLASS} mt-1.5 font-semibold tabular-nums`}
                />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="edit-prod-mode">Modalidad</FieldLabel>
                <select
                  id="edit-prod-mode"
                  value={editMode}
                  onChange={(e) =>
                    setEditMode(e.target.value as "STOCKED" | "ON_DEMAND")
                  }
                  className={`${INPUT_CLASS} mt-1.5 font-medium`}
                >
                  <option value="STOCKED">Con Inventario Propio</option>
                  <option value="ON_DEMAND">Bajo Pedido (Sin Almacén)</option>
                </select>
              </div>
            </div>

            {hasPreviewCost && Number.isFinite(previewPrice) && previewPrice > 0 && (
              <div className="grid grid-cols-2 gap-2.5 rounded-xl border border-bht-line bg-bht-paper p-3 text-xs tabular-nums">
                <div>
                  <span className="block text-bht-ink-soft">
                    Margen al precio normal
                  </span>
                  <strong className="text-bht-success">
                    {formatPen(previewPrice - previewCost)} (
                    {(((previewPrice - previewCost) / previewPrice) * 100).toFixed(1)}
                    %)
                  </strong>
                </div>
                <div>
                  <span className="block text-bht-ink-soft">
                    Margen al precio mínimo
                  </span>
                  <strong
                    className={
                      previewMin - previewCost <= 0
                        ? "text-bht-danger"
                        : "text-bht-ink-strong"
                    }
                  >
                    {Number.isFinite(previewMin) && previewMin > 0
                      ? `${formatPen(previewMin - previewCost)} (${(
                          ((previewMin - previewCost) / previewMin) *
                          100
                        ).toFixed(1)}%)`
                      : "-"}
                  </strong>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => setEditingProd(null)}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={busySaveProduct}
                className="flex-[2]"
              >
                {busySaveProduct ? "Guardando..." : "Guardar Cambios"}
              </Button>
            </div>
          </form>
        )}
      </ModalSheet>

      <ModalSheet
        open={confirmResetNegativeOpen}
        onClose={() => {
          if (!busyResetStock) setConfirmResetNegativeOpen(false);
        }}
        title="Confirmar regularización de stock negativo"
        subtitle="Esta acción genera un ajuste contable (INV_ADJUSTMENT) en kardex."
      >
        <div className="space-y-4 text-xs sm:text-sm text-bht-ink-soft">
          <p>
            Se pondrán exactamente en <strong>0</strong> los saldos de{" "}
            <strong className="text-bht-ink-strong">{negStockCount} producto(s)</strong>{" "}
            que tienen inventario negativo histórico en Almacén Principal.
          </p>
          <p className="rounded-xl border border-bht-amber-line bg-bht-amber-bg px-3 py-2.5 text-xs text-bht-warning-strong">
            Usa esto únicamente después de verificar que esos productos realmente están
            agotados y no falta registrar una compra previa.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={busyResetStock}
              onClick={() => setConfirmResetNegativeOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={busyResetStock || negStockCount === 0}
              onClick={handleResetNegativeStock}
            >
              {busyResetStock ? "Regularizando..." : `Sí, poner ${negStockCount} en 0`}
            </Button>
          </div>
        </div>
      </ModalSheet>
    </>
  );
}
