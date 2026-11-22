"use client";

import { formatDatePe, formatPen } from "@/components/socios/types";
import { FormSheet } from "@/components/ui/FormSheet";
import {
  EditIcon,
  MapPinIcon,
  NavigationIcon,
  ShoppingBagIcon,
  WalletIcon,
} from "@/components/ui/Icons";
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
    <FormSheet
      documentCode={docLabel}
      title={customer.display_name}
      subtitle={
        secondaryName && secondaryName !== customer.display_name
          ? secondaryName
          : customer.city_zone
            ? `Zona ${customer.city_zone}`
            : "Sin zona asignada"
      }
      stages={[
        { id: "ACTIVE", label: "Activo", tone: "success" },
        { id: "INACTIVE", label: "Inactivo", tone: "neutral" },
      ]}
      currentStageId={customer.is_active ? "ACTIVE" : "INACTIVE"}
      actions={
        <>
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
        </>
      }
      smartButtons={[
        {
          id: "orders",
          label: "Pedidos Históricos",
          value: `${customer.orders_count}`,
          icon: <ShoppingBagIcon className="h-4 w-4" />,
          onClick: onOpenOrders,
        },
        {
          id: "balance",
          label: "Saldo Abierto",
          value: formatPen(customer.open_balance_pen),
          icon: <WalletIcon className="h-4 w-4" />,
          tone: customer.open_balance_pen > 0.05 ? "danger" : "success",
          onClick:
            customer.open_balance_pen > 0.05 ? onOpenCollections : undefined,
        },
        {
          id: "credit-limit",
          label: "Límite de Crédito",
          value:
            customer.credit_limit_pen !== null &&
            customer.credit_limit_pen !== undefined
              ? formatPen(customer.credit_limit_pen)
              : "Sin límite",
        },
      ]}
      tabs={[
        {
          id: "general",
          label: "Datos del cliente",
          content: (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <DetailRow label="Documento" value={docLabel} />
              <DetailRow
                label="Teléfono"
                value={customer.phone || "No registrado"}
              />
              <DetailRow label="Correo" value={customer.email || "No registrado"} />
              <DetailRow
                label="Zona / Ruta"
                value={customer.city_zone || "Sin zona asignada"}
              />
              <DetailRow
                label="Último pedido"
                value={customer.last_order_date || "Sin registro"}
              />
              <DetailRow
                label="Último contacto"
                value={
                  customer.last_contact_date
                    ? formatDatePe(customer.last_contact_date)
                    : "Sin registro"
                }
              />
              {secondaryName && secondaryName !== customer.display_name && (
                <DetailRow
                  label="Razón social / nombre"
                  value={secondaryName}
                  fullWidth
                />
              )}
              {customer.address && (
                <DetailRow label="Dirección" value={customer.address} fullWidth />
              )}
              {customer.aliases.length > 0 && (
                <DetailRow
                  label="Alias comerciales"
                  value={customer.aliases.join(", ")}
                  fullWidth
                />
              )}
              {customer.notes && (
                <DetailRow label="Referencia" value={customer.notes} fullWidth />
              )}
            </div>
          ),
        },
        {
          id: "credit-geo",
          label: "Crédito y Ubicación GPS",
          content: (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <DetailRow
                label="Plazo de crédito pactado"
                value={
                  customer.credit_days_agreed !== null &&
                  customer.credit_days_agreed !== undefined
                    ? `${customer.credit_days_agreed} días`
                    : "Sin plazo pactado"
                }
              />
              <DetailRow
                label="Límite de crédito autorizado"
                value={
                  customer.credit_limit_pen !== null &&
                  customer.credit_limit_pen !== undefined
                    ? formatPen(customer.credit_limit_pen)
                    : "Sin límite definido"
                }
              />
              <DetailRow
                label="Estado de Ubicación GPS"
                value={
                  hasGeo
                    ? `${customer.geo_lat?.toFixed(5)}, ${customer.geo_lng?.toFixed(5)}`
                    : "Sin ubicación registrada"
                }
                fullWidth
              />
            </div>
          ),
        },
      ]}
    />
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
