"use client";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  FieldLabel,
  INPUT_CLASS,
} from "@/components/ui/Primitives";
import type { DailyClosureDraftResponse } from "@/lib/services/daily-closure";
import { formatDatePe, formatPen } from "../types";
import { formatAccountTypeEs } from "./caja-utils";

interface CajaCierreAccountsTableProps {
  accounts: DailyClosureDraftResponse["accounts"];
  countedByAccount: Record<number, string>;
  notesByAccount: Record<number, string>;
  accountTotals: { expected: number; counted: number; variance: number };
  applyAdjustments: boolean;
  onMatchAllSystemBalances: () => void;
  onChangeCounted: (accountId: number, value: string) => void;
  onChangeNote: (accountId: number, value: string) => void;
  onChangeApplyAdjustments: (checked: boolean) => void;
}

export default function CajaCierreAccountsTable({
  accounts,
  countedByAccount,
  notesByAccount,
  accountTotals,
  applyAdjustments,
  onMatchAllSystemBalances,
  onChangeCounted,
  onChangeNote,
  onChangeApplyAdjustments,
}: CajaCierreAccountsTableProps) {
  return (
    <Card padding="md" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
            Conciliación por cuenta ({accounts.length})
          </h3>
          <p className="text-xs sm:text-sm text-bht-ink-soft">
            Compara el saldo calculado por el sistema contra lo que ves en caja física,
            bancos y billeteras.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onMatchAllSystemBalances}
        >
          Copiar saldos del sistema
        </Button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState title="No hay cuentas activas registradas" />
      ) : (
        <>
          {/* Mobile account cards */}
          <div className="space-y-2.5 md:hidden">
            {accounts.map((acc) => {
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
                      <p className="font-semibold text-bht-ink-strong">{acc.name}</p>
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
                        onChange={(e) => onChangeCounted(acc.accountId, e.target.value)}
                        className={`${INPUT_CLASS} flex-1 font-semibold tabular-nums`}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          onChangeCounted(acc.accountId, acc.systemBalancePen.toFixed(2))
                        }
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
                {accounts.map((acc) => {
                  const countedVal = Number(
                    countedByAccount[acc.accountId] ?? acc.systemBalancePen
                  );
                  const diff = Number.isFinite(countedVal)
                    ? Number((countedVal - acc.systemBalancePen).toFixed(2))
                    : 0;
                  return (
                    <tr key={acc.accountId} className="hover:bg-bht-paper/60">
                      <td className="p-2.5">
                        <p className="font-semibold text-bht-ink-strong">{acc.name}</p>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-bht-ink-muted">
                          <span>{acc.code}</span>
                          <Badge tone="neutral">
                            {formatAccountTypeEs(acc.accountType)}
                          </Badge>
                          {acc.lastReconciledAt && (
                            <span>· Conc.: {formatDatePe(acc.lastReconciledAt)}</span>
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
                            onChange={(e) =>
                              onChangeCounted(acc.accountId, e.target.value)
                            }
                            className={`${INPUT_CLASS} w-32 text-right font-semibold tabular-nums`}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="whitespace-nowrap"
                            onClick={() =>
                              onChangeCounted(
                                acc.accountId,
                                acc.systemBalancePen.toFixed(2)
                              )
                            }
                          >
                            Igualar
                          </Button>
                        </div>
                      </td>
                      <td
                        className={`whitespace-nowrap p-2.5 text-right font-bold tabular-nums ${
                          Math.abs(diff) < 0.01 ? "text-bht-success" : "text-bht-danger"
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
                          onChange={(e) => onChangeNote(acc.accountId, e.target.value)}
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
          onChange={(e) => onChangeApplyAdjustments(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-bht-line text-bht-navy-deep focus:ring-bht-cobalt"
        />
        <span className="space-y-0.5">
          <strong className="block font-semibold text-bht-ink-strong">
            Aplicar ajuste de conciliación en libro de caja para diferencias
          </strong>
          <span className="block text-xs text-bht-ink-soft">
            Opcional. Registra un asiento auditable (CONCILIACION_SALDO) por la
            diferencia de cada cuenta para alinear el saldo en el sistema sin modificar
            ventas ni gastos pasados.
          </span>
        </span>
      </label>
    </Card>
  );
}
