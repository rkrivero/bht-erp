"use client";

import dynamic from "next/dynamic";
import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  QueryClient,
  QueryClientContext,
  useQuery,
} from "@tanstack/react-query";
import { ControlPanel, type ControlPanelFacet } from "@/components/ui/ControlPanel";
import { ChevronRightIcon, CloseIcon } from "@/components/ui/Icons";
import { Badge, Button, Card, INPUT_CLASS } from "@/components/ui/Primitives";
import { SkeletonCards } from "@/components/ui/Skeleton";
import type { UndoActionReceiptDto } from "@/lib/contracts";
import { formatDatePe, formatMonthLabel, type DataCutSummary } from "../types";
import {
  type ReportAuditoriaDto,
  type ReportCajaCxpDto,
  type ReportCarteraDto,
  type ReportComercialDto,
  type ReportFilterOptionsDto,
  type ReportFilterState,
  type ReportPeriodPreset,
  type ReportResumenDto,
  type ReportSectionId,
  type ReportStockDto,
  INITIAL_REPORT_FILTERS,
  REPORT_TAB_ITEMS,
  buildReportQueryString,
  computeMonthRange,
  computePeriodRange,
} from "./reportes-types";

const fallbackReportQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      retry: false,
    },
  },
});

const DeferredReportPanel = () => (
  <div role="status" aria-label="Cargando módulo de reportes">
    <SkeletonCards count={3} />
  </div>
);

const ReportesResumenTab = dynamic(() => import("./ReportesResumenTab"), {
  loading: DeferredReportPanel,
});
const ReportesCajaCxpTab = dynamic(() => import("./ReportesCajaCxpTab"), {
  loading: DeferredReportPanel,
});
const ReportesCarteraTab = dynamic(() => import("./ReportesCarteraTab"), {
  loading: DeferredReportPanel,
});
const ReportesComercialTab = dynamic(() => import("./ReportesComercialTab"), {
  loading: DeferredReportPanel,
});
const ReportesStockTab = dynamic(() => import("./ReportesStockTab"), {
  loading: DeferredReportPanel,
});
const ReportesAuditoriaTab = dynamic(() => import("./ReportesAuditoriaTab"), {
  loading: DeferredReportPanel,
});

type SectionPayload =
  | ReportResumenDto
  | ReportCajaCxpDto
  | ReportCarteraDto
  | ReportComercialDto
  | ReportStockDto
  | ReportAuditoriaDto;

interface ReportesWorkspaceProps {
  externalRefreshKey?: number;
  onOpenCaja: () => void;
  onOpenCollections: () => void;
  onOpenInventory?: () => void;
  onOpenDirectory?: () => void;
  onOpenSeller?: () => void;
  onGoToPurchaseProduct: (productId: number) => void;
  onGoToEditProduct: (sku: string) => void;
  onRefresh: () => Promise<void>;
  onFeedback: (
    msg: string,
    isError?: boolean,
    undoAction?: UndoActionReceiptDto
  ) => void;
  onEditingChange?: (editing: boolean) => void;
}

