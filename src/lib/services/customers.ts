import type { PoolClient } from "pg";
import { normalizePartyName, normalizeZone } from "../geo";
import { assertRole } from "../rbac";
import {
  AuthorizationError,
  ValidationError,
  parsePositiveInt,
  type SessionUser,
} from "../types";

const VALID_DOC_TYPES = new Set(["NONE", "RUC", "DNI", "CE", "PASSPORT"]);

export type CustomerStatusFilter = "ACTIVE" | "INACTIVE" | "ALL";
export type CustomerGeoFilter = "ALL" | "WITH_GEO" | "WITHOUT_GEO";

export interface CustomerDirectoryItem {
  party_id: number;
  legal_name: string;
  trade_name: string | null;
  display_name: string;
  doc_type: string;
  doc_number: string | null;
  is_generic_doc: boolean;
  phone: string | null;
  email: string | null;
  address: string | null;
  city_zone: string | null;
  notes: string | null;
  is_active: boolean;
  geo_lat: number | null;
  geo_lng: number | null;
  geo_accuracy_m: number | null;
  geo_updated_at: string | null;
  credit_days_agreed: number | null;
  credit_limit_pen: number | null;
  last_contact_date: string | null;
  orders_count: number;
  open_balance_pen: number;
  last_order_date: string | null;
  aliases: string[];
  has_orders: boolean;
}

export interface SupplierDirectoryItem {
  party_id: number;
  legal_name: string;
  trade_name: string | null;
  display_name: string;
  doc_type: string;
  doc_number: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city_zone: string | null;
  notes: string | null;
  is_active: boolean;
  open_ap_balance_pen: number;
  open_docs_count: number;
}

export interface ZoneCountItem {
  zone: string;
  count: number;
}

export interface CustomerDirectoryStats {
  totalActive: number;
  withGeo: number;
  withoutGeo: number;
  withDebt: number;
}

export interface ListCustomersInput {
  q?: string;
  zone?: string;
  status?: CustomerStatusFilter;
  hasGeo?: CustomerGeoFilter;
  withDebt?: boolean;
  limit?: number;
  offset?: number;
}

export interface CreateCustomerInput {
  tradeName?: string | null;
  legalName?: string | null;
  docType?: string | null;
  docNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  cityZone?: string | null;
  notes?: string | null;
  geoLat?: number | null;
  geoLng?: number | null;
  geoAccuracyM?: number | null;
  creditDaysAgreed?: number | null;
  creditLimitPen?: number | null;
  lastContactDate?: string | null;
}

export interface UpdateCustomerInput {
  tradeName?: string | null;
  legalName?: string | null;
  docType?: string | null;
  docNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  cityZone?: string | null;
  notes?: string | null;
  isActive?: boolean;
  geoLat?: number | null;
  geoLng?: number | null;
  geoAccuracyM?: number | null;
  creditDaysAgreed?: number | null;
  creditLimitPen?: number | null;
  lastContactDate?: string | null;
}

export interface ListSuppliersInput {
  q?: string;
  status?: CustomerStatusFilter;
}

export interface UpdateSupplierInput {
  tradeName?: string | null;
  legalName?: string | null;
  docType?: string | null;
  docNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  cityZone?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

function normalizeSearchQuery(raw: string): string[] {
  return String(raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeOptionalText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).trim();
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeOptionalEmail(raw: string | null | undefined): string | null {
  const cleaned = normalizeOptionalText(raw);
  return cleaned ? cleaned.toLowerCase() : null;
}

function validateCreditDays(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const val = Number(raw);
  if (!Number.isInteger(val) || val < 0 || val > 365) {
    throw new ValidationError(
      "Los días de crédito acordados deben estar entre 0 y 365"
    );
  }
  return val;
}

function validateCreditLimit(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const val = Number(raw);
  if (!Number.isFinite(val) || val < 0) {
    throw new ValidationError("El límite de crédito no puede ser negativo");
  }
  return Number(val.toFixed(2));
}

function validateOptionalIsoDate(
  raw: string | null | undefined,
  label: string
): string | null {
  const cleaned = normalizeOptionalText(raw);
  if (!cleaned) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw new ValidationError(`${label} debe tener formato YYYY-MM-DD`);
  }
  const [y, m, d] = cleaned.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new ValidationError(`${label} inválida`);
  }
  return cleaned;
}

function validateAndNormalizeGeo(
  latInput: number | null | undefined,
  lngInput: number | null | undefined,
  accuracyInput: number | null | undefined
): {
  geoLat: number | null;
  geoLng: number | null;
  geoAccuracyM: number | null;
} {
  const latEmpty = latInput === null || latInput === undefined;
  const lngEmpty = lngInput === null || lngInput === undefined;

  if (latEmpty !== lngEmpty) {
    throw new ValidationError("Latitud y longitud deben enviarse juntas");
  }
  if (latEmpty || lngEmpty) {
    return { geoLat: null, geoLng: null, geoAccuracyM: null };
  }

  const lat = Number(latInput);
  const lng = Number(lngInput);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new ValidationError("Latitud inválida (debe estar entre -90 y 90)");
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new ValidationError("Longitud inválida (debe estar entre -180 y 180)");
  }

  let geoAccuracyM: number | null = null;
  if (accuracyInput !== null && accuracyInput !== undefined) {
    const acc = Number(accuracyInput);
    if (!Number.isFinite(acc) || acc < 0) {
      throw new ValidationError("Precisión GPS inválida");
    }
    geoAccuracyM = Math.round(acc);
  }

  return {
    geoLat: Number(lat.toFixed(6)),
    geoLng: Number(lng.toFixed(6)),
    geoAccuracyM,
  };
}

