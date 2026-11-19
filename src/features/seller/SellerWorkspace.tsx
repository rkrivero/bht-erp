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
import {
  ActivityIcon,
  ChevronRightIcon,
  ClockIcon,
  PackageIcon,
  ShoppingBagIcon,
  WalletIcon,
} from "@/components/ui/Icons";
import {
  Button,
  Card,
  SegmentedControl,
  ToastBanner,
} from "@/components/ui/Primitives";
import { useLiveSync } from "@/lib/realtime/useLiveSync";
import { deleteOfflineSnapshotsForActor } from "@/lib/offline/outbox";
import {
  canonicalSellerUrl,
  resolveSellerNavigation,
  sellerUrlForLegacyTab,
  type LegacySellerTab,
} from "@/lib/navigation";
import SellerCollectionModals from "@/features/seller/SellerCollectionModals";
import SellerCollectionsTab from "@/features/seller/SellerCollectionsTab";
import {
  SellerCancelDraftModal,
  SellerMobileCartBar,
} from "@/features/seller/SellerOrderOverlays";
import SellerProgressiveOrder from "@/features/seller/SellerProgressiveOrder";
import { SELLER_SYNC_SCOPES } from "@/features/seller/seller-utils";
import type { SellerFeedback } from "@/features/seller/types";
import { useSellerCollections } from "@/features/seller/useSellerCollections";
import { useSellerData } from "@/features/seller/useSellerData";
import { useSellerExpense } from "@/features/seller/useSellerExpense";
import { useSellerOrderFlow } from "@/features/seller/useSellerOrderFlow";
import { useSellerQuotes } from "@/features/seller/useSellerQuotes";

const SellerQuotesTab = dynamic(() => import("@/features/seller/SellerQuotesTab"));
const SellerOrdersTab = dynamic(() => import("@/features/seller/SellerOrdersTab"));
const SellerMoreTab = dynamic(() => import("@/features/seller/SellerMoreTab"));

type SellerTab = LegacySellerTab;

