"use client";

import { useDeferredValue, useEffect, useMemo, useState, type FormEvent } from "react";
import { CloseIcon, PlusIcon, SearchIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
} from "@/components/ui/Primitives";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import type { RouteTripDto } from "@/lib/contracts";
import { formatExpenseCategoryEs } from "@/lib/labels-es";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import {
  OUTFLOW_CATEGORIES_BY_BUCKET,
  type OutflowBucket,
} from "@/lib/treasury-constants";
import { formatPen, type CashAccountItem, type CashLedgerEntry } from "../types";
import { LedgerMovementDetailModal } from "./CajaDetailModals";
import { getTodayLimaIso, isExpenseLedgerEntry } from "./caja-utils";

type ExpenseBucketFilter = "ALL" | "ROUTE_OPEX" | "NON_OPEX_OR_CAPEX";

export function CajaGastosTab({
  accounts,
  ledger,
  routeTrips,
  defaultAccountId,
  onRefresh,
  onFeedback,
  onEditingChange,
}: {
  accounts: CashAccountItem[];
  ledger: CashLedgerEntry[];
  routeTrips: RouteTripDto[];
  defaultAccountId: string;
  onRefresh: () => Promise<void>;
  onFeedback: (msg: string, isError?: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [bucketFilter, setBucketFilter] = useState<ExpenseBucketFilter>("ALL");
  const [accountFilterId, setAccountFilterId] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [detailMovement, setDetailMovement] = useState<CashLedgerEntry | null>(null);

  // Modal state
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [bucket, setBucket] = useState<OutflowBucket>("ROUTE_OPEX");
  const [category, setCategory] = useState<string>(
    OUTFLOW_CATEGORIES_BY_BUCKET.ROUTE_OPEX[0].value
  );
  const [txDate, setTxDate] = useState(getTodayLimaIso());
  const [tripId, setTripId] = useState("");
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [amountInput, setAmountInput] = useState("");
  const [description, setDescription] = useState("");
  const [confirmStep, setConfirmStep] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onEditingChange?.(showExpenseModal);
    return () => onEditingChange?.(false);
  }, [showExpenseModal, onEditingChange]);

  const effectiveAccountId =
    accountId ||
    defaultAccountId ||
    (accounts[0] ? String(accounts[0].account_id) : "");

  const expenseEntries = useMemo(() => ledger.filter(isExpenseLedgerEntry), [ledger]);

  const routeOpexTotal = useMemo(
    () =>
      expenseEntries
        .filter((e) => e.expense_bucket === "ROUTE_OPEX")
        .reduce((s, e) => s + Number(e.amount_pen || 0), 0),
    [expenseEntries]
  );

  const nonOpexTotal = useMemo(
    () =>
      expenseEntries
        .filter((e) => e.expense_bucket === "NON_OPEX_OR_CAPEX")
        .reduce((s, e) => s + Number(e.amount_pen || 0), 0),
    [expenseEntries]
  );

  const filteredExpenses = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return expenseEntries.filter((mov) => {
      if (bucketFilter !== "ALL" && mov.expense_bucket !== bucketFilter) {
        return false;
      }
      if (accountFilterId) {
        const chosenAcc = accounts.find(
          (a) => String(a.account_id) === accountFilterId
        );
        const matchesId =
          mov.account_id !== undefined && String(mov.account_id) === accountFilterId;
        const matchesName = chosenAcc ? mov.account_name === chosenAcc.name : false;
        if (!matchesId && !matchesName) return false;
      }
      if (!q) return true;
      const cat = formatExpenseCategoryEs(mov.expense_category).toLowerCase();
      return (
        mov.description.toLowerCase().includes(q) ||
        mov.account_name.toLowerCase().includes(q) ||
        cat.includes(q) ||
        mov.tx_date.toLowerCase().includes(q) ||
        (mov.trip_code ? mov.trip_code.toLowerCase().includes(q) : false)
      );
    });
  }, [expenseEntries, bucketFilter, accountFilterId, accounts, deferredSearch]);

  function openNewExpenseModal(initialBucket: OutflowBucket = "ROUTE_OPEX") {
    setBucket(initialBucket);
    setCategory(OUTFLOW_CATEGORIES_BY_BUCKET[initialBucket][0].value);
    setTxDate(getTodayLimaIso());
    setTripId("");
    setAccountId(
      defaultAccountId || (accounts[0] ? String(accounts[0].account_id) : "")
    );
    setAmountInput("");
    setDescription("");
    setConfirmStep(false);
    setShowExpenseModal(true);
  }

  async function handleSubmitExpense(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      onFeedback("Ingresa un monto válido mayor que cero.", true);
      return;
    }
    if (!description.trim()) {
      onFeedback("Ingresa una descripción detallada.", true);
      return;
    }
    if (!confirmStep) {
      setConfirmStep(true);
      return;
    }
    setBusy(true);
    try {
      await fetchJson("/api/treasury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isInternalTransfer: false,
          amountPen: amount,
          expenseBucket: bucket,
          expenseCategory: category,
          txDate: bucket === "ROUTE_OPEX" ? txDate : undefined,
          accountId: effectiveAccountId ? Number(effectiveAccountId) : undefined,
          tripId: bucket === "ROUTE_OPEX" && tripId ? Number(tripId) : undefined,
          description: description.trim(),
        }),
      });
      onFeedback("Egreso registrado correctamente en Caja.");
      notifyLocalSync(["treasury", "purchases", "partners"]);
      setShowExpenseModal(false);
      await onRefresh();
    } catch (err) {
      onFeedback(
        err instanceof ApiClientError
          ? err.message
          : "Error de red al guardar movimiento de gasto.",
        true
      );
    } finally {
      setBusy(false);
    }
  }

  const chosenAccount = accounts.find(
    (a) => String(a.account_id) === effectiveAccountId
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card padding="md">
          <span className="text-xs font-medium text-bht-ink-soft">
            Gastos operativos de ruta (recientes)
          </span>
          <p className="mt-1 text-xl font-bold text-bht-navy-deep tabular-nums">
            {formatPen(routeOpexTotal)}
          </p>
        </Card>
        <Card padding="md">
          <span className="text-xs font-medium text-bht-ink-soft">
            Retiros y gastos no operativos (recientes)
          </span>
          <p className="mt-1 text-xl font-bold text-bht-warning tabular-nums">
            {formatPen(nonOpexTotal)}
          </p>
        </Card>
        <Card
          padding="md"
          className="flex items-center justify-between gap-3 sm:col-span-2 lg:col-span-1"
        >
          <div className="min-w-0">
            <span className="block text-xs font-medium text-bht-ink-strong">
              Registrar salida de caja
            </span>
            <span className="text-[11px] text-bht-ink-soft">
              Ruta diaria, viáticos o retiro
            </span>
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={() => openNewExpenseModal("ROUTE_OPEX")}
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Registrar Gasto
          </Button>
        </Card>
      </div>

      <Card padding="md" className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
            Historial de Gastos y Retiros ({filteredExpenses.length})
          </h3>
          <p className="text-xs text-bht-ink-soft">
            Toca cualquier gasto para ver su ventana de detalle, cuenta y ruta
            vinculada.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-bht-ink-muted">
              <SearchIcon className="h-4 w-4" />
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Filtrar gastos y retiros"
              placeholder="Buscar gasto por descripción, categoría, cuenta o ruta..."
              className={`${INPUT_CLASS} py-2 pl-10 pr-8 text-xs`}
            />
            {search && (
              <button
                type="button"
                data-compact="true"
                aria-label="Limpiar búsqueda de gastos"
                onClick={() => setSearch("")}
                className="absolute inset-y-0 right-2.5 flex items-center text-bht-ink-muted hover:text-bht-ink-strong cursor-pointer"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <select
            aria-label="Filtrar gastos por cuenta"
            value={accountFilterId}
            onChange={(e) => setAccountFilterId(e.target.value)}
            className={`${INPUT_CLASS} w-auto py-2 text-xs font-medium`}
          >
            <option value="">Todas las cuentas</option>
            {accounts.map((acc) => (
              <option key={acc.account_id} value={String(acc.account_id)}>
                {acc.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: "ALL", label: "Todos" },
              { id: "ROUTE_OPEX", label: "Ruta (OpEx)" },
              { id: "NON_OPEX_OR_CAPEX", label: "Retiros / No Op." },
            ] as Array<{ id: ExpenseBucketFilter; label: string }>
          ).map((f) => {
            const active = bucketFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                onClick={() => setBucketFilter(f.id)}
                className={`min-h-[36px] sm:min-h-0 rounded-full border px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                  active
                    ? "border-bht-navy-deep bg-bht-navy-deep text-white"
                    : "border-bht-line bg-white text-bht-ink-soft hover:bg-bht-mist hover:text-bht-navy-deep"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="space-y-2 md:max-h-[34rem] md:overflow-y-auto md:pr-1">
          {filteredExpenses.length === 0 ? (
            <EmptyState
              title="No hay gastos con este filtro"
              description="Registra un gasto de ruta o retira el filtro actual."
            />
          ) : (
            filteredExpenses.map((mov) => (
              <button
                key={mov.ledger_id}
                type="button"
                onClick={() => setDetailMovement(mov)}
                className="flex w-full items-start justify-between gap-2.5 rounded-xl border border-bht-line bg-bht-paper/60 p-3 text-left text-xs transition hover:border-bht-line-blue hover:bg-bht-mist/70 cursor-pointer"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      tone={mov.expense_bucket === "ROUTE_OPEX" ? "horizon" : "warning"}
                    >
                      {mov.expense_bucket === "ROUTE_OPEX"
                        ? "Ruta OpEx"
                        : "No Op. / Retiro"}
                    </Badge>
                    <span className="font-semibold text-bht-ink-strong">
                      {formatExpenseCategoryEs(mov.expense_category)}
                    </span>
                    <span className="text-xs text-bht-ink-muted">
                      · {mov.account_name} · {mov.tx_date}
                    </span>
                    {mov.trip_code && <Badge tone="brand">{mov.trip_code}</Badge>}
                  </div>
                  <p className="mt-1 truncate text-xs text-bht-ink-soft">
                    {mov.description}
                  </p>
                </div>
                <span className="flex-shrink-0 font-semibold text-bht-danger tabular-nums">
                  -{formatPen(mov.amount_pen)}
                </span>
              </button>
            ))
          )}
        </div>
      </Card>

      <ModalSheet
        open={showExpenseModal}
        onClose={() => setShowExpenseModal(false)}
        maxWidth="lg"
        title={
          bucket === "ROUTE_OPEX"
            ? "Registrar Gasto Operativo"
            : "Registrar Retiro / Egreso No Operativo"
        }
        subtitle="El movimiento descontará de la cuenta seleccionada en tiempo real."
      >
        <form onSubmit={handleSubmitExpense} className="space-y-3.5">
          <div>
            <FieldLabel htmlFor="exp-bucket">Tipo de salida</FieldLabel>
            <select
              id="exp-bucket"
              value={bucket}
              onChange={(e) => {
                const nextBucket = e.target.value as OutflowBucket;
                setBucket(nextBucket);
                setConfirmStep(false);
                setCategory(
                  OUTFLOW_CATEGORIES_BY_BUCKET[nextBucket]?.[0]?.value ?? "COMBUSTIBLE"
                );
              }}
              className={`${INPUT_CLASS} mt-1.5 font-medium`}
            >
              <option value="ROUTE_OPEX">Gasto Operativo de Ruta</option>
              <option value="NON_OPEX_OR_CAPEX">
                Retiro (Socio / Gerencia) / No Operativo
              </option>
            </select>
          </div>

          {bucket === "ROUTE_OPEX" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="exp-date" required>
                  Fecha del gasto
                </FieldLabel>
                <input
                  id="exp-date"
                  type="date"
                  required
                  value={txDate}
                  onChange={(e) => {
                    setTxDate(e.target.value);
                    setConfirmStep(false);
                  }}
                  className={`${INPUT_CLASS} mt-1.5 font-medium`}
                />
              </div>

              {routeTrips.length > 0 && (
                <div>
                  <FieldLabel htmlFor="exp-trip">Ruta / Viaje (opcional)</FieldLabel>
                  <select
                    id="exp-trip"
                    value={tripId}
                    onChange={(e) => {
                      setTripId(e.target.value);
                      setConfirmStep(false);
                    }}
                    className={`${INPUT_CLASS} mt-1.5 font-medium`}
                  >
                    <option value="">-- Sin ruta específica --</option>
                    {routeTrips.map((rt) => (
                      <option key={rt.trip_id} value={String(rt.trip_id)}>
                        {rt.trip_code} ({rt.zone_name || "Ruta"} · {rt.trip_date})
                        {rt.status === "OPEN" ? " · Abierta" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="exp-account">Cuenta de caja / banco</FieldLabel>
              <select
                id="exp-account"
                value={effectiveAccountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  setConfirmStep(false);
                }}
                className={`${INPUT_CLASS} mt-1.5 font-medium`}
              >
                {accounts.map((acc) => (
                  <option key={acc.account_id} value={String(acc.account_id)}>
                    {acc.name} · Saldo:{" "}
                    {formatPen(Number(acc.current_balance_pen ?? 0))}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel htmlFor="exp-category" required>
                Categoría
              </FieldLabel>
              <select
                id="exp-category"
                required
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setConfirmStep(false);
                }}
                className={`${INPUT_CLASS} mt-1.5 font-medium`}
              >
                {OUTFLOW_CATEGORIES_BY_BUCKET[bucket].map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="exp-amount" required>
              Monto en Soles (S/)
            </FieldLabel>
            <input
              id="exp-amount"
              type="number"
              step="0.01"
              min="0.10"
              required
              value={amountInput}
              onChange={(e) => {
                setAmountInput(e.target.value);
                setConfirmStep(false);
              }}
              placeholder="0.00"
              className={`${INPUT_CLASS} mt-1.5 font-semibold tabular-nums`}
            />
          </div>

          <div>
            <FieldLabel htmlFor="exp-desc" required>
              Descripción detallada
            </FieldLabel>
            <input
              id="exp-desc"
              type="text"
              required
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setConfirmStep(false);
              }}
              placeholder="Ej. Combustible grifo KM 110 / almuerzo / retiro socio"
              className={`${INPUT_CLASS} mt-1.5`}
            />
          </div>

          {Number(amountInput) > 0 && (
            <div className="space-y-1.5 rounded-xl border border-bht-line-blue bg-bht-mist/70 p-3 text-xs text-bht-ink-soft tabular-nums">
              <p className="font-semibold text-bht-navy-deep">
                {confirmStep ? "Confirma el gasto" : "Resumen del movimiento"}
              </p>
              <p>
                Sale de <strong>{chosenAccount?.name ?? "cuenta"}</strong> ·{" "}
                {formatExpenseCategoryEs(category)} · {formatPen(Number(amountInput))}
              </p>
              {chosenAccount?.current_balance_pen != null && (
                <p>
                  Saldo de la cuenta después:{" "}
                  {formatPen(
                    Number(chosenAccount.current_balance_pen) - Number(amountInput)
                  )}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() =>
                confirmStep ? setConfirmStep(false) : setShowExpenseModal(false)
              }
              className="flex-1"
            >
              {confirmStep ? "Volver" : "Cancelar"}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busy}
              className="flex-[2]"
            >
              {busy
                ? "Guardando..."
                : confirmStep
                  ? "Confirmar y registrar"
                  : "Revisar gasto"}
            </Button>
          </div>
        </form>
      </ModalSheet>

      <LedgerMovementDetailModal
        movement={detailMovement}
        onClose={() => setDetailMovement(null)}
      />
    </div>
  );
}
