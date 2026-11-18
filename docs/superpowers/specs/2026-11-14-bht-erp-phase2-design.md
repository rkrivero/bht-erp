# Diseño de Fase 2: Aplicación Web Mobile-First del ERP Ligero (`bht_neon`)

- **Fecha:** 2026-11-14
- **Repositorio de Aplicación (Fase 2):** `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon`
- **Repositorio de Base de Datos y Migraciones (Fase 1):** `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_data`
- **Base de Datos Neon (Postgres 17):** Proyecto `bht-erp` (`curly-dream-92145694`, ramas `dev` y `main`, base `bht_erp`)

---

## 1. Intención y el "Por Qué" (Intent & Why)

**Blue Horizon Trade S.A.C.** (`RUC 20614786851`) es una distribuidora mayorista y de venta directa en ruta que opera en Soles peruanos (`PEN`). Los pedidos entran por llamada o WhatsApp, se registran, pasan a almacén para alistarse, salen en movilidad propia (chofer y estibador) y se cobran contra entrega o a crédito.

El diagnóstico de la Fase 1 sobre los archivos históricos (`2026-06-26` a `2026-09-29`) demostró por qué las hojas de Excel generaban fugas de dinero y descontrol:

- **67.6%** de las líneas de venta (`97` órdenes por **S/ 248,981.10**) tenían el estado de cobro en blanco.
- En septiembre dejaron de anotarse los gastos operativos de ruta en el Excel diario.
- En julio y agosto los gastos de ruta se mezclaban con compras de mercadería y retiros/compra de activos (**36.15%** de drenaje No-OpEx sobre salidas).
- **74 SKUs** se vendieron con margen bruto menor al 20% (incluyendo ventas por debajo del costo real) por no existir un piso de precio mínimo controlado al tomar el pedido.
- Nombres libres de productos y clientes, columnas `CANTIDAD`/`PRECIO` invertidas y ausencia de trazabilidad sobre quién tomó el pedido, quién lo armó, quién lo entregó y quién cobró el dinero.

**Propósito de la Fase 2:** Construir la aplicación operativa y gerencial del ERP ligero sobre la base Neon ya desplegada en `main`, diseñada **90% para celular (10 horas diarias en ruta y almacén)** y **10% para PC (2 horas diarias donde los 2 Socios revisan márgenes, caja, alertas e insights)**, aislando estrictamente la información financiera según el rol de cada empleado.

---

## 2. Objetivos, No-Objetivos y Anti-Objetivos

### Objetivos (Goals)

1. **Operación 100% móvil para campo y almacén + Panel ancho en PC para Socios:** Interfaz táctil rápida (PWA instalable en pantalla de inicio) para tomar pedidos, alistar en almacén, despachar en ruta, cobrar y anotar gastos desde el celular, más vista gerencial de escritorio para los Socios.
2. **Aislamiento financiero estricto en servidor por Rol (4 roles):**
   - El personal de **Almacén y Reparto** jamás recibe precios, descuentos, costos, totales ni deudas (ni en pantalla ni en el JSON de red).
   - El **Vendedor Externo** ve precios de venta, topes de descuento en Soles y saldos por cobrar de clientes, pero jamás recibe costos de compra (`ref_cost_pen`) ni márgenes reales.
   - Los dos **Socios** tienen visibilidad total de costos, márgenes por línea/pedido, caja y KPIs.
3. **Cuidado automático de márgenes con descuentos en Soles enteros por unidad:**
   - Cada producto maneja: `ref_cost_pen` (solo Socios), `list_sale_price_pen` (precio normal) y `min_sale_price_pen` (precio mínimo permitido).
   - Los descuentos se ingresan **por línea de producto en Soles por unidad** (ej. Precio Normal `S/ 25.00`, Descuento `- S/ 1.00` = Precio Final `S/ 24.00`), nunca en porcentaje ni al total global.
   - Si el Vendedor Externo ingresa un precio final menor a `min_sale_price_pen`, el pedido no se pierde ni pasa a almacén: se guarda en estado **`PENDING_PARTNER_APPROVAL` ("Pendiente de aprobación de Socio")** para que cualquiera de los dos Socios lo apruebe o rechace con 1 toque desde su celular.
