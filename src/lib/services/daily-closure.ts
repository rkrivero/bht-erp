import type { PoolClient } from "pg";
import { assertRole } from "../rbac";
import { ValidationError, type SessionUser } from "../types";
import { getLimaDateString } from "./orders";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DailyClosureAccountRow {
  accountId: number;
  code: string;
  name: string;
  accountType: string;
  systemBalancePen: number;
  dayInPen: number;
  dayOutPen: number;
  countedBalancePen: number | null;
  variancePen: number | null;
  isReconciled: boolean;
  notes: string | null;
  lastReconciledAt: string | null;
  lastReconciledBalancePen: number | null;
}

export interface DailyClosureHistoryItem {
  closureId: number;
  closureDate: string;
  status: string;
  closedByName: string;
  salesCount: number;
  salesTotalPen: number;
  collectionsTotalPen: number;
  expensesTotalPen: number;
  depositsTotalPen: number;
  expectedCashTotalPen: number;
  countedCashTotalPen: number | null;
  varianceTotalPen: number | null;
  pendingDeliveriesCount: number;
  pendingCollectionsCount: number;
  pendingAp7dCount: number;
  incompleteOrders24h: number;
  nextDayNotes: string | null;
  notes: string | null;
  updatedAt: string;
}

export interface DailyClosureAuditSnapshot {
  closure: DailyClosureHistoryItem;
  accounts: DailyClosureAccountRow[];
}

export interface DailyClosureAuditItem {
  auditId: number;
  actorName: string;
  actorRole: string;
  reason: string;
  createdAt: string;
  beforeData: DailyClosureAuditSnapshot;
  afterData: DailyClosureAuditSnapshot;
}

export interface DailyClosureDraftResponse {
  closureDate: string;
  isClosed: boolean;
  hasAppliedAdjustments: boolean;
  existingClosure: DailyClosureHistoryItem | null;
  daySummary: {
    salesCount: number;
    salesTotalPen: number;
    collectionsTotalPen: number;
    expensesTotalPen: number;
    depositsTotalPen: number;
    expectedCashTotalPen: number;
  };
  accounts: DailyClosureAccountRow[];
  pendingItems: {
    deliveriesCount: number;
    deliveries: Array<{
      orderId: number;
      orderCode: string;
      customerName: string;
      operationalStatus: string;
      orderDate: string;
      totalPen: number;
    }>;
    collectionsCount: number;
    collectionsTotalPen: number;
    collections: Array<{
      orderId: number;
      orderCode: string;
      customerName: string;
      balanceDuePen: number;
      dueDate: string | null;
      promisedPaymentDate: string | null;
      promiseStatus: string;
      dueStatus: string;
    }>;
    ap7dCount: number;
    ap7dTotalPen: number;
    ap7d: Array<{
      apId: number;
      supplierName: string;
      docRef: string;
      dueDate: string | null;
      balanceDuePen: number;
      maturityBucket: string;
    }>;
    incompleteOrders24h: number;
  };
  recentClosures: DailyClosureHistoryItem[];
  corrections: DailyClosureAuditItem[];
}

export function validateClosureDateIso(raw?: string | null): string {
  const cleaned = String(raw || "").trim();
  if (!cleaned) return getLimaDateString(0);
  if (!DATE_RE.test(cleaned)) {
    throw new ValidationError("La fecha de cierre debe tener formato YYYY-MM-DD");
  }
  const [y, m, d] = cleaned.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new ValidationError("Fecha de cierre fuera de calendario");
  }
  return cleaned;
}

function toNum(v: unknown, fallback = 0): number {
  const n = Number(v ?? fallback);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : fallback;
}

function toNullableNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function mapClosureHistoryRow(r: Record<string, unknown>): DailyClosureHistoryItem {
  return {
    closureId: Number(r.closure_id),
    closureDate: String(r.closure_date),
    status: String(r.status),
    closedByName: String(r.closed_by_name || "Socio"),
    salesCount: Number(r.sales_count ?? 0),
    salesTotalPen: toNum(r.sales_total_pen),
    collectionsTotalPen: toNum(r.collections_total_pen),
    expensesTotalPen: toNum(r.expenses_total_pen),
    depositsTotalPen: toNum(r.deposits_total_pen),
    expectedCashTotalPen: toNum(r.expected_cash_total_pen),
    countedCashTotalPen: toNullableNum(r.counted_cash_total_pen),
    varianceTotalPen: toNullableNum(r.variance_total_pen),
    pendingDeliveriesCount: Number(r.pending_deliveries_count ?? 0),
    pendingCollectionsCount: Number(r.pending_collections_count ?? 0),
    pendingAp7dCount: Number(r.pending_ap_7d_count ?? 0),
    incompleteOrders24h: Number(r.incomplete_orders_24h ?? 0),
    nextDayNotes: r.next_day_notes ? String(r.next_day_notes) : null,
    notes: r.notes ? String(r.notes) : null,
    updatedAt: String(r.updated_at),
  };
}

