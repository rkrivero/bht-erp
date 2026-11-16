import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  requireActiveSession,
  verifySessionToken,
} from "@/lib/auth";
import { withClient, withTransaction } from "@/lib/db";
import { runIdempotentMutation } from "@/lib/idempotency";
import { assertRole, isPartnerRole } from "@/lib/rbac";
import { registerCashOutflow } from "@/lib/services/collections-and-treasury";
import {
  AP_OBLIGATIONS_DETAIL_SUBQUERY,
  mapApObligationRow,
} from "@/lib/services/purchases-and-suppliers";
import {
  resolveHttpError,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const parsedActor = assertRole(verifySessionToken(token), [
      "PARTNER_ADMIN",
      "PARTNER_MANAGER",
      "EXTERNAL_SELLER",
    ]);

    const data = await withClient(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
        "EXTERNAL_SELLER",
      ]);
      const partnerAccess = isPartnerRole(actor.role);
      const whereClause = partnerAccess
        ? ""
        : "WHERE cl.expense_bucket = 'ROUTE_OPEX' AND cl.source_origin = 'ERP_APP'";

      const res = await client.query<{
        ledger: Array<Record<string, unknown>>;
        accounts: Array<Record<string, unknown>>;
        ap_obligations: Array<Record<string, unknown>>;
        suppliers: Array<Record<string, unknown>>;
      }>(
        `WITH account_balances AS (
           SELECT
             account_id,
             COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_pen ELSE -amount_pen END), 0)::NUMERIC(14,2) AS current_balance_pen
           FROM erp.cash_ledger
           GROUP BY account_id
         )
         SELECT
           COALESCE((
             SELECT json_agg(t)
             FROM (
               SELECT
                 cl.ledger_id,
                 cl.tx_date::text AS tx_date,
                 cl.account_id,
                 ca.code AS account_code,
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
               LIMIT 50
             ) t
           ), '[]'::json) AS ledger,
           COALESCE((
             SELECT json_agg(t)
             FROM (
               SELECT
                 ca.account_id,
                 ca.code,
                 ca.name,
                 ca.account_type,
                 COALESCE(ab.current_balance_pen, 0)::NUMERIC(14,2) AS current_balance_pen
               FROM erp.cash_accounts ca
               LEFT JOIN account_balances ab ON ab.account_id = ca.account_id
               WHERE ca.is_active = TRUE
                 AND ($1::boolean OR ca.account_type <> 'PARTNER_CUSTODY')
               ORDER BY ca.account_id ASC
             ) t
           ), '[]'::json) AS accounts,
           CASE WHEN $1::boolean THEN COALESCE((${AP_OBLIGATIONS_DETAIL_SUBQUERY}), '[]'::json) ELSE '[]'::json END AS ap_obligations,
           CASE WHEN $1::boolean THEN COALESCE((
             SELECT json_agg(t)
             FROM (
               SELECT
                 party_id,
                 doc_type::text AS doc_type,
                 doc_number,
                 legal_name,
                 trade_name,
                 COALESCE(trade_name, legal_name) AS display_name,
                 phone
               FROM erp.parties
               WHERE party_type IN ('SUPPLIER', 'BOTH')
                 AND is_active = TRUE
               ORDER BY COALESCE(trade_name, legal_name) ASC
             ) t
           ), '[]'::json) ELSE '[]'::json END AS suppliers`,
        [partnerAccess]
      );

      const bundle = res.rows[0] ?? {
        ledger: [],
        accounts: [],
        ap_obligations: [],
        suppliers: [],
      };

      return {
        ledger: (bundle.ledger ?? []).map((r) => ({
          ...r,
          ledger_id: Number(r.ledger_id),
          account_id: Number(r.account_id),
          amount_pen: Number(r.amount_pen),
        })),
        apObligations: (bundle.ap_obligations ?? []).map(mapApObligationRow),
        suppliers: (bundle.suppliers ?? []).map((r) => ({
          party_id: Number(r.party_id),
          doc_type: String(r.doc_type),
          doc_number:
            r.doc_number !== null && r.doc_number !== undefined
              ? String(r.doc_number)
              : null,
          legal_name: String(r.legal_name),
          trade_name:
            r.trade_name !== null && r.trade_name !== undefined
              ? String(r.trade_name)
              : null,
          display_name: String(r.display_name),
          phone:
            r.phone !== null && r.phone !== undefined ? String(r.phone) : null,
        })),
        accounts: (bundle.accounts ?? []).map((r) => ({
          account_id: Number(r.account_id),
          code: String(r.code),
          name: String(r.name),
          account_type: String(r.account_type),
          current_balance_pen: Number(r.current_balance_pen ?? 0),
        })),
      };
    });

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, error } = resolveHttpError(err, "Error en caja");
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
      "EXTERNAL_SELLER",
    ]);

    const body = await req.json();
    const result = await withTransaction(async (client) => {
      const actor = assertRole(await requireActiveSession(client, parsedActor), [
        "PARTNER_ADMIN",
        "PARTNER_MANAGER",
        "EXTERNAL_SELLER",
      ]);
      return runIdempotentMutation(
        client,
        req,
        actor,
        "treasury:cash_outflow",
        body,
        () =>
          registerCashOutflow(client, actor, {
            amountPen: Number(body.amountPen),
            expenseBucket: body.isInternalTransfer
              ? null
              : body.expenseBucket || "ROUTE_OPEX",
            expenseCategory: String(body.expenseCategory || "GASTO_RUTA"),
            description: String(body.description || ""),
            accountId: body.accountId ? Number(body.accountId) : undefined,
            toAccountId: body.toAccountId ? Number(body.toAccountId) : undefined,
            isInternalTransfer: Boolean(body.isInternalTransfer),
          })
      );
    });

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, error, code, entityRef } = resolveHttpError(
      err,
      "Error registrando gasto"
    );
    return NextResponse.json(
      { error, ...(code ? { code } : {}), ...(entityRef ? { entityRef } : {}) },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
