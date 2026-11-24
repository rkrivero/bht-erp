"use client";

import type { FormEvent } from "react";
import { Badge, Button, Card, INPUT_CLASS } from "@/components/ui/Primitives";
import type { WarehouseTripDto } from "@/lib/contracts";

interface WarehouseRoutePanelProps {
  openTrips: WarehouseTripDto[];
  showNewTrip: boolean;
  onToggleNewTrip: () => void;
  onCreateTrip: (e: FormEvent) => void;
  newTripZone: string;
  onZoneChange: (value: string) => void;
  newTripDriver: string;
  onDriverChange: (value: string) => void;
  newTripNotes: string;
  onNotesChange: (value: string) => void;
  busyTripAction: boolean;
  onRequestCloseTrip: (trip: WarehouseTripDto) => void;
}

export function WarehouseRoutePanel({
  openTrips,
  showNewTrip,
  onToggleNewTrip,
  onCreateTrip,
  newTripZone,
  onZoneChange,
  newTripDriver,
  onDriverChange,
  newTripNotes,
  onNotesChange,
  busyTripAction,
  onRequestCloseTrip,
}: WarehouseRoutePanelProps) {
  return (
    <Card id="route-control" padding="sm" className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-xs font-semibold text-bht-ink-strong">
            Rutas de Reparto ({openTrips.length} activa
            {openTrips.length === 1 ? "" : "s"})
          </span>
          <p className="text-xs text-bht-ink-soft">
            Asigna pedidos listos a una salida en ruta antes de entregar.
          </p>
        </div>
        <Button
          type="button"
          variant={showNewTrip ? "ghost" : "outline"}
          size="sm"
          onClick={onToggleNewTrip}
        >
          {showNewTrip ? "Cancelar" : "+ Abrir Ruta"}
        </Button>
      </div>

      {showNewTrip && (
        <form
          onSubmit={onCreateTrip}
          className="grid grid-cols-1 gap-2 rounded-xl border border-bht-line bg-bht-paper p-3 sm:grid-cols-4"
        >
          <input
            type="text"
            value={newTripZone}
            onChange={(e) => onZoneChange(e.target.value)}
            aria-label="Zona de ruta"
            placeholder="Zona (ej. RUTA NORTE)"
            className={`${INPUT_CLASS} py-1.5 text-xs`}
          />
          <input
            type="text"
            value={newTripDriver}
            onChange={(e) => onDriverChange(e.target.value)}
            aria-label="Repartidor"
            placeholder="Repartidor (opcional)"
            className={`${INPUT_CLASS} py-1.5 text-xs`}
          />
          <input
            type="text"
            value={newTripNotes}
            onChange={(e) => onNotesChange(e.target.value)}
            aria-label="Notas de ruta"
            placeholder="Placa / notas (opcional)"
            className={`${INPUT_CLASS} py-1.5 text-xs`}
          />
          <Button type="submit" variant="primary" size="sm" disabled={busyTripAction}>
            {busyTripAction ? "Abriendo..." : "Confirmar Ruta"}
          </Button>
        </form>
      )}

      {openTrips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {openTrips.map((trip) => (
            <div
              key={trip.trip_id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-bht-line-blue bg-bht-mist px-3 py-1.5 text-xs"
            >
              <span className="font-semibold text-bht-navy-deep tabular-nums">
                {trip.trip_code}
              </span>
              <span className="text-bht-ink-soft">
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
                onClick={() => onRequestCloseTrip(trip)}
              >
                Cerrar Ruta
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
