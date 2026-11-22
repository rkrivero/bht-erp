import { NextRequest, NextResponse } from "next/server";
import { withAuthenticatedClient, withAuthenticatedTransaction } from "@/lib/auth";
import { resolveHttpError } from "@/lib/http-errors";
import { runIdempotentMutation } from "@/lib/idempotency";
import { isPartnerRole } from "@/lib/rbac";
import { registerCashOutflow } from "@/lib/services/collections-and-treasury";
import {
  AP_OBLIGATIONS_DETAIL_SUBQUERY,
  mapApObligationRow,
} from "@/lib/services/purchases-and-suppliers";
import { parseBody, readRawJsonBody } from "@/lib/validation/parse";
import { treasuryCashOutflowSchema } from "@/lib/validation/treasury.schema";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

const TREASURY_ROLES = ["PARTNER_ADMIN", "PARTNER_MANAGER", "EXTERNAL_SELLER"] as const;

export async function GET(req: NextRequest) {
  try {
    const data = await withAuthenticatedClient(
      req,
      [...TREASURY_ROLES],
      async (client, actor) => {
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
                   cl.trip_id,
                   rt.trip_code,
                   rt.zone_name AS trip_zone,
                   CASE
                     WHEN $1::boolean THEN COALESCE(pa.trade_name, pa.legal_name)
                     ELSE NULL
                   END AS party_name,
                   cl.direction::text AS direction,
                   cl.amount_pen,
                   cl.expense_bucket::text AS expense_bucket,
                   cl.expense_category,
                   cl.is_internal_transfer,
                   cl.reference_table,
                   cl.reference_id,
                   cl.source_origin::text AS source_origin,
                   cl.created_at::text AS created_at,
                   cl.description
                 FROM erp.cash_ledger cl
                 JOIN erp.cash_accounts ca ON ca.account_id = cl.account_id
                 LEFT JOIN erp.route_trips rt ON rt.trip_id = cl.trip_id
                 LEFT JOIN erp.parties pa ON pa.party_id = cl.party_id
                 ${whereClause}
                 ORDER BY cl.tx_date DESC, cl.ledger_id DESC
                 LIMIT 150
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
            trip_id:
              r.trip_id !== null && r.trip_id !== undefined ? Number(r.trip_id) : null,
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
            phone: r.phone !== null && r.phone !== undefined ? String(r.phone) : null,
          })),
          accounts: (bundle.accounts ?? []).map((r) => ({
            account_id: Number(r.account_id),
            code: String(r.code),
            name: String(r.name),
            account_type: String(r.account_type),
            current_balance_pen: Number(r.current_balance_pen ?? 0),
          })),
        };
      }
    );

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error en caja",
      "GET /api/treasury"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await readRawJsonBody(req);

    const result = await withAuthenticatedTransaction(
      req,
      [...TREASURY_ROLES],
      async (client, actor) => {
        const body = parseBody(treasuryCashOutflowSchema, rawBody);
        return runIdempotentMutation(
          client,
          req,
          actor,
          "treasury:cash_outflow",
          body,
          () =>
            registerCashOutflow(client, actor, {
              amountPen: body.amountPen,
              expenseBucket: body.isInternalTransfer
                ? null
                : body.expenseBucket || "ROUTE_OPEX",
              expenseCategory: body.expenseCategory || "GASTO_RUTA",
              txDate: body.txDate,
              description: body.description || "",
              accountId: body.accountId,
              toAccountId: body.toAccountId,
              isInternalTransfer: Boolean(body.isInternalTransfer),
              tripId: body.tripId,
            })
        );
      }
    );

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error registrando gasto",
      "POST /api/treasury"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}
