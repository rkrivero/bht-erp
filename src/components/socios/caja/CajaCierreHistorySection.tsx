"use client";

import { Badge, Card } from "@/components/ui/Primitives";
import type { DailyClosureDraftResponse } from "@/lib/services/daily-closure";
import { formatDatePe, formatPen } from "../types";

interface CajaCierreHistorySectionProps {
  closureDate: string;
  corrections: DailyClosureDraftResponse["corrections"];
  recentClosures: DailyClosureDraftResponse["recentClosures"];
  onSelectDate: (date: string) => void;
}

export default function CajaCierreHistorySection({
  closureDate,
  corrections,
  recentClosures,
  onSelectDate,
}: CajaCierreHistorySectionProps) {
  return (
    <>
      {corrections.length > 0 && (
        <Card padding="md" className="space-y-3">
          <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
            Historial de correcciones
          </h3>
          <div className="space-y-2">
            {corrections.map((item) => (
              <div
                key={item.auditId}
                className="rounded-xl border border-bht-line p-3 text-sm"
              >
                <p className="font-semibold text-bht-ink-strong">
                  {item.actorName} ·{" "}
                  {new Date(item.createdAt).toLocaleString("es-PE", {
                    timeZone: "America/Lima",
                  })}
                </p>
                <p className="mt-1 text-bht-ink-soft">{item.reason}</p>
                <p className="mt-1 tabular-nums text-bht-ink-strong">
                  Contado: {formatPen(item.beforeData.closure.countedCashTotalPen)} →{" "}
                  {formatPen(item.afterData.closure.countedCashTotalPen)} · Diferencia:{" "}
                  {formatPen(item.beforeData.closure.varianceTotalPen)} →{" "}
                  {formatPen(item.afterData.closure.varianceTotalPen)}
                </p>
                <details className="mt-2 text-xs text-bht-ink-soft">
                  <summary className="cursor-pointer">Ver saldos por cuenta</summary>
                  <div className="mt-2 space-y-1">
                    {item.afterData.accounts.map((after) => {
                      const before = item.beforeData.accounts.find(
                        (row) => row.accountId === after.accountId
                      );
                      return (
                        <p key={after.accountId}>
                          {after.name}:{" "}
                          {before?.countedBalancePen === null ||
                          before?.countedBalancePen === undefined
                            ? "—"
                            : formatPen(before.countedBalancePen)}{" "}
                          →{" "}
                          {after.countedBalancePen === null
                            ? "—"
                            : formatPen(after.countedBalancePen)}
                        </p>
                      );
                    })}
                  </div>
                </details>
              </div>
            ))}
          </div>
        </Card>
      )}

      {recentClosures.length > 0 && (
        <Card padding="md" className="space-y-3">
          <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
            Cierres recientes ({recentClosures.length})
          </h3>
          <div className="space-y-2">
            {recentClosures.map((c) => (
              <button
                key={c.closureId}
                type="button"
                onClick={() => onSelectDate(c.closureDate)}
                className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-left text-sm transition cursor-pointer ${
                  c.closureDate === closureDate
                    ? "border-bht-navy-deep bg-bht-mist"
                    : "border-bht-line bg-bht-paper/60 hover:bg-bht-mist/60"
                }`}
              >
                <div>
                  <span className="font-semibold text-bht-ink-strong">
                    {formatDatePe(c.closureDate)}
                  </span>
                  <span className="ml-2 text-xs text-bht-ink-soft">
                    por {c.closedByName}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums">
                  <span>Contado: {formatPen(c.countedCashTotalPen)}</span>
                  <Badge
                    tone={Math.abs(c.varianceTotalPen) < 0.01 ? "success" : "warning"}
                  >
                    Dif.: {c.varianceTotalPen >= 0 ? "+" : ""}
                    {formatPen(c.varianceTotalPen)}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
