export type ReportSectionId =
  "resumen" | "caja_cxp" | "cartera" | "comercial" | "stock" | "auditoria";

export type ReportPeriodPreset =
  "ALL" | "MONTH" | "THIS_MONTH" | "LAST_30D" | "LAST_90D" | "CUSTOM";

export interface ReportFilterState {
  preset: ReportPeriodPreset;
  month: string;
  from: string;
  to: string;
  zone: string;
  sellerId: string;
}

export const INITIAL_REPORT_FILTERS: ReportFilterState = {
  preset: "ALL",
  month: "",
  from: "",
  to: "",
  zone: "",
  sellerId: "",
};

export type ApMaturityBucketId =
  "OVERDUE" | "DUE_0_7" | "DUE_8_15" | "DUE_16_30" | "DUE_31_PLUS" | "NO_DUE_DATE";

export type ArAgingBucketId = "0_15" | "16_30" | "31_60" | "GT_60";

export const REPORT_TAB_ITEMS: Array<{
  id: ReportSectionId;
  label: string;
  subtitle: string;
  concepts: Array<{ term: string; meaning: string }>;
}> = [
  {
    id: "resumen",
    label: "Resumen",
    subtitle: "Ventas, margen conocido y movimientos de caja registrados",
    concepts: [
      {
        term: "Resultado parcial",
        meaning:
          "Ventas con costo conocido menos mercadería y gastos de ruta registrados.",
      },
      {
        term: "Margen bruto",
        meaning: "Venta con costo conocido menos costo de mercadería.",
      },
      {
        term: "Contribución de ruta",
        meaning:
          "Margen bruto menos gastos de ruta. No incluye todos los gastos del negocio.",
      },
      {
        term: "Movimiento neto estimado",
        meaning:
          "Pagos acumulados en pedidos menos salidas registradas; requiere conciliación.",
      },
    ],
  },
  {
    id: "comercial",
    label: "Comercial",
    subtitle: "Zonas, vendedores, viajes y descuentos",
    concepts: [
      { term: "Margen", meaning: "Venta menos costo conocido del producto." },
      {
        term: "Contribución de ruta",
        meaning: "Margen generado menos gasto operativo del viaje.",
      },
      { term: "Descuento", meaning: "Diferencia frente al precio de referencia." },
      { term: "Viaje", meaning: "Salida comercial u operativa asociada a una ruta." },
    ],
  },
  {
    id: "cartera",
    label: "Cartera",
    subtitle: "Aging, DSO y hoja de cobranza",
    concepts: [
      { term: "CxC", meaning: "Saldo que los clientes aún deben pagar." },
      { term: "Aging", meaning: "Antigüedad de cada saldo pendiente." },
      {
        term: "DSO",
        meaning: "Días promedio estimados para convertir ventas en cobros.",
      },
      { term: "Promesa vencida", meaning: "Compromiso de pago cuya fecha ya pasó." },
    ],
  },
  {
    id: "caja_cxp",
    label: "Caja y CxP",
    subtitle: "Saldos registrados vs. vencimientos 7/15/30d",
    concepts: [
      {
        term: "Saldo registrado",
        meaning: "Movimientos acumulados en el ERP; requiere conciliación bancaria.",
      },
      { term: "CxP", meaning: "Deudas pendientes con proveedores." },
      { term: "Vencimiento", meaning: "Fecha límite prevista para pagar." },
      {
        term: "Cobertura",
        meaning: "Cuánto de los compromisos cubren los saldos registrados.",
      },
    ],
  },
  {
    id: "stock",
    label: "Stock",
    subtitle: "Valorización, cobertura y stock muerto",
    concepts: [
      {
        term: "Valorización",
        meaning: "Stock disponible multiplicado por su costo de referencia.",
      },
      {
        term: "Cobertura",
        meaning: "Días estimados que durará el inventario al ritmo reciente.",
      },
      {
        term: "Stock muerto",
        meaning: "Producto disponible sin movimiento de venta reciente.",
      },
      {
        term: "Capital inmovilizado",
        meaning: "Dinero invertido en inventario con baja rotación.",
      },
    ],
  },
  {
    id: "auditoria",
    label: "Auditoría",
    subtitle: "Semáforo de cierre y exportaciones",
    concepts: [
      {
        term: "Semáforo",
        meaning: "Estado de los controles necesarios para un cierre confiable.",
      },
      {
        term: "Brecha",
        meaning: "Dato faltante o inconsistente que requiere revisión.",
      },
      {
        term: "CSV",
        meaning: "Archivo descargable para revisar o trabajar los datos.",
      },
      {
        term: "Cierre",
        meaning: "Revisión final de consistencia antes de usar las cifras.",
      },
    ],
  },
];

