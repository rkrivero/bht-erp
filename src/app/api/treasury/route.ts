import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
import { assertRole, isPartnerRole } from "@/lib/rbac";
import { registerCashOutflow } from "@/lib/services/collections-and-treasury";
import { AuthorizationError, ValidationError } from "@/lib/types";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const actor = assertRole(verifySessionToken(token), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
      "EXTERNAL_SELLER",
    ]);

    const data = await withClient(async (client) => {
      const whereClause = isPartnerRole(actor.role)
        ? ""
        : "WHERE cl.expense_bucket = 'ROUTE_OPEX' AND cl.source_origin = 'ERP_APP'";

      const ledgerRes = await client.query(
        `SELECT
           cl.ledger_id,
           cl.tx_date::text AS tx_date,
           ca.name AS account_name,
           cl.direction::text AS direction,
           cl.amount_pen,
           cl.expense_bucket::text AS expense_bucket,
           cl.expense_category,
           cl.is_internal_transfer,
           cl.description
         FROM erp.cash_ledger cl
         JOIN erp.cash_accounts ca ON ca.account_id = cl.account_id
         ${whereClause}
         ORDER BY cl.tx_date DESC, cl.ledger_id DESC
         LIMIT 50`
      );

      const apRes = isPartnerRole(actor.role)
        ? await client.query(
            `SELECT
               ap.obligation_id,
               ap.doc_ref,
               ap.issue_date::text AS issue_date,
               pa.legal_name AS supplier_name,
               ap.principal_pen,
               ap.paid_pen,
               ap.balance_pen,
               ap.status::text AS status
             FROM erp.ap_obligations ap
             LEFT JOIN erp.parties pa ON pa.party_id = ap.supplier_party_id
             ORDER BY ap.balance_pen DESC, ap.issue_date ASC`
          )
        : { rows: [] };

      return {
        ledger: ledgerRes.rows,
        apObligations: apRes.rows,
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
      { error: err instanceof Error ? err.message : "Error en caja" },
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
      "EXTERNAL_SELLER",
    ]);

    const body = await req.json();
    const result = await withTransaction(async (client) => {
      return await registerCashOutflow(client, actor, {
        amountPen: Number(body.amountPen),
        expenseBucket: body.expenseBucket || "ROUTE_OPEX",
        expenseCategory: String(body.expenseCategory || "GASTO_RUTA"),
        description: String(body.description || ""),
        accountId: body.accountId ? Number(body.accountId) : undefined,
        isInternalTransfer: Boolean(body.isInternalTransfer),
      });
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
      { error: err instanceof Error ? err.message : "Error registrando gasto" },
      { status }
    );
  }
}