function validateDocumentFields(
  docTypeInput: string | null | undefined,
  docNumberInput: string | null | undefined
): {
  docType: "NONE" | "RUC" | "DNI" | "CE" | "PASSPORT";
  docNumber: string | null;
  isGenericDoc: boolean;
} {
  const rawDocNumber = docNumberInput ? String(docNumberInput).trim() : "";
  let docTypeRaw = String(docTypeInput || "")
    .trim()
    .toUpperCase();

  if (!docTypeRaw) {
    if (!rawDocNumber) {
      return { docType: "NONE", docNumber: null, isGenericDoc: false };
    }
    if (/^\d{11}$/.test(rawDocNumber)) docTypeRaw = "RUC";
    else if (/^\d{8}$/.test(rawDocNumber)) docTypeRaw = "DNI";
    else docTypeRaw = "CE";
  }

  if (!VALID_DOC_TYPES.has(docTypeRaw)) {
    throw new ValidationError(`Tipo de documento inválido: ${docTypeRaw}`);
  }
  const docType = docTypeRaw as "NONE" | "RUC" | "DNI" | "CE" | "PASSPORT";

  if (docType === "NONE" || !rawDocNumber) {
    if (docType !== "NONE" && !rawDocNumber) {
      throw new ValidationError(`Debe ingresar el número de documento para ${docType}`);
    }
    return { docType: "NONE", docNumber: null, isGenericDoc: false };
  }

  return { docType, docNumber: rawDocNumber, isGenericDoc: false };
}

function mapCustomerRow(row: Record<string, unknown>): CustomerDirectoryItem {
  const legalName = String(row.legal_name);
  const tradeName = row.trade_name ? String(row.trade_name) : null;
  return {
    party_id: Number(row.party_id),
    legal_name: legalName,
    trade_name: tradeName,
    display_name: tradeName || legalName,
    doc_type: String(row.doc_type || "NONE"),
    doc_number: row.doc_number ? String(row.doc_number) : null,
    is_generic_doc: Boolean(row.is_generic_doc),
    phone: row.phone ? String(row.phone) : null,
    email: row.email ? String(row.email) : null,
    address: row.address ? String(row.address) : null,
    city_zone: row.city_zone ? String(row.city_zone) : null,
    notes: row.notes ? String(row.notes) : null,
    is_active: Boolean(row.is_active),
    geo_lat:
      row.geo_lat !== null && row.geo_lat !== undefined ? Number(row.geo_lat) : null,
    geo_lng:
      row.geo_lng !== null && row.geo_lng !== undefined ? Number(row.geo_lng) : null,
    geo_accuracy_m:
      row.geo_accuracy_m !== null && row.geo_accuracy_m !== undefined
        ? Number(row.geo_accuracy_m)
        : null,
    geo_updated_at: row.geo_updated_at ? String(row.geo_updated_at) : null,
    credit_days_agreed:
      row.credit_days_agreed !== null && row.credit_days_agreed !== undefined
        ? Number(row.credit_days_agreed)
        : null,
    credit_limit_pen:
      row.credit_limit_pen !== null && row.credit_limit_pen !== undefined
        ? Number(row.credit_limit_pen)
        : null,
    last_contact_date: row.last_contact_date ? String(row.last_contact_date) : null,
    orders_count: Number(row.orders_count ?? 0),
    open_balance_pen: Number(row.open_balance_pen ?? 0),
    last_order_date: row.last_order_date ? String(row.last_order_date) : null,
    aliases: Array.isArray(row.aliases) ? row.aliases.map((a) => String(a)) : [],
    has_orders: Number(row.orders_count ?? 0) > 0 || Boolean(row.has_orders),
  };
}

async function fetchCustomerById(
  client: PoolClient,
  partyId: number
): Promise<CustomerDirectoryItem | null> {
  const res = await client.query(
    `WITH alias_agg AS (
       SELECT
         party_id,
         COALESCE(array_agg(alias_raw ORDER BY alias_id) FILTER (WHERE alias_raw IS NOT NULL), ARRAY[]::text[]) AS aliases
       FROM erp.party_aliases
       WHERE party_id = $1
       GROUP BY party_id
     ),
     order_stats AS (
       SELECT
         so.customer_party_id AS party_id,
         COUNT(*) FILTER (WHERE so.operational_status <> 'CANCELLED')::int AS orders_count,
         COALESCE(SUM(so.balance_due_pen) FILTER (
           WHERE so.is_settled = FALSE
             AND so.balance_due_pen > 0.05
             AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
         ), 0)::NUMERIC(14,2) AS open_balance_pen,
         MAX(so.order_date) FILTER (WHERE so.operational_status <> 'CANCELLED')::text AS last_order_date,
         COUNT(*)::int AS any_orders_count
       FROM erp.sales_orders so
       WHERE so.customer_party_id = $1
       GROUP BY so.customer_party_id
     )
     SELECT
       pa.party_id,
       pa.legal_name,
       pa.trade_name,
       pa.doc_type::text AS doc_type,
       pa.doc_number,
       pa.is_generic_doc,
       pa.phone,
       pa.email,
       pa.address,
       pa.city_zone,
       pa.notes,
       pa.is_active,
       pa.geo_lat,
       pa.geo_lng,
       pa.geo_accuracy_m,
       pa.geo_updated_at::text AS geo_updated_at,
       pa.credit_days_agreed,
       pa.credit_limit_pen,
       pa.last_contact_date::text AS last_contact_date,
       COALESCE(os.orders_count, 0) AS orders_count,
       COALESCE(os.open_balance_pen, 0) AS open_balance_pen,
       os.last_order_date,
       COALESCE(aa.aliases, ARRAY[]::text[]) AS aliases,
       (COALESCE(os.any_orders_count, 0) > 0) AS has_orders
     FROM erp.parties pa
     LEFT JOIN alias_agg aa ON aa.party_id = pa.party_id
     LEFT JOIN order_stats os ON os.party_id = pa.party_id
     WHERE pa.party_id = $1
       AND pa.party_type IN ('CUSTOMER', 'BOTH')
     LIMIT 1`,
    [partyId]
  );
  if (res.rowCount === 0) return null;
  return mapCustomerRow(res.rows[0]);
}

function isPgUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

/**
 * List customer master records with accent-insensitive alias + legal-name search,
 * zone filtering, GPS/debt filters, and read-only commercial summary.
 */
export async function listCustomers(
  client: PoolClient,
  actor: SessionUser,
  input: ListCustomersInput = {}
): Promise<{
  customers: CustomerDirectoryItem[];
  zones: ZoneCountItem[];
  stats: CustomerDirectoryStats;
  pagination: {
    limit: number;
    offset: number;
    totalCount: number;
    hasMore: boolean;
  };
}> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"]);

  const safeLimit = Math.min(Math.max(Number(input.limit ?? 100) || 100, 1), 500);
  const safeOffset = Math.max(Number(input.offset ?? 0) || 0, 0);

  const effectiveStatus: CustomerStatusFilter =
    actor.role === "EXTERNAL_SELLER" ? "ACTIVE" : (input.status ?? "ACTIVE");

  const conditions: string[] = [`pa.party_type IN ('CUSTOMER', 'BOTH')`];
  const params: unknown[] = [];

  if (effectiveStatus === "ACTIVE") {
    conditions.push(`pa.is_active = TRUE`);
  } else if (effectiveStatus === "INACTIVE") {
    conditions.push(`pa.is_active = FALSE`);
  }

  const normalizedZone = normalizeZone(input.zone);
  if (normalizedZone === "__NONE__") {
    conditions.push(`pa.city_zone IS NULL`);
  } else if (normalizedZone) {
    params.push(normalizedZone);
    conditions.push(`UPPER(BTRIM(pa.city_zone)) = $${params.length}`);
  }

  if (input.hasGeo === "WITH_GEO") {
    conditions.push(`pa.geo_lat IS NOT NULL AND pa.geo_lng IS NOT NULL`);
  } else if (input.hasGeo === "WITHOUT_GEO") {
    conditions.push(`(pa.geo_lat IS NULL OR pa.geo_lng IS NULL)`);
  }

  if (input.withDebt) {
    conditions.push(`COALESCE(os.open_balance_pen, 0) > 0.05`);
  }

  const tokens = normalizeSearchQuery(input.q ?? "");
  for (const tok of tokens) {
    params.push(`%${tok}%`);
    const idx = params.length;
    conditions.push(
      `translate(LOWER(
         COALESCE(pa.trade_name, '') || ' ' ||
         COALESCE(pa.legal_name, '') || ' ' ||
         COALESCE(pa.doc_number, '') || ' ' ||
         COALESCE(pa.phone, '') || ' ' ||
         COALESCE(pa.city_zone, '') || ' ' ||
         COALESCE(pa.address, '') || ' ' ||
         COALESCE(aa.aliases_text, '')
       ), 'áéíóúüñ', 'aeiouun') LIKE $${idx}`
    );
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const baseCtes = `
    WITH alias_agg AS (
      SELECT
        party_id,
        COALESCE(array_agg(alias_raw ORDER BY alias_id) FILTER (WHERE alias_raw IS NOT NULL), ARRAY[]::text[]) AS aliases,
        COALESCE(string_agg(alias_raw, ' '), '') AS aliases_text
      FROM erp.party_aliases
      GROUP BY party_id
    ),
    order_stats AS (
      SELECT
        so.customer_party_id AS party_id,
        COUNT(*) FILTER (WHERE so.operational_status <> 'CANCELLED')::int AS orders_count,
        COALESCE(SUM(so.balance_due_pen) FILTER (
          WHERE so.is_settled = FALSE
            AND so.balance_due_pen > 0.05
            AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
        ), 0)::NUMERIC(14,2) AS open_balance_pen,
        MAX(so.order_date) FILTER (WHERE so.operational_status <> 'CANCELLED')::text AS last_order_date,
        COUNT(*)::int AS any_orders_count
      FROM erp.sales_orders so
      WHERE so.customer_party_id IS NOT NULL
      GROUP BY so.customer_party_id
    )
  `;

  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;

  const listRes = await client.query(
    `${baseCtes}
     SELECT
       pa.party_id,
       pa.legal_name,
       pa.trade_name,
       pa.doc_type::text AS doc_type,
       pa.doc_number,
       pa.is_generic_doc,
       pa.phone,
       pa.email,
       pa.address,
       pa.city_zone,
       pa.notes,
       pa.is_active,
       pa.geo_lat,
       pa.geo_lng,
       pa.geo_accuracy_m,
       pa.geo_updated_at::text AS geo_updated_at,
       pa.credit_days_agreed,
       pa.credit_limit_pen,
       pa.last_contact_date::text AS last_contact_date,
       COALESCE(os.orders_count, 0) AS orders_count,
       COALESCE(os.open_balance_pen, 0) AS open_balance_pen,
       os.last_order_date,
       COALESCE(aa.aliases, ARRAY[]::text[]) AS aliases,
       (COALESCE(os.any_orders_count, 0) > 0) AS has_orders,
       COUNT(*) OVER()::int AS filtered_total_count
     FROM erp.parties pa
     LEFT JOIN alias_agg aa ON aa.party_id = pa.party_id
     LEFT JOIN order_stats os ON os.party_id = pa.party_id
     ${whereClause}
     ORDER BY COALESCE(pa.trade_name, pa.legal_name) ASC, pa.party_id ASC
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    [...params, safeLimit, safeOffset]
  );

  const metaRes = await client.query(
    `WITH order_stats AS (
       SELECT
         so.customer_party_id AS party_id,
         COALESCE(SUM(so.balance_due_pen) FILTER (
           WHERE so.is_settled = FALSE
             AND so.balance_due_pen > 0.05
             AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
         ), 0)::NUMERIC(14,2) AS open_balance_pen
       FROM erp.sales_orders so
       WHERE so.customer_party_id IS NOT NULL
       GROUP BY so.customer_party_id
     )
     SELECT
       (SELECT json_build_object(
         'totalActive', COUNT(*) FILTER (WHERE pa.is_active = TRUE)::int,
         'withGeo', COUNT(*) FILTER (WHERE pa.is_active = TRUE AND pa.geo_lat IS NOT NULL)::int,
         'withoutGeo', COUNT(*) FILTER (WHERE pa.is_active = TRUE AND pa.geo_lat IS NULL)::int,
         'withDebt', COUNT(*) FILTER (WHERE pa.is_active = TRUE AND COALESCE(os.open_balance_pen, 0) > 0.05)::int
       )
       FROM erp.parties pa
       LEFT JOIN order_stats os ON os.party_id = pa.party_id
       WHERE pa.party_type IN ('CUSTOMER', 'BOTH')) AS stats,
       COALESCE((
         SELECT json_agg(z ORDER BY z.count DESC, z.zone ASC)
         FROM (
           SELECT UPPER(BTRIM(pa.city_zone)) AS zone, COUNT(*)::int AS count
           FROM erp.parties pa
           WHERE pa.party_type IN ('CUSTOMER', 'BOTH')
             AND pa.is_active = TRUE
             AND pa.city_zone IS NOT NULL
             AND BTRIM(pa.city_zone) <> ''
           GROUP BY UPPER(BTRIM(pa.city_zone))
         ) z
       ), '[]'::json) AS zones`
  );

  const customers = listRes.rows.map(mapCustomerRow);
  const totalCount =
    listRes.rows.length > 0 ? Number(listRes.rows[0].filtered_total_count ?? 0) : 0;

  const metaRow = metaRes.rows[0] ?? {};
  const statsRaw = (metaRow.stats ?? {}) as Record<string, unknown>;
  const zonesRaw = Array.isArray(metaRow.zones)
    ? (metaRow.zones as Array<{ zone: string; count: number }>)
    : [];

  return {
    customers,
    zones: zonesRaw.map((z) => ({ zone: String(z.zone), count: Number(z.count ?? 0) })),
    stats: {
      totalActive: Number(statsRaw.totalActive ?? 0),
      withGeo: Number(statsRaw.withGeo ?? 0),
      withoutGeo: Number(statsRaw.withoutGeo ?? 0),
      withDebt: Number(statsRaw.withDebt ?? 0),
    },
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      totalCount,
      hasMore: safeOffset + customers.length < totalCount,
    },
  };
}

/**
 * Create a new customer supporting dual naming (alias/trade_name and/or legal_name),
 * zone normalization, duplicate real-document protection, and optional GPS coordinates.
 */
export async function createCustomer(
  client: PoolClient,
  actor: SessionUser,
  input: CreateCustomerInput
): Promise<{ customer: CustomerDirectoryItem }> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"]);

  const tradeName = normalizePartyName(input.tradeName);
  const legalNameRaw = normalizePartyName(input.legalName);
  if (!tradeName && !legalNameRaw) {
    throw new ValidationError(
      "Ingresa al menos el alias (nombre comercial) o el nombre completo del cliente"
    );
  }

  const effectiveLegalName = legalNameRaw ?? tradeName!;
  const effectiveTradeName = tradeName ?? null;
  const { docType, docNumber, isGenericDoc } = validateDocumentFields(
    input.docType,
    input.docNumber
  );
  const { geoLat, geoLng, geoAccuracyM } = validateAndNormalizeGeo(
    input.geoLat,
    input.geoLng,
    input.geoAccuracyM
  );
  const cityZone = normalizeZone(input.cityZone);
  if (
    actor.role === "EXTERNAL_SELLER" &&
    ((input.creditDaysAgreed !== undefined && input.creditDaysAgreed !== null) ||
      (input.creditLimitPen !== undefined && input.creditLimitPen !== null))
  ) {
    throw new AuthorizationError(
      "Solo un socio puede configurar días o límite de crédito"
    );
  }
  const creditDaysAgreed = validateCreditDays(input.creditDaysAgreed);
  const creditLimitPen = validateCreditLimit(input.creditLimitPen);
  const lastContactDate = validateOptionalIsoDate(
    input.lastContactDate,
    "Fecha de último contacto"
  );

  if (!isGenericDoc && docNumber) {
    const dupRes = await client.query(
      `SELECT party_id, COALESCE(trade_name, legal_name) AS display_name
       FROM erp.parties
       WHERE doc_type = $1::erp.doc_id_type
         AND doc_number = $2
         AND is_generic_doc = FALSE
       LIMIT 1`,
      [docType, docNumber]
    );
    if (dupRes.rowCount && dupRes.rowCount > 0) {
      throw new ValidationError(
        `Ya existe una entidad registrada con ${docType} ${docNumber}: ${dupRes.rows[0].display_name}`
      );
    }
  }

  let canonicalKey: string;
  if (!isGenericDoc && docNumber) {
    const preferredKey = `${docType}:${docNumber}`;
    const keyRes = await client.query(
      `SELECT 1 FROM erp.parties WHERE canonical_key = $1 LIMIT 1`,
      [preferredKey]
    );
    canonicalKey =
      keyRes.rowCount && keyRes.rowCount > 0
        ? `CUST_${docType}_${docNumber}_${Date.now() % 100000}`
        : preferredKey;
  } else {
    const slug = (effectiveTradeName || effectiveLegalName)
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 32);
    canonicalKey = `CUST_${slug || "CLI"}_${Date.now()}_${Math.floor(
      100 + Math.random() * 900
    )}`;
  }

  try {
    const insertRes = await client.query<{ party_id: string | number }>(
      `INSERT INTO erp.parties (
         canonical_key, party_type, doc_type, doc_number, is_generic_doc,
         legal_name, trade_name, phone, email, address, city_zone, notes,
         geo_lat, geo_lng, geo_accuracy_m, geo_updated_at,
         credit_days_agreed, credit_limit_pen, last_contact_date,
         is_active, source_origin
       ) VALUES (
         $1, 'CUSTOMER', $2::erp.doc_id_type, $3, $4,
         $5, $6, $7, $8, $9, $10, $11,
         $12, $13, $14, CASE WHEN $12::double precision IS NOT NULL THEN NOW() ELSE NULL END,
         $15, $16, $17::date,
         TRUE, 'ERP_APP'
       )
       RETURNING party_id`,
      [
        canonicalKey,
        docType,
        docNumber,
        isGenericDoc,
        effectiveLegalName,
        effectiveTradeName,
        normalizeOptionalText(input.phone),
        normalizeOptionalEmail(input.email),
        normalizeOptionalText(input.address),
        cityZone,
        normalizeOptionalText(input.notes),
        geoLat,
        geoLng,
        geoAccuracyM,
        creditDaysAgreed,
        creditLimitPen,
        lastContactDate,
      ]
    );

    const created = await fetchCustomerById(client, Number(insertRes.rows[0].party_id));
    if (!created) {
      throw new ValidationError("No se pudo recuperar el cliente recién creado");
    }
    return { customer: created };
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new ValidationError(
        `Ya existe un cliente o proveedor registrado con ${docType} ${docNumber ?? ""}`.trim()
      );
    }
    throw err;
  }
}

/**
 * Update an existing customer respecting role boundaries:
 * - WAREHOUSE_DELIVERY: GPS coordinates + delivery notes only (active customers).
 * - EXTERNAL_SELLER: field contact, zone, trade_name (alias), GPS, notes; cannot toggle
 *   isActive or alter legal_name / genuine document once the customer has sales orders.
 * - PARTNER_ADMIN / PARTNER_MANAGER: full master-data control.
 */
export async function updateCustomer(
  client: PoolClient,
  actor: SessionUser,
  partyIdInput: unknown,
  input: UpdateCustomerInput
): Promise<{ customer: CustomerDirectoryItem }> {
  assertRole(actor, [
    "PARTNER_ADMIN",
    "PARTNER_MANAGER",
    "EXTERNAL_SELLER",
    "WAREHOUSE_DELIVERY",
  ]);
  const partyId = parsePositiveInt(partyIdInput, "ID de cliente");

  const existing = await fetchCustomerById(client, partyId);
  if (!existing) {
    throw new ValidationError("Cliente no encontrado");
  }

  const isPartner = actor.role === "PARTNER_ADMIN" || actor.role === "PARTNER_MANAGER";

  if (actor.role === "WAREHOUSE_DELIVERY") {
    if (!existing.is_active) {
      throw new AuthorizationError(
        "Almacén no puede actualizar la ubicación de un cliente inactivo"
      );
    }
    const disallowedForWarehouse = [
      input.tradeName,
      input.legalName,
      input.docType,
      input.docNumber,
      input.phone,
      input.email,
      input.address,
      input.cityZone,
      input.isActive,
      input.creditDaysAgreed,
      input.creditLimitPen,
      input.lastContactDate,
    ].some((val) => val !== undefined);
    if (disallowedForWarehouse) {
      throw new AuthorizationError(
        "Almacén solo puede actualizar la ubicación GPS y referencia de entrega"
      );
    }
  }

  if (actor.role === "EXTERNAL_SELLER") {
    if (input.isActive !== undefined) {
      throw new AuthorizationError(
        "Solo un socio puede activar o desactivar un cliente"
      );
    }
    if (input.creditDaysAgreed !== undefined || input.creditLimitPen !== undefined) {
      throw new AuthorizationError(
        "Solo un socio puede configurar días o límite de crédito"
      );
    }
  }

  const nextTradeName =
    input.tradeName !== undefined
      ? normalizePartyName(input.tradeName)
      : existing.trade_name;

  let nextLegalName =
    input.legalName !== undefined
      ? normalizePartyName(input.legalName)
      : existing.legal_name;

  if (!nextLegalName && nextTradeName) {
    nextLegalName = nextTradeName;
  }
  if (!nextLegalName) {
    throw new ValidationError(
      "El cliente debe mantener al menos un alias o nombre completo"
    );
  }

  if (
    actor.role === "EXTERNAL_SELLER" &&
    existing.has_orders &&
    input.legalName !== undefined &&
    nextLegalName !== normalizePartyName(existing.legal_name)
  ) {
    throw new AuthorizationError(
      "Solo un socio puede modificar el nombre completo/razón social de un cliente con pedidos registrados"
    );
  }

  let nextDocType = existing.doc_type;
  let nextDocNumber = existing.doc_number;
  let nextIsGenericDoc = existing.is_generic_doc;

  const docTouched = input.docType !== undefined || input.docNumber !== undefined;
  if (docTouched) {
    const requestedType =
      input.docType !== undefined ? input.docType : existing.doc_type;
    const requestedNum =
      input.docNumber !== undefined ? input.docNumber : existing.doc_number;
    const normalizedDoc = validateDocumentFields(requestedType, requestedNum);

    if (actor.role === "EXTERNAL_SELLER" && existing.has_orders) {
      const hasExistingRealDoc =
        !existing.is_generic_doc &&
        Boolean(existing.doc_number) &&
        existing.doc_type !== "NONE";
      const docActuallyChanged =
        normalizedDoc.docType !== existing.doc_type ||
        normalizedDoc.docNumber !== existing.doc_number;
      if (hasExistingRealDoc && docActuallyChanged) {
        throw new AuthorizationError(
          "Solo un socio puede cambiar el documento de un cliente con pedidos registrados"
        );
      }
    }

    nextDocType = normalizedDoc.docType;
    nextDocNumber = normalizedDoc.docNumber;
    nextIsGenericDoc = normalizedDoc.isGenericDoc;

    if (!nextIsGenericDoc && nextDocNumber) {
      const dupRes = await client.query(
        `SELECT party_id, COALESCE(trade_name, legal_name) AS display_name
         FROM erp.parties
         WHERE doc_type = $1::erp.doc_id_type
           AND doc_number = $2
           AND is_generic_doc = FALSE
           AND party_id <> $3
         LIMIT 1`,
        [nextDocType, nextDocNumber, partyId]
      );
      if (dupRes.rowCount && dupRes.rowCount > 0) {
        throw new ValidationError(
          `Ya existe otro cliente o proveedor con ${nextDocType} ${nextDocNumber}: ${dupRes.rows[0].display_name}`
        );
      }
    }
  }

  const geoTouched = input.geoLat !== undefined || input.geoLng !== undefined;
  const resolvedGeo = geoTouched
    ? validateAndNormalizeGeo(input.geoLat, input.geoLng, input.geoAccuracyM)
    : {
        geoLat: existing.geo_lat,
        geoLng: existing.geo_lng,
        geoAccuracyM:
          input.geoAccuracyM !== undefined
            ? validateAndNormalizeGeo(
                existing.geo_lat,
                existing.geo_lng,
                input.geoAccuracyM
              ).geoAccuracyM
            : existing.geo_accuracy_m,
      };

  const nextPhone =
    input.phone !== undefined ? normalizeOptionalText(input.phone) : existing.phone;
  const nextEmail =
    input.email !== undefined ? normalizeOptionalEmail(input.email) : existing.email;
  const nextAddress =
    input.address !== undefined
      ? normalizeOptionalText(input.address)
      : existing.address;
  const nextZone =
    input.cityZone !== undefined ? normalizeZone(input.cityZone) : existing.city_zone;
  const nextNotes =
    input.notes !== undefined ? normalizeOptionalText(input.notes) : existing.notes;
  const nextIsActive =
    isPartner && input.isActive !== undefined
      ? Boolean(input.isActive)
      : existing.is_active;
  const nextCreditDaysAgreed =
    isPartner && input.creditDaysAgreed !== undefined
      ? validateCreditDays(input.creditDaysAgreed)
      : existing.credit_days_agreed;
  const nextCreditLimitPen =
    isPartner && input.creditLimitPen !== undefined
      ? validateCreditLimit(input.creditLimitPen)
      : existing.credit_limit_pen;
  const nextLastContactDate =
    input.lastContactDate !== undefined
      ? validateOptionalIsoDate(input.lastContactDate, "Fecha de último contacto")
      : existing.last_contact_date;

  try {
    await client.query(
      `UPDATE erp.parties
       SET trade_name = $1,
           legal_name = $2,
           doc_type = $3::erp.doc_id_type,
           doc_number = $4,
           is_generic_doc = $5,
           phone = $6,
           email = $7,
           address = $8,
           city_zone = $9,
           notes = $10,
           is_active = $11,
           geo_lat = $12,
           geo_lng = $13,
           geo_accuracy_m = $14,
           geo_updated_at = CASE
             WHEN $15::boolean = FALSE THEN geo_updated_at
             WHEN $12::double precision IS NOT NULL THEN NOW()
             ELSE NULL
           END,
           credit_days_agreed = $16,
           credit_limit_pen = $17,
           last_contact_date = $18::date,
           updated_at = NOW()
       WHERE party_id = $19`,
      [
        nextTradeName,
        nextLegalName,
        nextDocType,
        nextDocNumber,
        nextIsGenericDoc,
        nextPhone,
        nextEmail,
        nextAddress,
        nextZone,
        nextNotes,
        nextIsActive,
        resolvedGeo.geoLat,
        resolvedGeo.geoLng,
        resolvedGeo.geoAccuracyM,
        geoTouched,
        nextCreditDaysAgreed,
        nextCreditLimitPen,
        nextLastContactDate,
        partyId,
      ]
    );

    const updated = await fetchCustomerById(client, partyId);
    if (!updated) {
      throw new ValidationError("No se pudo recuperar el cliente actualizado");
    }
    return { customer: updated };
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new ValidationError(
        `Ya existe otra entidad con ${nextDocType} ${nextDocNumber ?? ""}`.trim()
      );
    }
    throw err;
  }
}

/**
 * List suppliers master data for the Partner Directory (`Directorio > Proveedores`)
 * with read-only AP balance summary linking to `Caja`.
 */
export async function listSuppliersDirectory(
  client: PoolClient,
  actor: SessionUser,
  input: ListSuppliersInput = {}
): Promise<{ suppliers: SupplierDirectoryItem[] }> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);

  const statusFilter: CustomerStatusFilter = input.status ?? "ALL";
  const conditions: string[] = [`pa.party_type IN ('SUPPLIER', 'BOTH')`];
  const params: unknown[] = [];

  if (statusFilter === "ACTIVE") {
    conditions.push(`pa.is_active = TRUE`);
  } else if (statusFilter === "INACTIVE") {
    conditions.push(`pa.is_active = FALSE`);
  }

  for (const tok of normalizeSearchQuery(input.q ?? "")) {
    params.push(`%${tok}%`);
    const idx = params.length;
    conditions.push(
      `translate(LOWER(
         COALESCE(pa.trade_name, '') || ' ' ||
         COALESCE(pa.legal_name, '') || ' ' ||
         COALESCE(pa.doc_number, '') || ' ' ||
         COALESCE(pa.phone, '') || ' ' ||
         COALESCE(pa.city_zone, '') || ' ' ||
         COALESCE(pa.address, '')
       ), 'áéíóúüñ', 'aeiouun') LIKE $${idx}`
    );
  }

  const res = await client.query(
    `SELECT
       pa.party_id,
       pa.legal_name,
       pa.trade_name,
       COALESCE(pa.trade_name, pa.legal_name) AS display_name,
       pa.doc_type::text AS doc_type,
       pa.doc_number,
       pa.phone,
       pa.email,
       pa.address,
       pa.city_zone,
       pa.notes,
       pa.is_active,
       COALESCE(SUM(ap.balance_due_pen) FILTER (WHERE ap.status IN ('OPEN', 'PARTIAL')), 0)::NUMERIC(14,2) AS open_ap_balance_pen,
       COUNT(ap.ap_id) FILTER (WHERE ap.status IN ('OPEN', 'PARTIAL'))::int AS open_docs_count
     FROM erp.parties pa
     LEFT JOIN erp.ap_obligations ap ON ap.supplier_party_id = pa.party_id
     WHERE ${conditions.join(" AND ")}
     GROUP BY pa.party_id
     ORDER BY pa.is_active DESC, COALESCE(pa.trade_name, pa.legal_name) ASC`,
    params
  );

  return {
    suppliers: res.rows.map((r) => ({
      party_id: Number(r.party_id),
      legal_name: String(r.legal_name),
      trade_name: r.trade_name ? String(r.trade_name) : null,
      display_name: String(r.display_name),
      doc_type: String(r.doc_type || "NONE"),
      doc_number: r.doc_number ? String(r.doc_number) : null,
      phone: r.phone ? String(r.phone) : null,
      email: r.email ? String(r.email) : null,
      address: r.address ? String(r.address) : null,
      city_zone: r.city_zone ? String(r.city_zone) : null,
      notes: r.notes ? String(r.notes) : null,
      is_active: Boolean(r.is_active),
      open_ap_balance_pen: Number(r.open_ap_balance_pen ?? 0),
      open_docs_count: Number(r.open_docs_count ?? 0),
    })),
  };
}

/**
 * Update a supplier master record in `erp.parties` for partners/managers.
 */
export async function updateSupplier(
  client: PoolClient,
  actor: SessionUser,
  partyIdInput: unknown,
  input: UpdateSupplierInput
): Promise<{ supplier: SupplierDirectoryItem }> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);
  const partyId = parsePositiveInt(partyIdInput, "ID de proveedor");

  const existingRes = await client.query(
    `SELECT
       pa.party_id,
       pa.legal_name,
       pa.trade_name,
       pa.doc_type::text AS doc_type,
       pa.doc_number,
       pa.is_generic_doc,
       pa.phone,
       pa.email,
       pa.address,
       pa.city_zone,
       pa.notes,
       pa.is_active
     FROM erp.parties pa
     WHERE pa.party_id = $1
       AND pa.party_type IN ('SUPPLIER', 'BOTH')
     LIMIT 1`,
    [partyId]
  );
  if (existingRes.rowCount === 0) {
    throw new ValidationError("Proveedor no encontrado");
  }
  const ex = existingRes.rows[0];

  const nextTradeName =
    input.tradeName !== undefined
      ? normalizePartyName(input.tradeName)
      : ex.trade_name
        ? String(ex.trade_name)
        : null;
  let nextLegalName =
    input.legalName !== undefined
      ? normalizePartyName(input.legalName)
      : String(ex.legal_name);

  if (!nextLegalName && nextTradeName) {
    nextLegalName = nextTradeName;
  }
  if (!nextLegalName) {
    throw new ValidationError(
      "El proveedor debe mantener al menos un nombre comercial o razón social"
    );
  }

  let nextDocType = String(ex.doc_type || "NONE");
  let nextDocNumber = ex.doc_number ? String(ex.doc_number) : null;
  let nextIsGenericDoc = Boolean(ex.is_generic_doc);

  if (input.docType !== undefined || input.docNumber !== undefined) {
    const normalizedDoc = validateDocumentFields(
      input.docType !== undefined ? input.docType : ex.doc_type,
      input.docNumber !== undefined ? input.docNumber : ex.doc_number
    );
    nextDocType = normalizedDoc.docType;
    nextDocNumber = normalizedDoc.docNumber;
    nextIsGenericDoc = normalizedDoc.isGenericDoc;

    if (!nextIsGenericDoc && nextDocNumber) {
      const dupRes = await client.query(
        `SELECT party_id, COALESCE(trade_name, legal_name) AS display_name
         FROM erp.parties
         WHERE doc_type = $1::erp.doc_id_type
           AND doc_number = $2
           AND is_generic_doc = FALSE
           AND party_id <> $3
         LIMIT 1`,
        [nextDocType, nextDocNumber, partyId]
      );
      if (dupRes.rowCount && dupRes.rowCount > 0) {
        throw new ValidationError(
          `Ya existe otra entidad con ${nextDocType} ${nextDocNumber}: ${dupRes.rows[0].display_name}`
        );
      }
    }
  }

  try {
    await client.query(
      `UPDATE erp.parties
       SET trade_name = $1,
           legal_name = $2,
           doc_type = $3::erp.doc_id_type,
           doc_number = $4,
           is_generic_doc = $5,
           phone = $6,
           email = $7,
           address = $8,
           city_zone = $9,
           notes = $10,
           is_active = $11,
           updated_at = NOW()
       WHERE party_id = $12`,
      [
        nextTradeName,
        nextLegalName,
        nextDocType,
        nextDocNumber,
        nextIsGenericDoc,
        input.phone !== undefined ? normalizeOptionalText(input.phone) : ex.phone,
        input.email !== undefined ? normalizeOptionalEmail(input.email) : ex.email,
        input.address !== undefined ? normalizeOptionalText(input.address) : ex.address,
        input.cityZone !== undefined ? normalizeZone(input.cityZone) : ex.city_zone,
        input.notes !== undefined ? normalizeOptionalText(input.notes) : ex.notes,
        input.isActive !== undefined ? Boolean(input.isActive) : Boolean(ex.is_active),
        partyId,
      ]
    );

    const { suppliers } = await listSuppliersDirectory(client, actor, {
      status: "ALL",
    });
    const updated = suppliers.find((s) => s.party_id === partyId);
    if (!updated) {
      throw new ValidationError("No se pudo recuperar el proveedor actualizado");
    }
    return { supplier: updated };
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new ValidationError(
        `Ya existe otra entidad con ${nextDocType} ${nextDocNumber ?? ""}`.trim()
      );
    }
    throw err;
  }
}

export interface CustomerCreditSuggestion {
  party_id: number;
  customer_party_id: number;
  customer_name: string;
  credit_days: number;
  current_credit_limit_pen: number | null;
  total_orders: number;
  delivered_orders_6m: number;
  active_months_6m: number;
  avg_monthly_sales_pen: number;
  monthly_run_rate_pen: number;
  cv_monthly_sales: number;
  monthly_cv: number;
  avg_days_overdue: number;
  avg_delay_days: number;
  open_ar_balance_pen: number;
  current_overdue_pen: number;
  punctuality_factor: number;
  volatility_factor: number;
  suggested_credit_limit_pen: number;
  risk_tier: string;
}

export async function getCustomerCreditSuggestion(
  client: PoolClient,
  actorOrPartyId: SessionUser | number | string,
  maybePartyId?: unknown
): Promise<CustomerCreditSuggestion> {
  let partyIdInput: unknown = actorOrPartyId;
  if (
    typeof actorOrPartyId === "object" &&
    actorOrPartyId !== null &&
    "role" in actorOrPartyId
  ) {
    assertRole(actorOrPartyId, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);
    partyIdInput = maybePartyId;
  }
  const partyId = parsePositiveInt(partyIdInput, "ID de cliente");

  const res = await client.query<Record<string, unknown>>(
    `SELECT
       party_id,
       customer_party_id,
       customer_name,
       credit_days,
       current_credit_limit_pen,
       total_orders,
       delivered_orders_6m,
       active_months_6m,
       avg_monthly_sales_pen,
       monthly_run_rate_pen,
       cv_monthly_sales,
       monthly_cv,
       avg_days_overdue,
       avg_delay_days,
       open_ar_balance_pen,
       current_overdue_pen,
       punctuality_factor,
       volatility_factor,
       suggested_credit_limit_pen,
       risk_tier
     FROM analytics.v_customer_credit_suggestion
     WHERE party_id = $1
     LIMIT 1`,
    [partyId]
  );

  if (res.rowCount === 0) {
    throw new ValidationError("Cliente no encontrado para evaluación de crédito");
  }

  const r = res.rows[0];
  return {
    party_id: Number(r.party_id),
    customer_party_id: Number(r.customer_party_id ?? r.party_id),
    customer_name: String(r.customer_name || ""),
    credit_days: Number(r.credit_days ?? 7),
    current_credit_limit_pen:
      r.current_credit_limit_pen !== null && r.current_credit_limit_pen !== undefined
        ? Number(r.current_credit_limit_pen)
        : null,
    total_orders: Number(r.total_orders ?? 0),
    delivered_orders_6m: Number(r.delivered_orders_6m ?? 0),
    active_months_6m: Number(r.active_months_6m ?? 0),
    avg_monthly_sales_pen: Number(r.avg_monthly_sales_pen ?? 0),
    monthly_run_rate_pen: Number(
      r.monthly_run_rate_pen ?? r.avg_monthly_sales_pen ?? 0
    ),
    cv_monthly_sales: Number(r.cv_monthly_sales ?? 0),
    monthly_cv: Number(r.monthly_cv ?? r.cv_monthly_sales ?? 0),
    avg_days_overdue: Number(r.avg_days_overdue ?? 0),
    avg_delay_days: Number(r.avg_delay_days ?? r.avg_days_overdue ?? 0),
    open_ar_balance_pen: Number(r.open_ar_balance_pen ?? 0),
    current_overdue_pen: Number(r.current_overdue_pen ?? 0),
    punctuality_factor: Number(r.punctuality_factor ?? 0),
    volatility_factor: Number(r.volatility_factor ?? 0),
    suggested_credit_limit_pen: Number(r.suggested_credit_limit_pen ?? 0),
    risk_tier: String(r.risk_tier || "UNRATED"),
  };
}
