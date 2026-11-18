"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import type { PartnerOrdersResponseDto } from "@/lib/contracts";
import type { SellerOrderDto, SellerQuoteDto } from "@/features/seller/types";
import { notifyLocalSync, type SyncScope } from "@/lib/realtime/useLiveSync";
import {
  mutationErrorMessage,
  postJson,
  type MonitorStatusFilter,
  type ShowFeedback,
} from "./partnerShared";
import type { PartnerData } from "./usePartnerData";

interface QuoteConversionResponse {
  order?: { orderCode?: string };
}

type RefreshDashboard = (
  changedScopes?: SyncScope[],
  options?: { throwOnError?: boolean }
) => Promise<void>;

interface OrderFlowDeps {
  orders: PartnerData["orders"];
  setOrders: PartnerData["setOrders"];
  ordersPagination: PartnerData["ordersPagination"];
  setOrdersPagination: PartnerData["setOrdersPagination"];
  setFeedback: PartnerData["setFeedback"];
  showFeedback: ShowFeedback;
  refreshDashboard: RefreshDashboard;
}

/** Order monitor, approvals, cancellations, route trips and quote actions. */
export function useOrderFlow({
  orders,
  setOrders,
  ordersPagination,
  setOrdersPagination,
  setFeedback,
  showFeedback,
  refreshDashboard,
}: OrderFlowDeps) {
  const router = useRouter();
  const [loadingMoreOrders, setLoadingMoreOrders] = useState(false);
  const [busyTripId, setBusyTripId] = useState<number | null>(null);
  const [busyQuoteId, setBusyQuoteId] = useState<number | null>(null);
  const [selectedMonitorOrder, setSelectedMonitorOrder] =
    useState<SellerOrderDto | null>(null);
  const [selectedPartnerQuote, setSelectedPartnerQuote] =
    useState<SellerQuoteDto | null>(null);
  const [busyApproveOrderId, setBusyApproveOrderId] = useState<number | null>(null);
  const [confirmCancelOrder, setConfirmCancelOrder] = useState<SellerOrderDto | null>(
    null
  );
  const [cancelOrderReason, setCancelOrderReason] = useState("");
  const [busyCancelOrderId, setBusyCancelOrderId] = useState<number | null>(null);
  const [showAllMonitor, setShowAllMonitor] = useState(false);
  const [monitorSearch, setMonitorSearch] = useState("");
  const deferredMonitorSearch = useDeferredValue(monitorSearch);
  const [monitorStatusFilter, setMonitorStatusFilter] =
    useState<MonitorStatusFilter>("ALL");

  async function handleLoadMoreOrders() {
    if (loadingMoreOrders || !ordersPagination?.hasMore) return;
    setLoadingMoreOrders(true);
    try {
      const data = await fetchJson<PartnerOrdersResponseDto>(
        `/api/orders?limit=${ordersPagination.limit}&offset=${orders.length}`,
        { cache: "no-store" }
      );
      const nextRows: SellerOrderDto[] = data.orders || [];
      setOrders((prev) => {
        const seen = new Set(prev.map((o) => Number(o.order_id)));
        const merged = [...prev];
        for (const r of nextRows) {
          if (!seen.has(Number(r.order_id))) merged.push(r);
        }
        return merged;
      });
      setOrdersPagination(data.pagination || null);
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        (error.status === 401 || error.status === 403)
      ) {
        router.push("/login");
        return;
      }
      showFeedback(
        mutationErrorMessage(
          error,
          "No se pudieron cargar más pedidos.",
          "Error de red cargando más pedidos."
        ),
        true
      );
    } finally {
      setLoadingMoreOrders(false);
    }
  }

  // Cierre de ruta: se da por conciliada; el efectivo del día equivale a las ventas de la ruta.
  async function handlePartnerTripAction(tripId: number, salesPen: number) {
    if (busyTripId === tripId) return;
    setBusyTripId(tripId);
    try {
      const declaredNetCashPen = Math.max(0, Number(salesPen) || 0);
      await postJson("/api/trips", {
        action: "close_trip",
        tripId,
        nextStatus: "RECONCILED",
        declaredNetCashPen,
      });
      showFeedback("Ruta cerrada correctamente.");
      notifyLocalSync(["orders", "partners"]);
      await refreshDashboard(["orders", "partners"]);
    } catch (error) {
      showFeedback(
        mutationErrorMessage(
          error,
          "No se pudo actualizar la ruta.",
          "Error de red al actualizar ruta."
        ),
        true
      );
    } finally {
      setBusyTripId(null);
    }
  }

  async function handlePartnerConvertQuote(
    quoteId: number,
    paymentMode: "CASH" | "CREDIT"
  ) {
    if (busyQuoteId === quoteId) return;
    setBusyQuoteId(quoteId);
    try {
      const data = await postJson<QuoteConversionResponse>("/api/quotes", {
        action: "convert_to_order",
        quoteId,
        paymentMode,
        collectOnDelivery: paymentMode === "CASH",
        creditDays: paymentMode === "CREDIT" ? 7 : undefined,
      });
      showFeedback(
        `Cotización convertida en pedido ${data.order?.orderCode || ""} correctamente.`
      );
      notifyLocalSync(["orders", "inventory", "collections", "treasury", "partners"]);
      await refreshDashboard(["orders", "inventory", "collections", "partners"]);
    } catch (error) {
      showFeedback(
        mutationErrorMessage(
          error,
          "No se pudo convertir la cotización.",
          "Error de red al convertir cotización."
        ),
        true
      );
    } finally {
      setBusyQuoteId(null);
    }
  }

  async function handlePartnerCancelQuote(quoteId: number) {
    if (busyQuoteId === quoteId) return;
    setBusyQuoteId(quoteId);
    try {
      await postJson("/api/quotes", {
        action: "update_status",
        quoteId,
        nextStatus: "CANCELLED",
      });
      showFeedback("Cotización anulada correctamente.");
      notifyLocalSync(["orders", "partners"]);
      await refreshDashboard(["orders", "partners"]);
    } catch (error) {
      showFeedback(
        mutationErrorMessage(
          error,
          "No se pudo anular la cotización.",
          "Error de red al anular cotización."
        ),
        true
      );
    } finally {
      setBusyQuoteId(null);
    }
  }

  async function handleApproveDiscount(orderId: number) {
    if (busyApproveOrderId !== null) return;
    setFeedback(null);
    setBusyApproveOrderId(orderId);
    try {
      await postJson("/api/orders", { action: "approve", orderId });
      showFeedback(`Pedido #${orderId} aprobado y enviado a Almacén.`);
      notifyLocalSync(["orders", "inventory", "collections", "purchases", "partners"]);
      await refreshDashboard(["orders", "collections", "purchases", "partners"]);
    } catch (error) {
      showFeedback(
        mutationErrorMessage(
          error,
          "Error al aprobar",
          "Error de red al aprobar el pedido."
        ),
        true
      );
    } finally {
      setBusyApproveOrderId(null);
    }
  }

  async function handleConfirmCancelOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmCancelOrder || busyCancelOrderId !== null) return;
    const orderId = Number(confirmCancelOrder.order_id);
    const orderCode = String(confirmCancelOrder.order_code ?? `#${orderId}`);
    setFeedback(null);
    setBusyCancelOrderId(orderId);
    try {
      await postJson("/api/orders", {
        action: "cancel",
        orderId,
        reason: cancelOrderReason.trim() || "Anulado desde panel de control",
      });
      setConfirmCancelOrder(null);
      setCancelOrderReason("");
      if (selectedMonitorOrder && Number(selectedMonitorOrder.order_id) === orderId) {
        setSelectedMonitorOrder(null);
      }
      showFeedback(`Pedido ${orderCode} anulado correctamente.`);
      notifyLocalSync([
        "orders",
        "inventory",
        "collections",
        "treasury",
        "purchases",
        "partners",
      ]);
      await refreshDashboard([
        "orders",
        "collections",
        "treasury",
        "purchases",
        "partners",
      ]);
    } catch (error) {
      showFeedback(
        mutationErrorMessage(
          error,
          "No se pudo anular el pedido.",
          "Error de red al anular el pedido."
        ),
        true
      );
    } finally {
      setBusyCancelOrderId(null);
    }
  }

  const monitorFilteredOrders = useMemo(() => {
    const q = deferredMonitorSearch.trim().toLowerCase();
    return orders.filter((o) => {
      const status = String(o.operational_status ?? "").toUpperCase();
      if (monitorStatusFilter === "PENDING" && status !== "PENDING_PARTNER_APPROVAL") {
        return false;
      }
      if (monitorStatusFilter === "DELIVERED" && status !== "DELIVERED") {
        return false;
      }
      if (monitorStatusFilter === "CANCELLED" && status !== "CANCELLED") {
        return false;
      }
      if (!q) return true;
      return (
        String(o.order_code ?? "")
          .toLowerCase()
          .includes(q) ||
        String(o.customer_name ?? "")
          .toLowerCase()
          .includes(q) ||
        String(o.created_by_name ?? "")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [orders, deferredMonitorSearch, monitorStatusFilter]);

  const recentMonitorOrders = useMemo(() => {
    const hasFilter =
      monitorStatusFilter !== "ALL" || deferredMonitorSearch.trim().length > 0;
    return hasFilter ? monitorFilteredOrders : monitorFilteredOrders.slice(0, 35);
  }, [monitorFilteredOrders, monitorStatusFilter, deferredMonitorSearch]);

  return {
    loadingMoreOrders,
    busyTripId,
    busyQuoteId,
    selectedMonitorOrder,
    setSelectedMonitorOrder,
    selectedPartnerQuote,
    setSelectedPartnerQuote,
    busyApproveOrderId,
    confirmCancelOrder,
    setConfirmCancelOrder,
    cancelOrderReason,
    setCancelOrderReason,
    busyCancelOrderId,
    showAllMonitor,
    setShowAllMonitor,
    monitorSearch,
    setMonitorSearch,
    monitorStatusFilter,
    setMonitorStatusFilter,
    monitorFilteredOrders,
    recentMonitorOrders,
    handleLoadMoreOrders,
    handlePartnerTripAction,
    handlePartnerConvertQuote,
    handlePartnerCancelQuote,
    handleApproveDiscount,
    handleConfirmCancelOrder,
  };
}

export type OrderFlow = ReturnType<typeof useOrderFlow>;
