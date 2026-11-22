"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  FieldLabel,
  INPUT_CLASS,
} from "@/components/ui/Primitives";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import { formatOperationalStatusEs } from "@/lib/labels-es";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import type { DailyClosureDraftResponse } from "@/lib/services/daily-closure";
import { formatDatePe, formatPen } from "../types";
import { getTodayLimaIso } from "./caja-utils";
import CajaCierreAccountsTable from "./CajaCierreAccountsTable";
import CajaCierreHistorySection from "./CajaCierreHistorySection";

interface CajaCierreTabProps {
  onRefresh: () => Promise<void>;
  onFeedback: (msg: string, isError?: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
}

export default function CajaCierreTab({
  onRefresh,
  onFeedback,
  onEditingChange,
}: CajaCierreTabProps) {
  const todayIso = useMemo(() => getTodayLimaIso(), []);
  const [closureDate, setClosureDate] = useState(todayIso);
  const [draft, setDraft] = useState<DailyClosureDraftResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [countedByAccount, setCountedByAccount] = useState<Record<number, string>>({});
  const [notesByAccount, setNotesByAccount] = useState<Record<number, string>>({});
  const [applyAdjustments, setApplyAdjustments] = useState(false);
  const [nextDayNotes, setNextDayNotes] = useState("");
  const [notes, setNotes] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    onEditingChange?.(dirty);
    return () => onEditingChange?.(false);
  }, [dirty, onEditingChange]);

  const hydrateFormFromDraft = useCallback((next: DailyClosureDraftResponse) => {
    const nextCounts: Record<number, string> = {};
    const nextAcctNotes: Record<number, string> = {};
    for (const acc of next.accounts) {
      const seedVal =
        acc.countedBalancePen !== null ? acc.countedBalancePen : acc.systemBalancePen;
      nextCounts[acc.accountId] = seedVal.toFixed(2);
      nextAcctNotes[acc.accountId] = acc.notes ?? "";
    }
    setCountedByAccount(nextCounts);
    setNotesByAccount(nextAcctNotes);
    setApplyAdjustments(next.hasAppliedAdjustments);
    setNextDayNotes(next.existingClosure?.nextDayNotes ?? "");
    setNotes(next.existingClosure?.notes ?? "");
    setCorrectionReason("");
    setDirty(false);
  }, []);

  const loadDraft = useCallback(
    async (targetDate: string) => {
      setLoading(true);
      try {
        const res = await fetchJson<DailyClosureDraftResponse>(
          `/api/daily-closures?date=${encodeURIComponent(targetDate)}`
        );
        setDraft(res);
        hydrateFormFromDraft(res);
      } catch (err) {
        onFeedback(
          err instanceof ApiClientError
            ? err.message
            : "Error cargando borrador de cierre diario.",
          true
        );
      } finally {
        setLoading(false);
      }
    },
    [hydrateFormFromDraft, onFeedback]
  );

  useEffect(() => {
    void loadDraft(closureDate);
  }, [closureDate, loadDraft]);

  const accountTotals = useMemo(() => {
    if (!draft) {
      return { expected: 0, counted: 0, variance: 0 };
    }
    let expected = 0;
    let counted = 0;
    for (const acc of draft.accounts) {
      expected += acc.systemBalancePen;
      const raw = Number(countedByAccount[acc.accountId] ?? acc.systemBalancePen);
      counted += Number.isFinite(raw) ? raw : acc.systemBalancePen;
    }
    return {
      expected: Number(expected.toFixed(2)),
      counted: Number(counted.toFixed(2)),
      variance: Number((counted - expected).toFixed(2)),
    };
  }, [draft, countedByAccount]);

  function handleMatchAllSystemBalances() {
    if (!draft) return;
    const synced: Record<number, string> = {};
    for (const acc of draft.accounts) {
      synced[acc.accountId] = acc.systemBalancePen.toFixed(2);
    }
    setCountedByAccount(synced);
    setDirty(true);
  }

  async function handleSaveClosure(e: FormEvent) {
    e.preventDefault();
    if (!draft || saving) return;
    if (draft.isClosed && !correctionReason.trim()) {
      onFeedback("Indica el motivo de la corrección del cierre.", true);
      return;
    }

    const payloadAccounts: Array<{
      accountId: number;
      countedBalancePen: number;
      notes: string | null;
    }> = [];

    for (const acc of draft.accounts) {
      const val = Number(countedByAccount[acc.accountId]);
      if (!Number.isFinite(val)) {
        onFeedback(`Ingresa un saldo contado válido para ${acc.name}.`, true);
        return;
      }
      payloadAccounts.push({
        accountId: acc.accountId,
        countedBalancePen: Number(val.toFixed(2)),
        notes: notesByAccount[acc.accountId]?.trim() || null,
      });
    }

    setSaving(true);
    try {
      const saved = await fetchJson<DailyClosureDraftResponse>("/api/daily-closures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          closureDate,
          accounts: payloadAccounts,
          applyReconciliationAdjustments: applyAdjustments,
          nextDayNotes: nextDayNotes.trim() || null,
          notes: notes.trim() || null,
          correctionReason: draft.isClosed ? correctionReason.trim() : null,
        }),
      });
      setDraft(saved);
      hydrateFormFromDraft(saved);
      notifyLocalSync(["treasury", "partners"]);
      onFeedback(
        `Cierre diario del ${formatDatePe(closureDate)} guardado correctamente.`
      );
      await onRefresh();
    } catch (err) {
      onFeedback(
        err instanceof ApiClientError
          ? err.message
          : "No se pudo guardar el cierre diario.",
        true
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
                Cierre diario de 10 minutos
              </h3>
              {draft && (
                <Badge tone={draft.isClosed ? "success" : "warning"}>
                  {draft.isClosed ? "Cerrado" : "Pendiente de cierre"}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs sm:text-sm text-bht-ink-soft">
              Confirma efectivo contado, saldos bancarios y pendientes antes de terminar
              el día.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="cierre-date-input" className="sr-only">
              Fecha de cierre diario
            </label>
            <input
              id="cierre-date-input"
              type="date"
              value={closureDate}
              onChange={(e) => setClosureDate(e.target.value || todayIso)}
              className={`${INPUT_CLASS} w-auto font-medium tabular-nums`}
            />
            {closureDate !== todayIso && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setClosureDate(todayIso)}
              >
                Hoy
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void loadDraft(closureDate)}
            >
              Actualizar
            </Button>
          </div>
        </div>

        {loading && !draft ? (
          <div className="py-8 text-center text-sm text-bht-ink-soft">
            Calculando resumen del día y saldos por cuenta…
          </div>
        ) : (
          draft && (
            <>
              {draft.existingClosure && (
                <p className="text-xs text-bht-ink-soft">
                  Último cierre guardado por{" "}
                  <strong className="text-bht-ink-strong">
                    {draft.existingClosure.closedByName}
                  </strong>{" "}
                  el {formatDatePe(draft.existingClosure.closureDate)}.
                </p>
              )}

              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <div className="rounded-xl border border-bht-line bg-bht-paper p-3">
                  <span className="block text-xs font-medium text-bht-ink-soft">
                    Ventas del día
                  </span>
                  <p className="mt-1 text-lg font-bold text-bht-navy-deep tabular-nums sm:text-xl">
                    {formatPen(draft.daySummary.salesTotalPen)}
                  </p>
                  <span className="text-xs text-bht-ink-muted tabular-nums">
                    {draft.daySummary.salesCount} pedido(s)
                  </span>
                </div>
                <div className="rounded-xl border border-bht-line bg-bht-paper p-3">
                  <span className="block text-xs font-medium text-bht-ink-soft">
                    Cobros efectivos del día
                  </span>
                  <p className="mt-1 text-lg font-bold text-bht-success tabular-nums sm:text-xl">
                    {formatPen(draft.daySummary.collectionsTotalPen)}
                  </p>
                  <span className="text-xs text-bht-ink-muted">
                    Por fecha real de pago
                  </span>
                </div>
                <div className="rounded-xl border border-bht-line bg-bht-paper p-3">
                  <span className="block text-xs font-medium text-bht-ink-soft">
                    Gastos del día
                  </span>
                  <p className="mt-1 text-lg font-bold text-bht-danger tabular-nums sm:text-xl">
                    {formatPen(draft.daySummary.expensesTotalPen)}
                  </p>
                  <span className="text-xs text-bht-ink-muted">
                    Ruta, fijos y retiros
                  </span>
                </div>
                <div className="rounded-xl border border-bht-line bg-bht-paper p-3">
                  <span className="block text-xs font-medium text-bht-ink-soft">
                    Depósitos / Traslados
                  </span>
                  <p className="mt-1 text-lg font-bold text-bht-ink-strong tabular-nums sm:text-xl">
                    {formatPen(draft.daySummary.depositsTotalPen)}
                  </p>
                  <span className="text-xs text-bht-ink-muted">
                    Entre cuentas propias
                  </span>
                </div>
              </div>
            </>
          )
        )}
      </Card>

      {draft && (
        <form onSubmit={handleSaveClosure} className="space-y-4">
          <CajaCierreAccountsTable
            accounts={draft.accounts}
            countedByAccount={countedByAccount}
            notesByAccount={notesByAccount}
            accountTotals={accountTotals}
            applyAdjustments={applyAdjustments}
            onMatchAllSystemBalances={handleMatchAllSystemBalances}
            onChangeCounted={(accountId, value) => {
              setCountedByAccount((prev) => ({ ...prev, [accountId]: value }));
              setDirty(true);
            }}
            onChangeNote={(accountId, value) => {
              setNotesByAccount((prev) => ({ ...prev, [accountId]: value }));
              setDirty(true);
            }}
            onChangeApplyAdjustments={(checked) => {
              setApplyAdjustments(checked);
              setDirty(true);
            }}
          />

          <Card padding="md" className="space-y-3">
            <div>
              <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
                Pendientes automáticos para mañana
              </h3>
              <p className="text-xs sm:text-sm text-bht-ink-soft">
                Resumen vivo de entregas, cobranzas, pagos a proveedores y registros ERP
                por completar.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 text-sm">
              <div className="rounded-xl border border-bht-line bg-bht-paper p-3">
                <span className="block text-xs text-bht-ink-soft">
                  Entregas pendientes
                </span>
                <p className="mt-1 text-lg font-bold text-bht-navy-deep tabular-nums">
                  {draft.pendingItems.deliveriesCount}
                </p>
              </div>
              <div className="rounded-xl border border-bht-line bg-bht-paper p-3">
                <span className="block text-xs text-bht-ink-soft">
                  Cobros vencidos / próximos
                </span>
                <p className="mt-1 text-lg font-bold text-bht-danger tabular-nums">
                  {draft.pendingItems.collectionsCount} ·{" "}
                  {formatPen(draft.pendingItems.collectionsTotalPen)}
                </p>
              </div>
              <div className="rounded-xl border border-bht-line bg-bht-paper p-3">
                <span className="block text-xs text-bht-ink-soft">
                  Pagos CxP ≤ 7 días
                </span>
                <p className="mt-1 text-lg font-bold text-bht-warning tabular-nums">
                  {draft.pendingItems.ap7dCount} ·{" "}
                  {formatPen(draft.pendingItems.ap7dTotalPen)}
                </p>
              </div>
              <div className="rounded-xl border border-bht-line bg-bht-paper p-3">
                <span className="block text-xs text-bht-ink-soft">
                  Pedidos ERP incompletos (24 h)
                </span>
                <p className="mt-1 text-lg font-bold text-bht-ink-strong tabular-nums">
                  {draft.pendingItems.incompleteOrders24h}
                </p>
              </div>
            </div>

            {draft.pendingItems.deliveries.length > 0 && (
              <div className="rounded-xl border border-bht-line bg-bht-paper p-3 space-y-1.5 text-sm">
                <p className="font-semibold text-bht-ink-strong">
                  Entregas abiertas ({draft.pendingItems.deliveriesCount})
                </p>
                {draft.pendingItems.deliveries.map((d) => (
                  <div
                    key={d.orderId}
                    className="flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <span className="font-medium text-bht-ink-strong">
                      {d.orderCode} · {d.customerName}
                    </span>
                    <Badge tone="brand">
                      {formatOperationalStatusEs(d.operationalStatus)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="cierre-next-notes">Notas para mañana</FieldLabel>
                <textarea
                  id="cierre-next-notes"
                  rows={2}
                  value={nextDayNotes}
                  onChange={(e) => {
                    setNextDayNotes(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="Ej. Confirmar depósito BCP primera hora, cobrar a Cliente X..."
                  className={`${INPUT_CLASS} mt-1.5`}
                />
              </div>
              <div>
                <FieldLabel htmlFor="cierre-notes">Observaciones del cierre</FieldLabel>
                <textarea
                  id="cierre-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="Ej. Arqueo conforme con recibos del día."
                  className={`${INPUT_CLASS} mt-1.5`}
                />
              </div>
              {draft.isClosed && (
                <div>
                  <FieldLabel htmlFor="cierre-correction-reason">
                    Motivo de la corrección (obligatorio)
                  </FieldLabel>
                  <textarea
                    id="cierre-correction-reason"
                    rows={2}
                    required
                    value={correctionReason}
                    onChange={(e) => {
                      setCorrectionReason(e.target.value);
                      setDirty(true);
                    }}
                    placeholder="Explica qué dato se corrigió y por qué"
                    className={`${INPUT_CLASS} mt-1.5`}
                  />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <Button type="submit" variant="primary" size="md" disabled={saving}>
                <CheckIcon className="h-4 w-4" />
                {saving
                  ? "Guardando cierre…"
                  : draft.isClosed
                    ? "Actualizar cierre diario"
                    : "Guardar cierre diario"}
              </Button>
            </div>
          </Card>
        </form>
      )}

      {draft && (
        <CajaCierreHistorySection
          closureDate={closureDate}
          corrections={draft.corrections}
          recentClosures={draft.recentClosures}
          onSelectDate={setClosureDate}
        />
      )}
    </div>
  );
}
