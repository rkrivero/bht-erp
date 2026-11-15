# BHT ERP Ligero (`bht_neon` — Fase 2)

Aplicación web y móvil (**10h/día en celular + 2h/día en PC**) conectada a **Neon PostgreSQL 17 (`bht-erp`)** para la gestión operativa, comercial, de almacén/reparto, cobranzas y tesorería de **Blue Horizon Trade** en Soles peruanos (`PEN`, `S/`).

## Características Principales

1. **Separación Estricta de Datos Financieros por Rol (Server-Side RBAC):**
   - **Socio Operativo y Admin (`socio_admin`, PIN inicial `1111`):** Acceso total a ventas, cobranzas, costos reales, márgenes, catálogo, stock físico y usuarios.
   - **Socio Gerente (`socio_gerente`, PIN inicial `2222`):** Torre de control en tiempo real (4 responsables con fecha/hora), aprobación de descuentos en 1 toque, costos/márgenes y dashboard de 7 KPIs.
   - **Vendedor Externo (`vendedor1`, PIN inicial `3333`):** Creación de clientes y pedidos, descuentos en **Soles por unidad (`S/`)**, registro de cobros/abonos y gastos de ruta (`ROUTE_OPEX`). **El servidor jamás envía costos de compra ni márgenes.**
   - **Almacén y Reparto (`almacen1` PIN `4444` / `reparto1` PIN `5555`):** Cola operativa de alistamiento y entrega (`Por Alistar -> En Alistamiento -> Listo -> En Ruta -> Entregado`). **El servidor jamás envía precios, descuentos, totales ni deudas.**

2. **Cuidado Automático de Márgenes y Descuentos en Soles por Unidad:**
   - Descuentos en Soles por producto (`unit_discount_pen`), nunca en porcentaje.
   - Si el vendedor aplica un descuento que deja el precio por debajo de `min_sale_price_pen`, el pedido queda retenido en `PENDING_PARTNER_APPROVAL` hasta que un Socio lo apruebe con 1 toque desde su celular.

3. **Cobranzas, Amortizaciones Parciales (`Abonos`), Fecha Pactada de Cobro (1 toque) y Lista de Deudores:**
   - Botones rápidos de 1 toque al vender a crédito o al registrar un abono parcial: **`[Mañana (+1d)]`**, **`[En 3 días]`**, **`[En 7 días]`**, **`[En 10 días]`**, **`[En 15 días (2 sem)]`**.
   - Filtros de Agenda de Ruta: **🔥 Toca Cobrar Hoy/Mañana**, **🚨 Promesa Vencida** y **📅 En Plazo**, más semáforo de antigüedad (`0-7d`, `8-29d`, `30+d`) y línea de tiempo de pagos (`qué día dio cuánto y quién lo cobró`).

## Comandos

```bash
# Ejecutar suite de pruebas transaccionales y RBAC (Vitest)
npm test

# Compilar para producción
npm run build

# Levantar servidor local (http://localhost:3000)
npm run dev
```
