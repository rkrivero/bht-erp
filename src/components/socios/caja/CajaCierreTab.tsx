"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FieldLabel,
  INPUT_CLASS,
} from "@/components/ui/Primitives";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import { formatOperationalStatusEs } from "@/lib/labels-es";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import type { DailyClosureDraftResponse } from "@/lib/services/daily-closure";
import { formatDatePe, formatPen } from "../types";
import { formatAccountTypeEs, getTodayLimaIso } from "./caja-utils";

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
          <Card padding="md" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
                  Conciliación por cuenta ({draft.accounts.length})
                </h3>
                <p className="text-xs sm:text-sm text-bht-ink-soft">
                  Compara el saldo calculado por el sistema contra lo que ves en caja
                  física, bancos y billeteras.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleMatchAllSystemBalances}
              >
                Copiar saldos del sistema
              </Button>
            </div>

            {draft.accounts.length === 0 ? (
              <EmptyState title="No hay cuentas activas registradas" />
            ) : (
              <>
                {/* Mobile account cards */}
                <div className="space-y-2.5 md:hidden">
                  {draft.accounts.map((acc) => {
                    const countedVal = Number(
                      countedByAccount[acc.accountId] ?? acc.systemBalancePen
                    );
                    const diff = Number.isFinite(countedVal)
                      ? Number((countedVal - acc.systemBalancePen).toFixed(2))
                      : 0;
                    const diffClass =
                      Math.abs(diff) < 0.01 ? "text-bht-success" : "text-bht-danger";
                    return (
                      <div
                        key={acc.accountId}
                        className="rounded-xl border border-bht-line bg-bht-paper p-3 space-y-2 text-sm"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-bht-ink-strong">
                              {acc.name}
                            </p>
                            <span className="text-xs text-bht-ink-muted">
                              {acc.code} · {formatAccountTypeEs(acc.accountType)}
                            </span>
                          </div>
                          <span className={`font-bold tabular-nums ${diffClass}`}>
                            {diff >= 0 ? "+" : ""}
                            {formatPen(diff)}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
                          <div>
                            <span className="text-bht-ink-soft">Saldo sistema:</span>
                            <p className="font-semibold text-bht-ink-strong">
                              {formatPen(acc.systemBalancePen)}
                            </p>
                          </div>
                          <div>
                            <span className="text-bht-ink-soft">Mov. del día:</span>
                            <p className="text-bht-ink-strong">
                              +{formatPen(acc.dayInPen)} / -{formatPen(acc.dayOutPen)}
                            </p>
                          </div>
                        </div>
                        <div>
                          <FieldLabel htmlFor={`m-cnt-${acc.accountId}`}>
                            Saldo contado / extracto (S/)
                          </FieldLabel>
                          <div className="mt-1 flex items-center gap-2">
                            <input
                              id={`m-cnt-${acc.accountId}`}
                              type="number"
                              step="0.01"
                              value={countedByAccount[acc.accountId] ?? ""}
                              onChange={(e) => {
                                setCountedByAccount((prev) => ({
                                  ...prev,
                                  [acc.accountId]: e.target.value,
                                }));
                                setDirty(true);
                              }}
                              className={`${INPUT_CLASS} flex-1 font-semibold tabular-nums`}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setCountedByAccount((prev) => ({
                                  ...prev,
                                  [acc.accountId]: acc.systemBalancePen.toFixed(2),
                                }));
                                setDirty(true);
                              }}
                            >
                              Igualar
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop reconciliation table */}
                <div className="table-wrapper hidden md:block">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-bht-line bg-bht-paper text-xs font-semibold uppercase tracking-wide text-bht-ink-soft">
                      <tr>
                        <th scope="col" className="p-2.5">
                          Cuenta
                        </th>
                        <th scope="col" className="p-2.5 text-right">
                          Saldo sistema
                        </th>
                        <th scope="col" className="p-2.5 text-right">
                          Mov. día (+ / -)
                        </th>
                        <th scope="col" className="p-2.5 text-right">
                          Contado / extracto (S/)
                        </th>
                        <th scope="col" className="whitespace-nowrap p-2.5 text-right">
                          Dif. (S/)
                        </th>
                        <th scope="col" className="p-2.5">
                          Observación
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-bht-line">
                      {draft.accounts.map((acc) => {
                        const countedVal = Number(
                          countedByAccount[acc.accountId] ?? acc.systemBalancePen
                        );
                        const diff = Number.isFinite(countedVal)
                          ? Number((countedVal - acc.systemBalancePen).toFixed(2))
                          : 0;
                        return (
                          <tr key={acc.accountId} className="hover:bg-bht-paper/60">
                            <td className="p-2.5">
                              <p className="font-semibold text-bht-ink-strong">
                                {acc.name}
                              </p>
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-bht-ink-muted">
                                <span>{acc.code}</span>
                                <Badge tone="neutral">
                                  {formatAccountTypeEs(acc.accountType)}
                                </Badge>
                                {acc.lastReconciledAt && (
                                  <span>
                                    · Conc.: {formatDatePe(acc.lastReconciledAt)}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="whitespace-nowrap p-2.5 text-right font-semibold text-bht-ink-strong tabular-nums">
                              {formatPen(acc.systemBalancePen)}
                            </td>
                            <td className="whitespace-nowrap p-2.5 text-right text-xs text-bht-ink-soft tabular-nums">
                              +{formatPen(acc.dayInPen)} / -{formatPen(acc.dayOutPen)}
                            </td>
                            <td className="p-2.5 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <input
                                  aria-label={`Saldo contado para ${acc.name}`}
                                  type="number"
                                  step="0.01"
                                  value={countedByAccount[acc.accountId] ?? ""}
                                  onChange={(e) => {
                                    setCountedByAccount((prev) => ({
                                      ...prev,
                                      [acc.accountId]: e.target.value,
                                    }));
                                    setDirty(true);
                                  }}
                                  className={`${INPUT_CLASS} w-32 text-right font-semibold tabular-nums`}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="whitespace-nowrap"
                                  onClick={() => {
                                    setCountedByAccount((prev) => ({
                                      ...prev,
                                      [acc.accountId]: acc.systemBalancePen.toFixed(2),
                                    }));
                                    setDirty(true);
                                  }}
                                >
                                  Igualar
                                </Button>
                              </div>
                            </td>
                            <td
                              className={`whitespace-nowrap p-2.5 text-right font-bold tabular-nums ${
                                Math.abs(diff) < 0.01
                                  ? "text-bht-success"
                                  : "text-bht-danger"
                              }`}
                            >
                              {diff >= 0 ? "+" : ""}
                              {formatPen(diff)}
                            </td>
                            <td className="p-2.5">
                              <input
                                aria-label={`Nota de conciliación para ${acc.name}`}
                                type="text"
                                value={notesByAccount[acc.accountId] ?? ""}
                                onChange={(e) => {
                                  setNotesByAccount((prev) => ({
                                    ...prev,
                                    [acc.accountId]: e.target.value,
                                  }));
                                  setDirty(true);
                                }}
                                placeholder="Opcional"
                                className={`${INPUT_CLASS} min-w-[140px]`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="grid grid-cols-1 gap-2 rounded-xl border border-bht-line-blue bg-bht-mist/70 p-3 text-sm sm:grid-cols-3 tabular-nums">
              <div>
                <span className="text-xs text-bht-ink-soft">Esperado sistema</span>
                <p className="font-bold text-bht-navy-deep">
                  {formatPen(accountTotals.expected)}
                </p>
              </div>
              <div>
                <span className="text-xs text-bht-ink-soft">Contado confirmado</span>
                <p className="font-bold text-bht-ink-strong">
                  {formatPen(accountTotals.counted)}
                </p>
              </div>
              <div>
                <span className="text-xs text-bht-ink-soft">Diferencia total</span>
                <p
                  className={`font-bold ${
                    Math.abs(accountTotals.variance) < 0.01
                      ? "text-bht-success"
                      : "text-bht-danger"
                  }`}
                >
                  {accountTotals.variance >= 0 ? "+" : ""}
                  {formatPen(accountTotals.variance)}
                </p>
              </div>
            </div>

            <label className="flex items-start gap-2.5 rounded-xl border border-bht-line bg-bht-paper p-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={applyAdjustments}
                onChange={(e) => {
                  setApplyAdjustments(e.target.checked);
                  setDirty(true);
                }}
                className="mt-1 h-4 w-4 rounded border-bht-line text-bht-navy-deep focus:ring-bht-cobalt"
              />
              <span className="space-y-0.5">
                <strong className="block font-semibold text-bht-ink-strong">
                  Aplicar ajuste de conciliación en libro de caja para diferencias
                </strong>
                <span className="block text-xs text-bht-ink-soft">
                  Opcional. Registra un asiento auditable (CONCILIACION_SALDO) por la
                  diferencia de cada cuenta para alinear el saldo en el sistema sin
                  modificar ventas ni gastos pasados.
                </span>
              </span>
            </label>
          </Card>

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

      {draft && draft.corrections.length > 0 && (
        <Card padding="md" className="space-y-3">
          <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
            Historial de correcciones
          </h3>
          <div className="space-y-2">
            {draft.corrections.map((item) => (
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

      {draft && draft.recentClosures.length > 0 && (
        <Card padding="md" className="space-y-3">
          <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
            Cierres recientes ({draft.recentClosures.length})
          </h3>
          <div className="space-y-2">
            {draft.recentClosures.map((c) => (
              <button
                key={c.closureId}
                type="button"
                onClick={() => setClosureDate(c.closureDate)}
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
    </div>
  );
}
