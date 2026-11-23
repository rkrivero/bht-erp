import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CurrentUserInfo } from "@/components/socios/types";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import type {
  UndoActionReceiptDto,
  WarehouseOrderDto,
  WarehouseTripDto,
  WarehouseTripMutationResponseDto,
} from "@/lib/contracts";
import { formatOperationalStatusEs } from "@/lib/labels-es";
import { submitOfflineCapable } from "@/lib/offline/outbox";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import type { NextOrderStatus, WarehouseFeedback } from "./types";
import { isAuthStatus, WAREHOUSE_LAST_ACTOR_STORAGE_KEY } from "./useWarehouseData";

interface Options {
  currentUser?: CurrentUserInfo | null;
  openTrips: WarehouseTripDto[];
  loadOrders: (opts?: { silent?: boolean }) => Promise<void>;
  setFeedback: (feedback: WarehouseFeedback | null) => void;
  onOptimisticStatusChange?: (orderId: number, nextStatus: NextOrderStatus) => void;
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function resolveWarehouseActor(currentUser?: CurrentUserInfo | null): string {
  if (currentUser?.username) return currentUser.username;
  if (typeof sessionStorage !== "undefined") {
    try {
      const stored = sessionStorage.getItem(WAREHOUSE_LAST_ACTOR_STORAGE_KEY);
      if (stored) return stored;
    } catch {
      // ignore storage errors
    }
  }
  return "almacen";
}

export function useWarehouseActions({
  currentUser,
  openTrips,
  loadOrders,
  setFeedback,
  onOptimisticStatusChange,
}: Options) {
  const router = useRouter();
  const [selectedTripByOrder, setSelectedTripByOrder] = useState<
    Record<number, string>
  >({});
  const [showNewTrip, setShowNewTrip] = useState(false);
  const [newTripZone, setNewTripZone] = useState("RUTA LIMA");
  const [newTripDriver, setNewTripDriver] = useState("");
  const [newTripNotes, setNewTripNotes] = useState("");
  const [busyTripAction, setBusyTripAction] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null);
  const [busyGeoOrderId, setBusyGeoOrderId] = useState<number | null>(null);

  function reportFailure(error: unknown, fallbackNetwork: string) {
    if (isAuthStatus(error)) {
      router.push("/login");
      return;
    }
    setFeedback({
      type: "err",
      msg:
        error instanceof ApiClientError
          ? error.message
          : error instanceof Error && error.message
            ? error.message
            : fallbackNetwork,
    });
  }

  async function handleCreateTrip(e: FormEvent) {
    e.preventDefault();
    if (busyTripAction) return;
    setFeedback(null);
    setBusyTripAction(true);
    try {
      const data = await postJson<WarehouseTripMutationResponseDto>("/api/trips", {
        action: "create_trip",
        zoneName: newTripZone.trim() || "RUTA LIMA",
        driverName: newTripDriver.trim() || undefined,
        notes: newTripNotes.trim() || undefined,
      });
      setShowNewTrip(false);
      setNewTripNotes("");
      setFeedback({
        type: "ok",
        msg: `Ruta ${data.tripCode} abierta para despachos.`,
      });
      notifyLocalSync(["orders", "partners"]);
      await loadOrders({ silent: true });
    } catch (error) {
      reportFailure(error, "Error de conexión al abrir ruta.");
    } finally {
      setBusyTripAction(false);
    }
  }

  async function handleCloseTrip(tripId: number) {
    if (busyTripAction) return;
    setFeedback(null);
    setBusyTripAction(true);
    try {
      const res = await postJson<{ undoAction?: UndoActionReceiptDto }>("/api/trips", {
        action: "close_trip",
        tripId,
        nextStatus: "CLOSED",
      });
      setFeedback({
        type: "ok",
        msg: "Ruta cerrada correctamente.",
        undoAction: res.undoAction,
      });
      notifyLocalSync(["orders", "partners"]);
      await loadOrders({ silent: true });
    } catch (error) {
      reportFailure(error, "Error de conexión al cerrar ruta.");
    } finally {
      setBusyTripAction(false);
    }
  }

