"use client";

import React from "react";
import { ModalSheet, type Tone } from "@/components/ui/Primitives";

export type ReportConceptId =
  | "ventas_totales"
  | "margen_bruto_con_costo"
  | "gastos_operativos_ruta"
  | "gastos_fijos_admin"
  | "contribucion_ruta"
  | "resultado_operativo_registrado"
  | "pagado_en_pedidos"
  | "compra_mercaderia"
  | "retiros_no_opex"
  | "movimiento_neto_estimado"
  | "depositos_internos"
  | "pre_ruta"
  | "saldo_cuentas_liquidas"
  | "custodia_socios"
  | "total_cxp_abiertas"
  | "cobertura_cxp_30d"
  | "cartera_total_cxc"
  | "dso_estimado"
  | "saldo_mayor_30d"
  | "dias_vencidos_due_date"
  | "promesas_vencidas"
  | "valorizacion_inventario"
  | "stock_muerto_90d"
  | "reposicion_urgente_14d"
  | "riesgo_margen_stock"
  | "candidatos_bajo_pedido"
  | "rentabilidad_ruta"
  | "auditoria_descuentos"
  | "cobertura_registro_24h"
  | "semaforo_cierre";

export interface ReportConceptDefinition {
  title: string;
  subtitle: string;
  plainMeaning: string;
  formula: string;
  theory: string;
  decisionTip: string;
}

export interface ActiveReportConcept {
  id: ReportConceptId;
  currentValue?: string;
  currentSubtext?: string;
}

