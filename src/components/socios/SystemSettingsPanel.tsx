"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  Card,
  FieldLabel,
  INPUT_CLASS,
} from "@/components/ui/Primitives";
import { SkeletonCards } from "@/components/ui/Skeleton";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";

interface SystemSettingsForm {
  company_name: string;
  company_ruc: string;
  undo_window_minutes: string;
  default_credit_days: string;
  credit_limit_mode: string;
  min_margin_pct: string;
  route_opex_alert_pct: string;
  drain_alert_pct: string;
  kpi_cutoff_date: string;
}

const DEFAULT_FORM: SystemSettingsForm = {
  company_name: "Blue Horizon Trade",
  company_ruc: "",
  undo_window_minutes: "15",
  default_credit_days: "7",
  credit_limit_mode: "APPROVAL_GATE",
  min_margin_pct: "20",
  route_opex_alert_pct: "8",
  drain_alert_pct: "30",
  kpi_cutoff_date: "2026-06-26",
};

function extractSettingsMap(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const record = payload as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const applyRow = (row: unknown) => {
    if (!row || typeof row !== "object") return;
    const r = row as Record<string, unknown>;
    const key = String(r.setting_key ?? r.settingKey ?? r.key ?? "").trim();
    if (!key) return;
    const val =
      r.value_json !== undefined
        ? r.value_json
        : r.valueJson !== undefined
          ? r.valueJson
          : r.value;
    out[key] = val;
  };

  if (record.values && typeof record.values === "object") {
    for (const [k, v] of Object.entries(record.values as Record<string, unknown>)) {
      out[k] = v;
    }
  }

  if (Array.isArray(record.settings)) {
    record.settings.forEach(applyRow);
  } else if (record.settings && typeof record.settings === "object") {
    for (const [k, v] of Object.entries(record.settings as Record<string, unknown>)) {
      if (v && typeof v === "object" && ("value_json" in v || "value" in v)) {
        applyRow({ setting_key: k, ...(v as Record<string, unknown>) });
      } else {
        out[k] = v;
      }
    }
  }

  if (Array.isArray(record.items)) {
    record.items.forEach(applyRow);
  }

  for (const key of Object.keys(DEFAULT_FORM)) {
    if (record[key] !== undefined && out[key] === undefined) {
      out[key] = record[key];
    }
  }
  return out;
}

interface SystemSettingsPanelProps {
  onRefreshDashboard?: () => Promise<void>;
  onFeedback: (message: string, isError?: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
}

export default function SystemSettingsPanel({
  onRefreshDashboard,
  onFeedback,
  onEditingChange,
}: SystemSettingsPanelProps) {
  const [form, setForm] = useState<SystemSettingsForm>(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    onEditingChange?.(dirty);
    return () => onEditingChange?.(false);
  }, [dirty, onEditingChange]);