export const REPORT_CSV_CARDS = [
  {
    id: "ventas_pedidos",
    title: "1. Ventas y Pedidos",
    subtitle: "Órdenes, zonas, clientes, cobros, saldos y responsables",
    supportsDateFilter: true,
    supportsZoneFilter: true,
  },
  {
    id: "deudores_cartera",
    title: "2. Cartera de Deudores",
    subtitle: "Saldos por cobrar, antigüedad, zona y fechas pactadas",
    supportsDateFilter: true,
    supportsZoneFilter: true,
  },
  {
    id: "margen_productos",
    title: "3. Inventario, Costos y Márgenes",
    subtitle: "Catálogo, stock actual, costos conocidos y alertas",
    supportsDateFilter: false,
    supportsZoneFilter: false,
  },
  {
    id: "flujo_caja_egresos",
    title: "4. Movimientos de Caja y Egresos",
    subtitle: "Ingresos, OpEx ruta, compras, retiros y depósitos registrados",
    supportsDateFilter: true,
    supportsZoneFilter: false,
  },
  {
    id: "proveedores_cxp",
    title: "5. Cuentas por Pagar Proveedores",
    subtitle: "Obligaciones abiertas, parciales y pagadas por proveedor",
    supportsDateFilter: true,
    supportsZoneFilter: false,
  },
  {
    id: "valorizacion_inventario_corte",
    title: "6. Valorización Inventario Corte (Kardex)",
    subtitle: "Stock positivo valorizado, cobertura 90d y stock muerto",
    supportsDateFilter: false,
    supportsZoneFilter: false,
  },
  {
    id: "aging_cxc_cxp_corte",
    title: "7. Antigüedad CxC y CxP al Corte",
    subtitle: "Libro combinado de saldos por cobrar y pagar con tramos",
    supportsDateFilter: true,
    supportsZoneFilter: true,
  },
] as const;

export function getLimaTodayIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function shiftIsoDays(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d + deltaDays);
  const dt = new Date(utc);
  return dt.toISOString().slice(0, 10);
}

export function computeMonthRange(periodMonth: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}/.test(periodMonth)) return { from: "", to: "" };
  const y = Number(periodMonth.slice(0, 4));
  const m = Number(periodMonth.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return { from: "", to: "" };
  }
  const firstDay = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const lastDayDate = new Date(Date.UTC(y, m, 0));
  return {
    from: firstDay,
    to: lastDayDate.toISOString().slice(0, 10),
  };
}

export function computePeriodRange(
  preset: Exclude<ReportPeriodPreset, "MONTH" | "CUSTOM">,
  referenceDate = getLimaTodayIso()
): { from: string; to: string } {
  if (preset === "ALL") return { from: "", to: "" };
  if (preset === "THIS_MONTH") {
    return {
      from: `${referenceDate.slice(0, 7)}-01`,
      to: referenceDate,
    };
  }
  if (preset === "LAST_30D") {
    return {
      from: shiftIsoDays(referenceDate, -29),
      to: referenceDate,
    };
  }
  return {
    from: shiftIsoDays(referenceDate, -89),
    to: referenceDate,
  };
}

export function buildReportQueryString(
  filters: Pick<ReportFilterState, "from" | "to" | "zone" | "sellerId">,
  options?: { includeSeller?: boolean; includeZone?: boolean }
): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (options?.includeZone !== false && filters.zone) {
    params.set("zone", filters.zone);
  }
  if (options?.includeSeller !== false && filters.sellerId) {
    params.set("sellerId", filters.sellerId);
  }
  return params.toString();
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "-";
  }
  return `${Number(value).toFixed(digits)}%`;
}

export function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "Sin rotación";
  }
  return `${Math.round(Number(value))} d`;
}

const MATURITY_BUCKET_LABELS_ES: Record<ApMaturityBucketId, string> = {
  OVERDUE: "Vencidas",
  DUE_0_7: "Vencen 0–7 d",
  DUE_8_15: "Vencen 8–15 d",
  DUE_16_30: "Vencen 16–30 d",
  DUE_31_PLUS: "Mayor a 30 d",
  NO_DUE_DATE: "Sin fecha pactada",
};

export function formatMaturityBucketEs(bucket: string): string {
  return MATURITY_BUCKET_LABELS_ES[bucket as ApMaturityBucketId] ?? bucket;
}

const AR_BUCKET_LABELS_ES: Record<ArAgingBucketId, string> = {
  "0_15": "0–15 días",
  "16_30": "16–30 días",
  "31_60": "31–60 días",
  GT_60: "> 60 días",
};

export function formatArBucketEs(bucket: string): string {
  return AR_BUCKET_LABELS_ES[bucket as ArAgingBucketId] ?? bucket;
}

const DEAD_STOCK_LABELS_ES: Record<string, string> = {
  DEAD_90D: "Stock muerto (≥90d)",
  SLOW_60D: "Lento (60–89d)",
  LOW_COVERAGE: "Baja cobertura",
  NEGATIVE_STOCK: "Saldo negativo",
  HEALTHY: "Saludable",
  NO_STOCK: "Sin stock",
};

export function formatDeadStockStatusEs(status: string): string {
  return DEAD_STOCK_LABELS_ES[status] ?? status;
}

const INACTIVITY_LABELS_ES: Record<string, string> = {
  GT_60D: "> 60 días",
  "46_60D": "46–60 días",
  "31_45D": "31–45 días",
  ACTIVE: "Activo (< 31d)",
};

export function formatInactivityTierEs(tier: string): string {
  return INACTIVITY_LABELS_ES[tier] ?? tier;
}

const CLOSING_STATUS_ES: Record<
  string,
  { label: string; tone: "success" | "warning" | "danger" }
> = {
  READY: { label: "Listo para Cierre", tone: "success" },
  ATTENTION: { label: "Cierre con Observaciones", tone: "warning" },
  BLOCKED: { label: "Bloqueado (Faltan Costos / Críticas)", tone: "danger" },
};

export function formatClosingStatusEs(status: string): {
  label: string;
  tone: "success" | "warning" | "danger";
} {
  return CLOSING_STATUS_ES[status] ?? { label: status, tone: "warning" };
}
