"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { AppHeader } from "@/components/ui/AppShell";
import { CheckIcon, PackageIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLASS,
  ModalSheet,
  ToastBanner,
} from "@/components/ui/Primitives";
import {
  notifyLocalSync,
  useLiveSync,
  type SyncScope,
} from "@/lib/realtime/useLiveSync";
import { deleteOfflineSnapshotsForActor } from "@/lib/offline/outbox";

interface CurrentWarehouseUser {
  userId: number;
  username: string;
  fullName: string;
  role: string;
}

interface WarehouseLine {
  order_line_id: number;
  line_no: number;
  sku: string;
  raw_description: string;
  unit_of_measure?: string;
  quantity: number;
  fulfillment_mode: "STOCKED" | "ON_DEMAND";
  fulfillment_status: string;
  needs_supplier_pickup: boolean;
}

interface WarehouseOrder {
  order_id: number;
  order_code: string;
  order_date: string;
  customer_name: string;
  was_modified?: boolean;
  trip_id?: number | null;
  trip_code?: string | null;
  operational_status: "REGISTERED" | "PICKING" | "READY" | "IN_ROUTE" | "DELIVERED";
  notes: string | null;
  created_by_name: string | null;
  picked_by_name: string | null;
  delivered_by_name: string | null;
  lines: WarehouseLine[];
}

interface RouteTripRow {
  trip_id: number;
  trip_code: string;
  trip_date: string;
  end_date: string | null;
  zone_name: string | null;
  driver_name: string | null;
  status: "OPEN" | "CLOSED" | "RECONCILED";
  notes: string | null;
  order_count: number;
  ready_count: number;
  in_route_count: number;
  delivered_count: number;
}

const STATUS_TABS = [
  { id: "PREPARING", label: "Por alistar" },
  { id: "READY", label: "Listos / En ruta" },
  { id: "DELIVERED", label: "Entregados" },
] as const;

type WarehouseStage = (typeof STATUS_TABS)[number]["id"];
type PreparingFilter = "ALL" | "NOT_STARTED" | "IN_PROGRESS";

function toWarehouseStage(
  status: WarehouseOrder["operational_status"]
): WarehouseStage {
  if (status === "DELIVERED") return "DELIVERED";
  if (status === "READY" || status === "IN_ROUTE") return "READY";
  return "PREPARING";
}

function formatWarehouseRoleBadge(user: CurrentWarehouseUser | null): string {
  if (!user) return "Almacén y Reparto";
  const area =
    user.role === "PARTNER_ADMIN" ||
    user.role === "PARTNER_MANAGER" ||
    user.username === "almacen1"
      ? "Almacén"
      : "Almacén y Reparto";
  const cleanName = user.fullName?.trim();
  const isLegacySeed =
    cleanName === "Encargado de Almacén" || cleanName === "Chofer y Reparto";
  if (cleanName && !isLegacySeed) {
    return `${cleanName} · ${area}`;
  }
  return area;
}

const CHECKED_STORAGE_KEY = "bht_almacen_checked_lines";
const WAREHOUSE_SYNC_SCOPES: SyncScope[] = ["orders", "inventory"];

