import type { PoolClient } from "pg";
import { assertRole } from "../rbac";
import { ValidationError, type SessionUser } from "../types";

export const SETTINGS_CACHE_TTL_MS = 30_000;

export type SystemSettingValueType = "number" | "string" | "boolean" | "date" | "json";

export interface SystemSettingItem {
  setting_key: string;
  key: string;
  value_json: unknown;
  value: unknown;
  value_type: SystemSettingValueType;
  label_es: string;
  description_es: string;
  updated_by_user_id: number | null;
  updated_by_name: string | null;
  updated_at: string;
}

export interface SystemSettingsMap {
  undo_window_minutes: number;
  default_credit_days: number;
  min_margin_pct: number;
  route_opex_alert_pct: number;
  drain_alert_pct: number;
  kpi_cutoff_date: string;
  credit_limit_mode: string;
  company_name: string;
  company_ruc: string;
  [key: string]: unknown;
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettingsMap = {
  undo_window_minutes: 15,
  default_credit_days: 7,
  min_margin_pct: 20,
  route_opex_alert_pct: 8,
  drain_alert_pct: 30,
  kpi_cutoff_date: "2026-06-26",
  credit_limit_mode: "APPROVAL_GATE",
  company_name: "Blue Horizon Trade",
  company_ruc: "",
};

let cachedSettings: {
  expiresAt: number;
  settings: SystemSettingItem[];
  values: SystemSettingsMap;
} | null = null;

export function invalidateSystemSettingsCache(): void {
  cachedSettings = null;
}

function buildValuesMap(items: SystemSettingItem[]): SystemSettingsMap {
  const map: SystemSettingsMap = { ...DEFAULT_SYSTEM_SETTINGS };
  for (const item of items) {
    map[item.setting_key] = item.value_json;
  }
  return map;
}

export async function getSystemSettings(
  client: PoolClient,
  options: { forceRefresh?: boolean; writeCache?: boolean } = {}
): Promise<{ settings: SystemSettingItem[]; values: SystemSettingsMap }> {
  const now = Date.now();
  if (!options.forceRefresh && cachedSettings && cachedSettings.expiresAt > now) {
    return {
      settings: cachedSettings.settings,
      values: { ...cachedSettings.values },
    };
  }

  try {
    const res = await client.query<{
      setting_key: string;
      value_json: unknown;
      value_type: SystemSettingValueType;
      label_es: string;
      description_es: string;
      updated_by_user_id: string | number | null;
      updated_by_name: string | null;
      updated_at: string;
    }>(
      `SELECT
         s.setting_key,
         s.value_json,
         s.value_type,
         s.label_es,
         s.description_es,
         s.updated_by_user_id,
         u.full_name AS updated_by_name,
         s.updated_at::text AS updated_at
       FROM erp.system_settings s
       LEFT JOIN erp.app_users u ON u.user_id = s.updated_by_user_id
       ORDER BY s.setting_key ASC`
    );

    const settings: SystemSettingItem[] = res.rows.map((r) => ({
      setting_key: String(r.setting_key),
      key: String(r.setting_key),
      value_json: r.value_json,
      value: r.value_json,
      value_type: (r.value_type || "string") as SystemSettingValueType,
      label_es: String(r.label_es || r.setting_key),
      description_es: String(r.description_es || ""),
      updated_by_user_id:
        r.updated_by_user_id !== null && r.updated_by_user_id !== undefined
          ? Number(r.updated_by_user_id)
          : null,
      updated_by_name: r.updated_by_name ? String(r.updated_by_name) : null,
      updated_at: String(r.updated_at),
    }));

    const values = buildValuesMap(settings);
    if (options.writeCache !== false) {
      cachedSettings = {
        expiresAt: now + SETTINGS_CACHE_TTL_MS,
        settings,
        values,
      };
    }
    return { settings, values: { ...values } };
  } catch {
    return {
      settings: [],
      values: { ...DEFAULT_SYSTEM_SETTINGS },
    };
  }
}

export async function getNumericSetting(
  client: PoolClient,
  key: keyof SystemSettingsMap | string,
  fallback: number
): Promise<number> {
  const { values } = await getSystemSettings(client);
  const raw = values[String(key)];
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

export async function getStringSetting(
  client: PoolClient,
  key: keyof SystemSettingsMap | string,
  fallback: string
): Promise<string> {
  const { values } = await getSystemSettings(client);
  const raw = values[String(key)];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : fallback;
}

function validateSettingValue(
  key: string,
  valueType: SystemSettingValueType,
  rawValue: unknown
): unknown {
  if (valueType === "number") {
    const num = Number(rawValue);
    if (!Number.isFinite(num) || num < 0) {
      throw new ValidationError(
        `El parámetro ${key} debe ser un número mayor o igual a 0`
      );
    }
    if (key === "undo_window_minutes" && (num < 1 || num > 1440)) {
      throw new ValidationError(
        "La ventana de deshacer debe estar entre 1 y 1440 minutos"
      );
    }
    if (key === "default_credit_days" && (num < 0 || num > 365)) {
      throw new ValidationError(
        "Los días de crédito por defecto deben estar entre 0 y 365"
      );
    }
    if (
      (key === "min_margin_pct" ||
        key === "route_opex_alert_pct" ||
        key === "drain_alert_pct") &&
      (num < 0 || num > 100)
    ) {
      throw new ValidationError(`El porcentaje ${key} debe estar entre 0 y 100`);
    }
    return num;
  }

  if (valueType === "boolean") {
    if (typeof rawValue === "boolean") return rawValue;
    if (rawValue === "true" || rawValue === 1) return true;
    if (rawValue === "false" || rawValue === 0) return false;
    throw new ValidationError(`El parámetro ${key} debe ser booleano`);
  }

  if (valueType === "date") {
    const str = String(rawValue ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      throw new ValidationError(`El parámetro ${key} debe tener formato YYYY-MM-DD`);
    }
    return str;
  }

  if (valueType === "string") {
    const str = String(rawValue ?? "").trim();
    if (
      key === "credit_limit_mode" &&
      !["APPROVAL_GATE", "AUDIT_ONLY", "STRICT_BLOCK"].includes(str)
    ) {
      throw new ValidationError(
        "Modo de límite de crédito inválido (use APPROVAL_GATE, AUDIT_ONLY o STRICT_BLOCK)"
      );
    }
    return str;
  }

  return rawValue;
}

export async function updateSystemSettings(
  client: PoolClient,
  actor: SessionUser,
  updates: Array<{ key: string; value: unknown }>
): Promise<{ settings: SystemSettingItem[]; values: SystemSettingsMap }> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);

