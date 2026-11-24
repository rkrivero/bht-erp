# Blue Horizon Trade ERP (`bht-erp`) Agent Rules

## Monorepo Layout
- `apps/web/`: Next.js 16 + React 19 + PWA ERP web application (Vercel Root Directory). See `apps/web/AGENTS.md` for Next.js-specific rules.
- `data/`: Python ETL (`uv`) and canonical SQL migrations (`data/db/migrations/`). See `data/AGENTS.md` for Python/ETL rules.
- `docs/`: Shared architecture, product, and design documentation (`ARCHITECTURE.md`, `PRODUCT.md`, `DESIGN.md`, `IDEA.md`).

## Database & Secrets Safety
- `data/db/migrations/` is the single source of truth for the Neon PostgreSQL schema. Never add SQL migrations under `apps/web/`.
- When adding a new SQL migration in `data/db/migrations/`, update `REQUIRED_SCHEMA_VERSION` in `apps/web/src/lib/schema-version.ts` in the same commit; `apps/web/scripts/verify-project.mjs` enforces that they stay in sync.
- Target `--branch dev` (`BHT_DB_BRANCH=dev`) by default. Never run `migrate`, `load`, or destructive SQL against `--branch main` (production) without explicit user approval.
- Never commit `.env`, `.env.local`, `data/00_raw/`, or database dumps.

## Verification Commands
- Web (`apps/web`): `npm run format:check && npm run lint && npm run typecheck && npm run build && npm run bundles:check && npm run test:ci`
- Data (`data`): `uv run pytest -v`
