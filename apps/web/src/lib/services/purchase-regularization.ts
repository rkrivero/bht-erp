import type { PoolClient } from "pg";
import { assertRole } from "../rbac";
import { ValidationError, type SessionUser } from "../types";
import { buildXlsxWorkbook, type XlsxColumnDef } from "../xlsx-writer";

export type RegularizationMode = "sold" | "projected";

export interface UnpurchasedRegularizationRow {
  product_id: number;
  sku: string;
  product_name: string;
  category: string;
  unit_of_measure: string;
  fulfillment_mode: string;
  opening_stock_qty: number;
  purchased_qty: number;
  formal_backed_qty: number;
  sold_qty: number;
  orders_count: number;
  first_sale_date: string | null;
  last_sale_date: string | null;
  total_sales_revenue_pen: number;
  open_quoted_qty: number;
  open_quotes_count: number;
  qty_to_regularize: number;
  projected_qty_to_regularize: number;
  additional_quote_deficit_qty: number;
  current_stock_on_hand: number;
  ref_cost_pen: number | null;
  list_sale_price_pen: number | null;
  estimated_purchase_pen: number | null;
  projected_purchase_pen: number | null;
  last_supplier_party_id: number | null;
  last_supplier_name: string;
  has_sold_deficit: boolean;
}

export interface UnpurchasedRegularizationSummary {
  totalSkus: number;
  soldDeficitSkus: number;
  totalUnitsToRegularize: number;
  totalEstimatedPurchasePen: number;
  missingCostSkus: number;
  projectedDeficitSkus: number;
  totalProjectedUnits: number;
  totalProjectedPurchasePen: number;
  openQuotesTotalQty: number;
}

export interface UnpurchasedRegularizationResult {
  mode: RegularizationMode;
  summary: UnpurchasedRegularizationSummary;
  suppliers: string[];
  items: UnpurchasedRegularizationRow[];
}

export function parseRegularizationMode(
  raw: string | null | undefined
): RegularizationMode {
  const norm = String(raw || "sold")
    .trim()
    .toLowerCase();
  if (norm === "sold" || norm === "projected") {
    return norm;
  }
  throw new ValidationError("Modo inválido (use 'sold' o 'projected')");
}