export default function ReportesWorkspace({
  externalRefreshKey = 0,
  onOpenCaja,
  onOpenCollections,
  onOpenInventory,
  onOpenDirectory,
  onOpenSeller,
  onGoToPurchaseProduct,
  onGoToEditProduct,
  onRefresh,
  onFeedback,
  onEditingChange,
}: ReportesWorkspaceProps) {
  const contextQueryClient = useContext(QueryClientContext);
  const queryClient = contextQueryClient ?? fallbackReportQueryClient;

  const [activeSection, setActiveSection] = useState<ReportSectionId>("resumen");
  const [filters, setFilters] = useState<ReportFilterState>(INITIAL_REPORT_FILTERS);
  const [filterOptions, setFilterOptions] = useState<ReportFilterOptionsDto>({
    zones: [],
    sellers: [],
    months: [],
  });
  const [latestDataCut, setLatestDataCut] = useState<DataCutSummary | null>(null);

  useEffect(() => {
    return () => onEditingChange?.(false);
  }, [onEditingChange]);

  const queryString = useMemo(() => buildReportQueryString(filters), [filters]);

  const reportQuery = useQuery<SectionPayload, Error>(
    {
      queryKey: ["reports", activeSection, queryString, externalRefreshKey],
      queryFn: async ({ signal }) => {
        const qs = queryString ? `&${queryString}` : "";
        const url = `/api/reports?section=${encodeURIComponent(activeSection)}${qs}`;
        const res = await fetch(url, { cache: "no-store", signal });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          data?: SectionPayload;
        };
        if (!res.ok || !body.data) {
          throw new Error(body.error || "No se pudo cargar el reporte.");
        }
        return body.data;
      },
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      placeholderData: (previousData) => previousData,
    },
    queryClient
  );

  const displayPayload = reportQuery.data ?? null;
  const isFetching = reportQuery.isFetching;
  const currentError = reportQuery.error?.message ?? null;

  useEffect(() => {
    if (!displayPayload) return;
    if (displayPayload.filterOptions) {
      setFilterOptions(displayPayload.filterOptions);
    }
    if (displayPayload.dataCut) {
      setLatestDataCut(displayPayload.dataCut);
    }
  }, [displayPayload]);

  function applyPreset(preset: Exclude<ReportPeriodPreset, "MONTH" | "CUSTOM">) {
    const range = computePeriodRange(preset);
    setFilters((prev) => ({
      ...prev,
      preset,
      month: "",
      from: range.from,
      to: range.to,
    }));
  }

  function handleMonthChange(month: string) {
    if (!month) {
      applyPreset("ALL");
      return;
    }
    const range = computeMonthRange(month);
    setFilters((prev) => ({
      ...prev,
      preset: "MONTH",
      month,
      from: range.from,
      to: range.to,
    }));
  }

  function handleRetryOrRefresh() {
    void reportQuery.refetch();
  }

  const hasActiveFilters = Boolean(
    filters.from || filters.to || filters.zone || filters.sellerId
  );

  const facets: ControlPanelFacet[] = useMemo(() => {
    const list: ControlPanelFacet[] = [];
    if (filters.month) {
      list.push({
        id: "month",
        label: "Mes",
        value: formatMonthLabel(filters.month),
        onRemove: () => applyPreset("ALL"),
      });
    } else if (filters.from || filters.to) {
      list.push({
        id: "period",
        label: "Período",
        value: `${filters.from || "..."} a ${filters.to || "..."}`,
        onRemove: () => applyPreset("ALL"),
      });
    }
    if (filters.zone) {
      list.push({
        id: "zone",
        label: "Zona",
        value: filters.zone,
        onRemove: () => setFilters((prev) => ({ ...prev, zone: "" })),
      });
    }
    if (filters.sellerId) {
      const sellerName =
        filters.sellerId === "UNASSIGNED"
          ? "Sin vendedor"
          : (filterOptions.sellers.find(
              (s) => String(s.user_id) === filters.sellerId
            )?.full_name ?? filters.sellerId);
      list.push({
        id: "seller",
        label: "Vendedor",
        value: sellerName,
        onRemove: () => setFilters((prev) => ({ ...prev, sellerId: "" })),
      });
    }
    return list;
  }, [filters, filterOptions.sellers]);

  const activeTabMeta = REPORT_TAB_ITEMS.find((t) => t.id === activeSection);
  const latestRecordedMonth = filterOptions.months.reduce<string | null>(
    (latest, month) => (!latest || month > latest ? month : latest),
    null
  );
  const limaCurrentMonth = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
  const latestRecordedYearMonth = latestRecordedMonth?.slice(0, 7) ?? null;
  const effectiveDataCut = displayPayload?.dataCut ?? latestDataCut;
  const dataNeedsReview = effectiveDataCut
    ? effectiveDataCut.isStale
    : Boolean(latestRecordedYearMonth && latestRecordedYearMonth < limaCurrentMonth);

  return (
    <div className="min-w-0 space-y-4">
      <ControlPanel
        title="Reportes para decidir"
        subtitle={activeTabMeta?.subtitle}
        className="no-print"
        facets={facets}
        onClearAllFacets={() => setFilters(INITIAL_REPORT_FILTERS)}
        secondaryActions={
          <div className="flex flex-wrap items-center gap-2">
            {isFetching && displayPayload && (
              <Badge tone="brand">Actualizando…</Badge>
            )}
            {hasActiveFilters && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFilters(INITIAL_REPORT_FILTERS)}
              >
                <CloseIcon className="h-3.5 w-3.5" />
                Limpiar filtros
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleRetryOrRefresh}
            >
              Actualizar
            </Button>
          </div>
        }
      >
        {activeTabMeta && (
          <details className="group max-w-3xl">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg text-xs font-semibold text-bht-cobalt hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
              Guía de lectura
              <ChevronRightIcon
                aria-hidden="true"
                className="h-3.5 w-3.5 transition group-open:rotate-90"
              />
            </summary>
            <div className="mt-2 space-y-2 rounded-xl bg-bht-surface-cool p-3">
              <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
                {activeTabMeta.concepts.map((concept) => (
                  <div
                    key={concept.term}
                    className="min-w-0 text-xs leading-relaxed"
                  >
                    <dt className="font-bold text-bht-ink-strong">
                      {concept.term}
                    </dt>
                    <dd className="text-bht-ink-soft">{concept.meaning}</dd>
                  </div>
                ))}
              </dl>
              <p className="border-t border-bht-line pt-2 text-xs text-bht-navy-deep">
                Consejo: toca cualquier tarjeta de indicador para abrir su
                explicación práctica y fórmula.
              </p>
            </div>
          </details>
        )}

        {/* 6 Sub-tabs — primary report navigation */}
        <div
          role="tablist"
          aria-label="Secciones de reportes"
          className="grid grid-cols-2 gap-2 rounded-2xl border border-bht-line-blue bg-bht-mist p-1.5 sm:grid-cols-3 xl:grid-cols-6"
        >
          {REPORT_TAB_ITEMS.map((item) => {
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveSection(item.id)}
                className={`min-h-11 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep cursor-pointer ${
                  active
                    ? "border-bht-navy-deep bg-bht-navy-deep text-white shadow-bht-elev-10"
                    : "border-transparent bg-white/85 text-bht-navy-deep hover:border-bht-line-blue hover:bg-white"
                }`}
              >
                <span className="block text-xs font-extrabold leading-tight sm:text-sm">
                  {item.label}
                </span>
                <span
                  className={`mt-0.5 hidden line-clamp-1 text-xs leading-snug xl:block ${
                    active ? "text-bht-mist" : "text-bht-ink-soft"
                  }`}
                >
                  {item.subtitle}
                </span>
              </button>
            );
          })}
        </div>

        {/* Period, Zone & Seller Filters */}
        <div className="space-y-2.5 border-t border-bht-line pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: "ALL", label: "Todo el histórico" },
                  { id: "THIS_MONTH", label: "Este mes" },
                  { id: "LAST_30D", label: "Últ. 30 días" },
                  { id: "LAST_90D", label: "Últ. 90 días" },
                ] as const
              ).map((presetOpt) => {
                const selected = filters.preset === presetOpt.id;
                return (
                  <button
                    key={presetOpt.id}
                    type="button"
                    data-compact="true"
                    aria-pressed={selected}
                    onClick={() => applyPreset(presetOpt.id)}
                    className={`min-h-8 rounded-full border px-3 py-1 text-xs font-semibold transition cursor-pointer ${
                      selected
                        ? "border-bht-cobalt bg-bht-cobalt text-white"
                        : "border-bht-line bg-white text-bht-ink-soft hover:bg-bht-mist"
                    }`}
                  >
                    {presetOpt.label}
                  </button>
                );
              })}
            </div>

            <div
              role="status"
              className="flex flex-wrap items-center gap-1.5 text-xs text-bht-ink-soft"
            >
              <span className="font-semibold text-bht-ink-strong">
                {effectiveDataCut?.lastOrderDate
                  ? `Ventas actualizadas hasta: ${formatDatePe(effectiveDataCut.lastOrderDate)}`
                  : latestRecordedMonth
                    ? `Último mes con ventas registradas: ${formatMonthLabel(latestRecordedMonth)}`
                    : "Todavía no hay un período de ventas disponible"}
              </span>
              {effectiveDataCut && (
                <span className="hidden tabular-nums lg:inline">
                  · Caja: {formatDatePe(effectiveDataCut.lastCashLedgerDate)} · Compras:{" "}
                  {formatDatePe(effectiveDataCut.lastPurchaseDate)}
                </span>
              )}
              {effectiveDataCut && !effectiveDataCut.bankReconciled && (
                <Badge tone="neutral">No conciliado</Badge>
              )}
              <Badge tone={dataNeedsReview ? "warning" : "horizon"}>
                {dataNeedsReview ? "Datos desactualizados" : "Corte visible"}
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <div>
              <label
                htmlFor="rep-month"
                className="mb-1 block text-xs font-medium text-bht-ink-soft"
              >
                Mes contable
              </label>
              <select
                id="rep-month"
                value={filters.month}
                onChange={(e) => handleMonthChange(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">Todos los meses</option>
                {filterOptions.months.map((m) => (
                  <option key={m} value={m}>
                    {formatMonthLabel(m)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="rep-from"
                className="mb-1 block text-xs font-medium text-bht-ink-soft"
              >
                Desde
              </label>
              <input
                id="rep-from"
                type="date"
                value={filters.from}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    preset: "CUSTOM",
                    month: "",
                    from: e.target.value,
                  }))
                }
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label
                htmlFor="rep-to"
                className="mb-1 block text-xs font-medium text-bht-ink-soft"
              >
                Hasta
              </label>
              <input
                id="rep-to"
                type="date"
                value={filters.to}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    preset: "CUSTOM",
                    month: "",
                    to: e.target.value,
                  }))
                }
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label
                htmlFor="rep-zone"
                className="mb-1 block text-xs font-medium text-bht-ink-soft"
              >
                Zona / Ruta
              </label>
              <select
                id="rep-zone"
                value={filters.zone}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, zone: e.target.value }))
                }
                className={INPUT_CLASS}
              >
                <option value="">Todas las zonas</option>
                {filterOptions.zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="rep-seller"
                className="mb-1 block text-xs font-medium text-bht-ink-soft"
              >
                Vendedor
              </label>
              <select
                id="rep-seller"
                value={filters.sellerId}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, sellerId: e.target.value }))
                }
                className={INPUT_CLASS}
              >
                <option value="">Todos los vendedores</option>
                {filterOptions.sellers.map((s) => (
                  <option key={s.user_id} value={String(s.user_id)}>
                    {s.full_name}
                  </option>
                ))}
                <option value="UNASSIGNED">Sin vendedor (Histórico)</option>
              </select>
            </div>
          </div>
        </div>
      </ControlPanel>

      {currentError && (
        <Card
          tone="danger"
          padding="md"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <div className="text-xs sm:text-sm text-bht-danger">
            <strong>Error al cargar sección:</strong> {currentError}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRetryOrRefresh}
          >
            Reintentar
          </Button>
        </Card>
      )}

      {!displayPayload && isFetching && <DeferredReportPanel />}

      {activeSection === "resumen" &&
        cachedOrLatest<ReportResumenDto>(displayPayload, "pnlMonthly") && (
          <ReportesResumenTab
            data={cachedOrLatest<ReportResumenDto>(displayPayload, "pnlMonthly")!}
            hasScopeFilter={Boolean(filters.zone || filters.sellerId)}
          />
        )}

      {activeSection === "caja_cxp" &&
        cachedOrLatest<ReportCajaCxpDto>(displayPayload, "liquiditySummary") && (
          <ReportesCajaCxpTab
            data={cachedOrLatest<ReportCajaCxpDto>(displayPayload, "liquiditySummary")!}
            onOpenCaja={onOpenCaja}
          />
        )}

      {activeSection === "cartera" &&
        cachedOrLatest<ReportCarteraDto>(displayPayload, "collectionSheet") && (
          <ReportesCarteraTab
            data={cachedOrLatest<ReportCarteraDto>(displayPayload, "collectionSheet")!}
            selectedZone={filters.zone}
            onSelectZone={(zone) => setFilters((prev) => ({ ...prev, zone }))}
            onOpenCollections={onOpenCollections}
          />
        )}

      {activeSection === "comercial" &&
        cachedOrLatest<ReportComercialDto>(displayPayload, "routeProfitability") && (
          <ReportesComercialTab
            data={cachedOrLatest<ReportComercialDto>(
              displayPayload,
              "routeProfitability"
            )!}
          />
        )}

      {activeSection === "stock" &&
        cachedOrLatest<ReportStockDto>(displayPayload, "valuationSummary") && (
          <ReportesStockTab
            data={cachedOrLatest<ReportStockDto>(displayPayload, "valuationSummary")!}
            onGoToPurchaseProduct={onGoToPurchaseProduct}
            onGoToEditProduct={onGoToEditProduct}
          />
        )}

      {activeSection === "auditoria" &&
        cachedOrLatest<ReportAuditoriaDto>(displayPayload, "closingReadiness") && (
          <ReportesAuditoriaTab
            data={cachedOrLatest<ReportAuditoriaDto>(
              displayPayload,
              "closingReadiness"
            )!}
            filters={filters}
            onOpenCaja={onOpenCaja}
            onOpenCollections={onOpenCollections}
            onOpenInventory={onOpenInventory}
            onOpenDirectory={onOpenDirectory}
            onOpenSeller={onOpenSeller}
            onRefresh={async () => {
              await onRefresh();
              handleRetryOrRefresh();
            }}
            onFeedback={onFeedback}
          />
        )}
    </div>
  );
}

function cachedOrLatest<T extends SectionPayload>(
  payload: SectionPayload | null,
  markerKey: keyof T & string
): T | null {
  if (!payload || !(markerKey in payload)) return null;
  return payload as T;
}
