"use client";

import { Button, ModalSheet } from "@/components/ui/Primitives";
import type { WarehouseOrderDto, WarehouseTripDto } from "@/lib/contracts";
import type { CheckedLines } from "./types";

interface CloseTripModalProps {
  trip: WarehouseTripDto | null;
  busyTripAction: boolean;
  onDismiss: () => void;
  onConfirm: (tripId: number) => Promise<void>;
}

export function CloseTripModal({
  trip,
  busyTripAction,
  onDismiss,
  onConfirm,
}: CloseTripModalProps) {
  return (
    <ModalSheet
      open={Boolean(trip)}
      onClose={() => {
        if (!busyTripAction) onDismiss();
      }}
      title="Cerrar ruta de reparto"
      subtitle={trip?.trip_code}
    >
      {trip && (
        <div className="space-y-4 text-xs text-bht-ink-soft sm:text-sm">
          <p>
            Confirma que la salida de {trip.zone_name || "reparto"} terminó. La ruta
            dejará de estar disponible para asignar pedidos.
          </p>
          {trip.in_route_count > 0 && (
            <p className="rounded-xl border border-bht-amber-line bg-bht-amber-bg px-3 py-2.5 text-xs text-bht-warning-strong">
              Aún figuran {trip.in_route_count} pedido(s) en ruta. Revisa sus entregas
              antes de cerrar.
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={busyTripAction}
              onClick={onDismiss}
            >
              Volver
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={busyTripAction || trip.in_route_count > 0}
              onClick={async () => {
                await onConfirm(trip.trip_id);
                onDismiss();
              }}
            >
              {busyTripAction ? "Cerrando..." : "Confirmar cierre de ruta"}
            </Button>
          </div>
        </div>
      )}
    </ModalSheet>
  );
}

interface DeliverOrderModalProps {
  order: WarehouseOrderDto | null;
  checkedLines: CheckedLines;
  busyOrderId: number | null;
  onDismiss: () => void;
  onConfirm: (orderId: number) => Promise<void>;
}

export function DeliverOrderModal({
  order,
  checkedLines,
  busyOrderId,
  onDismiss,
  onConfirm,
}: DeliverOrderModalProps) {
  const totalLines = order?.lines.length ?? 0;
  const checkedInOrder =
    order?.lines.filter((ln) => Boolean(checkedLines[ln.order_line_id])).length ?? 0;
  const isDeliverBusy = order !== null && busyOrderId === order.order_id;
  return (
    <ModalSheet
      open={Boolean(order)}
      onClose={() => {
        if (busyOrderId === null) onDismiss();
      }}
      title={order ? `Confirmar entrega · ${order.order_code}` : "Confirmar entrega"}
      subtitle={order?.customer_name}
    >
      {order && (
        <div className="space-y-4 text-xs sm:text-sm text-bht-ink-soft">
          <p>
            ¿Confirmas que todos los productos de{" "}
            <strong className="text-bht-ink-strong">{order.order_code}</strong> (
            {totalLines} ítem(s)) fueron entregados al cliente?
          </p>
          {checkedInOrder < totalLines && (
            <p className="rounded-xl border border-bht-amber-line bg-bht-amber-bg px-3 py-2.5 text-xs text-bht-warning-strong">
              Llevas marcados {checkedInOrder} de {totalLines} ítems en la lista de
              verificación.
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={isDeliverBusy}
              onClick={onDismiss}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="success"
              disabled={isDeliverBusy}
              onClick={async () => {
                await onConfirm(order.order_id);
                onDismiss();
              }}
            >
              {isDeliverBusy ? "Confirmando..." : "Sí, marcar entregado"}
            </Button>
          </div>
        </div>
      )}
    </ModalSheet>
  );
}