  const hydrateFromMap = useCallback((map: Record<string, unknown>) => {
    setForm({
      company_name: String(map.company_name ?? DEFAULT_FORM.company_name),
      company_ruc: String(map.company_ruc ?? DEFAULT_FORM.company_ruc),
      undo_window_minutes: String(
        map.undo_window_minutes ?? DEFAULT_FORM.undo_window_minutes
      ),
      default_credit_days: String(
        map.default_credit_days ?? DEFAULT_FORM.default_credit_days
      ),
      credit_limit_mode: String(
        map.credit_limit_mode ?? DEFAULT_FORM.credit_limit_mode
      ),
      min_margin_pct: String(map.min_margin_pct ?? DEFAULT_FORM.min_margin_pct),
      route_opex_alert_pct: String(
        map.route_opex_alert_pct ?? DEFAULT_FORM.route_opex_alert_pct
      ),
      drain_alert_pct: String(map.drain_alert_pct ?? DEFAULT_FORM.drain_alert_pct),
      kpi_cutoff_date: String(
        map.kpi_cutoff_date ?? DEFAULT_FORM.kpi_cutoff_date
      ).slice(0, 10),
    });
    setDirty(false);
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<Record<string, unknown>>("/api/settings", {
        cache: "no-store",
      });
      hydrateFromMap(extractSettingsMap(data));
    } catch (error) {
      onFeedback(
        error instanceof ApiClientError
          ? error.message
          : "No se pudo cargar la configuración del ERP.",
        true
      );
    } finally {
      setLoading(false);
    }
  }, [hydrateFromMap, onFeedback]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  function updateField<K extends keyof SystemSettingsForm>(
    key: K,
    value: SystemSettingsForm[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const settingsPayload = {
        company_name: form.company_name.trim() || "Blue Horizon Trade",
        company_ruc: form.company_ruc.trim(),
        undo_window_minutes: Number(form.undo_window_minutes) || 15,
        default_credit_days: Number(form.default_credit_days) || 7,
        credit_limit_mode: form.credit_limit_mode || "APPROVAL_GATE",
        min_margin_pct: Number(form.min_margin_pct) || 20,
        route_opex_alert_pct: Number(form.route_opex_alert_pct) || 8,
        drain_alert_pct: Number(form.drain_alert_pct) || 30,
        kpi_cutoff_date: form.kpi_cutoff_date || "2026-06-26",
      };

      const res = await fetchJson<Record<string, unknown>>("/api/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          settings: settingsPayload,
        }),
      });
      const nextMap = extractSettingsMap(res);
      if (Object.keys(nextMap).length > 0) {
        hydrateFromMap(nextMap);
      } else {
        setDirty(false);
      }
      notifyLocalSync(["partners", "orders"]);
      onFeedback("Configuración operativa del ERP actualizada.");
      await onRefreshDashboard?.();
    } catch (error) {
      onFeedback(
        error instanceof ApiClientError
          ? error.message
          : "No se pudo guardar la configuración del ERP.",
        true
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <SkeletonCards count={2} />;
  }

  return (
    <Card accent="horizon" padding="md" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Badge tone="horizon">Parámetros dinámicos</Badge>
          <h2 className="mt-2 text-base font-semibold text-bht-ink-strong">
            Configuración operativa del ERP
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-bht-ink-soft">
            Ajusta umbrales de crédito, alertas de margen/gasto, ventana de reversión y
            datos corporativos sin redesplegar código.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || saving}
          onClick={() => void loadSettings()}
        >
          Recargar
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <FieldLabel htmlFor="setting-company-name">
              Nombre comercial / Empresa
            </FieldLabel>
            <input
              id="setting-company-name"
              type="text"
              value={form.company_name}
              onChange={(e) => updateField("company_name", e.target.value)}
              className={`${INPUT_CLASS} mt-1`}
            />
          </div>

          <div>
            <FieldLabel htmlFor="setting-company-ruc">RUC corporativo</FieldLabel>
            <input
              id="setting-company-ruc"
              type="text"
              maxLength={11}
              value={form.company_ruc}
              onChange={(e) => updateField("company_ruc", e.target.value)}
              placeholder="Ej. 20600000001"
              className={`${INPUT_CLASS} mt-1 tabular-nums`}
            />
          </div>

          <div>
            <FieldLabel htmlFor="setting-credit-mode">
              Política de exceso de crédito
            </FieldLabel>
            <select
              id="setting-credit-mode"
              value={form.credit_limit_mode}
              onChange={(e) => updateField("credit_limit_mode", e.target.value)}
              className={`${INPUT_CLASS} mt-1`}
            >
              <option value="APPROVAL_GATE">
                Enviar a cola de aprobación de socios (APPROVAL_GATE)
              </option>
              <option value="AUDIT_ONLY">
                Permitir con alerta de auditoría (AUDIT_ONLY)
              </option>
            </select>
          </div>

          <div>
            <FieldLabel htmlFor="setting-default-credit-days">
              Días de crédito por defecto
            </FieldLabel>
            <input
              id="setting-default-credit-days"
              type="number"
              min={0}
              max={180}
              value={form.default_credit_days}
              onChange={(e) => updateField("default_credit_days", e.target.value)}
              className={`${INPUT_CLASS} mt-1 tabular-nums`}
            />
          </div>

          <div>
            <FieldLabel htmlFor="setting-undo-window">
              Ventana para deshacer (minutos)
            </FieldLabel>
            <input
              id="setting-undo-window"
              type="number"
              min={1}
              max={1440}
              value={form.undo_window_minutes}
              onChange={(e) => updateField("undo_window_minutes", e.target.value)}
              className={`${INPUT_CLASS} mt-1 tabular-nums`}
            />
          </div>

          <div>
            <FieldLabel htmlFor="setting-kpi-cutoff">
              Fecha de corte KPI operativo
            </FieldLabel>
            <input
              id="setting-kpi-cutoff"
              type="date"
              value={form.kpi_cutoff_date}
              onChange={(e) => updateField("kpi_cutoff_date", e.target.value)}
              className={`${INPUT_CLASS} mt-1 tabular-nums`}
            />
          </div>

          <div>
            <FieldLabel htmlFor="setting-min-margin">
              Margen bruto mínimo de alerta (%)
            </FieldLabel>
            <input
              id="setting-min-margin"
              type="number"
              min={0}
              max={95}
              step="0.5"
              value={form.min_margin_pct}
              onChange={(e) => updateField("min_margin_pct", e.target.value)}
              className={`${INPUT_CLASS} mt-1 tabular-nums`}
            />
          </div>

          <div>
            <FieldLabel htmlFor="setting-route-opex">
              Meta máxima de gasto de ruta (%)
            </FieldLabel>
            <input
              id="setting-route-opex"
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={form.route_opex_alert_pct}
              onChange={(e) => updateField("route_opex_alert_pct", e.target.value)}
              className={`${INPUT_CLASS} mt-1 tabular-nums`}
            />
          </div>

          <div>
            <FieldLabel htmlFor="setting-drain-alert">
              Umbral de retiros vs. reinversión (%)
            </FieldLabel>
            <input
              id="setting-drain-alert"
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={form.drain_alert_pct}
              onChange={(e) => updateField("drain_alert_pct", e.target.value)}
              className={`${INPUT_CLASS} mt-1 tabular-nums`}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-bht-line pt-3">
          <Button type="submit" variant="primary" size="md" disabled={saving || !dirty}>
            {saving ? "Guardando..." : "Guardar configuración"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
