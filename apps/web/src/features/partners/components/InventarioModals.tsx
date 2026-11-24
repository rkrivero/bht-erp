"use client";

import React from "react";
import { formatDatePe, formatPen } from "@/features/partners/components/types";
import {
  Button,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
} from "@/components/ui/Primitives";
import type { InventoryFlow } from "@/features/partners/useInventoryFlow";

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
    editMinStockQty,
    setEditMinStockQty,
    editLeadTimeDays,
    setEditLeadTimeDays,
    editMode,
    setEditMode,
    busySaveProduct,
    handleSaveProduct,
    busyResetStock,
    confirmResetNegativeOpen,
    setConfirmResetNegativeOpen,
    handleResetNegativeStock,
  } = flow;

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
                {editingProd.cost_updated_at && (
                  <p className="mt-1 text-xs text-bht-ink-soft tabular-nums">
                    Actualizado:{" "}
                    {formatDatePe(editingProd.cost_updated_at.slice(0, 10))}
                  </p>
                )}
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
              <div>
                <FieldLabel htmlFor="edit-prod-min-stock">
                  Stock mínimo alerta ({editingProd.unit_of_measure})
                </FieldLabel>
                <input
                  id="edit-prod-min-stock"
                  type="number"
                  step="0.01"
                  min="0"
                  value={editMinStockQty}
                  onChange={(e) => setEditMinStockQty(e.target.value)}
                  placeholder="Opcional"
                  className={`${INPUT_CLASS} mt-1.5 font-semibold tabular-nums`}
                />
              </div>
              <div>
                <FieldLabel htmlFor="edit-prod-lead-time">
                  Lead time proveedor (días)
                </FieldLabel>
                <input
                  id="edit-prod-lead-time"
                  type="number"
                  step="1"
                  min="0"
                  max="365"
                  value={editLeadTimeDays}
                  onChange={(e) => setEditLeadTimeDays(e.target.value)}
                  placeholder="Opcional"
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
