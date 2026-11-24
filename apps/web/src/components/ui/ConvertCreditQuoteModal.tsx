"use client";

import { useEffect, useState } from "react";
import type { SellerQuoteDto } from "@/features/seller/types";
import {
  Button,
  INPUT_CLASS,
  ModalSheet,
  SegmentedControl,
} from "@/components/ui/Primitives";

export interface ConvertCreditQuoteOptions {
  initialPaidPen?: number;
  creditDays?: number;
}

interface ConvertCreditQuoteModalProps {
  quote: SellerQuoteDto | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (
    quoteId: number,
    options: ConvertCreditQuoteOptions
  ) => Promise<void> | void;
}

export function ConvertCreditQuoteModal({
  quote,
  busy,
  onClose,
  onConfirm,
}: ConvertCreditQuoteModalProps) {
  const [creditType, setCreditType] = useState<"FULL" | "PARTIAL">("FULL");
  const [initialPaidStr, setInitialPaidStr] = useState("");
  const [creditDaysStr, setCreditDaysStr] = useState("7");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setCreditType("FULL");
    setInitialPaidStr("");
    setCreditDaysStr("7");
    setValidationError(null);
  }, [quote?.quote_id]);

  const totalPen = Number(quote?.total_pen ?? 0);
  const parsedInitial = creditType === "PARTIAL" ? Number(initialPaidStr || 0) : 0;
  const safeInitial =
    Number.isFinite(parsedInitial) && parsedInitial > 0 ? parsedInitial : 0;
  const remainingCreditPen = Math.max(0, totalPen - safeInitial);

  async function handleConfirm() {
    if (!quote || busy) return;
    const days = Number(creditDaysStr);
    if (!Number.isInteger(days) || days < 1 || days > 180) {
      setValidationError("Los días de crédito deben ser un entero entre 1 y 180.");
      return;
    }

    if (creditType === "PARTIAL") {
      if (!Number.isFinite(parsedInitial) || parsedInitial <= 0) {
        setValidationError("Ingresa un monto de abono inicial mayor a S/ 0.00.");
        return;
      }
      if (parsedInitial >= totalPen - 0.005) {
        setValidationError("Usa Convertir Contado para pagar el 100%.");
        return;
      }
    }

    setValidationError(null);
    await onConfirm(quote.quote_id, {
      initialPaidPen: creditType === "PARTIAL" ? Number(parsedInitial.toFixed(2)) : 0,
      creditDays: days,
    });
  }

  return (
    <ModalSheet
      open={Boolean(quote)}
      onClose={busy ? () => {} : onClose}
      title={quote ? `Convertir ${quote.quote_code} a Crédito` : "Convertir a Crédito"}
      subtitle={
        quote ? `${quote.customer_name} · Total S/ ${totalPen.toFixed(2)}` : undefined
      }
      maxWidth="md"
      confirmLabel={busy ? "Convirtiendo..." : "Confirmar Pedido a Crédito"}
      confirmDisabled={busy}
      onConfirm={() => void handleConfirm()}
    >
      {quote && (
        <div className="space-y-4 text-sm">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-bht-ink-muted">
              Modalidad de cobro
            </p>
            <SegmentedControl<"FULL" | "PARTIAL">
              ariaLabel="Modalidad de crédito al convertir cotización"
              value={creditType}
              onChange={(next) => {
                setCreditType(next);
                setValidationError(null);
              }}
              className="w-full"
              options={[
                { id: "FULL", label: "Crédito total" },
                { id: "PARTIAL", label: "Con abono inicial" },
              ]}
            />
          </div>

          {creditType === "PARTIAL" && (
            <div className="space-y-2 rounded-xl border border-bht-line bg-bht-paper p-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-bht-ink-strong">
                  Abono inicial global (S/)
                </span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={Math.max(0.01, totalPen - 0.01).toFixed(2)}
                  value={initialPaidStr}
                  onChange={(e) => {
                    setInitialPaidStr(e.target.value);
                    setValidationError(null);
                  }}
                  placeholder={`Ej. ${(totalPen / 2).toFixed(2)}`}
                  className={INPUT_CLASS}
                />
              </label>
              <div className="space-y-1 text-xs tabular-nums">
                <div className="flex items-center justify-between text-bht-ink-soft">
                  <span>Abono inicial global:</span>
                  <span className="font-semibold text-bht-emerald">
                    S/ {safeInitial.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-bht-ink-strong">
                  <span>Saldo pendiente a crédito:</span>
                  <span className="font-bold">S/ {remainingCreditPen.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-bht-ink-strong">
                Plazo de crédito (días desde {quote.issue_date})
              </span>
              <input
                type="number"
                min="1"
                max="180"
                step="1"
                value={creditDaysStr}
                onChange={(e) => {
                  setCreditDaysStr(e.target.value);
                  setValidationError(null);
                }}
                className={INPUT_CLASS}
              />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[7, 15, 30].map((d) => (
                <Button
                  key={d}
                  type="button"
                  variant={creditDaysStr === String(d) ? "primary" : "outline"}
                  size="sm"
                  data-compact="true"
                  onClick={() => {
                    setCreditDaysStr(String(d));
                    setValidationError(null);
                  }}
                >
                  {d}d
                </Button>
              ))}
            </div>
          </div>

          {validationError && (
            <p className="rounded-lg border border-bht-danger/30 bg-bht-danger-soft px-3 py-2 text-xs font-medium text-bht-danger">
              {validationError}
            </p>
          )}
        </div>
      )}
    </ModalSheet>
  );
}