4. **Trazabilidad separada de los 4 responsables con fecha y hora:**
   - Quién registró el pedido (`created_by_user_id` + `created_at`).
   - Quién lo alistó en almacén (`picked_by_user_id` + `picked_at`).
   - Quién lo repartió/entregó (`delivered_by_user_id` + `delivered_at`).
   - Quién cobró el dinero (`collected_by_user_id` + `collected_at` en cada cobro `erp.ar_payments`).
5. **Control real de stock (`STOCKED` vs. `ON_DEMAND`) desde la confirmación del pedido:**
   - El stock de productos `STOCKED` se descuenta/reserva inmediatamente al confirmar el pedido (o al aprobarlo el Socio si estaba en `PENDING_PARTNER_APPROVAL`), evitando doble venta simultánea entre el Socio Operativo y el Vendedor Externo. Si el pedido se anula, un movimiento inverso (`RETURN_IN`) restaura el stock automáticamente.
   - En productos `ON_DEMAND` sin stock, Almacén ve la etiqueta **`POR RECOGER DE PROVEEDOR`** (sin montos) y los Socios ven la alerta operativa en su bandeja de **Compras bajo pedido pendientes** hasta enlazar la factura/compra del proveedor.
6. **Puesta a punto Día 1 de Inventario Físico:** Pantalla exclusiva para Socios con acción auditada para llevar a `0` los 93 saldos negativos históricos (`RESET_HISTORICAL_DEFICIT`) y digitar rápidamente desde el celular el conteo físico real de almacén.
7. **Registro limpio de Gastos de Ruta, Compras y Tesorería:** El Vendedor Externo solo puede registrar **Gastos de Ruta** (`ROUTE_OPEX`: combustible, peaje, almuerzo, estibador) contra su caja de ruta; los Socios registran compras de mercadería (`MERCHANDISE_PAYMENT`), pagos a proveedores (`erp.ap_obligations`), gastos de ruta, depósitos bancarios (`is_internal_transfer`) y retiros/activos (`NON_OPEX_OR_CAPEX`).

### No-Objetivos (Non-Goals)

- **Sin facturación electrónica ni conexión a SUNAT:** El sistema es exclusivamente de control interno operativo y financiero. Puede guardar el número de documento referencial (`doc_ref` ej. `F001-...` o `NV-...`), pero no timbra XML ni conecta con OSE/SUNAT.
- **Sin contabilidad tributaria formal (Libros Electrónicos PLE/SIRE):** El foco es caja real, márgenes reales, stock físico, cuentas por cobrar (`AR`), cuentas por pagar (`AP`) y desempeño operativo.
- **Sin e-commerce público para clientes finales:** Los pedidos los ingresan los usuarios internos (Socios y Vendedor Externo) al recibir llamadas o mensajes de WhatsApp.

### Anti-Objetivos (Anti-Goals — Qué haría fracasar el proyecto aunque funcione técnicamente)

- **Fuga de costos o precios en el navegador:** Ocultar costos o precios solo con CSS (`display: none`) en el cliente. Un empleado curioso o una captura accidental jamás debe exponer costos al Vendedor ni precios/deudas a Almacén. Todo filtrado es **server-side**.
- **Formularios lentos de escritorio en el celular:** Pantallas que obliguen a hacer zoom horizontal, escribir porcentajes de descuento o llenar 15 campos obligatorios para tomar un pedido en la calle.
- **Permitir estados de pago ambiguos o en blanco:** Ningún pedido puede crearse sin definir su condición (`CONTADO / CONTRA ENTREGA` vs. `CRÉDITO`) ni quedar cobrado sin especificar quién cobró, en qué medio (`CASH`, `YAPE_PLIN`, `TRANSFER`) y a qué cuenta/caja ingresó.

