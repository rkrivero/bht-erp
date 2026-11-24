import { ValidationError } from "../../types";
import {
  REPORT_SECTIONS,
  type ReportFilterOptions,
  type ReportFilters,
  type ReportSection,
} from "./types";

export function isReportSection(value: string): value is ReportSection {
  return (REPORT_SECTIONS as readonly string[]).includes(value);
}

function parseIsoDateParam(raw: string | null, label: string): string | undefined {
  const value = (raw || "").trim();
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`Fecha '${label}' inválida (usa formato YYYY-MM-DD)`);
  }
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new ValidationError(`Fecha '${label}' fuera de calendario`);
  }
  return value;
}

export function parseReportFilters(params: URLSearchParams): ReportFilters {
  const from = parseIsoDateParam(params.get("from"), "desde");
  const to = parseIsoDateParam(params.get("to"), "hasta");
  if (from && to && from > to) {
    throw new ValidationError("La fecha 'desde' no puede ser posterior a 'hasta'");
  }

  const rawZone = (params.get("zone") || "").trim();
  if (rawZone.length > 80) {
    throw new ValidationError("El filtro de zona excede el máximo de 80 caracteres");
  }
  const zone = rawZone || undefined;

  const rawSeller = (params.get("sellerId") || "").trim();
  let sellerId: ReportFilters["sellerId"];
  if (rawSeller) {
    if (rawSeller === "UNASSIGNED") {
      sellerId = "UNASSIGNED";
    } else if (/^\d+$/.test(rawSeller) && Number(rawSeller) > 0) {
      const parsed = Number(rawSeller);
      if (!Number.isSafeInteger(parsed)) {
        throw new ValidationError("El identificador de vendedor es inválido");
      }
      sellerId = parsed;
    } else {
      throw new ValidationError("El identificador de vendedor es inválido");
    }
  }

  return { from, to, zone, sellerId };
}

export const FILTER_OPTIONS_SELECT = `
  json_build_object(
    'zones', COALESCE((
      SELECT json_agg(z ORDER BY z ASC)
      FROM (
        SELECT DISTINCT COALESCE(NULLIF(BTRIM(pa.city_zone), ''), NULLIF(BTRIM(rt.zone_name), ''), 'Sin zona') AS z
        FROM erp.sales_orders so
        LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
        LEFT JOIN erp.route_trips rt ON rt.trip_id = so.trip_id
        WHERE so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
        UNION
        SELECT DISTINCT NULLIF(BTRIM(city_zone), '') AS z
        FROM erp.parties
        WHERE is_active = TRUE AND NULLIF(BTRIM(city_zone), '') IS NOT NULL
      ) zones_union
      WHERE z IS NOT NULL
    ), '[]'::json),
    'sellers', COALESCE((
      SELECT json_agg(s ORDER BY s.full_name ASC)
      FROM (
        SELECT DISTINCT u.user_id, u.full_name
        FROM erp.app_users u
        JOIN erp.sales_orders so ON so.created_by_user_id = u.user_id
        WHERE so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
        UNION
        SELECT u.user_id, u.full_name
        FROM erp.app_users u
        WHERE u.is_active = TRUE
          AND u.role IN ('PARTNER_ADMIN', 'PARTNER_MANAGER', 'EXTERNAL_SELLER')
      ) s
    ), '[]'::json),
    'months', COALESCE((
      SELECT json_agg(m.period_month ORDER BY m.period_month DESC)
      FROM (
        SELECT DISTINCT period_month::text AS period_month
        FROM analytics.v_report_monthly_pnl
      ) m
    ), '[]'::json)
  ) AS filter_options
`;

export function toNum(value: unknown, fallback = 0): number {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

export function toOptNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function mapFilterOptions(raw: unknown): ReportFilterOptions {
  const obj = (raw && typeof raw === "object" ? raw : {}) as {
    zones?: unknown[];
    sellers?: Array<{ user_id: unknown; full_name: unknown }>;
    months?: unknown[];
  };
  return {
    zones: Array.isArray(obj.zones) ? obj.zones.map((z) => String(z)) : [],
    sellers: Array.isArray(obj.sellers)
      ? obj.sellers.map((s) => ({
          user_id: Number(s.user_id),
          full_name: String(s.full_name),
        }))
      : [],
    months: Array.isArray(obj.months) ? obj.months.map((m) => String(m)) : [],
  };
}

export class FilterParamBuilder {
  readonly params: unknown[] = [];

  add(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  appendSalesFilters(
    filters: ReportFilters,
    alias = "so",
    options?: { includeZone?: boolean; includeSeller?: boolean }
  ): string[] {
    const clauses: string[] = [];
    if (filters.from) {
      clauses.push(`${alias}.order_date >= ${this.add(filters.from)}::date`);
    }
    if (filters.to) {
      clauses.push(`${alias}.order_date <= ${this.add(filters.to)}::date`);
    }
    if (options?.includeZone !== false && filters.zone) {
      clauses.push(
        `COALESCE(NULLIF(BTRIM(pa.city_zone), ''), NULLIF(BTRIM(rt.zone_name), ''), 'Sin zona') = ${this.add(filters.zone)}`
      );
    }
    if (options?.includeSeller !== false && filters.sellerId !== undefined) {
      if (filters.sellerId === "UNASSIGNED") {
        clauses.push(`${alias}.created_by_user_id IS NULL`);
      } else {
        clauses.push(`${alias}.created_by_user_id = ${this.add(filters.sellerId)}`);
      }
    }
    return clauses;
  }
}
