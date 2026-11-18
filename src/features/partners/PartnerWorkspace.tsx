"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { signOutFromERP } from "@/lib/auth/logout-client";
import {
  AppHeader,
  BottomNav,
  DesktopSidebar,
  type NavTabItem,
} from "@/components/ui/AppShell";
import {
  ActivityIcon,
  BarChartIcon,
  BuildingIcon,
  ChevronRightIcon,
  LockIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
  ShoppingBagIcon,
  UsersIcon,
  WalletIcon,
} from "@/components/ui/Icons";
import { Button, Card, INPUT_CLASS, ToastBanner } from "@/components/ui/Primitives";
import { formatRoleEs } from "@/lib/labels-es";
import { useLiveSync, type SyncScope } from "@/lib/realtime/useLiveSync";
import {
  canonicalPartnerUrl,
  partnerUrlForLegacyTab,
  resolvePartnerNavigation,
} from "@/lib/navigation";
import { deleteOfflineSnapshotsForActor } from "@/lib/offline/outbox";
import { Cobranza, CobranzaModals } from "./Cobranza";
import { Accesos } from "./Accesos";
import { Finanzas } from "./Finanzas";
import { Hoy } from "./Hoy";
import { Inventario, InventarioModals } from "./Inventario";
import { Ventas, VentasModals } from "./Ventas";
import {
  formatActorName,
  SOCIOS_SYNC_SCOPES,
  type PartnerTab,
  type PurchaseTarget,
} from "./partnerShared";
import { useCollectionsFlow } from "./useCollectionsFlow";
import { useInventoryFlow } from "./useInventoryFlow";
import { useOrderFlow } from "./useOrderFlow";
import { usePartnerData } from "./usePartnerData";

const Directorio = dynamic(() => import("./Directorio"));

