import type { PoolClient } from "pg";
import { resolveCatalogProductMatch } from "../product-matching";
import { assertRole } from "../rbac";
import { getLimaDateString } from "./orders";
import { ValidationError, type SessionUser } from "../types";

export interface SupplierRow {
  party_id: number;
  legal_name: string;
  trade_name: string | null;
  display_name: string;
  doc_type: string;
  doc_number: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  open_ap_balance_pen: number;
  open_docs_count: number;
}

export interface PurchaseInvoiceLineDetail {
  purchase_line_id: number;
  line_no: number;
  product_id: number | null;
  sku: string | null;
  raw_description: string;
  unit_of_measure: string;
  quantity: number;
  unit_cost_pen: number;
  line_total_pen: number;
}

export interface ApPaymentHistoryItem {
  ledger_id: number;
  tx_date: string;
  account_name: string;
  amount_pen: number;
  description: string;
}

export interface RecentPurchaseRow {
  purchase_id: number;
  supplier_party_id: number | null;
  supplier_name: string;
  supplier_ruc: string;
  doc_type: string;
  doc_series: string;
  doc_number: string;
  issue_date: string;
  due_date: string | null;
  total_pen: number;
  expense_bucket: string;
  expense_category: string;
  has_itemized_lines: boolean;
  line_count: number;
  source_origin: string;
  raw_notes: string | null;
  lines?: PurchaseInvoiceLineDetail[];
}

export interface ApObligationRow {
  ap_id: number;
  purchase_id: number | null;
  supplier_party_id: number | null;
  supplier_name: string;
  doc_ref: string;
  obligation_type: string;
  doc_type?: string | null;
  expense_category?: string | null;
  issue_date: string;
  due_date: string | null;
  original_amount_pen: number;
  paid_amount_pen: number;
  balance_due_pen: number;
  status: "OPEN" | "PARTIAL" | "PAID" | "CANCELLED";
  notes: string | null;
  line_count?: number;
  lines?: PurchaseInvoiceLineDetail[];
  payments?: ApPaymentHistoryItem[];
}

function mapPurchaseLineDetails(rawLines: unknown): PurchaseInvoiceLineDetail[] {
  if (!Array.isArray(rawLines)) return [];
  return rawLines.map((ln) => ({
    purchase_line_id: Number(ln.purchase_line_id),
    line_no: Number(ln.line_no ?? 0),
    product_id:
      ln.product_id !== null && ln.product_id !== undefined
        ? Number(ln.product_id)
        : null,
    sku: ln.sku !== null && ln.sku !== undefined ? String(ln.sku) : null,
    raw_description: String(ln.raw_description ?? ""),
    unit_of_measure: String(ln.unit_of_measure || "NIU"),
    quantity: Number(ln.quantity ?? 0),
    unit_cost_pen: Number(ln.unit_cost_pen ?? 0),
    line_total_pen: Number(ln.line_total_pen ?? 0),
  }));
}

/** Shared SQL subquery returning AP obligations with itemized invoice lines and ledger payment history. */
export const AP_OBLIGATIONS_DETAIL_SUBQUERY = `
  WITH ap_line_agg AS (
    SELECT
      pil.purchase_id,
      COUNT(*)::int AS line_count,
      json_agg(
        json_build_object(
          'purchase_line_id', pil.purchase_line_id,
          'line_no', pil.line_no,
          'product_id', pil.product_id,
          'sku', pr.sku,
          'raw_description', pil.raw_description,
          'unit_of_measure', COALESCE(pil.unit_of_measure, pr.unit_of_measure, 'NIU'),
          'quantity', pil.quantity,
          'unit_cost_pen', pil.unit_cost_pen,
          'line_total_pen', pil.line_total_pen
        )
        ORDER BY pil.line_no ASC, pil.purchase_line_id ASC
      ) AS lines
    FROM erp.purchase_invoice_lines pil
    LEFT JOIN erp.products pr ON pr.product_id = pil.product_id
    GROUP BY pil.purchase_id
  ),
  ap_pay_agg AS (
    SELECT
      cl.reference_id,
      json_agg(
        json_build_object(
          'ledger_id', cl.ledger_id,
          'tx_date', cl.tx_date::text,
          'account_name', COALESCE(ca.name, 'Caja / Banco'),
          'amount_pen', cl.amount_pen,
          'description', cl.description
        )
        ORDER BY cl.tx_date DESC, cl.ledger_id DESC
      ) AS payments
    FROM erp.cash_ledger cl
    LEFT JOIN erp.cash_accounts ca ON ca.account_id = cl.account_id
    WHERE cl.reference_table = 'erp.ap_obligations'
      AND cl.direction = 'OUT'
    GROUP BY cl.reference_id
  ),
  ap_pay_by_party AS (
    SELECT
      cl.reference_id,
      cl.party_id,
      json_agg(
        json_build_object(
          'ledger_id', cl.ledger_id,
          'tx_date', cl.tx_date::text,
          'account_name', COALESCE(ca.name, 'Caja / Banco'),
          'amount_pen', cl.amount_pen,
          'description', cl.description
        )
        ORDER BY cl.tx_date DESC, cl.ledger_id DESC
      ) AS payments
    FROM erp.cash_ledger cl
    LEFT JOIN erp.cash_accounts ca ON ca.account_id = cl.account_id
    WHERE cl.reference_table = 'erp.ap_obligations'
      AND cl.direction = 'OUT'
    GROUP BY cl.reference_id, cl.party_id
  )
  SELECT json_agg(t)
  FROM (
    SELECT
      ap.ap_id,
      ap.purchase_id,
      ap.supplier_party_id,
      COALESCE(pa.trade_name, pa.legal_name, 'Proveedor sin especificar') AS supplier_name,
      ap.doc_ref,
      ap.obligation_type,
      pi.doc_type,
      pi.expense_category,
      ap.issue_date::text AS issue_date,
      ap.due_date::text AS due_date,
      ap.original_amount_pen,
      ap.paid_amount_pen,
      CASE
        WHEN ap.status IN ('OPEN', 'PARTIAL') AND ap.balance_due_pen > 0.05 THEN ap.balance_due_pen
        ELSE 0::numeric(14,2)
      END AS balance_due_pen,
      ap.status::text AS status,
      ap.notes,
      COALESCE(ala.line_count, 0) AS line_count,
      COALESCE(ala.lines, '[]'::json) AS lines,
      COALESCE(pay_id.payments, pay_ref.payments, '[]'::json) AS payments
    FROM erp.ap_obligations ap
    LEFT JOIN erp.parties pa ON pa.party_id = ap.supplier_party_id
    LEFT JOIN erp.purchase_invoices pi ON pi.purchase_id = ap.purchase_id
    LEFT JOIN ap_line_agg ala ON ala.purchase_id = ap.purchase_id
    LEFT JOIN ap_pay_agg pay_id ON pay_id.reference_id = ap.ap_id::text
    LEFT JOIN ap_pay_by_party pay_ref
      ON ap.doc_ref IS NOT NULL
     AND ap.doc_ref <> ''
     AND pay_ref.reference_id = ap.doc_ref
     AND (pay_ref.party_id IS NULL OR ap.supplier_party_id IS NULL OR pay_ref.party_id = ap.supplier_party_id)
     AND pay_id.reference_id IS NULL
    ORDER BY
      CASE WHEN ap.status IN ('OPEN', 'PARTIAL') AND ap.balance_due_pen > 0.05 THEN 0 ELSE 1 END ASC,
      ap.balance_due_pen DESC,
      ap.issue_date ASC,
      ap.ap_id DESC
  ) t
`;

