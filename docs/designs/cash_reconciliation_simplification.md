# Simplificación de Caja, Cuentas y Cierre Diario (BHT ERP)

- **Author:** Renzo Rivero
- **Status:** Proposed (Reviewed)
- **Date:** 2026-11-22

---

## Overview

Este diseño simplifica los módulos **`Hoy`** y **`Caja`** de `bht_neon` (manteniendo compatibilidad con los scripts de carga y migraciones de `bht_data`) para alinear el ERP con la operación diaria real del negocio: priorizar el flujo de caja del día y del mes, consolidar las cuentas activas en exactamente **3 cuentas** (`Caja General`, `Cuenta BCP`, `Cuenta Interbank`), eliminar avisos permanentes por extractos históricos faltantes y volver opcional el conteo físico/bancario en el **Cierre del día**.

---

## The Problem

En la base de datos de producción en Neon (`bht_erp`, usada por `bht_neon`), cuatro fricciones actuales hacen confuso el control diario de dinero:

1. **Aviso permanente de `"Pendiente de conciliar"` / `"No conciliado"`:** Las tarjetas de `Hoy` y `Caja` muestran una alerta constante atada a una sola bandera histórica de junio–septiembre 2026 (`MISSING_BANK_STATEMENT_LEDGER`, actualmente `flag_id = 15`). Incluso después de guardar un cierre diario, el aviso nunca desaparece.
2. **Exceso de cuentas sin uso real:** Existen 6 cuentas activas cuando 2 tienen `0` movimientos (`CAJA_GENERAL`, `YAPE_PLIN_BHT`) y 1 (`CUSTODIA_SAMUEL`) tiene únicamente un asiento de carga histórica (`HISTORICAL_BACKFILL` con `reference_id = 'DEUDA_SAMUEL'`, salida de `S/ 15,800.00` el `2026-07-24` con `is_internal_transfer = false`). Además, la bolsa principal de efectivo figura como `CAJA_RUTA` en lugar de `Caja General`.
3. **Saldos acumulados negativos visibles como dato principal:** Al no haberse cargado saldos iniciales ni extractos bancarios históricos, el acumulado del libro muestra cifras negativas (`Cuenta Interbank: -S/ 136,127.80`, `Cuenta BCP: -S/ 1,204.62`). Mostrar ese acumulado negativo sin saldo inicial como cifra principal junto al día a día dificulta la lectura del flujo diario.
4. **Fricción y falsos ceros en el Cierre Diario:** El dueño no conoce el monto exacto en efectivo ni en bancos en todo momento. Exigir o prellenar un conteo real obliga a igualar al sistema o dejar `0`, registrando falsas diferencias (`variance_pen = 0.00`) cuando nadie contó realmente.

---

## Goals

- **Exactamente 3 cuentas activas:** Dejar visibles y seleccionables únicamente **`Caja General`** (manteniendo el código técnico `CAJA_RUTA` para preservar 269 asientos, 47 rutas y consultas existentes, absorbiendo el asiento `HISTORICAL_BACKFILL` / `DEUDA_SAMUEL` de `CUSTODIA_SAMUEL`), **`Cuenta BCP`** (`BCP_BHT`) y **`Cuenta Interbank`** (`INTERBANK_BHT`). Archivar y desactivar `CAJA_GENERAL`, `YAPE_PLIN_BHT` y `CUSTODIA_SAMUEL`.
- **Flujo diario y mensual como vista principal:** Mostrar **`Flujo de hoy`** (`Cobros recibidos hoy − Salidas pagadas hoy = Neto de hoy`, evaluado en zona horaria `America/Lima`) como métrica principal en `Hoy` y `Caja`, excluyendo traslados internos (`is_internal_transfer = TRUE`) y asientos de anulación/extorno (`is_reversal = TRUE`) del total consolidado, y mostrando los traslados del día por cuenta en `Caja`. Mostrar **`Flujo del mes`** debajo y relegar **`Acumulado registrado (sin saldo inicial)`** a un bloque desplegable discreto en tono neutro.
- **Cierre del día en 2 niveles sin falsos ceros:** Permitir confirmar el cierre en 1 clic sin ingresar conteo físico/bancario, guardando `NULL` en conteo y diferencia (nunca `0.00`), con una sección plegable opcional para registrar conteo real solo cuando se conozca el monto exacto.
- **Enrutamiento simple de Yape y Plin:** Conservar `Yape` y `Plin` como métodos de pago en interfaz, preseleccionando **`Yape → Cuenta BCP`** y **`Plin → Cuenta Interbank`** por defecto (con cambio manual permitido), y redirigiendo en backend sin error HTTP 400 si una cola offline del PWA envía las cuentas desactivadas `YAPE_PLIN_BHT` (hacia `BCP_BHT`) o `CAJA_GENERAL` (hacia `CAJA_RUTA`).
- **Eliminación de alertas históricas bloqueantes:** Retirar los avisos permanentes de conciliación bancaria en `Hoy` y `Caja`, y marcar `MISSING_BANK_STATEMENT_LEDGER` como `RESOLVED` con nota explícita.
- **Sincronización con `bht_data`:** Asegurar que `loader.py` en `bht_data` no reactive cuentas desactivadas, no sobrescriba `'Caja General'` y no vuelva a insertar `MISSING_BANK_STATEMENT_LEDGER` en estado `OPEN`.

