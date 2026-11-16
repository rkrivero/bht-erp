export type OutflowBucket =
  | "ROUTE_OPEX"
  | "MERCHANDISE_PAYMENT"
  | "NON_OPEX_OR_CAPEX";

export interface OutflowCategoryOption {
  value: string;
  label: string;
}

export const OUTFLOW_CATEGORIES_BY_BUCKET: Record<
  OutflowBucket,
  readonly OutflowCategoryOption[]
> = {
  ROUTE_OPEX: [
    { value: "COMBUSTIBLE", label: "Combustible / Grifo" },
    { value: "PEAJE", label: "Peaje" },
    { value: "ESTACIONAMIENTO", label: "Estacionamiento / Cochera" },
    { value: "VIATICOS", label: "Viáticos / Alimentación de Ruta" },
    { value: "HOSPEDAJE", label: "Hospedaje" },
    { value: "ESTIBADOR_APOYO", label: "Estibador / Descarga" },
    { value: "COURIER_ENVIO", label: "Courier / Envío / Encomienda" },
    { value: "MANTENIMIENTO_RUTA", label: "Mantenimiento / Lavado" },
    { value: "EMPAQUE_INSUMOS", label: "Empaques / Insumos" },
    { value: "SEGURO_SOAT_RUTA", label: "SOAT / Seguro Unidad" },
    { value: "UTILES_ADMIN", label: "Útiles / Impresiones" },
    { value: "GASTO_RUTA", label: "Gasto General de Ruta" },
    { value: "OTROS_RUTA", label: "Otros Gastos de Ruta" },
  ],
  MERCHANDISE_PAYMENT: [
    { value: "MERCADERIA", label: "Compra de Mercadería" },
    { value: "PAGO_CXP", label: "Pago / Abono a Proveedor (CxP)" },
    { value: "FLETE_MERCADERIA", label: "Flete / Transporte de Mercadería" },
    { value: "MERCHANDISE", label: "Mercadería (General)" },
    { value: "MERCHANDISE_PAYMENT", label: "Pago Directo de Mercadería" },
  ],
  NON_OPEX_OR_CAPEX: [
    { value: "RETIRO", label: "Retiro de Socio" },
    { value: "PAYROLL_ADVANCE", label: "Sueldo / Adelanto de Personal" },
    { value: "CAPEX_ASSET", label: "Activo Fijo / Equipos (CAPEX)" },
    { value: "ACCOUNTING_OR_LEGAL", label: "Contabilidad / Legal / Notaría" },
    { value: "ACCOUNTING_SERVICE", label: "Servicio Contable" },
    { value: "LEGAL_NOTARIA", label: "Notaría / Trámite Legal" },
    { value: "FINANCIAL_FEE", label: "Comisión Bancaria / ITF" },
    { value: "PRIOR_DEBT", label: "Deuda Previa / Préstamo" },
    { value: "OTRO_NO_OPERATIVO", label: "Otro Egreso No Operativo" },
  ],
};

export function isCategoryAllowedForBucket(
  bucket: OutflowBucket,
  category: string
): boolean {
  const normalized = category.trim().toUpperCase();
  return OUTFLOW_CATEGORIES_BY_BUCKET[bucket].some(
    (opt) => opt.value === normalized
  );
}
