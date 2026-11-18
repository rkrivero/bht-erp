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
import { formatCashDirectionEs, formatExpenseCategoryEs } from "@/lib/labels-es";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import { formatPen, type CashAccountItem, type CashLedgerEntry } from "../types";
import { LedgerMovementDetailModal } from "./CajaDetailModals";
import { formatAccountTypeEs } from "./caja-utils";

type DirectionFilter = "ALL" | "IN" | "OUT" | "TRANSFER";

export function CajaCuentasTab({
  accounts,
  ledger,
  defaultAccountId,
  onRefresh,
  onFeedback,
  onEditingChange,
}: {
  accounts: CashAccountItem[];
  ledger: CashLedgerEntry[];
  defaultAccountId: string;
  onRefresh: () => Promise<void>;
  onFeedback: (msg: string, isError?: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("ALL");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [detailMovement, setDetailMovement] = useState<CashLedgerEntry | null>(null);

  // Internal transfer modal state
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [fromAccountId, setFromAccountId] = useState(defaultAccountId);
  const [toAccountId, setToAccountId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferDesc, setTransferDesc] = useState("");
  const [confirmStep, setConfirmStep] = useState(false);
  const [busyTransfer, setBusyTransfer] = useState(false);

  useEffect(() => {
    onEditingChange?.(showTransferModal);
    return () => onEditingChange?.(false);
  }, [showTransferModal, onEditingChange]);

  function openTransferModal() {
    const startFrom =
      selectedAccountId !== null
        ? String(selectedAccountId)
        : defaultAccountId || (accounts[0] ? String(accounts[0].account_id) : "");
    const alt = accounts.find((a) => String(a.account_id) !== startFrom);
    setFromAccountId(startFrom);
    setToAccountId(alt ? String(alt.account_id) : "");
    setTransferAmount("");
    setTransferDesc("");
    setConfirmStep(false);
    setShowTransferModal(true);
  }

  const effectiveFromId =
    fromAccountId ||
    defaultAccountId ||
    (accounts[0] ? String(accounts[0].account_id) : "");

  const filteredLedger = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return ledger.filter((mov) => {
      if (selectedAccountId !== null) {
        const chosenAcc = accounts.find((a) => a.account_id === selectedAccountId);
        const matchesId =
          mov.account_id !== undefined && Number(mov.account_id) === selectedAccountId;
        const matchesName = chosenAcc ? mov.account_name === chosenAcc.name : false;
        if (!matchesId && !matchesName) return false;
      }
      if (directionFilter === "TRANSFER") {
        if (!mov.is_internal_transfer) return false;
      } else if (directionFilter === "IN") {
        if (mov.is_internal_transfer || mov.direction !== "IN") return false;
      } else if (directionFilter === "OUT") {
        if (mov.is_internal_transfer || mov.direction !== "OUT") return false;
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
  }, [ledger, accounts, selectedAccountId, directionFilter, deferredSearch]);

  async function handleSaveTransfer(e: FormEvent) {
    e.preventDefault();
    if (busyTransfer) return;
    const amount = Number(transferAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      onFeedback("Ingresa un monto válido mayor a S/ 0.00.", true);
      return;
    }
    if (!effectiveFromId || !toAccountId) {
      onFeedback("Selecciona la cuenta de origen y destino del traslado.", true);
      return;
    }
    if (effectiveFromId === toAccountId) {
      onFeedback("La cuenta de origen y destino deben ser diferentes.", true);
      return;
    }
    if (!transferDesc.trim()) {
      onFeedback("Ingresa una descripción para el traslado.", true);
      return;
    }
    if (!confirmStep) {
      setConfirmStep(true);
      return;
    }

    setBusyTransfer(true);
    try {
      await fetchJson("/api/treasury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isInternalTransfer: true,
          amountPen: amount,
          accountId: Number(effectiveFromId),
          toAccountId: Number(toAccountId),
          description: transferDesc.trim(),
        }),
      });
      onFeedback("Traslado interno registrado (salida e ingreso atómicos).");
      notifyLocalSync(["treasury", "purchases", "partners"]);
      setShowTransferModal(false);
      await onRefresh();
    } catch (err) {
      onFeedback(
        err instanceof ApiClientError
          ? err.message
          : "Error de red al guardar el traslado.",
        true
      );
    } finally {
      setBusyTransfer(false);
    }
  }

  const sourceAccount = accounts.find((a) => String(a.account_id) === effectiveFromId);
  const destAccount = accounts.find((a) => String(a.account_id) === toAccountId);

  return (
    <div className="space-y-4">
      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
              Saldos por Caja, Banco y Custodia
            </h3>
            <p className="text-xs text-bht-ink-soft">
              Toca una cuenta para filtrar sus movimientos en el libro inferior.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedAccountId !== null && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSelectedAccountId(null)}
              >
                <CloseIcon className="h-3.5 w-3.5" />
                Todas las cuentas
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              disabled={accounts.length < 2}
              onClick={openTransferModal}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Traslado entre cuentas
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((acc) => {
            const active = selectedAccountId === acc.account_id;
            return (
              <button
                key={acc.account_id}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setSelectedAccountId((prev) =>
                    prev === acc.account_id ? null : acc.account_id
                  )
                }
                className={`flex items-center justify-between gap-2 rounded-xl border p-3 text-left transition cursor-pointer ${
                  active
                    ? "border-bht-navy-deep bg-bht-mist ring-1 ring-bht-navy-deep"
                    : "border-bht-line bg-white hover:bg-bht-paper"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-bht-ink-strong">
                      {acc.name}
                    </p>
                    <Badge tone="neutral">
                      {formatAccountTypeEs(acc.account_type)}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-bht-ink-muted">{acc.code}</p>
                </div>
                <strong className="flex-shrink-0 text-sm font-bold text-bht-navy-deep tabular-nums">
                  {formatPen(Number(acc.current_balance_pen ?? 0))}
                </strong>
              </button>
            );
          })}
        </div>
      </Card>

      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
              Movimientos de Caja ({filteredLedger.length}
              {filteredLedger.length !== ledger.length ? ` / ${ledger.length}` : ""})
            </h3>
            <p className="text-xs text-bht-ink-soft">
              Toca cualquier movimiento para abrir su ventana de detalle.
            </p>
          </div>
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
              aria-label="Filtrar movimientos de caja"
              placeholder="Buscar por descripción, cuenta, categoría o ruta..."
              className={`${INPUT_CLASS} py-2 pl-10 pr-8 text-xs`}
            />
            {search && (
              <button
                type="button"
                data-compact="true"
                aria-label="Limpiar búsqueda de movimientos"
                onClick={() => setSearch("")}
                className="absolute inset-y-0 right-2.5 flex items-center text-bht-ink-muted hover:text-bht-ink-strong cursor-pointer"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: "ALL", label: "Todos" },
                { id: "IN", label: "Ingresos" },
                { id: "OUT", label: "Salidas" },
                { id: "TRANSFER", label: "Traslados" },
              ] as Array<{ id: DirectionFilter; label: string }>
            ).map((opt) => {
              const active = directionFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDirectionFilter(opt.id)}
                  className={`min-h-[36px] sm:min-h-0 rounded-full border px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                    active
                      ? "border-bht-navy-deep bg-bht-navy-deep text-white"
                      : "border-bht-line bg-white text-bht-ink-soft hover:bg-bht-mist hover:text-bht-navy-deep"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2 md:max-h-[34rem] md:overflow-y-auto md:pr-1">
          {filteredLedger.length === 0 ? (
            <EmptyState
              title="No hay movimientos con este filtro"
              description="Prueba limpiando el filtro de cuenta o el buscador."
            />
          ) : (
            filteredLedger.map((mov) => {
              const isIn = mov.direction === "IN";
              const badgeTone = mov.is_internal_transfer
                ? "brand"
                : isIn
                  ? "success"
                  : "danger";
              return (
                <button
                  key={mov.ledger_id}
                  type="button"
                  onClick={() => setDetailMovement(mov)}
                  className="flex w-full items-start justify-between gap-2.5 rounded-xl border border-bht-line bg-bht-paper/60 p-3 text-left text-xs transition hover:border-bht-line-blue hover:bg-bht-mist/70 cursor-pointer"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={badgeTone}>
                        {formatCashDirectionEs(mov.direction, mov.is_internal_transfer)}
                      </Badge>
                      <span className="font-semibold text-bht-ink-strong">
                        {formatExpenseCategoryEs(mov.expense_category)}
                      </span>
                      <span className="text-xs text-bht-ink-muted">
                        · {mov.account_name} · {mov.tx_date}
                      </span>
                      {mov.trip_code && <Badge tone="horizon">{mov.trip_code}</Badge>}
                    </div>
                    <p className="mt-1 truncate text-xs text-bht-ink-soft">
                      {mov.description}
                    </p>
                  </div>
                  <span
                    className={`flex-shrink-0 font-semibold tabular-nums ${
                      mov.is_internal_transfer
                        ? "text-bht-navy-mid"
                        : isIn
                          ? "text-bht-success"
                          : "text-bht-danger"
                    }`}
                  >
                    {isIn ? "+" : "-"}
                    {formatPen(mov.amount_pen)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </Card>

      <ModalSheet
        open={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        title="Traslado interno entre cuentas"
        subtitle="Mueve efectivo o transferencias entre cuentas propias (OUT + IN atómicos)."
      >
        <form onSubmit={handleSaveTransfer} className="space-y-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="tr-from-account" required>
                Cuenta origen (sale)
              </FieldLabel>
              <select
                id="tr-from-account"
                value={effectiveFromId}
                onChange={(e) => {
                  const nextFrom = e.target.value;
                  setFromAccountId(nextFrom);
                  setConfirmStep(false);
                  if (toAccountId === nextFrom) {
                    const alt = accounts.find((a) => String(a.account_id) !== nextFrom);
                    setToAccountId(alt ? String(alt.account_id) : "");
                  }
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
              <FieldLabel htmlFor="tr-to-account" required>
                Cuenta destino (entra)
              </FieldLabel>
              <select
                id="tr-to-account"
                required
                value={toAccountId}
                onChange={(e) => {
                  setToAccountId(e.target.value);
                  setConfirmStep(false);
                }}
                className={`${INPUT_CLASS} mt-1.5 font-medium`}
              >
                <option value="">-- Elegir cuenta destino --</option>
                {accounts
                  .filter((acc) => String(acc.account_id) !== effectiveFromId)
                  .map((acc) => (
                    <option key={acc.account_id} value={String(acc.account_id)}>
                      {acc.name} · Saldo:{" "}
                      {formatPen(Number(acc.current_balance_pen ?? 0))}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="tr-amount" required>
              Monto a trasladar (S/)
            </FieldLabel>
            <input
              id="tr-amount"
              type="number"
              step="0.01"
              min="0.10"
              required
              value={transferAmount}
              onChange={(e) => {
                setTransferAmount(e.target.value);
                setConfirmStep(false);
              }}
              placeholder="0.00"
              className={`${INPUT_CLASS} mt-1.5 font-semibold tabular-nums`}
            />
          </div>

          <div>
            <FieldLabel htmlFor="tr-desc" required>
              Descripción
            </FieldLabel>
            <input
              id="tr-desc"
              type="text"
              required
              value={transferDesc}
              onChange={(e) => {
                setTransferDesc(e.target.value);
                setConfirmStep(false);
              }}
              placeholder="Ej. Depósito de efectivo de ruta a BCP / entrega a socio"
              className={`${INPUT_CLASS} mt-1.5`}
            />
          </div>

          {Number(transferAmount) > 0 && (
            <div className="space-y-1.5 rounded-xl border border-bht-line-blue bg-bht-mist/70 p-3 text-xs text-bht-ink-soft tabular-nums">
              <p className="font-semibold text-bht-navy-deep">
                {confirmStep ? "Confirma el traslado" : "Resumen del traslado"}
              </p>
              <p>
                Sale de <strong>{sourceAccount?.name ?? "origen"}</strong> y entra a{" "}
                <strong>{destAccount?.name ?? "destino"}</strong> ·{" "}
                {formatPen(Number(transferAmount))}
              </p>
              {sourceAccount?.current_balance_pen != null && (
                <p>
                  Saldo origen después:{" "}
                  {formatPen(
                    Number(sourceAccount.current_balance_pen) - Number(transferAmount)
                  )}
                </p>
              )}
              {destAccount?.current_balance_pen != null && (
                <p>
                  Saldo destino después:{" "}
                  {formatPen(
                    Number(destAccount.current_balance_pen) + Number(transferAmount)
                  )}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() =>
                confirmStep ? setConfirmStep(false) : setShowTransferModal(false)
              }
              className="flex-1"
            >
              {confirmStep ? "Volver" : "Cancelar"}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busyTransfer}
              className="flex-[2]"
            >
              {busyTransfer
                ? "Guardando..."
                : confirmStep
                  ? "Confirmar y registrar traslado"
                  : "Revisar traslado"}
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
