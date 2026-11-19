"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { formatPen } from "@/components/socios/types";
import { CustomerDetailContent } from "@/components/directory/CustomerDetailContent";
import { PlusIcon, SearchIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLASS,
  ModalSheet,
  SegmentedControl,
} from "@/components/ui/Primitives";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import { formatPartySecondaryName } from "@/lib/geo";
import type {
  CustomerDirectoryItem,
  CustomerDirectoryStats,
  CustomerGeoFilter,
  CustomerStatusFilter,
  ZoneCountItem,
} from "@/lib/services/customers";
import type { PartnerTab, ShowFeedback } from "./partnerShared";

const CustomerFormModal = dynamic(
  () => import("@/components/directory/CustomerFormModal"),
  { ssr: false }
);
const LeafletCustomersMap = dynamic(
  () => import("@/components/directory/LeafletCustomersMap"),
  {
    ssr: false,
    loading: () => (
      <Card className="p-8 text-center text-xs font-medium text-bht-ink-soft">
        Cargando mapa de clientes...
      </Card>
    ),
  }
);

interface CustomersResponse {
  customers: CustomerDirectoryItem[];
  zones: ZoneCountItem[];
  stats: CustomerDirectoryStats;
  pagination: {
    limit: number;
    offset: number;
    totalCount: number;
    hasMore: boolean;
  };
}

interface Props {
  actorRole: string;
  showFeedback: ShowFeedback;
  handleTabChange: (tab: PartnerTab) => void;
  onOpenCustomerOrders: (customer: CustomerDirectoryItem) => void;
  onDataChanged: () => void;
  setSubTabEditing: (editing: boolean) => void;
}

