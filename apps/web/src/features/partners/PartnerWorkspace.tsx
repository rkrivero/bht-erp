"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { signOutFromERP } from "@/lib/auth/logout-client";
import {
  AppHeader,
  BottomNav,
  DesktopSidebar,
  type NavExtraAction,
  type NavTabItem,
} from "@/components/ui/AppShell";
import type { CommandPaletteItem } from "@/components/ui/CommandPalette";

const CommandPalette = dynamic(
  () =>
    import("@/components/ui/CommandPalette").then((m) => ({
      default: m.CommandPalette,
    })),
  { ssr: false }
);
import {
  ActivityIcon,
  BarChartIcon,
  BuildingIcon,
  LockIcon,
  PackageIcon,
  PlusIcon,
  ShoppingBagIcon,
  UsersIcon,
  WalletIcon,
} from "@/components/ui/Icons";
import { Button, ToastBanner } from "@/components/ui/Primitives";
import { SkeletonCards } from "@/components/ui/Skeleton";
import { RecentUndoStrip } from "@/components/shared/RecentUndoStrip";
import { formatPen } from "@/features/partners/components/types";
import { formatRoleEs } from "@/lib/labels-es";
import {
  notifyLocalSync,
  useLiveSync,
  type SyncScope,
} from "@/lib/realtime/useLiveSync";
import {
  canonicalPartnerUrl,
  partnerUrlForLegacyTab,
  resolvePartnerNavigation,
} from "@/lib/navigation";
import { deleteOfflineSnapshotsForActor } from "@/lib/offline/outbox";
import { useGlobalShortcuts } from "@/lib/useGlobalShortcuts";
import type { CajaSubTab } from "@/features/partners/components/caja/caja-utils";
import type { CustomerDirectoryItem } from "@/lib/services/customers";
import type { InventorySubView } from "./Inventario";
import { Hoy } from "./Hoy";
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
const Cobranza = dynamic(() =>
  import("./Cobranza").then((m) => ({ default: m.Cobranza }))
);
const CobranzaModals = dynamic(() =>
  import("./Cobranza").then((m) => ({ default: m.CobranzaModals }))
);
const Accesos = dynamic(() =>
  import("./Accesos").then((m) => ({ default: m.Accesos }))
);
const Finanzas = dynamic(() =>
  import("./Finanzas").then((m) => ({ default: m.Finanzas }))
);
const Inventario = dynamic(() =>
  import("./Inventario").then((m) => ({ default: m.Inventario }))
);
const InventarioModals = dynamic(() =>
  import("./Inventario").then((m) => ({ default: m.InventarioModals }))
);
const Ventas = dynamic(() => import("./Ventas").then((m) => ({ default: m.Ventas })));
const VentasModals = dynamic(() =>
  import("./Ventas").then((m) => ({ default: m.VentasModals }))
);