---

## 3. Restricciones (Constraints)

1. **Separación de repositorios:**
   - Toda la aplicación web/móvil vive en `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_neon`.
   - Cualquier migración SQL adicional para soportar usuarios, roles, estados de alistamiento y precios mínimos se versiona en `/Users/rivero/Documents/Blue_Horizon_Trade/Trade/bht_data/db/migrations/006_erp_phase2_workflow_and_rbac.sql` y se aplica primero en Neon `dev` y luego en `main` mediante `bht-etl migrate`.
2. **Moneda única operativa:** Soles peruanos (`PEN`, `S/`). Si un Socio registra una factura de compra en `USD`, ingresa el `T/C` y el sistema guarda el desembolso consolidado en `PEN` igual que en la Fase 1.
3. **Entorno de ejecución local:** `Node v22.22.3` y `npm 10.9.8` verificados en el equipo del usuario.
4. **Seguridad de credenciales:** `DATABASE_URL` se lee exclusivamente desde variables de entorno del servidor (`.env.local` ignorado por Git); el cliente navegador nunca se conecta directo a Postgres.

---

## 4. Enfoques Considerados (Approaches)

### Enfoque A (Elegido por el Usuario): Monolito Full-Stack Mobile-First con Next.js App Router + TypeScript + Tailwind CSS + SQL Server-Side sobre Neon Postgres (PWA)

- **Cómo funciona:** Una sola aplicación en `bht_neon` usando Next.js (App Router), Server Components y Server Actions / Route Handlers conectados a Neon Postgres (`bht_erp`). Autenticación propia ligera basada en `erp.app_users` (usuario + PIN/contraseña con hash `scrypt`/`bcrypt` y cookie `HTTP-only` firmada con `HMAC-SHA256`).
- **Ventajas:**
  - Garantiza aislamiento financiero real en el servidor: cada consulta devuelve únicamente las columnas autorizadas para el rol de la sesión activa.
  - Experiencia móvil inmediata (barra inferior de navegación para el pulgar, instalable como PWA en Android/iOS) y diseño adaptable a pantalla ancha en PC para los Socios.
  - Cero duplicación de servidores: un solo comando para correr o desplegar.
- **Trade-off:** Requiere disciplinar todas las mutaciones a través de capa de servidor autorizada por rol (lo cual haremos mediante helpers centrales `requireRole(...)`).

### Enfoque B (Descartado): Frontend React (Vite) separado + Backend API en FastAPI / Hono

- **Trade-off:** Obliga a levantar, configurar CORS y desplegar dos servicios separados para 6 usuarios sin aportar ninguna ventaja funcional.

### Enfoque C (Descartado): App Móvil Nativa (React Native / Expo) + Panel Web separado

- **Trade-off:** Duplica el código entre móvil y PC y complica distribuir actualizaciones rápidas al equipo de ruta y almacén.

---

## 5. Diseño Detallado (Lo Acordado con el Usuario)

### 5.1. Roles, Permisos y Vistas por Puesto