---

## Non-Goals

- Importar extractos bancarios de BCP o Interbank ni integrar APIs bancarias externas.
- Fabricar saldos iniciales sintéticos o asientos ficticios para poner en cero los acumulados históricos negativos.
- Modificar el cálculo o la métrica histórica de `Rutas sin conciliación` en `Reportes → Calidad`.

---

## Open Questions

Ninguna; todas las decisiones de alcance y negocio quedaron cerradas en `Goals`, `Non-Goals` y `Alternatives Considered`.

---

## Critical User Journeys (CUJs)

### CUJ 1: Revisar el flujo de dinero del día en `Hoy` y `Caja`

- **Given:** Existen 3 cuentas activas (`Caja General`, `Cuenta BCP`, `Cuenta Interbank`), `MISSING_BANK_STATEMENT_LEDGER` está en estado `RESOLVED` y hoy (`America/Lima`) se registraron cobros, salidas y un traslado interno entre cuentas propias.
- **When:** El socio abre `Hoy` o entra a `Caja`.
- **Then:** Ve **`Flujo de hoy`** (`Cobros`, `Salidas`, `Neto de hoy`) sin que el traslado interno infle el total consolidado y sin ningún aviso de _"Pendiente de conciliar"_ o _"Saldos no conciliados"_; debajo ve **`Flujo del mes`** y, en un bloque desplegable neutro, **`Acumulado registrado (sin saldo inicial)`**.

### CUJ 2: Confirmar `Cierre del día` sin contar efectivo ni revisar bancos

- **Given:** El socio abre `Caja → Cierre del día` al terminar la jornada y no tiene el conteo físico exacto ni el saldo exacto de sus cuentas bancarias.
- **When:** Pulsa **`Confirmar cierre del día`** sin abrir la sección opcional de conteo real.
- **Then:** El sistema guarda el cierre del día en estado `CLOSED` con `counted_balance_pen = NULL` y `variance_pen = NULL` (tanto en cabecera como por cuenta), sin mostrar ni registrar `Diferencia: S/ 0.00`. Si luego ese mismo día (`America/Lima`) abre `Cierre del día` e ingresa un conteo en Nivel 2, el cierre existente del día se actualiza manteniendo su `closure_date`.

### CUJ 3: Registrar un conteo real opcional en `Cierre del día`

- **Given:** El socio abre `Caja → Cierre del día` y esta vez sí conoce el efectivo real en `Caja General` (o el saldo de una cuenta bancaria).
- **When:** Despliega **`Conteo real (opcional)`**, ingresa el monto real solo en esa cuenta y guarda el cierre.
- **Then:** El sistema calcula y muestra **`Diferencia`** (`counted - system`) únicamente en `daily_closure_accounts` para esa cuenta (indicando _"vs. acumulado sin saldo inicial"_ en cuentas bancarias), mantiene `NULL` en las cuentas no contadas y mantiene `counted_cash_total_pen = NULL` y `variance_total_pen = NULL` en `erp.daily_closures` mientras no se hayan contado las 3 cuentas activas.

### CUJ 4: Registrar un cobro con Yape o Plin

- **Given:** El vendedor o socio registra un pago de pedido o abono en el ERP (en línea o desde cola offline PWA).
- **When:** Selecciona método de pago `Yape` o `Plin`.
- **Then:** El formulario preselecciona **`Cuenta BCP`** para `Yape` y **`Cuenta Interbank`** para `Plin` (permitiendo cambiar manualmente al otro banco). Si una cola offline antigua envía la cuenta desactivada `YAPE_PLIN_BHT`, el backend la redirige automáticamente a **`BCP_BHT`** (y `CAJA_GENERAL` hacia **`CAJA_RUTA`**) sin rechazar la operación.

---

## Technical Plan (Architecture)

La arquitectura se organiza en tres capas sincronizadas entre `bht_data` (esquema, ETL y contrato SQL) y `bht_neon` (servicios compartidos, API y UI):