export function mapApObligationRow(r: Record<string, unknown>): ApObligationRow {
  return {
    ap_id: Number(r.ap_id),
    purchase_id:
      r.purchase_id !== null && r.purchase_id !== undefined
        ? Number(r.purchase_id)
        : null,
    supplier_party_id:
      r.supplier_party_id !== null && r.supplier_party_id !== undefined
        ? Number(r.supplier_party_id)
        : null,
    supplier_name: String(r.supplier_name),
    doc_ref: String(r.doc_ref),
    obligation_type: String(r.obligation_type),
    doc_type:
      r.doc_type !== null && r.doc_type !== undefined ? String(r.doc_type) : null,
    expense_category:
      r.expense_category !== null && r.expense_category !== undefined
        ? String(r.expense_category)
        : null,
    issue_date: String(r.issue_date),
    due_date:
      r.due_date !== null && r.due_date !== undefined ? String(r.due_date) : null,
    original_amount_pen: Number(r.original_amount_pen ?? 0),
    paid_amount_pen: Number(r.paid_amount_pen ?? 0),
    balance_due_pen: Number(r.balance_due_pen ?? 0),
    status: r.status as ApObligationRow["status"],
    notes: r.notes !== null && r.notes !== undefined ? String(r.notes) : null,
    line_count: Number(r.line_count ?? 0),
    lines: mapPurchaseLineDetails(r.lines),
    payments: Array.isArray(r.payments)
      ? r.payments.map((p: Record<string, unknown>) => ({
          ledger_id: Number(p.ledger_id),
          tx_date: String(p.tx_date),
          account_name: String(p.account_name ?? "Caja / Banco"),
          amount_pen: Number(p.amount_pen ?? 0),
          description: String(p.description ?? ""),
        }))
      : [],
  };
}

export interface CreateSupplierInput {
  legalName: string;
  tradeName?: string | null;
  docType?: "RUC" | "DNI" | "CE" | "PASSPORT" | "NONE";
  docNumber?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
}

export interface RegisterPurchaseLineInput {
  productId?: number | null;
  sku?: string | null;
  rawDescription?: string | null;
  quantity: number;
  unitCostPen: number;
}

export interface RegisterPurchaseInput {
  supplierPartyId: number;
  docType: string;
  docSeries: string;
  docNumber: string;
  issueDate?: string;
  dueDate?: string | null;
  currency?: "PEN" | "USD";
  exchangeRate?: number;
  taxMode?: "NONE" | "INCLUDED" | "EXCLUDED";
  paymentCondition: "CASH" | "CREDIT" | "PARTIAL";
  paidNowPen?: number;
  accountId?: number;
  notes?: string;
  items: RegisterPurchaseLineInput[];
  fulfillOrderLineIds?: number[];
}

export interface PayApObligationInput {
  apId: number;
  amountPen: number;
  accountId?: number;
  notes?: string;
}