export async function getDailyClosureDraft(
  client: PoolClient,
  actor: SessionUser,
  rawDate?: string | null
): Promise<DailyClosureDraftResponse> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);
  const closureDate = validateClosureDateIso(rawDate);

  const res = await client.query<{
    day_summary: Record<string, unknown>;
    existing_closure: Record<string, unknown> | null;
    has_applied_adjustments: boolean;
    accounts: Array<Record<string, unknown>>;
    deliveries_count: number;
    deliveries: Array<Record<string, unknown>>;
    collections_count: number;
    collections_total_pen: number;
    collections: Array<Record<string, unknown>>;
    ap_count: number;
    ap_total_pen: number;
    ap_docs: Array<Record<string, unknown>>;
    incomplete_24h: number;
    recent_closures: Array<Record<string, unknown>>;
    corrections: Array<Record<string, unknown>>;
  }>(
    `WITH existing AS (
       SELECT dc.*, u.full_name AS closed_by_name
       FROM erp.daily_closures dc
       JOIN erp.app_users u ON u.user_id = dc.closed_by_user_id
       WHERE dc.closure_date = $1::date
       LIMIT 1
     ),
     acct_ledger AS (
       SELECT
         cl.account_id,
         COALESCE(SUM(CASE WHEN cl.tx_date <= $1::date THEN CASE WHEN cl.direction = 'IN' THEN cl.amount_pen ELSE -cl.amount_pen END ELSE 0 END), 0)::numeric(14,2) AS system_balance_pen,
         COALESCE(SUM(CASE WHEN cl.tx_date = $1::date AND cl.direction = 'IN' THEN cl.amount_pen ELSE 0 END), 0)::numeric(14,2) AS day_in_pen,
         COALESCE(SUM(CASE WHEN cl.tx_date = $1::date AND cl.direction = 'OUT' THEN cl.amount_pen ELSE 0 END), 0)::numeric(14,2) AS day_out_pen
       FROM erp.cash_ledger cl
       WHERE NOT EXISTS (
         SELECT 1 FROM existing ex
         WHERE cl.reference_table = 'erp.daily_closures'
           AND cl.reference_id = ex.closure_id::text
           AND cl.expense_category = 'CONCILIACION_SALDO'
       )
       GROUP BY cl.account_id
     ),
     saved_accts AS (
       SELECT dca.*
       FROM erp.daily_closure_accounts dca
       JOIN existing ex ON ex.closure_id = dca.closure_id
     ),
     deliveries_q AS (
       SELECT
         so.order_id,
         so.order_code,
         COALESCE(NULLIF(BTRIM(pa.trade_name), ''), pa.legal_name, so.customer_name_raw, 'CLIENTE') AS customer_name,
         so.operational_status::text AS operational_status,
         so.order_date::text AS order_date,
         so.total_pen
       FROM erp.sales_orders so
       LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
       WHERE so.source_origin = 'ERP_APP'
         AND so.operational_status IN ('REGISTERED', 'PICKING', 'READY', 'IN_ROUTE')
       ORDER BY so.order_date ASC, so.order_id ASC
     ),
     collections_q AS (
       SELECT
         da.order_id,
         da.order_code,
         da.customer_name,
         da.balance_due_pen,
         da.due_date::text AS due_date,
         da.promised_payment_date::text AS promised_payment_date,
         da.promise_status,
         da.due_status
       FROM analytics.v_debtors_aging da
       WHERE da.promise_status IN ('PROMISE_BROKEN', 'DUE_TODAY_OR_TOMORROW')
          OR da.due_status IN ('OVERDUE', 'DUE_SOON')
       ORDER BY COALESCE(da.due_date, da.promised_payment_date, da.order_date) ASC, da.balance_due_pen DESC
     ),
     ap_q AS (
       SELECT
         ap_id,
         supplier_name,
         doc_ref,
         due_date::text AS due_date,
         balance_due_pen,
         maturity_bucket
       FROM analytics.v_report_ap_maturity
       WHERE maturity_bucket IN ('OVERDUE', 'DUE_0_7')
       ORDER BY due_date ASC NULLS LAST, balance_due_pen DESC
     )
     SELECT
       json_build_object(
         'sales_count', COALESCE((
           SELECT COUNT(*)::int
           FROM erp.sales_orders so
           WHERE so.order_date = $1::date
             AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
         ), 0),
         'sales_total_pen', COALESCE((
           SELECT SUM(so.total_pen)::numeric(14,2)
           FROM erp.sales_orders so
           WHERE so.order_date = $1::date
             AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
         ), 0),
         'collections_total_pen', COALESCE((
           SELECT SUM(ap.amount_pen)::numeric(14,2)
           FROM erp.ar_payments ap
           JOIN erp.sales_orders so ON so.order_id = ap.order_id
           WHERE ap.voided_at IS NULL
             AND ap.payment_date = $1::date
             AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
         ), 0),
         'expenses_total_pen', COALESCE((
           SELECT SUM(cl.amount_pen)::numeric(14,2)
           FROM erp.cash_ledger cl
           WHERE cl.tx_date = $1::date
             AND cl.direction = 'OUT'
             AND NOT cl.is_internal_transfer
             AND NOT cl.is_reversal
             AND cl.expense_category <> 'CONCILIACION_SALDO'
             AND cl.expense_bucket IN ('ROUTE_OPEX', 'ADMIN_OPEX', 'NON_OPEX_OR_CAPEX')
             AND NOT EXISTS (
               SELECT 1 FROM erp.cash_ledger rev
               WHERE rev.reversal_of_ledger_id = cl.ledger_id
             )
         ), 0),
         'deposits_total_pen', COALESCE((
           SELECT SUM(cl.amount_pen)::numeric(14,2)
           FROM erp.cash_ledger cl
           WHERE cl.tx_date = $1::date
             AND cl.direction = 'OUT'
             AND cl.is_internal_transfer
             AND NOT cl.is_reversal
             AND NOT EXISTS (
               SELECT 1 FROM erp.cash_ledger rev
               WHERE rev.reversal_of_ledger_id = cl.ledger_id
             )
         ), 0)
       ) AS day_summary,
       (SELECT row_to_json(existing) FROM existing) AS existing_closure,
       EXISTS (
         SELECT 1 FROM erp.cash_ledger cl
         JOIN existing ex ON cl.reference_id = ex.closure_id::text
         WHERE cl.reference_table = 'erp.daily_closures'
           AND cl.expense_category = 'CONCILIACION_SALDO'
           AND NOT cl.is_reversal
           AND NOT EXISTS (
             SELECT 1 FROM erp.cash_ledger rev
             WHERE rev.reversal_of_ledger_id = cl.ledger_id
           )
       ) AS has_applied_adjustments,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             ca.account_id,
             ca.code,
             ca.name,
             ca.account_type,
             COALESCE(al.system_balance_pen, 0)::numeric(14,2) AS system_balance_pen,
             COALESCE(al.day_in_pen, 0)::numeric(14,2) AS day_in_pen,
             COALESCE(al.day_out_pen, 0)::numeric(14,2) AS day_out_pen,
             sa.counted_balance_pen,
             sa.variance_pen,
             COALESCE(sa.is_reconciled, FALSE) AS is_reconciled,
             sa.notes,
             ca.last_reconciled_at::text AS last_reconciled_at,
             ca.last_reconciled_balance_pen
           FROM erp.cash_accounts ca
           LEFT JOIN acct_ledger al ON al.account_id = ca.account_id
           LEFT JOIN saved_accts sa ON sa.account_id = ca.account_id
           WHERE ca.is_active = TRUE
           ORDER BY ca.account_id ASC
         ) t
       ), '[]'::json) AS accounts,
       COALESCE((SELECT COUNT(*)::int FROM deliveries_q), 0) AS deliveries_count,
       COALESCE((SELECT json_agg(t) FROM (SELECT * FROM deliveries_q LIMIT 8) t), '[]'::json) AS deliveries,
       COALESCE((SELECT COUNT(*)::int FROM collections_q), 0) AS collections_count,
       COALESCE((SELECT SUM(balance_due_pen)::numeric(14,2) FROM collections_q), 0) AS collections_total_pen,
       COALESCE((SELECT json_agg(t) FROM (SELECT * FROM collections_q LIMIT 8) t), '[]'::json) AS collections,
       COALESCE((SELECT COUNT(*)::int FROM ap_q), 0) AS ap_count,
       COALESCE((SELECT SUM(balance_due_pen)::numeric(14,2) FROM ap_q), 0) AS ap_total_pen,
       COALESCE((SELECT json_agg(t) FROM (SELECT * FROM ap_q LIMIT 8) t), '[]'::json) AS ap_docs,
       COALESCE((SELECT COUNT(*)::int FROM analytics.v_kpi_registration_coverage_24h WHERE NOT is_complete_24h), 0) AS incomplete_24h,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT dc.*, u.full_name AS closed_by_name
           FROM erp.daily_closures dc
           JOIN erp.app_users u ON u.user_id = dc.closed_by_user_id
           ORDER BY dc.closure_date DESC, dc.closure_id DESC
           LIMIT 14
         ) t
       ), '[]'::json) AS recent_closures,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT a.audit_id, a.actor_role, a.reason, a.created_at::text,
                  a.before_data, a.after_data, u.full_name AS actor_name
           FROM erp.daily_closure_audit_log a
           JOIN erp.app_users u ON u.user_id = a.actor_user_id
           JOIN existing ex ON ex.closure_id = a.closure_id
           ORDER BY a.created_at DESC, a.audit_id DESC
         ) t
       ), '[]'::json) AS corrections`,
    [closureDate]
  );

  const row = res.rows[0];
  const accounts: DailyClosureAccountRow[] = (row?.accounts ?? []).map((a) => ({
    accountId: Number(a.account_id),
    code: String(a.code),
    name: String(a.name),
    accountType: String(a.account_type),
    systemBalancePen: toNum(a.system_balance_pen),
    dayInPen: toNum(a.day_in_pen),
    dayOutPen: toNum(a.day_out_pen),
    countedBalancePen:
      a.counted_balance_pen !== null && a.counted_balance_pen !== undefined
        ? toNum(a.counted_balance_pen)
        : null,
    variancePen:
      a.variance_pen !== null && a.variance_pen !== undefined
        ? toNum(a.variance_pen)
        : null,
    isReconciled: Boolean(a.is_reconciled),
    notes: a.notes ? String(a.notes) : null,
    lastReconciledAt: a.last_reconciled_at ? String(a.last_reconciled_at) : null,
    lastReconciledBalancePen:
      a.last_reconciled_balance_pen !== null &&
      a.last_reconciled_balance_pen !== undefined
        ? toNum(a.last_reconciled_balance_pen)
        : null,
  }));

  const expectedCashTotalPen = Number(
    accounts.reduce((sum, a) => sum + a.systemBalancePen, 0).toFixed(2)
  );
  const day = row?.day_summary ?? {};
  const existingClosure = row?.existing_closure
    ? mapClosureHistoryRow(row.existing_closure)
    : null;

  return {
    closureDate,
    isClosed: existingClosure?.status === "CLOSED",
    hasAppliedAdjustments: Boolean(row?.has_applied_adjustments),
    existingClosure,
    daySummary: {
      salesCount: Number(day.sales_count ?? 0),
      salesTotalPen: toNum(day.sales_total_pen),
      collectionsTotalPen: toNum(day.collections_total_pen),
      expensesTotalPen: toNum(day.expenses_total_pen),
      depositsTotalPen: toNum(day.deposits_total_pen),
      expectedCashTotalPen,
    },
    accounts,
    pendingItems: {
      deliveriesCount: Number(row?.deliveries_count ?? 0),
      deliveries: (row?.deliveries ?? []).map((d) => ({
        orderId: Number(d.order_id),
        orderCode: String(d.order_code),
        customerName: String(d.customer_name),
        operationalStatus: String(d.operational_status),
        orderDate: String(d.order_date),
        totalPen: toNum(d.total_pen),
      })),
      collectionsCount: Number(row?.collections_count ?? 0),
      collectionsTotalPen: toNum(row?.collections_total_pen),
      collections: (row?.collections ?? []).map((c) => ({
        orderId: Number(c.order_id),
        orderCode: String(c.order_code),
        customerName: String(c.customer_name),
        balanceDuePen: toNum(c.balance_due_pen),
        dueDate: c.due_date ? String(c.due_date) : null,
        promisedPaymentDate: c.promised_payment_date
          ? String(c.promised_payment_date)
          : null,
        promiseStatus: String(c.promise_status),
        dueStatus: String(c.due_status),
      })),
      ap7dCount: Number(row?.ap_count ?? 0),
      ap7dTotalPen: toNum(row?.ap_total_pen),
      ap7d: (row?.ap_docs ?? []).map((a) => ({
        apId: Number(a.ap_id),
        supplierName: String(a.supplier_name),
        docRef: String(a.doc_ref),
        dueDate: a.due_date ? String(a.due_date) : null,
        balanceDuePen: toNum(a.balance_due_pen),
        maturityBucket: String(a.maturity_bucket),
      })),
      incompleteOrders24h: Number(row?.incomplete_24h ?? 0),
    },
    recentClosures: (row?.recent_closures ?? []).map(mapClosureHistoryRow),
    corrections: (row?.corrections ?? []).map((a) => ({
      auditId: Number(a.audit_id),
      actorName: String(a.actor_name),
      actorRole: String(a.actor_role),
      reason: String(a.reason),
      createdAt: String(a.created_at),
      beforeData: a.before_data as DailyClosureAuditSnapshot,
      afterData: a.after_data as DailyClosureAuditSnapshot,
    })),
  };
}

