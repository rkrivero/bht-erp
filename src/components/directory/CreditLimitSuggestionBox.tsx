"use client";

import { useState } from "react";
import { Badge, Button } from "@/components/ui/Primitives";
import { formatPen } from "@/components/socios/types";
import { ApiClientError, fetchJson } from "@/lib/api-client";

interface NormalizedCreditSuggestion {
  partyId: number;
  customerName: string;
  currentCreditLimitPen: number | null;
  deliveredOrders6m: number;
  activeMonths6m: number;
  avgMonthlySalesPen: number;
  cvMonthlySales: number;
  avgDaysOverdue: number;
  punctualityFactor: number;
  volatilityFactor: number;
  suggestedCreditLimitPen: number;
  riskTier: string;
}

function normalizeSuggestion(raw: unknown): NormalizedCreditSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const root = raw as Record<string, unknown>;
  const data =
    root.suggestion && typeof root.suggestion === "object"
      ? (root.suggestion as Record<string, unknown>)
      : root;

  const partyId = Number(data.party_id ?? data.partyId ?? 0);
  if (
    !partyId &&
    data.suggested_credit_limit_pen === undefined &&
    data.suggestedCreditLimitPen === undefined
  ) {
    return null;
  }

  return {
    partyId,
    customerName: String(data.customer_name ?? data.customerName ?? ""),
    currentCreditLimitPen:
      data.current_credit_limit_pen !== null &&
      data.current_credit_limit_pen !== undefined
        ? Number(data.current_credit_limit_pen)
        : data.currentCreditLimitPen !== null &&
            data.currentCreditLimitPen !== undefined
          ? Number(data.currentCreditLimitPen)
          : null,
    deliveredOrders6m: Number(data.delivered_orders_6m ?? data.deliveredOrders6m ?? 0),
    activeMonths6m: Number(data.active_months_6m ?? data.activeMonths6m ?? 0),
    avgMonthlySalesPen: Number(
      data.avg_monthly_sales_pen ?? data.avgMonthlySalesPen ?? 0
    ),
    cvMonthlySales: Number(data.cv_monthly_sales ?? data.cvMonthlySales ?? 0),
    avgDaysOverdue: Number(data.avg_days_overdue ?? data.avgDaysOverdue ?? 0),
    punctualityFactor: Number(data.punctuality_factor ?? data.punctualityFactor ?? 1),
    volatilityFactor: Number(data.volatility_factor ?? data.volatilityFactor ?? 1),
    suggestedCreditLimitPen: Number(
      data.suggested_credit_limit_pen ?? data.suggestedCreditLimitPen ?? 0
    ),
    riskTier: String(data.risk_tier ?? data.riskTier ?? "SIN_HISTORIAL"),
  };
}

function riskTierMeta(tier: string): {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
} {
  const upper = tier.toUpperCase();
  if (upper === "LOW" || upper === "BAJO") {
    return { label: "Riesgo bajo", tone: "success" };
  }
  if (upper === "MEDIUM" || upper === "MEDIO" || upper === "MODERATE") {
    return { label: "Riesgo moderado", tone: "warning" };
  }
  if (upper === "HIGH" || upper === "ALTO" || upper === "CRITICAL") {
    return { label: "Riesgo alto", tone: "danger" };
  }
  return { label: tier.replace(/_/g, " "), tone: "neutral" };
}

interface CreditLimitSuggestionBoxProps {
  partyId: number;
  onApplyLimit: (suggestedPen: number) => void;
}

export default function CreditLimitSuggestionBox({
  partyId,
  onApplyLimit,
}: CreditLimitSuggestionBoxProps) {
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<NormalizedCreditSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFetchSuggestion() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson<Record<string, unknown>>(
        `/api/customers?action=credit_suggestion&party_id=${encodeURIComponent(
          String(partyId)
        )}`,
        { cache: "no-store" }
      );
      const parsed = normalizeSuggestion(res);
      if (!parsed) {
        setError(
          "No se encontró historial suficiente para calcular una línea sugerida."
        );
      } else {
        setSuggestion(parsed);
      }
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "No se pudo consultar la sugerencia cuantitativa de crédito."
      );
    } finally {
      setLoading(false);
    }
  }

  const tier = suggestion ? riskTierMeta(suggestion.riskTier) : null;
  const combinedFactor = suggestion
    ? Number((suggestion.punctualityFactor * suggestion.volatilityFactor).toFixed(2))
    : 0;

  return (
    <div className="space-y-2.5 rounded-xl border border-bht-line-blue bg-bht-surface-cool p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-bht-navy-deep">
            Evaluación cuantitativa de línea de crédito (6 meses)
          </p>
          <p className="text-xs text-bht-ink-soft">
            Calcula venta mensual, mora promedio, volatilidad (CV) y factores Fp × Fv.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void handleFetchSuggestion()}
        >
          {loading
            ? "Calculando..."
            : suggestion
              ? "Recalcular historial"
              : "Sugerir según historial"}
        </Button>
      </div>

      {error && (
        <p className="rounded-lg bg-bht-danger-bg px-2.5 py-1.5 text-xs font-medium text-bht-danger-strong">
          {error}
        </p>
      )}

      {suggestion && tier && (
        <div className="space-y-2.5 rounded-lg border border-bht-line bg-white p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={tier.tone}>{tier.label}</Badge>
              <span className="text-bht-ink-soft tabular-nums">
                {suggestion.deliveredOrders6m} pedido(s) en {suggestion.activeMonths6m}{" "}
                mes(es) activos
              </span>
            </div>
            <strong className="text-sm font-bold text-bht-navy-deep tabular-nums">
              Sugerido: {formatPen(suggestion.suggestedCreditLimitPen)}
            </strong>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 tabular-nums">
            <div className="rounded-lg bg-bht-paper px-2.5 py-1.5">
              <span className="block text-[11px] text-bht-ink-soft">
                Venta mensual prom.
              </span>
              <strong className="text-bht-ink-strong">
                {formatPen(suggestion.avgMonthlySalesPen)}
              </strong>
            </div>
            <div className="rounded-lg bg-bht-paper px-2.5 py-1.5">
              <span className="block text-[11px] text-bht-ink-soft">Mora promedio</span>
              <strong className="text-bht-ink-strong">
                {suggestion.avgDaysOverdue.toFixed(1)} días
              </strong>
            </div>
            <div className="rounded-lg bg-bht-paper px-2.5 py-1.5">
              <span className="block text-[11px] text-bht-ink-soft">
                Coef. variación (CV)
              </span>
              <strong className="text-bht-ink-strong">
                {suggestion.cvMonthlySales.toFixed(2)}
              </strong>
            </div>
            <div className="rounded-lg bg-bht-paper px-2.5 py-1.5">
              <span className="block text-[11px] text-bht-ink-soft">
                Factores Fp × Fv
              </span>
              <strong className="text-bht-ink-strong">
                {suggestion.punctualityFactor.toFixed(2)} ×{" "}
                {suggestion.volatilityFactor.toFixed(2)} ({combinedFactor})
              </strong>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => onApplyLimit(suggestion.suggestedCreditLimitPen)}
            >
              Aplicar {formatPen(suggestion.suggestedCreditLimitPen)} al formulario
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
