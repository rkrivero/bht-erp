import type { PoolClient } from "pg";
import type {
  DataCutSummary,
  IncompleteOrderSummary,
  LatestDailyClosureSummary,
  OperationalQualitySummary,
  StartupChecklistItem,
  WeeklyCoverageCohort,
} from "@/components/socios/types";

export const DATA_CUT_SELECT = `
  json_build_object(
    'as_of_lima_date', (NOW() AT TIME ZONE 'America/Lima')::date::text,
    'last_order_date', (
      SELECT MAX(order_date)::text
      FROM erp.sales_orders
      WHERE operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    ),
    'last_payment_date', (SELECT MAX(payment_date)::text FROM erp.ar_payments WHERE voided_at IS NULL),
    'last_cash_ledger_date', (SELECT MAX(tx_date)::text FROM erp.cash_ledger),
    'last_purchase_date', (SELECT MAX(issue_date)::text FROM erp.purchase_invoices),
    'last_quote_date', (SELECT MAX(issue_date)::text FROM erp.quotes),
    'days_since_last_order', (
      SELECT ((NOW() AT TIME ZONE 'America/Lima')::date - MAX(order_date))::int
      FROM erp.sales_orders
      WHERE operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    ),
    'open_bank_flags', COALESCE((
      SELECT COUNT(*)::int
      FROM erp.audit_flags
      WHERE status = 'OPEN'
        AND flag_code = 'MISSING_BANK_STATEMENT_LEDGER'
    ), 0)
  )
`;