```text
[UI Vendedor / Cobranza]
  ├─ Efectivo ─────────────────────────────▶ Caja General (code: CAJA_RUTA)
  ├─ Yape (payment_mode: YAPE_PLIN) ───────▶ Cuenta BCP (BCP_BHT) [editable]
  ├─ Plin (payment_mode: YAPE_PLIN) ───────▶ Cuenta Interbank (INTERBANK_BHT) [editable]
  └─ Transferencia (payment_mode: TRANSFER)▶ Cuenta elegida (BCP / Interbank)
       │ (cola offline PWA con cuenta inactiva -> YAPE_PLIN_BHT => BCP_BHT, CAJA_GENERAL => CAJA_RUTA)
       ▼
[API & Servicios Compartidos (America/Lima UTC-5)]
  ├─ getCashFlowSummary (helper único para /api/partners y /api/treasury):
  │    Σ IN - Σ OUT sobre cl.tx_date (excluye is_internal_transfer y is_reversal) -> Flujo de hoy + Flujo del mes
  ├─ Tarjetas por cuenta (3 cuentas activas):
  │    dayInPen / dayOutPen (sin traslados) + dayTransfersNetPen (traslados) + dayNetPen + Flujo del mes + Acumulado sin saldo inicial
  └─ Cierre del día (2 niveles, upsert por closure_date):
       ├─ Nivel 1 (1 clic): counted_balance_pen = NULL, variance_pen = NULL en todas las cuentas
       └─ Nivel 2 (opcional): variance_pen por cuenta contada; cabecera NULL salvo que las 3 cuentas tengan conteo
```

### 1. Capa de Datos y Compatibilidad ETL (`bht_data` + Neon)

- **Migración SQL `029_simplify_cash_accounts_and_optional_closure_count.sql` (idempotente):**
  - **Consolidación a 3 cuentas activas (`erp.cash_accounts`):**
    1. Archivar y desactivar la fila vacía `CAJA_GENERAL` (`name = 'Caja General (archivada)'`, `is_active = FALSE`).
    2. Renombrar `CAJA_RUTA` a `name = 'Caja General'` manteniendo `code = 'CAJA_RUTA'` e `is_active = TRUE` para preservar 269 asientos históricos, 47 `route_trips`, consultas por defecto y cachés offline.
    3. Reasignar el asiento de `CUSTODIA_SAMUEL` (`entry_source = 'HISTORICAL_BACKFILL'`, `reference_id = 'DEUDA_SAMUEL'`, salida `S/ 15,800.00` del `2026-07-24`) hacia `account_id` de `CAJA_RUTA` mediante predicado semántico (`WHERE account_id = (SELECT account_id FROM erp.cash_accounts WHERE code = 'CUSTODIA_SAMUEL')`), sin depender de IDs numéricos fijos.
    4. Desactivar `YAPE_PLIN_BHT` (`is_active = FALSE`) y `CUSTODIA_SAMUEL` (`is_active = FALSE`). Nota: `erp.cash_accounts` no almacena saldo materializado (se calcula agregando `erp.cash_ledger`), y los registros previos de `erp.daily_closure_accounts` permanecen intactos como instantáneas históricas.
  - **Nulabilidad en cierres (`erp.daily_closures` y `erp.daily_closure_accounts`):**
    - Ejecutar `DROP NOT NULL` sobre `daily_closures.counted_cash_total_pen`, `daily_closures.variance_total_pen` y `daily_closure_accounts.counted_balance_pen` (manteniendo `daily_closure_accounts.variance_pen` nullable).
  - **Resolución de alerta histórica (`erp.audit_flags`) y registro de migración:**
    - Actualizar filas con `flag_code = 'MISSING_BANK_STATEMENT_LEDGER' AND status <> 'RESOLVED'` a `status = 'RESOLVED'`, `resolved_at = NOW()`, `resolved_by = 'socio_admin'` (rol administrativo de cierre) y `resolution_note = 'Operación migrada a flujo diario sin extractos bancarios históricos (migración 029).'`.
    - Insertar `'029_simplify_cash_accounts_and_optional_closure_count'` en `public.schema_migrations` (`ON CONFLICT DO NOTHING`).
- **Contrato de propiedad en `bht_data` (`src/bht_etl/loader.py`):**
  - `loader.py` solo lee `erp.cash_accounts` por `code` (no crea ni renombra cuentas), pero `_load_audit_flags` actualmente inserta `MISSING_BANK_STATEMENT_LEDGER` como `OPEN` cuando faltan extractos. Debe añadirse guardia o validación para no reabrir/reinsertar `MISSING_BANK_STATEMENT_LEDGER` cuando ya exista en estado `RESOLVED`.

### 2. Capa de Servicios y API (`bht_neon`)