export const REPORT_CONCEPTS: Record<ReportConceptId, ReportConceptDefinition> = {
  ventas_totales: {
    title: "Ventas Totales y Cobertura de Costo",
    subtitle: "Resumen comercial · Ingreso devengado y trazabilidad de costos",
    plainMeaning:
      "Es el monto total vendido en pedidos válidos del período (aunque el cliente aún no haya terminado de pagar), junto con el porcentaje de esas ventas cuyo costo de compra ya conoce el sistema.",
    formula:
      "Ventas Totales = suma del total de pedidos activos en el período. Cobertura de costo (%) = (Ventas de productos con costo conocido ÷ Ventas Totales) × 100.",
    theory:
      "En contabilidad financiera (principio del devengo / NIIF 15), la venta se reconoce cuando se concreta el pedido o entrega, no recién cuando entra el dinero. Separar qué parte tiene costo registrado evita mezclar rentabilidad real con ventas sin costo.",
    decisionTip:
      "Si la cobertura de costo está debajo de 90–95%, completa los costos faltantes en Inventario o Compras antes de sacar conclusiones definitivas sobre ganancia.",
  },
  margen_bruto_con_costo: {
    title: "Margen bruto sobre ventas con costo",
    subtitle: "Rentabilidad comercial · Utilidad bruta y COGS",
    plainMeaning:
      "Es cuánto te queda de la venta después de pagar lo que costó comprar esa mercadería, pero calculado SOLO sobre los productos que sí tienen costo registrado (para no engañarte asumiendo costo cero).",
    formula:
      "Margen bruto (S/) = Ventas con costo conocido − COGS (Costo de mercadería vendida). Margen (%) = (Margen bruto ÷ Ventas con costo conocido) × 100.",
    theory:
      "En teoría de costos y estados financieros (NIC 2 Inventarios y Estado de Resultados), el Margen Bruto mide la eficiencia comercial pura: precio de venta menos costo directo de adquisición (COGS). Excluir líneas sin costo evita inflar artificialmente el margen al 100%.",
    decisionTip:
      "Úsalo para evaluar si tus precios y descuentos sostienen el negocio. Si este porcentaje cae, sube precios de venta, negocia mejor con proveedores o controla descuentos bajo piso.",
  },
  gastos_operativos_ruta: {
    title: "Gastos Operativos de Ruta (OpEx)",
    subtitle: "Eficiencia logística · Costo operativo variable y de reparto",
    plainMeaning:
      "Es el dinero que cuesta mover y vender en la calle: combustible, peajes, chofer, viáticos y mantenimiento operativo ligados a las rutas.",
    formula:
      "Gastos de Ruta = suma de egresos de caja clasificados como gasto operativo de ruta en el período. Meta (%) = (Gastos de Ruta ÷ Ventas Totales) × 100.",
    theory:
      "En contabilidad gerencial, el OpEx (Operating Expenses) agrupa los gastos necesarios para operar sin formar parte del costo del producto. Medirlo como porcentaje de las ventas permite vigilar si la logística se come el margen comercial.",
    decisionTip:
      "Vigila la meta de ≤ 8% sobre ventas. Cuando sube por encima, agrupa pedidos por zona antes de despachar o exige un pedido mínimo rentable por viaje.",
  },
  contribucion_ruta: {
    title: "Contribución después de gastos de ruta",
    subtitle: "Margen de contribución operativa · Resultado comercial parcial",
    plainMeaning:
      "Es lo que realmente aporta la operación comercial para cubrir gastos fijos generales, impuestos y ganancia, después de restar tanto el costo de la mercadería como los gastos de reparto en ruta.",
    formula:
      "Contribución de ruta = Margen bruto sobre ventas con costo − Gastos Operativos de Ruta. Porcentaje = Contribución ÷ Ventas con costo conocido.",
    theory:
      "Corresponde al Margen de Contribución Operativa en contabilidad de costos. No debe llamarse utilidad neta o EBITDA completo porque todavía no descuenta todos los gastos fijos administrativos, tributos ni depreciación.",
    decisionTip:
      "Es el termómetro más honesto de si vender y repartir hoy genera excedente real. Una contribución positiva y estable (idealmente ≥ 15%) indica operación sana antes de gastos fijos.",
  },
  pagado_en_pedidos: {
    title: "Cobros efectivos del período (Abonos)",
    subtitle: "Flujo de ingresos · Caja percibida por fecha real de pago",
    plainMeaning:
      "Es el dinero que efectivamente ingresó en la fecha real de cobro del período seleccionado (incluye abonos cobrados en el período de pedidos anteriores), distinto del total vendido cuando hay crédito.",
    formula:
      "Cobros efectivos del período = suma de abonos válidos en erp.ar_payments cuya payment_date cae dentro del período filtrado.",
    theory:
      "Refleja el principio de caja (cash basis) frente al criterio devengado de la venta: las ventas se asignan al mes del pedido, mientras que la liquidez sigue la fecha real de pago.",
    decisionTip:
      "Compara siempre Cobros efectivos del período contra Ventas Totales y Compra de Mercadería para saber si el dinero entra a tiempo para financiar la reposición.",
  },
  compra_mercaderia: {
    title: "Compra Mercadería (Flujo de reposición)",
    subtitle: "Salidas de caja · Inversión en inventario",
    plainMeaning:
      "Es el efectivo que salió de caja y bancos para pagar compras de mercadería o abonar cuentas con proveedores.",
    formula:
      "Compra Mercadería = egresos de tesorería asignados a compra de mercadería y pago de obligaciones con proveedores.",
    theory:
      "En finanzas, comprar mercadería transforma efectivo en activo (inventario), no es inmediatamente un gasto (COGS) hasta que el producto se vende. Por eso puede haber meses con mucha salida de caja por reposición aunque el margen comercial sea bueno.",
    decisionTip:
      "Crúzalo con Stock Lento y Muerto: si sale mucho dinero en compras mientras crece el inventario sin rotación, estás comprando productos equivocados.",
  },
  retiros_no_opex: {
    title: "Retiros / No OpEx",
    subtitle: "Disciplina financiera · Flujos ajenos a la operación",
    plainMeaning:
      "Es dinero que salió de las cuentas del negocio para retiros de socios u otros egresos que no sostienen la venta ni reponen mercadería.",
    formula:
      "Retiros / No OpEx = egresos marcados fuera de gasto operativo de ruta, gastos fijos administrativos y mercadería. Ratio (%) = (Retiros ÷ Reinversión en mercadería y operación) × 100.",
    theory:
      "Separa el resultado económico del negocio de las decisiones patrimoniales de los dueños (principio de entidad contable). Confundir retiros con gastos distorsiona la rentabilidad real.",
    decisionTip:
      "Mantén la referencia de retiros debajo de 30% frente a la reinversión hasta asegurar capital de trabajo suficiente y cuentas por pagar cubiertas.",
  },
  movimiento_neto_estimado: {
    title: "Movimiento neto estimado",
    subtitle: "Flujo de caja operativo · Variación registrada en el ERP",
    plainMeaning:
      "Es la diferencia entre el efectivo cobrado y todas las salidas registradas (mercadería, ruta, gastos fijos administrativos y retiros) según lo anotado en el sistema.",
    formula:
      "Movimiento neto estimado = Cobros efectivos − Compra de Mercadería − Gastos de Ruta − Gastos Fijos / Admin − Retiros / No OpEx.",
    theory:
      "Es una aproximación directa del flujo de efectivo neto del período (Estado de Flujos de Efectivo, NIC 7). Si faltan movimientos por registrar o conciliación bancaria, sirve como guía, no como extracto oficial.",
    decisionTip:
      "Si el margen bruto es positivo pero este flujo es negativo, revisa si el dinero quedó atrapado en cuentas por cobrar, exceso de inventario, gastos administrativos o retiros.",
  },
  depositos_internos: {
    title: "Depósitos Internos (Traslados)",
    subtitle: "Tesorería · Movimientos neutros entre cuentas propias",
    plainMeaning:
      "Es dinero que solo cambió de bolsillo dentro de la empresa (por ejemplo, de caja efectiva o custodia a una cuenta bancaria).",
    formula:
      "Suma de transferencias o depósitos internos entre cuentas activas de la empresa.",
    theory:
      "En contabilidad de tesorería, un traslado entre cuentas propias es un movimiento permutativo: cambia dónde está el dinero, pero NO es un ingreso nuevo ni un gasto.",
    decisionTip:
      "Verifícalo para comprobar que el efectivo cobrado en ruta o custodia realmente ingresó al banco sin inflar ventas.",
  },
  pre_ruta: {
    title: "Pre-Ruta (Inversión fundacional)",
    subtitle: "Capital inicial · Desembolsos de arranque",
    plainMeaning:
      "Registra los desembolsos iniciales hechos antes de que comiencen las rutas regulares de venta (arranque del proyecto).",
    formula:
      "Suma de egresos históricos etiquetados como inversión fundacional pre-ruta.",
    theory:
      "Separar la inversión inicial de arranque (CapEx / puesta en marcha) del gasto corriente permite medir si el negocio operativo ya es autosostenible mes a mes.",
    decisionTip:
      "Considéralo para evaluar el retorno acumulado de la inversión total, sin penalizar el margen mensual actual.",
  },
  saldo_cuentas_liquidas: {
    title: "Saldo registrado en cuentas líquidas",
    subtitle: "Tesorería · Disponibilidad inmediata anotada en ERP",
    plainMeaning:
      "Es el total que suma el sistema en bancos, cajas chicas y billeteras digitales según los ingresos y egresos digitados hasta hoy.",
    formula:
      "Saldo registrado = suma del saldo neto (Ingresos − Salidas) de cada cuenta líquida activa.",
    theory:
      "Representa el saldo contable en libros de efectivo y equivalentes. En control interno, un saldo en libros solo es dinero disponible confiable tras una conciliación bancaria y arqueo físico.",
    decisionTip:
      "Antes de comprometer un pago grande, valida el extracto bancario real frente a este saldo registrado.",
  },
  custodia_socios: {
    title: "Custodia de Socios (por rendir)",
    subtitle: "Control interno · Efectivo en poder de responsables",
    plainMeaning:
      "Es dinero cobrado o asignado que figura en manos de un socio o responsable y todavía no se ha depositado en banco ni rendido con comprobante.",
    formula:
      "Suma de saldos en cuentas de tipo custodia de socios (Ingresos recibidos − Depósitos o egresos rendidos).",
    theory:
      "Contablemente funciona como un fondo sujeto a rendición de cuentas (activo exigible interno), distinto del dinero disponible en la cuenta bancaria empresarial.",
    decisionTip:
      "Procura mantener este monto bajo mediante depósitos o rendiciones semanales para evitar desfases con la tesorería.",
  },
  total_cxp_abiertas: {
    title: "Total CxP Abiertas (Cuentas por Pagar)",
    subtitle: "Pasivo corriente · Obligaciones con proveedores",
    plainMeaning:
      "Es todo el dinero que el negocio aún debe pagar a proveedores por compras y obligaciones pendientes.",
    formula:
      "Total CxP Abiertas = suma del saldo pendiente (Monto original − Pagos realizados) de obligaciones abiertas o parciales.",
    theory:
      "Forma parte central del pasivo corriente en el Balance General. El crédito de proveedores financia el capital de trabajo sin costo financiero si se paga a tiempo.",
    decisionTip:
      "Prioriza las facturas vencidas y las que vencen en los próximos 7 días para proteger la relación comercial y el suministro.",
  },
  cobertura_cxp_30d: {
    title: "Cobertura registrada tras CxP ≤30d",
    subtitle: "Liquidez de corto plazo · Capacidad de pago a 30 días",
    plainMeaning:
      "Muestra cuánto dinero quedaría (o faltaría) si pagaras hoy todas las deudas con proveedores ya vencidas y las que vencen en los próximos 30 días usando tus cuentas líquidas registradas.",
    formula:
      "Cobertura 30d = Saldo registrado en cuentas líquidas − (CxP vencidas + CxP con vencimiento ≤ 30 días).",
    theory:
      "Es una prueba ácida operativa de corto plazo (liquidez inmediata frente a exigibilidades a 30 días), fundamental para anticipar tensiones de caja antes de caer en iliquidez.",
    decisionTip:
      "Si sale negativo, acelera cobranza de cartera antigua, frena compras no urgentes o reprograma vencimientos con proveedores.",
  },
  cartera_total_cxc: {
    title: "Cartera Total por Cobrar (CxC)",
    subtitle: "Capital de trabajo · Dinero pendiente de clientes",
    plainMeaning:
      "Es el dinero que ya vendiste y entregaste (o comprometiste), pero que los clientes todavía no han terminado de pagarte.",
    formula:
      "Cartera Total por Cobrar = suma de saldos pendientes de todos los pedidos activos con saldo mayor a cero.",
    theory:
      "En finanzas corporativas, las Cuentas por Cobrar son capital de trabajo inmovilizado financiado por la empresa. Vender a crédito sin cobrar rápido reduce liquidez aunque haya utilidad contable.",
    decisionTip:
      "Trabaja la cartera junto con la Hoja de Cobranza por Zona para convertir cuentas por cobrar en efectivo disponible.",
  },
  dso_estimado: {
    title: "DSO Estimado (Días promedio de cobro)",
    subtitle: "Ciclo de efectivo · Velocidad de cobranza",
    plainMeaning:
      "Indica cuántos días en promedio tarda el negocio en cobrar sus ventas desde que emite un pedido hasta que entra el dinero.",
    formula:
      "DSO ≈ (Cartera Total por Cobrar ÷ Ventas del período de referencia) × Días de la ventana (por defecto 90 días).",
    theory:
      "DSO (Days Sales Outstanding) es el indicador estándar mundial del ciclo de conversión de efectivo para cuentas por cobrar: DSO = (Accounts Receivable ÷ Credit/Total Sales) × Number of Days.",
    decisionTip:
      "Compáralo contra el plazo real de pago que te dan tus proveedores: si cobras en más días de los que tienes para pagar, necesitarás caja extra para crecer.",
  },
  saldo_mayor_30d: {
    title: "Saldo con antigüedad > 30 días",
    subtitle: "Riesgo crediticio · Envejecimiento de cartera (Aging)",
    plainMeaning:
      "Es la parte de tus cuentas por cobrar que lleva más de un mes desde la fecha del pedido sin cancelarse por completo.",
    formula:
      "Suma de saldos abiertos cuya antigüedad (fecha actual − fecha del pedido) supera 30 días (y tramo crítico > 60 días).",
    theory:
      "Según la metodología de Aging Schedule en gestión de crédito, la probabilidad de recuperación cae bruscamente conforme aumenta la antigüedad del saldo.",
    decisionTip:
      "Prioriza gestión presencial o telefónica en clientes > 60 días y restringe nuevo crédito mientras no regularicen saldos antiguos.",
  },
  promesas_vencidas: {
    title: "Promesas de Pago Vencidas",
    subtitle: "Control de cobranza · Incumplimiento de compromisos",
    plainMeaning:
      "Son acuerdos de pago con fecha pactada que ya pasó y el cliente todavía no abonó lo comprometido.",
    formula:
      "Conteo y monto pendiente de pedidos con fecha prometida vencida y saldo aún abierto.",
    theory:
      "Mide la disciplina de cumplimiento crediticio y sirve como indicador temprano de deterioro de cartera antes de convertirse en incobrable.",
    decisionTip:
      "Contacta primero a estos clientes: ya reconocieron la deuda y tenían fecha acordada, por lo que son cobros de respuesta rápida.",
  },
  valorizacion_inventario: {
    title: "Valorización Inventario (Stock Positivo)",
    subtitle: "Activo realizable · Capital invertido en almacén",
    plainMeaning:
      "Es cuánto vale al costo de compra toda la mercadería disponible actualmente en almacén (solo contando productos con stock positivo y costo conocido).",
    formula:
      "Valorización = suma de (Stock disponible positivo × Costo de referencia actual) de cada SKU.",
    theory:
      "Se alinea con la medición de existencias al costo (NIC 2) usando el costo promedio/referencia actualizado de tus compras, sin mezclar precio de venta.",
    decisionTip:
      "Revisa cuántos productos tienen stock sin costo cargado para no subestimar el valor real de tu almacén.",
  },
  stock_muerto_90d: {
    title: "Stock Muerto (≥ 90 días sin venta)",
    subtitle: "Eficiencia de inventario · Capital inmovilizado",
    plainMeaning:
      "Es dinero atrapado en productos que llevan 3 meses o más guardados sin registrar ni una venta.",
    formula:
      "Stock Muerto = valorización (stock × costo) de SKUs con inventario > 0 cuya última venta fue hace ≥ 90 días (Lento: 60–89 días).",
    theory:
      "El inventario inmovilizado tiene un costo financiero invisible (costo de oportunidad del dinero, riesgo de deterioro, mermas y espacio de almacén).",
    decisionTip:
      "Activa combos, liquidaciones con descuento controlado o bonificaciones a vendedores para liberar ese efectivo y reinvertirlo en productos de alta rotación.",
  },
  reposicion_urgente_14d: {
    title: "Reposición Urgente (≤ 14 días de cobertura)",
    subtitle: "Continuidad comercial · Riesgo de quiebre de stock",
    plainMeaning:
      "Cuenta cuántos productos de inventario permanente se agotarían en 14 días o menos si mantienen el ritmo de venta de los últimos 90 días.",
    formula:
      "Cobertura (días) = Stock actual ÷ (Unidades vendidas últimos 90d ÷ 90). Se alerta cuando la cobertura es ≤ 14 días.",
    theory:
      "Es el principio de Days of Inventory on Hand (DOH) y punto de reorden (Reorder Point): debes comprar antes de quedarte en cero considerando el tiempo de entrega del proveedor.",
    decisionTip:
      "Usa el botón Comprar en la tabla inferior para reponer primero los SKUs líderes en ingresos y margen.",
  },
  riesgo_margen_stock: {
    title: "Riesgo de Margen (< 20% o sin costo)",
    subtitle: "Salud de precios · Protección de rentabilidad",
    plainMeaning:
      "Productos que te dejan menos de S/ 20 de margen por cada S/ 100 vendidos, o que todavía no tienen costo de referencia guardado.",
    formula:
      "Margen producto (%) = ((Ingresos − COGS) ÷ Ingresos) × 100. Se marca si el margen es < 20% o falta costo conocido.",
    theory:
      "Un margen bruto insuficiente (< 20%) difícilmente absorbe gastos operativos de ruta, mermas y estructura en negocios de distribución.",
    decisionTip:
      "Completa costos faltantes primero; si el margen real sigue bajo, ajusta precio mínimo de lista o negocia mejor costo.",
  },
  candidatos_bajo_pedido: {
    title: "Candidatos Bajo Pedido Frecuentes para Pasar a Stock",
    subtitle: "Gestión de surtido · Transición a inventario permanente",
    plainMeaning:
      "Productos configurados para comprarse solo cuando un cliente los pide (bajo pedido), pero que ya se venden tan seguido que conviene tenerlos en stock propio.",
    formula:
      "Listado de SKUs en modalidad Bajo Pedido ordenados por cantidad de pedidos, unidades e ingresos acumulados.",
    theory:
      "En gestión de inventarios, el modo Bajo Pedido reduce inmovilización de capital, mientras el Stock Permanente reduce tiempo de entrega y aumenta disponibilidad. Cuando la demanda se vuelve recurrente, pasar a stock mejora servicio y permite comprar por volumen a menor costo.",
    decisionTip:
      "Edita los productos con mayor frecuencia repetida de pedidos y evalúa mantener un stock mínimo de seguridad.",
  },
  rentabilidad_ruta: {
    title: "Rentabilidad por Ruta / Viaje",
    subtitle: "Control logístico · Margen vs. costo del reparto",
    plainMeaning:
      "Muestra si cada salida o viaje comercial dejó ganancia neta después de restar sus propios gastos de ruta.",
    formula:
      "Contribución Neta del Viaje = Margen Bruto de pedidos del viaje − Gastos de Ruta asignados al viaje.",
    theory:
      "Aplica contabilidad por centros de beneficio / rutas (Activity-Based / Route P&L) para detectar viajes deficitarios ocultos en el promedio mensual.",
    decisionTip:
      "Revisa viajes donde el gasto de ruta supera el 8% de las ventas y consolida más pedidos por zona.",
  },
  auditoria_descuentos: {
    title: "Auditoría de Descuentos en Ventas",
    subtitle: "Gobierno comercial · Erosión de precios",
    plainMeaning:
      "Cuánto dinero dejaste de cobrar frente al precio de lista por rebajas otorgadas, señalando cuántas líneas bajaron del precio mínimo autorizado.",
    formula:
      "Total cedido = (Precio base − Precio vendido) × Cantidad. Bajo piso = Precio vendido < Precio mínimo configurado.",
    theory:
      "Un descuento impacta directo 1 a 1 en la utilidad neta, no en las ventas: ceder 10% de precio puede reducir el margen bruto en 30–50%.",
    decisionTip:
      "Audita líneas marcadas Bajo piso con cada vendedor y valida las aprobaciones otorgadas.",
  },
  cobertura_registro_24h: {
    title: "Cobertura de registro completo en 24 h",
    subtitle: "Disciplina operativa · Calidad en la captura diaria",
    plainMeaning:
      "Porcentaje de pedidos ingresados desde la app dentro de las primeras 24 horas que traen completos todos sus datos clave.",
    formula:
      "(Pedidos ERP creados en ≤ 24h con cliente, costo conocido, responsable, cuenta de ingreso y promesa si queda saldo) ÷ Total pedidos ERP.",
    theory:
      "Garantiza la integridad en el origen (Garbage In, Garbage Out): si el dato entra completo el mismo día, los reportes financieros se vuelven confiables en tiempo real.",
    decisionTip:
      "Revisa la lista de pedidos por completar y corrige los campos faltantes apenas cierra el día.",
  },
  semaforo_cierre: {
    title: "Semáforo de Cierre Contable y Operativo",
    subtitle: "Control de calidad · Preparación para cierre mensual",
    plainMeaning:
      "Resumen de chequeos automáticos que avisa si los datos están limpios para confiar en el cierre del mes o si hay pendientes bloqueantes.",
    formula:
      "Evalúa 7 controles críticos: SKUs sin costo, stock negativo, descuentos sin aprobar, compras bajo pedido pendientes, viajes abiertos y promesas vencidas.",
    theory:
      "Equivale a una lista de conciliación pre-cierre contable (Monthly Close Checklist) para garantizar exactitud y completitud antes de reportar resultados.",
    decisionTip:
      "Resuelve primero los controles en rojo (bloqueantes) antes de repartir utilidades o evaluar resultados finales.",
  },
  gastos_fijos_admin: {
    title: "Gastos Fijos y Administrativos (Admin OpEx)",
    subtitle: "Estructura operativa · Sueldos, local y servicios generales",
    plainMeaning:
      "Son los egresos recurrentes necesarios para sostener el negocio más allá de mover camiones: sueldo de socios administradores, planilla fija, alquiler, luz/agua/internet, contabilidad, software y comisiones bancarias.",
    formula:
      "Gastos Fijos / Admin = suma de egresos en bucket ADMIN_OPEX (más categorías administrativas históricas como contabilidad, legal, alquiler o sueldo socio).",
    theory:
      "En Simple Numbers (Greg Crabtree) y contabilidad gerencial, la remuneración a mercado de los socios operadores y la estructura fija deben descontarse como gasto operativo antes de evaluar si la empresa realmente genera utilidad.",
    decisionTip:
      "Separa siempre el sueldo del socio por trabajar en el negocio (Admin OpEx) del reparto de utilidades o retiros patrimoniales (No OpEx).",
  },
  resultado_operativo_registrado: {
    title: "Resultado Operativo Registrado",
    subtitle: "Desempeño económico · Después de ruta y gastos fijos registrados",
    plainMeaning:
      "Es lo que queda del margen bruto sobre ventas con costo después de descontar tanto los gastos de ruta como los gastos fijos y administrativos anotados en el ERP.",
    formula:
      "Resultado Operativo Registrado = Margen bruto con costo − OpEx de Ruta − Gastos Fijos / Admin. (%) = Resultado Operativo ÷ Ventas con costo conocido.",
    theory:
      "Mide la ganancia operativa real de la empresa (EBIT operativo antes de impuestos/financiamiento y antes de retiros de capital). Si Sueldo de Socio está en S/ 0, la cifra aún sobreestima la utilidad real del negocio.",
    decisionTip:
      "Usa el 10% sobre ventas como punto de equilibrio operativo sano y 15% como señal de capacidad para ampliar estructura o contratar personal.",
  },
  dias_vencidos_due_date: {
    title: "Antigüedad del Pedido vs. Días Vencidos por Fecha Límite",
    subtitle: "Gestión crediticia · Separación entre edad y morosidad real",
    plainMeaning:
      "La antigüedad cuenta cuántos días pasaron desde que se emitió el pedido, mientras que los días vencidos cuentan únicamente los días transcurridos después de su fecha límite pactada (due_date).",
    formula:
      "Antigüedad = Hoy − order_date. Días vencidos = MAX(0, Hoy − due_date) cuando existe fecha límite.",
    theory:
      "Un pedido a 30 días de crédito con 15 días de emitido NO está moroso: está Al día. Mezclar edad con mora genera alarmas falsas y distorsiona el seguimiento de cobranza.",
    decisionTip:
      "Registra el plazo acordado por cliente en Directorio para que cada pedido a crédito calcule su fecha límite automáticamente y marque solo las moras reales.",
  },
};