export async function listUnpurchasedSalesRegularization(
  client: PoolClient,
  actor: SessionUser,
  options: {
    mode?: RegularizationMode;
    supplier?: string | null;
    search?: string | null;
  } = {}
): Promise<UnpurchasedRegularizationResult> {
  assertRole(actor, ["PARTNER_ADMIN", "PARTNER_MANAGER"]);

  const mode = options.mode ?? "sold";
  const supplierFilter = options.supplier?.trim() || null;
  const searchFilter = options.search?.trim() || null;

  const res = await client.query<{
    product_id: string | number;
    sku: string;
    product_name: string;
    category: string;
    unit_of_measure: string;
    fulfillment_mode: string;
    opening_stock_qty: string | number;
    purchased_qty: string | number;
    formal_backed_qty: string | number;
    sold_qty: string | number;
    orders_count: number;
    first_sale_date: string | null;
    last_sale_date: string | null;
    total_sales_revenue_pen: string | number;
    open_quoted_qty: string | number;
    open_quotes_count: number;
    qty_to_regularize: string | number;
    projected_qty_to_regularize: string | number;
    additional_quote_deficit_qty: string | number;
    current_stock_on_hand: string | number;
    ref_cost_pen: string | number | null;
    list_sale_price_pen: string | number | null;
    estimated_purchase_pen: string | number | null;
    projected_purchase_pen: string | number | null;
    last_supplier_party_id: string | number | null;
    last_supplier_name: string;
    has_sold_deficit: boolean;
  }>(
    `SELECT
       product_id,
       sku,
       product_name,
       category,
       unit_of_measure,
       fulfillment_mode,
       opening_stock_qty,
       purchased_qty,
       formal_backed_qty,
       sold_qty,
       orders_count,
       first_sale_date::text AS first_sale_date,
       last_sale_date::text AS last_sale_date,
       total_sales_revenue_pen,
       open_quoted_qty,
       open_quotes_count,
       qty_to_regularize,
       projected_qty_to_regularize,
       additional_quote_deficit_qty,
       current_stock_on_hand,
       ref_cost_pen,
       list_sale_price_pen,
       estimated_purchase_pen,
       projected_purchase_pen,
       last_supplier_party_id,
       last_supplier_name,
       has_sold_deficit
     FROM analytics.v_unpurchased_sales_regularization
     ORDER BY
       qty_to_regularize DESC,
       estimated_purchase_pen DESC NULLS LAST,
       projected_qty_to_regularize DESC,
       sku ASC`
  );

  const allRows: UnpurchasedRegularizationRow[] = res.rows.map((r) => ({
    product_id: Number(r.product_id),
    sku: String(r.sku),
    product_name: String(r.product_name),
    category: String(r.category || "GENERAL"),
    unit_of_measure: String(r.unit_of_measure || "NIU"),
    fulfillment_mode: String(r.fulfillment_mode || "STOCKED"),
    opening_stock_qty: Number(r.opening_stock_qty ?? 0),
    purchased_qty: Number(r.purchased_qty ?? 0),
    formal_backed_qty: Number(r.formal_backed_qty ?? 0),
    sold_qty: Number(r.sold_qty ?? 0),
    orders_count: Number(r.orders_count ?? 0),
    first_sale_date: r.first_sale_date ? String(r.first_sale_date) : null,
    last_sale_date: r.last_sale_date ? String(r.last_sale_date) : null,
    total_sales_revenue_pen: Number(r.total_sales_revenue_pen ?? 0),
    open_quoted_qty: Number(r.open_quoted_qty ?? 0),
    open_quotes_count: Number(r.open_quotes_count ?? 0),
    qty_to_regularize: Number(r.qty_to_regularize ?? 0),
    projected_qty_to_regularize: Number(r.projected_qty_to_regularize ?? 0),
    additional_quote_deficit_qty: Number(r.additional_quote_deficit_qty ?? 0),
    current_stock_on_hand: Number(r.current_stock_on_hand ?? 0),
    ref_cost_pen:
      r.ref_cost_pen !== null && r.ref_cost_pen !== undefined
        ? Number(r.ref_cost_pen)
        : null,
    list_sale_price_pen:
      r.list_sale_price_pen !== null && r.list_sale_price_pen !== undefined
        ? Number(r.list_sale_price_pen)
        : null,
    estimated_purchase_pen:
      r.estimated_purchase_pen !== null && r.estimated_purchase_pen !== undefined
        ? Number(r.estimated_purchase_pen)
        : null,
    projected_purchase_pen:
      r.projected_purchase_pen !== null && r.projected_purchase_pen !== undefined
        ? Number(r.projected_purchase_pen)
        : null,
    last_supplier_party_id:
      r.last_supplier_party_id !== null && r.last_supplier_party_id !== undefined
        ? Number(r.last_supplier_party_id)
        : null,
    last_supplier_name: String(r.last_supplier_name || "Por asignar"),
    has_sold_deficit: Boolean(r.has_sold_deficit),
  }));

  const suppliers = Array.from(
    new Set(
      allRows
        .filter((item) => (mode === "sold" ? item.has_sold_deficit : true))
        .map((item) => item.last_supplier_name)
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "es"));

  const q = searchFilter ? searchFilter.toLocaleLowerCase("es") : "";
  const filteredAllRows = allRows.filter((item) => {
    if (supplierFilter && item.last_supplier_name !== supplierFilter) {
      return false;
    }
    if (!q) return true;
    return (
      item.sku.toLocaleLowerCase("es").includes(q) ||
      item.product_name.toLocaleLowerCase("es").includes(q) ||
      item.category.toLocaleLowerCase("es").includes(q) ||
      item.last_supplier_name.toLocaleLowerCase("es").includes(q)
    );
  });

  const items =
    mode === "sold"
      ? filteredAllRows.filter((item) => item.has_sold_deficit)
      : filteredAllRows;

  const soldRows = filteredAllRows.filter((item) => item.has_sold_deficit);
  const projectedRows = filteredAllRows.filter(
    (item) => item.projected_qty_to_regularize > 0
  );
  const summary: UnpurchasedRegularizationSummary = {
    totalSkus: items.length,
    soldDeficitSkus: soldRows.length,
    totalUnitsToRegularize: Number(
      soldRows.reduce((s, r) => s + r.qty_to_regularize, 0).toFixed(4)
    ),
    totalEstimatedPurchasePen: Number(
      soldRows.reduce((s, r) => s + (r.estimated_purchase_pen ?? 0), 0).toFixed(2)
    ),
    missingCostSkus: items.filter((r) => r.ref_cost_pen === null).length,
    projectedDeficitSkus: projectedRows.length,
    totalProjectedUnits: Number(
      projectedRows.reduce((s, r) => s + r.projected_qty_to_regularize, 0).toFixed(4)
    ),
    totalProjectedPurchasePen: Number(
      projectedRows.reduce((s, r) => s + (r.projected_purchase_pen ?? 0), 0).toFixed(2)
    ),
    openQuotesTotalQty: Number(
      projectedRows.reduce((s, r) => s + r.open_quoted_qty, 0).toFixed(4)
    ),
  };

  return { mode, summary, suppliers, items };
}