- **Helper único de flujo en `America/Lima` (`src/lib/services/cash-flow-summary.ts`):**
  - Extraer `getCashFlowSummary(pool)` para ser reutilizado por `GET /api/partners` y `GET /api/treasury`, evitando duplicar SQL y sin engrosar archivos que ya superan 700 líneas (`partners/route.ts`, `daily-closure.ts`, `collections-and-treasury.ts`, `orders.ts`).
  - Usar `cl.tx_date = (NOW() AT TIME ZONE 'America/Lima')::date` para `Flujo de hoy` y `cl.tx_date >= date_trunc('month', NOW() AT TIME ZONE 'America/Lima')::date` para `Flujo del mes`, sumando `cl.amount_pen` por `cl.direction = 'IN' | 'OUT'` y excluyendo `cl.is_internal_transfer = TRUE` y `cl.is_reversal = TRUE`.
  - En el desglose por cuenta de `GET /api/treasury`, devolver `dayInPen` y `dayOutPen` (excluyendo `is_internal_transfer` e `is_reversal`), `dayTransfersNetPen` (neto de `is_internal_transfer = TRUE AND NOT is_reversal` del día), `dayNetPen = dayInPen - dayOutPen + dayTransfersNetPen`, `monthInPen`, `monthOutPen`, `monthNetPen` y `currentBalancePen` etiquetado como _Acumulado registrado (sin saldo inicial)_.
- **Cierre del día con `NULL` semántico (`src/lib/services/daily-closure.ts` y `src/lib/validation/daily-closures.schema.ts`):**
  - Aceptar `countedBalancePen: number | null` por cuenta. En cabecera (`erp.daily_closures`), guardar `counted_cash_total_pen = NULL` y `variance_total_pen = NULL` salvo que **todas** las cuentas activas tengan `countedBalancePen !== null` (regla binaria; las diferencias parciales quedan únicamente por cuenta en `erp.daily_closure_accounts`).
  - El cierre en 1 clic envía todas las cuentas activas con `countedBalancePen: null` (cumpliendo la validación vigente de `saveDailyClosure`).
  - Actualizar `DailyClosureHistoryItem` en `daily-closure.ts` (`countedCashTotalPen: number | null`, `varianceTotalPen: number | null`) y `mapClosureHistoryRow` para preservar `null` sin usar `toNum(...)`.
  - Actualizar `LatestDailyClosureSummary.varianceTotalPen` (`types.ts`) y `QualityQueryRow` / `mapOperationalQualitySummary` (`operational-quality.ts`) a `number | null`, protegiendo contra coerción `null → 0` en `asNum(...)` y en `HoyDataStatusCard.tsx`.
- **Helper único de fallback offline (`src/lib/services/cash-account-resolver.ts`):**
  - Extraer un resolver compartido llamado por `getDefaultCashAccountId` (`orders.ts`) y `resolveCashAccountId` (`collections-and-treasury.ts`). Si `explicitAccountId` apunta a una cuenta desactivada, aplicar mapa de 2 entradas (`YAPE_PLIN_BHT → BCP_BHT`, `CAJA_GENERAL → CAJA_RUTA`) con `console.warn` en servidor, sin lanzar error HTTP 400 ni contaminar notas contables.
- **Retiro de avisos históricos (`operational-quality.ts`, `Hoy.tsx`, `HoyDataStatusCard.tsx`, `CajaWorkspace.tsx`):**
  - Retirar los badges y avisos permanentes `"No conciliado"`, `"Pendiente de conciliar"` y `"Saldos no conciliados"` en `Hoy` y `Caja`, así como el campo muerto `open_bank_flags` / `bankReconciled` si no tiene otro consumidor.

### 3. Capa de Interfaz (`Hoy`, `Caja`, `Vendedor` y `Cobranza`)

- **`Hoy` (`src/features/partners/Hoy.tsx` y `HoyDataStatusCard.tsx`):**
  - `HoyDataStatusCard.tsx` conserva la franja de frescura de datos (`Ventas actualizadas hasta`, `Caja`, `Cobros`, `Compras`, `Cobertura 24 h`), retira el badge `"Saldos no conciliados"`, protege el badge de último cierre cuando `varianceTotalPen === null` (`"Últ. cierre: DD/MM (sin conteo)"`), y alinea el botón `"Cierre diario"` a **`Cierre del día`** (navegando a `Caja → Cierre del día` vía `onOpenDailyClose`).
  - `Hoy.tsx` reemplaza la tarjeta `"Vigencia y Conciliación"` por **`Flujo de hoy`** (`Cobros recibidos hoy`, `Salidas pagadas hoy`, `Neto de hoy`, referencia breve de `Flujo del mes`) y acceso directo a **`Cierre del día`**.
- **`Caja` (`CajaWorkspace.tsx` y `CajaCuentasTab.tsx`):**
  - Alinear la pestaña `"Cierre diario"` a **`Cierre del día`**, retirar `"Pendiente de conciliación bancaria"` de `CajaWorkspace.tsx` y mostrar el resumen consolidado de `Flujo de hoy` y `Flujo del mes`.
  - En `CajaCuentasTab.tsx`, mostrar las 3 tarjetas activas (`Caja General`, `Cuenta BCP`, `Cuenta Interbank`) priorizando `Flujo de hoy` (incluyendo línea de traslados del día), `Flujo del mes` debajo y `Acumulado registrado (sin saldo inicial)` dentro de un bloque `<details>` neutro.
