# Blue Horizon Trade ERP (`bht-erp`)

Monorepo de **Blue Horizon Trade S.A.C.** que unifica la aplicación web/PWA y el núcleo de datos y migraciones SQL sobre Neon PostgreSQL 17.

## Estructura del repositorio

```text
bht-erp/
├── apps/
│   └── web/          # Aplicación Next.js 16 + React 19 + PWA (Vercel Root Directory)
├── data/             # Núcleo ETL en Python (uv) y migraciones SQL (data/db/migrations)
├── docs/             # Documentación técnica, de producto y diseño
└── .github/
    └── workflows/    # CI separado por rutas (web.yml y data.yml)
```

## Desarrollo local

### Web (`apps/web`)
```bash
cd apps/web
npm ci
npm run dev
```

Verificación completa de calidad:
```bash
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run bundles:check
npm run test:ci
```

### Datos y Migraciones (`data`)
```bash
cd data
uv sync --extra dev
uv run pytest -v
uv run bht-etl migrate --branch dev
```

> **Nota:** `apps/web` no contiene migraciones SQL. La fuente única de verdad del esquema vive en `data/db/migrations/` y se valida en el build mediante `apps/web/scripts/verify-project.mjs`.

## Despliegue en Vercel

- **Root Directory:** `apps/web`
- **Ignored Build Step recomendado:** `git diff --quiet HEAD^ HEAD -- apps/web/ data/db/migrations/`
