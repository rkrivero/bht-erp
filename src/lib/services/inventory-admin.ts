import type { PoolClient } from "pg";
import { isPartnerRole } from "../rbac";
import {
  AuthorizationError,
  type FulfillmentMode,
  parsePositiveInt,
  type SessionUser,
  ValidationError,
} from "../types";

async function resolveNonNegativeStockFlags(
  client: PoolClient,
  actorUsername: string,
  productIds?: number[]
): Promise<void> {
  if (productIds && productIds.length === 0) return;
  const filterSql = productIds ? "AND vcs.product_id = ANY($2::bigint[])" : "";
  const params = productIds ? [actorUsername, productIds] : [actorUsername];
  await client.query(
    `UPDATE erp.audit_flags af
     SET status = 'RESOLVED',
         resolved_at = NOW(),
         resolved_by = $1
     WHERE af.status = 'OPEN'
       AND af.flag_code IN ('ON_DEMAND_STOCK_DEFICIT', 'UNPURCHASED_STOCK_DEFICIT')
       AND af.entity_table = 'erp.products'
       AND af.entity_id IN (
         SELECT vcs.product_id::text
         FROM erp.v_current_stock vcs
         WHERE vcs.warehouse_code = 'MAIN'
           AND vcs.stock_on_hand >= -0.0001
           ${filterSql}
       )`,
    params
  );
}

export async function resetHistoricalNegativeStock(
  client: PoolClient,
  actor: SessionUser
): Promise<{ adjustedSkuCount: number }> {
  if (!isPartnerRole(actor.role)) {
    throw new AuthorizationError(
      "Solo los Socios pueden poner en 0 los saldos negativos históricos"
    );
  }

  const locked = await client.query<{ product_id: number }>(
    `SELECT p.product_id
     FROM erp.v_current_stock vcs
     JOIN erp.products p ON p.product_id = vcs.product_id
     WHERE vcs.warehouse_code = 'MAIN'
       AND vcs.stock_on_hand < -0.0001
     ORDER BY p.product_id ASC
     FOR UPDATE OF p`
  );

  const insertRes = await client.query(
    `INSERT INTO erp.inventory_movements (
       warehouse_id, product_id, movement_date, movement_type,
       quantity_delta, source_origin, notes
     )
     SELECT
       warehouse_id,
       product_id,
       NOW(),
       'ADJUSTMENT',
       ABS(stock_on_hand),
       'ERP_APP',
       'RESET_HISTORICAL_DEFICIT by ' || $1 || ' (' || sku || ')'
     FROM erp.v_current_stock
     WHERE warehouse_code = 'MAIN'
       AND stock_on_hand < -0.0001
     ORDER BY product_id ASC`,
    [actor.username]
  );

  const adjustedIds = locked.rows.map((r) => Number(r.product_id));
  await resolveNonNegativeStockFlags(client, actor.username, adjustedIds);

  return { adjustedSkuCount: insertRes.rowCount ?? 0 };
}

function validateNonNegativePrice(
  value: number | undefined,
  label: string
): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ValidationError(`${label} debe ser un monto válido mayor o igual a 0`);
  }
  return Number(parsed.toFixed(4));
}

