"use client";

import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { authClient } from "@/lib/auth/client";
import {
  type ApObligationItem,
  type AppUserItem,
  type AuditFlagCounts,
  type AuditFlagItem,
  type BiSummary,
  type CashAccountItem,
  type CashLedgerEntry,
  type CurrentUserInfo,
  type KpiQ1Summary,
  type PartnerCatalogItem,
  type PendingOnDemandItem,
  type RecentPurchaseItem,
  type SupplierItem,
  type UserAccessAuditItem,
  formatPen,
} from "@/components/socios/types";
import {
  AbonoModal,
  DebtorDetailModal,
  type DebtOrderDetail,
  PromiseFilterBar,
  PromiseStatusPill,
} from "@/components/shared/CollectionControls";
import {
  AppHeader,
  BottomNav,
  DesktopSidebar,
  type NavTabItem,
} from "@/components/ui/AppShell";
import {
  ActivityIcon,
  AlertTriangleIcon,
  BuildingIcon,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  EditIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
  ShoppingBagIcon,
  WalletIcon,
} from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
  SegmentedControl,
  ToastBanner,
} from "@/components/ui/Primitives";
import {
  formatFulfillmentModeEs,
  formatOperationalStatusEs,
  formatPromiseStatusEs,
  formatQuoteStatusEs,
  formatRoleEs,
  formatRouteTripStatusEs,
  formatUnitTitleEs,
} from "@/lib/labels-es";
import {
  notifyLocalSync,
  type SyncScope,
  useLiveSync,
} from "@/lib/realtime/useLiveSync";
import {
  canonicalPartnerUrl,
  partnerUrlForLegacyTab,
  resolvePartnerNavigation,
  type LegacyPartnerTab,
} from "@/lib/navigation";
import type { PriorityItem } from "@/features/partners/types";
import { deleteOfflineSnapshotsForActor } from "@/lib/offline/outbox";

type PartnerTab = LegacyPartnerTab;
type MonitorStatusFilter = "ALL" | "PENDING" | "DELIVERED" | "CANCELLED";

const DeferredSection = () => (
  <Card
    className="p-8 text-center text-sm font-medium text-[var(--ink-secondary)]"
    role="status"
  >
    Preparando sección…
  </Card>
);

const CajaProveedoresTab = dynamic(
  () => import("@/components/socios/CajaProveedoresTab"),
  { loading: DeferredSection }
);
const KpisBiTab = dynamic(() => import("@/components/socios/KpisBiTab"), {
  loading: DeferredSection,
});

const SOCIOS_SYNC_SCOPES: SyncScope[] = [
  "orders",
  "inventory",
  "collections",
  "treasury",
  "purchases",
  "partners",
];

function getMarginTone(
  marginPen: number,
  totalPen: number
): "danger" | "warning" | "success" {
  if (marginPen <= 0) return "danger";
  const pct = totalPen > 0 ? (marginPen / totalPen) * 100 : 0;
  if (pct < 20) return "warning";
  return "success";
}

function getMarginTextClass(marginPen: number, totalPen: number): string {
  const tone = getMarginTone(marginPen, totalPen);
  if (tone === "danger") return "text-[#B91C1C]";
  if (tone === "warning") return "text-[#B45309]";
  return "text-[#15803D]";
}

function formatActorName(rawName: unknown, fallback: string): string {
  const name = String(rawName ?? "").trim();
  if (!name) return fallback;
  if (/\bsocio\b/i.test(name) && /admin/i.test(name)) return "Ventas y Control";
  if (/\bsocio\b/i.test(name) && /gerente/i.test(name)) return "Gerencia";
  if (/vendedor/i.test(name) && /externo|ruta/i.test(name)) return "Vendedor";
  if (/^encargado de almac[eé]n$/i.test(name)) return "Almacén";
  if (/^(chofer|movilidad) y reparto$/i.test(name)) return "Almacén y Reparto";
  return name;
}

function operationalStatusTone(
  status: unknown
): "neutral" | "brand" | "success" | "warning" | "danger" {
  const s = String(status ?? "");
  if (s === "DELIVERED") return "success";
  if (s === "READY" || s === "IN_ROUTE") return "brand";
  if (s === "PENDING_PARTNER_APPROVAL" || s === "REGISTERED" || s === "PICKING") {
    return "warning";
  }
  if (s === "CANCELLED") return "danger";
  return "neutral";
}

function formatTraceabilitySummary(o: Record<string, unknown>): string {
  const creator = formatActorName(o.created_by_name, "Histórico");
  const picker = formatActorName(o.picked_by_name, "");
  const driver = formatActorName(o.delivered_by_name, "");
  const steps = [`Tomó: ${creator}`];
  if (picker && picker !== "-") steps.push(`Preparó: ${picker}`);
  if (driver && driver !== "-") steps.push(`Entregó: ${driver}`);
  return steps.join(" · ");
}

