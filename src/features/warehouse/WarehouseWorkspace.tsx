"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOutFromERP } from "@/lib/auth/logout-client";
import {
  AppHeader,
  BottomNav,
  type NavExtraAction,
  type NavTabItem,
} from "@/components/ui/AppShell";
import {
  ActivityIcon,
  CheckIcon,
  PackageIcon,
  ShoppingBagIcon,
  TruckIcon,
} from "@/components/ui/Icons";
import {
  Button,
  EmptyState,
  INPUT_CLASS,
  ToastBanner,
} from "@/components/ui/Primitives";
import { SkeletonCards } from "@/components/ui/Skeleton";
import { RecentUndoStrip } from "@/components/shared/RecentUndoStrip";
import { ApiClientError } from "@/lib/api-client";
import {
  notifyLocalSync,
  useLiveSync,
  type SyncScope,
} from "@/lib/realtime/useLiveSync";
import { executeUndoRequest } from "@/lib/undo-client";
import { deleteOfflineSnapshotsForActor } from "@/lib/offline/outbox";
import type { WarehouseOrderDto, WarehouseTripDto } from "@/lib/contracts";
import {
  STATUS_TABS,
  type PreparingFilter,
  type WarehouseFeedback,
  type WarehouseStage,
} from "./types";
import { formatWarehouseRoleBadge, toWarehouseStage } from "./warehouse-utils";
import { useWarehouseChecklist } from "./useWarehouseChecklist";
import { useWarehouseData } from "./useWarehouseData";
import { useWarehouseActions } from "./useWarehouseActions";
import { WarehouseOrderCard } from "./WarehouseOrderCard";
import { WarehouseRoutePanel } from "./WarehouseRoutePanel";
import { CloseTripModal, DeliverOrderModal } from "./WarehouseModals";

const WAREHOUSE_SYNC_SCOPES: SyncScope[] = ["orders", "inventory"];

const PREPARING_FILTERS: Array<[PreparingFilter, string]> = [
  ["ALL", "Todos"],
  ["NOT_STARTED", "Sin empezar"],
  ["IN_PROGRESS", "En proceso"],
];

