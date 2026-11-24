"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  CommandPalette,
  type CommandPaletteItem,
} from "@/components/ui/CommandPalette";
import {
  ActivityIcon,
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
import { RecentUndoStrip } from "@/components/shared/RecentUndoStrip";
import { formatPen } from "@/features/partners/components/types";
import { ApiClientError } from "@/lib/api-client";
import { notifyLocalSync, useLiveSync } from "@/lib/realtime/useLiveSync";
import { executeUndoRequest } from "@/lib/undo-client";
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
  const [busyUndoId, setBusyUndoId] = useState<number | null>(null);
  const [undoRefreshSeq, setUndoRefreshSeq] = useState(0);
  const seenUndoIdRef = useRef<number | null>(null);

  useEffect(() => {
    const id = feedback?.undoAction?.undoId ?? null;
    if (id !== null && id !== seenUndoIdRef.current) {
      seenUndoIdRef.current = id;
      setUndoRefreshSeq((seq) => seq + 1);
    }
  }, [feedback]);

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

  const handleExecuteUndo = useCallback(
    async (undoId: number) => {
      if (busyUndoId !== null) return;
      setBusyUndoId(undoId);
      try {
        const res = await executeUndoRequest(undoId);
        setFeedback({ type: "ok", msg: res.restoredMessage });
        setUndoRefreshSeq((seq) => seq + 1);
        notifyLocalSync(SELLER_SYNC_SCOPES);
        await data.loadAll({ silent: true });
      } catch (error) {
        setFeedback({
          type: "err",
          msg:
            error instanceof ApiClientError
              ? error.message
              : "No se pudo deshacer la acción.",
        });
      } finally {
        setBusyUndoId(null);
      }
    },
    [busyUndoId, data]
  );

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

  const navActiveTab: SellerTab = tab === "cotizaciones" ? "pedidos" : tab;

  const commandPaletteItems: CommandPaletteItem[] = useMemo(() => {
    const items: CommandPaletteItem[] = [
      ...navItems.map((item) => ({
        id: `tab-${item.id}`,
        label: `Ir a ${item.label}`,
        subtitle: "Sección de Ventas y Cobranzas",
        group: "Secciones",
        badge: item.badgeCount ? String(item.badgeCount) : undefined,
        onSelect: () => handleTabChange(item.id),
      })),
      {
        id: "tab-cotizaciones",
        label: "Ir a Cotizaciones",
        subtitle: "Cotizaciones abiertas y conversión a pedido",
        group: "Secciones",
        badge: openQuotesCount > 0 ? String(openQuotesCount) : undefined,
        onSelect: () => handleTabChange("cotizaciones"),
      },
      {
        id: "ws-offline",
        label: "Bandeja de Sincronización Offline (/offline)",
        subtitle: "Revisar cola local y resolver conflictos",
        group: "Espacios ERP",
        onSelect: () => router.push("/offline"),
      },
      {
        id: "ws-password",
        label: "Cambiar contraseña (/change-password)",
        subtitle: "Seguridad de cuenta",
        group: "Espacios ERP",
        onSelect: () => router.push("/change-password"),
      },
    ];
    if (isPartnerControlUser) {
      items.push(
        {
          id: "ws-partners",
          label: "Control Operativo (/socios)",
          subtitle: "Tablero y administración de socios",
          group: "Espacios ERP",
          onSelect: () => router.push("/socios"),
        },
        {
          id: "ws-warehouse",
          label: "Almacén y Reparto (/almacen)",
          subtitle: "Alistamiento y entregas",
          group: "Espacios ERP",
          onSelect: () => router.push("/almacen"),
        }
      );
    }
    for (const o of orders.slice(0, 15)) {
      items.push({
        id: `order-${o.order_id}`,
        label: `${String(o.order_code)} · ${String(o.customer_name)}`,
        subtitle: `${String(o.order_date)} · ${formatPen(o.total_pen)}`,
        group: "Pedidos recientes",
        onSelect: () => {
          handleTabChange("pedidos");
          setExpandedOrderId(Number(o.order_id));
        },
      });
    }
    return items;
  }, [
    navItems,
    handleTabChange,
    openQuotesCount,
    router,
    isPartnerControlUser,
    orders,
  ]);

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
      : null;
  const sellerHeaderRoleLabel =
    currentUser?.role === "PARTNER_ADMIN"
      ? cleanSellerName
        ? `${cleanSellerName} · Ventas y Control`
        : "Ventas y Control"
      : currentUser?.role === "PARTNER_MANAGER"
        ? cleanSellerName
          ? `${cleanSellerName} · Gerencia`
          : "Gerencia"
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
    <div className="min-h-[100dvh] bg-bht-surface-cool pb-40 md:pb-12">
      <CommandPalette items={commandPaletteItems} />

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
            <div className="flex items-center gap-2 md:hidden">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/socios")}
                className="h-8 px-2.5 text-xs"
              >
                Control
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
        footerLabel="Cambiar espacio"
        footerActions={
          isPartnerControlUser
            ? [
                {
                  id: "sidebar-go-partners",
                  label: "Control Operativo",
                  icon: <ActivityIcon className="h-4 w-4" />,
                  onClick: () => router.push("/socios"),
                },
                {
                  id: "sidebar-go-warehouse",
                  label: "Almacén y reparto",
                  icon: <PackageIcon className="h-4 w-4" />,
                  onClick: () => router.push("/almacen"),
                },
              ]
            : undefined
        }
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="bht-sidebar-offset mx-auto max-w-6xl space-y-4 px-3.5 pt-4 sm:px-6 lg:px-8 outline-none md:max-w-none"
      >
        {feedback && (
          <ToastBanner
            type={feedback.type}
            message={feedback.msg}
            action={
              feedback.undoAction && feedback.type !== "err"
                ? {
                    label:
                      busyUndoId === feedback.undoAction.undoId
                        ? "Deshaciendo..."
                        : "Deshacer",
                    disabled: busyUndoId !== null,
                    expiresAt: feedback.undoAction.expiresAt,
                    windowSeconds: feedback.undoAction.windowSeconds,
                    showCountdown: currentUser?.role !== "PARTNER_ADMIN",
                    onClick: () => void handleExecuteUndo(feedback.undoAction!.undoId),
                  }
                : undefined
            }
            onDismiss={() => setFeedback(null)}
          />
        )}

        {liveStatus !== "offline" && (
          <RecentUndoStrip
            refreshKey={undoRefreshSeq + orders.length + quotes.length}
            activeToastUndoId={feedback?.undoAction?.undoId ?? null}
            isAdmin={currentUser?.role === "PARTNER_ADMIN"}
            onUndone={(restoredMsg) => {
              setFeedback({ type: "ok", msg: restoredMsg });
              setUndoRefreshSeq((seq) => seq + 1);
              notifyLocalSync(SELLER_SYNC_SCOPES);
              void data.loadAll({ silent: true });
            }}
            onError={(errMsg) => setFeedback({ type: "err", msg: errMsg })}
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
            onEdit={flow.beginEditingQuote}
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