export default function SellerWorkspace() {
  const router = useRouter();
  const [tab, setTab] = useState<SellerTab>("nuevo");
  const [feedback, setFeedback] = useState<SellerFeedback | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);

  useEffect(() => {
    const syncFromUrl = () => {
      const current = new URL(window.location.href);
      const resolved = resolveSellerNavigation(current.searchParams);
      setTab(resolved.legacyTab);
      const canonical = canonicalSellerUrl(current);
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
  const handleTabChange = useCallback((nextTab: SellerTab) => {
    setTab(nextTab);
    const current = new URL(window.location.href);
    const url = sellerUrlForLegacyTab(current, nextTab);
    if (url.search !== current.search) {
      window.history.pushState(null, "", url.pathname + url.search + url.hash);
    }
  }, []);

  const data = useSellerData(setFeedback);
  const { currentUser, quotes, orders, debtorsByOrder } = data;
  const clearExpandedOrder = useCallback(() => setExpandedOrderId(null), []);
  const flow = useSellerOrderFlow({
    data,
    setFeedback,
    handleTabChange,
    clearExpandedOrder,
  });
  const collections = useSellerCollections(data, setFeedback);
  const quoteActions = useSellerQuotes(data, setFeedback);
  const expense = useSellerExpense(currentUser?.username, setFeedback);
  const { cart, isPartnerControlUser, hasOrderDraft } = flow;

  const handleSyncAuthError = useCallback(() => {
    router.push("/login");
  }, [router]);

  const { liveStatus, triggerSync } = useLiveSync({
    scopes: SELLER_SYNC_SCOPES,
    enabled: !loggingOut && !collections.isAbonoModalOpen,
    onRemoteChange: data.handleRemoteChange,
    onAuthError: handleSyncAuthError,
  });

  const openQuotesCount = useMemo(
    () => quotes.filter((q) => q.status === "OPEN").length,
    [quotes]
  );

  const navItems: NavTabItem<SellerTab>[] = useMemo(
    () => [
      {
        id: "nuevo",
        label: "Nuevo pedido",
        mobileLabel: "Nuevo",
        icon: <ShoppingBagIcon className="h-4 w-4" />,
        badgeCount: cart.length > 0 ? cart.length : undefined,
      },
      {
        id: "pedidos",
        label: "Pedidos",
        mobileLabel: "Pedidos",
        icon: <PackageIcon className="h-4 w-4" />,
        badgeCount: openQuotesCount > 0 ? openQuotesCount : undefined,
      },
      {
        id: "deudores",
        label: "Cobranza",
        mobileLabel: "Cobrar",
        icon: <WalletIcon className="h-4 w-4" />,
        badgeCount: debtorsByOrder.length > 0 ? debtorsByOrder.length : undefined,
      },
      {
        id: "gastos",
        label: "Gastos",
        mobileLabel: "Gastos",
        icon: <ClockIcon className="h-4 w-4" />,
      },
    ],
    [cart.length, openQuotesCount, debtorsByOrder.length]
  );

  const activeTabLabel =
    navItems.find((item) => item.id === (tab === "cotizaciones" ? "pedidos" : tab))
      ?.label ?? "Nuevo pedido";
  const navActiveTab: SellerTab = tab === "cotizaciones" ? "pedidos" : tab;

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      if (currentUser?.username) {
        await deleteOfflineSnapshotsForActor(currentUser.username).catch(
          () => undefined
        );
      }
      await signOutFromERP();
    } finally {
      router.push("/login");
    }
  }

  const cleanSellerName =
    currentUser?.fullName &&
    !/vendedor\s+externo|socio\s+operativo|socio\s+gerente/i.test(currentUser.fullName)
      ? currentUser.fullName
      : currentUser?.username === "socio_admin"
        ? "Renzo"
        : null;
  const sellerHeaderRoleLabel =
    currentUser?.role === "PARTNER_ADMIN"
      ? `${cleanSellerName || "Renzo"} · Ventas y Control`
      : currentUser?.role === "PARTNER_MANAGER"
        ? `${cleanSellerName || "Samuel"} · Gerencia`
        : cleanSellerName
          ? `${cleanSellerName} · Vendedor S/`
          : "Vendedor · S/";
  const sellerExtraActions: NavExtraAction[] | undefined = useMemo(
    () =>
      isPartnerControlUser
        ? [
            {
              id: "go-partners",
              label: "Control Operativo",
              icon: <ActivityIcon className="h-4 w-4" />,
              onClick: () => router.push("/socios"),
            },
            {
              id: "go-warehouse",
              label: "Almacén y reparto",
              icon: <PackageIcon className="h-4 w-4" />,
              onClick: () => router.push("/almacen"),
            },
          ]
        : undefined,
    [isPartnerControlUser, router]
  );

  return (
    <div className="min-h-screen bg-bht-surface-cool pb-40 md:pb-12">
      <AppHeader
        title="Ventas y Cobranzas"
        roleLabel={sellerHeaderRoleLabel}
        roleTone="horizon"
        roleDotColor="bg-bht-cobalt"
        syncStatus={liveStatus}
        onSyncClick={() => void triggerSync({ force: true })}
        maxWidth="6xl"
        withSidebar
        actions={
          isPartnerControlUser ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="md"
                onClick={() => router.push("/socios")}
                className="min-h-[38px] sm:min-h-[40px] px-3.5 text-xs sm:text-sm"
              >
                Control Operativo
              </Button>
              <Button
                variant="outline"
                size="md"
                onClick={() => router.push("/almacen")}
                className="hidden sm:inline-flex min-h-[38px] sm:min-h-[40px] px-3.5 text-xs sm:text-sm"
              >
                Almacén
              </Button>
            </div>
          ) : undefined
        }
        onLogout={handleLogout}
      />

      <DesktopSidebar
        items={navItems}
        activeId={navActiveTab}
        onChange={handleTabChange}
        areaLabel="Vendedor · Campo"
        footer={
          isPartnerControlUser ? (
            <div className="space-y-1.5">
              <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--bht-sky)]">
                Cambiar espacio
              </p>
              <button
                type="button"
                onClick={() => router.push("/socios")}
                className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-[var(--bht-sky)] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
              >
                <ActivityIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Control Operativo</span>
              </button>
              <button
                type="button"
                onClick={() => router.push("/almacen")}
                className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-[var(--bht-sky)] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
              >
                <PackageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Almacén y reparto</span>
              </button>
            </div>
          ) : undefined
        }
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-6xl space-y-4 px-3.5 pt-4 sm:px-5 outline-none md:ml-[232px] md:max-w-none md:px-6 lg:px-8"
      >
        <div
          className="flex items-center gap-2 rounded-xl border border-bht-slate-line bg-white px-3.5 py-3 text-xs"
          aria-label={`Ubicación actual: ${activeTabLabel}`}
        >
          <span className="font-medium text-bht-ink-muted">Ventas y Cobranzas</span>
          <ChevronRightIcon
            className="h-3.5 w-3.5 text-bht-tone-a8a49c"
            aria-hidden="true"
          />
          <span className="font-semibold text-bht-navy-deep">{activeTabLabel}</span>
        </div>

        {feedback && (
          <ToastBanner
            type={feedback.type}
            message={feedback.msg}
            onDismiss={() => setFeedback(null)}
          />
        )}

        {liveStatus === "offline" && (
          <Card
            tone="warning"
            padding="sm"
            className="text-xs leading-relaxed text-bht-warning-text"
            role="status"
          >
            Sin conexión. Puedes guardar pedidos, cobros y gastos; se enviarán al
            recuperar Internet. Precio, stock y crédito se validarán al sincronizar.
          </Card>
        )}
        {tab === "nuevo" && hasOrderDraft && (
          <p className="-mt-2 px-1 text-xs text-bht-ink-soft" role="status">
            Borrador guardado automáticamente en este dispositivo para tu usuario.
          </p>
        )}

        {tab === "nuevo" && <SellerProgressiveOrder flow={flow} />}

        {(tab === "cotizaciones" || tab === "pedidos") && (
          <SegmentedControl
            ariaLabel="Vista de ventas"
            value={tab === "cotizaciones" ? "cotizaciones" : "pedidos"}
            onChange={(value) => handleTabChange(value as SellerTab)}
            options={[
              { id: "pedidos", label: "Pedidos" },
              { id: "cotizaciones", label: "Cotizaciones", count: openQuotesCount },
            ]}
          />
        )}

        {tab === "cotizaciones" && (
          <SellerQuotesTab
            quotes={quotes}
            busyQuoteId={quoteActions.busyQuoteId}
            onCreate={() => handleTabChange("nuevo")}
            onConvert={quoteActions.handleConvertQuote}
            onCancel={(quoteId) =>
              quoteActions.handleUpdateQuoteStatus(quoteId, "CANCELLED")
            }
          />
        )}
        {tab === "deudores" && <SellerCollectionsTab collections={collections} />}

        {tab === "pedidos" && (
          <SellerOrdersTab
            orders={orders}
            expandedOrderId={expandedOrderId}
            setExpandedOrderId={setExpandedOrderId}
            currentUserId={currentUser?.userId}
            onEdit={flow.beginEditingOrder}
          />
        )}
        {tab === "gastos" && (
          <SellerMoreTab
            liveStatus={liveStatus}
            userName={
              currentUser?.fullName || currentUser?.username || "Usuario vendedor"
            }
            onSync={() => void triggerSync({ force: true })}
            expenseDate={expense.expenseDate}
            setExpenseDate={expense.setExpenseDate}
            expenseCategory={expense.expenseCategory}
            setExpenseCategory={expense.setExpenseCategory}
            expenseAmount={expense.expenseAmount}
            setExpenseAmount={expense.setExpenseAmount}
            expenseDesc={expense.expenseDesc}
            setExpenseDesc={expense.setExpenseDesc}
            busyExpense={expense.busyExpense}
            onSubmitExpense={expense.handleSubmitExpense}
          />
        )}
      </main>

      <SellerCancelDraftModal flow={flow} />
      <SellerCollectionModals collections={collections} />

      {tab === "nuevo" && cart.length > 0 && <SellerMobileCartBar flow={flow} />}

      <BottomNav
        items={navItems}
        activeId={navActiveTab}
        onChange={handleTabChange}
        maxWidth="2xl"
        extraActions={sellerExtraActions}
        className="md:hidden"
      />
    </div>
  );
}