const VALID_DOC_TYPES = new Set(["RUC", "DNI", "CE", "PASSPORT", "NONE"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPgUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

function assertValidDateString(value: string, fieldLabel: string): string {
  const trimmed = value.trim();
  if (!DATE_RE.test(trimmed)) {
    throw new ValidationError(`${fieldLabel} debe tener formato YYYY-MM-DD`);
  }
  return trimmed;
}

async function resolvePurchaseAccountId(
  client: PoolClient,
  actor: SessionUser,
  explicitAccountId?: number
): Promise<number> {
  if (explicitAccountId !== undefined && explicitAccountId !== null) {
    const res = await client.query(
      `SELECT account_id FROM erp.cash_accounts WHERE account_id = $1 AND is_active = TRUE LIMIT 1`,
      [Number(explicitAccountId)]
    );
    if (res.rowCount === 0) {
      throw new ValidationError("Cuenta de caja o banco no válida o inactiva");
    }
    return Number(res.rows[0].account_id);
  }

  if (actor.defaultCashAccountId) {
    const res = await client.query(
      `SELECT account_id FROM erp.cash_accounts WHERE account_id = $1 AND is_active = TRUE LIMIT 1`,
      [actor.defaultCashAccountId]
    );
    if (res.rowCount && res.rowCount > 0) {
      return Number(res.rows[0].account_id);
    }
  }

  const fallbackRes = await client.query(
    `SELECT account_id
     FROM erp.cash_accounts
     WHERE is_active = TRUE
     ORDER BY
       CASE
         WHEN code = 'CAJA_RUTA' THEN 0
         WHEN account_type IN ('CASH_BOX', 'BANK') THEN 1
         ELSE 2
       END ASC,
       account_id ASC
     LIMIT 1`
  );
  if (fallbackRes.rowCount === 0) {
    throw new ValidationError("No hay cuentas de caja o banco activas");
  }
  return Number(fallbackRes.rows[0].account_id);
}

/** Load suppliers, recent purchases, pending ON_DEMAND lines, AP obligations, and active accounts. */
export async function getPurchasesDashboard(
  client: PoolClient,
  actor: SessionUser
): Promise<{
  suppliers: SupplierRow[];
  recentPurchases: RecentPurchaseRow[];
  pendingOnDemand: Array<Record<string, unknown>>;
  apObligations: ApObligationRow[];
  accounts: Array<{
    account_id: number;
    code: string;
    name: string;
    account_type: string;
  }>;
}> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);

  // Batch all 5 dashboard panels into 1 query on the caller's client so
  // it stays safe inside uncommitted test transactions and avoids pg@9 warnings.
  const bundleRes = await client.query<{
    suppliers: Array<Record<string, unknown>>;
    recent_purchases: Array<Record<string, unknown>>;
    pending_on_demand: Array<Record<string, unknown>>;
    ap_obligations: Array<Record<string, unknown>>;
    accounts: Array<Record<string, unknown>>;
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
             pa.party_id,
             pa.legal_name,
             pa.trade_name,
             COALESCE(pa.trade_name, pa.legal_name) AS display_name,
             pa.doc_type::text AS doc_type,
             pa.doc_number,
             pa.phone,
             pa.address,
             pa.notes,
             COALESCE(SUM(CASE WHEN ap.status IN ('OPEN', 'PARTIAL') AND ap.balance_due_pen > 0.05 THEN ap.balance_due_pen ELSE 0 END), 0)::numeric(14,2) AS open_ap_balance_pen,
             COUNT(ap.ap_id) FILTER (WHERE ap.status IN ('OPEN', 'PARTIAL') AND ap.balance_due_pen > 0.05)::int AS open_docs_count
           FROM erp.parties pa
           LEFT JOIN erp.ap_obligations ap ON ap.supplier_party_id = pa.party_id
           WHERE pa.party_type IN ('SUPPLIER', 'BOTH')
             AND pa.is_active = TRUE
           GROUP BY pa.party_id, pa.legal_name, pa.trade_name, pa.doc_type, pa.doc_number, pa.phone, pa.address, pa.notes
           ORDER BY open_ap_balance_pen DESC, COALESCE(pa.trade_name, pa.legal_name) ASC
         ) t
       ), '[]'::json) AS suppliers,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             pi.purchase_id,
             pi.supplier_party_id,
             COALESCE(pa.trade_name, pa.legal_name, pi.supplier_name_raw, 'Proveedor sin especificar') AS supplier_name,
             pi.supplier_ruc,
             pi.doc_type,
             pi.doc_series,
             pi.doc_number,
             pi.issue_date::text AS issue_date,
             pi.due_date::text AS due_date,
             pi.total_pen,
             pi.expense_bucket::text AS expense_bucket,
             pi.expense_category,
             pi.has_itemized_lines,
             COUNT(pil.purchase_line_id)::int AS line_count,
             pi.source_origin::text AS source_origin,
             pi.raw_notes,
             COALESCE((
               SELECT json_agg(t2)
               FROM (
                 SELECT
                   pil2.purchase_line_id,
                   pil2.line_no,
                   pil2.product_id,
                   pr2.sku,
                   pil2.raw_description,
                   COALESCE(pil2.unit_of_measure, pr2.unit_of_measure, 'NIU') AS unit_of_measure,
                   pil2.quantity,
                   pil2.unit_cost_pen,
                   pil2.line_total_pen
                 FROM erp.purchase_invoice_lines pil2
                 LEFT JOIN erp.products pr2 ON pr2.product_id = pil2.product_id
                 WHERE pil2.purchase_id = pi.purchase_id
                 ORDER BY pil2.line_no ASC, pil2.purchase_line_id ASC
               ) t2
             ), '[]'::json) AS lines
           FROM erp.purchase_invoices pi
           LEFT JOIN erp.parties pa ON pa.party_id = pi.supplier_party_id
           LEFT JOIN erp.purchase_invoice_lines pil ON pil.purchase_id = pi.purchase_id
           GROUP BY
             pi.purchase_id, pi.supplier_party_id, pa.trade_name, pa.legal_name,
             pi.supplier_name_raw, pi.supplier_ruc, pi.doc_type, pi.doc_series,
             pi.doc_number, pi.issue_date, pi.due_date, pi.total_pen,
             pi.expense_bucket, pi.expense_category, pi.has_itemized_lines,
             pi.source_origin, pi.raw_notes
           ORDER BY pi.issue_date DESC, pi.purchase_id DESC
           LIMIT 40
         ) t
       ), '[]'::json) AS recent_purchases,
       COALESCE((
         SELECT json_agg(t)
         FROM (
           SELECT
             v.order_line_id,
             v.order_id,
             v.order_code,
             v.order_date::text AS order_date,
             v.warehouse_id,
             v.warehouse_code,
             v.customer_party_id,
             v.customer_name,
             v.product_id,
             v.sku,
             v.product_name,
             COALESCE(pr.unit_of_measure, 'NIU') AS unit_of_measure,
             v.quantity,
             v.pack_factor_applied,
             v.required_base_qty,
             v.current_stock_on_hand,
             v.line_total_pen,
             v.payment_mode::text AS payment_mode,
             v.balance_due_pen,
             v.fulfillment_status::text AS fulfillment_status,
             v.days_pending,
             v.open_flag_id,
             v.flag_severity::text AS flag_severity,
             v.flag_message,
             v.source_origin::text AS source_origin
           FROM analytics.v_pending_on_demand_orders v
           LEFT JOIN erp.products pr ON pr.product_id = v.product_id
           ORDER BY v.order_date ASC, v.order_line_id ASC
         ) t
       ), '[]'::json) AS pending_on_demand,
       COALESCE((${AP_OBLIGATIONS_DETAIL_SUBQUERY}), '[]'::json) AS ap_obligations,
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
           ORDER BY ca.account_id ASC
         ) t
       ), '[]'::json) AS accounts`
  );

  const bundle = bundleRes.rows[0] ?? {
    suppliers: [],
    recent_purchases: [],
    pending_on_demand: [],
    ap_obligations: [],
    accounts: [],
  };

  return {
    suppliers: (bundle.suppliers ?? []).map((r) => ({
      party_id: Number(r.party_id),
      legal_name: String(r.legal_name),
      trade_name:
        r.trade_name !== null && r.trade_name !== undefined
          ? String(r.trade_name)
          : null,
      display_name: String(r.display_name),
      doc_type: String(r.doc_type),
      doc_number:
        r.doc_number !== null && r.doc_number !== undefined
          ? String(r.doc_number)
          : null,
      phone: r.phone !== null && r.phone !== undefined ? String(r.phone) : null,
      address: r.address !== null && r.address !== undefined ? String(r.address) : null,
      notes: r.notes !== null && r.notes !== undefined ? String(r.notes) : null,
      open_ap_balance_pen: Number(r.open_ap_balance_pen ?? 0),
      open_docs_count: Number(r.open_docs_count ?? 0),
    })),
    recentPurchases: (bundle.recent_purchases ?? []).map((r) => ({
      purchase_id: Number(r.purchase_id),
      supplier_party_id:
        r.supplier_party_id !== null && r.supplier_party_id !== undefined
          ? Number(r.supplier_party_id)
          : null,
      supplier_name: String(r.supplier_name),
      supplier_ruc: String(r.supplier_ruc),
      doc_type: String(r.doc_type),
      doc_series: String(r.doc_series),
      doc_number: String(r.doc_number),
      issue_date: String(r.issue_date),
      due_date:
        r.due_date !== null && r.due_date !== undefined ? String(r.due_date) : null,
      total_pen: Number(r.total_pen ?? 0),
      expense_bucket: String(r.expense_bucket),
      expense_category: String(r.expense_category),
      has_itemized_lines: Boolean(r.has_itemized_lines),
      line_count: Number(r.line_count ?? 0),
      source_origin: String(r.source_origin),
      raw_notes:
        r.raw_notes !== null && r.raw_notes !== undefined ? String(r.raw_notes) : null,
      lines: mapPurchaseLineDetails(r.lines),
    })),
    pendingOnDemand: (bundle.pending_on_demand ?? []).map((r) => ({
      ...r,
      unit_of_measure: String(r.unit_of_measure || "NIU"),
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
    apObligations: (bundle.ap_obligations ?? []).map(mapApObligationRow),
    accounts: (bundle.accounts ?? []).map((r) => ({
      account_id: Number(r.account_id),
      code: String(r.code),
      name: String(r.name),
      account_type: String(r.account_type),
      current_balance_pen: Number(r.current_balance_pen ?? 0),
    })),
  };
}

/** Create a generic supplier in erp.parties with duplicate real-document validation. */
export async function createSupplier(
  client: PoolClient,
  actor: SessionUser,
  input: CreateSupplierInput
): Promise<{ supplier: SupplierRow }> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);

  const legalName = String(input.legalName || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  if (!legalName) {
    throw new ValidationError("La razón social o nombre del proveedor es obligatorio");
  }

  const tradeName = input.tradeName?.trim()
    ? input.tradeName.trim().replace(/\s+/g, " ").toUpperCase()
    : null;

  const docTypeRaw = String(input.docType || "NONE")
    .trim()
    .toUpperCase();
  if (!VALID_DOC_TYPES.has(docTypeRaw)) {
    throw new ValidationError(`Tipo de documento inválido: ${docTypeRaw}`);
  }
  const docType = docTypeRaw as NonNullable<CreateSupplierInput["docType"]>;

  const rawDocNumber = input.docNumber ? String(input.docNumber).trim() : "";
  const docNumber = docType === "NONE" || !rawDocNumber ? null : rawDocNumber;
  if (docType !== "NONE" && !docNumber) {
    throw new ValidationError(`Debe ingresar el número de documento para ${docType}`);
  }
  const isGenericDoc = docType === "NONE" || docNumber === null;

  if (!isGenericDoc && docNumber) {
    const dupRes = await client.query(
      `SELECT party_id, legal_name, party_type::text AS party_type
       FROM erp.parties
       WHERE doc_type = $1::erp.doc_id_type
         AND doc_number = $2
         AND is_generic_doc = FALSE
       LIMIT 1`,
      [docType, docNumber]
    );
    if (dupRes.rowCount && dupRes.rowCount > 0) {
      throw new ValidationError(
        `Ya existe una entidad registrada con ${docType} ${docNumber}: ${dupRes.rows[0].legal_name}`
      );
    }
  }

  let canonicalKey: string;
  if (!isGenericDoc && docNumber) {
    const preferredKey = `${docType}:${docNumber}`;
    const keyRes = await client.query(
      `SELECT 1 FROM erp.parties WHERE canonical_key = $1 LIMIT 1`,
      [preferredKey]
    );
    canonicalKey =
      keyRes.rowCount && keyRes.rowCount > 0
        ? `SUPP_${docType}_${docNumber}_${Date.now() % 10000}`
        : preferredKey;
  } else {
    const slug = legalName
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 32);
    canonicalKey = `SUPP_${slug || "PROV"}_${Date.now()}_${Math.floor(
      100 + Math.random() * 900
    )}`;
  }

  try {
    const insertRes = await client.query(
      `INSERT INTO erp.parties (
         canonical_key, party_type, doc_type, doc_number, is_generic_doc,
         legal_name, trade_name, phone, address, notes,
         is_active, source_origin
       ) VALUES (
         $1, 'SUPPLIER', $2::erp.doc_id_type, $3, $4,
         $5, $6, $7, $8, $9,
         TRUE, 'ERP_APP'
       )
       RETURNING party_id, legal_name, trade_name, doc_type::text AS doc_type, doc_number, phone, address, notes`,
      [
        canonicalKey,
        docType,
        docNumber,
        isGenericDoc,
        legalName,
        tradeName,
        input.phone?.trim() || null,
        input.address?.trim() || null,
        input.notes?.trim() || null,
      ]
    );
    const row = insertRes.rows[0];
    return {
      supplier: {
        party_id: Number(row.party_id),
        legal_name: String(row.legal_name),
        trade_name: row.trade_name ?? null,
        display_name: String(row.trade_name || row.legal_name),
        doc_type: String(row.doc_type),
        doc_number: row.doc_number ?? null,
        phone: row.phone ?? null,
        address: row.address ?? null,
        notes: row.notes ?? null,
        open_ap_balance_pen: 0,
        open_docs_count: 0,
      },
    };
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new ValidationError(
        `Ya existe un proveedor con el documento ${docType} ${docNumber ?? ""}`.trim()
      );
    }
    throw err;
  }
}

/** Register a supplier purchase, increment MAIN inventory, update ref cost, record cash/AP, and link ON_DEMAND lines. */
export async function registerSupplierPurchase(
  client: PoolClient,
  actor: SessionUser,
  input: RegisterPurchaseInput
): Promise<{
  purchaseId: number;
  totalPen: number;
  subtotalPen: number;
  igvPen: number;
  origCurrency: "PEN" | "USD";
  exchangeRate: number;
  origTotal: number;
  taxMode: "NONE" | "INCLUDED" | "EXCLUDED";
  paidNowPen: number;
  balanceDuePen: number;
  apId: number | null;
  ledgerId: number | null;
  fulfilledOrderLineIds: number[];
  lines: Array<{ purchaseLineId: number; productId: number }>;
}> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);

  const supplierPartyId = Number(input.supplierPartyId);
  if (!Number.isInteger(supplierPartyId) || supplierPartyId <= 0) {
    throw new ValidationError("Debe seleccionar un proveedor válido");
  }

  const supplierRes = await client.query(
    `SELECT
       party_id,
       legal_name,
       trade_name,
       COALESCE(trade_name, legal_name) AS display_name,
       doc_number
     FROM erp.parties
     WHERE party_id = $1
       AND is_active = TRUE
       AND party_type IN ('SUPPLIER', 'BOTH')
     LIMIT 1`,
    [supplierPartyId]
  );
  if (supplierRes.rowCount === 0) {
    throw new ValidationError("Proveedor no encontrado o inactivo");
  }
  const supplier = supplierRes.rows[0];
  const supplierName = String(supplier.display_name);
  const supplierRuc = supplier.doc_number
    ? String(supplier.doc_number)
    : `SUPP-${supplierPartyId}`;

  const docType = String(input.docType || "FACTURA")
    .trim()
    .toUpperCase();
  const docSeries = String(input.docSeries || "")
    .trim()
    .toUpperCase();
  const docNumber = String(input.docNumber || "")
    .trim()
    .toUpperCase();
  if (!docType || !docSeries || !docNumber) {
    throw new ValidationError(
      "Tipo, serie y número del comprobante de compra son obligatorios"
    );
  }

  const dupInvoiceRes = await client.query(
    `SELECT purchase_id
     FROM erp.purchase_invoices
     WHERE supplier_ruc = $1
       AND doc_type = $2
       AND doc_series = $3
       AND doc_number = $4
     LIMIT 1`,
    [supplierRuc, docType, docSeries, docNumber]
  );
  if (dupInvoiceRes.rowCount && dupInvoiceRes.rowCount > 0) {
    throw new ValidationError(
      `El comprobante ${docType} ${docSeries}-${docNumber} ya existe para este proveedor`
    );
  }

  const currencyRaw = String(input.currency || "PEN")
    .trim()
    .toUpperCase();
  if (currencyRaw !== "PEN" && currencyRaw !== "USD") {
    throw new ValidationError("Moneda inválida (use PEN o USD)");
  }
  const origCurrency = currencyRaw as "PEN" | "USD";

  let exchangeRate = 1.0;
  if (origCurrency === "USD") {
    const tc = Number(input.exchangeRate ?? 0);
    if (!Number.isFinite(tc) || tc <= 0) {
      throw new ValidationError(
        "Para compras en USD debe indicar un tipo de cambio mayor a 0"
      );
    }
    exchangeRate = Number(tc.toFixed(4));
  } else if (input.exchangeRate !== undefined && input.exchangeRate !== null) {
    const tc = Number(input.exchangeRate);
    if (!Number.isFinite(tc) || tc <= 0) {
      throw new ValidationError("Tipo de cambio inválido");
    }
    exchangeRate = Number(tc.toFixed(4));
  }

  const taxModeRaw = String(input.taxMode || "NONE")
    .trim()
    .toUpperCase();
  if (!["NONE", "INCLUDED", "EXCLUDED"].includes(taxModeRaw)) {
    throw new ValidationError(
      "Régimen de IGV inválido (use NONE, INCLUDED o EXCLUDED)"
    );
  }
  const taxMode = taxModeRaw as "NONE" | "INCLUDED" | "EXCLUDED";

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ValidationError("La compra debe incluir al menos un producto");
  }

  interface PreparedPurchaseLine {
    lineNo: number;
    productId: number;
    description: string;
    unitOfMeasure: string;
    quantity: number;
    unitCostPen: number;
    lineTotalPen: number;
  }

  const preparedLines: PreparedPurchaseLine[] = [];
  let rawNetPenSum = 0;
  let origBaseSum = 0;
  let lineTotalPenSum = 0;

  const needsCatalogResolution = input.items.some((item) => {
    const pid = Number(item.productId ?? 0);
    return !Number.isInteger(pid) || pid <= 0;
  });

  let resolutionCandidates: Array<{
    product_id: number;
    sku: string;
    name: string;
    aliases: string[];
  }> = [];

  if (needsCatalogResolution) {
    const candRes = await client.query<{
      product_id: string | number;
      sku: string;
      name: string;
      aliases: string[] | null;
    }>(
      `SELECT
         p.product_id,
         p.sku,
         p.name,
         COALESCE(
           array_agg(DISTINCT pa.alias_raw) FILTER (WHERE pa.alias_raw IS NOT NULL),
           ARRAY[]::text[]
         ) AS aliases
       FROM erp.products p
       LEFT JOIN erp.product_aliases pa ON pa.product_id = p.product_id
       WHERE p.is_active = TRUE
       GROUP BY p.product_id, p.sku, p.name
       ORDER BY p.product_id ASC`
    );
    resolutionCandidates = candRes.rows.map((r) => ({
      product_id: Number(r.product_id),
      sku: String(r.sku),
      name: String(r.name),
      aliases: Array.isArray(r.aliases) ? r.aliases.map(String) : [],
    }));
  }

  const parsedItems = input.items.map((item, idx) => {
    const rawPid = Number(item.productId ?? 0);
    let productId = Number.isInteger(rawPid) && rawPid > 0 ? rawPid : 0;

    if (productId <= 0) {
      const skuText = item.sku?.trim() || "";
      const descText = item.rawDescription?.trim() || "";
      if (!skuText && !descText) {
        throw new ValidationError(`Producto inválido en la línea ${idx + 1}`);
      }
      const match = resolveCatalogProductMatch(resolutionCandidates, {
        sku: skuText || null,
        rawDescription: descText || null,
      });
      if (!match.ok) {
        const refLabel = skuText || descText;
        if (match.reason === "ambiguous") {
          const choices = match.candidates.map((c) => c.sku).join(", ");
          throw new ValidationError(
            `La descripción "${refLabel}" en la línea ${idx + 1} coincide con múltiples productos (${choices}); selecciona el SKU exacto`
          );
        }
        throw new ValidationError(
          `No se encontró un producto activo para "${refLabel}" en la línea ${idx + 1}`
        );
      }
      productId = match.productId;
    }

    const quantity = Number(item.quantity);
    const enteredUnitCost = Number(item.unitCostPen);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new ValidationError(
        `La cantidad debe ser mayor a 0 en la línea ${idx + 1}`
      );
    }
    if (!Number.isFinite(enteredUnitCost) || enteredUnitCost < 0) {
      throw new ValidationError(
        `El costo unitario no puede ser negativo en la línea ${idx + 1}`
      );
    }
    return { productId, quantity, enteredUnitCost };
  });

  const uniqueProductIds = Array.from(
    new Set(parsedItems.map((it) => it.productId))
  ).sort((a, b) => a - b);
  const prodRes = await client.query(
    `SELECT product_id, name, unit_of_measure, ref_cost_pen
     FROM erp.products
     WHERE product_id = ANY($1::bigint[]) AND is_active = TRUE
     ORDER BY product_id ASC
     FOR UPDATE`,
    [uniqueProductIds]
  );
  const productById = new Map<
    number,
    { name: string; unitOfMeasure: string; refCostPen: number }
  >();
  for (const row of prodRes.rows) {
    productById.set(Number(row.product_id), {
      name: String(row.name),
      unitOfMeasure: String(row.unit_of_measure || "NIU"),
      refCostPen: Number(row.ref_cost_pen ?? 0),
    });
  }

  const whRes = await client.query(
    `SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1`
  );
  if (whRes.rowCount === 0) {
    throw new Error("Warehouse MAIN not found");
  }
  const mainWarehouseId = Number(whRes.rows[0].warehouse_id);

  // Read pre-purchase MAIN stock BEFORE inserting PURCHASE_IN movements for weighted-avg cost
  const preStockRes = await client.query(
    `SELECT
       im.product_id,
       COALESCE(SUM(im.quantity_delta), 0)::numeric(14,4) AS stock_on_hand
     FROM erp.inventory_movements im
     WHERE im.warehouse_id = $1
       AND im.product_id = ANY($2::bigint[])
     GROUP BY im.product_id`,
    [mainWarehouseId, uniqueProductIds]
  );
  const preStockByProduct = new Map<number, number>();
  for (const r of preStockRes.rows) {
    preStockByProduct.set(Number(r.product_id), Number(r.stock_on_hand ?? 0));
  }

  for (let idx = 0; idx < parsedItems.length; idx++) {
    const { productId, quantity, enteredUnitCost } = parsedItems[idx];
    const prod = productById.get(productId);
    if (!prod) {
      throw new ValidationError(`Producto ID ${productId} no encontrado o inactivo`);
    }
    const baseOrigLine = quantity * enteredUnitCost;
    origBaseSum += baseOrigLine;
    const basePenLine = baseOrigLine * exchangeRate;
    rawNetPenSum += basePenLine;

    const unitCostPen =
      taxMode === "EXCLUDED"
        ? Number((enteredUnitCost * exchangeRate * 1.18).toFixed(4))
        : Number((enteredUnitCost * exchangeRate).toFixed(4));
    const lineTotalPen = Number((quantity * unitCostPen).toFixed(2));
    lineTotalPenSum = Number((lineTotalPenSum + lineTotalPen).toFixed(2));

    preparedLines.push({
      lineNo: idx + 1,
      productId,
      description: prod.name,
      unitOfMeasure: prod.unitOfMeasure,
      quantity,
      unitCostPen,
      lineTotalPen,
    });
  }

  let subtotalPen = 0;
  let igvPen = 0;
  let totalPen = 0;
  let origTotal = 0;

  if (taxMode === "NONE") {
    subtotalPen = lineTotalPenSum;
    igvPen = 0;
    totalPen = lineTotalPenSum;
    origTotal = Number(origBaseSum.toFixed(2));
  } else if (taxMode === "INCLUDED") {
    totalPen = lineTotalPenSum;
    subtotalPen = Number((totalPen / 1.18).toFixed(2));
    igvPen = Number((totalPen - subtotalPen).toFixed(2));
    origTotal = Number(origBaseSum.toFixed(2));
  } else {
    subtotalPen = Number(rawNetPenSum.toFixed(2));
    igvPen = Number((subtotalPen * 0.18).toFixed(2));
    totalPen = Number((subtotalPen + igvPen).toFixed(2));
    origTotal = Number((origBaseSum * 1.18).toFixed(2));
  }

  const paymentCondition = String(input.paymentCondition || "")
    .trim()
    .toUpperCase() as RegisterPurchaseInput["paymentCondition"];
  if (!["CASH", "CREDIT", "PARTIAL"].includes(paymentCondition)) {
    throw new ValidationError(
      "Condición de pago inválida (use CASH, CREDIT o PARTIAL)"
    );
  }

  let paidNowPen = 0;
  if (paymentCondition === "CASH") {
    paidNowPen = totalPen;
  } else if (paymentCondition === "CREDIT") {
    paidNowPen = 0;
  } else {
    paidNowPen = Number(input.paidNowPen ?? 0);
    if (!Number.isFinite(paidNowPen) || paidNowPen <= 0) {
      throw new ValidationError(
        "Para compra con pago PARCIAL, el pago inicial debe ser mayor a S/ 0.00"
      );
    }
    if (paidNowPen >= totalPen - 0.05) {
      throw new ValidationError(
        "El pago inicial parcial debe ser menor al total de la compra (use Contado si paga todo)"
      );
    }
    paidNowPen = Number(paidNowPen.toFixed(2));
  }

  const issueDate = input.issueDate?.trim()
    ? assertValidDateString(input.issueDate, "Fecha de emisión")
    : getLimaDateString(0);
  const dueDate = input.dueDate?.trim()
    ? assertValidDateString(input.dueDate, "Fecha de vencimiento")
    : null;

  let purchaseId: number;
  try {
    const purchaseInsert = await client.query(
      `INSERT INTO erp.purchase_invoices (
         supplier_party_id, supplier_ruc, supplier_name_raw,
         doc_type, doc_series, doc_number,
         issue_date, due_date, orig_currency, exchange_rate,
         subtotal_pen, igv_pen, total_pen, orig_total,
         expense_bucket, expense_category,
         has_itemized_lines, source_origin, raw_notes
       ) VALUES (
         $1, $2, $3,
         $4, $5, $6,
         $7::date, $8::date, $9, $10,
         $11, $12, $13, $14,
         'MERCHANDISE_PAYMENT', 'MERCADERIA',
         TRUE, 'ERP_APP', $15
       )
       RETURNING purchase_id`,
      [
        supplierPartyId,
        supplierRuc,
        supplierName,
        docType,
        docSeries,
        docNumber,
        issueDate,
        dueDate,
        origCurrency,
        exchangeRate,
        subtotalPen,
        igvPen,
        totalPen,
        origTotal,
        input.notes?.trim() || null,
      ]
    );
    purchaseId = Number(purchaseInsert.rows[0].purchase_id);
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      throw new ValidationError(
        `El comprobante ${docType} ${docSeries}-${docNumber} ya existe para este proveedor`
      );
    }
    throw err;
  }

  const lineNos = preparedLines.map((l) => l.lineNo);
  const prodIds = preparedLines.map((l) => l.productId);
  const descriptions = preparedLines.map((l) => l.description);
  const units = preparedLines.map((l) => l.unitOfMeasure);
  const quantities = preparedLines.map((l) => l.quantity);
  const unitCosts = preparedLines.map((l) => l.unitCostPen);
  const lineTotals = preparedLines.map((l) => l.lineTotalPen);

  const linesInsertRes = await client.query(
    `INSERT INTO erp.purchase_invoice_lines (
       purchase_id, line_no, product_id, raw_description, unit_of_measure,
       quantity, unit_cost_pen, line_total_pen, source_origin
     )
     SELECT
       $1, u.line_no, u.product_id, u.raw_description, u.unit_of_measure,
       u.quantity, u.unit_cost_pen, u.line_total_pen, 'ERP_APP'
     FROM unnest(
       $2::int[], $3::bigint[], $4::text[], $5::text[],
       $6::numeric[], $7::numeric[], $8::numeric[]
     ) AS u(
       line_no, product_id, raw_description, unit_of_measure,
       quantity, unit_cost_pen, line_total_pen
     )
     RETURNING purchase_line_id, product_id`,
    [
      purchaseId,
      lineNos,
      prodIds,
      descriptions,
      units,
      quantities,
      unitCosts,
      lineTotals,
    ]
  );

  const insertedLines = linesInsertRes.rows.map((r) => ({
    purchaseLineId: Number(r.purchase_line_id),
    productId: Number(r.product_id),
  }));

  const purchasedQtyByProduct = new Map<number, number>();
  const purchasedCostByProduct = new Map<number, number>();
  for (const line of preparedLines) {
    purchasedQtyByProduct.set(
      line.productId,
      Number(
        ((purchasedQtyByProduct.get(line.productId) ?? 0) + line.quantity).toFixed(4)
      )
    );
    purchasedCostByProduct.set(line.productId, line.unitCostPen);
  }

  await client.query(
    `INSERT INTO erp.inventory_movements (
       warehouse_id, product_id, movement_date, movement_type,
       quantity_delta, unit_cost_pen, reference_table, reference_id,
       source_origin, notes
     )
     SELECT
       $1, u.product_id, NOW(), 'PURCHASE_IN',
       u.quantity, u.unit_cost_pen, 'erp.purchase_invoices', $2,
       'ERP_APP', $3
     FROM unnest($4::bigint[], $5::numeric[], $6::numeric[])
       AS u(product_id, quantity, unit_cost_pen)`,
    [
      mainWarehouseId,
      String(purchaseId),
      `Ingreso compra ${docSeries}-${docNumber} (${supplierName})`,
      prodIds,
      quantities,
      unitCosts,
    ]
  );

  const boughtStatsByProduct = new Map<
    number,
    { boughtQty: number; boughtValuePen: number }
  >();
  for (const line of preparedLines) {
    if (line.unitCostPen > 0) {
      const prev = boughtStatsByProduct.get(line.productId) ?? {
        boughtQty: 0,
        boughtValuePen: 0,
      };
      boughtStatsByProduct.set(line.productId, {
        boughtQty: prev.boughtQty + line.quantity,
        boughtValuePen: prev.boughtValuePen + line.quantity * line.unitCostPen,
      });
    }
  }
  const latestCostByProduct = new Map<number, number>();
  for (const [productId, stats] of boughtStatsByProduct.entries()) {
    if (stats.boughtQty <= 0) continue;
    const stockBefore = preStockByProduct.get(productId) ?? 0;
    const prevRefCost = productById.get(productId)?.refCostPen ?? 0;
    const weightedCost =
      stockBefore > 0 && prevRefCost > 0
        ? (stockBefore * prevRefCost + stats.boughtValuePen) /
          (stockBefore + stats.boughtQty)
        : stats.boughtValuePen / stats.boughtQty;
    latestCostByProduct.set(productId, Number(weightedCost.toFixed(4)));
  }
  if (latestCostByProduct.size > 0) {
    await client.query(
      `UPDATE erp.products p
       SET ref_cost_pen = u.unit_cost_pen,
           cost_source = 'PURCHASE_APP',
           cost_updated_at = NOW(),
           updated_at = NOW()
       FROM unnest($1::bigint[], $2::numeric[]) AS u(product_id, unit_cost_pen)
       WHERE p.product_id = u.product_id`,
      [Array.from(latestCostByProduct.keys()), Array.from(latestCostByProduct.values())]
    );
  }

  let ledgerId: number | null = null;
  if (paidNowPen > 0) {
    const accountId = await resolvePurchaseAccountId(client, actor, input.accountId);
    const ledgerRes = await client.query(
      `INSERT INTO erp.cash_ledger (
         tx_date, account_id, party_id, direction, amount_pen,
         expense_bucket, expense_category, is_internal_transfer,
         reference_table, reference_id, description, source_origin
       ) VALUES (
         $1::date, $2, $3, 'OUT', $4,
         'MERCHANDISE_PAYMENT', 'MERCADERIA', FALSE,
         'erp.purchase_invoices', $5, $6, 'ERP_APP'
       )
       RETURNING ledger_id`,
      [
        issueDate,
        accountId,
        supplierPartyId,
        paidNowPen,
        String(purchaseId),
        `Pago compra ${docType} ${docSeries}-${docNumber} (${supplierName})`,
      ]
    );
    ledgerId = Number(ledgerRes.rows[0].ledger_id);
  }

  const balance = Number((totalPen - paidNowPen).toFixed(2));
  let apId: number | null = null;
  if (balance > 0.05) {
    const docRef = `${docSeries}-${docNumber}`;
    const apStatus = paidNowPen > 0 ? "PARTIAL" : "OPEN";
    const apRes = await client.query(
      `INSERT INTO erp.ap_obligations (
         purchase_id, supplier_party_id, doc_ref, obligation_type,
         issue_date, due_date, original_amount_pen, paid_amount_pen,
         status, source_origin, notes
       ) VALUES (
         $1, $2, $3, 'SUPPLIER_INVOICE',
         $4::date, $5::date, $6, $7,
         $8, 'ERP_APP', $9
       )
       RETURNING ap_id`,
      [
        purchaseId,
        supplierPartyId,
        docRef,
        issueDate,
        dueDate,
        totalPen,
        paidNowPen,
        apStatus,
        input.notes?.trim() || null,
      ]
    );
    apId = Number(apRes.rows[0].ap_id);
  }

  const fulfilledOrderLineIds: number[] = [];
  if (
    Array.isArray(input.fulfillOrderLineIds) &&
    input.fulfillOrderLineIds.length > 0
  ) {
    const uniqueLineIds = Array.from(
      new Set(input.fulfillOrderLineIds.map((id) => Number(id)))
    );
    for (const orderLineId of uniqueLineIds) {
      if (!Number.isInteger(orderLineId) || orderLineId <= 0) {
        throw new ValidationError(`ID de línea ON_DEMAND inválido: ${orderLineId}`);
      }
    }

    const olRes = await client.query<{
      order_line_id: number;
      order_id: number;
      order_code: string;
      warehouse_id: number;
      stock_deducted: boolean;
      product_id: number;
      sku: string;
      quantity: string | number;
      pack_factor_applied: string | number;
      unit_cost_snapshot_pen: string | number | null;
      fulfillment_status: string;
      operational_status: string;
    }>(
      `SELECT
         sol.order_line_id,
         sol.order_id,
         so.order_code,
         so.warehouse_id,
         so.stock_deducted,
         sol.product_id,
         p.sku,
         sol.quantity,
         sol.pack_factor_applied,
         sol.unit_cost_snapshot_pen,
         sol.fulfillment_status::text AS fulfillment_status,
         so.operational_status::text AS operational_status
       FROM erp.sales_order_lines sol
       JOIN erp.sales_orders so ON so.order_id = sol.order_id
       JOIN erp.products p ON p.product_id = sol.product_id
       WHERE sol.order_line_id = ANY($1::bigint[])
       ORDER BY sol.order_line_id ASC
       FOR UPDATE OF sol`,
      [uniqueLineIds]
    );

    const olById = new Map<number, (typeof olRes.rows)[number]>();
    for (const row of olRes.rows) {
      olById.set(Number(row.order_line_id), row);
    }

    const requiredQtyByProduct = new Map<number, number>();
    const pendingUpdates: Array<{
      orderLineId: number;
      purchaseLineId: number;
      orderId: number;
      orderCode: string;
      warehouseId: number;
      productId: number;
      requiredBaseQty: number;
      unitCostPen: number;
      stockDeductedOnOrder: boolean;
    }> = [];
    const partialUpdates: Array<{ orderLineId: number; purchaseLineId: number }> = [];

    for (const orderLineId of uniqueLineIds) {
      const ol = olById.get(orderLineId);
      if (!ol) {
        throw new ValidationError(`Línea de pedido #${orderLineId} no encontrada`);
      }
      if (ol.operational_status === "CANCELLED") {
        throw new ValidationError(`El pedido de la línea #${orderLineId} está anulado`);
      }
      if (ol.operational_status === "PENDING_PARTNER_APPROVAL") {
        throw new ValidationError(
          `El pedido de la línea #${orderLineId} está pendiente de aprobación de Socio`
        );
      }
      if (
        ol.fulfillment_status !== "PENDING_SUPPLIER_PURCHASE" &&
        ol.fulfillment_status !== "PARTIALLY_FULFILLED"
      ) {
        throw new ValidationError(
          `La línea #${orderLineId} ya está en estado ${ol.fulfillment_status}`
        );
      }
      const matchingLine = insertedLines.find(
        (pl) => pl.productId === Number(ol.product_id)
      );
      if (!matchingLine) {
        throw new ValidationError(
          `La línea ON_DEMAND #${orderLineId} no corresponde a ningún producto de esta compra`
        );
      }

      const requiredBaseQty = Number(
        (Number(ol.quantity) * Number(ol.pack_factor_applied || 1)).toFixed(4)
      );
      const pid = Number(ol.product_id);
      const accumulatedReq = Number(
        ((requiredQtyByProduct.get(pid) ?? 0) + requiredBaseQty).toFixed(4)
      );
      const purchasedQty = purchasedQtyByProduct.get(pid) ?? 0;
      if (accumulatedReq > purchasedQty + 0.0001) {
        throw new ValidationError(
          `La cantidad comprada de ${ol.sku} (${purchasedQty}) es insuficiente para cubrir las líneas ON_DEMAND seleccionadas (${accumulatedReq})`
        );
      }
      requiredQtyByProduct.set(pid, accumulatedReq);

      const effectiveUnitCost =
        purchasedCostByProduct.get(pid) ??
        (ol.unit_cost_snapshot_pen !== null ? Number(ol.unit_cost_snapshot_pen) : 0);

      if (ol.fulfillment_status === "PENDING_SUPPLIER_PURCHASE") {
        pendingUpdates.push({
          orderLineId,
          purchaseLineId: matchingLine.purchaseLineId,
          orderId: Number(ol.order_id),
          orderCode: String(ol.order_code),
          warehouseId: Number(ol.warehouse_id),
          productId: pid,
          requiredBaseQty,
          unitCostPen: effectiveUnitCost,
          stockDeductedOnOrder: Boolean(ol.stock_deducted),
        });
      } else {
        partialUpdates.push({
          orderLineId,
          purchaseLineId: matchingLine.purchaseLineId,
        });
      }
      fulfilledOrderLineIds.push(orderLineId);
    }

    if (pendingUpdates.length > 0) {
      await client.query(
        `UPDATE erp.sales_order_lines sol
         SET fulfilling_purchase_line_id = u.purchase_line_id
         FROM unnest($1::bigint[], $2::bigint[]) AS u(order_line_id, purchase_line_id)
         WHERE sol.order_line_id = u.order_line_id`,
        [
          pendingUpdates.map((u) => u.orderLineId),
          pendingUpdates.map((u) => u.purchaseLineId),
        ]
      );

      // Deduct the pending SALE_OUT that was skipped at order creation so ON_DEMAND
      // stock_on_hand reflects net leftover physical inventory instead of leaking +qty.
      const saleOutRows = pendingUpdates.filter((u) => u.stockDeductedOnOrder);
      if (saleOutRows.length > 0) {
        await client.query(
          `INSERT INTO erp.inventory_movements (
             warehouse_id, product_id, movement_date, movement_type,
             quantity_delta, unit_cost_pen, reference_table, reference_id,
             source_origin, notes
           )
           SELECT
             u.warehouse_id,
             u.product_id,
             NOW(),
             'SALE_OUT',
             -u.required_base_qty,
             NULLIF(u.unit_cost_pen, 0),
             'erp.sales_orders',
             u.order_id::text,
             'ERP_APP',
             u.note
           FROM unnest(
             $1::bigint[], $2::bigint[], $3::numeric[],
             $4::numeric[], $5::bigint[], $6::text[]
           ) AS u(warehouse_id, product_id, required_base_qty, unit_cost_pen, order_id, note)`,
          [
            saleOutRows.map((u) => u.warehouseId),
            saleOutRows.map((u) => u.productId),
            saleOutRows.map((u) => u.requiredBaseQty),
            saleOutRows.map((u) => u.unitCostPen),
            saleOutRows.map((u) => u.orderId),
            saleOutRows.map(
              (u) =>
                `Salida ON_DEMAND pendiente cumplida por compra ${docSeries}-${docNumber} (${u.orderCode} línea #${u.orderLineId})`
            ),
          ]
        );
      }
    }
    if (partialUpdates.length > 0) {
      await client.query(
        `UPDATE erp.sales_order_lines sol
         SET fulfilling_purchase_line_id = u.purchase_line_id,
             fulfillment_status = 'FULFILLED'
         FROM unnest($1::bigint[], $2::bigint[]) AS u(order_line_id, purchase_line_id)
         WHERE sol.order_line_id = u.order_line_id`,
        [
          partialUpdates.map((u) => u.orderLineId),
          partialUpdates.map((u) => u.purchaseLineId),
        ]
      );
    }
  }

  // Resolve any stock deficit flags for purchased SKUs that are now >= 0
  if (uniqueProductIds.length > 0) {
    await client.query(
      `UPDATE erp.audit_flags af
       SET status = 'RESOLVED',
           resolved_at = NOW(),
           resolved_by = $3
       FROM erp.v_current_stock vcs
       WHERE vcs.warehouse_id = $1
         AND vcs.product_id = ANY($2::bigint[])
         AND vcs.stock_on_hand >= 0
         AND af.flag_code IN ('ON_DEMAND_STOCK_DEFICIT', 'UNPURCHASED_STOCK_DEFICIT')
         AND af.entity_table = 'erp.products'
         AND af.entity_id = (vcs.product_id::text || '@' || $1::text)
         AND af.status = 'OPEN'`,
      [mainWarehouseId, uniqueProductIds, actor.username]
    );
  }

  return {
    purchaseId,
    totalPen,
    subtotalPen,
    igvPen,
    origCurrency,
    exchangeRate,
    origTotal,
    taxMode,
    paidNowPen,
    balanceDuePen: balance > 0.05 ? balance : 0,
    apId,
    ledgerId,
    fulfilledOrderLineIds,
    lines: insertedLines,
  };
}