export function buildRegularizationWorkbookBuffer(
  result: UnpurchasedRegularizationResult,
  options: {
    supplierFilter?: string | null;
    searchFilter?: string | null;
    generatedDateLima: string;
  }
): Buffer {
  const isProjected = result.mode === "projected";
  const columns: XlsxColumnDef[] = [
    { key: "sku", header: "Código (SKU)", width: 22, kind: "string" },
    {
      key: "product_name",
      header: "Descripción del Producto",
      width: 42,
      kind: "string",
    },
    { key: "category", header: "Categoría", width: 18, kind: "string" },
    { key: "unit_of_measure", header: "Unidad", width: 10, kind: "string" },
    {
      key: "formal_backed_qty",
      header: "Compras + Stock Inicial",
      width: 20,
      kind: "number",
    },
    { key: "sold_qty", header: "Total Vendido", width: 16, kind: "number" },
    {
      key: "qty_to_regularize",
      header: "Por Regularizar (Vendido)",
      width: 22,
      kind: "number",
    },
    ...(isProjected
      ? ([
          {
            key: "open_quoted_qty",
            header: "Cotizado Abierto",
            width: 18,
            kind: "number",
          },
          {
            key: "projected_qty_to_regularize",
            header: "Total Proyectado",
            width: 18,
            kind: "number",
          },
        ] satisfies XlsxColumnDef[])
      : []),
    {
      key: "ref_cost_pen",
      header: "Costo Unit. Ref. (S/)",
      width: 20,
      kind: "currency",
    },
    {
      key: isProjected ? "projected_purchase_pen" : "estimated_purchase_pen",
      header: isProjected ? "Total Est. Proyectado (S/)" : "Subtotal Est. Factura (S/)",
      width: 24,
      kind: "currency",
    },
    {
      key: "last_supplier_name",
      header: "Proveedor Referencial",
      width: 34,
      kind: "string",
    },
    { key: "orders_count", header: "Pedidos", width: 11, kind: "integer" },
    { key: "first_sale_date", header: "Primera Venta", width: 14, kind: "string" },
    { key: "last_sale_date", header: "Última Venta", width: 14, kind: "string" },
  ];

  const rows = result.items.map((item) => ({
    sku: item.sku,
    product_name: item.product_name,
    category: item.category,
    unit_of_measure: item.unit_of_measure,
    formal_backed_qty: item.formal_backed_qty,
    sold_qty: item.sold_qty,
    qty_to_regularize: item.qty_to_regularize,
    open_quoted_qty: item.open_quoted_qty,
    projected_qty_to_regularize: item.projected_qty_to_regularize,
    ref_cost_pen: item.ref_cost_pen,
    estimated_purchase_pen: item.estimated_purchase_pen,
    projected_purchase_pen: item.projected_purchase_pen,
    last_supplier_name: item.last_supplier_name,
    orders_count: item.orders_count,
    first_sale_date: item.first_sale_date ?? "",
    last_sale_date: item.last_sale_date ?? "",
  }));

  const totalsRow: Record<string, unknown> = {
    sku: "TOTAL",
    product_name: `${result.items.length} producto(s)`,
    category: "",
    unit_of_measure: "",
    formal_backed_qty: Number(
      result.items.reduce((s, r) => s + r.formal_backed_qty, 0).toFixed(4)
    ),
    sold_qty: Number(result.items.reduce((s, r) => s + r.sold_qty, 0).toFixed(4)),
    qty_to_regularize: result.summary.totalUnitsToRegularize,
    open_quoted_qty: result.summary.openQuotesTotalQty,
    projected_qty_to_regularize: result.summary.totalProjectedUnits,
    ref_cost_pen: "",
    estimated_purchase_pen: result.summary.totalEstimatedPurchasePen,
    projected_purchase_pen: result.summary.totalProjectedPurchasePen,
    last_supplier_name: options.supplierFilter || "Todos los proveedores",
    orders_count: result.items.reduce((s, r) => s + r.orders_count, 0),
    first_sale_date: "",
    last_sale_date: "",
  };

  const summaryRows = [
    {
      concepto: "Empresa",
      valor: "BLUE HORIZON TRADE S.A.C.",
    },
    {
      concepto: "Reporte",
      valor: isProjected
        ? "Productos por Regularizar Compra (Vendido + Cotizaciones Abiertas)"
        : "Productos Vendidos sin Compra Formal (Para Facturación de Proveedor)",
    },
    {
      concepto: "Fecha de generación (Lima)",
      valor: options.generatedDateLima,
    },
    {
      concepto: "Filtro de proveedor",
      valor: options.supplierFilter || "Todos",
    },
    {
      concepto: "Filtro de búsqueda",
      valor: options.searchFilter || "Sin filtro",
    },
    {
      concepto: "Productos con déficit vendido",
      valor: result.summary.soldDeficitSkus,
    },
    {
      concepto: "Unidades vendidas por regularizar",
      valor: result.summary.totalUnitsToRegularize,
    },
    {
      concepto: "Subtotal estimado de compra (S/)",
      valor: result.summary.totalEstimatedPurchasePen,
    },
    ...(isProjected
      ? [
          {
            concepto: "Unidades proyectadas (incl. cotizaciones)",
            valor: result.summary.totalProjectedUnits,
          },
          {
            concepto: "Monto proyectado estimado (S/)",
            valor: result.summary.totalProjectedPurchasePen,
          },
        ]
      : []),
    {
      concepto: "Productos sin costo de referencia",
      valor: result.summary.missingCostSkus,
    },
  ];

  return buildXlsxWorkbook([
    {
      name: "Por Regularizar",
      columns,
      rows,
      totalsRow,
      freezeHeader: true,
      autoFilter: true,
    },
    {
      name: "Resumen",
      columns: [
        { key: "concepto", header: "Concepto", width: 38, kind: "string" },
        { key: "valor", header: "Detalle / Total", width: 46, kind: "string" },
      ],
      rows: summaryRows.map((r) => ({
        concepto: r.concepto,
        valor:
          typeof r.valor === "number"
            ? r.concepto.includes("(S/)")
              ? `S/ ${r.valor.toFixed(2)}`
              : String(r.valor)
            : r.valor,
      })),
      freezeHeader: true,
      autoFilter: false,
    },
  ]);
}
