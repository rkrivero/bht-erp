"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { formatPen } from "@/components/socios/types";
import { EditIcon, PhoneIcon, PlusIcon, SearchIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLASS,
} from "@/components/ui/Primitives";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import { formatPartySecondaryName } from "@/lib/geo";
import type {
  CustomerStatusFilter,
  SupplierDirectoryItem,
} from "@/lib/services/customers";
import type { PartnerTab, ShowFeedback } from "./partnerShared";

const SupplierFormModal = dynamic(
  () => import("@/components/directory/SupplierFormModal"),
  { ssr: false }
);

interface Props {
  showFeedback: ShowFeedback;
  handleTabChange: (tab: PartnerTab) => void;
  onDataChanged: () => void;
  setSubTabEditing: (editing: boolean) => void;
}

export function DirectorioProveedores({
  showFeedback,
  handleTabChange,
  onDataChanged,
  setSubTabEditing,
}: Props) {
  const [suppliers, setSuppliers] = useState<SupplierDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<CustomerStatusFilter>("ACTIVE");
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<SupplierDirectoryItem | null>(
    null
  );

  useEffect(() => {
    setSubTabEditing(modalMode !== null);
    return () => setSubTabEditing(false);
  }, [modalMode, setSubTabEditing]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadSuppliers = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (debouncedQuery) qs.set("q", debouncedQuery);
      qs.set("status", statusFilter);
      const res = await fetchJson<{ suppliers: SupplierDirectoryItem[] }>(
        `/api/suppliers?${qs.toString()}`,
        { cache: "no-store" }
      );
      setSuppliers(res.suppliers);
    } catch (err) {
      showFeedback(
        err instanceof ApiClientError
          ? err.message
          : "No se pudo cargar el directorio de proveedores.",
        true
      );
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, statusFilter, showFeedback]);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  return (
    <div className="space-y-4">
      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="relative min-w-[220px] flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-bht-ink-muted" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar proveedor por razón social, alias, RUC o ciudad..."
              aria-label="Buscar proveedores en directorio"
              className={`${INPUT_CLASS} py-2 pl-9 pr-3 text-xs`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filtrar estado de proveedores"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CustomerStatusFilter)}
              className={`${INPUT_CLASS} w-auto py-2 text-xs`}
            >
              <option value="ACTIVE">Solo activos</option>
              <option value="INACTIVE">Solo inactivos</option>
              <option value="ALL">Todos</option>
            </select>

            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingSupplier(null);
                setModalMode("create");
              }}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Nuevo proveedor
            </Button>
          </div>
        </div>
      </Card>

      {loading && suppliers.length === 0 ? (
        <Card className="p-8 text-center text-sm text-bht-ink-soft">
          Cargando proveedores…
        </Card>
      ) : suppliers.length === 0 ? (
        <EmptyState
          title="No hay proveedores que coincidan con este filtro"
          description="Prueba limpiando el buscador o agrega un proveedor nuevo."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {suppliers.map((supp) => {
            const secondary = formatPartySecondaryName(
              supp.trade_name,
              supp.legal_name
            );
            return (
              <Card key={supp.party_id} padding="md" className="space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="truncate text-sm font-bold text-bht-ink-strong sm:text-base">
                        {supp.display_name}
                      </h3>
                      {supp.city_zone && <Badge tone="horizon">{supp.city_zone}</Badge>}
                      {!supp.is_active && <Badge tone="neutral">Inactivo</Badge>}
                    </div>
                    {secondary && (
                      <p className="truncate text-xs text-bht-ink-soft">
                        Razón social: {secondary}
                      </p>
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    compact
                    onClick={() => {
                      setEditingSupplier(supp);
                      setModalMode("edit");
                    }}
                  >
                    <EditIcon className="h-3.5 w-3.5" />
                    Editar
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-bht-ink-warm">
                  {supp.doc_number && (
                    <span className="tabular-nums">
                      {supp.doc_type !== "NONE" ? `${supp.doc_type}: ` : "Doc: "}
                      {supp.doc_number}
                    </span>
                  )}
                  {supp.phone && (
                    <a
                      href={`tel:${supp.phone}`}
                      className="inline-flex items-center gap-1 font-medium text-bht-cobalt hover:underline"
                    >
                      <PhoneIcon className="h-3 w-3" />
                      {supp.phone}
                    </a>
                  )}
                  {supp.address && <span className="truncate">{supp.address}</span>}
                </div>

                {supp.notes && (
                  <p className="text-[11px] text-bht-ink-soft">Notas: {supp.notes}</p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-bht-line pt-2 text-xs">
                  {supp.open_ap_balance_pen > 0.05 ? (
                    <span className="font-semibold text-bht-danger tabular-nums">
                      CxP abierta: {formatPen(supp.open_ap_balance_pen)} (
                      {supp.open_docs_count} doc.)
                    </span>
                  ) : (
                    <span className="text-bht-ink-muted">Sin deuda pendiente</span>
                  )}

                  <button
                    type="button"
                    data-compact="true"
                    onClick={() => handleTabChange("caja")}
                    className="font-semibold text-bht-cobalt hover:underline cursor-pointer"
                  >
                    Ver CxP en Caja →
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {modalMode !== null && (
        <SupplierFormModal
          open
          mode={modalMode}
          initialSupplier={modalMode === "edit" ? editingSupplier : null}
          onClose={() => setModalMode(null)}
          onSaved={(saved) => {
            showFeedback(
              modalMode === "create"
                ? `Proveedor "${saved.display_name}" agregado.`
                : `Proveedor "${saved.display_name}" actualizado.`
            );
            void loadSuppliers();
            onDataChanged();
          }}
        />
      )}
    </div>
  );
}