const BUTTON_TONE_CLASSES: Record<Tone, string> = {
  default: "border-bht-slate-line bg-white",
  subtle: "border-bht-slate-line bg-bht-surface-cool",
  horizon: "border-bht-slate-line bg-bht-surface-cool",
  brand: "border-bht-info-line bg-bht-surface-cool",
  success: "border-bht-success-line bg-bht-tone-f5fbf7",
  warning: "border-bht-amber-line bg-bht-amber-bg",
  danger: "border-bht-danger-line bg-bht-tone-fef6f6",
  indigo: "border-bht-tone-c7d2fe bg-bht-tone-f6f7ff",
};

export function ConceptCardButton({
  tone = "default",
  padding = "md",
  onClick,
  children,
  className = "",
}: {
  tone?: Tone;
  padding?: "sm" | "md";
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const padClass = padding === "sm" ? "p-3.5" : "p-4";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex min-w-0 flex-col justify-between rounded-2xl border ${padClass} text-left shadow-bht-elev-4 transition hover:border-bht-navy-mid/45 hover:shadow-bht-elev-14 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep cursor-pointer ${BUTTON_TONE_CLASSES[tone]} ${className}`}
    >
      <div className="space-y-1.5">{children}</div>
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-bht-ink-muted transition-colors group-hover:text-bht-cobalt group-hover:underline">
        Ver fórmula y guía →
      </span>
    </button>
  );
}

export function ReportConceptModal({
  concept,
  onClose,
}: {
  concept: ActiveReportConcept | null;
  onClose: () => void;
}) {
  const def = concept ? REPORT_CONCEPTS[concept.id] : null;

  return (
    <ModalSheet
      open={Boolean(concept && def)}
      onClose={onClose}
      title={def ? def.title : "Explicación del indicador"}
      subtitle={def ? def.subtitle : undefined}
      maxWidth="lg"
    >
      {concept && def && (
        <div className="space-y-3 text-sm">
          {(concept.currentValue || concept.currentSubtext) && (
            <div className="rounded-xl border border-bht-line-blue bg-bht-mist/70 p-3">
              <span className="block text-xs text-bht-ink-soft">
                Valor actual en este filtro
              </span>
              {concept.currentValue && (
                <strong className="mt-0.5 block text-base text-bht-ink-strong tabular-nums">
                  {concept.currentValue}
                </strong>
              )}
              {concept.currentSubtext && (
                <p className="mt-0.5 text-xs text-bht-ink-soft tabular-nums">
                  {concept.currentSubtext}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="rounded-lg border border-bht-line bg-bht-paper px-3 py-2.5 space-y-1">
              <p className="font-semibold text-bht-navy-deep">
                ¿Qué significa en simple?
              </p>
              <p className="leading-relaxed text-bht-ink-strong">{def.plainMeaning}</p>
            </div>

            <div className="rounded-lg border border-bht-line bg-bht-paper px-3 py-2.5 space-y-1">
              <p className="font-semibold text-bht-navy-deep">Fórmula real en el ERP</p>
              <p className="leading-relaxed text-bht-ink-warm tabular-nums">
                {def.formula}
              </p>
            </div>

            <div className="rounded-lg border border-bht-line bg-bht-paper px-3 py-2.5 space-y-1">
              <p className="font-semibold text-bht-navy-deep">
                Fundamento teórico (Contabilidad y Finanzas)
              </p>
              <p className="leading-relaxed text-bht-ink-warm">{def.theory}</p>
            </div>

            <div className="rounded-lg border border-bht-line-blue bg-bht-mist/60 px-3 py-2.5 space-y-1">
              <p className="font-semibold text-bht-navy-deep">
                Cómo usarlo para tomar decisiones
              </p>
              <p className="leading-relaxed text-bht-ink-strong">{def.decisionTip}</p>
            </div>
          </div>
        </div>
      )}
    </ModalSheet>
  );
}
