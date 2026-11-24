# BHT ERP Ligero (`apps/web` — `bht-erp`)

Aplicación web y móvil (**10h/día en celular + 2h/día en PC**) conectada a **Neon PostgreSQL 17 (`bht-erp`)** para la gestión operativa, comercial, de almacén/reparto, compras a proveedores, cobranzas, tesorería y Business Intelligence de **Blue Horizon Trade** en Soles peruanos (`PEN`, `S/`).

## Características Principales

1. **Separación Estricta de Datos Financieros por Rol (Server-Side RBAC):**
   - **Socio Operativo y Admin (`PARTNER_ADMIN`):** Acceso total a ventas, cobranzas, compras/proveedores, costos reales, márgenes, catálogo, stock físico, exportaciones Excel/CSV y gestión de equipo/accesos.
   - **Socio Gerente (`PARTNER_MANAGER`):** Torre de control en tiempo real (4 responsables con fecha/hora), aprobación de descuentos en 1 toque, proveedores/compras, costos/márgenes, BI Analytics y exportaciones CSV.
   - **Vendedor Externo (`EXTERNAL_SELLER`):** Creación de clientes y pedidos, descuentos en **Soles por unidad (`S/`)**, registro de cobros/abonos y gastos de ruta (`ROUTE_OPEX`). **El servidor jamás envía costos de compra ni márgenes.**
   - **Almacén y Reparto (`WAREHOUSE_DELIVERY`):** Cola operativa de alistamiento y entrega (`Por Alistar -> En Alistamiento -> Listo -> En Ruta -> Entregado`). **El servidor jamás envía precios, descuentos, totales ni deudas.**
   - **Autenticación:** La identidad se valida mediante **Neon Auth (`@neon/auth`)** con correo verificado vinculado a `erp.app_users.neon_auth_user_id`.

2. **Cuidado Automático de Márgenes y Descuentos en Soles por Unidad:**
   - Descuentos en Soles por producto (`unit_discount_pen`), nunca en porcentaje.
   - Si el vendedor aplica un descuento que deja el precio por debajo de `min_sale_price_pen`, el pedido queda retenido en `PENDING_PARTNER_APPROVAL` hasta que un Socio lo apruebe con 1 toque desde su celular.

3. **Cobranzas, Amortizaciones Parciales (`Abonos`), Fecha Pactada de Cobro (1 toque) y Lista de Deudores:**
   - Botones rápidos de 1 toque al vender a crédito o al registrar un abono parcial: **`[Mañana (+1d)]`**, **`[En 3 días]`**, **`[En 7 días]`**, **`[En 10 días]`**, **`[En 15 días (2 sem)]`**.
   - Filtros de Agenda de Ruta: **🔥 Toca Cobrar Hoy/Mañana**, **🚨 Promesa Vencida** y **📅 En Plazo**, más semáforo de antigüedad (`0-7d`, `8-29d`, `30+d`) y línea de tiempo de pagos (`qué día dio cuánto y quién lo cobró`).

4. **Proveedores Genéricos, Compras, Cierre Automático `ON_DEMAND` y Pagos CxP (`/socios` Pestaña 4):**
   - **Alta rápida de Proveedores (`+ Nuevo Proveedor`):** Registro genérico en `erp.parties` con validación de RUC/DNI duplicado (`POST /api/purchases`, `action: "create_supplier"`).
   - **Registro de Compras / Ingreso de Mercadería (`+ Registrar Compra / Ingreso de Mercadería`):** Soporta `FACTURA`, `NOTA_VENTA`, `BOLETA` y `RECIBO` al contado (`CASH`), crédito (`CREDIT`) o pago parcial (`PARTIAL`), incrementa inventario en almacén `MAIN`, actualiza `ref_cost_pen` y genera automáticamente deuda en `erp.ap_obligations` por el saldo pendiente.
   - **Cierre simultáneo de alertas `ON_DEMAND`:** Al seleccionar productos en una compra, la UI muestra automáticamente las líneas de pedidos de cliente en estado `PENDING_SUPPLIER_PURCHASE` (`ON_DEMAND`) para vincularlas (`fulfillOrderLineIds`) y resolver la alerta al instante.
   - **Resumen por Proveedor y Pagos/Amortizaciones CxP (`+ Registrar Pago / Amortizar`):** Lista filtrable (`OPEN`, `PARTIAL`, `PAID`, por proveedor) conectada a `POST /api/purchases` (`action: "pay_ap_obligation"`) con selector de cuenta (`CAJA_RUTA`, `INTERBANK_BHT`, `YAPE_PLIN_BHT`, `BCP_BHT`, `CUSTODIA_SAMUEL`).
   - **Tesorería y Egresos (`POST /api/treasury`):** Registro de `ROUTE_OPEX`, `MERCHANDISE_PAYMENT` y `NON_OPEX_OR_CAPEX` junto con el historial reciente de `erp.cash_ledger`.

5. **Business Intelligence ($0 Costo Extra), Reportes Excel/CSV y Gestión de Equipo (`/socios`):**
   - **Conciliación Visual Integral de Efectivo:** Muestra ventas, cobros, cuentas por cobrar dinámicas, compra de mercadería, OpEx de ruta, drenaje no-OpEx, depósitos bancarios internos y la **Inversión Inicial Pre-Ruta (Jun 23–25: camión + hospedaje + comisión)**.
   - **Tableros BI (`GET /api/partners` y `/api/reports?dataset=bi_summary`):** Comparativo mensual con barras visuales CSS/Tailwind, saldos por caja/banco (`cashAccountsSummary`), Top 15 clientes (`topCustomers`), alertas de reposición de stock bajo (`<= 5` unidades `STOCKED` con enlace rápido a compra) y SKUs con margen `< 20%` o sin costo (`marginRiskSkus`).
   - **Centro de Exportación Excel / CSV (1 toque, UTF-8 BOM):** Descarga directa desde `/api/reports?dataset=<nombre>&format=csv` para:
     - `ventas_pedidos` (Ventas y Pedidos)
     - `deudores_cartera` (Cartera de Deudores)
     - `margen_productos` (Stock, Costos y Márgenes)
     - `flujo_caja_egresos` (Flujo de Caja y Egresos)
     - `proveedores_cxp` (Cuentas por Pagar Proveedores)
   - **Gestión de Equipo y Accesos (solo `PARTNER_ADMIN`):** Alta, asignación de roles y activación/desactivación de usuarios (`toggle_user_active`) vinculados a Neon Auth desde `/socios`.

## Comandos

```bash
# Formato, lint y verificación de tipos
npm run format:check
npm run lint
npm run typecheck

# Compilar para producción y verificar presupuesto de bundles
npm run build
npm run bundles:check

# Ejecutar suite unitaria y de contratos (sin credenciales de DB)
npm run test:ci

# Levantar servidor local (http://localhost:3000)
npm run dev
```
