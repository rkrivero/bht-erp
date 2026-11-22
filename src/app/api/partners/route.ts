import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { withAuthenticatedClient, withAuthenticatedTransaction } from "@/lib/auth";
import { resolveHttpError } from "@/lib/http-errors";
import { runIdempotentMutation } from "@/lib/idempotency";
import { assertRole } from "@/lib/rbac";
import {
  BI_NON_MONTHLY_SELECTS,
  BI_SOLD_QTY_CTE,
  type BiNonMonthlyPanelsRow,
  mapBiMonthlyRows,
  mapBiSummaryFromPanels,
} from "@/lib/services/analytics-and-reports";
import {
  resetHistoricalNegativeStock,
  updateProductStockAndPricing,
} from "@/lib/services/collections-and-treasury";
import { getCashFlowSummary } from "@/lib/services/cash-flow-summary";
import {
  DATA_CUT_SELECT,
  OPERATIONAL_QUALITY_SELECT,
  mapDataCutSummary,
  mapOperationalQualitySummary,
} from "@/lib/services/operational-quality";
import {
  AUDIT_FLAG_COUNTS_SELECT,
  buildAuditFlagsSelect,
  mapAuditFlagCounts,
  mapAuditFlagRow,
} from "@/lib/services/operations-and-modules";
import { type UserRole, ValidationError } from "@/lib/types";
import { parseBody, readRawJsonBody } from "@/lib/validation/parse";
import { partnersMutationSchema } from "@/lib/validation/partners.schema";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

type PartnerDashboardBundleRow = BiNonMonthlyPanelsRow & {
  q1: Array<Record<string, unknown>>;
  q2: Array<Record<string, unknown>>;
  q3: Array<Record<string, unknown>>;
  gaps: Array<Record<string, unknown>>;
  on_demand: Array<Record<string, unknown>>;
  neg_count: number;
  unpurchased_reg_count: number;
  users: Array<Record<string, unknown>>;
  user_access_history: Array<Record<string, unknown>>;
  open_debtors_count: number;
  period_end: string;
  data_cut: unknown;
  operational_quality: unknown;
  audit_flag_counts: unknown;
  audit_flags: Array<Record<string, unknown>>;
};

const USER_ROLES: UserRole[] = [
  "PARTNER_ADMIN",
  "PARTNER_MANAGER",
  "EXTERNAL_SELLER",
  "WAREHOUSE_DELIVERY",
];

type UserAccessSnapshot = {
  user_id: number;
  username: string;
  full_name: string;
  email: string | null;
  role: UserRole;
  is_active: boolean;
  deleted?: boolean;
};

function parseUserRole(value: unknown): UserRole {
  const role = String(value || "") as UserRole;
  if (!USER_ROLES.includes(role)) {
    throw new ValidationError("Selecciona un rol de usuario válido");
  }
  return role;
}

function normalizeUsername(value: unknown): string {
  const username = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new ValidationError(
      "El usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo"
    );
  }
  return username;
}

function normalizeFullName(value: unknown): string {
  const fullName = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (fullName.length < 2 || fullName.length > 60) {
    throw new ValidationError("El nombre visible debe tener entre 2 y 60 caracteres");
  }
  return fullName;
}

function normalizeRequiredEmail(value: unknown): string {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ValidationError("Ingresa un correo electrónico válido");
  }
  return email;
}

function toUserSnapshot(row: Record<string, unknown>): UserAccessSnapshot {
  return {
    user_id: Number(row.user_id),
    username: String(row.username),
    full_name: String(row.full_name),
    email: row.email ? String(row.email) : null,
    role: String(row.role) as UserRole,
    is_active: Boolean(row.is_active),
  };
}

