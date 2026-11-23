import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CurrentUserInfo } from "@/components/socios/types";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import type {
  WarehouseOrderDto,
  WarehouseOrdersResponseDto,
  WarehouseTripDto,
  WarehouseTripsResponseDto,
} from "@/lib/contracts";
import { readOfflineSnapshot, saveOfflineSnapshot } from "@/lib/offline/outbox";
import type { NextOrderStatus, WarehouseFeedback } from "./types";

export const WAREHOUSE_LAST_ACTOR_STORAGE_KEY = "bht:last-warehouse-actor";
const WAREHOUSE_SNAPSHOT_NAME = "warehouse-orders";

interface WarehouseOfflineSnapshot {
  currentUser: CurrentUserInfo | null;
  orders: WarehouseOrderDto[];
  trips: WarehouseTripDto[];
  savedAt: string;
}

interface Options {
  setFeedback: (feedback: WarehouseFeedback | null) => void;
  pruneChecklist: (activeLineIds: Set<number>) => void;
}

export function isAuthStatus(error: unknown): boolean {
  return (
    error instanceof ApiClientError && (error.status === 401 || error.status === 403)
  );
}

export function useWarehouseData({ setFeedback, pruneChecklist }: Options) {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<CurrentUserInfo | null>(null);
  const [orders, setOrders] = useState<WarehouseOrderDto[]>([]);
  const [trips, setTrips] = useState<WarehouseTripDto[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);

  const loadOrders = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? hasLoadedRef.current;
      if (!silent) setLoading(true);
      try {
        const [data, tripsData] = await Promise.all([
          fetchJson<WarehouseOrdersResponseDto>("/api/orders", {
            cache: "no-store",
          }),
          fetchJson<WarehouseTripsResponseDto>("/api/trips", {
            cache: "no-store",
          }).catch(() => null),
        ]);
        if (data.currentUser) {
          setCurrentUser(data.currentUser);
          try {
            sessionStorage.setItem(
              WAREHOUSE_LAST_ACTOR_STORAGE_KEY,
              String(data.currentUser.username)
            );
          } catch {
            // Online operation remains available if storage is restricted.
          }
        }
        const loadedTrips =
          tripsData && Array.isArray(tripsData.trips) ? tripsData.trips : [];
        if (tripsData) {
          setTrips(loadedTrips);
        }
        const loadedOrders = data.orders || [];
        setOrders(loadedOrders);
        if (data.currentUser?.username) {
          await saveOfflineSnapshot(
            String(data.currentUser.username),
            WAREHOUSE_SNAPSHOT_NAME,
            {
              currentUser: data.currentUser,
              orders: loadedOrders,
              trips: loadedTrips,
              savedAt: new Date().toISOString(),
            } satisfies WarehouseOfflineSnapshot
          ).catch(() => undefined);
        }
        const activeLineIds = new Set<number>();
        for (const ord of loadedOrders) {
          if (ord.operational_status !== "DELIVERED") {
            for (const ln of ord.lines || []) {
              activeLineIds.add(Number(ln.order_line_id));
            }
          }
        }
        pruneChecklist(activeLineIds);
        hasLoadedRef.current = true;
      } catch (error) {
        if (isAuthStatus(error)) {
          router.push("/login");
          return;
        }
        let lastActor: string | null = null;
        try {
          lastActor = sessionStorage.getItem(WAREHOUSE_LAST_ACTOR_STORAGE_KEY);
        } catch {
          // Storage blocked
        }
        if (lastActor && navigator.onLine === false) {
          const snapshot = await readOfflineSnapshot<WarehouseOfflineSnapshot>(
            lastActor,
            WAREHOUSE_SNAPSHOT_NAME
          ).catch(() => null);
          if (snapshot) {
            setCurrentUser(
              snapshot.currentUser ?? {
                userId: 0,
                username: lastActor,
                fullName: lastActor,
                role: "WAREHOUSE_DELIVERY",
              }
            );
            setOrders(snapshot.orders || []);
            setTrips(snapshot.trips || []);
            hasLoadedRef.current = true;
            if (!silent) {
              setFeedback({
                type: "ok",
                msg: "Estás sin conexión. Se cargó la cola local de almacén; las entregas quedarán pendientes de sincronización.",
              });
            }
            return;
          }
        }
        if (!silent) {
          setFeedback({
            type: "err",
            msg:
              error instanceof ApiClientError
                ? error.message
                : "Error de red cargando pedidos operativos.",
          });
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [router, pruneChecklist, setFeedback]
  );

  const applyLocalOrderStatus = useCallback(
    (orderId: number, nextStatus: NextOrderStatus) => {
      setOrders((prev) => {
        const next = prev.map((order) =>
          order.order_id === orderId
            ? { ...order, operational_status: nextStatus }
            : order
        );
        const actor = currentUser?.username;
        if (actor) {
          void saveOfflineSnapshot(actor, WAREHOUSE_SNAPSHOT_NAME, {
            currentUser,
            orders: next,
            trips,
            savedAt: new Date().toISOString(),
          } satisfies WarehouseOfflineSnapshot).catch(() => undefined);
        }
        return next;
      });
    },
    [currentUser, trips]
  );

  useEffect(() => {
    void loadOrders({ silent: false });
  }, [loadOrders]);

  const openTrips = useMemo(() => trips.filter((t) => t.status === "OPEN"), [trips]);

  return {
    currentUser,
    orders,
    trips,
    openTrips,
    loading,
    loadOrders,
    applyLocalOrderStatus,
  };
}
