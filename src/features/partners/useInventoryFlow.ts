"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type { PartnerCatalogItem } from "@/components/socios/types";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import { mutationErrorMessage, postJson, type ShowFeedback } from "./partnerShared";
import type { PartnerData } from "./usePartnerData";

interface ResetNegativeStockResponse {
  adjustedSkuCount?: number;
}

interface InventoryFlowDeps {
  catalog: PartnerData["catalog"];
  setFeedback: PartnerData["setFeedback"];
  showFeedback: ShowFeedback;
  refreshDashboard: PartnerData["refreshDashboard"];
}

/** Catalog search, product edit draft and negative-stock regularization. */
export function useInventoryFlow({
  catalog,
  setFeedback,
  showFeedback,
  refreshDashboard,
}: InventoryFlowDeps) {
  const [busyResetStock, setBusyResetStock] = useState(false);
  const [confirmResetNegativeOpen, setConfirmResetNegativeOpen] = useState(false);
  const [searchSku, setSearchSku] = useState("");
  const deferredSearchSku = useDeferredValue(searchSku);
  const [showAllCatalog, setShowAllCatalog] = useState(false);
  const [editingProd, setEditingProd] = useState<PartnerCatalogItem | null>(null);
  const [editStock, setEditStock] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editMinPrice, setEditMinPrice] = useState("");
  const [editMode, setEditMode] = useState<"STOCKED" | "ON_DEMAND">("STOCKED");
  const [busySaveProduct, setBusySaveProduct] = useState(false);

  async function handleResetNegativeStock() {
    if (busyResetStock) return;
    setFeedback(null);
    setBusyResetStock(true);
    try {
      const data = await postJson<ResetNegativeStockResponse>("/api/partners", {
        action: "reset_negative_stock",
      });
      setConfirmResetNegativeOpen(false);
      showFeedback(
        `¡Listo! Se pusieron en 0 exactamente ${data.adjustedSkuCount} productos con saldo negativo histórico.`
      );
      notifyLocalSync(["inventory", "partners"]);
      await refreshDashboard(["inventory", "partners"]);
    } catch (error) {
      showFeedback(
        mutationErrorMessage(
          error,
          "Error al poner en 0 saldos negativos",
          "Error de red regularizando saldos negativos."
        ),
        true
      );
    } finally {
      setBusyResetStock(false);
    }
  }

  const openEditProduct = useCallback((p: PartnerCatalogItem) => {
    setEditingProd(p);
    setEditStock(String(p.stock_on_hand));
    setEditCost(p.ref_cost_pen !== null ? String(p.ref_cost_pen) : "");
    setEditPrice(String(p.list_sale_price_pen ?? ""));
    setEditMinPrice(String(p.min_sale_price_pen ?? ""));
    setEditMode(p.fulfillment_mode);
  }, []);

  async function handleSaveProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!editingProd || busySaveProduct) return;
    setFeedback(null);
    setBusySaveProduct(true);
    try {
      await postJson("/api/partners", {
        action: "update_product",
        productId: editingProd.product_id,
        physicalStock: editStock,
        refCostPen: editCost,
        listSalePricePen: editPrice,
        minSalePricePen: editMinPrice,
        fulfillmentMode: editMode,
      });
      showFeedback(`Producto ${editingProd.sku} actualizado.`);
      setEditingProd(null);
      notifyLocalSync(["inventory", "partners"]);
      await refreshDashboard(["inventory", "partners"]);
    } catch (error) {
      showFeedback(
        mutationErrorMessage(
          error,
          "Error al actualizar producto",
          "Error de red al guardar el producto."
        ),
        true
      );
    } finally {
      setBusySaveProduct(false);
    }
  }

  const filteredCatalog = useMemo(() => {
    const q = deferredSearchSku.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
  }, [catalog, deferredSearchSku]);

  const inventorySummary = useMemo(() => {
    const lowStock = catalog.filter(
      (product) =>
        product.fulfillment_mode === "STOCKED" &&
        product.stock_on_hand >= 0 &&
        product.stock_on_hand <= 5
    ).length;
    const noCost = catalog.filter((product) => product.ref_cost_pen === null).length;
    const marginRisk = catalog.filter(
      (product) =>
        product.ref_cost_pen !== null &&
        product.min_sale_price_pen !== null &&
        product.min_sale_price_pen <= product.ref_cost_pen
    ).length;
    return { lowStock, noCost, marginRisk };
  }, [catalog]);

  const visibleCatalog = useMemo(
    () => (showAllCatalog ? filteredCatalog : filteredCatalog.slice(0, 40)),
    [filteredCatalog, showAllCatalog]
  );

  return {
    busyResetStock,
    confirmResetNegativeOpen,
    setConfirmResetNegativeOpen,
    searchSku,
    setSearchSku,
    showAllCatalog,
    setShowAllCatalog,
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
    openEditProduct,
    handleResetNegativeStock,
    handleSaveProduct,
    filteredCatalog,
    inventorySummary,
    visibleCatalog,
  };
}

export type InventoryFlow = ReturnType<typeof useInventoryFlow>;