export function DirectorioClientes({
  actorRole,
  showFeedback,
  handleTabChange,
  onOpenCustomerOrders,
  onDataChanged,
  setSubTabEditing,
}: Props) {
  const [customers, setCustomers] = useState<CustomerDirectoryItem[]>([]);
  const [zones, setZones] = useState<ZoneCountItem[]>([]);
  const [stats, setStats] = useState<CustomerDirectoryStats>({
    totalActive: 0,
    withGeo: 0,
    withoutGeo: 0,
    withDebt: 0,
  });
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(true);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");
  const [geoFilter, setGeoFilter] = useState<CustomerGeoFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<CustomerStatusFilter>("ACTIVE");
  const [viewMode, setViewMode] = useState<"list" | "map">("list");

  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<CustomerDirectoryItem | null>(
    null
  );
  const [detailCustomer, setDetailCustomer] = useState<CustomerDirectoryItem | null>(
    null
  );

  function editCustomer(customer: CustomerDirectoryItem) {
    setDetailCustomer(null);
    setEditingCustomer(customer);
    setModalMode("edit");
  }

  useEffect(() => {
    setSubTabEditing(modalMode !== null);
    return () => setSubTabEditing(false);
  }, [modalMode, setSubTabEditing]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (debouncedQuery) qs.set("q", debouncedQuery);
      if (zoneFilter) qs.set("zone", zoneFilter);
      if (geoFilter !== "ALL") qs.set("hasGeo", geoFilter);
      qs.set("status", statusFilter);
      qs.set("limit", String(viewMode === "map" ? Math.max(limit, 300) : limit));

      const res = await fetchJson<CustomersResponse>(
        `/api/customers?${qs.toString()}`,
        { cache: "no-store" }
      );
      setCustomers(res.customers);
      setZones(res.zones);
      setStats(res.stats);
      setTotalCount(res.pagination.totalCount);
      setHasMore(res.pagination.hasMore);
    } catch (err) {
      showFeedback(
        err instanceof ApiClientError
          ? err.message
          : "No se pudo cargar el directorio de clientes.",
        true
      );
    } finally {
      setLoading(false);
    }
  }, [
    debouncedQuery,
    zoneFilter,
    geoFilter,
    statusFilter,
    viewMode,
    limit,
    showFeedback,
  ]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const knownZones = useMemo(() => zones.map((z) => z.zone), [zones]);
  const unlocatedFilteredCount = useMemo(
    () => customers.filter((c) => c.geo_lat === null || c.geo_lng === null).length,
    [customers]
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card padding="sm">
          <span className="text-xs font-medium text-bht-ink-soft">
            Clientes activos
          </span>
          <p className="mt-1 text-xl font-bold text-bht-ink-strong tabular-nums">
            {stats.totalActive}
          </p>
        </Card>
        <Card padding="sm">
          <span className="text-xs font-medium text-bht-ink-soft">Con GPS fijado</span>
          <p className="mt-1 text-xl font-bold text-bht-cobalt tabular-nums">
            {stats.withGeo}
          </p>
        </Card>
        <Card padding="sm">
          <span className="text-xs font-medium text-bht-ink-soft">Sin GPS aún</span>
          <p className="mt-1 text-xl font-bold text-bht-warning tabular-nums">
            {stats.withoutGeo}
          </p>
        </Card>
        <Card padding="sm">
          <span className="text-xs font-medium text-bht-ink-soft">
            Con saldo abierto
          </span>
          <p className="mt-1 text-xl font-bold text-bht-danger tabular-nums">
            {stats.withDebt}
          </p>
        </Card>
      </div>

      <Card padding="md" className="space-y-3">
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-[minmax(280px,1fr)_auto] md:items-center">
          <div className="relative min-w-0">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-bht-ink-muted" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setLimit(100);
              }}
              placeholder="Buscar por alias, nombre, RUC/DNI, zona o teléfono..."
              aria-label="Buscar clientes en directorio"
              className={`${INPUT_CLASS} pl-9 pr-3`}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 md:flex md:items-center">
            <SegmentedControl
              value={viewMode}
              onChange={setViewMode}
              ariaLabel="Vista de clientes"
              className="w-full md:w-auto"
              options={[
                { id: "list", label: "Lista" },
                { id: "map", label: "Mapa" },
              ]}
            />
            <Button
              variant="primary"
              size="sm"
              className="w-full md:w-auto"
              onClick={() => {
                setEditingCustomer(null);
                setModalMode("create");
              }}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Nuevo cliente
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select
            aria-label="Filtrar por zona"
            value={zoneFilter}
            onChange={(e) => {
              setZoneFilter(e.target.value);
              setLimit(100);
            }}
            className={INPUT_CLASS}
          >
            <option value="">Todas las zonas ({stats.totalActive})</option>
            <option value="__NONE__">Sin zona asignada</option>
            {zones.map((z) => (
              <option key={z.zone} value={z.zone}>
                {z.zone} ({z.count})
              </option>
            ))}
          </select>

          <select
            aria-label="Filtrar por ubicación GPS"
            value={geoFilter}
            onChange={(e) => setGeoFilter(e.target.value as CustomerGeoFilter)}
            className={INPUT_CLASS}
          >
            <option value="ALL">GPS: todos</option>
            <option value="WITH_GEO">Solo con GPS</option>
            <option value="WITHOUT_GEO">Solo sin GPS</option>
          </select>

          <select
            aria-label="Filtrar por estado"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as CustomerStatusFilter)}
            className={INPUT_CLASS}
          >
            <option value="ACTIVE">Solo activos</option>
            <option value="INACTIVE">Solo inactivos</option>
            <option value="ALL">Activos e inactivos</option>
          </select>
        </div>
      </Card>

      {loading && customers.length === 0 ? (
        <Card className="p-8 text-center text-sm text-bht-ink-soft">
          Cargando clientes…
        </Card>
      ) : customers.length === 0 ? (
        <EmptyState
          title="No hay clientes que coincidan con este filtro"
          description="Prueba limpiando la búsqueda o registra un cliente nuevo."
        />
      ) : viewMode === "map" ? (
        <div className="space-y-3">
          {unlocatedFilteredCount > 0 && (
            <Card
              padding="sm"
              className="border-bht-warning-line bg-bht-warning-bg text-xs text-bht-warning-strong"
            >
              Hay <strong className="tabular-nums">{unlocatedFilteredCount}</strong>{" "}
              cliente(s) en este filtro que todavía no tienen pin GPS guardado.
            </Card>
          )}
          <LeafletCustomersMap
            customers={customers}
            onEditCustomer={(cust) => {
              setEditingCustomer(cust);
              setModalMode("edit");
            }}
          />
        </div>
      ) : (
        <div className="space-y-2.5">
          <p className="text-xs text-bht-ink-soft">
            Mostrando <strong className="tabular-nums">{customers.length}</strong> de{" "}
            <strong className="tabular-nums">{totalCount}</strong> cliente(s).
          </p>

          <div className="space-y-2">
            {customers.map((cust) => {
              const secondaryName = formatPartySecondaryName(
                cust.trade_name,
                cust.legal_name
              );
              const docLabel = cust.doc_number
                ? `${cust.doc_type !== "NONE" ? cust.doc_type : "Doc."} ${cust.doc_number}`
                : "Sin documento";
              const phoneLabel = cust.phone ? `Tel: ${cust.phone}` : "Sin teléfono";
              const gpsLabel =
                cust.geo_lat !== null && cust.geo_lng !== null ? "Con GPS" : "Sin GPS";
              return (
                <button
                  key={cust.party_id}
                  type="button"
                  onClick={() => setDetailCustomer(cust)}
                  className="flex w-full flex-col gap-2 rounded-xl border border-bht-line bg-white p-3 text-left transition hover:border-bht-line-blue hover:bg-bht-mist/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="min-w-0 break-words text-base font-bold leading-snug text-bht-ink-strong sm:text-lg">
                        {cust.display_name}
                      </h3>
                      {secondaryName && secondaryName !== cust.display_name && (
                        <p className="mt-0.5 line-clamp-1 break-words text-xs text-bht-ink-soft">
                          {secondaryName}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                      {cust.city_zone && <Badge tone="horizon">{cust.city_zone}</Badge>}
                      {!cust.is_active && <Badge tone="neutral">Inactivo</Badge>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold text-bht-cobalt-strong tabular-nums">
                        {cust.orders_count}{" "}
                        {cust.orders_count === 1 ? "pedido" : "pedidos"}
                      </span>
                      {cust.last_order_date && (
                        <span className="text-bht-ink-soft tabular-nums">
                          Último: {cust.last_order_date}
                        </span>
                      )}
                    </div>
                    <span
                      className={`font-semibold tabular-nums ${
                        cust.open_balance_pen > 0.05
                          ? "text-bht-danger"
                          : "text-bht-ink-strong"
                      }`}
                    >
                      {cust.open_balance_pen > 0.05
                        ? `Saldo: ${formatPen(cust.open_balance_pen)}`
                        : "Sin deuda"}
                    </span>
                  </div>
                  <span className="text-xs text-bht-ink-soft tabular-nums">
                    {docLabel} · {phoneLabel} · {gpsLabel}
                  </span>
                </button>
              );
            })}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => setLimit((prev) => prev + 100)}
              >
                Cargar más clientes
              </Button>
            </div>
          )}
        </div>
      )}

      <ModalSheet
        open={detailCustomer !== null}
        onClose={() => setDetailCustomer(null)}
        title={
          detailCustomer ? `Ficha · ${detailCustomer.display_name}` : "Ficha de cliente"
        }
        subtitle={
          detailCustomer
            ? `${
                detailCustomer.city_zone
                  ? `Zona ${detailCustomer.city_zone}`
                  : "Sin zona asignada"
              } · ${detailCustomer.is_active ? "Activo" : "Inactivo"}`
            : undefined
        }
        maxWidth="lg"
      >
        {detailCustomer && (
          <CustomerDetailContent
            customer={detailCustomer}
            onEdit={() => editCustomer(detailCustomer)}
            onOpenOrders={() => {
              const target = detailCustomer;
              setDetailCustomer(null);
              onOpenCustomerOrders(target);
            }}
            onOpenCollections={() => {
              setDetailCustomer(null);
              handleTabChange("deudores");
            }}
          />
        )}
      </ModalSheet>

      {modalMode !== null && (
        <CustomerFormModal
          open
          mode={modalMode}
          initialCustomer={modalMode === "edit" ? editingCustomer : null}
          knownZones={knownZones}
          actorRole={actorRole}
          onClose={() => setModalMode(null)}
          onSaved={(saved) => {
            showFeedback(
              modalMode === "create"
                ? `Cliente "${saved.display_name}" agregado al directorio.`
                : `Cliente "${saved.display_name}" actualizado.`
            );
            void loadCustomers();
            onDataChanged();
          }}
        />
      )}
    </div>
  );
}