| Capacidad / Dato                                                                | 1. Socio Operativo y Admin (`PARTNER_ADMIN`) |       2. Socio Gerente (`PARTNER_MANAGER`)       | 3. Vendedor Externo (`EXTERNAL_SELLER`) | 4. Almacén y Reparto (`WAREHOUSE_DELIVERY`) |
| :------------------------------------------------------------------------------ | :------------------------------------------: | :----------------------------------------------: | :-------------------------------------: | :-----------------------------------------: |
| **Ver costos de compra (`ref_cost_pen`) y márgenes (`S/` y `%`)**               |                      Sí                      |                        Sí                        |    **NO (Jamás sale del servidor)**     |      **NO (Jamás sale del servidor)**       |
| **Ver precios de venta, descuentos y totales en `S/`**                          |                      Sí                      |                        Sí                        |                   Sí                    |      **NO (Jamás sale del servidor)**       |
| **Ver deudas de clientes (`AR`) y registrar cobros**                            |                      Sí                      |                        Sí                        |                   Sí                    |                   **NO**                    |
| **Crear clientes y tomar pedidos**                                              |                      Sí                      |                        Sí                        |                   Sí                    |                   **NO**                    |
| **Aplicar descuento en `S/` por unidad hasta `min_sale_price_pen`**             |                Sí (sin tope)                 |                  Sí (sin tope)                   |           Sí (hasta el tope)            |                   **NO**                    |
| **Guardar pedido bajo el precio mínimo (`PENDING_PARTNER_APPROVAL`)**           |               Aprueba directo                |                 Aprueba directo                  |           Solicita aprobación           |                   **NO**                    |
| **Aprobar con 1 toque pedidos bajo el precio mínimo**                           |                      Sí                      |                        Sí                        |                 **NO**                  |                   **NO**                    |
| **Actualizar avance (`En alistamiento -> Listo -> En ruta -> Entregado`)**      |                      Sí                      |                        Sí                        |         Solo lectura de avance          |         **Sí (su vista principal)**         |
| **Registrar Gastos de Ruta (`ROUTE_OPEX`)**                                     |                      Sí                      |                        Sí                        |         Sí (de su caja de ruta)         |                   **NO**                    |
| **Registrar Compras, Pagos a Proveedor (`AP`), Depósitos y Retiros**            |                      Sí                      |                        Sí                        |                 **NO**                  |                   **NO**                    |
| **Toma de Inventario / Ajuste de Stock y Gestión de Catálogo/Precios/Usuarios** |              Sí (Acceso total)               | Sí (consulta y apoyo; edición completa opcional) |                 **NO**                  |                   **NO**                    |

_(Decisión del diseñador: Ambos Socios comparten los permisos de aprobación y consulta total; `PARTNER_ADMIN` tiene además la administración de usuarios y ajustes maestros, aunque `PARTNER_MANAGER` también puede aprobar descuentos y apoyar en operación)._

---

### 5.2. Extensión del Esquema en Neon (`006_erp_phase2_workflow_and_rbac.sql`)

Sobre el esquema `erp` existente en `bht-erp`, agregaremos una migración limpia y retrocompatible:

1. **Tabla de Usuarios del Sistema (`erp.app_users`):**
   - `user_id BIGSERIAL PRIMARY KEY`
   - `username TEXT NOT NULL UNIQUE` (ej. `socio_admin`, `socio_gerente`, `vendedor1`, `almacen1`, `reparto1`)
   - `full_name TEXT NOT NULL`
   - `role TEXT NOT NULL CHECK (role IN ('PARTNER_ADMIN', 'PARTNER_MANAGER', 'EXTERNAL_SELLER', 'WAREHOUSE_DELIVERY'))`
   - `pin_hash TEXT NOT NULL` (hash seguro para ingreso rápido desde celular)
   - `default_cash_account_id BIGINT REFERENCES erp.cash_accounts(account_id)`
   - `is_active BOOLEAN NOT NULL DEFAULT TRUE`
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

2. **Precio Mínimo Permitido en `erp.products`:**
   - Agregar columna `min_sale_price_pen NUMERIC(12,4) CHECK (min_sale_price_pen IS NULL OR min_sale_price_pen >= 0)`.
   - **Inicialización automática aprobada:** `UPDATE erp.products SET min_sale_price_pen = list_sale_price_pen WHERE min_sale_price_pen IS NULL AND list_sale_price_pen IS NOT NULL;` (para que por defecto ningún producto admita descuento libre del vendedor hasta que el Socio Operativo baje el piso en Soles en los productos que desee).