- **`Cierre del día` (`CajaCierreTab.tsx` y `CajaCierreAccountsTable.tsx`):**
  - Botón principal **`Confirmar cierre del día`** que envía conteos en `null`.
  - Inicializar en `""` (nunca prellenar `systemBalancePen`) cuando `countedBalancePen === null`; limpiar un input (`""`) vuelve a `null`.
  - Bloque plegable `<details>` para **`Conteo real (opcional)`**, mostrando **`Diferencia`** solo cuando existe un conteo real (con nota _"vs. acumulado sin saldo inicial"_ en BCP/Interbank) y renderizando `"Sin conteo"` en el historial cuando `countedCashTotalPen` o `varianceTotalPen` sean `null`.
- **`Yape` y `Plin` en formularios (`SellerOrderCheckout.tsx`, `useSellerOrderFlow.ts`, `CollectionControls.tsx` y flujo vendedor):**
  - Mantener estado UI explícito `yapePlinChannel: "YAPE" | "PLIN"` para distinguir el botón activo mientras ambos envían `paymentMode = "YAPE_PLIN"` y `paymentAccountId` preseleccionado (`Yape → BCP_BHT`, `Plin → INTERBANK_BHT`, con cambio manual permitido).

---

## Alternatives Considered

### Alternative A: Migrar el código técnico `CAJA_RUTA` hacia `CAJA_GENERAL`

- **Pros:** El identificador técnico en base de datos coincidiría literalmente con el nuevo nombre visible `"Caja General"`.
- **Cons:** Obliga a actualizar 269 filas de `erp.cash_ledger`, 47 filas de `erp.route_trips`, 4 consultas backend en `bht_neon`, scripts de carga en `bht_data` y cachés locales del PWA offline, sin aportar cambios funcionales visibles en la interfaz.
- **Reason for Rejection:** Mantener `code = 'CAJA_RUTA'` como clave técnica inmutable y cambiar únicamente `name = 'Caja General'` (desactivando la fila vacía `CAJA_GENERAL`) logra el renombre completo en la interfaz sin modificar asientos históricos, rutas ni consultas existentes.

### Alternative B: Insertar asientos sintéticos de saldo inicial para dejar en `S/ 0.00` los acumulados históricos negativos

- **Pros:** Eliminaría visualmente los números negativos (`Interbank -S/ 136,127.80`, `BCP -S/ 1,204.62`).
- **Cons:** Como hoy no se conocen los saldos reales exactos ni se dispone de los extractos históricos, fabricar un ajuste de apertura generaría saldos sin respaldo documental y alteraría la trazabilidad del libro de caja.
- **Reason for Rejection:** Es preferible mantener intactos los movimientos reales registrados, priorizar `Flujo de hoy` y `Flujo del mes`, y mostrar `Acumulado registrado (sin saldo inicial)` de forma discreta y etiquetada.

### Alternative C: Extender el enum `erp.payment_mode` en PostgreSQL con valores `YAPE` y `PLIN`

- **Pros:** Permitiría distinguir en base de datos si un cobro fue Yape o Plin incluso cuando el usuario cambie manualmente el banco destino.
- **Cons:** Requiere `ALTER TYPE erp.payment_mode ADD VALUE`, modificar esquemas Zod, filtros, reportes, vistas analíticas y scripts de `bht_data`, además de exponer a fallos de validación a clientes PWA offline que aún no actualicen su Service Worker.
- **Reason for Rejection:** Ofrecer botones separados `Yape` y `Plin` en la interfaz sobre el valor existente `YAPE_PLIN` (auto-seleccionando `Cuenta BCP` para Yape y `Cuenta Interbank` para Plin) resuelve el enrutamiento diario sin tocar el enum ni romper compatibilidad offline.

### Alternative D: Mantener conteo obligatorio o usar `0.00` por defecto en el Cierre del día

- **Pros:** Evita cambios de nulabilidad en `erp.daily_closures` y `erp.daily_closure_accounts`.
- **Cons:** Fuerza al usuario a inventar montos o a pulsar "Igualar al sistema", registrando falsas diferencias `S/ 0.00` cuando en realidad no se contó dinero físico ni se revisaron bancos.
- **Reason for Rejection:** Volver opcional el conteo y guardar `NULL` en lugar de `0.00` distingue cierres sin conteo (`NULL`) de cierres con diferencia cero (`0.00`).

---

## Risks & Mitigations

