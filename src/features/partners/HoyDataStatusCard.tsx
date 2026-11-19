"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  formatDatePe,
  type DataCutSummary,
  type OperationalQualitySummary,
} from "@/components/socios/types";
import { ChevronRightIcon } from "@/components/ui/Icons";
import { Badge, Button, Card } from "@/components/ui/Primitives";
import type { PartnerTab } from "./partnerShared";

interface HoyDataStatusCardProps {
  dataCut: DataCutSummary | null;
  operationalQuality: OperationalQualitySummary | null;
  fallbackPeriodEnd?: string | null;
  onOpenTab: (tab: PartnerTab) => void;
}

export function HoyDataStatusCard({
  dataCut,
  operationalQuality,
  fallbackPeriodEnd,
  onOpenTab,
}: HoyDataStatusCardProps) {
  const router = useRouter();
  const effectiveCutDate = dataCut?.lastOrderDate ?? fallbackPeriodEnd ?? null;

  if (!dataCut && !operationalQuality && !effectiveCutDate) {
    return null;
  }

  const isStale = dataCut?.isStale ?? false;
  const bankReconciled = dataCut?.bankReconciled ?? false;
  const coverage = operationalQuality?.registrationCoverage24h;
  const checklist = operationalQuality?.startupChecklist ?? [];
  const doneCount = checklist.filter((item) => item.done).length;

  return (
    <Card
      tone={isStale || !bankReconciled ? "warning" : "default"}
      padding="sm"
      className="space-y-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 space-y-0.5 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-bht-ink-strong">
              {effectiveCutDate
                ? `Ventas actualizadas hasta: ${formatDatePe(effectiveCutDate)}`
                : "Sin ventas registradas aún"}
            </span>
            {isStale && <Badge tone="warning">Revisar vigencia</Badge>}
            {!bankReconciled && <Badge tone="warning">Saldos no conciliados</Badge>}
          </div>
          {dataCut && (
            <p className="text-bht-ink-soft tabular-nums">
              Caja: {formatDatePe(dataCut.lastCashLedgerDate)} · Cobros:{" "}
              {formatDatePe(dataCut.lastPaymentDate)} · Compras:{" "}
              {formatDatePe(dataCut.lastPurchaseDate)}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {coverage && (
            <Badge
              tone={
                coverage.baselineMode === "NO_APP_ORDERS"
                  ? "warning"
                  : coverage.coveragePct !== null && coverage.coveragePct >= 90
                    ? "success"
                    : "warning"
              }
              className="tabular-nums"
            >
              {coverage.denominator === 0
                ? "Cobertura 24 h: 0 ventas ERP aún"
                : `Cobertura 24 h: ${coverage.numerator}/${coverage.denominator} (${coverage.coveragePct?.toFixed(1) ?? "0.0"}%)`}
            </Badge>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenTab("kpis")}
          >
            Ver calidad en Reportes →
          </Button>
        </div>
      </div>

      {checklist.length > 0 && (
        <details className="group border-t border-bht-line pt-2 text-xs">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 font-semibold text-bht-navy-deep hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt [&::-webkit-details-marker]:hidden">
            <span>
              Lista de inicio operativo ({doneCount}/{checklist.length})
            </span>
            <ChevronRightIcon
              aria-hidden="true"
              className="h-3.5 w-3.5 transition group-open:rotate-90"
            />
          </summary>

          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            {checklist.map((item) => (
              <div
                key={item.code}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bht-line bg-white p-2.5"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={item.done ? "success" : "warning"}>
                      {item.done ? "Listo" : "Pendiente"}
                    </Badge>
                    <span className="font-semibold text-bht-ink-strong">
                      {item.label}
                    </span>
                  </div>
                  <p className="text-bht-ink-soft">{item.detail}</p>
                </div>
                {!item.done && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (item.targetTab === "vendedor") {
                        router.push("/vendedor");
                      } else {
                        onOpenTab(item.targetTab);
                      }
                    }}
                  >
                    Revisar
                  </Button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}