export async function saveDailyClosure(
  client: PoolClient,
  actor: SessionUser,
  input: {
    closureDate?: string;
    accounts: Array<{
      accountId: number;
      countedBalancePen: number | null;
      notes?: string | null;
    }>;
    applyReconciliationAdjustments?: boolean;
    nextDayNotes?: string | null;
    notes?: string | null;
    correctionReason?: string | null;
  }
): Promise<DailyClosureDraftResponse> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);
  const closureDate = validateClosureDateIso(input.closureDate);
  const existingRes = await client.query<{ closure_id: string; status: string }>(
    `SELECT closure_id, status FROM erp.daily_closures WHERE closure_date = $1::date FOR UPDATE`,
    [closureDate]
  );
  const existingId = existingRes.rows[0]?.closure_id ?? null;
  const existingStatus = existingRes.rows[0]?.status ?? null;
  const correctionReason =
    input.correctionReason?.trim() ||
    (existingId && existingStatus !== "CLOSED" ? "Cierre tras reapertura del día" : "");
  if (existingId && existingStatus === "CLOSED" && !correctionReason) {
    throw new ValidationError("Indica el motivo de la corrección del cierre");
  }

  // Authorize audited post-closure corrections and reconciliation entries within this closure transaction
  await client.query(`SET LOCAL bht.allow_closed_period_override = 'true'`);

  if (!Array.isArray(input.accounts) || input.accounts.length === 0) {
    throw new ValidationError("Ingresa el saldo contado de al menos una cuenta");
  }

  const submittedMap = new Map<
    number,
    { accountId: number; countedBalancePen: number | null; notes: string | null }
  >();
  for (const row of input.accounts) {
    const accountId = Number(row.accountId);
    const rawCounted = row.countedBalancePen;
    let countedBalancePen: number | null = null;
    if (rawCounted !== null && rawCounted !== undefined) {
      const counted = Number(rawCounted);
      if (!Number.isFinite(counted)) {
        throw new ValidationError("El saldo contado debe ser un número válido");
      }
      countedBalancePen = Number(counted.toFixed(2));
    }
    if (!Number.isInteger(accountId) || accountId <= 0) {
      throw new ValidationError("ID de cuenta inválido en el cierre");
    }
    if (submittedMap.has(accountId)) {
      throw new ValidationError("No repitas cuentas en el cierre diario");
    }
    submittedMap.set(accountId, {
      accountId,
      countedBalancePen,
      notes: row.notes ? String(row.notes).trim() || null : null,
    });
  }

  const activeAcctsRes = await client.query<{
    account_id: number;
    code: string;
    system_balance_pen: string;
  }>(
    `SELECT
       ca.account_id,
       ca.code,
       COALESCE((
         SELECT SUM(CASE WHEN cl.direction = 'IN' THEN cl.amount_pen ELSE -cl.amount_pen END)
         FROM erp.cash_ledger cl
         WHERE cl.account_id = ca.account_id
           AND cl.tx_date <= $1::date
           AND ($3::text IS NULL OR NOT (cl.reference_table = 'erp.daily_closures'
                    AND cl.reference_id = $3::text
                    AND cl.expense_category = 'CONCILIACION_SALDO'))
       ), 0)::numeric(14,2) AS system_balance_pen
     FROM erp.cash_accounts ca
     WHERE ca.is_active = TRUE
       AND ca.account_id = ANY($2::bigint[])
     ORDER BY ca.account_id ASC
     FOR UPDATE OF ca`,
    [closureDate, Array.from(submittedMap.keys()), existingId]
  );

  if (activeAcctsRes.rowCount !== submittedMap.size) {
    throw new ValidationError(
      "Una o más cuentas seleccionadas no existen o están inactivas"
    );
  }

  const preDraft = await getDailyClosureDraft(client, actor, closureDate);
  if (preDraft.accounts.length !== submittedMap.size) {
    throw new ValidationError("Incluye todas las cuentas activas en el cierre diario");
  }
  const beforeData: DailyClosureAuditSnapshot | null = preDraft.existingClosure
    ? { closure: preDraft.existingClosure, accounts: preDraft.accounts }
    : null;

  const accountSnapshots = activeAcctsRes.rows.map((dbAcct) => {
    const acctId = Number(dbAcct.account_id);
    const submitted = submittedMap.get(acctId)!;
    const systemBalancePen = toNum(dbAcct.system_balance_pen);
    const variancePen =
      submitted.countedBalancePen === null
        ? null
        : Number((submitted.countedBalancePen - systemBalancePen).toFixed(2));
    return {
      accountId: acctId,
      code: String(dbAcct.code),
      systemBalancePen,
      countedBalancePen: submitted.countedBalancePen,
      variancePen,
      notes: submitted.notes,
    };
  });

  const expectedCashTotalPen = Number(
    accountSnapshots.reduce((s, a) => s + a.systemBalancePen, 0).toFixed(2)
  );
  const allCounted =
    accountSnapshots.length > 0 &&
    accountSnapshots.every((a) => a.countedBalancePen !== null);
  const countedCashTotalPen = allCounted
    ? Number(
        accountSnapshots.reduce((s, a) => s + (a.countedBalancePen ?? 0), 0).toFixed(2)
      )
    : null;
  const varianceTotalPen =
    countedCashTotalPen !== null
      ? Number((countedCashTotalPen - expectedCashTotalPen).toFixed(2))
      : null;

  const upsertRes = await client.query<{ closure_id: string }>(
    `INSERT INTO erp.daily_closures (
       closure_date, status, closed_by_user_id,
       sales_count, sales_total_pen, collections_total_pen,
       expenses_total_pen, deposits_total_pen,
       expected_cash_total_pen, counted_cash_total_pen, variance_total_pen,
       pending_deliveries_count, pending_collections_count,
       pending_ap_7d_count, incomplete_orders_24h,
       next_day_notes, notes
     ) VALUES (
       $1::date, 'CLOSED', $2,
       $3, $4, $5,
       $6, $7,
       $8, $9, $10,
       $11, $12,
       $13, $14,
       $15, $16
     )
     ON CONFLICT (closure_date) DO UPDATE SET
       status = 'CLOSED',
       closed_by_user_id = EXCLUDED.closed_by_user_id,
       sales_count = EXCLUDED.sales_count,
       sales_total_pen = EXCLUDED.sales_total_pen,
       collections_total_pen = EXCLUDED.collections_total_pen,
       expenses_total_pen = EXCLUDED.expenses_total_pen,
       deposits_total_pen = EXCLUDED.deposits_total_pen,
       expected_cash_total_pen = EXCLUDED.expected_cash_total_pen,
       counted_cash_total_pen = EXCLUDED.counted_cash_total_pen,
       variance_total_pen = EXCLUDED.variance_total_pen,
       pending_deliveries_count = EXCLUDED.pending_deliveries_count,
       pending_collections_count = EXCLUDED.pending_collections_count,
       pending_ap_7d_count = EXCLUDED.pending_ap_7d_count,
       incomplete_orders_24h = EXCLUDED.incomplete_orders_24h,
       next_day_notes = EXCLUDED.next_day_notes,
       notes = EXCLUDED.notes
     RETURNING closure_id`,
    [
      closureDate,
      actor.userId,
      preDraft.daySummary.salesCount,
      preDraft.daySummary.salesTotalPen,
      preDraft.daySummary.collectionsTotalPen,
      preDraft.daySummary.expensesTotalPen,
      preDraft.daySummary.depositsTotalPen,
      expectedCashTotalPen,
      countedCashTotalPen,
      varianceTotalPen,
      preDraft.pendingItems.deliveriesCount,
      preDraft.pendingItems.collectionsCount,
      preDraft.pendingItems.ap7dCount,
      preDraft.pendingItems.incompleteOrders24h,
      input.nextDayNotes?.trim() || null,
      input.notes?.trim() || null,
    ]
  );

  const closureId = Number(upsertRes.rows[0].closure_id);

  const applyAdjustments = Boolean(input.applyReconciliationAdjustments);
  const changedAdjustments = new Set<number>();
  if (existingId) {
    const oldAdjustments = await client.query<{
      ledger_id: string;
      account_id: string;
      direction: "IN" | "OUT";
      amount_pen: string;
    }>(
      `SELECT cl.ledger_id, cl.account_id, cl.direction::text AS direction, cl.amount_pen
       FROM erp.cash_ledger cl
       WHERE cl.reference_table = 'erp.daily_closures'
         AND cl.reference_id = $1::text
         AND cl.expense_category = 'CONCILIACION_SALDO'
         AND NOT cl.is_reversal
         AND NOT EXISTS (
           SELECT 1 FROM erp.cash_ledger rev
           WHERE rev.reversal_of_ledger_id = cl.ledger_id
         )
       ORDER BY cl.ledger_id`,
      [existingId]
    );
    for (const snap of accountSnapshots) {
      const oldRows = oldAdjustments.rows.filter(
        (row) => Number(row.account_id) === snap.accountId
      );
      const previousAmount = Number(
        oldRows
          .reduce(
            (sum, row) =>
              sum + (row.direction === "IN" ? 1 : -1) * Number(row.amount_pen),
            0
          )
          .toFixed(2)
      );
      const desiredAmount = applyAdjustments ? (snap.variancePen ?? 0) : 0;
      if (previousAmount === desiredAmount) continue;
      changedAdjustments.add(snap.accountId);
      for (const old of oldRows) {
        const direction = old.direction === "IN" ? "OUT" : "IN";
        await client.query(
          `INSERT INTO erp.cash_ledger (
           tx_date, account_id, direction, amount_pen, expense_bucket,
           expense_category, is_internal_transfer, reference_table, reference_id,
           description, source_origin, created_by_user_id,
           reversal_of_ledger_id, is_reversal
         ) VALUES (
           $1::date, $2, $3::erp.cash_direction, $4,
           $5::erp.expense_bucket, 'CONCILIACION_SALDO', FALSE,
           'erp.daily_closures', $6, $7, 'ERP_APP', $8, $9, TRUE
         )`,
          [
            closureDate,
            old.account_id,
            direction,
            old.amount_pen,
            direction === "OUT" ? "NON_OPEX_OR_CAPEX" : null,
            String(closureId),
            `Reversión de ajuste de cierre diario ${closureDate}`,
            actor.userId,
            old.ledger_id,
          ]
        );
      }
    }
  } else {
    for (const snap of accountSnapshots) changedAdjustments.add(snap.accountId);
  }

  await client.query(`DELETE FROM erp.daily_closure_accounts WHERE closure_id = $1`, [
    closureId,
  ]);

  for (const snap of accountSnapshots) {
    if (
      applyAdjustments &&
      changedAdjustments.has(snap.accountId) &&
      snap.variancePen !== null &&
      Math.abs(snap.variancePen) >= 0.01
    ) {
      const direction = snap.variancePen > 0 ? "IN" : "OUT";
      const absAmt = Number(Math.abs(snap.variancePen).toFixed(2));
      const signLabel = snap.variancePen > 0 ? "+" : "-";
      await client.query(
        `INSERT INTO erp.cash_ledger (
           tx_date, account_id, direction, amount_pen,
           expense_bucket, expense_category, is_internal_transfer,
           reference_table, reference_id, description, source_origin,
           created_by_user_id
         ) VALUES (
           $1::date, $2, $3::erp.cash_direction, $4,
           $5::erp.expense_bucket, 'CONCILIACION_SALDO', FALSE,
           'erp.daily_closures', $6, $7, 'ERP_APP', $8
         )`,
        [
          closureDate,
          snap.accountId,
          direction,
          absAmt,
          direction === "OUT" ? "NON_OPEX_OR_CAPEX" : null,
          String(closureId),
          `Ajuste de conciliación en cierre diario ${closureDate} (${snap.code}: ${signLabel}S/ ${absAmt.toFixed(2)})`,
          actor.userId,
        ]
      );
    }

    const isAccountReconciled =
      snap.countedBalancePen !== null &&
      (applyAdjustments ||
        (snap.variancePen !== null && Math.abs(snap.variancePen) < 0.01));

    await client.query(
      `INSERT INTO erp.daily_closure_accounts (
         closure_id, account_id, system_balance_pen,
         counted_balance_pen, is_reconciled, notes
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        closureId,
        snap.accountId,
        snap.systemBalancePen,
        snap.countedBalancePen,
        isAccountReconciled,
        snap.notes,
      ]
    );

    if (snap.countedBalancePen !== null) {
      await client.query(
        `UPDATE erp.cash_accounts
         SET last_reconciled_at = NOW(),
             last_reconciled_balance_pen = $2,
             last_reconciled_by_user_id = $3
         WHERE account_id = $1`,
        [snap.accountId, snap.countedBalancePen, actor.userId]
      );
    }
  }

  const saved = await getDailyClosureDraft(client, actor, closureDate);
  if (beforeData && saved.existingClosure) {
    const afterData: DailyClosureAuditSnapshot = {
      closure: saved.existingClosure,
      accounts: saved.accounts,
    };
    await client.query(
      `INSERT INTO erp.daily_closure_audit_log
         (closure_id, actor_user_id, actor_role, reason, before_data, after_data)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        closureId,
        actor.userId,
        actor.role,
        correctionReason,
        JSON.stringify(beforeData),
        JSON.stringify(afterData),
      ]
    );
    return getDailyClosureDraft(client, actor, closureDate);
  }
  return saved;
}

