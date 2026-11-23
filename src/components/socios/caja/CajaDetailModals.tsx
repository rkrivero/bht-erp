"use client";

import { useEffect, useState, type FormEvent } from "react";
import { PlusIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
} from "@/components/ui/Primitives";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import { formatApStatusEs, formatDocTypeEs, normalizeUiNoteEs } from "@/lib/labels-es";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import {
  formatPen,
  type ApObligationItem,
  type CashAccountItem,
  type PurchaseInvoiceLineItem,
  type RecentPurchaseItem,
} from "../types";
export { LedgerMovementDetailModal } from "./CajaLedgerDetailModal";

export function InvoiceLinesBreakdown({
  lines,
  emptyMessage,
}: {
  lines?: PurchaseInvoiceLineItem[];
  emptyMessage: string;
}) {
  const safeLines = Array.isArray(lines) ? lines : [];
  if (safeLines.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-bht-line-strong bg-bht-paper px-3 py-2.5 text-xs text-bht-ink-soft">
        {emptyMessage}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {safeLines.map((ln, idx) => (
        <div
          key={ln.purchase_line_id || `${ln.line_no}-${idx}`}
          className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-bht-line bg-bht-paper px-3 py-2 text-xs"
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-bht-ink-strong">{ln.raw_description}</p>
            <p className="mt-0.5 text-xs text-bht-ink-soft tabular-nums">
              {ln.sku ? `${ln.sku} · ` : ""}
              {Number(ln.quantity)} {ln.unit_of_measure || "NIU"} ×{" "}
              {formatPen(ln.unit_cost_pen)}
            </p>
          </div>
          <span className="flex-shrink-0 font-semibold text-bht-ink-strong tabular-nums">
            {formatPen(ln.line_total_pen)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ApObligationDetailModal({
  obligation,
  onClose,
  onRequestPay,
}: {
  obligation: ApObligationItem | null;
  onClose: () => void;
  onRequestPay: (ap: ApObligationItem) => void;
}) {
  return (
    <ModalSheet
      open={Boolean(obligation)}
      onClose={onClose}
      title={
        obligation
          ? `Detalle de Cuenta por Pagar · ${obligation.doc_ref}`
          : "Detalle de Cuenta por Pagar"
      }
      subtitle={
        obligation
          ? `${obligation.supplier_name}${
              obligation.doc_type ? ` · ${formatDocTypeEs(obligation.doc_type)}` : ""
            }`
          : undefined
      }
      maxWidth="2xl"
    >
      {obligation && (
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 tabular-nums">
            <div className="rounded-xl border border-bht-line bg-bht-paper p-3">
              <span className="block text-xs text-bht-ink-muted">
                Total facturado / pedido
              </span>
              <strong className="mt-0.5 block text-base text-bht-ink-strong">
                {formatPen(obligation.original_amount_pen)}
              </strong>
            </div>
            <div className="rounded-xl border border-bht-line bg-bht-paper p-3">
              <span className="block text-xs text-bht-ink-muted">
                Pagado / amortizado
              </span>
              <strong className="mt-0.5 block text-base text-bht-success">
                {formatPen(obligation.paid_amount_pen)}
              </strong>
            </div>
            <div className="rounded-xl border border-bht-tone-fee2e2 bg-bht-danger-bg/60 p-3">
              <span className="block text-xs text-bht-danger-strong">
                Saldo que se debe
              </span>
              <strong className="mt-0.5 block text-base text-bht-danger">
                {formatPen(obligation.balance_due_pen)}
              </strong>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bht-line bg-white px-3 py-2.5 text-bht-ink-soft tabular-nums">
            <span>
              Emisión:{" "}
              <strong className="text-bht-ink-strong">{obligation.issue_date}</strong>
              {obligation.due_date ? ` · Vence: ${obligation.due_date}` : ""}
            </span>
            <Badge
              tone={
                obligation.status === "PAID"
                  ? "success"
                  : obligation.status === "PARTIAL"
                    ? "warning"
                    : "danger"
              }
            >
              {formatApStatusEs(obligation.status)}
            </Badge>
          </div>

          {obligation.notes && (
            <p className="rounded-xl border border-bht-line bg-bht-paper px-3 py-2 text-xs text-bht-ink-soft">
              Nota: {normalizeUiNoteEs(obligation.notes)}
            </p>
          )}

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-bht-navy-deep">
              Ítems de este comprobante ({obligation.lines?.length ?? 0})
            </p>
            <InvoiceLinesBreakdown
              lines={obligation.lines}
              emptyMessage="Este comprobante no tiene líneas de producto detalladas en el sistema."
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-bht-navy-deep">
              Historial de pagos y abonos
            </p>
            {obligation.payments && obligation.payments.length > 0 ? (
              <div className="space-y-1.5">
                {obligation.payments.map((pay) => (
                  <div
                    key={pay.ledger_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bht-line bg-white px-3 py-2 tabular-nums"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-bht-ink-strong">
                        {pay.description || "Pago a proveedor"}
                      </p>
                      <p className="text-xs text-bht-ink-muted">
                        {pay.tx_date} · {pay.account_name}
                      </p>
                    </div>
                    <span className="font-semibold text-bht-success">
                      {formatPen(pay.amount_pen)}
                    </span>
                  </div>
                ))}
              </div>
            ) : Number(obligation.paid_amount_pen) > 0 ? (
              <p className="rounded-xl border border-bht-warning-line bg-bht-warning-bg px-3 py-2 text-xs text-bht-warning-text tabular-nums">
                Abono previo conciliado por{" "}
                <strong>{formatPen(obligation.paid_amount_pen)}</strong> (saldo
                restante: <strong>{formatPen(obligation.balance_due_pen)}</strong>).
              </p>
            ) : (
              <p className="rounded-xl border border-dashed border-bht-line-strong bg-bht-paper px-3 py-2 text-xs text-bht-ink-soft">
                Aún no se han registrado pagos para este comprobante.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-bht-line pt-3">
            <Button variant="outline" onClick={onClose} className="flex-1">
              Cerrar
            </Button>
            {(obligation.status === "OPEN" || obligation.status === "PARTIAL") &&
              Number(obligation.balance_due_pen) > 0 && (
                <Button
                  variant="success"
                  onClick={() => {
                    onClose();
                    onRequestPay(obligation);
                  }}
                  className="flex-[2]"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Pagar / Amortizar ({formatPen(obligation.balance_due_pen)})
                </Button>
              )}
          </div>
        </div>
      )}
    </ModalSheet>
  );
}

export function ApPaymentModal({
  payingAp,
  accounts,
  defaultAccountId,
  onClose,
  onFeedback,
  onRefresh,
}: {
  payingAp: ApObligationItem | null;
  accounts: CashAccountItem[];
  defaultAccountId: string;
  onClose: () => void;
  onFeedback: (msg: string, isError?: boolean) => void;
  onRefresh: () => Promise<void>;
}) {
  const [amountInput, setAmountInput] = useState("");
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [notes, setNotes] = useState("");
  const [confirmStep, setConfirmStep] = useState(false);
  const [busy, setBusy] = useState(false);

  const payingApId = payingAp?.ap_id ?? null;
  const payingApBalance = payingAp ? Number(payingAp.balance_due_pen) : 0;
  const fallbackAccountId =
    defaultAccountId || (accounts[0] ? String(accounts[0].account_id) : "");

  useEffect(() => {
    if (payingApId === null) return;
    setAmountInput(String(payingApBalance));
    setAccountId(fallbackAccountId);
    setNotes("");
    setConfirmStep(false);
    // Only reset draft when switching the target AP obligation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payingApId]);

  const chosenAccount = accounts.find(
    (account) => String(account.account_id) === (accountId || defaultAccountId)
  );
  const balanceAfter = payingAp
    ? Math.max(0, Number(payingAp.balance_due_pen) - Number(amountInput || 0))
    : 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!payingAp || busy) return;
    const amount = Number(amountInput);
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > Number(payingAp.balance_due_pen) + 0.005
    ) {
      onFeedback(
        "El monto debe ser mayor que cero y no superar el saldo pendiente.",
        true
      );
      return;
    }
    if (!confirmStep) {
      setConfirmStep(true);
      return;
    }
    setBusy(true);
    try {
      const effectiveAcc = accountId || defaultAccountId;
      const res = await fetchJson<{ newBalanceDuePen?: number }>("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pay_ap_obligation",
          apId: payingAp.ap_id,
          amountPen: amount,
          accountId: effectiveAcc ? Number(effectiveAcc) : undefined,
          notes: notes.trim() || undefined,
        }),
      });
      onFeedback(
        `Pago de ${formatPen(amount)} aplicado a ${payingAp.doc_ref} (${payingAp.supplier_name}). Nuevo saldo: ${formatPen(res.newBalanceDuePen ?? 0)}.`
      );
      notifyLocalSync(["purchases", "treasury", "partners"]);
      onClose();
      await onRefresh();
    } catch (err) {
      onFeedback(
        err instanceof ApiClientError
          ? err.message
          : "Error de red al registrar pago de cuenta por pagar.",
        true
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalSheet
      open={Boolean(payingAp)}
      onClose={onClose}
      title="Registrar Pago a Proveedor"
      subtitle={
        payingAp ? `${payingAp.supplier_name} · ${payingAp.doc_ref}` : undefined
      }
    >
      {payingAp && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-xl border border-bht-line bg-bht-paper p-3 text-xs text-bht-ink-soft tabular-nums">
            Original:{" "}
            <strong className="text-bht-ink-strong">
              {formatPen(payingAp.original_amount_pen)}
            </strong>{" "}
            · Saldo pendiente:{" "}
            <strong className="text-bht-danger">
              {formatPen(payingAp.balance_due_pen)}
            </strong>
          </div>

          <div>
            <FieldLabel htmlFor="ap-pay-amount" required>
              Monto a pagar (S/)
            </FieldLabel>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <input
                id="ap-pay-amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  setConfirmStep(false);
                }}
                placeholder="0.00"
                className={`${INPUT_CLASS} min-w-[140px] flex-1 font-semibold tabular-nums`}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setAmountInput(String(Number(payingAp.balance_due_pen)));
                  setConfirmStep(false);
                }}
              >
                Todo ({formatPen(payingAp.balance_due_pen)})
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setAmountInput((Number(payingAp.balance_due_pen) / 2).toFixed(2));
                  setConfirmStep(false);
                }}
              >
                Mitad
              </Button>
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="ap-pay-account" required>
              Cuenta de origen
            </FieldLabel>
            <select
              id="ap-pay-account"
              value={accountId || defaultAccountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                setConfirmStep(false);
              }}
              className={`${INPUT_CLASS} mt-1.5 font-medium`}
            >
              {accounts.map((acc) => (
                <option key={acc.account_id} value={String(acc.account_id)}>
                  {acc.name} ({acc.code})
                  {acc.current_balance_pen !== undefined &&
                  acc.current_balance_pen !== null &&
                  Number.isFinite(Number(acc.current_balance_pen))
                    ? ` · Saldo: ${formatPen(Number(acc.current_balance_pen))}`
                    : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <FieldLabel htmlFor="ap-pay-notes">Nota / N° Operación</FieldLabel>
            <input
              id="ap-pay-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. Transferencia Interbank OP-123"
              className={`${INPUT_CLASS} mt-1.5`}
            />
          </div>

          {confirmStep && (
            <div className="space-y-2 rounded-xl border border-bht-amber-line bg-bht-amber-bg p-3 text-xs text-bht-ink-soft tabular-nums">
              <p className="font-semibold text-bht-ink-strong">
                Revisa el movimiento antes de registrarlo
              </p>
              <p>
                {payingAp.supplier_name} · {payingAp.doc_ref}
              </p>
              <p>
                Sale de: <strong>{chosenAccount?.name ?? "Cuenta seleccionada"}</strong>
              </p>
              <p>
                Pago: <strong>{formatPen(Number(amountInput))}</strong> · Saldo CxP
                después: {formatPen(balanceAfter)}
              </p>
              {chosenAccount?.current_balance_pen !== undefined && (
                <p>
                  Saldo de la cuenta después:{" "}
                  {formatPen(
                    Number(chosenAccount.current_balance_pen) - Number(amountInput || 0)
                  )}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => (confirmStep ? setConfirmStep(false) : onClose())}
              className="flex-1"
            >
              {confirmStep ? "Volver" : "Cancelar"}
            </Button>
            <Button
              type="submit"
              variant="success"
              disabled={busy}
              className="flex-[2]"
            >
              {busy
                ? "Procesando..."
                : confirmStep
                  ? "Confirmar y registrar pago"
                  : "Revisar pago"}
            </Button>
          </div>
        </form>
      )}
    </ModalSheet>
  );
}

export function PurchaseDetailModal({
  purchase,
  onClose,
}: {
  purchase: RecentPurchaseItem | null;
  onClose: () => void;
}) {
  return (
    <ModalSheet
      open={Boolean(purchase)}
      onClose={onClose}
      title={
        purchase
          ? `Detalle de Compra · ${purchase.doc_series}-${purchase.doc_number}`
          : "Detalle de Compra"
      }
      subtitle={
        purchase
          ? `${purchase.supplier_name || purchase.supplier_ruc || "Proveedor"} · ${purchase.issue_date}`
          : undefined
      }
      maxWidth="2xl"
    >
      {purchase && (
        <div className="space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bht-line bg-bht-paper px-3 py-2.5 tabular-nums">
            <span className="text-bht-ink-soft">
              Tipo:{" "}
              <strong className="text-bht-ink-strong">
                {formatDocTypeEs(purchase.doc_type)}
              </strong>
              {purchase.due_date ? ` · Vence: ${purchase.due_date}` : ""}
            </span>
            <span className="font-semibold text-bht-ink-strong">
              Total: {formatPen(purchase.total_pen)}
            </span>
          </div>

          {purchase.raw_notes && (
            <p className="rounded-xl border border-bht-line bg-white px-3 py-2 text-xs text-bht-ink-soft">
              Nota: {normalizeUiNoteEs(purchase.raw_notes)}
            </p>
          )}

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-bht-navy-deep">
              Ítems de la compra ({purchase.lines?.length ?? 0})
            </p>
            <InvoiceLinesBreakdown
              lines={purchase.lines}
              emptyMessage="Esta compra se registró sin líneas individuales."
            />
          </div>

          <div className="flex justify-end border-t border-bht-line pt-3">
            <Button variant="outline" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </div>
      )}
    </ModalSheet>
  );
}
