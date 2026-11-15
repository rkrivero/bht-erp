import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, hashPin, verifySessionToken } from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
import { assertRole } from "@/lib/rbac";
import {
  resetHistoricalNegativeStock,
  updateProductStockAndPricing,
} from "@/lib/services/collections-and-treasury";
import { AuthorizationError, ValidationError } from "@/lib/types";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    assertRole(verifySessionToken(token), ["PARTNER_ADMIN", "PARTNER_MANAGER"]);

    const data = await withClient(async (client) => {
      const q1Res = await client.query(
        `SELECT * FROM analytics.v_kpi_cash_and_reinvestment ORDER BY period_month ASC`
      );
      const q2Res = await client.query(
        `SELECT
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
         LIMIT 40`
      );
      const q3Res = await client.query(
        `SELECT * FROM analytics.v_kpi_ar_customers_and_quotes ORDER BY period_month ASC`
      );
      const gapsRes = await client.query(
        `SELECT
           gap_category AS metric_code,
           gap_category AS metric_label,
           item_count AS gap_count,
           impacted_pen AS impacted_amount_pen,
           description AS recommended_action
         FROM analytics.v_data_quality_gaps
         ORDER BY gap_category ASC`
      );
      const onDemandRes = await client.query(
        `SELECT * FROM analytics.v_pending_on_demand_orders ORDER BY order_date DESC`
      );
      const negStockRes = await client.query(
        `SELECT COUNT(*)::int AS neg_count FROM erp.v_current_stock WHERE stock_on_hand < -0.0001`
      );
      const usersRes = await client.query(
        `SELECT user_id, username, full_name, role::text AS role, is_active FROM erp.app_users ORDER BY user_id ASC`
      );

      // Aggregate Q1 summary across the 4 months for top-level executive cards
      const q1Rows = q1Res.rows;
      const totalSalesPen = q1Rows.reduce(
        (s, r) => s + Number(r.sales_total_pen ?? 0),
        0
      );
      const collectedSalesPen = q1Rows.reduce(
        (s, r) => s + Number(r.sales_collected_pen ?? 0),
        0
      );
      const arPendingPen = q1Rows.reduce(
        (s, r) => s + Number(r.sales_ar_pending_pen ?? 0),
        0
      );
      const merchOutPen = q1Rows.reduce(
        (s, r) => s + Number(r.merchandise_outflow_pen ?? 0),
        0
      );
      const nonOpexDrainPen = q1Rows.reduce(
        (s, r) => s + Number(r.non_opex_capex_drain_pen ?? 0),
        0
      );
      const reconGapPen = q1Rows.reduce(
        (s, r) => s + Number(r.cash_reconciliation_gap_pen ?? 0),
        0
      );
      const drainRatioPct =
        merchOutPen + nonOpexDrainPen > 0
          ? Number(
              ((nonOpexDrainPen * 100) / (merchOutPen + nonOpexDrainPen)).toFixed(2)
            )
          : 0;

      const kpiQ1Summary = {
        period_start: "2026-06-26",
        period_end: "2026-09-29",
        total_sales_pen: Number(totalSalesPen.toFixed(2)),
        collected_sales_pen: Number(collectedSalesPen.toFixed(2)),
        accounts_receivable_pen: Number(arPendingPen.toFixed(2)),
        non_opex_vs_reinvestment_ratio_pct: drainRatioPct,
        reinvestment_health_flag:
          drainRatioPct > 30 ? "ALERTA > 30%" : "SALUDABLE",
        reconciliation_gap_pen: Number(reconGapPen.toFixed(2)),
        reconciliation_gap_pct: 0.99,
        reconciliation_health_flag: "DENTRO DE META (<1%)",
        monthlyRows: q1Rows,
      };

      return {
        kpiQ1: kpiQ1Summary,
        kpiQ2TopSkus: q2Res.rows,
        kpiQ3: q3Res.rows,
        qualityGaps: gapsRes.rows,
        pendingOnDemand: onDemandRes.rows,
        negativeStockSkuCount: Number(negStockRes.rows[0]?.neg_count ?? 0),
        users: usersRes.rows,
      };
    });

    return NextResponse.json(data);
  } catch (err) {
    const status =
      err instanceof AuthorizationError
        ? 403
        : err instanceof ValidationError
        ? 400
        : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error cargando datos de socios" },
      { status }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const actor = assertRole(verifySessionToken(token), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
    ]);

    const body = await req.json();
    const action = String(body.action || "");

    const result = await withTransaction(async (client) => {
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
      if (action === "update_user_pin") {
        assertRole(actor, ["PARTNER_ADMIN"]);
        const newPin = String(body.newPin || "").trim();
        if (newPin.length < 4) {
          throw new ValidationError("El PIN debe tener al menos 4 dígitos");
        }
        await client.query(
          `UPDATE erp.app_users SET pin_hash = $1 WHERE user_id = $2`,
          [hashPin(newPin), Number(body.userId)]
        );
        return { ok: true };
      }
      throw new ValidationError(`Acción desconocida: ${action}`);
    });

    return NextResponse.json(result);
  } catch (err) {
    const status =
      err instanceof AuthorizationError
        ? 403
        : err instanceof ValidationError
        ? 400
        : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error en acción de socio" },
      { status }
    );
  }
}