3. **Descuento en Soles por Unidad en `erp.sales_order_lines`:**
   - Agregar `base_unit_price_pen NUMERIC(12,4)` (precio lista al momento del pedido).
   - Agregar `unit_discount_pen NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (unit_discount_pen >= 0)` (descuento en Soles por unidad; ej. `1.00` o `2.00`).
   - `unit_price_pen` sigue siendo el precio unitario final efectivo (`base_unit_price_pen - unit_discount_pen`), manteniendo intacta la restricción `chk_line_math` (`ABS((quantity * unit_price_pen) - line_total_pen) <= 0.05`).
   - Agregar `below_min_price_flag BOOLEAN NOT NULL DEFAULT FALSE`.

4. **Flujo Operativo y Trazabilidad de 4 Responsables en `erp.sales_orders` y `erp.ar_payments`:**
   - Nuevo enum `erp.order_operational_status`:
     - `'PENDING_PARTNER_APPROVAL'` (Vendedor aplicó un descuento que deja algún ítem por debajo de `min_sale_price_pen`; oculto para Almacén y sin descontar stock hasta que un Socio apruebe).
     - `'REGISTERED'` (Confirmado; visible para Almacén para empezar a armar; stock `STOCKED` ya reservado/descontado).
     - `'PICKING'` (En alistamiento en almacén).
     - `'READY'` (Listo en almacén para cargar a movilidad).
     - `'IN_ROUTE'` (En ruta con chofer/estibador).
     - `'DELIVERED'` (Entregado al cliente).
     - `'CANCELLED'` (Anulado; revierte stock automáticamente).
   - Columnas de trazabilidad en `erp.sales_orders`:
     - `operational_status erp.order_operational_status NOT NULL DEFAULT 'REGISTERED'` (las 152 órdenes históricas quedan en `'DELIVERED'`).
     - `created_by_user_id BIGINT REFERENCES erp.app_users(user_id)` + `created_at` (quién registró el pedido y cuándo).
     - `approved_by_user_id BIGINT REFERENCES erp.app_users(user_id)` + `approved_at TIMESTAMPTZ` (si requirió aprobación de descuento de Socio).
     - `picked_by_user_id BIGINT REFERENCES erp.app_users(user_id)` + `picked_at TIMESTAMPTZ` (quién lo alistó en almacén y cuándo).
     - `delivered_by_user_id BIGINT REFERENCES erp.app_users(user_id)` + `delivered_at TIMESTAMPTZ` (quién lo repartió/entregó y cuándo).
     - `promised_payment_date DATE` (fecha pactada de cobro para pedidos a crédito; elegida con botones de 1 toque `+1d`, `+3d`, `+7d` por defecto, `+10d`, `+15d`, y actualizable al registrar abonos parciales).
   - Columna de trazabilidad de cobranza en `erp.ar_payments`:
     - `collected_by_user_id BIGINT REFERENCES erp.app_users(user_id)` (quién cobró y registró el pago, con `created_at` y `payment_date`).
   - Tabla de historial de eventos del pedido (`erp.sales_order_events`) para auditoría completa de cada cambio de estado con `order_id`, `from_status`, `to_status`, `actor_user_id`, `notes` y `created_at`.

---

### 5.3. Flujos Principales en Pantalla (Mobile-First 10h/día + PC 2h/día)

