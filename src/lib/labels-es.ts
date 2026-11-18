/** Shared Spanish UI label formatters so raw DB enums and English strings never reach the interface. */

const ROLE_LABELS_ES: Record<string, string> = {
  PARTNER_ADMIN: "Ventas y Control",
  PARTNER_MANAGER: "Gerencia",
  EXTERNAL_SELLER: "Vendedor",
  WAREHOUSE_DELIVERY: "Almacén y Reparto",
};

const OPERATIONAL_STATUS_ES: Record<string, string> = {
  PENDING_PARTNER_APPROVAL: "Por Aprobar",
  REGISTERED: "Alistando",
  PICKING: "Alistando",
  READY: "Pedido listo",
  IN_ROUTE: "En Ruta",
  APPROVED_FOR_WAREHOUSE: "Aprobado para Almacén",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
};

const FULFILLMENT_MODE_ES: Record<string, string> = {
  STOCKED: "Con Inventario",
  ON_DEMAND: "Bajo Pedido",
};

const PAYMENT_MODE_ES: Record<string, string> = {
  CASH: "Efectivo",
  CREDIT: "A Crédito",
  YAPE_PLIN: "Yape / Plin",
  TRANSFER: "Transferencia",
};

const PROMISE_STATUS_ES: Record<string, string> = {
  DUE_TODAY_OR_TOMORROW: "Cobrar hoy o mañana",
  PROMISE_BROKEN: "Promesa vencida",
  ON_SCHEDULE: "En plazo",
  NO_PROMISE_DATE: "Sin fecha pactada",
  UNKNOWN: "Sin fecha pactada",
};

const AP_STATUS_ES: Record<string, string> = {
  OPEN: "Pendiente",
  PARTIAL: "Pago Parcial",
  PAID: "Pagada",
  CANCELLED: "Anulada",
  UNPAID: "Pendientes",
};

const DOC_TYPE_ES: Record<string, string> = {
  FACTURA: "Factura",
  BOLETA: "Boleta",
  NOTA_VENTA: "Nota de Venta",
  RECIBO: "Recibo",
  RUC: "RUC",
  DNI: "DNI",
  CE: "Carné de Extranjería",
  PASSPORT: "Pasaporte",
  NONE: "Sin Documento",
};

const ACCOUNT_TYPE_ES: Record<string, string> = {
  BANK: "Cuenta Bancaria",
  CASH_BOX: "Caja en Efectivo",
  PARTNER_CUSTODY: "Custodia de Socio",
  WALLET: "Billetera Digital",
};

const EXPENSE_CATEGORY_ES: Record<string, string> = {
  ACCOUNTING_OR_LEGAL: "Contabilidad y Legal",
  ACCOUNTING_SERVICE: "Servicio Contable",
  ALMUERZO_VIATICOS: "Almuerzo y Viáticos",
  AP_SETTLEMENT: "Pago a Proveedor",
  BANK_DEPOSIT_TRANSFER: "Depósito / Traslado Bancario",
  CAPEX_ASSET: "Activo / Equipamiento",
  COMBUSTIBLE: "Combustible",
  COURIER_ENVIO: "Courier / Envío",
  EMPAQUE_INSUMOS: "Empaques e Insumos",
  ESTACIONAMIENTO: "Estacionamiento / Cochera",
  ESTIBADOR_APOYO: "Estibador / Descarga",
  FINANCIAL_FEE: "Comisión Bancaria",
  FLETE_MERCADERIA: "Flete de Mercadería",
  FOOD_LODGING: "Hospedaje y Alimentación",
  GASTO_RUTA: "Gasto General de Ruta",
  HOSPEDAJE: "Hospedaje",
  INTERNAL_TRANSFER: "Traslado Interno",
  LEGAL_NOTARIA: "Notaría / Trámite Legal",
  MANTENIMIENTO_RUTA: "Mantenimiento de Ruta",
  MERCADERIA: "Compra de Mercadería",
  MERCHANDISE: "Compra de Mercadería",
  MERCHANDISE_PAYMENT: "Pago a Proveedor",
  OTRO_NO_OPERATIVO: "Otro Egreso No Operativo",
  OTROS_RUTA: "Otros Gastos de Ruta",
  OWNER_DRAW: "Retiro de Socio",
  PAGO_CXP: "Pago a Proveedor (CxP)",
  PAYROLL_ADVANCE: "Adelanto / Personal",
  PEAJE: "Peaje",
  PRIOR_DEBT: "Pago Deuda Anterior",
  RETIRO: "Retiro de Socio",
  SALE_CASH_COLLECTION: "Cobro de Venta",
  SEGURO_SOAT_RUTA: "SOAT / Seguro Ruta",
  SUPPLIER_PAYMENT: "Pago a Proveedor",
  UTILES_ADMIN: "Útiles Administrativos",
  VIATICOS: "Viáticos y Alimentación",
};

