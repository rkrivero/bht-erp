"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { formatPen } from "@/features/partners/components/types";
import { EditIcon, PlusIcon, SearchIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLASS,
  ModalSheet,
} from "@/components/ui/Primitives";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import { formatPartySecondaryName } from "@/lib/geo";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
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
  const [detailSupplier, setDetailSupplier] = useState<SupplierDirectoryItem | null>(
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
              className={`${INPUT_CLASS} pl-9 pr-3`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filtrar estado de proveedores"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CustomerStatusFilter)}
              className={`${INPUT_CLASS} w-full sm:w-auto`}
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
        <div className="space-y-2">
          {suppliers.map((supp) => {
            const secondary = formatPartySecondaryName(
              supp.trade_name,
              supp.legal_name
            );
            const docLabel = supp.doc_number
              ? `${supp.doc_type !== "NONE" ? supp.doc_type : "Doc."} ${supp.doc_number}`
              : "Sin documento";
            const phoneLabel = supp.phone ? `Tel: ${supp.phone}` : "Sin teléfono";
            return (
              <button
                key={supp.party_id}
                type="button"
                onClick={() => setDetailSupplier(supp)}
                className="flex w-full flex-col gap-2 rounded-xl border border-bht-line bg-white p-3 text-left transition hover:border-bht-line-blue hover:bg-bht-mist/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="min-w-0 break-words text-base font-bold leading-snug text-bht-ink-strong sm:text-lg">
                      {supp.display_name}
                    </h3>
                    {secondary && secondary !== supp.display_name && (
                      <p className="mt-0.5 line-clamp-1 break-words text-xs text-bht-ink-soft">
                        {secondary}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                    {supp.city_zone && <Badge tone="horizon">{supp.city_zone}</Badge>}
                    {!supp.is_active && <Badge tone="neutral">Inactivo</Badge>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-sm">
                  <span className="text-bht-ink-soft tabular-nums">
                    {supp.open_docs_count}{" "}
                    {supp.open_docs_count === 1 ? "doc. abierto" : "docs. abiertos"}
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${
                      supp.open_ap_balance_pen > 0.05
                        ? "text-bht-danger"
                        : "text-bht-ink-strong"
                    }`}
                  >
                    {supp.open_ap_balance_pen > 0.05
                      ? `CxP abierta: ${formatPen(supp.open_ap_balance_pen)}`
                      : "Sin deuda pendiente"}
                  </span>
                </div>
                <span className="text-xs text-bht-ink-soft tabular-nums">
                  {docLabel} · {phoneLabel}
                  {supp.address ? ` · ${supp.address}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <ModalSheet
        open={detailSupplier !== null}
        onClose={() => setDetailSupplier(null)}
        title={
          detailSupplier
            ? `Ficha · ${detailSupplier.display_name}`
            : "Ficha de proveedor"
        }
        subtitle={
          detailSupplier
            ? `${
                detailSupplier.city_zone
                  ? `Zona ${detailSupplier.city_zone}`
                  : "Sin zona asignada"
              } · ${detailSupplier.is_active ? "Activo" : "Inactivo"}`
            : undefined
        }
        maxWidth="lg"
      >
        {detailSupplier &&
          (() => {
            const secondary = formatPartySecondaryName(
              detailSupplier.trade_name,
              detailSupplier.legal_name
            );
            const docLabel = detailSupplier.doc_number
              ? `${detailSupplier.doc_type !== "NONE" ? detailSupplier.doc_type : "Doc."} ${detailSupplier.doc_number}`
              : "No registrado";
            return (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-1 gap-2 rounded-xl border border-bht-line-blue bg-bht-mist/70 p-3 sm:grid-cols-3 tabular-nums">
                  <div>
                    <span className="block text-xs text-bht-ink-soft">CxP abierta</span>
                    <strong
                      className={`text-sm ${
                        detailSupplier.open_ap_balance_pen > 0.05
                          ? "text-bht-danger"
                          : "text-bht-success"
                      }`}
                    >
                      {formatPen(detailSupplier.open_ap_balance_pen)}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-xs text-bht-ink-soft">
                      Documentos pendientes
                    </span>
                    <strong className="text-sm text-bht-ink-strong">
                      {detailSupplier.open_docs_count}{" "}
                      {detailSupplier.open_docs_count === 1 ? "doc." : "docs."}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-xs text-bht-ink-soft">Estado</span>
                    <strong className="text-sm text-bht-ink-strong">
                      {detailSupplier.is_active ? "Activo" : "Inactivo"}
                    </strong>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="font-semibold text-bht-navy-deep">
                    Datos del proveedor
                  </p>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    <div className="min-w-0 rounded-lg border border-bht-line bg-bht-paper px-3 py-2">
                      <span className="block text-xs text-bht-ink-soft">Documento</span>
                      <p className="mt-0.5 break-words font-medium text-bht-ink-strong tabular-nums">
                        {docLabel}
                      </p>
                    </div>
                    <div className="min-w-0 rounded-lg border border-bht-line bg-bht-paper px-3 py-2">
                      <span className="block text-xs text-bht-ink-soft">Teléfono</span>
                      <p className="mt-0.5 break-words font-medium text-bht-ink-strong tabular-nums">
                        {detailSupplier.phone || "No registrado"}
                      </p>
                    </div>
                    {secondary && (
                      <div className="min-w-0 rounded-lg border border-bht-line bg-bht-paper px-3 py-2 sm:col-span-2">
                        <span className="block text-xs text-bht-ink-soft">
                          Razón social
                        </span>
                        <p className="mt-0.5 break-words font-medium text-bht-ink-strong">
                          {secondary}
                        </p>
                      </div>
                    )}
                    {detailSupplier.address && (
                      <div className="min-w-0 rounded-lg border border-bht-line bg-bht-paper px-3 py-2 sm:col-span-2">
                        <span className="block text-xs text-bht-ink-soft">
                          Dirección
                        </span>
                        <p className="mt-0.5 break-words font-medium text-bht-ink-strong">
                          {detailSupplier.address}
                        </p>
                      </div>
                    )}
                    {detailSupplier.notes && (
                      <div className="min-w-0 rounded-lg border border-bht-line bg-bht-paper px-3 py-2 sm:col-span-2">
                        <span className="block text-xs text-bht-ink-soft">Notas</span>
                        <p className="mt-0.5 break-words font-medium text-bht-ink-strong">
                          {detailSupplier.notes}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-bht-line pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const target = detailSupplier;
                      setDetailSupplier(null);
                      setEditingSupplier(target);
                      setModalMode("edit");
                    }}
                  >
                    <EditIcon className="h-3.5 w-3.5" />
                    Editar
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setDetailSupplier(null);
                      handleTabChange("caja");
                    }}
                  >
                    Ver CxP en Caja →
                  </Button>
                </div>
              </div>
            );
          })()}
      </ModalSheet>

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
            notifyLocalSync(["orders", "purchases", "partners"]);
            onDataChanged();
          }}
        />
      )}
    </div>
  );
}