```
+-----------------------------------------------------------------------------------+
| FLUJO DEL PEDIDO Y TRAZABILIDAD DE 4 RESPONSABLES                                 |
+-----------------------------------------------------------------------------------+
|                                                                                   |
| [1. Vendedor / Socio: Toma Pedido en Celular]                                     |
|    - Elige cliente (o crea rápido) + condición (Contra Entrega / Crédito)         |
|    - Agrega productos: ve stock disponible y etiqueta [STOCK] u [ON_DEMAND]       |
|    - Si aplica descuento: resta S/ enteros por unidad (ej. -S/ 1, -S/ 2)          |
|           |                                                                       |
|           +---> ¿Algún ítem quedó < min_sale_price_pen (siendo Vendedor)?         |
|                    |-- SÍ --> Estado: [PENDIENTE APROBACIÓN SOCIO]                |
|                    |          (Socio aprueba con 1 toque en su celular)           |
|                    |-- NO --> Estado: [REGISTRADO]                                |
|                               - Descuenta/reserva stock de ítems STOCKED          |
|                               - Ítems ON_DEMAND sin stock -> Alerta Compra Socio  |
|                               - Guarda: created_by_user_id + fecha/hora           |
|                                        |                                          |
|                                        v                                          |
| [2. Almacén (Celular - CERO PRECIOS / CERO MONTOS)]                               |
|    - Ve cola de pedidos [REGISTRADO]: Cliente, Destino, Productos y Cantidades    |
|    - Ítems ON_DEMAND sin stock muestran insignia: [POR RECOGER DE PROVEEDOR]      |
|    - Toca [Empezar Alistamiento] -> Estado: [EN ALISTAMIENTO]                     |
|    - Toca [Pedido Listo]         -> Estado: [LISTO]                               |
|                                     Guarda: picked_by_user_id + picked_at         |
|                                        |                                          |
|                                        v                                          |
| [3. Reparto (Celular - CERO PRECIOS / CERO MONTOS)]                               |
|    - Toca [Salir a Ruta]         -> Estado: [EN RUTA]                             |
|    - Al dejar mercadería toca [Entregado] -> Estado: [ENTREGADO]                  |
|                                     Guarda: delivered_by_user_id + delivered_at   |
|                                        |                                          |
|                                        v                                          |
| [4. Cobranza (Celular Vendedor / Socio - Cola "Por Cobrar")]                      |
|    - Registra cobro total o abono parcial (Efectivo / Yape-Plin / Transferencia)  |
|    - Guarda: collected_by_user_id + fecha/hora + actualiza saldo e ingresa a Caja |
+-----------------------------------------------------------------------------------+
```

#### Pantallas Específicas por Rol

1. **Vista de Almacén y Reparto (`WAREHOUSE_DELIVERY`):**
   - Solo tiene **1 pantalla dividida en pestañas táctiles**: `Por Alistar`, `En Alistamiento`, `Listos para Salir`, `En Ruta`, `Entregados Hoy`.
   - Cada tarjeta muestra: `# Pedido`, `Hora`, `Cliente`, `Zona/Dirección`, lista de `Cantidad + Unidad + Producto` (con casillas de verificación para ir marcando mientras arman el pedido) y el botón gigante de siguiente paso (`Pasar a En Alistamiento` -> `Marcar Listo` -> `Salir a Ruta` -> `Confirmar Entrega`).
   - **No existe ningún campo de precio, descuento, total ni deuda en toda su interfaz ni en el endpoint del servidor.**

2. **Vista de Vendedor Externo (`EXTERNAL_SELLER`):**
   - Barra inferior móvil con 4 pestañas:
     - `Nuevo Pedido`: Buscador rápido de cliente y buscador instantáneo de productos (muestra stock actual, precio normal, precio mínimo permitido y botones `+ / -` de descuento en Soles por unidad). Muestra aviso claro si un descuento rebasa el piso y requerirá aprobación del Socio.
     - `Mis Pedidos`: Seguimiento en vivo de en qué etapa va cada pedido (`Pendiente Aprobación`, `En Alistamiento`, `Listo`, `En Ruta`, `Entregado`) y quién lo tiene en almacén/reparto.
     - `Cobros (Cartera y Deudores)`: Lista de deudores con días de antigüedad, pedidos contra entrega por cobrar y registro de pagos totales o amortizaciones parciales (abonos) con historial por fecha.
     - `Gastos de Ruta`: Formulario de 3 segundos para anotar `Combustible`, `Peaje`, `Almuerzo/Viáticos` o `Estibador` en Soles.