export async function updateProductStockAndPricing(
  client: PoolClient,
  actor: SessionUser,
  input: {
    productId: number;
    physicalStock?: number;
    refCostPen?: number;
    listSalePricePen?: number;
    minSalePricePen?: number;
    fulfillmentMode?: FulfillmentMode;
    minStockQty?: number | null;
    leadTimeDays?: number | null;
    defaultSupplierPartyId?: number | null;
  }
): Promise<void> {
  if (!isPartnerRole(actor.role)) {
    throw new AuthorizationError(
      "Solo los Socios pueden actualizar costos, precios mínimos y stock físico"
    );
  }

  const productId = parsePositiveInt(input.productId, "Producto");
  const validatedRefCost = validateNonNegativePrice(
    input.refCostPen,
    "El costo de referencia"
  );
  const validatedListPrice = validateNonNegativePrice(
    input.listSalePricePen,
    "El precio de lista"
  );
  const validatedMinPrice = validateNonNegativePrice(
    input.minSalePricePen,
    "El precio mínimo"
  );

  const whRes = await client.query(
    `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1`
  );
  if (whRes.rowCount === 0) {
    throw new ValidationError("Almacén MAIN no encontrado");
  }
  const warehouseId = Number(whRes.rows[0].warehouse_id);

  const prodLock = await client.query(
    `SELECT product_id FROM erp.products WHERE product_id = $1 FOR UPDATE`,
    [productId]
  );
  if (prodLock.rowCount === 0) {
    throw new ValidationError("Producto no encontrado");
  }

  const hasMinStockQty = input.minStockQty !== undefined;
  let validatedMinStockQty: number | null = null;
  if (hasMinStockQty && input.minStockQty !== null) {
    const val = Number(input.minStockQty);
    if (!Number.isFinite(val) || val < 0) {
      throw new ValidationError("El stock mínimo no puede ser negativo");
    }
    validatedMinStockQty = Number(val.toFixed(4));
  }

  const hasLeadTimeDays = input.leadTimeDays !== undefined;
  let validatedLeadTimeDays: number | null = null;
  if (hasLeadTimeDays && input.leadTimeDays !== null) {
    const val = Number(input.leadTimeDays);
    if (!Number.isInteger(val) || val < 0 || val > 365) {
      throw new ValidationError("El plazo de reposición debe estar entre 0 y 365 días");
    }
    validatedLeadTimeDays = val;
  }

  const hasDefaultSupplier = input.defaultSupplierPartyId !== undefined;
  let validatedDefaultSupplierId: number | null = null;
  if (hasDefaultSupplier && input.defaultSupplierPartyId !== null) {
    const supId = parsePositiveInt(input.defaultSupplierPartyId, "Proveedor habitual");
    const supCheck = await client.query(
      `SELECT 1 FROM erp.parties WHERE party_id = $1 AND party_type IN ('SUPPLIER', 'BOTH') LIMIT 1`,
      [supId]
    );
    if (supCheck.rowCount === 0) {
      throw new ValidationError("El proveedor habitual seleccionado no existe");
    }
    validatedDefaultSupplierId = supId;
  }

  if (
    validatedRefCost !== null ||
    validatedListPrice !== null ||
    validatedMinPrice !== null ||
    input.fulfillmentMode !== undefined ||
    hasMinStockQty ||
    hasLeadTimeDays ||
    hasDefaultSupplier
  ) {
    await client.query(
      `UPDATE erp.products
       SET ref_cost_pen = COALESCE($1, ref_cost_pen),
           cost_source = CASE WHEN $1 IS NOT NULL THEN 'MANUAL_PARTNER' ELSE cost_source END,
           cost_updated_at = CASE WHEN $1 IS NOT NULL THEN NOW() ELSE cost_updated_at END,
           list_sale_price_pen = COALESCE($2, list_sale_price_pen),
           min_sale_price_pen = COALESCE($3, min_sale_price_pen),
           fulfillment_mode = COALESCE($4::erp.fulfillment_mode, fulfillment_mode),
           min_stock_qty = CASE WHEN $6::boolean THEN $7::numeric(14,4) ELSE min_stock_qty END,
           lead_time_days = CASE WHEN $8::boolean THEN $9::int ELSE lead_time_days END,
           default_supplier_party_id = CASE WHEN $10::boolean THEN $11::bigint ELSE default_supplier_party_id END,
           updated_at = NOW()
       WHERE product_id = $5`,
      [
        validatedRefCost,
        validatedListPrice,
        validatedMinPrice,
        input.fulfillmentMode ?? null,
        productId,
        hasMinStockQty,
        validatedMinStockQty,
        hasLeadTimeDays,
        validatedLeadTimeDays,
        hasDefaultSupplier,
        validatedDefaultSupplierId,
      ]
    );
  }

  if (input.physicalStock !== undefined) {
    const targetStock = Number(input.physicalStock);
    if (!Number.isFinite(targetStock) || targetStock < 0) {
      throw new ValidationError("El stock físico no puede ser negativo");
    }
    const stockRes = await client.query(
      `SELECT COALESCE(stock_on_hand, 0) AS stock_on_hand
       FROM erp.v_current_stock
       WHERE warehouse_id = $1 AND product_id = $2`,
      [warehouseId, productId]
    );
    const currentStock =
      stockRes.rowCount && stockRes.rowCount > 0
        ? Number(stockRes.rows[0].stock_on_hand)
        : 0;
    const delta = Number((targetStock - currentStock).toFixed(4));
    if (Math.abs(delta) > 0.0001) {
      await client.query(
        `INSERT INTO erp.inventory_movements (
           warehouse_id, product_id, movement_date, movement_type,
           quantity_delta, unit_cost_pen, source_origin, notes
         ) VALUES ($1, $2, NOW(), 'ADJUSTMENT', $3, $4, 'ERP_APP', $5)`,
        [
          warehouseId,
          productId,
          delta,
          validatedRefCost,
          `CONTEO_FISICO_DIA_1 by ${actor.username} (target=${targetStock})`,
        ]
      );
    }
    await resolveNonNegativeStockFlags(client, actor.username, [productId]);
  }
}
