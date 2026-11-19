"use client";

import React, { useState } from "react";
import { DownloadIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLASS,
} from "@/components/ui/Primitives";
import {
  formatAuditFlagCodeEs,
  formatAuditFlagStatusEs,
  formatEntityTableEs,
  formatQualityGapEs,
} from "@/lib/labels-es";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import { formatPen } from "../types";
import { ReportesCalidadPanel } from "./ReportesCalidadPanel";
import {
  type ReportAuditoriaDto,
  type ReportFilterState,
  REPORT_CSV_CARDS,
  buildReportQueryString,
  formatClosingStatusEs,
} from "./reportes-types";

interface ReportesAuditoriaTabProps {
  data: ReportAuditoriaDto;
  filters: ReportFilterState;
  onOpenCaja?: () => void;
  onOpenCollections?: () => void;
  onOpenInventory?: () => void;
  onOpenDirectory?: () => void;
  onOpenSeller?: () => void;
  onRefresh: () => Promise<void>;
  onFeedback: (msg: string, isError?: boolean) => void;
}

export default function ReportesAuditoriaTab({
  data,
  filters,
  onOpenCaja,
  onOpenCollections,
  onOpenInventory,
  onOpenDirectory,
  onOpenSeller,
  onRefresh,
  onFeedback,
}: ReportesAuditoriaTabProps) {
  const [downloadingDataset, setDownloadingDataset] = useState<string | null>(null);
  const [flagFilter, setFlagFilter] = useState<
    "ALL" | "OPEN" | "ACKNOWLEDGED" | "RESOLVED"
  >("OPEN");
  const [busyFlagId, setBusyFlagId] = useState<number | null>(null);
  const [flagNoteById, setFlagNoteById] = useState<Record<number, string>>({});

  const closingBadge = formatClosingStatusEs(data.closingReadiness.status);

  async function handleDownloadCsv(
    datasetId: string,
    title: string,
    supportsDate: boolean,
    supportsZone: boolean
  ) {
    if (downloadingDataset !== null) return;
    setDownloadingDataset(datasetId);
    try {
      const qs = buildReportQueryString(
        {
          from: supportsDate ? filters.from : "",
          to: supportsDate ? filters.to : "",
          zone: supportsZone ? filters.zone : "",
          sellerId: "",
        },
        { includeSeller: false, includeZone: supportsZone }
      );
      const suffix = qs ? `&${qs}` : "";
      const res = await fetch(
        `/api/reports?dataset=${encodeURIComponent(datasetId)}&format=csv${suffix}`
      );
      if (!res.ok) {
        let errMsg = `Error descargando ${title}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) errMsg = j.error;
        } catch {
          // ignore JSON parse failure
        }
        onFeedback(errMsg, true);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") || "";
      const match = cd.match(/filename="?([^"]+)"?/i);
      const filename =
        match?.[1] || `bht_${datasetId}_${new Date().toISOString().slice(0, 10)}.csv`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onFeedback(`Reporte "${title}" exportado en Excel CSV (${filename}).`);
    } catch {
      onFeedback(`Error de red descargando ${title}.`, true);
    } finally {
      setDownloadingDataset(null);
    }
  }

  async function handleUpdateAuditFlag(
    flagId: number,
    nextStatus: "OPEN" | "ACKNOWLEDGED" | "RESOLVED"
  ) {
    if (busyFlagId === flagId) return;
    setBusyFlagId(flagId);
    try {
      const res = await fetch("/api/audit-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_status",
          flagId,
          nextStatus,
          resolutionNote: flagNoteById[flagId]?.trim() || undefined,
        }),
      });
      const resData = (await res.json()) as { error?: string };
      if (!res.ok) {
        onFeedback(resData.error || "No se pudo actualizar la alerta.", true);
        return;
      }
      onFeedback(
        nextStatus === "RESOLVED"
          ? "Alerta operativa marcada como resuelta."
          : nextStatus === "ACKNOWLEDGED"
            ? "Alerta marcada como revisada."
            : "Alerta reabierta correctamente."
      );
      notifyLocalSync(["partners"]);
      await onRefresh();
    } catch {
      onFeedback("Error de red al actualizar alerta operativa.", true);
    } finally {
      setBusyFlagId(null);
    }
  }

  const visibleFlags = data.auditFlags.filter((f) =>
    flagFilter === "ALL" ? true : f.status === flagFilter
  );

  return (
    <div className="min-w-0 space-y-4">
      {data.operationalQuality && (
        <ReportesCalidadPanel
          dataCut={data.dataCut}
          quality={data.operationalQuality}
          onOpenCaja={onOpenCaja}
          onOpenCollections={onOpenCollections}
          onOpenInventory={onOpenInventory}
          onOpenDirectory={onOpenDirectory}
          onOpenSeller={onOpenSeller}
        />
      )}

      {/* Closing Readiness Semaphore */}
      <Card
        tone={closingBadge.tone === "success" ? "success" : "warning"}
        padding="md"
        className="space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
              Semáforo de Cierre Contable y Operativo
            </h3>
            <p className="mt-0.5 text-xs text-bht-ink-soft">
              Verifica costos completos, inventarios, aprobaciones y rutas antes del
              corte mensual.
            </p>
          </div>
          <Badge tone={closingBadge.tone}>{closingBadge.label}</Badge>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {data.closingReadiness.checks.map((chk) => (
            <div
              key={chk.code}
              className="rounded-xl border border-bht-line bg-white p-3 text-xs space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-bht-ink-strong">{chk.label}</span>
                <Badge
                  tone={
                    chk.severity === "OK"
                      ? "success"
                      : chk.severity === "BLOCKING"
                        ? "danger"
                        : "warning"
                  }
                >
                  {chk.count}
                </Badge>
              </div>
              <p className="text-bht-ink-soft">{chk.detail}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* CSV Download Center (7 datasets) */}
      <Card tone="success" padding="md" className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
            Centro de Descargas Contables y Excel (7 Reportes CSV)
          </h3>
          <p className="mt-0.5 text-xs text-bht-ink-soft">
            Compatible con Excel en español (BOM UTF-8, protección contra fórmulas).
            {(filters.from || filters.to || filters.zone) &&
              " Los reportes filtrables aplican automáticamente el rango de fechas y zona seleccionados."}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {REPORT_CSV_CARDS.map((ds) => {
            const busy = downloadingDataset === ds.id;
            return (
              <button
                key={ds.id}
                type="button"
                disabled={downloadingDataset !== null}
                onClick={() =>
                  handleDownloadCsv(
                    ds.id,
                    ds.title,
                    ds.supportsDateFilter,
                    ds.supportsZoneFilter
                  )
                }
                className="flex flex-col justify-between rounded-xl border border-bht-line bg-white p-3.5 text-left transition hover:border-bht-navy-deep disabled:opacity-50 cursor-pointer"
              >
                <div>
                  <p className="text-xs font-semibold text-bht-ink-strong">
                    {ds.title}
                  </p>
                  <p className="mt-1 text-xs text-bht-ink-soft">{ds.subtitle}</p>
                </div>
                <span className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-bht-navy-deep px-2.5 py-1.5 text-xs font-semibold text-white">
                  <DownloadIcon aria-hidden="true" className="h-3.5 w-3.5" />
                  {busy ? "Descargando..." : "Descargar CSV"}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Data Quality Gaps */}
      <Card padding="md" className="space-y-3">
        <h3 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
          Calidad de Datos e Integridad Operativa
        </h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {data.qualityGaps.map((g) => {
            const gapInfo = formatQualityGapEs(g.metric_code, g.recommended_action);
            return (
              <div
                key={g.metric_code}
                className="rounded-xl bg-bht-paper p-3 text-xs space-y-1"
              >
                <span className="font-medium text-bht-ink-soft">{gapInfo.label}</span>
                <p className="text-sm font-semibold text-bht-ink-strong tabular-nums">
                  {g.gap_count} caso(s) ({formatPen(g.impacted_amount_pen)})
                </p>
                <p className="text-xs text-bht-ink-soft">{gapInfo.description}</p>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Audit Flags Panel */}
      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
              Alertas Operativas y Auditoría
            </h3>
            <p className="text-xs text-bht-ink-soft">
              {data.auditFlagCounts.open} abierta(s) ·{" "}
              {data.auditFlagCounts.acknowledged} en revisión ·{" "}
              {data.auditFlagCounts.resolved} resuelta(s)
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: "OPEN", label: "Abiertas" },
                { id: "ACKNOWLEDGED", label: "En revisión" },
                { id: "RESOLVED", label: "Resueltas" },
                { id: "ALL", label: "Todas" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={flagFilter === opt.id}
                onClick={() => setFlagFilter(opt.id)}
                className={`min-h-[36px] sm:min-h-0 rounded-full border px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                  flagFilter === opt.id
                    ? "border-bht-navy-deep bg-bht-navy-deep text-white"
                    : "border-bht-line bg-white text-bht-ink-soft hover:bg-bht-mist"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {visibleFlags.length === 0 ? (
          <EmptyState title="Sin alertas operativas en este filtro" />
        ) : (
          <div className="space-y-2.5">
            {visibleFlags.slice(0, 25).map((f) => {
              const isBusy = busyFlagId === f.flag_id;
              const tone =
                f.status === "RESOLVED"
                  ? "success"
                  : f.status === "ACKNOWLEDGED"
                    ? "brand"
                    : f.severity === "CRITICAL"
                      ? "danger"
                      : "warning";
              return (
                <div
                  key={f.flag_id}
                  className="rounded-xl border border-bht-line bg-bht-paper p-3 text-xs space-y-2"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={tone}>{formatAuditFlagStatusEs(f.status)}</Badge>
                        <span className="font-semibold text-bht-ink-strong">
                          {formatAuditFlagCodeEs(f.flag_code)}
                        </span>
                        <span className="text-bht-ink-muted">
                          ({formatEntityTableEs(f.entity_table)} #{f.entity_id})
                        </span>
                      </div>
                      <p className="text-bht-ink-strong">{f.message}</p>
                      {f.resolution_note && (
                        <p className="text-xs text-bht-ink-soft">
                          Nota: {f.resolution_note}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {f.status === "OPEN" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-compact="true"
                          disabled={isBusy}
                          onClick={() =>
                            handleUpdateAuditFlag(f.flag_id, "ACKNOWLEDGED")
                          }
                        >
                          Revisar
                        </Button>
                      )}
                      {f.status !== "RESOLVED" ? (
                        <Button
                          type="button"
                          variant="success"
                          size="sm"
                          data-compact="true"
                          disabled={isBusy}
                          onClick={() => handleUpdateAuditFlag(f.flag_id, "RESOLVED")}
                        >
                          Resolver
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-compact="true"
                          disabled={isBusy}
                          onClick={() => handleUpdateAuditFlag(f.flag_id, "OPEN")}
                        >
                          Reabrir
                        </Button>
                      )}
                    </div>
                  </div>
                  {f.status !== "RESOLVED" && (
                    <input
                      type="text"
                      value={flagNoteById[f.flag_id] ?? ""}
                      onChange={(e) =>
                        setFlagNoteById((prev) => ({
                          ...prev,
                          [f.flag_id]: e.target.value,
                        }))
                      }
                      placeholder="Nota de revisión / resolución (opcional)"
                      aria-label={`Nota de resolución para alerta ${f.flag_id}`}
                      className={INPUT_CLASS}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