3. **Vista de Socios (`PARTNER_ADMIN` y `PARTNER_MANAGER` — Móvil y PC):**
   - **Torre de Control en Vivo (Inicio):**
     - **Bandeja de Aprobación de Descuentos (1 toque):** Pedidos del vendedor que bajaron del precio mínimo, mostrando a los Socios el **Costo Real**, el **Margen en Soles (`S/`)** y el **Margen `%`** que quedaría si aprueban.
     - **Bandeja de Compras `ON_DEMAND` Pendientes:** Ítems vendidos bajo pedido que requieren compra/recojo del proveedor (`analytics.v_pending_on_demand_orders`).
     - **Monitor de Pedidos del Día en Tiempo Real:** Tabla/tarjetas con los 4 responsables y sus horas exactas (`Tomó: Vendedor 08:15` | `Alistó: Juan 08:40` | `Repartió: Pedro 09:30` | `Cobró: Socio 09:45`), más utilidad neta real en Soles de cada pedido.
   - **Toma de Inventario y Catálogo (Día 1 + Gestión continua):**
     - Botón auditado **`Poner en 0 saldos negativos históricos (93 SKUs)`** (inserta movimientos `ADJUSTMENT` con nota `RESET_HISTORICAL_DEFICIT` para todos los productos con stock `< 0`).
     - Buscador rápido en celular para digitar el **Stock Físico Real**, **Costo Real (`S/`)**, **Precio Normal (`S/`)**, **Precio Mínimo Permitido (`S/`)** y cambiar entre `STOCKED` y `ON_DEMAND`.
   - **Caja, Compras y Cuentas por Pagar (`AP`):**
     - Registro de facturas de compra de proveedores (con actualización automática de stock y vínculo opcional a líneas `ON_DEMAND`), amortización de deudas con proveedores (ej. Qingdao) y registro de depósitos bancarios o retiros de socios.
   - **Panel de Insights y 7 KPIs (Optimizado para las 2h en PC):**
     - Visualización directa de `v_kpi_cash_and_reinvestment` (P1), `v_kpi_sku_margin_and_opex` (P2), `v_kpi_ar_customers_and_quotes` (P3) y `v_data_quality_gaps`.

---

### 5.4. Lógica Detallada de Pagos, Amortizaciones (Abonos) y Lista de Deudores

La base de datos en Neon ya cuenta con la tabla `erp.ar_payments` y el trigger automático `fn_sync_ar_payment_to_order()`, que recalcula al instante `paid_pen` (total abonado), `balance_due_pen` (saldo pendiente) e `is_settled` (cancelado sí/no) en `erp.sales_orders`. Sobre esa base, la aplicación operará así:

1. **Tres modalidades de pago en el flujo diario:**
   - **Contado / Contra Entrega (Pago Total):** Con 1 toque en `Cobrar Total (S/ XXX)`, registra el 100% del importe, marca el pedido como **Cancelado (`is_settled = TRUE`)** e ingresa el dinero a la caja/banco elegido.
   - **Crédito con Adelanto Inicial (da una parte el mismo día):** Al registrar o entregar un pedido a crédito (ej. total `S/ 1,000`), permite digitar opcionalmente un **`Adelanto inicial: S/ 500`**. El sistema guarda ese primer abono con la fecha y hora exacta de hoy y deja el pedido abierto en cartera con **`Abonado: S/ 500 | Saldo Debe: S/ 500`**.
   - **Crédito con Amortizaciones Posteriores (paga en varias partes en distintos días):** Cada vez que el cliente entrega un abono parcial (la mitad un día, otra parte la semana siguiente), el Vendedor o Socio toca **`+ Registrar Abono`**, ingresa el monto en Soles (`S/`), el medio (`Efectivo`, `Yape/Plin`, `Transferencia`) y la cuenta destino.
   - **Abono General por Cliente (FIFO automático):** Si un cliente debe 2 o 3 pedidos distintos y entrega un monto global (ej. `S/ 1,500`), el usuario puede elegir si lo aplica a un pedido específico o como **"Abono a deuda general del cliente"**, repartiendo automáticamente el pago desde el pedido más antiguo hasta el más reciente.