- **Cobros offline de `Plin` en cola PWA heredada:** Como `Yape` y `Plin` comparten `payment_mode = 'YAPE_PLIN'`, un pago de `Plin` encolado antes de actualizar el Service Worker con `YAPE_PLIN_BHT` caerá en `BCP_BHT`. _Mitigación:_ Registrar `console.warn` en servidor cuando ocurra el fallback para facilitar reclasificación por traslado interno si se requiere.
- **Deriva de seeds o ETL en `bht_data`:** Futuras ejecuciones de `loader.py` podrían reinsertar `MISSING_BANK_STATEMENT_LEDGER` como `OPEN`. _Mitigación:_ Añadir guardia en `_load_audit_flags` y pruebas de contrato en `bht_data` verificando que cuentas archivadas y banderas `RESOLVED` no se reviertan.
- **Varianza en cuentas bancarias sin saldo inicial:** Ingresar el saldo real de BCP o Interbank en `Conteo real (opcional)` comparará contra un acumulado histórico negativo (`-S/ 136,127.80`). _Mitigación:_ Mostrar la etiqueta _"vs. acumulado sin saldo inicial"_ junto a la diferencia bancaria y dejar la cabecera consolidada en `NULL` salvo que se cuenten las 3 cuentas.
- **Control de acceso y trazabilidad en cierres y flags:** El cierre diario y la resolución de alertas modifican registros auditables. _Mitigación:_ Mantener las validaciones RBAC existentes en los endpoints de cierre y registrar `resolved_by` y `resolution_note` en `erp.audit_flags`.

---

## Non-Functional Requirements

- **Integridad y compatibilidad retroactiva:** Ningún asiento histórico ni cierre previo se elimina; las rutas offline en cola que referencien `YAPE_PLIN_BHT` o `CAJA_GENERAL` deben enrutarse sin errores HTTP 400.
- **Consistencia de zona horaria:** Todos los cálculos de `Flujo de hoy` y `Flujo del mes` deben evaluarse en `America/Lima` (UTC-5) tanto en SQL como en utilidades cliente.
- **Presupuestos de calidad y bundles (`bht_neon`):** Mantener nuevos archivos y archivos editados dentro del límite de 700 líneas de `scripts/check-code-quality.mjs` (extrayendo helpers en lugar de ampliar monolitos existentes) y respetar los límites de `npm run bundles:check` (`/socios` ≤ 650,000 B y `/login` ≤ 730,000 B).

---

## Detailed Implementation Plan

La ejecución se divide en **3 fases incrementales** para garantizar que ambos repositorios permanezcan compilables y verificables en cada punto de control:

### Fase 1: `bht_data` y Migración en Neon (`dev` primero)

1. `bht_data/db/migrations/029_simplify_cash_accounts_and_optional_closure_count.sql` (**Create**)
   - **Proposed Changes:**
     - Renombrar `CAJA_GENERAL` a `'Caja General (archivada)'` y marcar `is_active = FALSE`.
     - Actualizar `CAJA_RUTA` con `name = 'Caja General'` e `is_active = TRUE` (manteniendo `code = 'CAJA_RUTA'`).
     - Reasignar el asiento histórico de `CUSTODIA_SAMUEL` (`WHERE account_id = (SELECT account_id FROM erp.cash_accounts WHERE code = 'CUSTODIA_SAMUEL') AND entry_source = 'HISTORICAL_BACKFILL' AND reference_id = 'DEUDA_SAMUEL'`) hacia `account_id` de `CAJA_RUTA`.
     - Desactivar `YAPE_PLIN_BHT` y `CUSTODIA_SAMUEL` (`is_active = FALSE`).
     - Ejecutar `ALTER TABLE erp.daily_closures ALTER COLUMN counted_cash_total_pen DROP NOT NULL`, `ALTER COLUMN variance_total_pen DROP NOT NULL` y `ALTER COLUMN counted_balance_pen DROP NOT NULL` en `erp.daily_closure_accounts`.
     - Actualizar `erp.audit_flags` donde `flag_code = 'MISSING_BANK_STATEMENT_LEDGER' AND status <> 'RESOLVED'` con `status = 'RESOLVED'`, `resolved_at = NOW()`, `resolved_by = 'socio_admin'` y `resolution_note = 'Operación migrada a flujo diario sin extractos bancarios históricos (migración 029).'`.
     - Insertar `'029_simplify_cash_accounts_and_optional_closure_count'` en `public.schema_migrations` (`ON CONFLICT DO NOTHING`).

2. `bht_data/src/bht_etl/loader.py` (**Modify**)
   - **Proposed Changes:** Confirmar que `acct_map` continúa leyendo por `code` (`CAJA_RUTA`, `INTERBANK_BHT`, `BCP_BHT`) y añadir guardia en `_load_audit_flags` para no insertar ni reabrir `MISSING_BANK_STATEMENT_LEDGER` si ya existe como `RESOLVED`.

3. `bht_data/tests/test_029_cash_simplification.py` (**Create**) y `bht_data/.github/workflows/quality.yml` (**Modify**)
   - **Proposed Changes:** Validar contratos SQL de `029_...sql` (idempotencia, 3 cuentas activas, nulabilidad en cierres, resolución de `MISSING_BANK_STATEMENT_LEDGER` y registro en `schema_migrations`) y registrar el test en `quality.yml`.
   - **Checkpoint Fase 1:** Ejecutar `uv run pytest -q tests/test_029_cash_simplification.py` y aplicar migración `029` en Neon `dev`.