const MARGIN_STATUS_ES: Record<string, string> = {
  SIN_COSTO: "Sin Costo",
  "BAJO_20%": "Margen Bajo (< 20%)",
  "OK_20%+": "Saludable (≥ 20%)",
  SIN_VENTAS: "Sin Ventas",
};

const QUALITY_GAP_ES: Record<string, { label: string; description: string }> = {
  ASSUMED_CASH_STATUS: {
    label: "Ventas históricas sin estado explícito",
    description:
      "Filas históricas de Excel 2026 con condición en blanco cargadas al contado por defecto.",
  },
  NEGATIVE_HISTORICAL_STOCK_SKUS: {
    label: "Productos con saldo negativo histórico",
    description:
      "Productos activos con inventario negativo por falta de conteo inicial al 26/06/2026 (regularizables en Día 1).",
  },
  "OPEN_AUDIT_FLAG:MISSING_BANK_STATEMENT_LEDGER": {
    label: "Extractos bancarios históricos pendientes",
    description:
      "Faltan extractos históricos BCP e Interbank en archivos fuente; pagos a proveedores fuera de caja de ruta pendientes de conciliar.",
  },
  "OPEN_AUDIT_FLAG:PURCHASE_CURRENCY_MISMATCH_FIXED": {
    label: "Corrección de moneda en compra de vehículo",
    description:
      "Ajustado al equivalente exacto en soles (S/ 80,542.86 / $ 23,780 al tipo de cambio 3.387).",
  },
  "OPEN_AUDIT_FLAG:PURCHASE_LINE_QTY_PRICE_SWAP": {
    label: "Corrección de cantidad y costo invertidos",
    description:
      "Corregido el intercambio de cantidad y precio unitario en factura FQQ1-139 (Carpa 8x10: 3 u. a S/ 270.00 = S/ 810.00).",
  },
  "OPEN_AUDIT_FLAG:EXEL_QTY_PRICE_SWAPPED_CORRECTED": {
    label: "Corrección de columnas invertidas en ruta",
    description:
      "Corregidas las columnas invertidas de cantidad y precio del 17/07/2026 (Alfombra Verde: 36 u. a S/ 70.00).",
  },
  PENDING_ON_DEMAND_LINES: {
    label: "Líneas bajo pedido por asociar a compra",
    description:
      "Líneas vendidas bajo pedido que aún esperan enlace con una compra a proveedor.",
  },
  SALES_MISSING_SKU_COST: {
    label: "Productos vendidos sin costo de referencia",
    description:
      "Productos con ventas registradas que todavía no tienen costo de referencia en catálogo.",
  },
  UNMATCHED_OR_REVIEW_PARTY_ALIASES: {
    label: "Nombres de clientes o proveedores por revisar",
    description:
      "Alias en el catálogo de normalización marcados para validación manual.",
  },
  UNMATCHED_OR_REVIEW_PRODUCT_ALIASES: {
    label: "Alias de productos por revisar",
    description:
      "Descripciones antiguas de productos marcadas para validación manual en el catálogo.",
  },
};