export default function PartnerWorkspace() {
  const router = useRouter();
  const [tab, setTab] = useState<PartnerTab>("control");
  const [busyLogout, setBusyLogout] = useState(false);
  const [subTabEditing, setSubTabEditing] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [preselectedPurchaseTarget, setPreselectedPurchaseTarget] =
    useState<PurchaseTarget | null>(null);

  const data = usePartnerData();
  const {
    loading,
    feedback,
    setFeedback,
    showFeedback,
    refreshDashboard,
    partnerData,
    orders,
    ordersPagination,
    setOrders,
    setOrdersPagination,
    catalog,
    debtorsByOrder,
    debtorsByCustomer,
    pendingApprovals,
    negStockCount,
    openApCount,
    currentUser,
    appUsers,
  } = data;

  const orderFlow = useOrderFlow({
    orders,
    setOrders,
    ordersPagination,
    setOrdersPagination,
    setFeedback,
    showFeedback,
    refreshDashboard,
  });
  const collectionsFlow = useCollectionsFlow({
    debtorsByOrder,
    debtorsByCustomer,
    setFeedback,
    showFeedback,
    refreshDashboard,
  });
  const inventoryFlow = useInventoryFlow({
    catalog,
    setFeedback,
    showFeedback,
    refreshDashboard,
  });
  const { setMonitorSearch, setMonitorStatusFilter, setShowAllMonitor } = orderFlow;
  const { setSearchSku, openEditProduct } = inventoryFlow;

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
    inventoryFlow.editingProd ||
    collectionsFlow.abonoOrder ||
    collectionsFlow.fifoCustomer ||
    inventoryFlow.confirmResetNegativeOpen ||
    orderFlow.confirmCancelOrder ||
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
    [catalog, openEditProduct, setSearchSku, handleTabChange]
  );

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

  const activeUsersCount = useMemo(
    () => appUsers.filter((u) => u.is_active).length,
    [appUsers]
  );

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
        label: "Pedidos",
        mobileLabel: "Pedidos",
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
        id: "directorio",
        label: "Directorio",
        mobileLabel: "Directorio",
        icon: <UsersIcon className="h-4 w-4" />,
      },
      {
        id: "caja",
        label: "Caja",
        mobileLabel: "Caja",
        icon: <BuildingIcon className="h-4 w-4" />,
        badgeCount: openApCount,
      },
      {
        id: "kpis",
        label: "Reportes",
        mobileLabel: "Reportes",
        icon: <BarChartIcon className="h-4 w-4" />,
      },
      {
        id: "accesos",
        label: "Usuarios",
        mobileLabel: "Usuarios",
        icon: <LockIcon className="h-4 w-4" />,
        badgeCount: activeUsersCount || undefined,
      },
    ],
    [
      pendingApprovals.length,
      ordersPagination?.totalCount,
      debtorsByOrder.length,
      negStockCount,
      openApCount,
      activeUsersCount,
    ]
  );

  const activeTabLabel = navItems.find((item) => item.id === tab)?.label ?? "Hoy";
  const navActiveTab: PartnerTab = tab;

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

  return (
    <div className="min-h-screen bg-bht-surface-cool pb-24 md:pb-12">
      <AppHeader
        title="Control Operativo"
        roleLabel={headerRoleBadge}
        roleTone="horizon"
        roleDotColor="bg-bht-cobalt"
        syncStatus={liveStatus}
        onSyncClick={() => void triggerSync({ force: true })}
        maxWidth="7xl"
        withSidebar
        onLogout={async () => {
          if (busyLogout) return;
          setBusyLogout(true);
          try {
            if (currentUser?.username) {
              await deleteOfflineSnapshotsForActor(currentUser.username).catch(
                () => undefined
              );
            }
            await signOutFromERP();
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
        footer={
          <div className="space-y-1.5">
            <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--bht-sky)]">
              Otros módulos
            </p>
            <button
              type="button"
              onClick={() => router.push("/vendedor")}
              className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-[var(--bht-sky)] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
            >
              <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Nuevo pedido</span>
            </button>
            <button
              type="button"
              onClick={() => router.push("/almacen")}
              className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-[var(--bht-sky)] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
            >
              <PackageIcon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Almacén</span>
            </button>
          </div>
        }
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
              className="w-full shadow-bht-elev-15"
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

        <div className="flex flex-col gap-3 rounded-xl border border-bht-slate-line bg-white p-3 sm:flex-row sm:items-center sm:justify-between sm:p-3.5">
          <div className="flex min-w-0 items-center gap-2 text-xs text-bht-ink-muted">
            <span className="font-medium text-bht-ink-soft">Inicio</span>
            <ChevronRightIcon
              className="h-3.5 w-3.5 text-bht-tone-a8a49c"
              aria-hidden="true"
            />
            <span className="truncate font-semibold text-bht-navy-deep">
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
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-bht-ink-muted"
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
          <Card className="p-10 text-center text-sm font-medium text-bht-ink-soft">
            Cargando datos en vivo desde Neon PostgreSQL...
          </Card>
        )}

        {tab === "control" && (
          <Hoy
            data={data}
            flow={orderFlow}
            openAbonoForOrderRecord={collectionsFlow.openAbonoForOrderRecord}
            handleTabChange={handleTabChange}
            handleGoToPurchaseProduct={handleGoToPurchaseProduct}
          />
        )}

        {tab === "pedidos" && (
          <Ventas
            orders={orders}
            ordersPagination={ordersPagination}
            partnerQuotes={data.partnerQuotes}
            flow={orderFlow}
          />
        )}

        {tab === "deudores" && <Cobranza data={data} flow={collectionsFlow} />}

        {tab === "stock" && (
          <Inventario negStockCount={negStockCount} flow={inventoryFlow} />
        )}

        {tab === "directorio" && (
          <Directorio
            actorRole={currentUser?.role || "PARTNER_MANAGER"}
            showFeedback={showFeedback}
            handleTabChange={handleTabChange}
            onDataChanged={() =>
              void refreshDashboard(["orders", "purchases", "partners"])
            }
            setSubTabEditing={setSubTabEditing}
          />
        )}

        {tab === "accesos" && (
          <Accesos
            data={data}
            setSubTabEditing={setSubTabEditing}
            showFeedback={showFeedback}
          />
        )}

        {(tab === "caja" || tab === "kpis") && (
          <Finanzas
            tab={tab}
            data={data}
            preselectedPurchaseTarget={preselectedPurchaseTarget}
            setPreselectedPurchaseTarget={setPreselectedPurchaseTarget}
            handleTabChange={handleTabChange}
            handleGoToPurchaseProduct={handleGoToPurchaseProduct}
            handleGoToEditProduct={handleGoToEditProduct}
            setSubTabEditing={setSubTabEditing}
            showFeedback={showFeedback}
          />
        )}
      </main>

      <InventarioModals negStockCount={negStockCount} flow={inventoryFlow} />
      <VentasModals
        flow={orderFlow}
        openAbonoForOrderRecord={collectionsFlow.openAbonoForOrderRecord}
      />
      <CobranzaModals data={data} flow={collectionsFlow} />

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
