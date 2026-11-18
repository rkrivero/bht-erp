import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import type {
  WarehouseOrderDto,
  WarehouseTripDto,
  WarehouseTripMutationResponseDto,
} from "@/lib/contracts";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import type { NextOrderStatus, WarehouseFeedback } from "./types";
import { isAuthStatus } from "./useWarehouseData";

interface Options {
  openTrips: WarehouseTripDto[];
  loadOrders: (opts?: { silent?: boolean }) => Promise<void>;
  setFeedback: (feedback: WarehouseFeedback | null) => void;
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function useWarehouseActions({ openTrips, loadOrders, setFeedback }: Options) {
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
      msg: error instanceof ApiClientError ? error.message : fallbackNetwork,
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
      await postJson("/api/trips", {
        action: "close_trip",
        tripId,
        nextStatus: "CLOSED",
      });
      setFeedback({ type: "ok", msg: "Ruta cerrada correctamente." });
      notifyLocalSync(["orders", "partners"]);
      await loadOrders({ silent: true });
    } catch (error) {
      reportFailure(error, "Error de conexión al cerrar ruta.");
    } finally {
      setBusyTripAction(false);
    }
  }

  async function handleDispatchToRoute(order: WarehouseOrderDto) {
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
      await postJson("/api/trips", {
        action: "assign_order",
        tripId: Number(chosenTripId),
        orderId: order.order_id,
        advanceToInRoute: true,
      });
      setFeedback({
        type: "ok",
        msg: `Pedido ${order.order_code} despachado en ruta.`,
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
    if (busyOrderId === orderId) return;
    setFeedback(null);
    setBusyOrderId(orderId);
    try {
      await postJson("/api/orders", { action: "advance", orderId, nextStatus });
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
