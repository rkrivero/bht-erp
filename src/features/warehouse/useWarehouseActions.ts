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
    handleCreateTrip,
    handleCloseTrip,
    handleDispatchToRoute,
    handleAdvance,
  };
}
