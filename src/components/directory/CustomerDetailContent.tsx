"use client";

import { formatPen } from "@/components/socios/types";
import {
  ChevronRightIcon,
  EditIcon,
  MapPinIcon,
  NavigationIcon,
} from "@/components/ui/Icons";
import { Badge, Button } from "@/components/ui/Primitives";
import { buildGoogleMapsUrl, formatPartySecondaryName } from "@/lib/geo";
import type { CustomerDirectoryItem } from "@/lib/services/customers";

export function CustomerDetailContent({
  customer,
  onEdit,
  onOpenOrders,
}: {
  customer: CustomerDirectoryItem;
  onEdit: () => void;
  onOpenOrders: () => void;
}) {
  const secondaryName = formatPartySecondaryName(
    customer.trade_name,
    customer.legal_name
  );
  const hasGeo = customer.geo_lat !== null && customer.geo_lng !== null;

  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="break-words text-base font-bold leading-snug text-bht-ink-strong sm:text-lg">
            {customer.display_name}
          </h3>
          {customer.city_zone && <Badge tone="horizon">{customer.city_zone}</Badge>}
          {!customer.is_active && <Badge tone="neutral">Inactivo</Badge>}
        </div>
        {secondaryName && secondaryName !== customer.display_name && (
          <p className="mt-1 break-words text-sm text-bht-ink-soft">
            Nombre / Razón social: {secondaryName}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onOpenOrders}
        className="flex w-full items-center justify-between gap-3 rounded-xl bg-bht-navy-deep px-4 py-3 text-left text-white transition hover:bg-bht-ink-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt focus-visible:ring-offset-2 cursor-pointer"
      >
        <span>
          <span className="block text-xs font-medium text-white/80">
            Historial comercial
          </span>
          <span className="mt-0.5 block text-lg font-bold tabular-nums">
            {customer.orders_count} {customer.orders_count === 1 ? "pedido" : "pedidos"}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-semibold">
          Ver pedidos
          <ChevronRightIcon className="h-3.5 w-3.5" />
        </span>
      </button>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <DetailItem
          label="Saldo abierto"
          value={formatPen(customer.open_balance_pen)}
        />
        <DetailItem
          label="Último pedido"
          value={customer.last_order_date || "Sin registro"}
        />
        <DetailItem
          label="Documento"
          value={
            customer.doc_number
              ? `${customer.doc_type !== "NONE" ? customer.doc_type : "Doc."} ${customer.doc_number}${customer.is_generic_doc ? " (genérico)" : ""}`
              : "No registrado"
          }
        />
        <DetailItem label="Teléfono" value={customer.phone || "No registrado"} />
        <DetailItem label="Correo" value={customer.email || "No registrado"} />
        <DetailItem
          label="GPS"
          value={hasGeo ? "Ubicación registrada" : "Sin ubicación"}
        />
      </dl>

      {(customer.address || customer.aliases.length > 0 || customer.notes) && (
        <div className="space-y-2 border-t border-bht-line pt-3 text-sm">
          {customer.address && (
            <p className="break-words text-bht-ink-warm">
              <strong className="text-bht-ink-strong">Dirección:</strong>{" "}
              {customer.address}
            </p>
          )}
          {customer.aliases.length > 0 && (
            <p className="break-words text-bht-ink-warm">
              <strong className="text-bht-ink-strong">Alias:</strong>{" "}
              {customer.aliases.join(", ")}
            </p>
          )}
          {customer.notes && (
            <p className="break-words text-bht-ink-warm">
              <strong className="text-bht-ink-strong">Referencia:</strong>{" "}
              {customer.notes}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 border-t border-bht-line pt-3">
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>
          <EditIcon className="h-3.5 w-3.5" />
          Editar
        </Button>
        {hasGeo ? (
          <a
            href={buildGoogleMapsUrl(customer.geo_lat!, customer.geo_lng!)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-bht-surface-cool px-3 py-1.5 text-xs font-semibold text-bht-ink-deep transition hover:bg-bht-cobalt-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt"
          >
            <NavigationIcon className="h-3.5 w-3.5" />
            Abrir mapa
          </a>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
            <MapPinIcon className="h-3.5 w-3.5" />
            Agregar GPS
          </Button>
        )}
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-bht-ink-soft">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold text-bht-ink-strong tabular-nums">
        {value}
      </dd>
    </div>
  );
}
