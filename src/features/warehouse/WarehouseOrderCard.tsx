"use client";

import {
  CheckIcon,
  MapPinIcon,
  NavigationIcon,
  PackageIcon,
  PhoneIcon,
} from "@/components/ui/Icons";
import { Badge, Button, Card, INPUT_CLASS } from "@/components/ui/Primitives";
import type { WarehouseOrderDto, WarehouseTripDto } from "@/lib/contracts";
import { buildGoogleMapsUrl } from "@/lib/geo";
import type { CheckedLines, NextOrderStatus } from "./types";
import { toWarehouseStage } from "./warehouse-utils";

interface WarehouseOrderCardProps {
  order: WarehouseOrderDto;
  checkedLines: CheckedLines;
  isBusy: boolean;
  isPinningGeo: boolean;
  openTrips: WarehouseTripDto[];
  selectedTripId: string | undefined;
  onSelectTrip: (orderId: number, tripId: string) => void;
  onToggleLine: (orderLineId: number) => void;
  onAdvance: (orderId: number, nextStatus: NextOrderStatus) => void;
  onDispatch: (order: WarehouseOrderDto) => void;
  onRequestDeliver: (order: WarehouseOrderDto) => void;
  onPinCustomerGps: (order: WarehouseOrderDto) => void;
  onOpenNewTrip: () => void;
}

