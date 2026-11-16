import crypto from "crypto";
import type { PoolClient } from "pg";
import { getAuthenticatedERPActor } from "@/lib/auth";
import type { SessionUser, UserRole } from "@/lib/types";
import type { SyncEngineMode, SyncSnapshotResponse, SyncScope } from "./types";

const PARTNER_SCOPES: SyncScope[] = [
  "orders",
  "inventory",
  "collections",
  "treasury",
  "purchases",
  "partners",
];

const SELLER_SCOPES: SyncScope[] = ["orders", "inventory", "collections", "treasury"];

const WAREHOUSE_SCOPES: SyncScope[] = ["orders", "inventory"];

export interface NeonRealtimeConfig {
  enabled: boolean;
  realtimeUrl: string | null;
  hasSecret: boolean;
  databaseName: string;
}

/**
 * Inspect whether Neon Realtime (@neon/realtime) is configured in environment variables.
 * Never exposes secret values; safe for readiness diagnostics and mode selection.
 */
export function getNeonRealtimeConfig(): NeonRealtimeConfig {
  const realtimeUrl = process.env.NEON_REALTIME_URL?.trim() || null;
  const hasSecret = Boolean(process.env.NEON_REALTIME_SECRET?.trim());
  const branch = process.env.BHT_DB_BRANCH?.trim().toLowerCase();
  if (branch && branch !== "dev" && branch !== "main") {
    throw new Error("BHT_DB_BRANCH debe ser dev o main");
  }
  const isMain = branch ? branch === "main" : process.env.VERCEL_ENV === "production";
  const rawDbUrl = isMain
    ? process.env.NEON_DATABASE_URL_MAIN || process.env.DATABASE_URL || ""
    : process.env.NEON_DATABASE_URL_DEV || process.env.DEV_DATABASE_URL || "";
  let databaseName = "bht_erp";
  if (rawDbUrl) {
    try {
      const parsed = new URL(rawDbUrl);
      const pathname = parsed.pathname.replace(/^\//, "").trim();
      if (pathname) databaseName = pathname;
    } catch {
      // Keep default database name when URL is non-standard
    }
  }
  return {
    enabled: Boolean(realtimeUrl && hasSecret),
    realtimeUrl,
    hasSecret,
    databaseName,
  };
}

/** Resolve the current Neon Auth session to an active ERP identity. */
export async function getSessionUser(): Promise<SessionUser | null> {
  return getAuthenticatedERPActor();
}

/** Return the ordered list of sync scopes visible to the given role. */
export function getAllowedScopesForRole(role: UserRole): SyncScope[] {
  if (role === "WAREHOUSE_DELIVERY") return [...WAREHOUSE_SCOPES];
  if (role === "EXTERNAL_SELLER") return [...SELLER_SCOPES];
  return [...PARTNER_SCOPES];
}

function getRoleTag(role: UserRole): "w" | "s" | "p" {
  if (role === "WAREHOUSE_DELIVERY") return "w";
  if (role === "EXTERNAL_SELLER") return "s";
  return "p";
}

function hashScopeDigest(
  roleTag: "w" | "s" | "p",
  scope: SyncScope,
  rawDigest: string
): string {
  return crypto
    .createHash("sha256")
    .update(`bht-sync:v1:${roleTag}:${scope}:${rawDigest}`)
    .digest("hex")
    .slice(0, 12);
}

interface RawWatermarkRow {
  orders_ops_sig: string;
  lines_ops_sig: string;
  events_sig: string;
  inv_sig: string;
  prod_ops_sig: string;
  orders_fin_sig?: string;
  customers_sig?: string;
  prod_price_sig?: string;
  prod_cost_sig?: string;
  ar_sig?: string;
  ledger_route_sig?: string;
  ledger_all_sig?: string;
  cash_accounts_sig?: string;
  purchases_sig?: string;
  ap_sig?: string;
  suppliers_sig?: string;
  users_sig?: string;
  flags_sig?: string;
  quotes_sig?: string;
  trips_sig?: string;
}

/**
 * Compute per-scope watermarks in a single Postgres round-trip, strictly restricting
 * queried columns and tables to what the caller's RBAC role is allowed to observe.
 */
async function queryRoleWatermarks(
  client: PoolClient,
  role: UserRole
): Promise<Record<SyncScope, string>> {
  const roleTag = getRoleTag(role);

  if (role === "WAREHOUSE_DELIVERY") {
    const res = await client.query<RawWatermarkRow>(`
      SELECT
        (SELECT COALESCE(MAX(ops_seq), 0)::text || ':' || COUNT(*)::text
         FROM erp.sales_orders
         WHERE source_origin = 'ERP_APP'
           AND operational_status <> 'PENDING_PARTNER_APPROVAL') AS orders_ops_sig,
        (SELECT COALESCE(MAX(sol.ops_seq), 0)::text || ':' || COUNT(*)::text
         FROM erp.sales_order_lines sol
         JOIN erp.sales_orders so ON so.order_id = sol.order_id
         WHERE so.source_origin = 'ERP_APP'
           AND so.operational_status <> 'PENDING_PARTNER_APPROVAL') AS lines_ops_sig,
        (SELECT COALESCE(MAX(event_id), 0)::text || ':' || COUNT(*)::text
         FROM erp.sales_order_events) AS events_sig,
        (SELECT COALESCE(MAX(sync_seq), 0)::text || ':' || COUNT(*)::text
         FROM erp.route_trips) AS trips_sig,
        (SELECT COALESCE(MAX(movement_id), 0)::text || ':' || COUNT(*)::text || ':' ||
                COALESCE(SUM(quantity_delta), 0)::text
         FROM erp.inventory_movements) AS inv_sig,
        (SELECT COALESCE(MAX(ops_seq), 0)::text || ':' || COUNT(*)::text
         FROM erp.products) AS prod_ops_sig
    `);

    const row = res.rows[0];
    return {
      orders: hashScopeDigest(
        roleTag,
        "orders",
        `${row.orders_ops_sig}|${row.lines_ops_sig}|${row.events_sig}|${row.trips_sig}`
      ),
      inventory: hashScopeDigest(
        roleTag,
        "inventory",
        `${row.inv_sig}|${row.prod_ops_sig}`
      ),
    } as Record<SyncScope, string>;
  }

  if (role === "EXTERNAL_SELLER") {
    const res = await client.query<RawWatermarkRow>(`
      SELECT
        (SELECT COALESCE(MAX(ops_seq), 0)::text || ':' || COUNT(*)::text
         FROM erp.sales_orders) AS orders_ops_sig,
        (SELECT COALESCE(MAX(ops_seq), 0)::text || ':' || COUNT(*)::text || ':' ||
                COALESCE(MAX(price_seq), 0)::text
         FROM erp.sales_order_lines) AS lines_ops_sig,
        (SELECT COALESCE(MAX(event_id), 0)::text || ':' || COUNT(*)::text
         FROM erp.sales_order_events) AS events_sig,
        (SELECT COALESCE(MAX(fin_seq), 0)::text || ':' || COUNT(*)::text
         FROM erp.sales_orders) AS orders_fin_sig,
        (SELECT COALESCE(MAX(sync_seq), 0)::text || ':' || COUNT(*)::text
         FROM erp.parties
         WHERE party_type IN ('CUSTOMER', 'BOTH')) AS customers_sig,
        (SELECT COALESCE(MAX(sync_seq), 0)::text || ':' || COUNT(*)::text
         FROM erp.quotes) AS quotes_sig,
        (SELECT COALESCE(MAX(sync_seq), 0)::text || ':' || COUNT(*)::text
         FROM erp.route_trips) AS trips_sig,
        (SELECT COALESCE(MAX(movement_id), 0)::text || ':' || COUNT(*)::text || ':' ||
                COALESCE(SUM(quantity_delta), 0)::text
         FROM erp.inventory_movements) AS inv_sig,
        (SELECT COALESCE(MAX(ops_seq), 0)::text || ':' || COUNT(*)::text
         FROM erp.products) AS prod_ops_sig,
        (SELECT COALESCE(MAX(price_seq), 0)::text || ':' || COUNT(*)::text
         FROM erp.products) AS prod_price_sig,
        (SELECT COALESCE(MAX(ar_payment_id), 0)::text || ':' || COUNT(*)::text || ':' ||
                COALESCE(SUM(amount_pen), 0)::text
         FROM erp.ar_payments) AS ar_sig,
        (SELECT COALESCE(MAX(ledger_id), 0)::text || ':' || COUNT(*)::text || ':' ||
                COALESCE(SUM(amount_pen), 0)::text
         FROM erp.cash_ledger
         WHERE expense_bucket = 'ROUTE_OPEX'
           AND source_origin = 'ERP_APP') AS ledger_route_sig,
        (SELECT COALESCE(MAX(sync_seq), 0)::text || ':' || COUNT(*)::text
         FROM erp.cash_accounts) AS cash_accounts_sig
    `);

    const row = res.rows[0];
    return {
      orders: hashScopeDigest(
        roleTag,
        "orders",
        `${row.orders_ops_sig}|${row.lines_ops_sig}|${row.events_sig}|${row.orders_fin_sig}|${row.customers_sig}|${row.quotes_sig}|${row.trips_sig}`
      ),
      inventory: hashScopeDigest(
        roleTag,
        "inventory",
        `${row.inv_sig}|${row.prod_ops_sig}|${row.prod_price_sig}`
      ),
      collections: hashScopeDigest(
        roleTag,
        "collections",
        `${row.ar_sig}|${row.orders_fin_sig}`
      ),
      treasury: hashScopeDigest(
        roleTag,
        "treasury",
        `${row.ledger_route_sig}|${row.cash_accounts_sig}`
      ),
    } as Record<SyncScope, string>;
  }

  // PARTNER_ADMIN & PARTNER_MANAGER: full operational & BI scope watermarks
  const res = await client.query<RawWatermarkRow>(`
    SELECT
      (SELECT COALESCE(MAX(ops_seq), 0)::text || ':' || COUNT(*)::text
       FROM erp.sales_orders) AS orders_ops_sig,
      (SELECT COALESCE(MAX(ops_seq), 0)::text || ':' || COUNT(*)::text || ':' ||
              COALESCE(MAX(price_seq), 0)::text || ':' ||
              COALESCE(MAX(cost_seq), 0)::text
       FROM erp.sales_order_lines) AS lines_ops_sig,
      (SELECT COALESCE(MAX(event_id), 0)::text || ':' || COUNT(*)::text
       FROM erp.sales_order_events) AS events_sig,
      (SELECT COALESCE(MAX(fin_seq), 0)::text || ':' || COUNT(*)::text
       FROM erp.sales_orders) AS orders_fin_sig,
      (SELECT COALESCE(MAX(sync_seq), 0)::text || ':' || COUNT(*)::text
       FROM erp.parties
       WHERE party_type IN ('CUSTOMER', 'BOTH')) AS customers_sig,
      (SELECT COALESCE(MAX(movement_id), 0)::text || ':' || COUNT(*)::text || ':' ||
              COALESCE(SUM(quantity_delta), 0)::text
       FROM erp.inventory_movements) AS inv_sig,
      (SELECT COALESCE(MAX(ops_seq), 0)::text || ':' || COUNT(*)::text
       FROM erp.products) AS prod_ops_sig,
      (SELECT COALESCE(MAX(price_seq), 0)::text || ':' || COUNT(*)::text || ':' ||
              COALESCE(MAX(cost_seq), 0)::text
       FROM erp.products) AS prod_cost_sig,
      (SELECT COALESCE(MAX(ar_payment_id), 0)::text || ':' || COUNT(*)::text || ':' ||
              COALESCE(SUM(amount_pen), 0)::text
       FROM erp.ar_payments) AS ar_sig,
      (SELECT COALESCE(MAX(ledger_id), 0)::text || ':' || COUNT(*)::text || ':' ||
              COALESCE(SUM(amount_pen), 0)::text
       FROM erp.cash_ledger) AS ledger_all_sig,
      (SELECT COALESCE(MAX(sync_seq), 0)::text || ':' || COUNT(*)::text
       FROM erp.cash_accounts) AS cash_accounts_sig,
      (SELECT COALESCE(MAX(purchase_id), 0)::text || ':' || COUNT(*)::text || ':' ||
              COALESCE(SUM(total_pen), 0)::text
       FROM erp.purchase_invoices) AS purchases_sig,
      (SELECT COALESCE(MAX(sync_seq), 0)::text || ':' || COUNT(*)::text
       FROM erp.ap_obligations) AS ap_sig,
      (SELECT COALESCE(MAX(sync_seq), 0)::text || ':' || COUNT(*)::text
       FROM erp.parties
       WHERE party_type IN ('SUPPLIER', 'BOTH')) AS suppliers_sig,
      (SELECT COALESCE(MAX(sync_seq), 0)::text || ':' || COUNT(*)::text
       FROM erp.app_users) AS users_sig,
      (SELECT COALESCE(MAX(sync_seq), 0)::text || ':' || COUNT(*)::text || ':' ||
              COUNT(*) FILTER (WHERE status = 'OPEN')::text
       FROM erp.audit_flags) AS flags_sig,
      (SELECT COALESCE(MAX(sync_seq), 0)::text || ':' || COUNT(*)::text
       FROM erp.quotes) AS quotes_sig,
      (SELECT COALESCE(MAX(sync_seq), 0)::text || ':' || COUNT(*)::text
       FROM erp.route_trips) AS trips_sig
  `);

  const row = res.rows[0];
  const ordersDigest = `${row.orders_ops_sig}|${row.lines_ops_sig}|${row.events_sig}|${row.orders_fin_sig}|${row.customers_sig}|${row.quotes_sig}|${row.trips_sig}`;
  const inventoryDigest = `${row.inv_sig}|${row.prod_ops_sig}|${row.prod_cost_sig}`;
  const collectionsDigest = `${row.ar_sig}|${row.orders_fin_sig}`;
  const treasuryDigest = `${row.ledger_all_sig}|${row.cash_accounts_sig}`;
  const purchasesDigest = `${row.purchases_sig}|${row.ap_sig}|${row.suppliers_sig}|${row.lines_ops_sig}`;
  const partnersDigest = `${ordersDigest}|${inventoryDigest}|${collectionsDigest}|${treasuryDigest}|${purchasesDigest}|${row.users_sig}|${row.flags_sig}|${row.quotes_sig}|${row.trips_sig}`;

  return {
    orders: hashScopeDigest(roleTag, "orders", ordersDigest),
    inventory: hashScopeDigest(roleTag, "inventory", inventoryDigest),
    collections: hashScopeDigest(roleTag, "collections", collectionsDigest),
    treasury: hashScopeDigest(roleTag, "treasury", treasuryDigest),
    purchases: hashScopeDigest(roleTag, "purchases", purchasesDigest),
    partners: hashScopeDigest(roleTag, "partners", partnersDigest),
  };
}

function encodeVersion(
  roleTag: "w" | "s" | "p",
  allowedScopes: SyncScope[],
  hashes: Record<SyncScope, string>
): string {
  const parts = allowedScopes.map((scope) => `${scope}:${hashes[scope]}`);
  return `v1.${roleTag}.${parts.join(",")}`;
}

function parsePreviousHashes(
  since: string | null | undefined,
  expectedRoleTag: "w" | "s" | "p",
  allowedScopes: SyncScope[]
): Partial<Record<SyncScope, string>> | null {
  if (!since || !since.trim()) return null;
  const trimmed = since.trim();
  if (!trimmed.startsWith(`v1.${expectedRoleTag}.`)) return null;
  const rest = trimmed.slice(`v1.${expectedRoleTag}.`.length);
  if (!rest) return null;

  const allowedSet = new Set<string>(allowedScopes);
  const parsed: Partial<Record<SyncScope, string>> = {};
  for (const entry of rest.split(",")) {
    const colonIdx = entry.indexOf(":");
    if (colonIdx <= 0) return null;
    const scope = entry.slice(0, colonIdx);
    const hash = entry.slice(colonIdx + 1);
    if (!allowedSet.has(scope) || !/^[a-f0-9]{8,64}$/i.test(hash)) {
      return null;
    }
    parsed[scope as SyncScope] = hash;
  }

  for (const scope of allowedScopes) {
    if (!parsed[scope]) return null;
  }
  return parsed;
}

/**
 * Compute a deterministic, RBAC-scoped synchronization snapshot comparing against `since`.
 * Returns changedScopes = [] when establishing a baseline (no `since` passed) or when
 * the database state for the caller's role is unchanged.
 */
export async function computeSyncSnapshot(
  client: PoolClient,
  actor: SessionUser,
  since?: string | null,
  requestedScopes?: SyncScope[] | null
): Promise<SyncSnapshotResponse> {
  const allowedScopes = getAllowedScopesForRole(actor.role);
  const roleTag = getRoleTag(actor.role);
  const hashes = await queryRoleWatermarks(client, actor.role);
  const version = encodeVersion(roleTag, allowedScopes, hashes);

  let changedScopes: SyncScope[] = [];
  if (since && since.trim()) {
    if (since.trim() !== version) {
      const prev = parsePreviousHashes(since, roleTag, allowedScopes);
      if (!prev) {
        changedScopes = [...allowedScopes];
      } else {
        changedScopes = allowedScopes.filter((s) => prev[s] !== hashes[s]);
      }
    }
  }

  if (requestedScopes) {
    const reqSet = new Set(requestedScopes);
    changedScopes = changedScopes.filter((s) => reqSet.has(s));
  }

  const mode: SyncEngineMode = getNeonRealtimeConfig().enabled
    ? "neon-realtime"
    : "postgres-watermark";

  return {
    version,
    changedScopes,
    allowedScopes,
    serverTime: new Date().toISOString(),
    mode,
  };
}

/** Parse and filter an optional comma-separated `scopes` query parameter against role RBAC. */
export function parseRequestedScopes(
  rawScopes: string | null,
  role: UserRole
): SyncScope[] | null {
  if (!rawScopes || !rawScopes.trim()) return null;
  const allowed = new Set<SyncScope>(getAllowedScopesForRole(role));
  const filtered = rawScopes
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SyncScope => allowed.has(s as SyncScope));
  return filtered.length > 0 ? Array.from(new Set(filtered)) : [];
}
