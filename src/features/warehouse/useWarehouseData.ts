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
import type { WarehouseFeedback } from "./types";

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
        if (data.currentUser) setCurrentUser(data.currentUser);
        if (tripsData) {
          setTrips(Array.isArray(tripsData.trips) ? tripsData.trips : []);
        }
        const loadedOrders = data.orders || [];
        setOrders(loadedOrders);
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

  useEffect(() => {
    loadOrders({ silent: false });
  }, [loadOrders]);

  const openTrips = useMemo(() => trips.filter((t) => t.status === "OPEN"), [trips]);

  return { currentUser, orders, trips, openTrips, loading, loadOrders };
}