  async function handleDispatchToRoute(order: WarehouseOrderDto) {
    if (busyOrderId !== null) return;
    setFeedback(null);
    setBusyOrderId(order.order_id);
    try {
      const candidateTripId = selectedTripByOrder[order.order_id];
      const validSelected =
        candidateTripId &&
        openTrips.some((t) => String(t.trip_id) === candidateTripId);
      const chosenTripId = validSelected
        ? candidateTripId
        : openTrips[0]
          ? String(openTrips[0].trip_id)
          : "";
      if (!chosenTripId) {
        setShowNewTrip(true);
        setFeedback({
          type: "err",
          msg: "Abre una ruta antes de despachar el pedido.",
        });
        return;
      }
      const res = await postJson<{ undoAction?: UndoActionReceiptDto }>("/api/trips", {
        action: "assign_order",
        tripId: Number(chosenTripId),
        orderId: order.order_id,
        advanceToInRoute: true,
      });
      setFeedback({
        type: "ok",
        msg: `Pedido ${order.order_code} despachado en ruta.`,
        undoAction: res.undoAction,
      });
      notifyLocalSync(["orders", "inventory", "partners"]);
      await loadOrders({ silent: true });
    } catch (error) {
      reportFailure(error, "Error de conexión al enviar pedido en ruta.");
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleAdvance(orderId: number, nextStatus: NextOrderStatus) {
    if (busyOrderId !== null) return;
    setFeedback(null);
    setBusyOrderId(orderId);
    try {
      const actorUsername = resolveWarehouseActor(currentUser);
      const res = await submitOfflineCapable<{ undoAction?: UndoActionReceiptDto }>({
        kind: "WAREHOUSE_ADVANCE",
        actorUsername,
        url: "/api/orders",
        body: {
          action: "advance",
          orderId,
          nextStatus,
        },
      });
      if (res.queued) {
        onOptimisticStatusChange?.(orderId, nextStatus);
        setFeedback({
          type: "ok",
          msg: `Operación guardada sin conexión (${formatOperationalStatusEs(nextStatus)}). Se sincronizará al recuperar red.`,
        });
        return;
      }
      setFeedback({
        type: "ok",
        msg: `Pedido actualizado a ${formatOperationalStatusEs(nextStatus)}.`,
        undoAction: res.data?.undoAction,
      });
      notifyLocalSync(["orders", "inventory", "partners"]);
      await loadOrders({ silent: true });
    } catch (error) {
      reportFailure(error, "Error de conexión al actualizar el pedido.");
    } finally {
      setBusyOrderId(null);
    }
  }

  function handlePinCustomerGps(order: WarehouseOrderDto) {
    if (!order.customer_party_id || busyGeoOrderId !== null) return;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setFeedback({
        type: "err",
        msg: "Este dispositivo o navegador no soporta GPS.",
      });
      return;
    }

    setFeedback(null);
    setBusyGeoOrderId(order.order_id);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const accuracy = Number.isFinite(pos.coords.accuracy)
            ? Math.round(pos.coords.accuracy)
            : null;
          await fetchJson("/api/customers", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              partyId: order.customer_party_id,
              geoLat: Number(pos.coords.latitude.toFixed(6)),
              geoLng: Number(pos.coords.longitude.toFixed(6)),
              geoAccuracyM: accuracy,
            }),
          });
          setFeedback({
            type: "ok",
            msg:
              accuracy !== null
                ? `Ubicación GPS de ${order.customer_name} guardada (±${accuracy} m).`
                : `Ubicación GPS de ${order.customer_name} guardada.`,
          });
          notifyLocalSync(["orders", "partners"]);
          await loadOrders({ silent: true });
        } catch (error) {
          reportFailure(error, "Error de conexión al guardar ubicación GPS.");
        } finally {
          setBusyGeoOrderId(null);
        }
      },
      (err) => {
        setBusyGeoOrderId(null);
        setFeedback({
          type: "err",
          msg:
            err.code === 1
              ? "Permiso de ubicación denegado. Activa el GPS del navegador."
              : "No se pudo obtener la ubicación GPS actual; intenta nuevamente.",
        });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  }

  return {
    selectedTripByOrder,
    setSelectedTripByOrder,
    showNewTrip,
    setShowNewTrip,
    newTripZone,
    setNewTripZone,
    newTripDriver,
    setNewTripDriver,
    newTripNotes,
    setNewTripNotes,
    busyTripAction,
    busyOrderId,
    busyGeoOrderId,
    handleCreateTrip,
    handleCloseTrip,
    handleDispatchToRoute,
    handleAdvance,
    handlePinCustomerGps,
  };
}