function humanizeCode(raw: string): string {
  return raw
    .replace(/^OPEN_AUDIT_FLAG:/i, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function mapCode(dict: Record<string, string>, code: unknown, fallback = "-"): string {
  const key = String(code ?? "").trim();
  if (!key) return fallback;
  return dict[key.toUpperCase()] ?? dict[key] ?? humanizeCode(key);
}

export function formatRoleEs(role: unknown): string {
  return mapCode(ROLE_LABELS_ES, role, "Sin rol");
}

export function formatOperationalStatusEs(status: unknown): string {
  return mapCode(OPERATIONAL_STATUS_ES, status, "Sin estado");
}

export function formatFulfillmentModeEs(mode: unknown): string {
  return mapCode(FULFILLMENT_MODE_ES, mode, "Sin modalidad");
}

export function formatPaymentModeEs(mode: unknown): string {
  return mapCode(PAYMENT_MODE_ES, mode, "Efectivo");
}

export function formatPromiseStatusEs(status: unknown): string {
  return mapCode(PROMISE_STATUS_ES, status, "Sin fecha pactada");
}

export function formatApStatusEs(status: unknown): string {
  return mapCode(AP_STATUS_ES, status, "Pendiente");
}

export function formatDocTypeEs(docType: unknown): string {
  return mapCode(DOC_TYPE_ES, docType, "Comprobante");
}

export function formatAccountTypeEs(accountType: unknown): string {
  return mapCode(ACCOUNT_TYPE_ES, accountType, "Cuenta");
}

const ROUTE_TRIP_STATUS_ES: Record<string, string> = {
  OPEN: "En Ruta",
  CLOSED: "Cerrada",
  RECONCILED: "Conciliada",
};

const QUOTE_STATUS_ES: Record<string, string> = {
  OPEN: "Abierta",
  CONVERTED: "Convertida",
  EXPIRED: "Vencida",
  CANCELLED: "Anulada",
};

const AUDIT_FLAG_STATUS_ES: Record<string, string> = {
  OPEN: "Abierta",
  ACKNOWLEDGED: "En Revisión",
  RESOLVED: "Resuelta",
};

const AUDIT_FLAG_CODE_ES: Record<string, string> = {
  EXEL_QTY_PRICE_SWAPPED_CORRECTED: "Corrección de columnas invertidas en ruta",
  PURCHASE_LINE_QTY_PRICE_SWAP: "Corrección de cantidad y costo en compra",
  PURCHASE_CURRENCY_MISMATCH_FIXED: "Corrección de moneda en compra",
  MISSING_BANK_STATEMENT_LEDGER: "Extractos bancarios históricos pendientes",
  CANCELLED_DRAFT: "Borrador de pedido anulado",
  CANCELLED_ORDER: "Pedido anulado",
  BELOW_MIN_PRICE_APPROVAL: "Precio por debajo del mínimo",
  ON_DEMAND_PENDING_PURCHASE: "Línea bajo pedido pendiente de compra",
};

const ENTITY_TABLE_ES: Record<string, string> = {
  SALES_ORDERS: "Pedido",
  SALES_ORDER_LINES: "Ítem de pedido",
  PURCHASES: "Compra",
  PURCHASE_INVOICES: "Compra",
  PURCHASE_LINES: "Línea de compra",
  CASH_LEDGER: "Movimiento de caja",
  CASH_ACCOUNTS: "Cuenta",
  PRODUCTS: "Producto",
  PARTIES: "Cliente / Proveedor",
  QUOTES: "Cotización",
  ROUTE_TRIPS: "Hoja de ruta",
  BANK_STATEMENTS: "Extracto bancario",
};

export function formatRouteTripStatusEs(status: unknown): string {
  return mapCode(ROUTE_TRIP_STATUS_ES, status, "Sin estado");
}

export function formatQuoteStatusEs(status: unknown): string {
  return mapCode(QUOTE_STATUS_ES, status, "Abierta");
}

export function formatAuditFlagStatusEs(status: unknown): string {
  return mapCode(AUDIT_FLAG_STATUS_ES, status, "Abierta");
}

export function formatAuditFlagCodeEs(code: unknown): string {
  return mapCode(AUDIT_FLAG_CODE_ES, code, "Alerta operativa");
}

export function formatEntityTableEs(tableName: unknown): string {
  const cleaned = String(tableName ?? "")
    .trim()
    .replace(/^(?:erp|analytics)\./i, "");
  return mapCode(ENTITY_TABLE_ES, cleaned, "Registro");
}

export function formatCashDirectionEs(
  direction: unknown,
  isInternalTransfer?: boolean
): string {
  if (isInternalTransfer) return "Traslado Interno";
  const key = String(direction ?? "")
    .trim()
    .toUpperCase();
  if (key === "IN") return "Ingreso";
  if (key === "OUT") return "Salida";
  return key || "Movimiento";
}

export function formatExpenseCategoryEs(category: unknown): string {
  return mapCode(EXPENSE_CATEGORY_ES, category, "Movimiento");
}

export function formatMarginStatusEs(status: unknown): string {
  return mapCode(MARGIN_STATUS_ES, status, "Sin dato");
}

export function formatQualityGapEs(
  metricCode: unknown,
  rawDescription?: unknown
): { label: string; description: string } {
  const code = String(metricCode ?? "").trim();
  const mapped = QUALITY_GAP_ES[code];
  if (mapped) return mapped;
  return {
    label: humanizeCode(code || "REVISIÓN"),
    description: String(rawDescription ?? "Revisión operativa pendiente."),
  };
}

const UNIT_MEASURE_NAMES_ES: Record<string, string> = {
  KGM: "Kilogramos (KGM)",
  MTR: "Metros (MTR)",
  NIU: "Unidades (NIU)",
  RO: "Rollos (RO)",
  ZZ: "Servicio (ZZ)",
  UND: "Unidades (UND)",
};

export function formatUnitCode(uom: unknown, fallback = "NIU"): string {
  const code = String(uom ?? "")
    .trim()
    .toUpperCase();
  return code || fallback;
}

export function formatUnitTitleEs(uom: unknown): string {
  const code = String(uom ?? "")
    .trim()
    .toUpperCase();
  if (!code) return "Unidad";
  return UNIT_MEASURE_NAMES_ES[code] ?? code;
}

export function normalizeUiNoteEs(note: unknown): string {
  const raw = String(note ?? "").trim();
  if (!raw) return "";
  if (/invoice open per EXEL 24-08-2026 reconciliation/i.test(raw)) {
    return "Factura de agosto pendiente según conciliación al 24/08/2026.";
  }
  if (/FQQ1-126 partial settlement reconciled per EXEL 24-08-2026/i.test(raw)) {
    return "Pago parcial de factura FQQ1-126 conciliado al 24/08/2026 (Saldo: S/ 3,194.00).";
  }
  if (/invoice reconciled as PAID per EXEL BLUE HORIZON\.xlsx/i.test(raw)) {
    return "Factura conciliada como pagada según control histórico (Hoja 20 / 29-07-2026 / 24-08-2026).";
  }
  return raw;
}