2. **Historial de Amortizaciones (Bitácora de "Qué día dio cuánto"):**
   - Al tocar cualquier pedido a crédito o cliente deudor, se despliega la línea de tiempo exacta de abonos tomados de `erp.ar_payments`:
     - _Ejemplo:_
       - `14/11/2026 09:30` — **Abonó S/ 500.00** (`Efectivo` · Cobró: `Vendedor`)
       - `18/11/2026 15:10` — **Abonó S/ 300.00** (`Yape/Plin` · Cobró: `Socio Operativo`)
       - **Total Venta:** `S/ 1,000.00` | **Total Abonado:** `S/ 800.00` | **Saldo Pendiente:** `S/ 200.00`

3. **Lista de Deudores con Días de Antigüedad y Semáforo de Cobranza:**
   - Visible para **Socios** y **Vendedor Externo** (oculta para Almacén/Reparto), con buscador y dos vistas:
     - **Vista 1 — Ranking de Clientes Deudores:** Agrupa por cliente cuánto debe en total (`SUM(balance_due_pen)`), cuántos pedidos tiene abiertos, fecha de su último abono, botón directo a llamada/WhatsApp y **Días de deuda acumulados** (`CURRENT_DATE - MIN(order_date)` del pedido más antiguo sin cancelar).
     - **Vista 2 — Pedidos Pendientes de Cobro:** Lista cada pedido con su fecha de venta, días transcurridos (`Hace X días`), monto original, monto ya amortizado (`paid_pen`), saldo que falta (`balance_due_pen`) y quién tomó la venta.
   - **Semáforo automático por días de antigüedad y Agenda de Cobro (`promised_payment_date`):**
     - **Botones rápidos de 1 toque al vender a Crédito o al registrar un Abono parcial:** `[Mañana (+1d)]`, `[En 3 días]`, `[En 7 días (por defecto)]`, `[En 10 días]`, `[En 15 días (2 sem)]` o fecha personalizada, sin obligar a abrir un calendario.
     - **Filtros de Agenda de Ruta (`promise_status`):**
       - **🔥 Toca Cobrar Hoy / Mañana (`DUE_TODAY_OR_TOMORROW`):** `promised_payment_date IN (CURRENT_DATE, CURRENT_DATE + 1)`.
       - **🚨 Promesa Vencida (`PROMISE_BROKEN`):** `promised_payment_date < CURRENT_DATE`.
       - **📅 En Plazo (`ON_SCHEDULE`):** `promised_payment_date > CURRENT_DATE + 1`.
     - **Verde (`0 a 7 días`):** Crédito reciente.
     - **Ámbar (`8 a 29 días`):** En seguimiento (prioridad de cobro en ruta).
     - **Rojo (`30+ días — Vencido`):** Alerta crítica de morosidad (incluye desde el primer día los **12 pedidos históricos pendientes por S/ 45,525.00** cargados de julio, agosto y septiembre para que puedan ir amortizándolos o cerrándolos en la app).

---

## 6. Lo Que Queda a Criterio del Implementador (What's Left to the Builder)

Las siguientes decisiones menores de implementación quedan a cargo del constructor sin necesidad de volver a preguntar:

- Estructura exacta de carpetas dentro de `bht_neon/src/` (`app/`, `lib/`, `components/`).
- Paleta visual y componentes Tailwind (usando alto contraste para lectura bajo luz de sol en ruta, botones de mínimo `44px` de alto en móvil y tablas densas en `lg:` para PC).
- Usuarios semilla iniciales en `erp.app_users` (se crearán cuentas listas para usar para `Socio Operativo`, `Socio Gerente`, `Vendedor Externo`, `Almacén 1` y `Reparto 1`, con PINs iniciales documentados y editables desde la pantalla de Usuarios).
- Detalles de formato de fecha/hora en zona horaria de Perú (`America/Lima`, `dd/MM/yyyy HH:mm`).