/** Register a full or partial payment against an OPEN/PARTIAL supplier AP obligation. */
export async function payApObligation(
  client: PoolClient,
  actor: SessionUser,
  input: PayApObligationInput
): Promise<{
  apId: number;
  newPaidPen: number;
  newBalanceDuePen: number;
  status: "OPEN" | "PARTIAL" | "PAID";
  ledgerId: number;
}> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);

  const apId = Number(input.apId);
  const amountPen = Number(input.amountPen);
  if (!Number.isInteger(apId) || apId <= 0) {
    throw new ValidationError("ID de obligación por pagar inválido");
  }
  if (!Number.isFinite(amountPen) || amountPen <= 0) {
    throw new ValidationError("El monto del pago debe ser mayor a S/ 0.00");
  }

  const apRes = await client.query(
    `SELECT
       ap.ap_id,
       ap.supplier_party_id,
       ap.doc_ref,
       ap.original_amount_pen,
       ap.paid_amount_pen,
       ap.balance_due_pen,
       ap.status::text AS status,
       COALESCE(pa.trade_name, pa.legal_name, 'Proveedor sin especificar') AS supplier_name
     FROM erp.ap_obligations ap
     LEFT JOIN erp.parties pa ON pa.party_id = ap.supplier_party_id
     WHERE ap.ap_id = $1
     FOR UPDATE OF ap`,
    [apId]
  );
  if (apRes.rowCount === 0) {
    throw new ValidationError("Obligación por pagar no encontrada");
  }

  const ap = apRes.rows[0];
  if (ap.status !== "OPEN" && ap.status !== "PARTIAL") {
    throw new ValidationError(
      `La obligación ${ap.doc_ref} está en estado ${ap.status} y no admite más pagos`
    );
  }

  const currentBalance = Number(ap.balance_due_pen);
  if (amountPen > currentBalance + 0.05) {
    throw new ValidationError(
      `El pago (S/ ${amountPen.toFixed(2)}) supera el saldo pendiente (S/ ${currentBalance.toFixed(2)})`
    );
  }

  const accountId = await resolvePurchaseAccountId(client, actor, input.accountId);
  const txDate = getLimaDateString(0);
  const cleanNote = input.notes?.trim();
  const description = cleanNote
    ? `Pago CxP ${ap.doc_ref} (${ap.supplier_name}) - ${cleanNote}`
    : `Pago CxP ${ap.doc_ref} (${ap.supplier_name})`;

  const ledgerRes = await client.query(
    `INSERT INTO erp.cash_ledger (
       tx_date, account_id, party_id, direction, amount_pen,
       expense_bucket, expense_category, is_internal_transfer,
       reference_table, reference_id, description, source_origin
     ) VALUES (
       $1::date, $2, $3, 'OUT', $4,
       'MERCHANDISE_PAYMENT', 'PAGO_CXP', FALSE,
       'erp.ap_obligations', $5, $6, 'ERP_APP'
     )
     RETURNING ledger_id`,
    [
      txDate,
      accountId,
      ap.supplier_party_id !== null ? Number(ap.supplier_party_id) : null,
      Number(amountPen.toFixed(2)),
      String(apId),
      description,
    ]
  );
  const ledgerId = Number(ledgerRes.rows[0].ledger_id);

  const originalAmount = Number(ap.original_amount_pen);
  const updatedPaid = Number((Number(ap.paid_amount_pen) + amountPen).toFixed(2));
  const remaining = Math.max(0, Number((originalAmount - updatedPaid).toFixed(2)));
  const newStatus = remaining <= 0.05 ? "PAID" : "PARTIAL";

  const updateRes = await client.query(
    `UPDATE erp.ap_obligations
     SET paid_amount_pen = $1,
         status = $2
     WHERE ap_id = $3
     RETURNING paid_amount_pen, balance_due_pen, status::text AS status`,
    [updatedPaid, newStatus, apId]
  );
  const updated = updateRes.rows[0];

  return {
    apId,
    newPaidPen: Number(updated.paid_amount_pen),
    newBalanceDuePen: Number(updated.balance_due_pen),
    status: updated.status as "OPEN" | "PARTIAL" | "PAID",
    ledgerId,
  };
}
