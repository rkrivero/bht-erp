"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type { PartnerCatalogItem } from "@/features/partners/components/types";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import { mutationErrorMessage, postJson, type ShowFeedback } from "./partnerShared";
import type { PartnerData } from "./usePartnerData";

export type InventoryAttentionFilter =
  "ALL" | "OUT_OF_STOCK" | "LOW_STOCK" | "NO_COST" | "MARGIN_RISK";

interface ResetNegativeStockResponse {
  adjustedSkuCount?: number;
}

interface InventoryFlowDeps {
  catalog: PartnerData["catalog"];
  setFeedback: PartnerData["setFeedback"];
  showFeedback: ShowFeedback;
  refreshDashboard: PartnerData["refreshDashboard"];
}

export function summarizeInventory(catalog: PartnerCatalogItem[]) {
  const outOfStock = catalog.filter(
    (product) => product.fulfillment_mode === "STOCKED" && product.stock_on_hand === 0
  ).length;
  const lowStock = catalog.filter(
    (product) =>
      product.fulfillment_mode === "STOCKED" &&
      product.stock_on_hand > 0 &&
      product.stock_on_hand <= 5
  ).length;
  const noCost = catalog.filter((product) => product.ref_cost_pen === null).length;
  const marginRisk = catalog.filter(
    (product) =>
      product.ref_cost_pen !== null &&
      product.min_sale_price_pen !== null &&
      product.min_sale_price_pen <= product.ref_cost_pen
  ).length;
  return { outOfStock, lowStock, noCost, marginRisk };
}

function matchesInventoryAttention(
  product: PartnerCatalogItem,
  filter: InventoryAttentionFilter
) {
  if (filter === "OUT_OF_STOCK") {
    return product.fulfillment_mode === "STOCKED" && product.stock_on_hand === 0;
  }
  if (filter === "LOW_STOCK") {
    return (
      product.fulfillment_mode === "STOCKED" &&
      product.stock_on_hand > 0 &&
      product.stock_on_hand <= 5
    );
  }
  if (filter === "NO_COST") return product.ref_cost_pen === null;
  if (filter === "MARGIN_RISK") {
    return (
      product.ref_cost_pen !== null &&
      product.min_sale_price_pen !== null &&
      product.min_sale_price_pen <= product.ref_cost_pen
    );
  }
  return true;
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
  const [attentionFilter, setAttentionFilter] =
    useState<InventoryAttentionFilter>("ALL");
  const [showAllCatalog, setShowAllCatalog] = useState(false);
  const [editingProd, setEditingProd] = useState<PartnerCatalogItem | null>(null);
  const [editStock, setEditStock] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editMinPrice, setEditMinPrice] = useState("");
  const [editMinStockQty, setEditMinStockQty] = useState("");
  const [editLeadTimeDays, setEditLeadTimeDays] = useState("");
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
    setEditMinStockQty(
      p.min_stock_qty !== null && p.min_stock_qty !== undefined
        ? String(p.min_stock_qty)
        : ""
    );
    setEditLeadTimeDays(
      p.lead_time_days !== null && p.lead_time_days !== undefined
        ? String(p.lead_time_days)
        : ""
    );
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
        minStockQty: editMinStockQty.trim() === "" ? null : editMinStockQty,
        leadTimeDays: editLeadTimeDays.trim() === "" ? null : editLeadTimeDays,
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
    return catalog.filter((product) => {
      const matchesSearch =
        !q ||
        product.name.toLowerCase().includes(q) ||
        product.sku.toLowerCase().includes(q);
      return matchesSearch && matchesInventoryAttention(product, attentionFilter);
    });
  }, [attentionFilter, catalog, deferredSearchSku]);

  const inventorySummary = useMemo(() => summarizeInventory(catalog), [catalog]);

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
    attentionFilter,
    setAttentionFilter,
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
    editMinStockQty,
    setEditMinStockQty,
    editLeadTimeDays,
    setEditLeadTimeDays,
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