### Fase 2: `bht_neon` Schema Gate, Tipos, Helpers y Backend

4. `bht_neon/src/lib/schema-version.ts` (**Modify**) y `bht_neon/scripts/verify-project.mjs` (**Modify**)
   - **Proposed Changes:** Actualizar `REQUIRED_SCHEMA_VERSION`, `COMPATIBLE_SCHEMA_VERSIONS` (exigiendo `029` estrictamente, sin versiones anteriores) y el mensaje de error de versión mínima a `029_simplify_cash_accounts_and_optional_closure_count`.

5. `bht_neon/src/components/socios/types.ts` (**Modify**)
   - **Proposed Changes:** Cambiar `LatestDailyClosureSummary.varianceTotalPen` a `number | null`; agregar `DailyCashFlowSummary` (`inflowsTodayPen`, `outflowsTodayPen`, `netTodayPen`, `inflowsMonthPen`, `outflowsMonthPen`, `netMonthPen`) y agregar a `CashAccountItem` los campos `dayInPen: number`, `dayOutPen: number`, `dayTransfersNetPen: number`, `dayNetPen: number`, `monthInPen: number`, `monthOutPen: number`, `monthNetPen: number`.

6. `bht_neon/src/lib/services/cash-flow-summary.ts` (**Create**) y `bht_neon/src/lib/services/cash-account-resolver.ts` (**Create**)
   - **Proposed Changes:**
     - `cash-flow-summary.ts`: exportar `getCashFlowSummary` con filtro `America/Lima` sobre `cl.tx_date` (excluyendo `is_internal_transfer` e `is_reversal` en consolidado y en `dayInPen`/`dayOutPen`, y calculando `dayTransfersNetPen` aparte).
     - `cash-account-resolver.ts`: exportar `resolveActiveCashAccountId` con fallback determinístico de 2 entradas (`YAPE_PLIN_BHT → BCP_BHT`, `CAJA_GENERAL → CAJA_RUTA`) y `console.warn` en servidor.

7. `bht_neon/src/lib/services/operational-quality.ts` (**Modify**), `bht_neon/src/app/api/partners/route.ts` (**Modify**) y `bht_neon/src/app/api/treasury/route.ts` (**Modify**)
   - **Proposed Changes:**
     - Reutilizar `getCashFlowSummary` en `/api/partners` y `/api/treasury` (exponiendo `cashFlowSummary` y métricas por cuenta).
     - Actualizar `QualityQueryRow` y `mapOperationalQualitySummary` para preservar `varianceTotalPen: number | null` sin coerción a `0` vía `asNum(...)`, y retirar `open_bank_flags`/`bankReconciled` si no tienen otro consumidor.

8. `bht_neon/src/lib/services/daily-closure.ts` (**Modify**) y `bht_neon/src/lib/validation/daily-closures.schema.ts` (**Modify**)
   - **Proposed Changes:**
     - Aceptar `countedBalancePen: z.number().nullable().optional()` y derivar `hasCountedBalances` en el servidor.
     - En `erp.daily_closures`, persistir `counted_cash_total_pen = NULL` y `variance_total_pen = NULL` salvo que todas las cuentas activas tengan conteo ingresado; calcular `variance_pen` únicamente en cuentas contadas dentro de `erp.daily_closure_accounts`.
     - Actualizar `DailyClosureHistoryItem` (`countedCashTotalPen: number | null`, `varianceTotalPen: number | null`) y `mapClosureHistoryRow` en `daily-closure.ts` para no convertir `null` en `0`.

9. `bht_neon/src/lib/services/orders.ts` (**Modify**) y `bht_neon/src/lib/services/collections-and-treasury.ts` (**Modify**)
   - **Proposed Changes:** Delegar `getDefaultCashAccountId` (`orders.ts`) y `resolveCashAccountId` (`collections-and-treasury.ts`) al helper compartido `resolveActiveCashAccountId`.
   - **Checkpoint Fase 2:** Ejecutar `npm run typecheck` y tests unitarios de servicios.

### Fase 3: `bht_neon` UI, Pruebas y CI

10. `bht_neon/src/features/partners/Hoy.tsx` (**Modify**) y `bht_neon/src/features/partners/HoyDataStatusCard.tsx` (**Modify**)
    - **Proposed Changes:** Reemplazar la tarjeta `"Vigencia y Conciliación"` en `Hoy.tsx` por **`Flujo de hoy`** con botón **`Cierre del día`** conectado a `onOpenDailyClose` (navegando a `Caja → Cierre del día`). En `HoyDataStatusCard.tsx`, conservar la franja de vigencia de datos, retirar `"Saldos no conciliados"`, proteger `varianceTotalPen === null` (`"Últ. cierre: DD/MM (sin conteo)"`) y renombrar `"Cierre diario"` a **`Cierre del día`**.