export default function SociosPage() {
  const dashboardAbortRef = useRef<AbortController | null>(null);
  const router = useRouter();
  const [tab, setTab] = useState<PartnerTab>("control");
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([]);
  const [ordersPagination, setOrdersPagination] = useState<{
    limit: number;
    offset: number;
    totalCount: number;
    hasMore: boolean;
  } | null>(null);
  const [loadingMoreOrders, setLoadingMoreOrders] = useState(false);
  const [routeTrips, setRouteTrips] = useState<Array<Record<string, unknown>>>([]);
  const [partnerQuotes, setPartnerQuotes] = useState<Array<Record<string, unknown>>>(
    []
  );
  const [busyTripId, setBusyTripId] = useState<number | null>(null);
  const [tripDeclaredNetById, setTripDeclaredNetById] = useState<
    Record<number, string>
  >({});
  const [busyQuoteId, setBusyQuoteId] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<PartnerCatalogItem[]>([]);
  const [debtorsByOrder, setDebtorsByOrder] = useState<Array<Record<string, unknown>>>(
    []
  );
  const [debtorsByCustomer, setDebtorsByCustomer] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [partnerData, setPartnerData] = useState<Record<string, unknown> | null>(null);
  const [treasuryData, setTreasuryData] = useState<Record<string, unknown> | null>(
    null
  );
  const [purchasesData, setPurchasesData] = useState<Record<string, unknown> | null>(
    null
  );
  const [orderAccounts, setOrderAccounts] = useState<CashAccountItem[]>([]);
  const [feedback, setFeedback] = useState<{
    msg: string;
    isError?: boolean;
  } | null>(null);

  const [preselectedPurchaseTarget, setPreselectedPurchaseTarget] = useState<{
    productId: number;
    quantity?: number;
    orderLineId?: number;
  } | null>(null);
  const [selectedMonitorOrder, setSelectedMonitorOrder] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [selectedPartnerQuote, setSelectedPartnerQuote] = useState<Record<
    string,
    unknown
  > | null>(null);

  // Action busy locks (anti-double-tap)
  const [busyApproveOrderId, setBusyApproveOrderId] = useState<number | null>(null);
  const [confirmCancelOrder, setConfirmCancelOrder] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [cancelOrderReason, setCancelOrderReason] = useState("");
  const [busyCancelOrderId, setBusyCancelOrderId] = useState<number | null>(null);
  const [busyResetStock, setBusyResetStock] = useState(false);
  const [busyLogout, setBusyLogout] = useState(false);
  const [subTabEditing, setSubTabEditing] = useState(false);

  // Stock & Pricing edit state
  const [searchSku, setSearchSku] = useState("");
  const deferredSearchSku = useDeferredValue(searchSku);
  const [showAllCatalog, setShowAllCatalog] = useState(false);
  const [showAllMonitor, setShowAllMonitor] = useState(false);
  const [monitorSearch, setMonitorSearch] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const deferredMonitorSearch = useDeferredValue(monitorSearch);
  const [monitorStatusFilter, setMonitorStatusFilter] =
    useState<MonitorStatusFilter>("ALL");
  const [editingProd, setEditingProd] = useState<PartnerCatalogItem | null>(null);
  const [editStock, setEditStock] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editMinPrice, setEditMinPrice] = useState("");
  const [editMode, setEditMode] = useState<"STOCKED" | "ON_DEMAND">("STOCKED");
  const [busySaveProduct, setBusySaveProduct] = useState(false);

  // Abono & Debtors state
  const [promiseFilter, setPromiseFilter] = useState("ALL");
  const [debtorSearch, setDebtorSearch] = useState("");
  const deferredDebtorSearch = useDeferredValue(debtorSearch);
  const [abonoOrder, setAbonoOrder] = useState<Record<string, unknown> | null>(null);
  const [fifoCustomer, setFifoCustomer] = useState<Record<string, unknown> | null>(
    null
  );
  const [debtDetailTarget, setDebtDetailTarget] = useState<
    | {
        mode: "customer";
        customerKey: string;
        customerName: string;
        customerPartyId: number | null;
      }
    | { mode: "order"; orderId: number }
    | null
  >(null);
  const [abonoAmount, setAbonoAmount] = useState("");
  const [abonoMode, setAbonoMode] = useState<"CASH" | "YAPE_PLIN" | "TRANSFER">("CASH");
  const [abonoNextDays, setAbonoNextDays] = useState<number>(7);
  const [abonoAccountId, setAbonoAccountId] = useState<string>("");
  const [busyAbono, setBusyAbono] = useState(false);
  const [confirmResetNegativeOpen, setConfirmResetNegativeOpen] = useState(false);

  const showFeedback = useCallback((msg: string, isError = false) => {
    setFeedback({ msg, isError });
  }, []);

  const refreshDashboard = useCallback(
    async (changedScopes?: SyncScope[], options?: { throwOnError?: boolean }) => {
      const scopeSet =
        changedScopes && changedScopes.length > 0
          ? new Set<SyncScope>(changedScopes)
          : null;

      const needOrders =
        !scopeSet || scopeSet.has("orders") || scopeSet.has("inventory");
      const needCollections =
        !scopeSet || scopeSet.has("collections") || scopeSet.has("orders");
      const needTreasury =
        !scopeSet ||
        scopeSet.has("treasury") ||
        scopeSet.has("collections") ||
        scopeSet.has("purchases");
      const needPurchases =
        !scopeSet ||
        scopeSet.has("purchases") ||
        scopeSet.has("inventory") ||
        scopeSet.has("orders");
      const needPartners =
        !scopeSet ||
        scopeSet.has("partners") ||
        scopeSet.has("orders") ||
        scopeSet.has("collections") ||
        scopeSet.has("treasury") ||
        scopeSet.has("purchases") ||
        scopeSet.has("inventory");

      if (
        !needOrders &&
        !needCollections &&
        !needTreasury &&
        !needPurchases &&
        !needPartners
      ) {
        return;
      }

      dashboardAbortRef.current?.abort();
      const controller = new AbortController();
      dashboardAbortRef.current = controller;
      try {
        const noStoreInit: RequestInit = {
          cache: "no-store",
          signal: controller.signal,
        };
        const [ordRes, colRes, partRes, trRes, purRes, tripsRes, quotesRes] =
          await Promise.all([
            needOrders ? fetch("/api/orders", noStoreInit) : Promise.resolve(null),
            needCollections
              ? fetch("/api/collections", noStoreInit)
              : Promise.resolve(null),
            needPartners ? fetch("/api/partners", noStoreInit) : Promise.resolve(null),
            needTreasury ? fetch("/api/treasury", noStoreInit) : Promise.resolve(null),
            needPurchases
              ? fetch("/api/purchases", noStoreInit)
              : Promise.resolve(null),
            needOrders || needPartners
              ? fetch("/api/trips", noStoreInit).catch(() => null)
              : Promise.resolve(null),
            needOrders || needPartners
              ? fetch("/api/quotes", noStoreInit).catch(() => null)
              : Promise.resolve(null),
          ]);

        const responses = [ordRes, colRes, partRes, trRes, purRes].filter(
          (r): r is Response => r !== null
        );

        if (responses.some((r) => r.status === 401 || r.status === 403)) {
          router.push("/login");
          return;
        }

        if (options?.throwOnError && responses.some((r) => !r.ok)) {
          throw new Error("Sync fetch returned non-OK status");
        }

        const [ordJson, colJson, partJson, trJson, purJson, tripsJson, quotesJson] =
          await Promise.all([
            ordRes && ordRes.ok ? ordRes.json() : Promise.resolve(null),
            colRes && colRes.ok ? colRes.json() : Promise.resolve(null),
            partRes && partRes.ok ? partRes.json() : Promise.resolve(null),
            trRes && trRes.ok ? trRes.json() : Promise.resolve(null),
            purRes && purRes.ok ? purRes.json() : Promise.resolve(null),
            tripsRes && tripsRes.ok ? tripsRes.json() : Promise.resolve(null),
            quotesRes && quotesRes.ok ? quotesRes.json() : Promise.resolve(null),
          ]);

        if (ordJson) {
          setOrders(ordJson.orders || []);
          setOrdersPagination(ordJson.pagination || null);
          setCatalog(ordJson.catalog || []);
          setOrderAccounts(ordJson.accounts || []);
        }
        if (tripsJson && Array.isArray(tripsJson.trips)) {
          setRouteTrips(tripsJson.trips);
        }
        if (quotesJson && Array.isArray(quotesJson.quotes)) {
          setPartnerQuotes(quotesJson.quotes);
        }
        if (colJson) {
          setDebtorsByOrder(colJson.byOrder || []);
          setDebtorsByCustomer(colJson.byCustomer || []);
        }
        if (partJson) {
          setPartnerData(partJson);
        }
        if (trJson) {
          setTreasuryData(trJson);
        }
        if (purJson) {
          setPurchasesData(purJson);
        }

        if (!scopeSet && responses.some((r) => !r.ok)) {
          showFeedback("Algunos módulos no pudieron actualizarse por completo.", true);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (options?.throwOnError) {
          throw err;
        }
        if (!scopeSet) {
          showFeedback("Error de red cargando el panel operativo.", true);
        }
      } finally {
        if (dashboardAbortRef.current === controller) {
          dashboardAbortRef.current = null;
          setLoading(false);
        }
      }
    },
    [router, showFeedback]
  );

  useEffect(() => () => dashboardAbortRef.current?.abort(), []);

  const loadDashboard = useCallback(async () => {
    await refreshDashboard();
  }, [refreshDashboard]);

  async function handleLoadMoreOrders() {
    if (loadingMoreOrders || !ordersPagination?.hasMore) return;
    setLoadingMoreOrders(true);
    try {
      const res = await fetch(
        `/api/orders?limit=${ordersPagination.limit}&offset=${orders.length}`,
        { cache: "no-store" }
      );
      if (res.status === 401 || res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        showFeedback(data.error || "No se pudieron cargar más pedidos.", true);
        return;
      }
      const nextRows: Array<Record<string, unknown>> = data.orders || [];
      setOrders((prev) => {
        const seen = new Set(prev.map((o) => Number(o.order_id)));
        const merged = [...prev];
        for (const r of nextRows) {
          if (!seen.has(Number(r.order_id))) merged.push(r);
        }
        return merged;
      });
      setOrdersPagination(data.pagination || null);
    } catch {
      showFeedback("Error de red cargando más pedidos.", true);
    } finally {
      setLoadingMoreOrders(false);
    }
  }

  async function handlePartnerTripAction(
    tripId: number,
    nextStatus: "CLOSED" | "RECONCILED"
  ) {
    if (busyTripId === tripId) return;
    setBusyTripId(tripId);
    try {
      const rawNet = tripDeclaredNetById[tripId];
      const declaredNetCashPen =
        nextStatus === "RECONCILED" && rawNet !== undefined && rawNet.trim() !== ""
          ? Number(rawNet)
          : undefined;
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "close_trip",
          tripId,
          nextStatus,
          declaredNetCashPen,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showFeedback(data.error || "No se pudo actualizar la ruta.", true);
        return;
      }
      showFeedback(
        nextStatus === "RECONCILED"
          ? "Ruta conciliada correctamente."
          : "Ruta cerrada correctamente."
      );
      notifyLocalSync(["orders", "partners"]);
      await refreshDashboard(["orders", "partners"]);
    } catch {
      showFeedback("Error de red al actualizar ruta.", true);
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
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "convert_to_order",
          quoteId,
          paymentMode,
          collectOnDelivery: paymentMode === "CASH",
          creditDays: paymentMode === "CREDIT" ? 7 : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showFeedback(data.error || "No se pudo convertir la cotización.", true);
        return;
      }
      showFeedback(
        `Cotización convertida en pedido ${data.order?.orderCode || ""} correctamente.`
      );
      notifyLocalSync(["orders", "inventory", "collections", "treasury", "partners"]);
      await refreshDashboard(["orders", "inventory", "collections", "partners"]);
    } catch {
      showFeedback("Error de red al convertir cotización.", true);
    } finally {
      setBusyQuoteId(null);
    }
  }

  async function handlePartnerCancelQuote(quoteId: number) {
    if (busyQuoteId === quoteId) return;
    setBusyQuoteId(quoteId);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_status",
          quoteId,
          nextStatus: "CANCELLED",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showFeedback(data.error || "No se pudo anular la cotización.", true);
        return;
      }
      showFeedback("Cotización anulada correctamente.");
      notifyLocalSync(["orders", "partners"]);
      await refreshDashboard(["orders", "partners"]);
    } catch {
      showFeedback("Error de red al anular cotización.", true);
    } finally {
      setBusyQuoteId(null);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const syncFromUrl = () => {
      const current = new URL(window.location.href);
      const resolved = resolvePartnerNavigation(current.searchParams);
      setTab(resolved.legacyTab);
      const canonical = canonicalPartnerUrl(current);
      if (canonical.search !== current.search) {
        router.replace(canonical.pathname + canonical.search + canonical.hash, {
          scroll: false,
        });
      }
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [router]);

  const isEditingOrModalOpen = Boolean(
    editingProd ||
    abonoOrder ||
    fifoCustomer ||
    confirmResetNegativeOpen ||
    confirmCancelOrder ||
    subTabEditing
  );

  const handleRemoteChange = useCallback(
    async (changedScopes: SyncScope[]) => {
      await refreshDashboard(changedScopes, { throwOnError: true });
    },
    [refreshDashboard]
  );

  const handleSyncAuthError = useCallback(() => {
    router.push("/login");
  }, [router]);

  const { liveStatus, triggerSync } = useLiveSync({
    onRemoteChange: handleRemoteChange,
    scopes: SOCIOS_SYNC_SCOPES,
    enabled: !isEditingOrModalOpen,
    onAuthError: handleSyncAuthError,
  });

  const handleTabChange = useCallback((nextTab: PartnerTab) => {
    setSubTabEditing(false);
    setTab(nextTab);
    if (typeof window !== "undefined") {
      const current = new URL(window.location.href);
      const url = partnerUrlForLegacyTab(current, nextTab);
      if (url.search !== current.search) {
        window.history.pushState(null, "", url.pathname + url.search + url.hash);
      }
    }
  }, []);

  async function handleApproveDiscount(orderId: number) {
    if (busyApproveOrderId !== null) return;
    setFeedback(null);
    setBusyApproveOrderId(orderId);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", orderId }),
      });
      const data = await res.json();
      if (res.ok) {
        showFeedback(`Pedido #${orderId} aprobado y enviado a Almacén.`);
        notifyLocalSync([
          "orders",
          "inventory",
          "collections",
          "purchases",
          "partners",
        ]);
        await refreshDashboard(["orders", "collections", "purchases", "partners"]);
      } else {
        showFeedback(data.error || "Error al aprobar", true);
      }
    } catch {
      showFeedback("Error de red al aprobar el pedido.", true);
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
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          orderId,
          reason: cancelOrderReason.trim() || "Anulado desde panel de control",
        }),
      });
      const data = await res.json();
      if (res.ok) {
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
      } else {
        showFeedback(data.error || "No se pudo anular el pedido.", true);
      }
    } catch {
      showFeedback("Error de red al anular el pedido.", true);
    } finally {
      setBusyCancelOrderId(null);
    }
  }

  const openAbonoForOrderRecord = useCallback((o: Record<string, unknown>) => {
    const totalPen = Number(o.total_pen ?? 0);
    const balanceDuePen = Math.max(0, Number(o.balance_due_pen ?? 0));
    const paidPen = Number(o.paid_pen ?? Math.max(0, totalPen - balanceDuePen));
    setFifoCustomer(null);
    setAbonoOrder({
      orderId: Number(o.order_id),
      orderCode: String(o.order_code ?? ""),
      customerName: String(o.customer_name ?? ""),
      totalPen,
      paidPen,
      balanceDuePen,
    });
    setAbonoAmount(balanceDuePen.toFixed(2));
    setAbonoAccountId("");
  }, []);

  async function handleResetNegativeStock() {
    if (busyResetStock) return;
    setFeedback(null);
    setBusyResetStock(true);
    try {
      const res = await fetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_negative_stock" }),
      });
      const data = await res.json();
      if (res.ok) {
        setConfirmResetNegativeOpen(false);
        showFeedback(
          `¡Listo! Se pusieron en 0 exactamente ${data.adjustedSkuCount} productos con saldo negativo histórico.`
        );
        notifyLocalSync(["inventory", "partners"]);
        await refreshDashboard(["inventory", "partners"]);
      } else {
        showFeedback(data.error || "Error al poner en 0 saldos negativos", true);
      }
    } catch {
      showFeedback("Error de red regularizando saldos negativos.", true);
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
      const res = await fetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_product",
          productId: editingProd.product_id,
          physicalStock: editStock,
          refCostPen: editCost,
          listSalePricePen: editPrice,
          minSalePricePen: editMinPrice,
          fulfillmentMode: editMode,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showFeedback(`Producto ${editingProd.sku} actualizado.`);
        setEditingProd(null);
        notifyLocalSync(["inventory", "partners"]);
        await refreshDashboard(["inventory", "partners"]);
      } else {
        showFeedback(data.error || "Error al actualizar producto", true);
      }
    } catch {
      showFeedback("Error de red al guardar el producto.", true);
    } finally {
      setBusySaveProduct(false);
    }
  }

  async function handleSaveAbono(e: React.FormEvent) {
    e.preventDefault();
    if ((!abonoOrder && !fifoCustomer) || busyAbono) return;
    setFeedback(null);
    setBusyAbono(true);
    try {
      const activeBalanceDue = fifoCustomer
        ? Number(fifoCustomer.totalBalanceDuePen ?? 0)
        : Number(abonoOrder?.balanceDuePen ?? 0);
      const parsedAbono = Number(abonoAmount);
      const isFullSettlement =
        Number.isFinite(parsedAbono) &&
        activeBalanceDue > 0 &&
        parsedAbono >= activeBalanceDue - 0.05;
      const selectedAccId = abonoAccountId ? Number(abonoAccountId) : undefined;
      const payload = fifoCustomer
        ? {
            mode: "fifo_customer",
            customerPartyId: Number(fifoCustomer.customerPartyId),
            totalAmountPen: parsedAbono,
            paymentMode: abonoMode,
            accountId: selectedAccId,
            nextCollectionDays: isFullSettlement ? null : abonoNextDays,
            notes:
              "Abono general a cuenta registrado por Socio o Gerencia (deudas más antiguas)",
          }
        : {
            mode: "single_order",
            orderId: Number(abonoOrder!.orderId),
            amountPen: parsedAbono,
            paymentMode: abonoMode,
            accountId: selectedAccId,
            nextCollectionDays: isFullSettlement ? null : abonoNextDays,
            notes: "Cobro registrado por Socio o Gerencia",
          };
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        showFeedback("Abono registrado correctamente.");
        setAbonoOrder(null);
        setFifoCustomer(null);
        setAbonoAmount("");
        setAbonoAccountId("");
        notifyLocalSync(["collections", "orders", "treasury", "partners"]);
        await refreshDashboard(["collections", "orders", "treasury", "partners"]);
      } else {
        showFeedback(data.error || "Error al registrar abono", true);
      }
    } catch {
      showFeedback("Error de red al registrar abono.", true);
    } finally {
      setBusyAbono(false);
    }
  }

  const handleGoToPurchaseProduct = useCallback(
    (
      target: number | { productId: number; quantity?: number; orderLineId?: number }
    ) => {
      const normalized = typeof target === "number" ? { productId: target } : target;
      setPreselectedPurchaseTarget(normalized);
      setSubTabEditing(false);
      handleTabChange("caja");
    },
    [handleTabChange]
  );

  const handleGoToEditProduct = useCallback(
    (sku: string) => {
      setSearchSku(sku);
      const found = catalog.find((p) => p.sku.toLowerCase() === sku.toLowerCase());
      if (found) {
        openEditProduct(found);
        return;
      }
      handleTabChange("stock");
    },
    [catalog, openEditProduct, handleTabChange]
  );

  const pendingApprovals = useMemo(
    () => orders.filter((o) => o.operational_status === "PENDING_PARTNER_APPROVAL"),
    [orders]
  );

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

  const pendingOnDemand =
    ((purchasesData?.pendingOnDemand ??
      partnerData?.pendingOnDemand) as PendingOnDemandItem[]) || [];
  const kpiQ1 = (partnerData?.kpiQ1 as KpiQ1Summary) || null;
  const kpiQ2TopSkus =
    (partnerData?.kpiQ2TopSkus as Array<Record<string, unknown>>) || [];
  const qualityGaps =
    (partnerData?.qualityGaps as Array<Record<string, unknown>>) || [];
  const negStockCount = Number(partnerData?.negativeStockSkuCount ?? 0);
  const currentUser = (partnerData?.currentUser as CurrentUserInfo | null) || null;
  const biSummary = (partnerData?.biSummary as BiSummary | null) || null;
  const appUsers = (partnerData?.users as AppUserItem[]) || [];
  const userAccessHistory =
    (partnerData?.userAccessHistory as UserAccessAuditItem[]) || [];

  const accounts: CashAccountItem[] =
    (purchasesData?.accounts as CashAccountItem[]) ||
    (treasuryData?.accounts as CashAccountItem[]) ||
    orderAccounts;
  const ledger: CashLedgerEntry[] = (treasuryData?.ledger as CashLedgerEntry[]) || [];
  const apObligations = useMemo<ApObligationItem[]>(
    () =>
      (purchasesData?.apObligations as ApObligationItem[]) ||
      (treasuryData?.apObligations as ApObligationItem[]) ||
      [],
    [purchasesData?.apObligations, treasuryData?.apObligations]
  );
  const suppliers: SupplierItem[] =
    (purchasesData?.suppliers as SupplierItem[]) ||
    (treasuryData?.suppliers as SupplierItem[]) ||
    [];
  const recentPurchases: RecentPurchaseItem[] =
    (purchasesData?.recentPurchases as RecentPurchaseItem[]) || [];

  const openApCount = useMemo(
    () =>
      apObligations.filter((ap) => ap.status === "OPEN" || ap.status === "PARTIAL")
        .length,
    [apObligations]
  );

  const openDebtorsCount = Number(
    partnerData?.openDebtorsCount ?? kpiQ1?.open_debtors_count ?? debtorsByOrder.length
  );

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

  const filteredDebtorsByCustomer = useMemo(() => {
    const q = deferredDebtorSearch.trim().toLowerCase();
    if (!q) return debtorsByCustomer;
    return debtorsByCustomer.filter((c) =>
      String(c.customerName ?? "")
        .toLowerCase()
        .includes(q)
    );
  }, [debtorsByCustomer, deferredDebtorSearch]);

  const filteredDebtorsByOrder = useMemo(() => {
    const q = deferredDebtorSearch.trim().toLowerCase();
    return debtorsByOrder.filter((o) => {
      if (promiseFilter !== "ALL" && o.promiseStatus !== promiseFilter) {
        return false;
      }
      if (!q) return true;
      return (
        String(o.customerName ?? "")
          .toLowerCase()
          .includes(q) ||
        String(o.orderCode ?? "")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [debtorsByOrder, promiseFilter, deferredDebtorSearch]);

  const collectionSummary = useMemo(() => {
    const total = debtorsByOrder.reduce(
      (sum, order) => sum + Number(order.balanceDuePen || 0),
      0
    );
    const dueSoon = debtorsByOrder
      .filter((order) => order.promiseStatus === "DUE_TODAY_OR_TOMORROW")
      .reduce((sum, order) => sum + Number(order.balanceDuePen || 0), 0);
    const overdue = debtorsByOrder
      .filter((order) => order.promiseStatus === "PROMISE_BROKEN")
      .reduce((sum, order) => sum + Number(order.balanceDuePen || 0), 0);
    return { total, dueSoon, overdue };
  }, [debtorsByOrder]);

  const prioritizedDebtorsByOrder = useMemo(() => {
    const priority = (status: string) =>
      status === "PROMISE_BROKEN" ? 0 : status === "DUE_TODAY_OR_TOMORROW" ? 1 : 2;
    return [...filteredDebtorsByOrder].sort(
      (a, b) =>
        priority(String(a.promiseStatus)) - priority(String(b.promiseStatus)) ||
        Number(b.balanceDuePen) - Number(a.balanceDuePen)
    );
  }, [filteredDebtorsByOrder]);

  const headerRoleBadge = useMemo(() => {
    if (!currentUser) return "Control Operativo";
    const operationalArea =
      currentUser.role === "PARTNER_MANAGER"
        ? "Gerencia"
        : currentUser.role === "PARTNER_ADMIN"
          ? "Ventas y Control"
          : formatRoleEs(currentUser.role);
    const cleanName = formatActorName(currentUser.fullName, "");
    if (
      cleanName &&
      cleanName.toLowerCase() !== operationalArea.toLowerCase() &&
      cleanName !== "Asistente" &&
      cleanName !== "Gerente" &&
      cleanName !== "Gerencia" &&
      cleanName !== "Ventas y Control"
    ) {
      return `${cleanName} · ${operationalArea}`;
    }
    return operationalArea;
  }, [currentUser]);

  const navItems: NavTabItem<PartnerTab>[] = useMemo(
    () => [
      {
        id: "control",
        label: "Hoy",
        mobileLabel: "Hoy",
        icon: <ActivityIcon className="h-4 w-4" />,
        badgeCount: pendingApprovals.length,
      },
      {
        id: "pedidos",
        label: "Ventas",
        mobileLabel: "Ventas",
        icon: <ShoppingBagIcon className="h-4 w-4" />,
        badgeCount: ordersPagination?.totalCount,
      },
      {
        id: "deudores",
        label: "Cobranza",
        mobileLabel: "Cobrar",
        icon: <WalletIcon className="h-4 w-4" />,
        badgeCount: debtorsByOrder.length,
      },
      {
        id: "stock",
        label: "Inventario",
        mobileLabel: "Inventario",
        icon: <PackageIcon className="h-4 w-4" />,
        badgeCount: negStockCount,
      },
      {
        id: "caja",
        label: "Finanzas y análisis",
        mobileLabel: "Finanzas",
        icon: <BuildingIcon className="h-4 w-4" />,
        badgeCount: openApCount,
      },
    ],
    [
      pendingApprovals.length,
      ordersPagination?.totalCount,
      debtorsByOrder.length,
      negStockCount,
      openApCount,
    ]
  );

  const activeTabLabel =
    navItems.find((item) => item.id === (tab === "kpis" ? "caja" : tab))?.label ??
    "Hoy";
  const navActiveTab: PartnerTab = tab === "kpis" ? "caja" : tab;
  const brokenPromisesCount = useMemo(
    () =>
      debtorsByOrder.filter((item) => String(item.promiseStatus) === "PROMISE_BROKEN")
        .length,
    [debtorsByOrder]
  );
  const priorityItems: PriorityItem[] = useMemo(
    () => [
      {
        id: "discount-decisions",
        category: "decision",
        level: pendingApprovals.length > 0 ? "critical" : "clear",
        title: "Descuentos y bloqueos",
        summary:
          pendingApprovals.length > 0
            ? `${pendingApprovals.length} pedido(s) requieren una decisión autorizada.`
            : "No hay decisiones pendientes en este momento.",
        dueLabel: pendingApprovals.length > 0 ? "Ahora" : "Al día",
        entity: { type: "order", count: pendingApprovals.length },
        allowedAction: "review-decisions",
      },
      {
        id: "broken-promises",
        category: "cash",
        level: brokenPromisesCount > 0 ? "due" : "clear",
        title: "Promesas de pago vencidas",
        summary:
          brokenPromisesCount > 0
            ? `${brokenPromisesCount} compromiso(s) requieren seguimiento.`
            : "No hay promesas vencidas registradas.",
        dueLabel: brokenPromisesCount > 0 ? "Vencido" : "Al día",
        entity: { type: "collection", count: brokenPromisesCount },
        allowedAction: "open-collections",
      },
      {
        id: "pending-purchases",
        category: "operation",
        level: pendingOnDemand.length > 0 ? "attention" : "clear",
        title: "Compras bajo pedido",
        summary:
          pendingOnDemand.length > 0
            ? `${pendingOnDemand.length} línea(s) esperan gestión con proveedor.`
            : "No hay compras bajo pedido pendientes.",
        dueLabel: pendingOnDemand.length > 0 ? "Pendiente" : "Al día",
        entity: { type: "purchase", count: pendingOnDemand.length },
        allowedAction: "open-finance",
      },
      {
        id: "inventory-risks",
        category: "risk",
        level: negStockCount > 0 ? "attention" : "clear",
        title: "Riesgos de inventario",
        summary:
          negStockCount > 0
            ? `${negStockCount} saldo(s) negativos requieren revisión.`
            : "No hay saldos negativos históricos pendientes.",
        dueLabel: negStockCount > 0 ? "Revisar" : "Al día",
        entity: { type: "inventory", count: negStockCount },
        allowedAction: "open-inventory",
      },
    ],
    [
      brokenPromisesCount,
      negStockCount,
      pendingApprovals.length,
      pendingOnDemand.length,
    ]
  );

  const handlePriorityAction = useCallback(
    (action: PriorityItem["allowedAction"]) => {
      if (action === "open-collections") return handleTabChange("deudores");
      if (action === "open-finance") return handleTabChange("caja");
      if (action === "open-inventory") return handleTabChange("stock");
      document.getElementById("discount-approval-queue")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    },
    [handleTabChange]
  );

  function handleGlobalSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = globalSearch.trim();
    if (!query) {
      handleTabChange("pedidos");
      return;
    }
    setMonitorSearch(query);
    setMonitorStatusFilter("ALL");
    setShowAllMonitor(true);
    handleTabChange("pedidos");
  }

  // Live margin preview when editing product
  const previewCost = Number(editCost);
  const previewPrice = Number(editPrice);
  const previewMin = Number(editMinPrice);
  const hasPreviewCost = editCost.trim() !== "" && Number.isFinite(previewCost);

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-24 md:pb-12">
      <AppHeader
        title="Control Operativo"
        roleLabel={headerRoleBadge}
        roleTone="horizon"
        roleDotColor="bg-[#075EE8]"
        syncStatus={liveStatus}
        onSyncClick={() => void triggerSync({ force: true })}
        maxWidth="7xl"
        withSidebar
        actions={
          <div className="hidden sm:inline-flex items-center gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={() => router.push("/vendedor")}
              className="min-h-[38px] sm:min-h-[40px] px-4 text-xs sm:text-sm shadow-[0_2px_8px_rgba(15,41,66,0.16)]"
            >
              <PlusIcon className="h-4 w-4" />
              <span>Tomar Pedido</span>
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => router.push("/almacen")}
              className="min-h-[38px] sm:min-h-[40px] px-3.5 text-xs sm:text-sm"
            >
              Almacén
            </Button>
          </div>
        }
        onLogout={async () => {
          if (busyLogout) return;
          setBusyLogout(true);
          try {
            if (currentUser?.username) {
              await deleteOfflineSnapshotsForActor(currentUser.username).catch(
                () => undefined
              );
            }
            await authClient.signOut();
          } finally {
            setBusyLogout(false);
            router.push("/login");
          }
        }}
      />

      <DesktopSidebar
        items={navItems}
        activeId={navActiveTab}
        onChange={handleTabChange}
        areaLabel="Socios · Control"
        footer="Equipo y acceso se mantiene en administración."
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-7xl px-3.5 pt-4 sm:px-5 space-y-4 focus:outline-none md:ml-[232px] md:max-w-none md:px-6 lg:px-8"
      >
        {tab !== "control" && (
          <div className="grid grid-cols-[2fr_1fr] gap-2 sm:hidden">
            <Button
              variant="primary"
              size="md"
              onClick={() => router.push("/vendedor")}
              className="w-full shadow-[0_2px_8px_rgba(15,41,66,0.16)]"
            >
              <ShoppingBagIcon className="h-4 w-4" />
              <span>Tomar Pedido</span>
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => router.push("/almacen")}
              className="w-full"
            >
              <span>Almacén</span>
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-xl border border-[#E2E8F0] bg-white p-3 sm:flex-row sm:items-center sm:justify-between sm:p-3.5">
          <div className="flex min-w-0 items-center gap-2 text-xs text-[#6D6A64]">
            <span className="font-medium text-[#5C5A55]">Inicio</span>
            <ChevronRightIcon
              className="h-3.5 w-3.5 text-[#A8A49C]"
              aria-hidden="true"
            />
            <span className="truncate font-semibold text-[#0F2942]">
              {activeTabLabel}
            </span>
          </div>
          <form
            onSubmit={handleGlobalSearchSubmit}
            className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md"
            role="search"
            aria-label="Búsqueda global"
          >
            <div className="relative min-w-0 flex-1">
              <SearchIcon
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6D6A64]"
                aria-hidden="true"
              />
              <input
                type="search"
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
                placeholder="Buscar pedido, cliente o vendedor..."
                aria-label="Buscar pedido, cliente o vendedor"
                className={`${INPUT_CLASS} py-2.5 pl-10 pr-3 text-xs`}
              />
            </div>
            <Button
              type="submit"
              variant="brand"
              size="sm"
              className="min-h-[42px] shrink-0"
            >
              Buscar
            </Button>
          </form>
        </div>

        {feedback && (
          <ToastBanner
            type={feedback.isError ? "err" : "ok"}
            message={feedback.msg}
            onDismiss={() => setFeedback(null)}
          />
        )}

        {loading && !partnerData && (
          <Card className="p-10 text-center text-sm font-medium text-[#5C5A55]">
            Cargando datos en vivo desde Neon PostgreSQL...
          </Card>
        )}

        {tab === "control" && (
          <div className="flex flex-col gap-5">
            <div className="order-0 flex flex-col gap-1 px-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-bold text-[var(--bht-navy)] sm:text-2xl">
                  Primero, resuelve lo que bloquea la operación
                </h2>
                <p className="mt-1 text-sm text-[var(--ink-secondary)]">
                  Decisiones, caja, operación y riesgos ordenados por acción.
                </p>
              </div>
              <span className="mt-2 text-xs font-medium text-[var(--ink-secondary)] sm:mt-0">
                Hoy · America/Lima
              </span>
            </div>
            <Card
              padding="none"
              className="order-1 overflow-hidden border-[var(--border-strong)]"
            >
              <div className="flex items-center justify-between gap-3 border-b border-[var(--border-hairline)] px-4 py-3.5 sm:px-5">
                <div>
                  <h3 className="text-base font-bold text-[var(--bht-navy)]">
                    Cola priorizada
                  </h3>
                  <p className="mt-0.5 text-xs text-[var(--ink-secondary)]">
                    Ordenada por impacto, vencimiento y acción permitida.
                  </p>
                </div>
                <Badge
                  tone={
                    priorityItems.some((item) => item.entity.count > 0)
                      ? "warning"
                      : "success"
                  }
                >
                  {priorityItems.reduce((sum, item) => sum + item.entity.count, 0)}{" "}
                  pendientes
                </Badge>
              </div>
              <div className="divide-y divide-[var(--border-hairline)]">
                {priorityItems.map((item) => {
                  const Icon =
                    item.category === "decision"
                      ? ActivityIcon
                      : item.category === "cash"
                        ? WalletIcon
                        : item.category === "operation"
                          ? ShoppingBagIcon
                          : AlertTriangleIcon;
                  return (
                    <div
                      key={item.id}
                      className="grid gap-3 px-4 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-5"
                    >
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-xl ${item.level === "clear" ? "bg-[#F2F6FA] text-[var(--bht-steel)]" : item.level === "critical" ? "bg-[#FEF2F2] text-[#B91C1C]" : "bg-[#FFF7E8] text-[#9A5A00]"}`}
                        aria-hidden="true"
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-semibold text-[var(--bht-ink)]">
                            {item.title}
                          </h4>
                          <span className="text-xs font-semibold text-[var(--ink-secondary)]">
                            {item.dueLabel}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--ink-secondary)]">
                          {item.summary}
                        </p>
                      </div>
                      <Button
                        variant={item.entity.count > 0 ? "primary" : "outline"}
                        size="sm"
                        onClick={() => handlePriorityAction(item.allowedAction)}
                        className="w-full sm:w-auto"
                      >
                        {item.entity.count > 0 ? "Resolver" : "Revisar"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </Card>
            {/* Primary Order Intake Action Hub */}
            <Card
              accent="horizon"
              padding="md"
              className="order-4 border-[var(--border-hairline)] bg-white"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#0F2942] text-white shadow-[0_2px_6px_rgba(15,41,66,0.18)]">
                    <ShoppingBagIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm sm:text-base font-semibold text-[#0F2942]">
                      Toma Rápida de Pedidos y Ventas
                    </h2>
                    <p className="mt-0.5 text-xs text-[#5C5A55]">
                      Registra pedidos nuevos, busca clientes y cobra en ruta
                      directamente.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:flex-shrink-0">
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => router.push("/vendedor")}
                    className="flex-1 sm:flex-initial min-h-[44px] px-5 shadow-[0_2px_10px_rgba(15,41,66,0.18)]"
                  >
                    <PlusIcon className="h-4 w-4" />
                    <span>Tomar Nuevo Pedido</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => router.push("/almacen")}
                    className="sm:hidden min-h-[44px]"
                  >
                    Almacén
                  </Button>
                </div>
              </div>
            </Card>

            {/* Executive Quick Glance Strip ordered by operational priority */}
            <div className="order-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <button
                type="button"
                onClick={() => handleTabChange("control")}
                className="group rounded-2xl border border-[#E7E5E0] bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,41,66,0.03)] transition hover:border-[#1E446B]/45 hover:shadow-[0_2px_8px_rgba(15,41,66,0.06)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#4A4843]">
                    Pend. Aprobación
                  </span>
                  <span
                    className="text-xs text-[#6D6A64] transition group-hover:translate-x-0.5 group-hover:text-[#0F2942]"
                    aria-hidden="true"
                  >
                    →
                  </span>
                </div>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-[#0F2942] tabular-nums">
                  {pendingApprovals.length}
                </p>
              </button>
              <button
                type="button"
                onClick={() => handleTabChange("deudores")}
                className="group rounded-2xl border border-[#E7E5E0] bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,41,66,0.03)] transition hover:border-[#1E446B]/45 hover:shadow-[0_2px_8px_rgba(15,41,66,0.06)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#4A4843]">
                    Pedidos por cobrar
                  </span>
                  <span
                    className="text-xs text-[#6D6A64] transition group-hover:translate-x-0.5 group-hover:text-[#0F2942]"
                    aria-hidden="true"
                  >
                    →
                  </span>
                </div>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-[#B91C1C] tabular-nums">
                  {debtorsByOrder.length}
                </p>
              </button>
              <button
                type="button"
                onClick={() => handleTabChange("caja")}
                className="group rounded-2xl border border-[#E7E5E0] bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,41,66,0.03)] transition hover:border-[#1E446B]/45 hover:shadow-[0_2px_8px_rgba(15,41,66,0.06)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#4A4843]">
                    Bajo pedido pendientes
                  </span>
                  <span
                    className="text-xs text-[#6D6A64] transition group-hover:translate-x-0.5 group-hover:text-[#0F2942]"
                    aria-hidden="true"
                  >
                    →
                  </span>
                </div>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-[#1E446B] tabular-nums">
                  {pendingOnDemand.length}
                </p>
              </button>
              <button
                type="button"
                onClick={() => handleTabChange("stock")}
                className="group rounded-2xl border border-[#E7E5E0] bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,41,66,0.03)] transition hover:border-[#1E446B]/45 hover:shadow-[0_2px_8px_rgba(15,41,66,0.06)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#4A4843]">
                    Saldos negativos Día 1
                  </span>
                  <span
                    className="text-xs text-[#6D6A64] transition group-hover:translate-x-0.5 group-hover:text-[#0F2942]"
                    aria-hidden="true"
                  >
                    →
                  </span>
                </div>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-[#B45309] tabular-nums">
                  {negStockCount}
                </p>
              </button>
            </div>

            {/* 1-Tap Discount Approval Queue — calm slim banner when 0 pending */}
            {pendingApprovals.length === 0 ? (
              <div
                id="discount-approval-queue"
                className="order-2 flex scroll-mt-24 items-center justify-between gap-2 rounded-2xl border border-[#D5E0E9] bg-white px-4 py-4 text-sm text-[#486581]"
              >
                <span className="flex items-center gap-2">
                  <CheckIcon className="h-3.5 w-3.5 text-[#15803D]" />
                  No hay pedidos retenidos por descuento en este momento.
                </span>
                <Badge tone="neutral">0 pendientes</Badge>
              </div>
            ) : (
              <Card
                id="discount-approval-queue"
                tone="warning"
                padding="md"
                className="order-2 scroll-mt-24 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangleIcon className="h-4 w-4 text-[#B45309]" />
                    <h2 className="text-sm sm:text-base font-semibold text-[#18181B]">
                      Aprobación de Descuentos bajo el Precio Mínimo
                    </h2>
                  </div>
                  <Badge tone="warning">{pendingApprovals.length} pendiente(s)</Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {pendingApprovals.map((o) => {
                    const orderId = Number(o.order_id);
                    const isBusyThis = busyApproveOrderId === orderId;
                    const marginVal = Number(o.order_margin_pen ?? 0);
                    const totalVal = Number(o.total_pen ?? 0);
                    const marginPct = totalVal > 0 ? (marginVal / totalVal) * 100 : 0;
                    const lines = Array.isArray(o.lines)
                      ? (o.lines as Array<Record<string, unknown>>)
                      : [];
                    const discountedLines = lines.filter(
                      (ln) =>
                        Number(ln.unit_discount_pen ?? 0) > 0 ||
                        Number(ln.is_below_min_floor ?? 0) > 0
                    );
                    const displayLines =
                      discountedLines.length > 0 ? discountedLines : lines;
                    return (
                      <div
                        key={String(o.order_id)}
                        className="rounded-xl border border-[#E7E5E0] bg-white p-3.5 shadow-xs space-y-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="text-xs font-medium text-[#5C5A55]">
                            {String(o.order_code)} · Vendedor:{" "}
                            <strong className="text-[#18181B]">
                              {formatActorName(o.created_by_name, "-")}
                            </strong>
                          </span>
                          <Badge
                            tone={getMarginTone(marginVal, totalVal)}
                            className="tabular-nums"
                          >
                            Margen: {formatPen(marginVal)} ({marginPct.toFixed(1)}%)
                          </Badge>
                        </div>
                        <h3 className="text-sm font-semibold text-[#18181B] tabular-nums">
                          {String(o.customer_name)} — {formatPen(o.total_pen)}
                        </h3>
                        {displayLines.length > 0 && (
                          <div className="space-y-1 rounded-lg bg-[#FAF9F6] px-2.5 py-2 text-xs text-[#5C5A55]">
                            {displayLines.slice(0, 4).map((ln, idx) => (
                              <div
                                key={String(ln.order_line_id ?? idx)}
                                className="flex flex-wrap items-center justify-between gap-2 tabular-nums"
                              >
                                <span className="min-w-0 flex-1 truncate font-medium text-[#18181B]">
                                  {String(ln.raw_description || ln.sku)}
                                </span>
                                <span>
                                  {Number(ln.quantity)}{" "}
                                  {String(ln.unit_of_measure || "NIU")} ×{" "}
                                  {formatPen(ln.unit_price_pen)}
                                  {Number(ln.unit_discount_pen || 0) > 0
                                    ? ` (-${formatPen(ln.unit_discount_pen)})`
                                    : ""}
                                </span>
                              </div>
                            ))}
                            {displayLines.length > 4 && (
                              <p className="text-xs font-medium text-[#6D6A64]">
                                +{displayLines.length - 4} línea(s) adicional(es)
                              </p>
                            )}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="success"
                            size="sm"
                            disabled={
                              busyApproveOrderId !== null || busyCancelOrderId !== null
                            }
                            aria-label={`Aprobar pedido ${String(o.order_code)} de ${String(o.customer_name)} y enviar a Almacén`}
                            onClick={() => handleApproveDiscount(orderId)}
                            className="flex-1"
                          >
                            <CheckIcon className="h-3.5 w-3.5" />
                            {isBusyThis
                              ? "Aprobando..."
                              : "Aprobar con 1 Toque y Enviar a Almacén"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              busyApproveOrderId !== null || busyCancelOrderId !== null
                            }
                            onClick={() => {
                              setCancelOrderReason("");
                              setConfirmCancelOrder(o);
                            }}
                            className="border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2]"
                          >
                            Anular
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* ON_DEMAND Pending Supplier Purchases */}
            {pendingOnDemand.length > 0 && (
              <Card
                tone="horizon"
                accent="horizon"
                padding="md"
                className="order-5 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm sm:text-base font-semibold text-[#0F2942]">
                    Pedidos Bajo Pedido Pendientes de Compra ({pendingOnDemand.length})
                  </h2>
                </div>
                <div className="grid gap-2.5 md:grid-cols-2">
                  {pendingOnDemand.map((od) => (
                    <div
                      key={od.order_line_id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-[#D4E0EC] bg-white p-3 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-[#18181B]">
                          {od.sku} — {od.product_name} (×{Number(od.quantity)}{" "}
                          {od.unit_of_measure || "NIU"})
                        </p>
                        <p className="mt-0.5 truncate text-[#5C5A55] tabular-nums">
                          {od.order_code} ·{" "}
                          {od.customer_name || od.customer_name_raw || "-"} ·{" "}
                          {formatPen(od.line_total_pen)}
                        </p>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        aria-label={`Comprar ${od.sku} (${od.product_name})`}
                        onClick={() =>
                          handleGoToPurchaseProduct({
                            productId: Number(od.product_id),
                            quantity: Number(od.quantity || 1),
                            orderLineId: Number(od.order_line_id),
                          })
                        }
                        className="flex-shrink-0"
                      >
                        <PlusIcon className="h-3.5 w-3.5" />
                        Comprar
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Live 4-Responsible Order Monitor */}
            <Card padding="md" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2
                    id="monitor-table-heading"
                    className="text-sm sm:text-base font-semibold text-[#18181B]"
                  >
                    Monitor en Tiempo Real
                  </h2>
                  <p className="text-xs text-[#5C5A55]">
                    {showAllMonitor || recentMonitorOrders.length <= 15
                      ? `Mostrando ${recentMonitorOrders.length} pedidos`
                      : `Mostrando 15 de ${recentMonitorOrders.length} pedidos`}{" "}
                    · Toca una fila para ver detalle, abonar o anular.
                  </p>
                </div>
                {recentMonitorOrders.length > 15 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAllMonitor((prev) => !prev)}
                  >
                    {showAllMonitor
                      ? "Ver últimos 15"
                      : `Ver todos (${recentMonitorOrders.length})`}
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1">
                  <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#6D6A64]">
                    <SearchIcon className="h-4 w-4" />
                  </span>
                  <input
                    type="text"
                    value={monitorSearch}
                    onChange={(e) => setMonitorSearch(e.target.value)}
                    aria-label="Buscar en monitor de pedidos"
                    placeholder="Buscar por pedido, cliente o vendedor..."
                    className={`${INPUT_CLASS} py-2 pl-10 pr-8 text-xs`}
                  />
                  {monitorSearch && (
                    <button
                      type="button"
                      data-compact="true"
                      aria-label="Limpiar búsqueda de monitor"
                      onClick={() => setMonitorSearch("")}
                      className="absolute inset-y-0 right-2.5 flex items-center text-[#6D6A64] hover:text-[#18181B] cursor-pointer"
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <SegmentedControl<MonitorStatusFilter>
                  ariaLabel="Filtrar estado en monitor"
                  value={monitorStatusFilter}
                  onChange={setMonitorStatusFilter}
                  options={[
                    { id: "ALL", label: "Todos" },
                    { id: "PENDING", label: "Pendientes" },
                    { id: "DELIVERED", label: "Entregados" },
                    { id: "CANCELLED", label: "Anulados" },
                  ]}
                />
              </div>

              {/* Mobile card view */}
              <div className="space-y-2.5 md:hidden">
                {(showAllMonitor
                  ? recentMonitorOrders
                  : recentMonitorOrders.slice(0, 15)
                ).map((o) => {
                  const marginVal = Number(o.order_margin_pen ?? 0);
                  const totalVal = Number(o.total_pen ?? 0);
                  const debtVal = Number(o.balance_due_pen ?? 0);
                  const statusStr = String(o.operational_status ?? "");
                  const wasModified =
                    Array.isArray(o.audit_history) &&
                    o.audit_history.some(
                      (entry) =>
                        String((entry as Record<string, unknown>).action) === "EDIT"
                    );
                  const canAbonar =
                    debtVal > 0.05 &&
                    statusStr !== "CANCELLED" &&
                    statusStr !== "PENDING_PARTNER_APPROVAL";
                  const canCancel =
                    statusStr !== "CANCELLED" && statusStr !== "DELIVERED";
                  return (
                    <div
                      key={String(o.order_id)}
                      className="rounded-xl border border-[#E7E5E0] bg-[#FAF9F6] p-3.5 space-y-2.5 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedMonitorOrder(o)}
                        aria-label={`Ver detalle del pedido ${String(o.order_code)} de ${String(o.customer_name)}`}
                        className="w-full text-left space-y-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 cursor-pointer"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-[#1E446B] tabular-nums">
                            {String(o.order_code)} · {String(o.order_date)}
                          </span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {wasModified && <Badge tone="warning">Modificado</Badge>}
                            <Badge tone={operationalStatusTone(o.operational_status)}>
                              {formatOperationalStatusEs(o.operational_status)}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-sm font-semibold text-[#18181B]">
                          {String(o.customer_name)}
                        </p>
                        <p className="text-xs text-[#5C5A55]">
                          <span className="text-[#6D6A64]">Equipo:</span>{" "}
                          <span className="font-medium text-[#18181B]">
                            {formatTraceabilitySummary(o)}
                          </span>
                        </p>
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[#E7E5E0] pt-2 tabular-nums">
                          <span>
                            Venta:{" "}
                            <strong className="text-[#18181B]">
                              {formatPen(totalVal)}
                            </strong>
                          </span>
                          <span
                            className={`font-semibold ${getMarginTextClass(
                              marginVal,
                              totalVal
                            )}`}
                          >
                            Margen: {formatPen(marginVal)}
                          </span>
                          <span
                            className={
                              debtVal > 0.05
                                ? "font-semibold text-[#B91C1C]"
                                : "font-medium text-[#15803D]"
                            }
                          >
                            {debtVal > 0.05 ? `Debe: ${formatPen(debtVal)}` : "Al día"}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-[#1E446B]">
                          Toca para ver productos comprados (
                          {Array.isArray(o.lines) ? o.lines.length : 0})
                        </p>
                      </button>
                      {(canAbonar || canCancel) && (
                        <div className="flex flex-wrap gap-2 border-t border-[#E7E5E0]/80 pt-2">
                          {canAbonar && (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => openAbonoForOrderRecord(o)}
                              className="flex-1"
                            >
                              Abonar
                            </Button>
                          )}
                          {canCancel && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setCancelOrderReason("");
                                setConfirmCancelOrder(o);
                              }}
                              className="border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2]"
                            >
                              Anular
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Desktop table view */}
              <div
                tabIndex={0}
                role="region"
                aria-labelledby="monitor-table-heading"
                className="table-wrapper hidden md:block"
              >
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#E7E5E0] bg-[#FAF9F6] text-xs font-semibold uppercase tracking-wide text-[#5C5A55]">
                    <tr>
                      <th scope="col" className="whitespace-nowrap p-3">
                        Pedido / Fecha
                      </th>
                      <th scope="col" className="whitespace-nowrap p-3">
                        Cliente
                      </th>
                      <th scope="col" className="whitespace-nowrap p-3">
                        Estado
                      </th>
                      <th scope="col" className="whitespace-nowrap p-3">
                        Responsables
                      </th>
                      <th scope="col" className="whitespace-nowrap p-3 text-right">
                        Venta
                      </th>
                      <th scope="col" className="whitespace-nowrap p-3 text-right">
                        Margen Real
                      </th>
                      <th scope="col" className="whitespace-nowrap p-3 text-right">
                        Saldo Debe
                      </th>
                      <th scope="col" className="whitespace-nowrap p-3 text-right">
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E7E5E0]">
                    {(showAllMonitor
                      ? recentMonitorOrders
                      : recentMonitorOrders.slice(0, 15)
                    ).map((o) => {
                      const marginVal = Number(o.order_margin_pen ?? 0);
                      const totalVal = Number(o.total_pen ?? 0);
                      const debtVal = Number(o.balance_due_pen ?? 0);
                      const statusStr = String(o.operational_status ?? "");
                      const wasModified =
                        Array.isArray(o.audit_history) &&
                        o.audit_history.some(
                          (entry) =>
                            String((entry as Record<string, unknown>).action) === "EDIT"
                        );
                      const canAbonar =
                        debtVal > 0.05 &&
                        statusStr !== "CANCELLED" &&
                        statusStr !== "PENDING_PARTNER_APPROVAL";
                      const canCancel =
                        statusStr !== "CANCELLED" && statusStr !== "DELIVERED";
                      return (
                        <tr
                          key={String(o.order_id)}
                          onClick={() => setSelectedMonitorOrder(o)}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedMonitorOrder(o);
                            }
                          }}
                          aria-label={`Ver detalle del pedido ${String(o.order_code)}`}
                          className="cursor-pointer transition hover:bg-[#F2F6FA]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0F2942]/45"
                        >
                          <td className="whitespace-nowrap p-3 font-semibold text-[#1E446B] tabular-nums">
                            {String(o.order_code)}
                            <span className="block text-xs font-normal text-[#6D6A64]">
                              {String(o.order_date)}
                            </span>
                          </td>
                          <td className="min-w-[160px] p-3 font-medium text-[#18181B]">
                            {String(o.customer_name)}
                          </td>
                          <td className="whitespace-nowrap p-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge tone={operationalStatusTone(o.operational_status)}>
                                {formatOperationalStatusEs(o.operational_status)}
                              </Badge>
                              {wasModified && <Badge tone="warning">Modificado</Badge>}
                            </div>
                          </td>
                          <td className="min-w-[200px] p-3 text-[#5C5A55]">
                            {formatTraceabilitySummary(o)}
                          </td>
                          <td className="whitespace-nowrap p-3 text-right font-semibold text-[#18181B] tabular-nums">
                            {formatPen(totalVal)}
                          </td>
                          <td
                            className={`whitespace-nowrap p-3 text-right font-semibold tabular-nums ${getMarginTextClass(
                              marginVal,
                              totalVal
                            )}`}
                          >
                            {formatPen(marginVal)}
                          </td>
                          <td
                            className={`whitespace-nowrap p-3 text-right tabular-nums ${
                              debtVal > 0.05
                                ? "font-semibold text-[#B91C1C]"
                                : "font-medium text-[#15803D]"
                            }`}
                          >
                            {formatPen(debtVal)}
                          </td>
                          <td
                            className="whitespace-nowrap p-3 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {canAbonar && (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  data-compact="true"
                                  onClick={() => openAbonoForOrderRecord(o)}
                                >
                                  Abonar
                                </Button>
                              )}
                              {canCancel && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  data-compact="true"
                                  onClick={() => {
                                    setCancelOrderReason("");
                                    setConfirmCancelOrder(o);
                                  }}
                                  className="border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2]"
                                >
                                  Anular
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {ordersPagination?.hasMore && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E7E5E0] pt-3 text-xs text-[#5C5A55]">
                  <span>
                    Mostrando {orders.length} de {ordersPagination.totalCount} pedidos
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loadingMoreOrders}
                    onClick={handleLoadMoreOrders}
                  >
                    {loadingMoreOrders ? "Cargando..." : "Cargar más pedidos"}
                  </Button>
                </div>
              )}
            </Card>

            {/* Route Trips & Quotes Operational Panels */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card padding="md" className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm sm:text-base font-semibold text-[#18181B]">
                      Rutas y Despachos ({routeTrips.length})
                    </h2>
                    <p className="text-xs text-[#5C5A55]">
                      Cierra la ruta y compara lo cobrado en el día con los pedidos
                      registrados.
                    </p>
                  </div>
                </div>
                {routeTrips.length === 0 ? (
                  <EmptyState title="Sin rutas registradas" />
                ) : (
                  <div className="space-y-2.5">
                    {routeTrips.slice(0, 8).map((tr) => {
                      const tId = Number(tr.trip_id);
                      const status = String(tr.status);
                      const isBusy = busyTripId === tId;
                      return (
                        <div
                          key={tId}
                          className="rounded-xl border border-[#E7E5E0] bg-[#FAF9F6] p-3 text-xs space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <span className="font-semibold text-[#0F2942] tabular-nums">
                                {String(tr.trip_code)} · {String(tr.trip_date)}
                              </span>
                              <p className="text-[#5C5A55]">
                                {String(tr.zone_name || "Ruta")} ·{" "}
                                {String(tr.driver_name || "Reparto")} ·{" "}
                                {Number(tr.order_count ?? 0)} pedido(s) (
                                {Number(tr.in_route_count ?? 0)} en ruta /{" "}
                                {Number(tr.delivered_count ?? 0)} entregados)
                              </p>
                              <p className="mt-1 text-[#5C5A55] tabular-nums">
                                Ventas registradas:{" "}
                                <strong className="text-[#18181B]">
                                  {formatPen(tr.computed_sales_pen)}
                                </strong>
                              </p>
                            </div>
                            <Badge
                              tone={
                                status === "RECONCILED"
                                  ? "success"
                                  : status === "CLOSED"
                                    ? "brand"
                                    : "warning"
                              }
                            >
                              {formatRouteTripStatusEs(status)}
                            </Badge>
                          </div>
                          {status !== "RECONCILED" && (
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="flex flex-col gap-1 text-xs font-medium text-[#5C5A55]">
                                Cobrado del día (S/)
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="Total cobrado"
                                  aria-label={`Cobrado del día de la ruta ${String(tr.trip_code)}`}
                                  value={tripDeclaredNetById[tId] ?? ""}
                                  onChange={(e) =>
                                    setTripDeclaredNetById((prev) => ({
                                      ...prev,
                                      [tId]: e.target.value,
                                    }))
                                  }
                                  className={`${INPUT_CLASS} w-40 py-1.5 text-xs tabular-nums`}
                                />
                              </label>
                              {status === "OPEN" && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  data-compact="true"
                                  disabled={isBusy}
                                  onClick={() => handlePartnerTripAction(tId, "CLOSED")}
                                >
                                  Cerrar
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="success"
                                size="sm"
                                data-compact="true"
                                disabled={isBusy}
                                onClick={() =>
                                  handlePartnerTripAction(tId, "RECONCILED")
                                }
                              >
                                Conciliar
                              </Button>
                            </div>
                          )}
                          {status !== "RECONCILED" && (
                            <p className="text-xs text-[#6D6A64]">
                              Ingresa lo cobrado por las ventas de ese día. Los gastos
                              de ruta se registran aparte, incluso retroactivamente; no
                              se descuentan aquí. El monto es opcional si solo necesitas
                              marcar la ruta como revisada.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              <Card padding="md" className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm sm:text-base font-semibold text-[#18181B]">
                      Ventas y Cotizaciones Comerciales ({partnerQuotes.length})
                    </h2>
                    <p className="text-xs text-[#5C5A55]">
                      Revisa el detalle de cualquier venta; las abiertas también pueden
                      convertirse en pedido.
                    </p>
                  </div>
                </div>
                {partnerQuotes.length === 0 ? (
                  <EmptyState title="Sin cotizaciones recientes" />
                ) : (
                  <div className="space-y-2.5">
                    {partnerQuotes.slice(0, 8).map((q) => {
                      const qId = Number(q.quote_id);
                      const status = String(q.status);
                      const isBusy = busyQuoteId === qId;
                      return (
                        <div
                          key={qId}
                          className="rounded-xl border border-[#E7E5E0] bg-[#FAF9F6] p-3 text-xs space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="font-semibold text-[#1E446B] tabular-nums">
                                {String(q.quote_code)} · {String(q.issue_date)}
                              </span>
                              <p className="truncate font-semibold text-[#18181B]">
                                {String(q.customer_name)}
                              </p>
                              <p className="text-[#5C5A55] tabular-nums">
                                Total: {formatPen(q.total_pen)} ·{" "}
                                {Array.isArray(q.lines) ? q.lines.length : 0} ítem(s)
                              </p>
                            </div>
                            <Badge
                              tone={
                                status === "CONVERTED"
                                  ? "success"
                                  : status === "OPEN"
                                    ? "brand"
                                    : "neutral"
                              }
                            >
                              {status === "CONVERTED"
                                ? `Pedido ${String(q.converted_order_code || q.related_cpe || "")}`.trim()
                                : formatQuoteStatusEs(status)}
                            </Badge>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-compact="true"
                            onClick={() => setSelectedPartnerQuote(q)}
                            className="w-full"
                          >
                            Ver detalle
                          </Button>
                          {status === "OPEN" && (
                            <div className="flex flex-wrap gap-1.5">
                              <Button
                                type="button"
                                variant="success"
                                size="sm"
                                data-compact="true"
                                disabled={isBusy}
                                onClick={() => handlePartnerConvertQuote(qId, "CASH")}
                              >
                                Convertir Contado
                              </Button>
                              <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                data-compact="true"
                                disabled={isBusy}
                                onClick={() => handlePartnerConvertQuote(qId, "CREDIT")}
                              >
                                A Crédito
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                data-compact="true"
                                disabled={isBusy}
                                onClick={() => handlePartnerCancelQuote(qId)}
                              >
                                Anular
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        {tab === "pedidos" && (
          <div className="space-y-4">
            <Card padding="md" className="space-y-3">
              <div>
                <h2 className="text-sm sm:text-base font-semibold text-[#18181B]">
                  Todos los Pedidos y Ventas
                </h2>
                <p className="text-xs text-[#5C5A55]">
                  Consulta el historial completo, filtra por estado y abre cualquier
                  pedido para revisar sus productos y trazabilidad.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1">
                  <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#6D6A64]">
                    <SearchIcon className="h-4 w-4" />
                  </span>
                  <input
                    type="text"
                    value={monitorSearch}
                    onChange={(e) => setMonitorSearch(e.target.value)}
                    aria-label="Buscar pedidos y ventas"
                    placeholder="Buscar por pedido, cliente o vendedor..."
                    className={`${INPUT_CLASS} py-2 pl-10 pr-8 text-xs`}
                  />
                </div>
                <SegmentedControl<MonitorStatusFilter>
                  ariaLabel="Filtrar pedidos y ventas por estado"
                  value={monitorStatusFilter}
                  onChange={setMonitorStatusFilter}
                  options={[
                    { id: "ALL", label: "Todos" },
                    { id: "PENDING", label: "Pendientes" },
                    { id: "DELIVERED", label: "Entregados" },
                    { id: "CANCELLED", label: "Anulados" },
                  ]}
                />
              </div>

              {monitorFilteredOrders.length === 0 ? (
                <EmptyState title="No hay pedidos que coincidan con el filtro" />
              ) : (
                <div className="space-y-2">
                  {monitorFilteredOrders.map((order) => (
                    <button
                      key={String(order.order_id)}
                      type="button"
                      onClick={() => setSelectedMonitorOrder(order)}
                      className="flex w-full flex-col gap-2 rounded-xl border border-[#E7E5E0] bg-white p-3 text-left transition hover:border-[#D4E0EC] hover:bg-[#F2F6FA]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-[#1E446B] tabular-nums">
                          {String(order.order_code)} · {String(order.order_date)}
                        </span>
                        <Badge tone={operationalStatusTone(order.operational_status)}>
                          {formatOperationalStatusEs(order.operational_status)}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-[#18181B]">
                          {String(order.customer_name)}
                        </span>
                        <span className="font-semibold text-[#18181B] tabular-nums">
                          {formatPen(order.total_pen)}
                        </span>
                      </div>
                      <span className="text-xs text-[#5C5A55]">
                        Vendedor: {formatActorName(order.created_by_name, "-")} ·{" "}
                        {Array.isArray(order.lines) ? order.lines.length : 0}{" "}
                        producto(s)
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {ordersPagination?.hasMore && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E7E5E0] pt-3 text-xs text-[#5C5A55]">
                  <span>
                    Mostrando {orders.length} de {ordersPagination.totalCount} pedidos
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loadingMoreOrders}
                    onClick={handleLoadMoreOrders}
                  >
                    {loadingMoreOrders ? "Cargando..." : "Cargar más pedidos"}
                  </Button>
                </div>
              )}
            </Card>
          </div>
        )}

        {tab === "deudores" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                {
                  label: "Saldo pendiente",
                  amount: collectionSummary.total,
                  tone: "text-[#0F2942]",
                },
                {
                  label: "Cobrar hoy / mañana",
                  amount: collectionSummary.dueSoon,
                  tone: "text-[#B45309]",
                },
                {
                  label: "Promesa vencida",
                  amount: collectionSummary.overdue,
                  tone: "text-[#B91C1C]",
                },
              ].map((item) => (
                <Card key={item.label} padding="sm" className="space-y-1">
                  <p className="text-xs text-[#5C5A55]">{item.label}</p>
                  <p className={`text-lg font-semibold tabular-nums ${item.tone}`}>
                    S/ {item.amount.toFixed(2)}
                  </p>
                </Card>
              ))}
            </div>
            <Card padding="sm" className="space-y-2.5">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#6D6A64]">
                  <SearchIcon className="h-4 w-4" />
                </span>
                <input
                  type="text"
                  value={debtorSearch}
                  onChange={(e) => setDebtorSearch(e.target.value)}
                  aria-label="Buscar cliente o código de pedido en deudores"
                  placeholder="Buscar cliente o pedido pendiente..."
                  className={`${INPUT_CLASS} py-2 pl-10 pr-8 text-xs sm:text-sm`}
                />
                {debtorSearch && (
                  <button
                    type="button"
                    data-compact="true"
                    aria-label="Limpiar búsqueda de deudores"
                    onClick={() => setDebtorSearch("")}
                    className="absolute inset-y-0 right-2.5 flex items-center text-[#6D6A64] hover:text-[#18181B] cursor-pointer"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
              <PromiseFilterBar
                value={promiseFilter}
                onChange={setPromiseFilter}
                totalCount={debtorsByOrder.length}
              />
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card padding="md" className="space-y-3">
                <h2 className="text-sm sm:text-base font-semibold text-[#18181B]">
                  Ranking de Clientes Deudores ({filteredDebtorsByCustomer.length})
                </h2>
                {filteredDebtorsByCustomer.length === 0 ? (
                  <EmptyState title="No hay clientes deudores con este filtro" />
                ) : (
                  <div className="space-y-2.5">
                    {filteredDebtorsByCustomer.map((c) => (
                      <div
                        key={String(c.customerKey)}
                        className="flex min-h-[88px] items-center justify-between gap-3 rounded-xl border border-[#E7E5E0] bg-[#FAF9F6]/60 p-3.5"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setDebtDetailTarget({
                              mode: "customer",
                              customerKey: String(c.customerKey),
                              customerName: String(c.customerName),
                              customerPartyId:
                                c.customerPartyId !== null &&
                                c.customerPartyId !== undefined
                                  ? Number(c.customerPartyId)
                                  : null,
                            })
                          }
                          aria-label={`Ver pedidos y productos que debe ${String(c.customerName)}`}
                          className="min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left transition hover:bg-[#F2F6FA]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 cursor-pointer"
                        >
                          <p className="truncate text-sm font-semibold text-[#18181B]">
                            {String(c.customerName)}
                          </p>
                          <p className="mt-0.5 text-xs text-[#5C5A55] tabular-nums">
                            {Number(c.openOrdersCount)} pedido(s) · Antigüedad:{" "}
                            {Number(c.maxDaysOverdue)} días · Próx. visita:{" "}
                            {String(c.earliestPromisedPaymentDate || "-")}
                          </p>
                          <span className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-[#1E446B]">
                            Ver detalle y productos
                            <ChevronRightIcon className="h-3 w-3" />
                          </span>
                        </button>
                        <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                          <Badge tone="danger" className="tabular-nums">
                            {formatPen(c.totalBalanceDuePen)}
                          </Badge>
                          {Boolean(c.customerPartyId) && (
                            <Button
                              variant="primary"
                              size="sm"
                              aria-label={`Abonar cuenta de ${String(c.customerName)}`}
                              onClick={() => {
                                setAbonoOrder(null);
                                setFifoCustomer(c);
                                setAbonoAmount(String(c.totalBalanceDuePen));
                                setAbonoAccountId("");
                              }}
                            >
                              <PlusIcon className="h-3 w-3" />
                              Abonar Cuenta
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card padding="md" className="space-y-3">
                <h2 className="text-sm sm:text-base font-semibold text-[#18181B]">
                  Pedidos Pendientes de Cobro y Fechas Pactadas (
                  {filteredDebtorsByOrder.length})
                </h2>
                {filteredDebtorsByOrder.length === 0 ? (
                  <EmptyState title="No hay pedidos pendientes con este filtro" />
                ) : (
                  <div className="space-y-2.5">
                    {prioritizedDebtorsByOrder.map((o) => {
                      const lineCount = Array.isArray(o.lines) ? o.lines.length : 0;
                      return (
                        <div
                          key={String(o.orderId)}
                          className="rounded-xl border border-[#E7E5E0] bg-[#FAF9F6]/60 p-3 space-y-2"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setDebtDetailTarget({
                                mode: "order",
                                orderId: Number(o.orderId),
                              })
                            }
                            aria-label={`Ver productos del pedido pendiente ${String(o.orderCode)} de ${String(o.customerName)}`}
                            className="w-full space-y-2 rounded-lg text-left transition hover:bg-[#F2F6FA]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 cursor-pointer"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                              <span className="text-xs font-semibold text-[#18181B]">
                                {String(o.orderCode)} · {String(o.customerName)}
                              </span>
                              <Badge tone="danger" className="tabular-nums">
                                Hace {Number(o.daysOverdue)} días
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#5C5A55] tabular-nums">
                              <span>Total: {formatPen(o.totalPen)}</span>
                              <span>Abonado: {formatPen(o.paidPen)}</span>
                              <strong className="text-[#B91C1C]">
                                Falta: {formatPen(o.balanceDuePen)}
                              </strong>
                              <span className="ml-auto inline-flex items-center gap-0.5 font-medium text-[#1E446B]">
                                {lineCount > 0 ? `${lineCount} prod.` : "Ver detalle"}
                                <ChevronRightIcon className="h-3.5 w-3.5" />
                              </span>
                            </div>
                          </button>
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-[#5C5A55]">
                              <span>
                                Pactado: {String(o.promisedPaymentDate || "-")}
                              </span>
                              <PromiseStatusPill
                                status={String(o.promiseStatus ?? "")}
                              />
                              <span className="sr-only">
                                {formatPromiseStatusEs(o.promiseStatus)}
                              </span>
                            </div>
                            <Button
                              variant="primary"
                              size="sm"
                              aria-label={`Registrar abono para pedido ${String(o.orderCode)}`}
                              onClick={() => {
                                setFifoCustomer(null);
                                setAbonoOrder(o);
                                setAbonoAmount(String(o.balanceDuePen));
                                setAbonoAccountId("");
                              }}
                            >
                              <PlusIcon className="h-3.5 w-3.5" />
                              Abonar
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        {tab === "stock" && (
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
                  <span className="text-xs font-medium text-[#5C5A55]">
                    {item.label}
                  </span>
                  <Badge tone={item.tone} className="tabular-nums">
                    {item.count}
                  </Badge>
                </Card>
              ))}
            </div>
            <Card tone={negStockCount > 0 ? "warning" : "default"} padding="md">
              <details className="group">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]">
                  <div>
                    <h2 className="text-sm font-semibold text-[#18181B] sm:text-base">
                      Administración · Regularización histórica
                    </h2>
                    <p className="mt-0.5 text-xs text-[#5C5A55]">
                      {negStockCount} saldo(s) negativo(s) de la carga inicial
                    </p>
                  </div>
                  <span
                    aria-hidden="true"
                    className="text-[#5C5A55] group-open:rotate-180"
                  >
                    ▾
                  </span>
                </summary>
                <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-[#E7E5E0] pt-3">
                  <p className="max-w-2xl text-xs leading-relaxed text-[#5C5A55]">
                    Esta acción administrativa crea ajustes auditables para llevar a
                    cero saldos históricos por ventas sin compra previa. No se usa en la
                    operación cotidiana.
                  </p>
                  <Button
                    variant="outline"
                    size="md"
                    disabled={busyResetStock || negStockCount === 0}
                    onClick={() => setConfirmResetNegativeOpen(true)}
                    className="border-[#F59E0B] text-[#92400E]"
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
                  <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#6D6A64]">
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
                      className="absolute inset-y-0 right-2.5 flex items-center text-[#6D6A64] hover:text-[#18181B] cursor-pointer"
                    >
                      <CloseIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[#5C5A55] tabular-nums">
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
                        className="rounded-xl border border-[#E7E5E0] bg-[#FAF9F6] p-3 space-y-2 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-[#18181B]">
                              {p.name}
                            </p>
                            <p className="text-xs text-[#6D6A64]">{p.sku}</p>
                          </div>
                          <Badge
                            tone={
                              p.fulfillment_mode === "ON_DEMAND" ? "warning" : "neutral"
                            }
                          >
                            {formatFulfillmentModeEs(p.fulfillment_mode)}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 border-t border-[#E7E5E0]/80 pt-2 tabular-nums">
                          <div>
                            <span className="block text-xs text-[#5C5A55]">
                              Stock actual
                            </span>
                            <span
                              className={`font-semibold ${
                                p.stock_on_hand < 0
                                  ? "text-[#B91C1C]"
                                  : "text-[#18181B]"
                              }`}
                            >
                              {p.stock_on_hand}{" "}
                              <span
                                title={formatUnitTitleEs(p.unit_of_measure)}
                                className="text-xs font-medium text-[#6D6A64]"
                              >
                                {p.unit_of_measure}
                              </span>
                            </span>
                          </div>
                          <div>
                            <span className="block text-xs text-[#5C5A55]">
                              Costo real
                            </span>
                            <span className="font-semibold text-[#18181B]">
                              {p.ref_cost_pen !== null
                                ? formatPen(p.ref_cost_pen)
                                : "Sin costo"}
                            </span>
                          </div>
                          <div>
                            <span className="block text-xs text-[#5C5A55]">
                              Precio normal
                            </span>
                            <span className="font-semibold text-[#18181B]">
                              {formatPen(p.list_sale_price_pen ?? 0)} /{" "}
                              {p.unit_of_measure}
                            </span>
                          </div>
                          <div>
                            <span className="block text-xs text-[#5C5A55]">
                              Precio mínimo
                            </span>
                            <span className="font-semibold text-[#1E446B]">
                              {formatPen(p.min_sale_price_pen ?? 0)} /{" "}
                              {p.unit_of_measure}
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
                      <thead className="border-b border-[#E7E5E0] bg-[#FAF9F6] text-xs font-semibold uppercase tracking-wide text-[#5C5A55]">
                        <tr>
                          <th scope="col" className="whitespace-nowrap p-2.5">
                            Código / Producto
                          </th>
                          <th scope="col" className="whitespace-nowrap p-2.5">
                            Modalidad
                          </th>
                          <th
                            scope="col"
                            className="whitespace-nowrap p-2.5 text-right"
                          >
                            Inventario
                          </th>
                          <th
                            scope="col"
                            className="whitespace-nowrap p-2.5 text-right"
                          >
                            Costo Real
                          </th>
                          <th
                            scope="col"
                            className="whitespace-nowrap p-2.5 text-right"
                          >
                            Precio Normal
                          </th>
                          <th
                            scope="col"
                            className="whitespace-nowrap p-2.5 text-right"
                          >
                            Precio Mínimo
                          </th>
                          <th
                            scope="col"
                            className="whitespace-nowrap p-2.5 text-right"
                          >
                            Acción
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E7E5E0]">
                        {visibleCatalog.map((p) => (
                          <tr
                            key={p.product_id}
                            className="transition hover:bg-[#FAF9F6]"
                          >
                            <td className="min-w-[180px] p-2.5 font-medium text-[#18181B]">
                              {p.name}
                              <span className="block text-xs font-normal text-[#6D6A64]">
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
                                  ? "text-[#B91C1C]"
                                  : "text-[#18181B]"
                              }`}
                            >
                              {p.stock_on_hand}{" "}
                              <span
                                title={formatUnitTitleEs(p.unit_of_measure)}
                                className="text-xs font-normal text-[#6D6A64]"
                              >
                                {p.unit_of_measure}
                              </span>
                            </td>
                            <td className="whitespace-nowrap p-2.5 text-right text-[#5C5A55] tabular-nums">
                              {p.ref_cost_pen !== null
                                ? formatPen(p.ref_cost_pen)
                                : "Sin costo"}
                            </td>
                            <td className="p-2.5 text-right font-semibold text-[#18181B] tabular-nums">
                              {formatPen(p.list_sale_price_pen ?? 0)} /{" "}
                              {p.unit_of_measure}
                            </td>
                            <td className="p-2.5 text-right font-semibold text-[#1E446B] tabular-nums">
                              {formatPen(p.min_sale_price_pen ?? 0)} /{" "}
                              {p.unit_of_measure}
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
        )}

        {(tab === "caja" || tab === "kpis") && (
          <div className="space-y-4">
            <SegmentedControl
              ariaLabel="Vista de finanzas y análisis"
              value={tab === "kpis" ? "kpis" : "caja"}
              onChange={(value) => handleTabChange(value as PartnerTab)}
              options={[
                { id: "caja", label: "Caja y proveedores" },
                { id: "kpis", label: "Indicadores y reportes" },
              ]}
            />
            {tab === "caja" && (
              <CajaProveedoresTab
                catalog={catalog}
                accounts={accounts}
                ledger={ledger}
                apObligations={apObligations}
                suppliers={suppliers}
                recentPurchases={recentPurchases}
                pendingOnDemand={pendingOnDemand}
                preselectedTarget={preselectedPurchaseTarget}
                onClearPreselectedTarget={() => setPreselectedPurchaseTarget(null)}
                onRefresh={loadDashboard}
                onFeedback={showFeedback}
                onEditingChange={setSubTabEditing}
              />
            )}

            {tab === "kpis" && kpiQ1 && (
              <KpisBiTab
                currentUser={currentUser}
                kpiQ1={kpiQ1}
                openDebtorsCount={openDebtorsCount}
                kpiQ2TopSkus={kpiQ2TopSkus}
                qualityGaps={qualityGaps}
                auditFlags={
                  Array.isArray(partnerData?.auditFlags)
                    ? (partnerData.auditFlags as AuditFlagItem[])
                    : undefined
                }
                auditFlagCounts={
                  partnerData?.auditFlagCounts as AuditFlagCounts | undefined
                }
                biSummary={biSummary}
                users={appUsers}
                userAccessHistory={userAccessHistory}
                onGoToPurchaseProduct={handleGoToPurchaseProduct}
                onGoToEditProduct={handleGoToEditProduct}
                onRefresh={loadDashboard}
                onFeedback={showFeedback}
                onEditingChange={setSubTabEditing}
              />
            )}
          </div>
        )}
      </main>

      {/* Product Edit Modal / Bottom Sheet */}
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
              <div className="grid grid-cols-2 gap-2.5 rounded-xl border border-[#E7E5E0] bg-[#FAF9F6] p-3 text-xs tabular-nums">
                <div>
                  <span className="block text-[#5C5A55]">Margen al precio normal</span>
                  <strong className="text-[#15803D]">
                    {formatPen(previewPrice - previewCost)} (
                    {(((previewPrice - previewCost) / previewPrice) * 100).toFixed(1)}
                    %)
                  </strong>
                </div>
                <div>
                  <span className="block text-[#5C5A55]">Margen al precio mínimo</span>
                  <strong
                    className={
                      previewMin - previewCost <= 0
                        ? "text-[#B91C1C]"
                        : "text-[#18181B]"
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
        open={Boolean(selectedPartnerQuote)}
        onClose={() => setSelectedPartnerQuote(null)}
        title={
          selectedPartnerQuote
            ? `Detalle de venta ${String(selectedPartnerQuote.quote_code)}`
            : "Detalle de venta"
        }
        subtitle={
          selectedPartnerQuote
            ? `${String(selectedPartnerQuote.issue_date)} · ${String(
                selectedPartnerQuote.customer_name
              )}`
            : undefined
        }
        maxWidth="lg"
      >
        {selectedPartnerQuote && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-1 gap-2 rounded-xl border border-[#D4E0EC] bg-[#F2F6FA]/70 p-3 sm:grid-cols-3">
              <div>
                <span className="block text-xs text-[#5C5A55]">Estado</span>
                <strong className="text-sm text-[#18181B]">
                  {formatQuoteStatusEs(selectedPartnerQuote.status)}
                </strong>
              </div>
              <div>
                <span className="block text-xs text-[#5C5A55]">Vendedor</span>
                <strong className="text-sm text-[#18181B]">
                  {String(selectedPartnerQuote.seller_name || "-")}
                </strong>
              </div>
              <div>
                <span className="block text-xs text-[#5C5A55]">Total</span>
                <strong className="text-sm text-[#18181B] tabular-nums">
                  {formatPen(selectedPartnerQuote.total_pen)}
                </strong>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="font-semibold text-[#0F2942]">
                Productos (
                {Array.isArray(selectedPartnerQuote.lines)
                  ? selectedPartnerQuote.lines.length
                  : 0}
                )
              </p>
              {Array.isArray(selectedPartnerQuote.lines) &&
              selectedPartnerQuote.lines.length > 0 ? (
                (selectedPartnerQuote.lines as Array<Record<string, unknown>>).map(
                  (line, index) => (
                    <div
                      key={String(line.quote_line_id ?? index)}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#E7E5E0] bg-[#FAF9F6] px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-[#18181B]">
                          {String(line.raw_description || line.sku || "Producto")}
                        </p>
                        <p className="text-xs text-[#5C5A55] tabular-nums">
                          {Number(line.quantity)}{" "}
                          {String(line.unit_of_measure || "NIU")} ×{" "}
                          {formatPen(line.unit_price_pen)}
                        </p>
                      </div>
                      <strong className="tabular-nums text-[#18181B]">
                        {formatPen(line.line_total_pen)}
                      </strong>
                    </div>
                  )
                )
              ) : (
                <p className="text-[#5C5A55]">Sin líneas registradas.</p>
              )}
            </div>

            {selectedPartnerQuote.converted_order_code ? (
              <p className="rounded-lg border border-[#D4E0EC] bg-[#F2F6FA]/70 px-3 py-2 text-[#5C5A55]">
                Pedido generado:{" "}
                <strong className="text-[#0F2942]">
                  {String(selectedPartnerQuote.converted_order_code)}
                </strong>
              </p>
            ) : null}
            {selectedPartnerQuote.notes ? (
              <p className="rounded-lg border border-[#E7E5E0] bg-white px-3 py-2 text-[#5C5A55]">
                Nota: {String(selectedPartnerQuote.notes)}
              </p>
            ) : null}
          </div>
        )}
      </ModalSheet>

      {/* Shared Abono Modal */}
      <ModalSheet
        open={Boolean(selectedMonitorOrder)}
        onClose={() => setSelectedMonitorOrder(null)}
        title={
          selectedMonitorOrder
            ? `Detalle ${String(selectedMonitorOrder.order_code)} · ${String(
                selectedMonitorOrder.customer_name
              )}`
            : "Detalle del pedido"
        }
        subtitle={
          selectedMonitorOrder
            ? `${String(selectedMonitorOrder.order_date)} · Estado: ${formatOperationalStatusEs(
                selectedMonitorOrder.operational_status
              )}`
            : undefined
        }
        maxWidth="lg"
      >
        {selectedMonitorOrder &&
          (() => {
            const marginVal = Number(selectedMonitorOrder.order_margin_pen ?? 0);
            const totalVal = Number(selectedMonitorOrder.total_pen ?? 0);
            const debtVal = Number(selectedMonitorOrder.balance_due_pen ?? 0);
            const statusStr = String(selectedMonitorOrder.operational_status ?? "");
            const canAbonar =
              debtVal > 0.05 &&
              statusStr !== "CANCELLED" &&
              statusStr !== "PENDING_PARTNER_APPROVAL";
            const canCancel = statusStr !== "CANCELLED" && statusStr !== "DELIVERED";
            return (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-1 gap-2 rounded-xl border border-[#D4E0EC] bg-[#F2F6FA]/70 p-3 sm:grid-cols-3 tabular-nums">
                  <div>
                    <span className="block text-xs text-[#5C5A55]">Venta</span>
                    <strong className="text-sm text-[#18181B]">
                      {formatPen(totalVal)}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-xs text-[#5C5A55]">Margen</span>
                    <strong
                      className={`text-sm ${getMarginTextClass(marginVal, totalVal)}`}
                    >
                      {formatPen(marginVal)}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-xs text-[#5C5A55]">Saldo</span>
                    <strong
                      className={`text-sm ${
                        debtVal > 0.05 ? "text-[#B91C1C]" : "text-[#15803D]"
                      }`}
                    >
                      {formatPen(debtVal)}
                    </strong>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="font-semibold text-[#0F2942]">
                    Productos comprados (
                    {Array.isArray(selectedMonitorOrder.lines)
                      ? selectedMonitorOrder.lines.length
                      : 0}
                    )
                  </p>
                  <div className="space-y-1.5">
                    {Array.isArray(selectedMonitorOrder.lines) &&
                    selectedMonitorOrder.lines.length > 0 ? (
                      (
                        selectedMonitorOrder.lines as Array<Record<string, unknown>>
                      ).map((ln) => (
                        <div
                          key={String(ln.order_line_id)}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#E7E5E0] bg-[#FAF9F6] px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-[#18181B]">
                              {String(ln.raw_description || ln.sku)}
                            </p>
                            <p className="text-xs text-[#5C5A55] tabular-nums">
                              {Number(ln.quantity)}{" "}
                              <span title={formatUnitTitleEs(ln.unit_of_measure)}>
                                {String(ln.unit_of_measure || "NIU")}
                              </span>{" "}
                              × {formatPen(ln.unit_price_pen)}
                              {Number(ln.unit_discount_pen || 0) > 0
                                ? ` (desc. ${formatPen(ln.unit_discount_pen)}/u)`
                                : ""}{" "}
                              · {formatFulfillmentModeEs(ln.fulfillment_mode)}
                            </p>
                          </div>
                          <div className="text-right tabular-nums">
                            <span className="block font-semibold text-[#18181B]">
                              {formatPen(ln.line_total_pen)}
                            </span>
                            {ln.line_margin_pen !== null &&
                              ln.line_margin_pen !== undefined && (
                                <span
                                  className={`block text-xs font-medium ${
                                    Number(ln.line_margin_pen) <= 0
                                      ? "text-[#B91C1C]"
                                      : "text-[#15803D]"
                                  }`}
                                >
                                  {Number(ln.line_margin_pen) >= 0 ? "+" : ""}
                                  {formatPen(ln.line_margin_pen)}
                                </span>
                              )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-[#5C5A55]">Sin líneas registradas.</p>
                    )}
                  </div>
                </div>

                {selectedMonitorOrder.notes ? (
                  <p className="rounded-lg border border-[#E7E5E0] bg-white px-3 py-2 text-[#5C5A55]">
                    Nota: {String(selectedMonitorOrder.notes)}
                  </p>
                ) : null}

                {Array.isArray(selectedMonitorOrder.audit_history) &&
                  selectedMonitorOrder.audit_history.length > 0 && (
                    <details className="rounded-lg border border-[#D4E0EC] bg-[#F2F6FA]/60 p-3">
                      <summary className="cursor-pointer font-semibold text-[#0F2942]">
                        Historial de cambios (
                        {selectedMonitorOrder.audit_history.length})
                      </summary>
                      <div className="mt-2 space-y-2">
                        {(
                          selectedMonitorOrder.audit_history as Array<
                            Record<string, unknown>
                          >
                        ).map((entry) => (
                          <div
                            key={String(entry.audit_id)}
                            className="border-t border-[#D4E0EC] pt-2 text-xs text-[#5C5A55]"
                          >
                            <p className="font-medium text-[#18181B]">
                              {String(entry.action) === "CANCEL"
                                ? "Anulación"
                                : "Modificación"}{" "}
                              · {String(entry.reason)}
                            </p>
                            <p>
                              {String(entry.actor_name || "Usuario")} ·{" "}
                              {new Date(String(entry.created_at)).toLocaleString(
                                "es-PE"
                              )}
                            </p>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                {(canAbonar || canCancel) && (
                  <div className="flex flex-col-reverse gap-2 border-t border-[#E7E5E0] pt-3 sm:flex-row sm:justify-end">
                    {canCancel && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const target = selectedMonitorOrder;
                          setSelectedMonitorOrder(null);
                          setCancelOrderReason("");
                          setConfirmCancelOrder(target);
                        }}
                        className="border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2]"
                      >
                        Anular Pedido
                      </Button>
                    )}
                    {canAbonar && (
                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => {
                          const target = selectedMonitorOrder;
                          setSelectedMonitorOrder(null);
                          openAbonoForOrderRecord(target);
                        }}
                      >
                        Registrar Abono ({formatPen(debtVal)})
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
      </ModalSheet>

      <DebtorDetailModal
        open={Boolean(debtDetailTarget)}
        onClose={() => setDebtDetailTarget(null)}
        mode={debtDetailTarget?.mode ?? "order"}
        customerName={
          debtDetailTarget?.mode === "customer" ? debtDetailTarget.customerName : ""
        }
        orders={
          !debtDetailTarget
            ? []
            : ((debtDetailTarget.mode === "order"
                ? debtorsByOrder.filter(
                    (o) => Number(o.orderId) === debtDetailTarget.orderId
                  )
                : debtorsByOrder.filter((o) => {
                    const oKey =
                      o.customerKey ||
                      (o.customerPartyId !== null && o.customerPartyId !== undefined
                        ? `PARTY-${Number(o.customerPartyId)}`
                        : `RAW-${String(o.customerName || "").toUpperCase()}`);
                    return oKey === debtDetailTarget.customerKey;
                  })) as unknown as DebtOrderDetail[])
        }
        canUseCustomerFifo={Boolean(
          debtDetailTarget?.mode === "customer" && debtDetailTarget.customerPartyId
        )}
        onSelectOrderAbono={(order) => {
          setDebtDetailTarget(null);
          setFifoCustomer(null);
          setAbonoOrder(order as unknown as Record<string, unknown>);
          setAbonoAmount(String(order.balanceDuePen));
          setAbonoAccountId("");
        }}
        onSelectCustomerAbono={() => {
          if (debtDetailTarget?.mode !== "customer") return;
          const matched = debtorsByCustomer.find(
            (c) => String(c.customerKey) === debtDetailTarget.customerKey
          );
          if (!matched) return;
          setDebtDetailTarget(null);
          setAbonoOrder(null);
          setFifoCustomer(matched);
          setAbonoAmount(String(matched.totalBalanceDuePen));
          setAbonoAccountId("");
        }}
      />

      <ModalSheet
        open={confirmResetNegativeOpen}
        onClose={() => {
          if (!busyResetStock) setConfirmResetNegativeOpen(false);
        }}
        title="Confirmar regularización de stock negativo"
        subtitle="Esta acción genera un ajuste contable (INV_ADJUSTMENT) en kardex."
      >
        <div className="space-y-4 text-xs sm:text-sm text-[#5C5A55]">
          <p>
            Se pondrán exactamente en <strong>0</strong> los saldos de{" "}
            <strong className="text-[#18181B]">{negStockCount} producto(s)</strong> que
            tienen inventario negativo histórico en Almacén Principal.
          </p>
          <p className="rounded-xl border border-[#F3D9B1] bg-[#FDF8F0] px-3 py-2.5 text-xs text-[#92400E]">
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

      <ModalSheet
        open={Boolean(confirmCancelOrder)}
        onClose={() => {
          if (busyCancelOrderId === null) {
            setConfirmCancelOrder(null);
            setCancelOrderReason("");
          }
        }}
        title={
          confirmCancelOrder
            ? `Anular pedido ${String(confirmCancelOrder.order_code ?? "")}`
            : "Anular pedido"
        }
        subtitle={
          confirmCancelOrder
            ? `${String(confirmCancelOrder.customer_name ?? "")} · ${formatPen(
                confirmCancelOrder.total_pen
              )}`
            : undefined
        }
      >
        {confirmCancelOrder && (
          <form onSubmit={handleConfirmCancelOrder} className="space-y-4">
            <p className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-xs text-[#991B1B]">
              Esta acción anulará el pedido, revertirá sus movimientos pendientes de
              inventario / cobros asociados y cerrará alertas pendientes.
            </p>
            <div>
              <FieldLabel htmlFor="cancel-order-reason">
                Motivo de anulación (opcional)
              </FieldLabel>
              <input
                id="cancel-order-reason"
                type="text"
                value={cancelOrderReason}
                onChange={(e) => setCancelOrderReason(e.target.value)}
                placeholder="Ej. Cliente desistió / error de registro"
                className={`${INPUT_CLASS} mt-1.5`}
              />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={busyCancelOrderId !== null}
                onClick={() => {
                  setConfirmCancelOrder(null);
                  setCancelOrderReason("");
                }}
              >
                Volver
              </Button>
              <Button
                type="submit"
                variant="danger"
                disabled={busyCancelOrderId !== null}
              >
                {busyCancelOrderId !== null ? "Anulando..." : "Confirmar anulación"}
              </Button>
            </div>
          </form>
        )}
      </ModalSheet>

      <AbonoModal
        open={Boolean(abonoOrder || fifoCustomer)}
        onClose={() => {
          setAbonoOrder(null);
          setFifoCustomer(null);
          setAbonoAccountId("");
        }}
        title={
          fifoCustomer
            ? `Abono General · ${String(fifoCustomer.customerName)}`
            : `Registrar Abono · ${String(abonoOrder?.customerName ?? "")}`
        }
        summaryContent={
          fifoCustomer ? (
            <>
              Se repartirá desde el pedido más antiguo (
              {Number(fifoCustomer.openOrdersCount)} pedidos) ·{" "}
              <strong className="text-[#B91C1C] tabular-nums">
                Deuda Total: {formatPen(fifoCustomer.totalBalanceDuePen)}
              </strong>
            </>
          ) : abonoOrder ? (
            <>
              Pedido {String(abonoOrder.orderCode)} · Total:{" "}
              {formatPen(abonoOrder.totalPen)} · Abonado:{" "}
              {formatPen(abonoOrder.paidPen)} ·{" "}
              <strong className="text-[#B91C1C] tabular-nums">
                Saldo: {formatPen(abonoOrder.balanceDuePen)}
              </strong>
            </>
          ) : null
        }
        balanceDuePen={
          fifoCustomer
            ? Number(fifoCustomer.totalBalanceDuePen ?? 0)
            : Number(abonoOrder?.balanceDuePen ?? 0)
        }
        amount={abonoAmount}
        onAmountChange={setAbonoAmount}
        paymentMode={abonoMode}
        onPaymentModeChange={setAbonoMode}
        nextDays={abonoNextDays}
        onNextDaysChange={setAbonoNextDays}
        accounts={accounts}
        accountId={abonoAccountId}
        onAccountIdChange={setAbonoAccountId}
        onSubmit={handleSaveAbono}
        submitLabel="Confirmar Abono"
        busy={busyAbono}
      />

      <BottomNav
        items={navItems}
        activeId={navActiveTab}
        onChange={handleTabChange}
        maxWidth="full"
        className="md:hidden"
      />
    </div>
  );
}