async function recordUserAccessAudit(
  client: PoolClient,
  actorUserId: number,
  action: string,
  before: UserAccessSnapshot | null,
  after: UserAccessSnapshot
): Promise<void> {
  await client.query(
    `INSERT INTO erp.user_access_audit_log
       (target_user_id, actor_user_id, action, before_data, after_data)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    [
      after.user_id,
      actorUserId,
      action,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
    ]
  );
}

export async function GET(req: NextRequest) {
  try {
    const data = await withAuthenticatedClient(
      req,
      ["PARTNER_ADMIN", "PARTNER_MANAGER"],
      async (client, actor) => {
        const isPartnerAdmin = actor.role === "PARTNER_ADMIN";
        // Batch all dashboard KPIs, alerts, users, and non-monthly BI panels into one query,
        // reusing `q1` rows for `biSummary.monthlyPerformance` instead of scanning the KPI view twice.
        const bundleRes = await client.query<PartnerDashboardBundleRow>(
          `WITH ${BI_SOLD_QTY_CTE}
         SELECT
           COALESCE((
             SELECT json_agg(t)
             FROM (
               SELECT
                 period_month::text AS period_month,
                 order_count,
                 sales_total_pen,
                 cash_collected_pen,
                 ar_pending_pen,
                 route_opex_pen,
                 route_opex_pct,
                 route_operating_cash_margin_pen,
                 route_operating_cash_margin_pct,
                 merchandise_outflow_pen,
                 non_opex_capex_drain_pen,
                 internal_deposits_pen,
                 non_opex_drain_of_outflows_pct,
                 reinvestment_share_pct,
                 drain_vs_reinvestment_pct,
                 reconciled_trips_count,
                 declared_net_cash_pen,
                 expected_net_cash_pen,
                 cash_reconciliation_gap_pen,
                 cash_reconciliation_gap_pct,
                 drain_above_30pct_alert,
                 route_opex_above_8pct_alert,
                 pre_route_foundational_outflow_pen
               FROM analytics.v_kpi_cash_and_reinvestment
               ORDER BY period_month ASC
             ) t
           ), '[]'::json) AS q1,
           COALESCE((
             SELECT json_agg(t)
             FROM (
               SELECT
                 product_id,
                 sku,
                 product_name,
                 fulfillment_mode::text AS fulfillment_mode,
                 total_units_sold,
                 total_revenue_pen,
                 known_cogs_pen AS total_cogs_pen,
                 real_gross_margin_pen AS gross_margin_pen,
                 real_gross_margin_pct AS gross_margin_pct,
                 CASE
                   WHEN missing_cost_alert THEN 'SIN_COSTO'
                   WHEN low_margin_below_20pct_alert THEN 'BAJO_20%'
                   ELSE 'OK_20%+'
                 END AS margin_health_status
               FROM analytics.v_kpi_sku_margin_and_opex
               ORDER BY total_revenue_pen DESC
               LIMIT 40
             ) t
           ), '[]'::json) AS q2,
           COALESCE((
             SELECT json_agg(t)
             FROM (
               SELECT
                 period_month::text AS period_month,
                 orders_total,
                 total_sales_pen,
                 credit_sales_pen,
                 pending_ar_pen,
                 ar_pending_of_credit_pct,
                 ar_pending_of_total_sales_pct,
                 overdue_gt_30d_count,
                 overdue_gt_30d_pen,
                 quotes_total,
                 quotes_converted_count,
                 quote_conversion_rate_pct,
                 quotes_total_pen,
                 explicit_status_orders_count,
                 assumed_status_orders_count,
                 explicit_payment_status_pct,
                 matched_customer_pct,
                 ar_above_15pct_alert,
                 overdue_gt_30d_alert
               FROM analytics.v_kpi_ar_customers_and_quotes
               ORDER BY period_month ASC
             ) t
           ), '[]'::json) AS q3,
           COALESCE((
             SELECT json_agg(t)
             FROM (
               SELECT
                 gap_category AS metric_code,
                 gap_category AS metric_label,
                 item_count AS gap_count,
                 impacted_pen AS impacted_amount_pen,
                 description AS recommended_action
               FROM analytics.v_data_quality_gaps
               ORDER BY gap_category ASC
             ) t
           ), '[]'::json) AS gaps,
           COALESCE((
             SELECT json_agg(t)
             FROM (
               SELECT
                 order_line_id,
                 order_id,
                 order_code,
                 order_date::text AS order_date,
                 warehouse_id,
                 warehouse_code,
                 customer_party_id,
                 customer_name,
                 product_id,
                 sku,
                 product_name,
                 quantity,
                 pack_factor_applied,
                 required_base_qty,
                 current_stock_on_hand,
                 line_total_pen,
                 payment_mode::text AS payment_mode,
                 balance_due_pen,
                 fulfillment_status::text AS fulfillment_status,
                 days_pending,
                 open_flag_id,
                 flag_severity::text AS flag_severity,
                 flag_message,
                 source_origin::text AS source_origin
               FROM analytics.v_pending_on_demand_orders
               ORDER BY order_date ASC, order_line_id ASC
             ) t
           ), '[]'::json) AS on_demand,
           COALESCE((
             SELECT COUNT(*)::int
             FROM erp.v_current_stock
             WHERE warehouse_code = 'MAIN'
               AND stock_on_hand < -0.0001
           ), 0) AS neg_count,
           COALESCE((
             SELECT COUNT(*)::int
             FROM analytics.v_unpurchased_sales_regularization
             WHERE has_sold_deficit = TRUE
           ), 0) AS unpurchased_reg_count,
           CASE
             WHEN $1::boolean THEN COALESCE((
               SELECT json_agg(t)
               FROM (
                 SELECT
                   user_id,
                   username,
                   full_name,
                   role::text AS role,
                   is_active,
                   email
                 FROM erp.app_users
                 WHERE username NOT LIKE '%\\_\\_deleted\\_%' ESCAPE '\\'
                 ORDER BY user_id ASC
               ) t
             ), '[]'::json)
             ELSE '[]'::json
           END AS users,
           CASE
             WHEN $1::boolean THEN COALESCE((
               SELECT json_agg(t)
               FROM (
                 SELECT
                   l.audit_id,
                   l.action,
                   l.target_user_id,
                   target.username AS target_username,
                   target.full_name AS target_name,
                   actor.username AS actor_username,
                   actor.full_name AS actor_name,
                   l.before_data,
                   l.after_data,
                   l.created_at
                 FROM erp.user_access_audit_log l
                 JOIN erp.app_users target ON target.user_id = l.target_user_id
                 JOIN erp.app_users actor ON actor.user_id = l.actor_user_id
                 ORDER BY l.created_at DESC, l.audit_id DESC
                 LIMIT 40
               ) t
             ), '[]'::json)
             ELSE '[]'::json
           END AS user_access_history,
           COALESCE((
             SELECT COUNT(*)::int
             FROM analytics.v_debtors_aging
             WHERE operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
           ), 0) AS open_debtors_count,
           COALESCE((
             SELECT MAX(order_date)::text
             FROM erp.sales_orders
             WHERE operational_status <> 'CANCELLED'
           ), '2026-09-29') AS period_end,
           ${DATA_CUT_SELECT} AS data_cut,
           ${OPERATIONAL_QUALITY_SELECT} AS operational_quality,
           ${AUDIT_FLAG_COUNTS_SELECT} AS audit_flag_counts,
           ${buildAuditFlagsSelect("'ALL'", "60")} AS audit_flags,
           ${BI_NON_MONTHLY_SELECTS}`,
          [isPartnerAdmin]
        );

        const bundle = bundleRes.rows[0];
        const q1Raw = bundle?.q1 ?? [];
        const q1Rows = q1Raw.map((r) => ({
          ...r,
          period_month: String(r.period_month),
          order_count: Number(r.order_count ?? 0),
          sales_total_pen: Number(r.sales_total_pen ?? 0),
          cash_collected_pen: Number(r.cash_collected_pen ?? 0),
          ar_pending_pen: Number(r.ar_pending_pen ?? 0),
          route_opex_pen: Number(r.route_opex_pen ?? 0),
          route_opex_pct:
            r.route_opex_pct !== null && r.route_opex_pct !== undefined
              ? Number(r.route_opex_pct)
              : null,
          route_operating_cash_margin_pen: Number(
            r.route_operating_cash_margin_pen ?? 0
          ),
          route_operating_cash_margin_pct:
            r.route_operating_cash_margin_pct !== null &&
            r.route_operating_cash_margin_pct !== undefined
              ? Number(r.route_operating_cash_margin_pct)
              : null,
          merchandise_outflow_pen: Number(r.merchandise_outflow_pen ?? 0),
          non_opex_capex_drain_pen: Number(r.non_opex_capex_drain_pen ?? 0),
          internal_deposits_pen: Number(r.internal_deposits_pen ?? 0),
          declared_net_cash_pen: Number(r.declared_net_cash_pen ?? 0),
          expected_net_cash_pen: Number(r.expected_net_cash_pen ?? 0),
          cash_reconciliation_gap_pen: Number(r.cash_reconciliation_gap_pen ?? 0),
          cash_reconciliation_gap_pct:
            r.cash_reconciliation_gap_pct !== null &&
            r.cash_reconciliation_gap_pct !== undefined
              ? Number(r.cash_reconciliation_gap_pct)
              : null,
          pre_route_foundational_outflow_pen: Number(
            r.pre_route_foundational_outflow_pen ?? 0
          ),
        }));

        const totalSalesPen = Number(
          q1Rows.reduce((s, r) => s + r.sales_total_pen, 0).toFixed(2)
        );
        const cashCollectedPen = Number(
          q1Rows.reduce((s, r) => s + r.cash_collected_pen, 0).toFixed(2)
        );
        const arPendingPen = Number(
          q1Rows.reduce((s, r) => s + r.ar_pending_pen, 0).toFixed(2)
        );
        const routeOpexPen = Number(
          q1Rows.reduce((s, r) => s + r.route_opex_pen, 0).toFixed(2)
        );
        const merchOutPen = Number(
          q1Rows.reduce((s, r) => s + r.merchandise_outflow_pen, 0).toFixed(2)
        );
        const nonOpexDrainPen = Number(
          q1Rows.reduce((s, r) => s + r.non_opex_capex_drain_pen, 0).toFixed(2)
        );
        const internalDepositsPen = Number(
          q1Rows.reduce((s, r) => s + r.internal_deposits_pen, 0).toFixed(2)
        );
        const preRouteFoundationalOutflowPen = Number(
          q1Rows
            .reduce((s, r) => s + r.pre_route_foundational_outflow_pen, 0)
            .toFixed(2)
        );
        const declaredNetCashPen = Number(
          q1Rows.reduce((s, r) => s + r.declared_net_cash_pen, 0).toFixed(2)
        );
        const expectedNetCashPen = Number(
          q1Rows.reduce((s, r) => s + r.expected_net_cash_pen, 0).toFixed(2)
        );
        const reconGapPen = Number(
          (declaredNetCashPen - expectedNetCashPen).toFixed(2)
        );
        const reconGapPct =
          expectedNetCashPen === 0
            ? 0
            : Number(
                (
                  (Math.abs(declaredNetCashPen - expectedNetCashPen) * 100) /
                  Math.max(Math.abs(expectedNetCashPen), 1)
                ).toFixed(2)
              );
        const drainRatioPct =
          merchOutPen + nonOpexDrainPen > 0
            ? Number(
                ((nonOpexDrainPen * 100) / (merchOutPen + nonOpexDrainPen)).toFixed(2)
              )
            : 0;
        const openDebtorsCount = Number(bundle?.open_debtors_count ?? 0);

        const kpiQ1Summary = {
          period_start: "2026-06-26",
          period_end: String(bundle?.period_end ?? "2026-09-29"),
          total_sales_pen: totalSalesPen,
          collected_sales_pen: cashCollectedPen,
          cash_collected_pen: cashCollectedPen,
          accounts_receivable_pen: arPendingPen,
          ar_pending_pen: arPendingPen,
          open_debtors_count: openDebtorsCount,
          route_opex_pen: routeOpexPen,
          merchandise_outflow_pen: merchOutPen,
          non_opex_capex_drain_pen: nonOpexDrainPen,
          internal_deposits_pen: internalDepositsPen,
          pre_route_foundational_outflow_pen: preRouteFoundationalOutflowPen,
          declared_net_cash_pen: declaredNetCashPen,
          expected_net_cash_pen: expectedNetCashPen,
          non_opex_vs_reinvestment_ratio_pct: drainRatioPct,
          reinvestment_health_flag: drainRatioPct > 30 ? "ALERTA > 30%" : "SALUDABLE",
          reconciliation_gap_pen: reconGapPen,
          reconciliation_gap_pct: reconGapPct,
          reconciliation_health_flag:
            reconGapPct <= 1 ? "DENTRO DE META (<1%)" : "ALERTA BRECHA (>1%)",
          monthlyRows: q1Rows,
        };

        const biSummary = mapBiSummaryFromPanels(bundle ?? {}, mapBiMonthlyRows(q1Raw));

        return {
          currentUser: actor,
          kpiQ1: kpiQ1Summary,
          openDebtorsCount,
          kpiQ2TopSkus: (bundle?.q2 ?? []).map((r) => ({
            ...r,
            product_id: Number(r.product_id),
            total_units_sold: Number(r.total_units_sold ?? 0),
            total_revenue_pen: Number(r.total_revenue_pen ?? 0),
            total_cogs_pen:
              r.total_cogs_pen !== null && r.total_cogs_pen !== undefined
                ? Number(r.total_cogs_pen)
                : null,
            gross_margin_pen:
              r.gross_margin_pen !== null && r.gross_margin_pen !== undefined
                ? Number(r.gross_margin_pen)
                : null,
            gross_margin_pct:
              r.gross_margin_pct !== null && r.gross_margin_pct !== undefined
                ? Number(r.gross_margin_pct)
                : null,
          })),
          kpiQ3: bundle?.q3 ?? [],
          qualityGaps: (bundle?.gaps ?? []).map((r) => ({
            ...r,
            gap_count: Number(r.gap_count ?? 0),
            impacted_amount_pen: Number(r.impacted_amount_pen ?? 0),
          })),
          pendingOnDemand: (bundle?.on_demand ?? []).map((r) => ({
            ...r,
            order_line_id: Number(r.order_line_id),
            order_id: Number(r.order_id),
            warehouse_id: Number(r.warehouse_id),
            customer_party_id:
              r.customer_party_id !== null && r.customer_party_id !== undefined
                ? Number(r.customer_party_id)
                : null,
            product_id: Number(r.product_id),
            quantity: Number(r.quantity),
            pack_factor_applied: Number(r.pack_factor_applied),
            required_base_qty: Number(r.required_base_qty),
            current_stock_on_hand: Number(r.current_stock_on_hand),
            line_total_pen: Number(r.line_total_pen),
            balance_due_pen: Number(r.balance_due_pen),
            days_pending: Number(r.days_pending),
            open_flag_id:
              r.open_flag_id !== null && r.open_flag_id !== undefined
                ? Number(r.open_flag_id)
                : null,
          })),
          negativeStockSkuCount: Number(bundle?.neg_count ?? 0),
          unpurchasedRegularizationCount: Number(bundle?.unpurchased_reg_count ?? 0),
          users: isPartnerAdmin
            ? (bundle?.users ?? []).map((u) => ({
                user_id: Number(u.user_id),
                username: String(u.username),
                full_name: String(u.full_name),
                role: String(u.role),
                is_active: Boolean(u.is_active),
                email: u.email ? String(u.email) : null,
              }))
            : [],
          userAccessHistory: isPartnerAdmin
            ? (bundle?.user_access_history ?? []).map((entry) => ({
                audit_id: Number(entry.audit_id),
                action: String(entry.action),
                target_user_id: Number(entry.target_user_id),
                target_username: String(entry.target_username),
                target_name: String(entry.target_name),
                actor_username: String(entry.actor_username),
                actor_name: String(entry.actor_name),
                before_data:
                  entry.before_data && typeof entry.before_data === "object"
                    ? entry.before_data
                    : null,
                after_data:
                  entry.after_data && typeof entry.after_data === "object"
                    ? entry.after_data
                    : {},
                created_at: String(entry.created_at),
              }))
            : [],
          cashFlowSummary: await getCashFlowSummary(client),
          biSummary,
          dataCut: mapDataCutSummary(bundle?.data_cut),
          operationalQuality: mapOperationalQualitySummary(bundle?.operational_quality),
          auditFlags: (bundle?.audit_flags ?? []).map(mapAuditFlagRow),
          auditFlagCounts: mapAuditFlagCounts(bundle?.audit_flag_counts),
        };
      }
    );

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error cargando datos de socios",
      "GET /api/partners"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await readRawJsonBody(req);

    const result = await withAuthenticatedTransaction(
      req,
      ["PARTNER_ADMIN", "PARTNER_MANAGER"],
      async (client, actor) => {
        const body = parseBody(partnersMutationSchema, rawBody);
        const action = body.action;
        return runIdempotentMutation(
          client,
          req,
          actor,
          `partners:${action}`,
          body,
          async () => {
            if (body.action === "reset_negative_stock") {
              return await resetHistoricalNegativeStock(client, actor);
            }
            if (body.action === "update_product") {
              await updateProductStockAndPricing(client, actor, {
                productId: body.productId,
                physicalStock: body.physicalStock,
                refCostPen: body.refCostPen,
                listSalePricePen: body.listSalePricePen,
                minSalePricePen: body.minSalePricePen,
                fulfillmentMode: body.fulfillmentMode,
                minStockQty: body.minStockQty,
                leadTimeDays: body.leadTimeDays,
                defaultSupplierPartyId: body.defaultSupplierPartyId,
              });
              return { ok: true };
            }
            if (body.action === "create_user") {
              assertRole(actor, ["PARTNER_ADMIN"]);
              const username = normalizeUsername(body.username);
              const fullName = normalizeFullName(body.fullName);
              const email = normalizeRequiredEmail(body.email);
              const role = parseUserRole(body.role);
              const createdRes = await client.query(
                `WITH generated AS (
                   SELECT encode(sha256(gen_random_uuid()::text::bytea), 'hex') AS legacy_hash
                 )
                 INSERT INTO erp.app_users
                   (username, full_name, email, role, password_hash,
                    must_change_password, is_active)
                 SELECT $1, $2, $3, $4::erp.user_role, legacy_hash, FALSE, TRUE
                 FROM generated
                 RETURNING user_id, username, full_name, email, role::text AS role, is_active`,
                [username, fullName, email, role]
              );
              const created = toUserSnapshot(createdRes.rows[0]);
              await recordUserAccessAudit(
                client,
                actor.userId,
                "USER_CREATED",
                null,
                created
              );
              return { ok: true, user: created };
            }
            if (body.action === "update_user_name") {
              assertRole(actor, ["PARTNER_ADMIN"]);
              const targetUserId = Number(body.userId);
              const fullName = normalizeFullName(body.fullName);
              const beforeRes = await client.query(
                `SELECT user_id, username, full_name, email, role::text AS role, is_active
                 FROM erp.app_users WHERE user_id = $1 FOR UPDATE`,
                [targetUserId]
              );
              if (beforeRes.rowCount === 0)
                throw new ValidationError("Usuario no encontrado");
              const before = toUserSnapshot(beforeRes.rows[0]);
              const updRes = await client.query(
                `UPDATE erp.app_users
                 SET full_name = $1
                 WHERE user_id = $2
                 RETURNING user_id, username, full_name, email, role::text AS role, is_active`,
                [fullName, targetUserId]
              );
              const after = toUserSnapshot(updRes.rows[0]);
              await recordUserAccessAudit(
                client,
                actor.userId,
                "USER_NAME_CHANGED",
                before,
                after
              );
              return { ok: true, user: after };
            }
            if (body.action === "update_user_email") {
              assertRole(actor, ["PARTNER_ADMIN"]);
              const targetUserId = Number(body.userId);
              const email = normalizeRequiredEmail(body.email);
              const beforeRes = await client.query(
                `SELECT user_id, username, full_name, email, role::text AS role, is_active
                 FROM erp.app_users WHERE user_id = $1 FOR UPDATE`,
                [targetUserId]
              );
              if (beforeRes.rowCount === 0)
                throw new ValidationError("Usuario no encontrado");
              const before = toUserSnapshot(beforeRes.rows[0]);
              const updRes = await client.query(
                `UPDATE erp.app_users
                 SET neon_auth_user_id = CASE
                       WHEN LOWER(BTRIM(COALESCE(email, ''))) = LOWER(BTRIM(COALESCE($1, '')))
                         THEN neon_auth_user_id
                       ELSE NULL
                     END,
                     email = $1
                 WHERE user_id = $2
                 RETURNING user_id, username, full_name, email, role::text AS role, is_active`,
                [email, targetUserId]
              );
              const after = toUserSnapshot(updRes.rows[0]);
              await recordUserAccessAudit(
                client,
                actor.userId,
                "USER_EMAIL_CHANGED",
                before,
                after
              );
              return { ok: true, user: after };
            }
            if (body.action === "update_user_role") {
              assertRole(actor, ["PARTNER_ADMIN"]);
              const targetUserId = Number(body.userId);
              if (targetUserId === actor.userId) {
                throw new ValidationError(
                  "No puedes cambiar el rol de tu propia cuenta"
                );
              }
              const role = parseUserRole(body.role);
              const beforeRes = await client.query(
                `SELECT user_id, username, full_name, email, role::text AS role, is_active
                 FROM erp.app_users WHERE user_id = $1 FOR UPDATE`,
                [targetUserId]
              );
              if (beforeRes.rowCount === 0)
                throw new ValidationError("Usuario no encontrado");
              const before = toUserSnapshot(beforeRes.rows[0]);
              if (
                before.role === "PARTNER_ADMIN" &&
                role !== "PARTNER_ADMIN" &&
                before.is_active
              ) {
                const admins = await client.query<{ count: string }>(
                  `SELECT COUNT(*)::text AS count
                   FROM erp.app_users
                   WHERE role = 'PARTNER_ADMIN' AND is_active = TRUE`
                );
                if (Number(admins.rows[0]?.count ?? 0) <= 1) {
                  throw new ValidationError(
                    "Debe permanecer al menos un administrador activo"
                  );
                }
              }
              const updRes = await client.query(
                `UPDATE erp.app_users
                 SET role = $1::erp.user_role
                 WHERE user_id = $2
                 RETURNING user_id, username, full_name, email, role::text AS role, is_active`,
                [role, targetUserId]
              );
              const after = toUserSnapshot(updRes.rows[0]);
              await recordUserAccessAudit(
                client,
                actor.userId,
                "USER_ROLE_CHANGED",
                before,
                after
              );
              return { ok: true, user: after };
            }
            if (body.action === "toggle_user_active") {
              assertRole(actor, ["PARTNER_ADMIN"]);
              const targetUserId = Number(body.userId);
              if (targetUserId === actor.userId) {
                throw new ValidationError(
                  "No puedes desactivar tu propia cuenta de usuario"
                );
              }
              const userRes = await client.query(
                `SELECT user_id, username, full_name, email, role::text AS role, is_active
                 FROM erp.app_users WHERE user_id = $1 FOR UPDATE`,
                [targetUserId]
              );
              if (userRes.rowCount === 0) {
                throw new ValidationError("Usuario no encontrado");
              }
              const before = toUserSnapshot(userRes.rows[0]);
              const currentActive = before.is_active;
              const nextActive =
                typeof body.isActive === "boolean" ? body.isActive : !currentActive;
              if (before.role === "PARTNER_ADMIN" && currentActive && !nextActive) {
                const admins = await client.query<{ count: string }>(
                  `SELECT COUNT(*)::text AS count
                   FROM erp.app_users
                   WHERE role = 'PARTNER_ADMIN' AND is_active = TRUE`
                );
                if (Number(admins.rows[0]?.count ?? 0) <= 1) {
                  throw new ValidationError(
                    "Debe permanecer al menos un administrador activo"
                  );
                }
              }
              const updRes = await client.query(
                `UPDATE erp.app_users
                 SET is_active = $1
                 WHERE user_id = $2
                 RETURNING user_id, username, full_name, email, role::text AS role, is_active`,
                [nextActive, targetUserId]
              );
              const after = toUserSnapshot(updRes.rows[0]);
              await recordUserAccessAudit(
                client,
                actor.userId,
                nextActive ? "USER_ACTIVATED" : "USER_DEACTIVATED",
                before,
                after
              );
              return { ok: true, user: after };
            }
            if (body.action === "delete_user") {
              assertRole(actor, ["PARTNER_ADMIN"]);
              const targetUserId = Number(body.userId);
              if (targetUserId === actor.userId) {
                throw new ValidationError(
                  "No puedes eliminar tu propia cuenta de usuario"
                );
              }
              const userRes = await client.query(
                `SELECT user_id, username, full_name, email, role::text AS role, is_active
                 FROM erp.app_users
                 WHERE user_id = $1
                   AND username NOT LIKE '%\\_\\_deleted\\_%' ESCAPE '\\'
                 FOR UPDATE`,
                [targetUserId]
              );
              if (userRes.rowCount === 0) {
                throw new ValidationError("Usuario no encontrado");
              }
              const before = toUserSnapshot(userRes.rows[0]);
              if (before.role === "PARTNER_ADMIN" && before.is_active) {
                const admins = await client.query<{ count: string }>(
                  `SELECT COUNT(*)::text AS count
                   FROM erp.app_users
                   WHERE role = 'PARTNER_ADMIN' AND is_active = TRUE`
                );
                if (Number(admins.rows[0]?.count ?? 0) <= 1) {
                  throw new ValidationError(
                    "Debe permanecer al menos un administrador activo"
                  );
                }
              }
              await client.query(
                `UPDATE erp.app_users
                 SET is_active = FALSE,
                     email = NULL,
                     neon_auth_user_id = NULL,
                     username = username || '__deleted_' || user_id::text
                 WHERE user_id = $1`,
                [targetUserId]
              );
              await recordUserAccessAudit(
                client,
                actor.userId,
                "USER_DEACTIVATED",
                before,
                {
                  ...before,
                  email: null,
                  is_active: false,
                  deleted: true,
                }
              );
              return { ok: true, deletedUserId: targetUserId };
            }
            throw new ValidationError(`Acción desconocida: ${String(action)}`);
          }
        );
      }
    );

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error en acción de socio",
      "POST /api/partners"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}