11. `bht_neon/src/components/socios/caja/CajaWorkspace.tsx` (**Modify**), `bht_neon/src/components/socios/caja/CajaCuentasTab.tsx` (**Modify**) y `bht_neon/src/components/socios/caja/caja-utils.ts` (**Modify**)
    - **Proposed Changes:** Retirar `"Pendiente de conciliación bancaria"` y renombrar tab a **`Cierre del día`** en `CajaWorkspace.tsx`; en `CajaCuentasTab.tsx` mostrar las 3 cuentas activas con `Flujo de hoy`, `Flujo del mes` y bloque `<details>` neutro para `Acumulado registrado (sin saldo inicial)`; actualizar helpers en `caja-utils.ts` para formateo seguro de `null`.

12. `bht_neon/src/components/socios/caja/CajaCierreTab.tsx` (**Modify**) y `bht_neon/src/components/socios/caja/CajaCierreAccountsTable.tsx` (**Modify**)
    - **Proposed Changes:** Botón principal **`Confirmar cierre del día`** que envía todas las cuentas activas con `countedBalancePen: null`; inicializar inputs en `""` cuando `countedBalancePen === null` (nunca `systemBalancePen`), convertir `"" → null` al editar, renderizar `<details>` para **`Conteo real (opcional)`**, mostrar **`Diferencia`** solo con conteo real y mostrar `"Sin conteo"` en historial para `null`.

13. `bht_neon/src/features/seller/SellerOrderCheckout.tsx` (**Modify**), `bht_neon/src/features/seller/useSellerOrderFlow.ts` (**Modify**), `bht_neon/src/features/seller/types.ts` (**Modify**), `bht_neon/src/features/seller/order-draft-reducer.ts` (**Modify**), `bht_neon/src/features/seller/seller-order-helpers.ts` (**Modify**) y `bht_neon/src/components/shared/CollectionControls.tsx` (**Modify**)
    - **Proposed Changes:** Incorporar `paymentAccountId` al borrador y payload del vendedor (`SellerOrderDraft`, `SellerOrderPayload`, `initialSellerOrderDraft`, `buildOrderSubmitPayload`), mantener estado UI `yapePlinChannel: "YAPE" | "PLIN"` y botones separados **`Yape`** (`BCP_BHT`) y **`Plin`** (`INTERBANK_BHT`) sobre `paymentMode = "YAPE_PLIN"` con cambio manual de banco permitido.

14. `bht_neon/tests/caja-utils.test.ts` (**Modify**), `bht_neon/tests/cash-flow-simplification.test.ts` (**Create**) y `bht_neon/package.json` (**Modify**)
    - **Proposed Changes:** Cubrir flujo `America/Lima` sin traslados/reversiones, cierre 1-clic con `NULL`, conteo parcial con cabecera `NULL`, fallback `YAPE_PLIN_BHT → BCP_BHT` y `CAJA_GENERAL → CAJA_RUTA`, y preselección `Yape → BCP` / `Plin → Interbank`; registrar `tests/cash-flow-simplification.test.ts` en el script `test:ci` de `package.json`.
    - **Checkpoint Fase 3:** Ejecutar suite completa de verificación.

---

### Verification Plan

- **Contratos SQL (`bht_data`):** Ejecutar `uv run pytest -q tests/test_029_cash_simplification.py` y los tests de contrato existentes en `bht_data`.
- **Migración en Neon (`dev` primero, luego `main` con backup):** Aplicar `029_simplify_cash_accounts_and_optional_closure_count.sql` y verificar con SQL que existen exactamente 3 cuentas activas (`CAJA_RUTA` con nombre `Caja General`, `BCP_BHT`, `INTERBANK_BHT`), `CUSTODIA_SAMUEL` en `S/ 0.00` inactiva, `MISSING_BANK_STATEMENT_LEDGER` en `RESOLVED` y columnas de conteo nullable.
- **Checks estáticos y build (`bht_neon`):**
  - `npm run format:check`
  - `npm run lint` (`eslint . --max-warnings=0 && node scripts/check-code-quality.mjs`)
  - `npm run typecheck`
  - `npm run build`
  - `npm run bundles:check` (verificando márgenes de `/socios` y `/login`)
- **Pruebas unitarias (`bht_neon`):** Ejecutar `npm run test:ci` y verificar que pasen todos los specs, incluidos los nuevos casos de cierre con `NULL` y flujo diario.
- **E2E / Verificación manual en navegador:** Probar los 4 CUJs en `/socios` (`Hoy`, `Caja`, `Cierre del día` con y sin conteo) y `/vendedor` (`Yape` → `BCP`, `Plin` → `Interbank`).
