# bht_data — Blue Horizon Trade S.A.C. (ERP Core DB & ETL)

Núcleo de base de datos en **Neon (Lakebase Postgres)**, migraciones SQL versionadas, diccionarios de normalización y pipeline ETL idempotente desde `00_raw/` (corte oficial: `2026-06-26` en adelante).

- **Fase 1 (`bht_data`):** Esquema `raw_staging` + `erp` + `analytics`, ingesta limpia de datos históricos, reglas anti-errores (`STOCKED` vs `ON_DEMAND`, `CHECK` matemático en líneas, `payment_mode NOT NULL`, deduplicación de compras) y vistas de KPIs.
- **Fase 2 (`../bht_neon`):** Aplicación web/API del ERP ligero conectada al mismo proyecto Neon (`bht-erp`).

## Comandos principales

```bash
uv sync --extra dev
uv run pytest -v
uv run bht-etl migrate --branch dev
uv run bht-etl load --branch dev
uv run bht-etl check-quality --branch dev
uv run bht-etl report-kpis --branch dev
```

## GitHub y despliegue

Este repositorio versiona código, configuración, pruebas y migraciones SQL. Los
archivos de origen de `00_raw/`, el directorio de clientes
`config/aliases_parties.csv`, `.env` y exportaciones de base de datos quedan
fuera de GitHub. El ETL de carga requiere los archivos de `00_raw/` entregados
por un canal privado; las Actions no ejecutan `load`.

El workflow de calidad ejecuta pruebas de contrato sin datos de negocio ni
conexión a Neon. Las pruebas de integración con datos reales se ejecutan de
forma local y controlada contra `dev`.

La migración de producción se ejecuta únicamente mediante `workflow_dispatch`
en la rama `main`, con confirmación escrita, el entorno GitHub `production`
protegido por revisores y el secreto `NEON_MAIN_DATABASE_URL_UNPOOLED`.
Configurar la protección del entorno y el secreto antes de habilitar esa Action.
La Action comprueba la versión previa y posterior; no ejecuta el ETL de carga.
