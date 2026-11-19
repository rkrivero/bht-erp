"use client";

import { formatPen } from "@/components/socios/types";
import { EditIcon, MapPinIcon, NavigationIcon } from "@/components/ui/Icons";
import { Button } from "@/components/ui/Primitives";
import { buildGoogleMapsUrl, formatPartySecondaryName } from "@/lib/geo";
import type { CustomerDirectoryItem } from "@/lib/services/customers";

export function CustomerDetailContent({
  customer,
  onEdit,
  onOpenOrders,
  onOpenCollections,
}: {
  customer: CustomerDirectoryItem;
  onEdit: () => void;
  onOpenOrders: () => void;
  onOpenCollections?: () => void;
}) {
  const secondaryName = formatPartySecondaryName(
    customer.trade_name,
    customer.legal_name
  );
  const hasGeo = customer.geo_lat !== null && customer.geo_lng !== null;
  const docLabel = customer.doc_number
    ? `${customer.doc_type !== "NONE" ? customer.doc_type : "Doc."} ${customer.doc_number}${customer.is_generic_doc ? " (genérico)" : ""}`
    : "No registrado";

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-1 gap-2 rounded-xl border border-bht-line-blue bg-bht-mist/70 p-3 sm:grid-cols-3 tabular-nums">
        <div>
          <span className="block text-xs text-bht-ink-soft">Pedidos</span>
          <strong className="text-sm text-bht-ink-strong">
            {customer.orders_count} {customer.orders_count === 1 ? "pedido" : "pedidos"}
          </strong>
        </div>
        <div>
          <span className="block text-xs text-bht-ink-soft">Saldo abierto</span>
          <strong
            className={`text-sm ${
              customer.open_balance_pen > 0.05 ? "text-bht-danger" : "text-bht-success"
            }`}
          >
            {formatPen(customer.open_balance_pen)}
          </strong>
        </div>
        <div>
          <span className="block text-xs text-bht-ink-soft">Último pedido</span>
          <strong className="text-sm text-bht-ink-strong">
            {customer.last_order_date || "Sin registro"}
          </strong>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="font-semibold text-bht-navy-deep">Datos del cliente</p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <DetailRow label="Documento" value={docLabel} />
          <DetailRow label="Teléfono" value={customer.phone || "No registrado"} />
          <DetailRow label="Correo" value={customer.email || "No registrado"} />
          <DetailRow
            label="Ubicación GPS"
            value={hasGeo ? "Ubicación registrada" : "Sin ubicación"}
          />
          {secondaryName && secondaryName !== customer.display_name && (
            <DetailRow label="Razón social / nombre" value={secondaryName} fullWidth />
          )}
          {customer.address && (
            <DetailRow label="Dirección" value={customer.address} fullWidth />
          )}
          {customer.aliases.length > 0 && (
            <DetailRow label="Alias" value={customer.aliases.join(", ")} fullWidth />
          )}
          {customer.notes && (
            <DetailRow label="Referencia" value={customer.notes} fullWidth />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-bht-line pt-3">
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>
          <EditIcon className="h-3.5 w-3.5" />
          Editar
        </Button>
        {hasGeo ? (
          <a
            href={buildGoogleMapsUrl(customer.geo_lat!, customer.geo_lng!)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-bht-slate-line bg-bht-surface-cool px-3 py-1.5 text-xs font-semibold text-bht-ink-deep transition hover:bg-bht-cobalt-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt"
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
        {customer.open_balance_pen > 0.05 && onOpenCollections && (
          <Button type="button" variant="outline" size="sm" onClick={onOpenCollections}>
            Ir a Cobranza
          </Button>
        )}
        <Button type="button" variant="primary" size="sm" onClick={onOpenOrders}>
          Ver pedidos ({customer.orders_count})
        </Button>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  fullWidth = false,
}: {
  label: string;
  value: string;
  fullWidth?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-lg border border-bht-line bg-bht-paper px-3 py-2 ${
        fullWidth ? "sm:col-span-2" : ""
      }`}
    >
      <span className="block text-xs text-bht-ink-soft">{label}</span>
      <p className="mt-0.5 break-words text-sm font-semibold text-bht-ink-strong tabular-nums">
        {value}
      </p>
    </div>
  );
}
