"use client";

import dynamic from "next/dynamic";
import React, { useEffect, useMemo, useState } from "react";
import { ChevronRightIcon, CloseIcon } from "@/components/ui/Icons";
import { Badge, Button, Card, INPUT_CLASS } from "@/components/ui/Primitives";
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

const DeferredReportPanel = () => (
  <Card
    padding="md"
    role="status"
    className="text-center text-sm font-medium text-bht-ink-soft"
  >
    Cargando módulo de reportes…
  </Card>
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
  onFeedback: (msg: string, isError?: boolean) => void;
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
  const [activeSection, setActiveSection] = useState<ReportSectionId>("resumen");
  const [filters, setFilters] = useState<ReportFilterState>(INITIAL_REPORT_FILTERS);
  const [manualNonce, setManualNonce] = useState(0);
  const [cacheByRequestKey, setCacheByRequestKey] = useState<
    Record<string, SectionPayload>
  >({});
  const [latestBySection, setLatestBySection] = useState<
    Partial<Record<ReportSectionId, SectionPayload>>
  >({});
  const [errorByRequestKey, setErrorByRequestKey] = useState<Record<string, string>>(
    {}
  );
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
  const requestKey = `${activeSection}|${queryString}|${manualNonce}|${externalRefreshKey}`;
  const cachedPayload = cacheByRequestKey[requestKey];
  const currentError = errorByRequestKey[requestKey];
  const displayPayload = cachedPayload ?? latestBySection[activeSection] ?? null;
  const isFetching = !cachedPayload && !currentError;

  useEffect(() => {
    if (cachedPayload || currentError) return;
    const controller = new AbortController();
    const qs = queryString ? `&${queryString}` : "";
    const url = `/api/reports?section=${encodeURIComponent(activeSection)}${qs}`;

    void fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          data?: SectionPayload;
        };
        if (!res.ok || !body.data) {
          throw new Error(body.error || "No se pudo cargar el reporte.");
        }
        if (controller.signal.aborted) return;
        const payload = body.data;
        setCacheByRequestKey((prev) => ({ ...prev, [requestKey]: payload }));
        setLatestBySection((prev) => ({ ...prev, [activeSection]: payload }));
        if (payload.filterOptions) {
          setFilterOptions(payload.filterOptions);
        }
        if (payload.dataCut) {
          setLatestDataCut(payload.dataCut);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const msg =
          err instanceof Error && err.message
            ? err.message
            : "Error de red al cargar el reporte.";
        setErrorByRequestKey((prev) => ({ ...prev, [requestKey]: msg }));
      });

    return () => controller.abort();
  }, [activeSection, queryString, requestKey, cachedPayload, currentError]);

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
    setErrorByRequestKey((prev) => {
      const next = { ...prev };
      delete next[requestKey];
      return next;
    });
    setManualNonce((n) => n + 1);
  }

  const hasActiveFilters = Boolean(
    filters.from || filters.to || filters.zone || filters.sellerId
  );

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
      {/* Global Filter Bar + Sub-tab Navigation */}
      <Card accent="horizon" padding="md" className="no-print space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-bht-navy-deep sm:text-lg">
                Reportes para decidir
              </h2>
              {isFetching && displayPayload && (
                <Badge tone="brand">Actualizando…</Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-bht-ink-soft">
              {activeTabMeta?.subtitle}
            </p>
            {activeTabMeta && (
              <details className="group mt-2 max-w-3xl">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg text-xs font-semibold text-bht-cobalt hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
                  Guía de lectura
                  <ChevronRightIcon
                    aria-hidden="true"
                    className="h-3.5 w-3.5 transition group-open:rotate-90"
                  />
                </summary>
                <dl className="mt-2 grid gap-x-5 gap-y-2 rounded-xl bg-bht-surface-cool p-3 sm:grid-cols-2 xl:grid-cols-4">
                  {activeTabMeta.concepts.map((concept) => (
                    <div key={concept.term} className="min-w-0 text-xs leading-relaxed">
                      <dt className="font-bold text-bht-ink-strong">{concept.term}</dt>
                      <dd className="text-bht-ink-soft">{concept.meaning}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            {hasActiveFilters && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1 sm:flex-none"
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
              className="flex-1 sm:flex-none"
              onClick={handleRetryOrRefresh}
            >
              Actualizar
            </Button>
          </div>
        </div>

        <div
          role="status"
          className={`flex flex-wrap items-start justify-between gap-2 rounded-xl border p-3 text-xs ${
            dataNeedsReview
              ? "border-bht-warning bg-bht-warning-bg text-bht-ink-strong"
              : "border-bht-line-blue bg-bht-mist text-bht-ink-strong"
          }`}
        >
          <div className="max-w-3xl space-y-1">
            <p className="font-semibold">
              {effectiveDataCut?.lastOrderDate
                ? `Ventas actualizadas hasta: ${formatDatePe(effectiveDataCut.lastOrderDate)}`
                : latestRecordedMonth
                  ? `Último mes con ventas registradas: ${formatMonthLabel(latestRecordedMonth)}`
                  : "Todavía no hay un período de ventas disponible"}
            </p>
            {effectiveDataCut && (
              <p className="text-bht-ink-soft tabular-nums">
                Caja: {formatDatePe(effectiveDataCut.lastCashLedgerDate)} · Cobros:{" "}
                {formatDatePe(effectiveDataCut.lastPaymentDate)} · Compras:{" "}
                {formatDatePe(effectiveDataCut.lastPurchaseDate)} · Cotizaciones:{" "}
                {formatDatePe(effectiveDataCut.lastQuoteDate)}
              </p>
            )}
            <p className="text-bht-ink-soft">
              Las cifras reflejan únicamente lo guardado en el ERP.{" "}
              {effectiveDataCut?.bankReconciled
                ? "Confirma la vigencia del corte antes de decidir."
                : "Caja, bancos y resultados históricos deben leerse como no conciliados hasta completar su revisión."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {effectiveDataCut && !effectiveDataCut.bankReconciled && (
              <Badge tone="warning">No conciliado</Badge>
            )}
            <Badge tone={dataNeedsReview ? "warning" : "horizon"}>
              {dataNeedsReview ? "Datos desactualizados" : "Corte visible"}
            </Badge>
          </div>
        </div>

        {/* 6 Sub-tabs */}
        <div
          role="tablist"
          aria-label="Secciones de reportes"
          className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-6"
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
                className={`min-h-11 rounded-xl border px-3 py-2 text-left text-xs font-semibold leading-tight transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep sm:text-sm cursor-pointer ${
                  active
                    ? "border-bht-navy-deep bg-bht-navy-deep text-white shadow-bht-elev-10"
                    : "border-bht-line bg-bht-paper text-bht-ink-strong hover:bg-bht-mist"
                }`}
              >
                <span className="block whitespace-normal">{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Period, Zone & Seller Filters */}
        <div className="space-y-2.5 border-t border-bht-line pt-3">
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
                  className={`min-h-9 rounded-full border px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    selected
                      ? "border-bht-navy-deep bg-bht-navy-deep text-white"
                      : "border-bht-line bg-white text-bht-ink-soft hover:bg-bht-mist"
                  }`}
                >
                  {presetOpt.label}
                </button>
              );
            })}
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
      </Card>

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