function asIsoString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asInt(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function asNum(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

export function mapDataCutSummary(raw: unknown): DataCutSummary {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const asOfLimaDate = asIsoString(obj.as_of_lima_date) ?? "";
  const lastOrderDate = asIsoString(obj.last_order_date);
  const lastPaymentDate = asIsoString(obj.last_payment_date);
  const lastCashLedgerDate = asIsoString(obj.last_cash_ledger_date);
  const lastPurchaseDate = asIsoString(obj.last_purchase_date);
  const lastQuoteDate = asIsoString(obj.last_quote_date);
  const daysSinceLastOrder =
    obj.days_since_last_order !== null &&
    obj.days_since_last_order !== undefined &&
    Number.isFinite(Number(obj.days_since_last_order))
      ? Math.trunc(Number(obj.days_since_last_order))
      : null;
  const openBankFlags = asInt(obj.open_bank_flags);

  return {
    asOfLimaDate,
    lastOrderDate,
    lastPaymentDate,
    lastCashLedgerDate,
    lastPurchaseDate,
    lastQuoteDate,
    daysSinceLastOrder,
    isStale:
      lastOrderDate === null || (daysSinceLastOrder !== null && daysSinceLastOrder > 7),
    bankReconciled: openBankFlags === 0,
  };
}

interface QualityQueryRow {
  coverage_numerator: number;
  coverage_denominator: number;
  correction_count: number;
  weekly_cohorts: Array<{
    week_start: string;
    total_orders: number;
    complete_orders: number;
    correction_count: number;
  }>;
  latest_daily_closure: {
    closure_date: string;
    variance_total_pen: number | string;
    closed_by_name: string;
    updated_at: string;
  } | null;
  incomplete_orders: Array<{
    order_id: number;
    order_code: string;
    order_date: string;
    has_customer: boolean;
    has_lines_and_costs: boolean;
    has_seller: boolean;
    has_explicit_mode: boolean;
    has_payment_account: boolean;
    has_credit_due: boolean;
    within_24h: boolean;
  }>;
  erp_app_orders_count: number;
  total_orders_count: number;
  orders_missing_seller_count: number;
  active_products_count: number;
  products_missing_cost_count: number;
  sold_skus_missing_cost_count: number;
  sold_skus_missing_cost_pen: number | string;
  purchases_total_count: number;
  purchases_without_detail_count: number;
  active_customers_count: number;
  customers_missing_phone_count: number;
  customers_missing_zone_count: number;
  customers_missing_geo_count: number;
  trips_total_count: number;
  trips_without_reconciliation_count: number;
  assumed_cash_orders_count: number;
  assumed_cash_orders_pen: number | string;
  negative_stock_sku_count: number;
  open_bank_audit_flags_count: number;
  ap_no_due_date_count: number;
}

function buildMissingFields(
  row: QualityQueryRow["incomplete_orders"][number]
): string[] {
  const missing: string[] = [];
  if (!row.has_customer) missing.push("Sin cliente vinculado");
  if (!row.has_lines_and_costs) missing.push("Faltan costos en líneas");
  if (!row.has_seller) missing.push("Sin responsable");
  if (!row.has_explicit_mode) missing.push("Condición asumida");
  if (!row.has_payment_account) missing.push("Cobro sin cuenta");
  if (!row.has_credit_due) missing.push("Crédito sin fecha pactada");
  if (!row.within_24h) missing.push("Registrado fuera de 24 h");
  return missing;
}

export const OPERATIONAL_QUALITY_SELECT = `(
  SELECT row_to_json(oq)
  FROM (
    WITH valid_orders AS (
      SELECT
        so.order_id,
        so.order_code,
        so.order_date,
        so.source_origin,
        so.customer_party_id,
        so.created_by_user_id,
        so.historical_status_assumed,
        so.total_pen
      FROM erp.sales_orders so
      WHERE so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    ),
    app_orders_scored AS (
      SELECT
        order_id,
        order_code,
        order_date::text AS order_date,
        order_week,
        has_customer,
        has_lines_and_costs,
        has_seller,
        has_explicit_mode,
        has_payment_account,
        has_credit_due,
        within_24h,
        is_complete_24h,
        has_correction
      FROM analytics.v_kpi_registration_coverage_24h
    ),
    sold_missing_cost AS (
      SELECT
        COUNT(DISTINCT p.product_id)::int AS sku_count,
        COALESCE(SUM(sol.line_total_pen), 0)::numeric(14,2) AS impacted_pen
      FROM erp.sales_order_lines sol
      JOIN valid_orders vo ON vo.order_id = sol.order_id
      JOIN erp.products p ON p.product_id = sol.product_id
      WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NULL
    ),
    purchase_stats AS (
      SELECT
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (
          WHERE pi.has_itemized_lines = FALSE
             OR NOT EXISTS (
               SELECT 1
               FROM erp.purchase_invoice_lines pil
               WHERE pil.purchase_id = pi.purchase_id
             )
        )::int AS without_detail_count
      FROM erp.purchase_invoices pi
    ),
    customer_stats AS (
      SELECT
        COUNT(*)::int AS active_count,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(phone), '') IS NULL)::int AS missing_phone_count,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(city_zone), '') IS NULL)::int AS missing_zone_count,
        COUNT(*) FILTER (WHERE geo_lat IS NULL OR geo_lng IS NULL)::int AS missing_geo_count
      FROM erp.parties
      WHERE is_active = TRUE
        AND party_type IN ('CUSTOMER', 'BOTH')
    )
    SELECT
      COALESCE((SELECT COUNT(*)::int FROM app_orders_scored WHERE is_complete_24h), 0) AS coverage_numerator,
      COALESCE((SELECT COUNT(*)::int FROM app_orders_scored), 0) AS coverage_denominator,
      COALESCE((SELECT COUNT(*)::int FROM app_orders_scored WHERE has_correction), 0) AS correction_count,
      COALESCE((
        SELECT json_agg(t)
        FROM (
          SELECT
            order_week::text AS week_start,
            COUNT(*)::int AS total_orders,
            COUNT(*) FILTER (WHERE is_complete_24h)::int AS complete_orders,
            COUNT(*) FILTER (WHERE has_correction)::int AS correction_count
          FROM app_orders_scored
          GROUP BY order_week
          ORDER BY order_week DESC
          LIMIT 4
        ) t
      ), '[]'::json) AS weekly_cohorts,
      (
        SELECT row_to_json(ldc)
        FROM (
          SELECT
            dc.closure_date::text AS closure_date,
            dc.variance_total_pen,
            u.full_name AS closed_by_name,
            dc.updated_at::text AS updated_at
          FROM erp.daily_closures dc
          JOIN erp.app_users u ON u.user_id = dc.closed_by_user_id
          ORDER BY dc.closure_date DESC, dc.closure_id DESC
          LIMIT 1
        ) ldc
      ) AS latest_daily_closure,
      COALESCE((
        SELECT json_agg(t)
        FROM (
          SELECT
            order_id,
            order_code,
            order_date,
            has_customer,
            has_lines_and_costs,
            has_seller,
            has_explicit_mode,
            has_payment_account,
            has_credit_due,
            within_24h
          FROM app_orders_scored
          WHERE NOT is_complete_24h
          ORDER BY order_date DESC, order_id DESC
          LIMIT 10
        ) t
      ), '[]'::json) AS incomplete_orders,
      COALESCE((SELECT COUNT(*)::int FROM valid_orders WHERE source_origin = 'ERP_APP'), 0) AS erp_app_orders_count,
      COALESCE((SELECT COUNT(*)::int FROM valid_orders), 0) AS total_orders_count,
      COALESCE((SELECT COUNT(*)::int FROM valid_orders WHERE created_by_user_id IS NULL), 0) AS orders_missing_seller_count,
      COALESCE((SELECT COUNT(*)::int FROM erp.products WHERE is_active = TRUE), 0) AS active_products_count,
      COALESCE((SELECT COUNT(*)::int FROM erp.products WHERE is_active = TRUE AND ref_cost_pen IS NULL), 0) AS products_missing_cost_count,
      COALESCE((SELECT sku_count FROM sold_missing_cost), 0) AS sold_skus_missing_cost_count,
      COALESCE((SELECT impacted_pen FROM sold_missing_cost), 0) AS sold_skus_missing_cost_pen,
      COALESCE((SELECT total_count FROM purchase_stats), 0) AS purchases_total_count,
      COALESCE((SELECT without_detail_count FROM purchase_stats), 0) AS purchases_without_detail_count,
      COALESCE((SELECT active_count FROM customer_stats), 0) AS active_customers_count,
      COALESCE((SELECT missing_phone_count FROM customer_stats), 0) AS customers_missing_phone_count,
      COALESCE((SELECT missing_zone_count FROM customer_stats), 0) AS customers_missing_zone_count,
      COALESCE((SELECT missing_geo_count FROM customer_stats), 0) AS customers_missing_geo_count,
      COALESCE((SELECT COUNT(*)::int FROM erp.route_trips), 0) AS trips_total_count,
      COALESCE((SELECT COUNT(*)::int FROM erp.route_trips WHERE declared_net_cash_pen IS NULL), 0) AS trips_without_reconciliation_count,
      COALESCE((SELECT COUNT(*)::int FROM valid_orders WHERE historical_status_assumed = TRUE), 0) AS assumed_cash_orders_count,
      COALESCE((SELECT SUM(total_pen) FROM valid_orders WHERE historical_status_assumed = TRUE), 0) AS assumed_cash_orders_pen,
      COALESCE((
        SELECT COUNT(*)::int
        FROM erp.v_current_stock
        WHERE warehouse_code = 'MAIN'
          AND stock_on_hand < -0.0001
      ), 0) AS negative_stock_sku_count,
      COALESCE((
        SELECT COUNT(*)::int
        FROM erp.audit_flags
        WHERE status = 'OPEN'
          AND flag_code = 'MISSING_BANK_STATEMENT_LEDGER'
      ), 0) AS open_bank_audit_flags_count,
      COALESCE((
        SELECT COUNT(*)::int
        FROM erp.ap_obligations
        WHERE status IN ('OPEN', 'PARTIAL')
          AND balance_due_pen > 0.05
          AND due_date IS NULL
      ), 0) AS ap_no_due_date_count
  ) oq
)`;

export function mapOperationalQualitySummary(raw: unknown): OperationalQualitySummary {
  const row = (raw && typeof raw === "object" ? raw : {}) as Partial<QualityQueryRow>;
  const numerator = asInt(row?.coverage_numerator);
  const denominator = asInt(row?.coverage_denominator);
  const correctionCount = asInt(row?.correction_count);
  const coveragePct =
    denominator > 0 ? Number(((numerator * 100) / denominator).toFixed(1)) : null;
  const correctionRatePct =
    denominator > 0 ? Number(((correctionCount * 100) / denominator).toFixed(1)) : null;

  const weeklyCohorts: WeeklyCoverageCohort[] = Array.isArray(row?.weekly_cohorts)
    ? row.weekly_cohorts.map((item) => {
        const total = asInt(item.total_orders);
        const complete = asInt(item.complete_orders);
        return {
          weekStart: String(item.week_start),
          totalOrders: total,
          completeOrders: complete,
          coveragePct: total > 0 ? Number(((complete * 100) / total).toFixed(1)) : 0,
          correctionCount: asInt(item.correction_count),
        };
      })
    : [];

  const latestDailyClosure: LatestDailyClosureSummary | null = row?.latest_daily_closure
    ? {
        closureDate: String(row.latest_daily_closure.closure_date),
        varianceTotalPen: asNum(row.latest_daily_closure.variance_total_pen),
        closedByName: String(row.latest_daily_closure.closed_by_name),
        updatedAt: String(row.latest_daily_closure.updated_at),
      }
    : null;

  const incompleteOrders: IncompleteOrderSummary[] = Array.isArray(
    row?.incomplete_orders
  )
    ? row.incomplete_orders.map((item) => ({
        orderId: asInt(item.order_id),
        orderCode: String(item.order_code),
        orderDate: String(item.order_date),
        missingFields: buildMissingFields(item),
      }))
    : [];

  const erpAppOrdersCount = asInt(row?.erp_app_orders_count);
  const totalOrdersCount = asInt(row?.total_orders_count);
  const ordersMissingSellerCount = asInt(row?.orders_missing_seller_count);
  const activeProductsCount = asInt(row?.active_products_count);
  const productsMissingCostCount = asInt(row?.products_missing_cost_count);
  const soldSkusMissingCostCount = asInt(row?.sold_skus_missing_cost_count);
  const soldSkusMissingCostPen = asNum(row?.sold_skus_missing_cost_pen);
  const purchasesTotalCount = asInt(row?.purchases_total_count);
  const purchasesWithoutDetailCount = asInt(row?.purchases_without_detail_count);
  const activeCustomersCount = asInt(row?.active_customers_count);
  const customersMissingPhoneCount = asInt(row?.customers_missing_phone_count);
  const customersMissingZoneCount = asInt(row?.customers_missing_zone_count);
  const customersMissingGeoCount = asInt(row?.customers_missing_geo_count);
  const tripsTotalCount = asInt(row?.trips_total_count);
  const tripsWithoutReconciliationCount = asInt(
    row?.trips_without_reconciliation_count
  );
  const assumedCashOrdersCount = asInt(row?.assumed_cash_orders_count);
  const assumedCashOrdersPen = asNum(row?.assumed_cash_orders_pen);
  const negativeStockSkuCount = asInt(row?.negative_stock_sku_count);
  const openBankAuditFlagsCount = asInt(row?.open_bank_audit_flags_count);
  const apNoDueDateCount = asInt(row?.ap_no_due_date_count);

  const startupChecklist: StartupChecklistItem[] = [
    {
      code: "ERP_OPERATIONS_STARTED",
      label: "Operación diaria iniciada en el ERP",
      done: erpAppOrdersCount > 0,
      pendingCount: erpAppOrdersCount > 0 ? 0 : 1,
      detail:
        erpAppOrdersCount > 0
          ? `${erpAppOrdersCount} pedido(s) registrados desde la aplicación.`
          : "Aún hay 0 ventas registradas desde el ERP; todo el historial es carga inicial.",
      targetTab: "vendedor",
    },
    {
      code: "SOLD_SKU_COSTS",
      label: "Costos completos en SKUs vendidos",
      done: soldSkusMissingCostCount === 0,
      pendingCount: soldSkusMissingCostCount,
      detail:
        soldSkusMissingCostCount === 0
          ? "Todos los productos vendidos tienen costo de referencia."
          : `${soldSkusMissingCostCount} SKU(s) vendidos sin costo conocido (S/ ${soldSkusMissingCostPen.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).`,
      targetTab: "stock",
    },
    {
      code: "INVENTORY_BASELINE",
      label: "Conteo físico y stock regularizado",
      done: negativeStockSkuCount === 0,
      pendingCount: negativeStockSkuCount,
      detail:
        negativeStockSkuCount === 0
          ? "Sin saldos negativos pendientes en almacén principal."
          : `${negativeStockSkuCount} SKU(s) con saldo negativo por falta de conteo inicial.`,
      targetTab: "stock",
    },
    {
      code: "BANK_RECONCILIATION",
      label: "Bancos y extractos conciliados",
      done: openBankAuditFlagsCount === 0,
      pendingCount: openBankAuditFlagsCount,
      detail:
        openBankAuditFlagsCount === 0
          ? "Extractos bancarios conciliados sin alertas abiertas."
          : "Faltan extractos bancarios históricos; saldos de bancos aún no conciliados.",
      targetTab: "caja",
    },
    {
      code: "ASSUMED_CASH_CONFIRMED",
      label: "Ventas históricas asumidas revisadas",
      done: assumedCashOrdersCount === 0,
      pendingCount: assumedCashOrdersCount,
      detail:
        assumedCashOrdersCount === 0
          ? "Condición contado/crédito confirmada en todos los pedidos."
          : `${assumedCashOrdersCount} venta(s) históricas siguen asumidas como contado.`,
      targetTab: "deudores",
    },
    {
      code: "CUSTOMERS_CONTACT_DATA",
      label: "Teléfono y zona en clientes activos",
      done: customersMissingPhoneCount === 0 && customersMissingZoneCount === 0,
      pendingCount: Math.max(customersMissingPhoneCount, customersMissingZoneCount),
      detail:
        customersMissingPhoneCount === 0 && customersMissingZoneCount === 0
          ? "Todos los clientes activos tienen teléfono y zona."
          : `${customersMissingPhoneCount} sin teléfono y ${customersMissingZoneCount} sin zona (de ${activeCustomersCount} activos).`,
      targetTab: "directorio",
    },
  ];

  return {
    registrationCoverage24h: {
      numerator,
      denominator,
      coveragePct,
      correctionRatePct,
      baselineMode: denominator === 0 ? "NO_APP_ORDERS" : "ACTIVE",
      incompleteOrders,
      weeklyCohorts,
    },
    erpAppOrdersCount,
    totalOrdersCount,
    ordersMissingSellerCount,
    activeProductsCount,
    productsMissingCostCount,
    soldSkusMissingCostCount,
    soldSkusMissingCostPen,
    purchasesTotalCount,
    purchasesWithoutDetailCount,
    activeCustomersCount,
    customersMissingPhoneCount,
    customersMissingZoneCount,
    customersMissingGeoCount,
    tripsTotalCount,
    tripsWithoutReconciliationCount,
    assumedCashOrdersCount,
    assumedCashOrdersPen,
    negativeStockSkuCount,
    openBankAuditFlagsCount,
    apNoDueDateCount,
    latestDailyClosure,
    startupChecklist,
  };
}

export async function getOperationalQualitySummary(
  client: PoolClient
): Promise<OperationalQualitySummary> {
  const res = await client.query<{ oq: unknown }>(
    `SELECT ${OPERATIONAL_QUALITY_SELECT} AS oq`
  );
  return mapOperationalQualitySummary(res.rows[0]?.oq);
}
