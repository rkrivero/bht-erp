# `data/` (`bht_etl`) — Blue Horizon Trade S.A.C. (ERP Core DB & ETL)

Núcleo de base de datos en **Neon (Lakebase Postgres)**, migraciones SQL versionadas, diccionarios de normalización y pipeline ETL idempotente desde `00_raw/` (corte oficial: `2026-06-26` en adelante).

- **Núcleo de datos (`data/`):** Esquema `raw_staging` + `erp` + `analytics`, ingesta limpia de datos históricos, reglas anti-errores (`STOCKED` vs `ON_DEMAND`, `CHECK` matemático en líneas, `payment_mode NOT NULL`, deduplicación de compras) y vistas de KPIs.
- **Aplicación web (`../apps/web`):** Aplicación web/API/PWA del ERP conectada al mismo proyecto Neon (`bht-erp`).

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

La migración de producción requiere aprobación explícita. Este repositorio
privado no tiene una Action que aplique migraciones: GitHub rechazó la regla de
revisores obligatorios para el entorno `production` con el plan actual. Hasta
que exista ese control, un operador autorizado debe ejecutar
`uv run bht-etl migrate --branch main` desde una máquina controlada, con la
credencial fuera de GitHub, después de comprobar los checksums y la versión
actual de `public.schema_migrations`. El ETL de carga es un paso independiente.
