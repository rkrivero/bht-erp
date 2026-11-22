"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { formatPen } from "@/components/socios/types";
import { CustomerDetailContent } from "@/components/directory/CustomerDetailContent";
import {
  ControlPanel,
  type ControlPanelFacet,
} from "@/components/ui/ControlPanel";
import { PlusIcon } from "@/components/ui/Icons";
import {
  Badge,
  Card,
  INPUT_CLASS,
  ModalSheet,
} from "@/components/ui/Primitives";
import {
  ResponsiveDataTable,
  type ResponsiveTableColumn,
} from "@/components/ui/ResponsiveDataTable";
import { SkeletonTable } from "@/components/ui/Skeleton";
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

  const facets: ControlPanelFacet[] = useMemo(() => {
    const list: ControlPanelFacet[] = [];
    if (zoneFilter) {
      list.push({
        id: "zone",
        label: "Zona",
        value: zoneFilter === "__NONE__" ? "Sin zona" : zoneFilter,
        onRemove: () => setZoneFilter(""),
      });
    }
    if (geoFilter !== "ALL") {
      list.push({
        id: "geo",
        label: "GPS",
        value: geoFilter === "WITH_GEO" ? "Con GPS" : "Sin GPS",
        onRemove: () => setGeoFilter("ALL"),
      });
    }
    if (statusFilter !== "ACTIVE") {
      list.push({
        id: "status",
        label: "Estado",
        value: statusFilter === "INACTIVE" ? "Inactivos" : "Todos",
        onRemove: () => setStatusFilter("ACTIVE"),
      });
    }
    if (searchInput.trim()) {
      list.push({
        id: "q",
        label: "Búsqueda",
        value: searchInput.trim(),
        onRemove: () => setSearchInput(""),
      });
    }
    return list;
  }, [zoneFilter, geoFilter, statusFilter, searchInput]);

  const customerColumns: ResponsiveTableColumn<CustomerDirectoryItem>[] = useMemo(
    () => [
      {
        id: "name",
        header: "Cliente",
        sortable: true,
        sortValue: (c) => c.display_name,
        cell: (cust) => {
          const secondaryName = formatPartySecondaryName(
            cust.trade_name,
            cust.legal_name
          );
          return (
            <div>
              <span className="font-bold text-bht-ink-strong">
                {cust.display_name}
              </span>
              {secondaryName && secondaryName !== cust.display_name && (
                <span className="block line-clamp-1 text-xs text-bht-ink-soft">
                  {secondaryName}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "zone",
        header: "Zona / Estado",
        sortable: true,
        sortValue: (c) => c.city_zone ?? "",
        cell: (cust) => (
          <div className="flex flex-wrap items-center gap-1.5">
            {cust.city_zone ? (
              <Badge tone="horizon">{cust.city_zone}</Badge>
            ) : (
              <span className="text-xs text-bht-ink-muted">Sin zona</span>
            )}
            {!cust.is_active && <Badge tone="neutral">Inactivo</Badge>}
          </div>
        ),
      },
      {
        id: "doc",
        header: "Documento",
        optional: true,
        sortable: true,
        sortValue: (c) => c.doc_number ?? "",
        cell: (cust) => (
          <span className="text-xs text-bht-ink-soft tabular-nums">
            {cust.doc_number
              ? `${cust.doc_type !== "NONE" ? cust.doc_type : "Doc."} ${cust.doc_number}`
              : "Sin documento"}
          </span>
        ),
      },
      {
        id: "contact",
        header: "Contacto / GPS",
        optional: true,
        cell: (cust) => (
          <span className="text-xs text-bht-ink-soft tabular-nums">
            {cust.phone ? `Tel: ${cust.phone}` : "Sin tel."} ·{" "}
            {cust.geo_lat !== null && cust.geo_lng !== null ? "Con GPS" : "Sin GPS"}
          </span>
        ),
      },
      {
        id: "orders",
        header: "Pedidos",
        align: "right",
        sortable: true,
        sortValue: (c) => c.orders_count,
        cell: (cust) => (
          <div className="tabular-nums">
            <span className="font-semibold text-bht-cobalt-strong">
              {cust.orders_count}
            </span>
            {cust.last_order_date && (
              <span className="block text-xs text-bht-ink-muted">
                {cust.last_order_date}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "debt",
        header: "Saldo Abierto",
        align: "right",
        sortable: true,
        sortValue: (c) => c.open_balance_pen,
        cell: (cust) => (
          <span
            className={`font-semibold tabular-nums ${
              cust.open_balance_pen > 0.05
                ? "text-bht-danger"
                : "text-bht-ink-strong"
            }`}
          >
            {cust.open_balance_pen > 0.05
              ? formatPen(cust.open_balance_pen)
              : "Sin deuda"}
          </span>
        ),
      },
    ],
    []
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

      <ControlPanel<"list" | "map">
        title="Directorio de Clientes"
        subtitle="Filtra por zona, estado o GPS y abre la ficha de cualquier cliente."
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        viewAriaLabel="Vista de clientes"
        viewOptions={[
          { id: "list", label: "Lista", count: totalCount },
          { id: "map", label: "Mapa" },
        ]}
        primaryAction={{
          label: "Nuevo cliente",
          icon: <PlusIcon className="h-3.5 w-3.5" />,
          onClick: () => {
            setEditingCustomer(null);
            setModalMode("create");
          },
        }}
        searchValue={searchInput}
        onSearchChange={(val) => {
          setSearchInput(val);
          setLimit(100);
        }}
        searchPlaceholder="Buscar por alias, nombre, RUC/DNI, zona o teléfono..."
        searchAriaLabel="Buscar clientes en directorio"
        facets={facets}
        onClearAllFacets={() => {
          setSearchInput("");
          setZoneFilter("");
          setGeoFilter("ALL");
          setStatusFilter("ACTIVE");
        }}
        pagination={
          viewMode === "list"
            ? {
                shownCount: customers.length,
                totalCount,
                itemLabel: "cliente(s)",
                hasMore,
                onLoadMore: () => setLimit((prev) => prev + 100),
                loadMoreLabel: "Cargar más clientes",
              }
            : undefined
        }
      >
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

        {loading && customers.length === 0 ? (
          <SkeletonTable rows={6} cols={5} />
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
          <ResponsiveDataTable
            columns={customerColumns}
            data={customers}
            getRowKey={(c) => c.party_id}
            ariaLabel="Directorio de clientes"
            onRowClick={(c) => setDetailCustomer(c)}
            getRowAriaLabel={(c) => `Abrir ficha de ${c.display_name}`}
            emptyTitle="No hay clientes que coincidan con este filtro"
            emptyDescription="Prueba limpiando la búsqueda o registra un cliente nuevo."
          />
        )}
      </ControlPanel>

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
        maxWidth="6xl"
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