export default function PartnerWorkspace() {
  const router = useRouter();
  const [tab, setTab] = useState<PartnerTab>("control");
  const [busyLogout, setBusyLogout] = useState(false);
  const [subTabEditing, setSubTabEditing] = useState(false);
  const [preselectedPurchaseTarget, setPreselectedPurchaseTarget] =
    useState<PurchaseTarget | null>(null);
  const [initialCajaSubTab, setInitialCajaSubTab] = useState<CajaSubTab | null>(null);
  const [initialInventoryView, setInitialInventoryView] =
    useState<InventorySubView | null>(null);

  const data = usePartnerData(tab);
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
    unpurchasedRegularizationCount,
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
  const { openCustomerOrders, setSelectedMonitorOrder } = orderFlow;
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
    orderFlow.editingPartnerQuote ||
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

  const handleGoToDailyClose = useCallback(() => {
    setSubTabEditing(false);
    setInitialCajaSubTab("cierre");
    handleTabChange("caja");
  }, [handleTabChange]);

  const handleOpenRegularization = useCallback(() => {
    setSubTabEditing(false);
    setInitialInventoryView("regularization");
    handleTabChange("stock");
  }, [handleTabChange]);

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
  const isPartnerAdmin = currentUser?.role === "PARTNER_ADMIN";

  const navItems: NavTabItem<PartnerTab>[] = useMemo(() => {
    const items: NavTabItem<PartnerTab>[] = [
      {
        id: "control",
        group: "Operación diaria",
        label: "Hoy",
        mobileLabel: "Hoy",
        icon: <ActivityIcon className="h-4 w-4" />,
        badgeCount: pendingApprovals.length,
      },
      {
        id: "pedidos",
        group: "Operación diaria",
        label: "Pedidos",
        mobileLabel: "Pedidos",
        icon: <ShoppingBagIcon className="h-4 w-4" />,
        badgeCount: ordersPagination?.totalCount,
      },
      {
        id: "deudores",
        group: "Operación diaria",
        label: "Cobranza",
        mobileLabel: "Cobrar",
        icon: <WalletIcon className="h-4 w-4" />,
        badgeCount: debtorsByOrder.length,
      },
      {
        id: "stock",
        group: "Operación diaria",
        label: "Inventario",
        mobileLabel: "Inventario",
        icon: <PackageIcon className="h-4 w-4" />,
        badgeCount: negStockCount,
      },
      {
        id: "caja",
        group: "Finanzas y análisis",
        label: "Caja",
        mobileLabel: "Caja",
        icon: <BuildingIcon className="h-4 w-4" />,
        badgeCount: openApCount,
      },
      {
        id: "kpis",
        group: "Finanzas y análisis",
        label: "Reportes",
        mobileLabel: "Reportes",
        icon: <BarChartIcon className="h-4 w-4" />,
      },
      {
        id: "directorio",
        group: "Catálogos y control",
        label: "Directorio",
        mobileLabel: "Directorio",
        icon: <UsersIcon className="h-4 w-4" />,
      },
    ];
    if (isPartnerAdmin) {
      items.push({
        id: "accesos",
        group: "Catálogos y control",
        label: "Usuarios y Config.",
        mobileLabel: "Config.",
        icon: <LockIcon className="h-4 w-4" />,
        badgeCount: activeUsersCount || undefined,
      });
    }
    return items;
  }, [
    pendingApprovals.length,
    ordersPagination?.totalCount,
    debtorsByOrder.length,
    openApCount,
    negStockCount,
    isPartnerAdmin,
    activeUsersCount,
  ]);

  const mobileExtraActions: NavExtraAction[] = useMemo(
    () => [
      {
        id: "go-seller",
        label: "Tomar pedido",
        icon: <PlusIcon className="h-4 w-4" />,
        onClick: () => router.push("/vendedor"),
      },
      {
        id: "go-warehouse",
        label: "Almacén y reparto",
        icon: <PackageIcon className="h-4 w-4" />,
        onClick: () => router.push("/almacen"),
      },
    ],
    [router]
  );

  const shortcutNav = useMemo(
    () => ({
      h: () => handleTabChange("control"),
      p: () => handleTabChange("pedidos"),
      c: () => handleTabChange("deudores"),
      i: () => handleTabChange("stock"),
      j: () => handleTabChange("caja"),
      r: () => handleTabChange("kpis"),
      d: () => handleTabChange("directorio"),
      a: () => handleTabChange("accesos"),
    }),
    [handleTabChange]
  );

  useGlobalShortcuts({
    onGoTo: shortcutNav,
    onNewOrder: () => router.push("/vendedor"),
    onOpenHelp: () => window.dispatchEvent(new CustomEvent("bht:open-command-palette")),
  });

  const commandPaletteItems: CommandPaletteItem[] = useMemo(() => {
    const items: CommandPaletteItem[] = [
      ...navItems.map((item) => ({
        id: `tab-${item.id}`,
        label: `Ir a ${item.label}`,
        subtitle: item.group ?? "Sección de Control Operativo",
        group: "Secciones",
        badge: item.badgeCount ? String(item.badgeCount) : undefined,
        onSelect: () => handleTabChange(item.id),
      })),
      {
        id: "act-daily-close",
        label: "Abrir cierre diario de caja",
        subtitle: "Arqueo y consolidación del día",
        group: "Acciones rápidas",
        onSelect: handleGoToDailyClose,
      },
      {
        id: "act-sync",
        label: "Actualizar datos del tablero",
        subtitle: "Recargar pedidos, caja y stock",
        group: "Acciones rápidas",
        onSelect: () => void refreshDashboard(SOCIOS_SYNC_SCOPES),
      },
      {
        id: "ws-seller",
        label: "Tomar nuevo pedido",
        subtitle: "Espacio de ventas en campo · Atajo: N",
        group: "Espacios ERP",
        onSelect: () => router.push("/vendedor"),
      },
      {
        id: "ws-warehouse",
        label: "Almacén y Reparto",
        subtitle: "Alistamiento y confirmación de entregas",
        group: "Espacios ERP",
        onSelect: () => router.push("/almacen"),
      },
      {
        id: "ws-offline",
        label: "Bandeja de sincronización offline",
        subtitle: "Revisar cola local y resolver conflictos",
        group: "Espacios ERP",
        onSelect: () => router.push("/offline"),
      },
      ...debtorsByCustomer.slice(0, 20).map((d) => ({
        id: `debtor-${d.customerKey}`,
        label: String(d.customerName),
        subtitle: `Saldo por cobrar: ${formatPen(d.totalBalanceDuePen)} · ${d.openOrdersCount} ped.`,
        group: "Clientes con saldo",
        onSelect: () => handleTabChange("deudores"),
      })),
      ...orders.slice(0, 20).map((o) => ({
        id: `order-${o.order_id}`,
        label: `${String(o.order_code)} · ${String(o.customer_name)}`,
        subtitle: `${String(o.order_date)} · ${formatPen(o.total_pen)}`,
        group: "Pedidos recientes",
        onSelect: () => {
          handleTabChange("pedidos");
          setSelectedMonitorOrder(o);
        },
      })),
      ...catalog.slice(0, 20).map((p) => ({
        id: `prod-${p.product_id}`,
        label: `${p.name} (${p.sku})`,
        subtitle: `Stock: ${p.stock_on_hand} ${p.unit_of_measure} · ${formatPen(
          p.list_sale_price_pen ?? 0
        )}`,
        group: "Productos",
        onSelect: () => {
          handleTabChange("stock");
          openEditProduct(p);
        },
      })),
    ];
    return items;
  }, [
    navItems,
    handleTabChange,
    handleGoToDailyClose,
    refreshDashboard,
    router,
    debtorsByCustomer,
    orders,
    setSelectedMonitorOrder,
    catalog,
    openEditProduct,
  ]);

  const navActiveTab: PartnerTab = tab;

  function handleOpenCustomerOrders(customer: CustomerDirectoryItem) {
    handleTabChange("pedidos");
    void openCustomerOrders(customer);
  }

  return (
    <div className="min-h-[100dvh] bg-bht-surface-cool pb-24 md:pb-12">
      <CommandPalette items={commandPaletteItems} />

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
        footerLabel="Espacios de campo"
        footerActions={[
          {
            id: "sidebar-go-seller",
            label: "Tomar pedido",
            icon: <PlusIcon className="h-4 w-4" />,
            onClick: () => router.push("/vendedor"),
          },
          {
            id: "sidebar-go-warehouse",
            label: "Almacén y reparto",
            icon: <PackageIcon className="h-4 w-4" />,
            onClick: () => router.push("/almacen"),
          },
        ]}
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="bht-sidebar-offset mx-auto max-w-[1440px] md:max-w-none px-4 pt-5 sm:px-6 sm:pt-6 lg:px-8 space-y-6 focus:outline-none pb-12"
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

        {feedback && (
          <ToastBanner
            type={feedback.isError ? "err" : "ok"}
            message={feedback.msg}
            action={
              feedback.undoAction && !feedback.isError
                ? {
                    label:
                      orderFlow.busyUndoId === feedback.undoAction.undoId
                        ? "Deshaciendo..."
                        : "Deshacer",
                    disabled: orderFlow.busyUndoId !== null,
                    expiresAt: feedback.undoAction.expiresAt,
                    windowSeconds: feedback.undoAction.windowSeconds,
                    showCountdown: !isPartnerAdmin,
                    onClick: () =>
                      void orderFlow.handleExecuteUndo(feedback.undoAction!.undoId),
                  }
                : undefined
            }
            onDismiss={() => setFeedback(null)}
          />
        )}

        <RecentUndoStrip
          refreshKey={data.dataRefreshSeq + (feedback?.undoAction?.undoId ?? 0)}
          activeToastUndoId={feedback?.undoAction?.undoId ?? null}
          isAdmin={isPartnerAdmin}
          onUndone={(restoredMsg) => {
            showFeedback(restoredMsg);
            notifyLocalSync(SOCIOS_SYNC_SCOPES);
            void refreshDashboard(SOCIOS_SYNC_SCOPES);
          }}
          onError={(errMsg) => showFeedback(errMsg, true)}
        />

        {loading && !partnerData && tab !== "control" && <SkeletonCards count={3} />}

        {tab === "control" && (
          <Hoy
            data={data}
            flow={orderFlow}
            openAbonoForOrderRecord={collectionsFlow.openAbonoForOrderRecord}
            handleTabChange={handleTabChange}
            handleGoToPurchaseProduct={handleGoToPurchaseProduct}
            onOpenDailyClose={handleGoToDailyClose}
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
          <Inventario
            negStockCount={negStockCount}
            unpurchasedRegularizationCount={unpurchasedRegularizationCount}
            initialView={initialInventoryView}
            onClearInitialView={() => setInitialInventoryView(null)}
            refreshKey={data.dataRefreshSeq}
            onGoToPurchaseProduct={handleGoToPurchaseProduct}
            onFeedback={showFeedback}
            flow={inventoryFlow}
          />
        )}

        {tab === "directorio" && (
          <Directorio
            actorRole={currentUser?.role || "PARTNER_MANAGER"}
            showFeedback={showFeedback}
            handleTabChange={handleTabChange}
            onOpenCustomerOrders={handleOpenCustomerOrders}
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
            onGoBackHome={() => handleTabChange("control")}
          />
        )}

        {(tab === "caja" || tab === "kpis") && (
          <Finanzas
            tab={tab}
            data={data}
            preselectedPurchaseTarget={preselectedPurchaseTarget}
            setPreselectedPurchaseTarget={setPreselectedPurchaseTarget}
            initialCajaSubTab={initialCajaSubTab}
            onClearInitialCajaSubTab={() => setInitialCajaSubTab(null)}
            handleTabChange={handleTabChange}
            handleGoToPurchaseProduct={handleGoToPurchaseProduct}
            handleGoToEditProduct={handleGoToEditProduct}
            onOpenRegularization={handleOpenRegularization}
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
        extraActions={mobileExtraActions}
        className="md:hidden"
      />
    </div>
  );
}
