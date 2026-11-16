import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  hashPassword,
  requireActiveSession,
  signSessionToken,
  verifySessionToken,
} from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
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
import { listAuditFlags } from "@/lib/services/operations-and-modules";
import {
  resolveHttpError,
  ValidationError,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

type PartnerDashboardBundleRow = BiNonMonthlyPanelsRow & {
  q1: Array<Record<string, unknown>>;
  q2: Array<Record<string, unknown>>;
  q3: Array<Record<string, unknown>>;
  gaps: Array<Record<string, unknown>>;
  on_demand: Array<Record<string, unknown>>;
  neg_count: number;
  users: Array<Record<string, unknown>>;
  open_debtors_count: number;
  period_end: string;
};

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const parsedActor = assertRole(verifySessionToken(token), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
    ]);

    const data = await withClient(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
      ]);
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
             SELECT json_agg(t)
             FROM (
               SELECT
                 user_id,
                 username,
                 full_name,
                 role::text AS role,
                 is_active
               FROM erp.app_users
               ORDER BY user_id ASC
             ) t
           ), '[]'::json) AS users,
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
           ${BI_NON_MONTHLY_SELECTS}`
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
        reinvestment_health_flag:
          drainRatioPct > 30 ? "ALERTA > 30%" : "SALUDABLE",
        reconciliation_gap_pen: reconGapPen,
        reconciliation_gap_pct: reconGapPct,
        reconciliation_health_flag:
          reconGapPct <= 1 ? "DENTRO DE META (<1%)" : "ALERTA BRECHA (>1%)",
        monthlyRows: q1Rows,
      };

      const biSummary = mapBiSummaryFromPanels(
        bundle ?? {},
        mapBiMonthlyRows(q1Raw)
      );

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
        users: (bundle?.users ?? []).map((u) => ({
          user_id: Number(u.user_id),
          username: String(u.username),
          full_name: String(u.full_name),
          role: String(u.role),
          is_active: Boolean(u.is_active),
        })),
        biSummary,
        ...(await (async () => {
          const auditFlagsData = await listAuditFlags(client, actor, {
            status: "ALL",
            limit: 60,
          });
          return {
            auditFlags: auditFlagsData.flags,
            auditFlagCounts: auditFlagsData.counts,
          };
        })()),
      };
    });

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, error } = resolveHttpError(
      err,
      "Error cargando datos de socios"
    );
    return NextResponse.json(
      { error },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const parsedActor = assertRole(verifySessionToken(token), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
    ]);

    const body = await req.json();
    const action = String(body.action || "");

    const result = await withTransaction(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
      ]);
      if (action === "reset_negative_stock") {
        return await resetHistoricalNegativeStock(client, actor);
      }
      if (action === "update_product") {
        await updateProductStockAndPricing(client, actor, {
          productId: Number(body.productId),
          physicalStock:
            body.physicalStock !== undefined && body.physicalStock !== ""
              ? Number(body.physicalStock)
              : undefined,
          refCostPen:
            body.refCostPen !== undefined && body.refCostPen !== ""
              ? Number(body.refCostPen)
              : undefined,
          listSalePricePen:
            body.listSalePricePen !== undefined && body.listSalePricePen !== ""
              ? Number(body.listSalePricePen)
              : undefined,
          minSalePricePen:
            body.minSalePricePen !== undefined && body.minSalePricePen !== ""
              ? Number(body.minSalePricePen)
              : undefined,
          fulfillmentMode: body.fulfillmentMode || undefined,
        });
        return { ok: true };
      }
      if (action === "update_user_name") {
        assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);
        const targetUserId = Number(body.userId);
        if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
          throw new ValidationError("ID de usuario inválido");
        }
        const fullName = String(body.fullName || "")
          .trim()
          .replace(/\s+/g, " ");
        if (fullName.length < 2 || fullName.length > 60) {
          throw new ValidationError(
            "El nombre visible debe tener entre 2 y 60 caracteres"
          );
        }
        const updRes = await client.query(
          `UPDATE erp.app_users
           SET full_name = $1
           WHERE user_id = $2
           RETURNING user_id, username, full_name, role::text AS role, is_active`,
          [fullName, targetUserId]
        );
        if (updRes.rowCount === 0) {
          throw new ValidationError("Usuario no encontrado");
        }
        return {
          ok: true,
          user: {
            user_id: Number(updRes.rows[0].user_id),
            username: String(updRes.rows[0].username),
            full_name: String(updRes.rows[0].full_name),
            role: String(updRes.rows[0].role),
            is_active: Boolean(updRes.rows[0].is_active),
          },
          refreshedSelfName:
            targetUserId === actor.userId ? fullName : undefined,
          refreshedSelfSession:
            targetUserId === actor.userId
              ? { ...actor, fullName }
              : undefined,
        };
      }
      if (action === "reset_user_password" || action === "update_user_pin") {
        assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);
        const targetUserId = Number(body.userId);
        if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
          throw new ValidationError("ID de usuario inválido");
        }
        const isLegacyPinAction = action === "update_user_pin";
        const temporaryPassword = String(
          isLegacyPinAction ? body.newPin : body.temporaryPassword
        ).trim();
        if (
          (isLegacyPinAction && !/^\d{4,8}$/.test(temporaryPassword)) ||
          (!isLegacyPinAction &&
            (temporaryPassword.length < 10 ||
              !/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(temporaryPassword) ||
              !/\d/.test(temporaryPassword)))
        ) {
          throw new ValidationError(
            isLegacyPinAction
              ? "El PIN debe tener entre 4 y 8 dígitos numéricos"
              : "La contraseña temporal debe tener 10 caracteres o más e incluir una letra y un número"
          );
        }
        const passwordHash = hashPassword(temporaryPassword);
        const updRes = await client.query(
          `UPDATE erp.app_users
           SET password_hash = $1,
               pin_hash = $1,
               must_change_password = TRUE
           WHERE user_id = $2
           RETURNING user_id`,
          [passwordHash, targetUserId]
        );
        if (updRes.rowCount === 0) {
          throw new ValidationError("Usuario no encontrado");
        }
        return { ok: true, mustChangePassword: true };
      }
      if (action === "toggle_user_active") {
        assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);
        const targetUserId = Number(body.userId);
        if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
          throw new ValidationError("ID de usuario inválido");
        }
        if (targetUserId === actor.userId) {
          throw new ValidationError(
            "No puedes desactivar tu propia cuenta de usuario"
          );
        }
        const userRes = await client.query(
          `SELECT user_id, is_active FROM erp.app_users WHERE user_id = $1 FOR UPDATE`,
          [targetUserId]
        );
        if (userRes.rowCount === 0) {
          throw new ValidationError("Usuario no encontrado");
        }
        const currentActive = Boolean(userRes.rows[0].is_active);
        const nextActive =
          typeof body.isActive === "boolean" ? body.isActive : !currentActive;
        const updRes = await client.query(
          `UPDATE erp.app_users
           SET is_active = $1
           WHERE user_id = $2
           RETURNING user_id, username, full_name, role::text AS role, is_active`,
          [nextActive, targetUserId]
        );
        return {
          ok: true,
          user: {
            user_id: Number(updRes.rows[0].user_id),
            username: String(updRes.rows[0].username),
            full_name: String(updRes.rows[0].full_name),
            role: String(updRes.rows[0].role),
            is_active: Boolean(updRes.rows[0].is_active),
          },
        };
      }
      throw new ValidationError(`Acción desconocida: ${action}`);
    });

    const refreshedSelfSession =
      "refreshedSelfSession" in result && result.refreshedSelfSession
        ? result.refreshedSelfSession
        : null;
    const responsePayload =
      "refreshedSelfSession" in result
        ? Object.fromEntries(
            Object.entries(result).filter(
              ([key]) => key !== "refreshedSelfSession"
            )
          )
        : result;
    const res = NextResponse.json(responsePayload, { headers: NO_STORE_HEADERS });
    if (action === "update_user_name" && refreshedSelfSession) {
      const updatedToken = signSessionToken(refreshedSelfSession);
      res.cookies.set(SESSION_COOKIE_NAME, updatedToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: SESSION_TTL_SECONDS,
      });
    }
    return res;
  } catch (err) {
    const { status, error } = resolveHttpError(err, "Error en acción de socio");
    return NextResponse.json(
      { error },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