export async function reopenDailyClosure(
  client: PoolClient,
  actor: SessionUser,
  input: { closureDate: string; reason: string }
): Promise<DailyClosureDraftResponse> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);
  const closureDate = validateClosureDateIso(input.closureDate);
  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new ValidationError("Indica el motivo para reabrir el día");
  }

  const existingRes = await client.query<{ closure_id: string; status: string }>(
    `SELECT closure_id, status
     FROM erp.daily_closures
     WHERE closure_date = $1::date
     FOR UPDATE`,
    [closureDate]
  );
  const row = existingRes.rows[0];
  if (!row || row.status !== "CLOSED") {
    throw new ValidationError("No existe un cierre cerrado para esta fecha");
  }

  const beforeDraft = await getDailyClosureDraft(client, actor, closureDate);
  await client.query(
    `UPDATE erp.daily_closures
     SET status = 'OPEN', updated_at = NOW()
     WHERE closure_id = $1`,
    [Number(row.closure_id)]
  );
  const afterDraft = await getDailyClosureDraft(client, actor, closureDate);

  if (beforeDraft.existingClosure && afterDraft.existingClosure) {
    await client.query(
      `INSERT INTO erp.daily_closure_audit_log
         (closure_id, actor_user_id, actor_role, reason, before_data, after_data)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        Number(row.closure_id),
        actor.userId,
        actor.role,
        `Reapertura del día: ${reason}`,
        JSON.stringify({
          closure: beforeDraft.existingClosure,
          accounts: beforeDraft.accounts,
        }),
        JSON.stringify({
          closure: afterDraft.existingClosure,
          accounts: afterDraft.accounts,
        }),
      ]
    );
    return getDailyClosureDraft(client, actor, closureDate);
  }
  return afterDraft;
}