export default function AlmacenPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<CurrentWarehouseUser | null>(null);
  const [orders, setOrders] = useState<WarehouseOrder[]>([]);
  const [trips, setTrips] = useState<RouteTripRow[]>([]);
  const [selectedTripByOrder, setSelectedTripByOrder] = useState<
    Record<number, string>
  >({});
  const [showNewTrip, setShowNewTrip] = useState(false);
  const [newTripZone, setNewTripZone] = useState("RUTA LIMA");
  const [newTripDriver, setNewTripDriver] = useState("");
  const [newTripNotes, setNewTripNotes] = useState("");
  const [busyTripAction, setBusyTripAction] = useState(false);
  const [activeTab, setActiveTab] = useState<WarehouseStage>("PREPARING");
  const [preparingFilter, setPreparingFilter] = useState<PreparingFilter>("ALL");
  const [warehouseSearch, setWarehouseSearch] = useState("");
  const [checkedLines, setCheckedLines] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null);
  const [confirmDeliverOrder, setConfirmDeliverOrder] = useState<WarehouseOrder | null>(
    null
  );
  const [confirmCloseTrip, setConfirmCloseTrip] = useState<RouteTripRow | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "ok" | "err";
    msg: string;
  } | null>(null);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    const loadChecklist = () => {
      try {
        const saved =
          localStorage.getItem(CHECKED_STORAGE_KEY) ||
          sessionStorage.getItem(CHECKED_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && typeof parsed === "object") {
            setCheckedLines(parsed);
          }
        }
      } catch {
        // ignore storage failure
      }
    };
    loadChecklist();
    const onStorage = (e: StorageEvent) => {
      if (e.key === CHECKED_STORAGE_KEY) loadChecklist();
    };
    window.addEventListener("storage", onStorage);
    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel(CHECKED_STORAGE_KEY);
      bc.onmessage = (ev) => {
        if (ev.data && typeof ev.data === "object") {
          setCheckedLines(ev.data as Record<number, boolean>);
        }
      };
    }
    return () => {
      window.removeEventListener("storage", onStorage);
      bc?.close();
    };
  }, []);

  const persistChecklist = useCallback((next: Record<number, boolean>) => {
    try {
      localStorage.setItem(CHECKED_STORAGE_KEY, JSON.stringify(next));
      sessionStorage.setItem(CHECKED_STORAGE_KEY, JSON.stringify(next));
      if (typeof BroadcastChannel !== "undefined") {
        const bc = new BroadcastChannel(CHECKED_STORAGE_KEY);
        bc.postMessage(next);
        bc.close();
      }
    } catch {
      // ignore storage failure
    }
  }, []);

  const toggleLineChecked = useCallback(
    (orderLineId: number) => {
      setCheckedLines((prev) => {
        const next = { ...prev, [orderLineId]: !prev[orderLineId] };
        persistChecklist(next);
        return next;
      });
    },
    [persistChecklist]
  );

  const loadOrders = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? hasLoadedRef.current;
      if (!silent) setLoading(true);
      try {
        const [res, tripsRes] = await Promise.all([
          fetch("/api/orders", { cache: "no-store" }),
          fetch("/api/trips", { cache: "no-store" }).catch(() => null),
        ]);
        if (res.status === 401 || res.status === 403) {
          router.push("/login");
          return;
        }
        const data = await res.json();
        if (!res.ok) {
          if (!silent) {
            setFeedback({
              type: "err",
              msg: data.error || "No se pudieron cargar los pedidos operativos.",
            });
          }
          return;
        }
        if (data.currentUser) setCurrentUser(data.currentUser);
        if (tripsRes && tripsRes.ok) {
          const tripsJson = await tripsRes.json();
          setTrips(Array.isArray(tripsJson.trips) ? tripsJson.trips : []);
        }
        const loadedOrders: WarehouseOrder[] = data.orders || [];
        setOrders(loadedOrders);
        const activeLineIds = new Set<number>();
        for (const ord of loadedOrders) {
          if (ord.operational_status !== "DELIVERED") {
            for (const ln of ord.lines || []) {
              activeLineIds.add(Number(ln.order_line_id));
            }
          }
        }
        setCheckedLines((prev) => {
          let changed = false;
          const pruned: Record<number, boolean> = {};
          for (const [k, v] of Object.entries(prev)) {
            const idNum = Number(k);
            if (v && activeLineIds.has(idNum)) {
              pruned[idNum] = true;
            } else if (v) {
              changed = true;
            }
          }
          if (changed) persistChecklist(pruned);
          return changed ? pruned : prev;
        });
        hasLoadedRef.current = true;
      } catch {
        if (!silent) {
          setFeedback({
            type: "err",
            msg: "Error de red cargando pedidos operativos.",
          });
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [router, persistChecklist]
  );

  useEffect(() => {
    loadOrders({ silent: false });
  }, [loadOrders]);

  const handleRemoteChange = useCallback(async () => {
    await loadOrders({ silent: true });
  }, [loadOrders]);

  const handleSyncAuthError = useCallback(() => {
    router.push("/login");
  }, [router]);

  const { liveStatus, triggerSync } = useLiveSync({
    scopes: WAREHOUSE_SYNC_SCOPES,
    enabled: !loggingOut && !confirmDeliverOrder && !confirmCloseTrip && !showNewTrip,
    onRemoteChange: handleRemoteChange,
    onAuthError: handleSyncAuthError,
  });

  const openTrips = useMemo(() => trips.filter((t) => t.status === "OPEN"), [trips]);

  async function handleCreateTrip(e: React.FormEvent) {
    e.preventDefault();
    if (busyTripAction) return;
    setFeedback(null);
    setBusyTripAction(true);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_trip",
          zoneName: newTripZone.trim() || "RUTA LIMA",
          driverName: newTripDriver.trim() || undefined,
          notes: newTripNotes.trim() || undefined,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "err",
          msg: data.error || "No se pudo abrir la ruta de reparto.",
        });
        return;
      }
      setShowNewTrip(false);
      setNewTripNotes("");
      setFeedback({
        type: "ok",
        msg: `Ruta ${data.tripCode} abierta para despachos.`,
      });
      notifyLocalSync(["orders", "partners"]);
      await loadOrders({ silent: true });
    } catch {
      setFeedback({ type: "err", msg: "Error de conexión al abrir ruta." });
    } finally {
      setBusyTripAction(false);
    }
  }

  async function handleCloseTrip(tripId: number) {
    if (busyTripAction) return;
    setFeedback(null);
    setBusyTripAction(true);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close_trip", tripId, nextStatus: "CLOSED" }),
      });
      if (res.status === 401 || res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "err",
          msg: data.error || "No se pudo cerrar la ruta.",
        });
        return;
      }
      setFeedback({ type: "ok", msg: "Ruta cerrada correctamente." });
      notifyLocalSync(["orders", "partners"]);
      await loadOrders({ silent: true });
    } catch {
      setFeedback({ type: "err", msg: "Error de conexión al cerrar ruta." });
    } finally {
      setBusyTripAction(false);
    }
  }

  async function handleDispatchToRoute(order: WarehouseOrder) {
    if (busyOrderId === order.order_id) return;
    setFeedback(null);
    setBusyOrderId(order.order_id);
    try {
      const chosenTripId =
        selectedTripByOrder[order.order_id] ||
        (openTrips[0] ? String(openTrips[0].trip_id) : "");
      if (!chosenTripId) {
        setShowNewTrip(true);
        setFeedback({
          type: "err",
          msg: "Abre una ruta antes de despachar el pedido.",
        });
        return;
      }
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign_order",
          tripId: Number(chosenTripId),
          orderId: order.order_id,
          advanceToInRoute: true,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "err",
          msg: data.error || "No se pudo despachar el pedido a ruta.",
        });
        return;
      }
      setFeedback({
        type: "ok",
        msg: `Pedido ${order.order_code} despachado en ruta.`,
      });
      notifyLocalSync(["orders", "inventory", "partners"]);
      await loadOrders({ silent: true });
    } catch {
      setFeedback({
        type: "err",
        msg: "Error de conexión al enviar pedido en ruta.",
      });
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleAdvance(
    orderId: number,
    nextStatus: "PICKING" | "READY" | "IN_ROUTE" | "DELIVERED"
  ) {
    if (busyOrderId === orderId) return;
    setFeedback(null);
    setBusyOrderId(orderId);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "advance", orderId, nextStatus }),
      });
      if (res.status === 401 || res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "err",
          msg: data.error || "No se pudo actualizar el estado del pedido.",
        });
        return;
      }
      notifyLocalSync(["orders", "inventory", "partners"]);
      await loadOrders({ silent: true });
    } catch {
      setFeedback({
        type: "err",
        msg: "Error de conexión al actualizar el pedido.",
      });
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      if (currentUser?.username) {
        await deleteOfflineSnapshotsForActor(currentUser.username).catch(
          () => undefined
        );
      }
      await authClient.signOut();
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

  return (
    <div className="min-h-screen bg-[#FAF9F6] pb-12">
      <AppHeader
        title="Cola de Pedidos y Despacho"
        roleLabel={formatWarehouseRoleBadge(currentUser)}
        roleTone="horizon"
        roleDotColor="bg-[#1E446B]"
        syncStatus={liveStatus}
        onSyncClick={() => void triggerSync({ force: true })}
        maxWidth="5xl"
        actions={
          currentUser?.role === "PARTNER_ADMIN" ||
          currentUser?.role === "PARTNER_MANAGER" ? (
            <Button
              variant="outline"
              size="md"
              onClick={() => router.push("/socios")}
              className="min-h-[38px] sm:min-h-[40px] px-3.5 text-xs sm:text-sm"
            >
              Control Operativo
            </Button>
          ) : undefined
        }
        onLogout={handleLogout}
      />

      <nav
        aria-label="Etapas de despacho"
        className="border-b border-[#E7E5E0] bg-[#FAF9F6]/92"
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
                className={`flex min-h-[38px] flex-shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 focus-visible:ring-offset-1 sm:px-3.5 ${
                  active
                    ? "border-[#0F2942] bg-[#0F2942] text-white shadow-xs"
                    : "border-[#E7E5E0] bg-white text-[#5C5A55] hover:border-[#D4E0EC] hover:bg-[#F2F6FA] hover:text-[#0F2942]"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none ${
                    active ? "bg-white/20 text-white" : "bg-[#F4F3EF] text-[#18181B]"
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
            onDismiss={() => setFeedback(null)}
          />
        )}

        {activeTab === "PREPARING" && (
          <div className="flex flex-col gap-2 rounded-xl border border-[#E7E5E0] bg-white p-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div
              className="flex gap-1"
              role="group"
              aria-label="Filtrar cola de alistamiento"
            >
              {(
                [
                  ["ALL", "Todos"],
                  ["NOT_STARTED", "Sin empezar"],
                  ["IN_PROGRESS", "En proceso"],
                ] as Array<[PreparingFilter, string]>
              ).map(([id, label]) => (
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
          <Card id="route-control" padding="sm" className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-xs font-semibold text-[#18181B]">
                  Rutas de Reparto ({openTrips.length} activa
                  {openTrips.length === 1 ? "" : "s"})
                </span>
                <p className="text-xs text-[#5C5A55]">
                  Asigna pedidos listos a una salida en ruta antes de entregar.
                </p>
              </div>
              <Button
                type="button"
                variant={showNewTrip ? "ghost" : "outline"}
                size="sm"
                onClick={() => setShowNewTrip((v) => !v)}
              >
                {showNewTrip ? "Cancelar" : "+ Abrir Ruta"}
              </Button>
            </div>

            {showNewTrip && (
              <form
                onSubmit={handleCreateTrip}
                className="grid grid-cols-1 gap-2 rounded-xl border border-[#E7E5E0] bg-[#FAF9F6] p-3 sm:grid-cols-4"
              >
                <input
                  type="text"
                  value={newTripZone}
                  onChange={(e) => setNewTripZone(e.target.value)}
                  aria-label="Zona de ruta"
                  placeholder="Zona (ej. RUTA NORTE)"
                  className={`${INPUT_CLASS} py-1.5 text-xs`}
                />
                <input
                  type="text"
                  value={newTripDriver}
                  onChange={(e) => setNewTripDriver(e.target.value)}
                  aria-label="Repartidor"
                  placeholder="Repartidor (opcional)"
                  className={`${INPUT_CLASS} py-1.5 text-xs`}
                />
                <input
                  type="text"
                  value={newTripNotes}
                  onChange={(e) => setNewTripNotes(e.target.value)}
                  aria-label="Notas de ruta"
                  placeholder="Placa / notas (opcional)"
                  className={`${INPUT_CLASS} py-1.5 text-xs`}
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={busyTripAction}
                >
                  {busyTripAction ? "Abriendo..." : "Confirmar Ruta"}
                </Button>
              </form>
            )}

            {openTrips.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {openTrips.map((trip) => (
                  <div
                    key={trip.trip_id}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-[#D4E0EC] bg-[#F2F6FA] px-3 py-1.5 text-xs"
                  >
                    <span className="font-semibold text-[#0F2942] tabular-nums">
                      {trip.trip_code}
                    </span>
                    <span className="text-[#5C5A55]">
                      {trip.zone_name || "Ruta"} · {trip.driver_name || "Reparto"}
                    </span>
                    <Badge tone="horizon" className="tabular-nums">
                      {trip.in_route_count} en ruta · {trip.delivered_count} entregados
                    </Badge>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-compact="true"
                      disabled={busyTripAction}
                      onClick={() => setConfirmCloseTrip(trip)}
                    >
                      Cerrar Ruta
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {loading && orders.length === 0 ? (
          <Card className="p-8 text-center text-sm text-[#5C5A55]">
            Cargando pedidos operativos...
          </Card>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<PackageIcon className="h-5 w-5" />}
            title="Sin pedidos en esta etapa"
            description="Cuando ingresen o avancen pedidos a esta cola aparecerán aquí."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 md:items-start">
            {filtered.map((order) => {
              const checkedCount = order.lines.filter(
                (l) => checkedLines[l.order_line_id]
              ).length;
              const isBusy = busyOrderId === order.order_id;
              const stage = toWarehouseStage(order.operational_status);
              const isActiveQueue = stage !== "DELIVERED";
              const remainingLines = Math.max(0, order.lines.length - checkedCount);

              return (
                <Card
                  key={order.order_id}
                  accent={isActiveQueue ? "horizon" : "none"}
                  padding="md"
                  className="space-y-3"
                >
                  <div className="flex items-start justify-between gap-3 border-b border-[#E7E5E0] pb-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-[#1E446B] tabular-nums">
                          {order.order_code}
                        </span>
                        <span className="text-xs text-[#6D6A64] tabular-nums">
                          {order.order_date}
                        </span>
                        {order.was_modified && <Badge tone="warning">Modificado</Badge>}
                        {order.operational_status === "IN_ROUTE" && (
                          <Badge tone="brand">
                            En ruta{order.trip_code ? ` · ${order.trip_code}` : ""}
                          </Badge>
                        )}
                        {order.operational_status !== "IN_ROUTE" && order.trip_code && (
                          <Badge tone="neutral">{order.trip_code}</Badge>
                        )}
                      </div>
                      <h2 className="mt-0.5 text-base font-semibold text-[#18181B]">
                        {order.customer_name}
                      </h2>
                      {order.notes && (
                        <p className="mt-1.5 rounded-lg border border-[#F3D9B1] bg-[#FDF8F0] px-2.5 py-1.5 text-xs font-medium text-[#92400E]">
                          Destino / Nota: {order.notes}
                        </p>
                      )}
                    </div>
                    <Badge
                      tone={stage === "DELIVERED" ? "success" : "horizon"}
                      className="tabular-nums"
                    >
                      {stage === "DELIVERED"
                        ? "Entregado"
                        : `${checkedCount}/${order.lines.length} ítems`}
                    </Badge>
                  </div>

                  <ul
                    aria-label={`Productos del pedido ${order.order_code}`}
                    className="divide-y divide-[#E7E5E0]"
                  >
                    {order.lines.map((line) => {
                      const isDelivered = stage === "DELIVERED";
                      const checked =
                        isDelivered || Boolean(checkedLines[line.order_line_id]);
                      const lineBody = (
                        <>
                          <div className="flex min-w-0 items-start gap-3">
                            <span
                              aria-hidden="true"
                              className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border transition ${
                                isDelivered
                                  ? "border-[#15803D]/30 bg-[#EEF9F1] text-[#15803D]"
                                  : checked
                                    ? "border-[#0F2942] bg-[#0F2942] text-white"
                                    : "border-[#D5D2CA] bg-white"
                              }`}
                            >
                              {checked && <CheckIcon className="h-3.5 w-3.5" />}
                            </span>
                            <div className="min-w-0">
                              <p
                                className={`text-sm font-medium ${
                                  !isDelivered && checked
                                    ? "line-through text-[#6D6A64]"
                                    : "text-[#18181B]"
                                }`}
                              >
                                {line.raw_description}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className="text-xs font-medium text-[#5C5A55]">
                                  {line.sku}
                                </span>
                                {line.needs_supplier_pickup && (
                                  <Badge
                                    tone="warning"
                                    className="whitespace-normal text-left"
                                  >
                                    Recoger de proveedor (bajo pedido)
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>

                          <div
                            className={`flex-shrink-0 rounded-xl px-3 py-1.5 text-sm font-semibold tabular-nums ${
                              isDelivered
                                ? "bg-[#F4F3EF] text-[#4A4843]"
                                : checked
                                  ? "bg-[#F4F3EF] text-[#6D6A64]"
                                  : "bg-[#0F2942] text-white"
                            }`}
                          >
                            × {line.quantity}
                            {line.unit_of_measure ? (
                              <span
                                className={`ml-1.5 text-xs font-medium uppercase ${
                                  isDelivered || checked
                                    ? "text-[#6D6A64]"
                                    : "text-white/80"
                                }`}
                              >
                                {line.unit_of_measure}
                              </span>
                            ) : null}
                          </div>
                        </>
                      );

                      return (
                        <li key={line.order_line_id}>
                          {isDelivered ? (
                            <div className="flex min-h-[44px] items-center justify-between gap-3 px-1.5 py-3">
                              {lineBody}
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggleLineChecked(line.order_line_id)}
                              aria-pressed={checked}
                              aria-label={`${
                                checked ? "Desmarcar" : "Marcar"
                              } ${line.raw_description}, código ${
                                line.sku
                              }, cantidad ${line.quantity}${
                                line.unit_of_measure ? ` ${line.unit_of_measure}` : ""
                              }`}
                              className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg px-1.5 py-3 text-left transition hover:bg-[#F2F6FA]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 cursor-pointer"
                            >
                              {lineBody}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-[#D4E0EC]/70 bg-[#F2F6FA]/75 px-3 py-2 text-xs text-[#1E446B]">
                    <strong>
                      Etapa:{" "}
                      {order.operational_status === "IN_ROUTE"
                        ? "En ruta"
                        : stage === "PREPARING"
                          ? "Alistamiento"
                          : stage === "READY"
                            ? "Listo para despacho"
                            : "Entregado"}
                    </strong>
                    <span>Tomó: {order.created_by_name || "Sistema"}</span>
                    {order.picked_by_name && (
                      <span>· Preparó: {order.picked_by_name}</span>
                    )}
                    {order.delivered_by_name && (
                      <span>· Entregó: {order.delivered_by_name}</span>
                    )}
                  </div>

                  {stage === "PREPARING" && (
                    <Button
                      variant="primary"
                      size="lg"
                      disabled={isBusy || remainingLines > 0}
                      onClick={() => handleAdvance(order.order_id, "READY")}
                      aria-label={`Marcar pedido ${order.order_code} como pedido listo`}
                      className="w-full"
                    >
                      <PackageIcon className="h-4 w-4" />
                      {isBusy
                        ? "Actualizando..."
                        : remainingLines > 0
                          ? `Falta verificar ${remainingLines} producto${remainingLines === 1 ? "" : "s"}`
                          : "Alistamiento completo · Marcar listo"}
                    </Button>
                  )}
                  {order.operational_status === "READY" && (
                    <div className="space-y-2">
                      {openTrips.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            aria-label={`Ruta para pedido ${order.order_code}`}
                            value={
                              selectedTripByOrder[order.order_id] ??
                              String(openTrips[0].trip_id)
                            }
                            onChange={(e) =>
                              setSelectedTripByOrder((prev) => ({
                                ...prev,
                                [order.order_id]: e.target.value,
                              }))
                            }
                            className={`${INPUT_CLASS} min-w-[140px] flex-1 py-2 text-xs`}
                          >
                            {openTrips.map((t) => (
                              <option key={t.trip_id} value={String(t.trip_id)}>
                                {t.trip_code} ({t.zone_name || "Ruta"})
                              </option>
                            ))}
                          </select>
                          <Button
                            variant="primary"
                            size="lg"
                            disabled={isBusy}
                            onClick={() => handleDispatchToRoute(order)}
                            className="w-full sm:w-auto sm:flex-1"
                          >
                            {isBusy ? "Enviando..." : "Asignar y enviar en ruta"}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="primary"
                          size="lg"
                          onClick={() => {
                            setShowNewTrip(true);
                            requestAnimationFrame(() =>
                              document.getElementById("route-control")?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              })
                            );
                          }}
                          className="w-full"
                        >
                          Abrir una ruta para despachar
                        </Button>
                      )}
                    </div>
                  )}
                  {order.operational_status === "IN_ROUTE" && (
                    <Button
                      variant="success"
                      size="lg"
                      disabled={isBusy}
                      onClick={() => setConfirmDeliverOrder(order)}
                      aria-label={`Confirmar entrega del pedido ${order.order_code}`}
                      className="w-full"
                    >
                      <CheckIcon className="h-4 w-4" />
                      {isBusy ? "Actualizando..." : "Marcar Entregado"}
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </main>

      <ModalSheet
        open={Boolean(confirmCloseTrip)}
        onClose={() => {
          if (!busyTripAction) setConfirmCloseTrip(null);
        }}
        title="Cerrar ruta de reparto"
        subtitle={confirmCloseTrip?.trip_code}
      >
        {confirmCloseTrip && (
          <div className="space-y-4 text-xs text-[#5C5A55] sm:text-sm">
            <p>
              Confirma que la salida de {confirmCloseTrip.zone_name || "reparto"}{" "}
              terminó. La ruta dejará de estar disponible para asignar pedidos.
            </p>
            {confirmCloseTrip.in_route_count > 0 && (
              <p className="rounded-xl border border-[#F3D9B1] bg-[#FDF8F0] px-3 py-2.5 text-xs text-[#92400E]">
                Aún figuran {confirmCloseTrip.in_route_count} pedido(s) en ruta. Revisa
                sus entregas antes de cerrar.
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={busyTripAction}
                onClick={() => setConfirmCloseTrip(null)}
              >
                Volver
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={busyTripAction || confirmCloseTrip.in_route_count > 0}
                onClick={async () => {
                  const trip = confirmCloseTrip;
                  setConfirmCloseTrip(null);
                  await handleCloseTrip(trip.trip_id);
                }}
              >
                {busyTripAction ? "Cerrando..." : "Confirmar cierre de ruta"}
              </Button>
            </div>
          </div>
        )}
      </ModalSheet>

      <ModalSheet
        open={Boolean(confirmDeliverOrder)}
        onClose={() => {
          if (busyOrderId === null) setConfirmDeliverOrder(null);
        }}
        title={
          confirmDeliverOrder
            ? `Confirmar entrega · ${confirmDeliverOrder.order_code}`
            : "Confirmar entrega"
        }
        subtitle={confirmDeliverOrder?.customer_name}
      >
        {confirmDeliverOrder &&
          (() => {
            const totalLines = confirmDeliverOrder.lines.length;
            const checkedInOrder = confirmDeliverOrder.lines.filter((ln) =>
              Boolean(checkedLines[ln.order_line_id])
            ).length;
            const isDeliverBusy = busyOrderId === confirmDeliverOrder.order_id;
            return (
              <div className="space-y-4 text-xs sm:text-sm text-[#5C5A55]">
                <p>
                  ¿Confirmas que todos los productos de{" "}
                  <strong className="text-[#18181B]">
                    {confirmDeliverOrder.order_code}
                  </strong>{" "}
                  ({totalLines} ítem(s)) fueron entregados al cliente?
                </p>
                {checkedInOrder < totalLines && (
                  <p className="rounded-xl border border-[#F3D9B1] bg-[#FDF8F0] px-3 py-2.5 text-xs text-[#92400E]">
                    Llevas marcados {checkedInOrder} de {totalLines} ítems en la lista
                    de verificación.
                  </p>
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isDeliverBusy}
                    onClick={() => setConfirmDeliverOrder(null)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    variant="success"
                    disabled={isDeliverBusy}
                    onClick={async () => {
                      const target = confirmDeliverOrder;
                      setConfirmDeliverOrder(null);
                      await handleAdvance(target.order_id, "DELIVERED");
                    }}
                  >
                    {isDeliverBusy ? "Confirmando..." : "Sí, marcar entregado"}
                  </Button>
                </div>
              </div>
            );
          })()}
      </ModalSheet>
    </div>
  );
}