export default function WarehouseWorkspace() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<WarehouseStage>("PREPARING");
  const [preparingFilter, setPreparingFilter] = useState<PreparingFilter>("ALL");
  const [warehouseSearch, setWarehouseSearch] = useState("");
  const [confirmDeliverOrder, setConfirmDeliverOrder] =
    useState<WarehouseOrderDto | null>(null);
  const [confirmCloseTrip, setConfirmCloseTrip] = useState<WarehouseTripDto | null>(
    null
  );
  const [loggingOut, setLoggingOut] = useState(false);
  const [feedback, setFeedback] = useState<WarehouseFeedback | null>(null);
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

  const { checkedLines, toggleLineChecked, pruneChecklist } = useWarehouseChecklist();
  const { currentUser, orders, openTrips, loading, loadOrders, applyLocalOrderStatus } =
    useWarehouseData({
      setFeedback,
      pruneChecklist,
    });
  const actions = useWarehouseActions({
    currentUser,
    openTrips,
    loadOrders,
    setFeedback,
    onOptimisticStatusChange: applyLocalOrderStatus,
  });

  const handleExecuteUndo = useCallback(
    async (undoId: number) => {
      if (busyUndoId !== null) return;
      setBusyUndoId(undoId);
      try {
        const res = await executeUndoRequest(undoId);
        setFeedback({ type: "ok", msg: res.restoredMessage });
        setUndoRefreshSeq((seq) => seq + 1);
        notifyLocalSync(["orders", "inventory", "partners"]);
        await loadOrders({ silent: true });
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
    [busyUndoId, loadOrders]
  );

  const handleRemoteChange = useCallback(async () => {
    await loadOrders({ silent: true });
  }, [loadOrders]);

  const handleSyncAuthError = useCallback(() => {
    router.push("/login");
  }, [router]);

  const { liveStatus, triggerSync } = useLiveSync({
    scopes: WAREHOUSE_SYNC_SCOPES,
    enabled:
      !loggingOut && !confirmDeliverOrder && !confirmCloseTrip && !actions.showNewTrip,
    onRemoteChange: handleRemoteChange,
    onAuthError: handleSyncAuthError,
  });

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

  const countsByStatus = useMemo(() => {
    const counts: Record<WarehouseStage, number> = {
      PREPARING: 0,
      READY: 0,
      DELIVERED: 0,
    };
    for (const o of orders) {
      counts[toWarehouseStage(o.operational_status)] += 1;
    }
    return counts;
  }, [orders]);

  const mobileNavItems: NavTabItem<WarehouseStage>[] = useMemo(
    () => [
      {
        id: "PREPARING",
        label: "Alistar",
        mobileLabel: "Alistar",
        icon: <PackageIcon className="h-4 w-4" />,
        badgeCount: countsByStatus.PREPARING,
      },
      {
        id: "READY",
        label: "Despacho",
        mobileLabel: "Despacho",
        icon: <TruckIcon className="h-4 w-4" />,
        badgeCount: countsByStatus.READY,
      },
      {
        id: "DELIVERED",
        label: "Historial",
        mobileLabel: "Historial",
        icon: <CheckIcon className="h-4 w-4" />,
        badgeCount: countsByStatus.DELIVERED,
      },
    ],
    [countsByStatus]
  );

  const filtered = useMemo(() => {
    const query = warehouseSearch.trim().toLocaleLowerCase("es");
    return orders.filter((order) => {
      if (toWarehouseStage(order.operational_status) !== activeTab) return false;
      if (
        query &&
        !`${order.order_code} ${order.customer_name} ${order.created_by_name ?? ""}`
          .toLocaleLowerCase("es")
          .includes(query)
      ) {
        return false;
      }
      if (activeTab !== "PREPARING" || preparingFilter === "ALL") return true;
      const checkedCount = order.lines.filter(
        (line) => checkedLines[line.order_line_id]
      ).length;
      return preparingFilter === "NOT_STARTED" ? checkedCount === 0 : checkedCount > 0;
    });
  }, [activeTab, checkedLines, orders, preparingFilter, warehouseSearch]);

  const isPartnerUser =
    currentUser?.role === "PARTNER_ADMIN" || currentUser?.role === "PARTNER_MANAGER";

  const warehouseExtraActions: NavExtraAction[] | undefined = useMemo(
    () =>
      isPartnerUser
        ? [
            {
              id: "go-partners",
              label: "Control Operativo",
              icon: <ActivityIcon className="h-4 w-4" />,
              onClick: () => router.push("/socios"),
            },
            {
              id: "go-seller",
              label: "Nuevo pedido",
              icon: <ShoppingBagIcon className="h-4 w-4" />,
              onClick: () => router.push("/vendedor"),
            },
          ]
        : undefined,
    [isPartnerUser, router]
  );

  return (
    <div className="min-h-[100dvh] bg-bht-paper pb-24 md:pb-12">
      <AppHeader
        title="Cola de Pedidos y Despacho"
        roleLabel={formatWarehouseRoleBadge(currentUser)}
        roleTone="horizon"
        roleDotColor="bg-bht-navy-mid"
        syncStatus={liveStatus}
        onSyncClick={() => void triggerSync({ force: true })}
        maxWidth="5xl"
        actions={
          isPartnerUser ? (
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
                onClick={() => router.push("/vendedor")}
                className="hidden sm:inline-flex min-h-[38px] sm:min-h-[40px] px-3.5 text-xs sm:text-sm"
              >
                Nuevo pedido
              </Button>
            </div>
          ) : undefined
        }
        onLogout={handleLogout}
      />

      <nav
        aria-label="Etapas de despacho"
        className="border-b border-bht-line bg-bht-paper/92"
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-1.5 px-3.5 py-2.5 sm:px-5">
          {STATUS_TABS.map((tab) => {
            const count = countsByStatus[tab.id];
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => setActiveTab(tab.id)}
                className={`flex min-h-[38px] flex-shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep/45 focus-visible:ring-offset-1 sm:px-3.5 ${
                  active
                    ? "border-bht-navy-deep bg-bht-navy-deep text-white shadow-xs"
                    : "border-bht-line bg-white text-bht-ink-soft hover:border-bht-line-blue hover:bg-bht-mist hover:text-bht-navy-deep"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none ${
                    active
                      ? "bg-white/20 text-white"
                      : "bg-bht-paper-alt text-bht-ink-strong"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-5xl space-y-3.5 px-3.5 pt-4 sm:px-5 outline-none"
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

        <RecentUndoStrip
          refreshKey={undoRefreshSeq + orders.length + openTrips.length}
          activeToastUndoId={feedback?.undoAction?.undoId ?? null}
          isAdmin={currentUser?.role === "PARTNER_ADMIN"}
          onUndone={(restoredMsg) => {
            setFeedback({ type: "ok", msg: restoredMsg });
            setUndoRefreshSeq((seq) => seq + 1);
            notifyLocalSync(["orders", "inventory", "partners"]);
            void loadOrders({ silent: true });
          }}
          onError={(errMsg) => setFeedback({ type: "err", msg: errMsg })}
        />

        {activeTab === "PREPARING" && (
          <div className="flex flex-col gap-2 rounded-xl border border-bht-line bg-white p-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div
              className="flex gap-1"
              role="group"
              aria-label="Filtrar cola de alistamiento"
            >
              {PREPARING_FILTERS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={preparingFilter === id}
                  onClick={() => setPreparingFilter(id)}
                  className={`min-h-10 rounded-lg px-3 text-xs font-semibold ${preparingFilter === id ? "bg-[var(--bht-navy)] text-white" : "text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={warehouseSearch}
              onChange={(event) => setWarehouseSearch(event.target.value)}
              placeholder="Buscar pedido o cliente…"
              aria-label="Buscar en la cola de alistamiento"
              className={`${INPUT_CLASS} sm:max-w-xs`}
            />
          </div>
        )}

        {activeTab === "DELIVERED" && (
          <input
            type="search"
            value={warehouseSearch}
            onChange={(event) => setWarehouseSearch(event.target.value)}
            placeholder="Buscar pedido, cliente o responsable…"
            aria-label="Buscar pedidos entregados"
            className={`${INPUT_CLASS} bg-white`}
          />
        )}

        {activeTab === "READY" && (
          <WarehouseRoutePanel
            openTrips={openTrips}
            showNewTrip={actions.showNewTrip}
            onToggleNewTrip={() => actions.setShowNewTrip((v) => !v)}
            onCreateTrip={actions.handleCreateTrip}
            newTripZone={actions.newTripZone}
            onZoneChange={actions.setNewTripZone}
            newTripDriver={actions.newTripDriver}
            onDriverChange={actions.setNewTripDriver}
            newTripNotes={actions.newTripNotes}
            onNotesChange={actions.setNewTripNotes}
            busyTripAction={actions.busyTripAction}
            onRequestCloseTrip={setConfirmCloseTrip}
          />
        )}

        {loading && orders.length === 0 ? (
          <SkeletonCards count={4} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<PackageIcon className="h-5 w-5" />}
            title="Sin pedidos en esta etapa"
            description="Cuando ingresen o avancen pedidos a esta cola aparecerán aquí."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 md:items-start">
            {filtered.map((order) => (
              <WarehouseOrderCard
                key={order.order_id}
                order={order}
                checkedLines={checkedLines}
                isBusy={actions.busyOrderId === order.order_id}
                isPinningGeo={actions.busyGeoOrderId === order.order_id}
                openTrips={openTrips}
                selectedTripId={actions.selectedTripByOrder[order.order_id]}
                onSelectTrip={(orderId, tripId) =>
                  actions.setSelectedTripByOrder((prev) => ({
                    ...prev,
                    [orderId]: tripId,
                  }))
                }
                onToggleLine={toggleLineChecked}
                onAdvance={actions.handleAdvance}
                onDispatch={actions.handleDispatchToRoute}
                onRequestDeliver={setConfirmDeliverOrder}
                onPinCustomerGps={actions.handlePinCustomerGps}
                onOpenNewTrip={() => {
                  actions.setShowNewTrip(true);
                  requestAnimationFrame(() =>
                    document.getElementById("route-control")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    })
                  );
                }}
              />
            ))}
          </div>
        )}
      </main>

      <CloseTripModal
        trip={confirmCloseTrip}
        busyTripAction={actions.busyTripAction}
        onDismiss={() => setConfirmCloseTrip(null)}
        onConfirm={actions.handleCloseTrip}
      />
      <DeliverOrderModal
        order={confirmDeliverOrder}
        checkedLines={checkedLines}
        busyOrderId={actions.busyOrderId}
        onDismiss={() => setConfirmDeliverOrder(null)}
        onConfirm={(orderId) => actions.handleAdvance(orderId, "DELIVERED")}
      />

      <BottomNav
        items={mobileNavItems}
        activeId={activeTab}
        onChange={setActiveTab}
        maxWidth="full"
        visibleCount={3}
        extraActions={warehouseExtraActions}
        className="md:hidden"
      />
    </div>
  );
}