export function WarehouseOrderCard({
  order,
  checkedLines,
  isBusy,
  isPinningGeo,
  openTrips,
  selectedTripId,
  onSelectTrip,
  onToggleLine,
  onAdvance,
  onDispatch,
  onRequestDeliver,
  onPinCustomerGps,
  onOpenNewTrip,
}: WarehouseOrderCardProps) {
  const checkedCount = order.lines.filter((l) => checkedLines[l.order_line_id]).length;
  const stage = toWarehouseStage(order.operational_status);
  const isActiveQueue = stage !== "DELIVERED";
  const remainingLines = Math.max(0, order.lines.length - checkedCount);

  return (
    <Card
      accent={isActiveQueue ? "horizon" : "none"}
      padding="md"
      className="space-y-3"
    >
      <div className="flex items-start justify-between gap-3 border-b border-bht-line pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-bht-navy-mid tabular-nums">
              {order.order_code}
            </span>
            <span className="text-xs text-bht-ink-muted tabular-nums">
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
          <h2 className="mt-0.5 text-base font-semibold text-bht-ink-strong">
            {order.customer_name}
          </h2>
          {(order.customer_zone ||
            order.customer_address ||
            order.customer_phone ||
            order.customer_party_id) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-bht-ink-soft">
              {order.customer_zone && (
                <Badge tone="horizon">{order.customer_zone}</Badge>
              )}
              {order.customer_address && (
                <span className="truncate max-w-full text-bht-ink-warm">
                  {order.customer_address}
                </span>
              )}
              {order.customer_phone && (
                <a
                  href={`tel:${order.customer_phone}`}
                  className="inline-flex items-center gap-1 font-medium text-bht-cobalt hover:underline"
                >
                  <PhoneIcon className="h-3 w-3" />
                  {order.customer_phone}
                </a>
              )}
              {order.customer_geo_lat != null && order.customer_geo_lng != null && (
                <a
                  href={buildGoogleMapsUrl(
                    order.customer_geo_lat,
                    order.customer_geo_lng
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-bht-slate-line bg-bht-surface-cool px-2 py-0.5 text-xs font-semibold text-bht-cobalt hover:bg-bht-cobalt-bg"
                >
                  <NavigationIcon className="h-3 w-3" />
                  Abrir en Maps
                </a>
              )}
              {order.customer_party_id != null && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  compact
                  disabled={isPinningGeo}
                  onClick={() => onPinCustomerGps(order)}
                >
                  <MapPinIcon className="h-3 w-3" />
                  {isPinningGeo
                    ? "Ubicando..."
                    : order.customer_geo_lat != null
                      ? "Actualizar GPS"
                      : "Fijar GPS aquí"}
                </Button>
              )}
            </div>
          )}
          {order.notes && (
            <p className="mt-1.5 rounded-lg border border-bht-amber-line bg-bht-amber-bg px-2.5 py-1.5 text-xs font-medium text-bht-warning-strong">
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
        className="divide-y divide-bht-line"
      >
        {order.lines.map((line) => {
          const isDelivered = stage === "DELIVERED";
          const checked = isDelivered || Boolean(checkedLines[line.order_line_id]);
          const lineBody = (
            <>
              <div className="flex min-w-0 items-start gap-3">
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border transition ${
                    isDelivered
                      ? "border-bht-success/30 bg-bht-tone-eef9f1 text-bht-success"
                      : checked
                        ? "border-bht-navy-deep bg-bht-navy-deep text-white"
                        : "border-bht-line-stronger bg-white"
                  }`}
                >
                  {checked && <CheckIcon className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0">
                  <p
                    className={`text-sm font-medium ${
                      !isDelivered && checked
                        ? "line-through text-bht-ink-muted"
                        : "text-bht-ink-strong"
                    }`}
                  >
                    {line.raw_description}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-bht-ink-soft">
                      {line.sku}
                    </span>
                    {line.needs_supplier_pickup && (
                      <Badge tone="warning" className="whitespace-normal text-left">
                        Recoger de proveedor (bajo pedido)
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div
                className={`flex-shrink-0 rounded-xl px-3 py-1.5 text-sm font-semibold tabular-nums ${
                  isDelivered
                    ? "bg-bht-paper-alt text-bht-ink-warm"
                    : checked
                      ? "bg-bht-paper-alt text-bht-ink-muted"
                      : "bg-bht-navy-deep text-white"
                }`}
              >
                × {line.quantity}
                {line.unit_of_measure ? (
                  <span
                    className={`ml-1.5 text-xs font-medium uppercase ${
                      isDelivered || checked ? "text-bht-ink-muted" : "text-white/80"
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
                  onClick={() => onToggleLine(line.order_line_id)}
                  aria-pressed={checked}
                  aria-label={`${
                    checked ? "Desmarcar" : "Marcar"
                  } ${line.raw_description}, código ${
                    line.sku
                  }, cantidad ${line.quantity}${
                    line.unit_of_measure ? ` ${line.unit_of_measure}` : ""
                  }`}
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg px-1.5 py-3 text-left transition hover:bg-bht-mist/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep/45 cursor-pointer"
                >
                  {lineBody}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-bht-line-blue/70 bg-bht-mist/75 px-3 py-2 text-xs text-bht-navy-mid">
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
        {order.picked_by_name && <span>· Preparó: {order.picked_by_name}</span>}
        {order.delivered_by_name && <span>· Entregó: {order.delivered_by_name}</span>}
      </div>

      {stage === "PREPARING" && (
        <Button
          variant="primary"
          size="lg"
          disabled={isBusy || remainingLines > 0}
          onClick={() => onAdvance(order.order_id, "READY")}
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
                  selectedTripId &&
                  openTrips.some((t) => String(t.trip_id) === selectedTripId)
                    ? selectedTripId
                    : String(openTrips[0].trip_id)
                }
                onChange={(e) => onSelectTrip(order.order_id, e.target.value)}
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
                onClick={() => onDispatch(order)}
                className="w-full sm:w-auto sm:flex-1"
              >
                {isBusy ? "Enviando..." : "Asignar y enviar en ruta"}
              </Button>
            </div>
          ) : (
            <Button
              variant="primary"
              size="lg"
              onClick={onOpenNewTrip}
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
          onClick={() => onRequestDeliver(order)}
          aria-label={`Confirmar entrega del pedido ${order.order_code}`}
          className="w-full"
        >
          <CheckIcon className="h-4 w-4" />
          {isBusy ? "Actualizando..." : "Marcar Entregado"}
        </Button>
      )}
    </Card>
  );
}
