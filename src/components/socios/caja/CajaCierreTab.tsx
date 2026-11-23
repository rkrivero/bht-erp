"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
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
  const [showOptionalCount, setShowOptionalCount] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [showReopenBox, setShowReopenBox] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
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
    let hasAnyCount = false;
    for (const acc of next.accounts) {
      if (acc.countedBalancePen !== null) {
        hasAnyCount = true;
        nextCounts[acc.accountId] = acc.countedBalancePen.toFixed(2);
      } else {
        nextCounts[acc.accountId] = "";
      }
      nextAcctNotes[acc.accountId] = acc.notes ?? "";
    }
    setCountedByAccount(nextCounts);
    setNotesByAccount(nextAcctNotes);
    setShowOptionalCount(hasAnyCount);
    setApplyAdjustments(next.hasAppliedAdjustments);
    setNextDayNotes(next.existingClosure?.nextDayNotes ?? "");
    setNotes(next.existingClosure?.notes ?? "");
    setCorrectionReason("");
    setShowReopenBox(false);
    setReopenReason("");
    setDirty(false);
  }, []);

  const loadAbortRef = useRef<AbortController | null>(null);

  const loadDraft = useCallback(
    async (targetDate: string) => {
      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      setLoading(true);
      try {
        const res = await fetchJson<DailyClosureDraftResponse>(
          `/api/daily-closures?date=${encodeURIComponent(targetDate)}`,
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        setDraft(res);
        hydrateFormFromDraft(res);
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        onFeedback(
          err instanceof ApiClientError
            ? err.message
            : "Error cargando borrador de cierre diario.",
          true
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [hydrateFormFromDraft, onFeedback]
  );

  useEffect(() => {
    void loadDraft(closureDate);
    return () => loadAbortRef.current?.abort();
  }, [closureDate, loadDraft]);

  const accountTotals = useMemo(() => {
    if (!draft) {
      return { expected: 0, counted: null, variance: null, countedCount: 0 };
    }
    let expected = 0;
    let countedSum = 0;
    let countedCount = 0;
    for (const acc of draft.accounts) {
      expected += acc.systemBalancePen;
      const rawStr = (countedByAccount[acc.accountId] ?? "").trim();
      if (rawStr !== "") {
        const parsed = Number(rawStr);
        if (Number.isFinite(parsed)) {
          countedSum += parsed;
          countedCount += 1;
        }
      }
    }
    const allCounted =
      draft.accounts.length > 0 && countedCount === draft.accounts.length;
    const expectedRounded = Number(expected.toFixed(2));
    const countedRounded = allCounted ? Number(countedSum.toFixed(2)) : null;
    return {
      expected: expectedRounded,
      counted: countedRounded,
      variance:
        countedRounded !== null
          ? Number((countedRounded - expectedRounded).toFixed(2))
          : null,
      countedCount,
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

  async function handleReopenDay() {
    if (!draft?.isClosed || reopening) return;
    const reason = reopenReason.trim();
    if (reason.length < 3) {
      onFeedback("Indica el motivo para reabrir el día.", true);
      return;
    }
    setReopening(true);
    try {
      const reopened = await fetchJson<DailyClosureDraftResponse>(
        "/api/daily-closures",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ closureDate, reason }),
        }
      );
      setDraft(reopened);
      hydrateFormFromDraft(reopened);
      notifyLocalSync(["treasury", "partners"]);
      onFeedback(
        `Día ${formatDatePe(closureDate)} reabierto. Ya puedes registrar movimientos en esta fecha.`
      );
      await onRefresh();
    } catch (err) {
      onFeedback(
        err instanceof ApiClientError
          ? err.message
          : "No se pudo reabrir el cierre del día.",
        true
      );
    } finally {
      setReopening(false);
    }
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
      countedBalancePen: number | null;
      notes: string | null;
    }> = [];

    for (const acc of draft.accounts) {
      const rawStr = (countedByAccount[acc.accountId] ?? "").trim();
      let countedBalancePen: number | null = null;
      if (rawStr !== "") {
        const val = Number(rawStr);
        if (!Number.isFinite(val)) {
          onFeedback(`Ingresa un saldo contado válido para ${acc.name}.`, true);
          return;
        }
        countedBalancePen = Number(val.toFixed(2));
      }
      payloadAccounts.push({
        accountId: acc.accountId,
        countedBalancePen,
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
                Cierre del día
              </h3>
              {draft && (
                <Badge tone={draft.isClosed ? "success" : "warning"}>
                  {draft.isClosed ? "Cerrado" : "Pendiente de cierre"}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs sm:text-sm text-bht-ink-soft">
              Confirma el cierre en 1 clic con el resumen del día; si conoces el
              efectivo o saldo bancario exacto, despliega el conteo real opcional.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="cierre-date-input" className="sr-only">
              Fecha de cierre diario
            </label>
            <input
              id="cierre-date-input"
              type="date"
              disabled={saving || reopening}
              value={closureDate}
              onChange={(e) => setClosureDate(e.target.value || todayIso)}
              className={`${INPUT_CLASS} w-auto font-medium tabular-nums disabled:opacity-60`}
            />
            {closureDate !== todayIso && (
              <Button
                variant="outline"
                size="sm"
                disabled={saving || reopening}
                onClick={() => setClosureDate(todayIso)}
              >
                Hoy
              </Button>
            )}
            {draft?.isClosed && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowReopenBox((prev) => !prev)}
              >
                Reabrir día
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

        {draft?.isClosed && showReopenBox && (
          <div className="rounded-xl border border-bht-amber-line bg-bht-amber-bg p-3 space-y-2 text-sm">
            <FieldLabel htmlFor="cierre-reopen-reason">
              Motivo para reabrir {formatDatePe(closureDate)}
            </FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="cierre-reopen-reason"
                type="text"
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="Ej. Faltaba registrar abonos o gastos de hoy"
                className={`${INPUT_CLASS} min-w-[220px] flex-1 bg-white`}
              />
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={reopening}
                onClick={handleReopenDay}
              >
                {reopening ? "Reabriendo…" : "Confirmar reapertura"}
              </Button>
            </div>
          </div>
        )}

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
          <details
            open={showOptionalCount}
            onToggle={(e) => setShowOptionalCount(e.currentTarget.open)}
            className="rounded-2xl border border-bht-line bg-white p-3.5"
          >
            <summary className="cursor-pointer select-none text-sm font-semibold text-bht-navy-deep">
              Conteo real (opcional)
              {accountTotals.countedCount > 0
                ? ` · ${accountTotals.countedCount}/${draft.accounts.length} cuentas ingresadas`
                : " · Solo si conoces el monto exacto"}
            </summary>
            <div className="mt-3">
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
            </div>
          </details>

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
                    ? "Actualizar cierre del día"
                    : "Confirmar cierre del día"}
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
          onSelectDate={(d) => {
            if (!saving && !reopening) setClosureDate(d);
          }}
        />
      )}
    </div>
  );
}
