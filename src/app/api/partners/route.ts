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
      const [
        q1Res,
        q2Res,
        q3Res,
        gapsRes,
        onDemandRes,
        negStockRes,
        usersRes,
      ] = await Promise.all([
        client.query(`SELECT * FROM analytics.v_kpi_cash_and_reinvestment LIMIT 1`),
        client.query(
          `SELECT sku, product_name, fulfillment_mode, total_units_sold, total_revenue_pen, total_cogs_pen, gross_margin_pen, gross_margin_pct, margin_health_status
           FROM analytics.v_kpi_sku_margin_and_opex
           ORDER BY total_revenue_pen DESC
           LIMIT 40`
        ),
        client.query(
          `SELECT * FROM analytics.v_kpi_ar_customers_and_quotes ORDER BY section ASC, rank_in_section ASC LIMIT 40`
        ),
        client.query(
          `SELECT * FROM analytics.v_data_quality_gaps ORDER BY metric_code ASC`
        ),
        client.query(
          `SELECT * FROM analytics.v_pending_on_demand_orders ORDER BY order_date DESC`
        ),
        client.query(
          `SELECT COUNT(*)::int AS neg_count FROM erp.v_current_stock WHERE stock_on_hand < -0.0001`
        ),
        client.query(
          `SELECT user_id, username, full_name, role::text AS role, is_active FROM erp.app_users ORDER BY user_id ASC`
        ),
      ]);

      return {
        kpiQ1: q1Res.rows[0] || null,
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
