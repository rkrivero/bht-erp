import type { PoolClient } from "pg";
import { assertRole } from "../rbac";
import type { SessionUser } from "../types";

export interface PriceOverrideEntry {
  entityType: "ORDER" | "QUOTE";
  entityId: number;
  entityCode: string;
  lineNo: number;
  productId: number;
  sku: string;
  productName: string;
  customerPartyId: number | null;
  customerName: string;
  catalogPricePen: number;
  appliedPricePen: number;
  quantity: number;
  reason?: string | null;
}

export interface PriceOverrideLogRow {
  override_id: number;
  entity_type: "ORDER" | "QUOTE";
  entity_id: number;
  entity_code: string;
  line_no: number;
  product_id: number;
  sku: string;
  product_name: string;
  customer_party_id: number | null;
  customer_name: string;
  catalog_price_pen: number;
  applied_price_pen: number;
  delta_pen: number;
  direction: "LOWER" | "HIGHER";
  quantity: number;
  total_impact_pen: number;
  actor_user_id: number;
  actor_name: string;
  actor_role: string;
  reason: string | null;
  event_date: string;
  created_at: string;
}

const PRICE_EPSILON = 0.005;

/**
 * Records immutable audit entries in erp.price_override_log for every line
 * whose applied unit price differs from the catalog list price (either lower
 * or higher). Lines matching catalog price within 0.005 PEN are skipped.
 */
export async function recordPriceOverrides(
  client: PoolClient,
  actor: SessionUser,
  entries: PriceOverrideEntry[]
): Promise<number> {
  const modified = entries.filter((entry) => {
    if (
      !Number.isFinite(entry.catalogPricePen) ||
      !Number.isFinite(entry.appliedPricePen)
    ) {
      return false;
    }
    return Math.abs(entry.appliedPricePen - entry.catalogPricePen) > PRICE_EPSILON;
  });

  if (modified.length === 0) return 0;

  const valueClauses: string[] = [];
  const params: unknown[] = [];

  for (const entry of modified) {
    const catalogPrice = Number(entry.catalogPricePen.toFixed(4));
    const appliedPrice = Number(entry.appliedPricePen.toFixed(4));
    const delta = Number((appliedPrice - catalogPrice).toFixed(4));
    const direction: "LOWER" | "HIGHER" = delta < 0 ? "LOWER" : "HIGHER";
    const totalImpact = Number((delta * entry.quantity).toFixed(2));
    const offset = params.length;

    valueClauses.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18}, $${offset + 19})`
    );
    params.push(
      entry.entityType,
      entry.entityId,
      entry.entityCode,
      entry.lineNo,
      entry.productId,
      entry.sku,
      entry.productName,
      entry.customerPartyId,
      entry.customerName,
      catalogPrice,
      appliedPrice,
      delta,
      direction,
      entry.quantity,
      totalImpact,
      actor.userId,
      actor.fullName || actor.username,
      actor.role,
      entry.reason?.trim() || null
    );
  }

  await client.query(
    `INSERT INTO erp.price_override_log (
       entity_type, entity_id, entity_code, line_no,
       product_id, sku, product_name,
       customer_party_id, customer_name,
       catalog_price_pen, applied_price_pen, delta_pen, direction,
       quantity, total_impact_pen,
       actor_user_id, actor_name, actor_role, reason
     ) VALUES ${valueClauses.join(", ")}`,
    params
  );

  return modified.length;
}

export async function listPriceOverrides(
  client: PoolClient,
  actor: SessionUser,
  options: {
    limit?: number;
    entityType?: "ORDER" | "QUOTE" | "ALL";
    productId?: number | null;
    customerPartyId?: number | null;
  } = {}
): Promise<PriceOverrideLogRow[]> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);

  const safeLimit = Math.max(1, Math.min(300, Math.floor(options.limit ?? 100)));
  const entityType =
    options.entityType === "ORDER" || options.entityType === "QUOTE"
      ? options.entityType
      : null;
  const productId = options.productId ?? null;
  const customerPartyId = options.customerPartyId ?? null;

  const res = await client.query<Record<string, unknown>>(
    `SELECT
       override_id,
       entity_type,
       entity_id,
       entity_code,
       line_no,
       product_id,
       sku,
       product_name,
       customer_party_id,
       customer_name,
       catalog_price_pen,
       applied_price_pen,
       delta_pen,
       direction,
       quantity,
       total_impact_pen,
       actor_user_id,
       actor_name,
       actor_role,
       reason,
       event_date::text AS event_date,
       created_at::text AS created_at
     FROM erp.price_override_log
     WHERE ($1::text IS NULL OR entity_type = $1)
       AND ($2::bigint IS NULL OR product_id = $2)
       AND ($3::bigint IS NULL OR customer_party_id = $3)
     ORDER BY created_at DESC, override_id DESC
     LIMIT $4`,
    [entityType, productId, customerPartyId, safeLimit]
  );

  return res.rows.map((r) => ({
    override_id: Number(r.override_id),
    entity_type: String(r.entity_type) as "ORDER" | "QUOTE",
    entity_id: Number(r.entity_id),
    entity_code: String(r.entity_code),
    line_no: Number(r.line_no),
    product_id: Number(r.product_id),
    sku: String(r.sku),
    product_name: String(r.product_name),
    customer_party_id:
      r.customer_party_id !== null && r.customer_party_id !== undefined
        ? Number(r.customer_party_id)
        : null,
    customer_name: String(r.customer_name),
    catalog_price_pen: Number(r.catalog_price_pen),
    applied_price_pen: Number(r.applied_price_pen),
    delta_pen: Number(r.delta_pen),
    direction: String(r.direction) as "LOWER" | "HIGHER",
    quantity: Number(r.quantity),
    total_impact_pen: Number(r.total_impact_pen),
    actor_user_id: Number(r.actor_user_id),
    actor_name: String(r.actor_name),
    actor_role: String(r.actor_role),
    reason: r.reason ? String(r.reason) : null,
    event_date: String(r.event_date),
    created_at: String(r.created_at),
  }));
}