  if (!Array.isArray(updates) || updates.length === 0) {
    throw new ValidationError(
      "Debe enviar al menos un parámetro de configuración a actualizar"
    );
  }

  for (const item of updates) {
    const key = String(item.key || "").trim();
    if (!key) {
      throw new ValidationError("Clave de parámetro inválida");
    }

    const existingRes = await client.query<{
      setting_key: string;
      value_json: unknown;
      value_type: SystemSettingValueType;
    }>(
      `SELECT setting_key, value_json, value_type
       FROM erp.system_settings
       WHERE setting_key = $1
       FOR UPDATE`,
      [key]
    );

    if (existingRes.rowCount === 0) {
      throw new ValidationError(`Parámetro de configuración no encontrado: ${key}`);
    }

    const existing = existingRes.rows[0];
    const validatedValue = validateSettingValue(key, existing.value_type, item.value);

    await client.query(
      `UPDATE erp.system_settings
       SET value_json = $2::jsonb,
           updated_by_user_id = $3,
           updated_at = NOW()
       WHERE setting_key = $1`,
      [key, JSON.stringify(validatedValue), actor.userId]
    );

    await client.query(
      `INSERT INTO erp.audit_flags (
         flag_code, severity, entity_table, entity_id,
         message, details, status, resolved_at, resolved_by, source_origin
       ) VALUES (
         'SYSTEM_SETTING_UPDATED',
         'INFO',
         'erp.system_settings',
         $1,
         $2,
         $3::jsonb,
         'RESOLVED',
         NOW(),
         $4,
         'ERP_APP'
       )`,
      [
        `${key}:${Date.now()}`,
        `Parámetro ${key} actualizado por ${actor.fullName}`,
        JSON.stringify({
          setting_key: key,
          before: existing.value_json,
          after: validatedValue,
          actor_user_id: actor.userId,
          actor_username: actor.username,
          actor_role: actor.role,
        }),
        actor.username,
      ]
    );
  }

  invalidateSystemSettingsCache();
  return getSystemSettings(client, { forceRefresh: true, writeCache: false });
}
