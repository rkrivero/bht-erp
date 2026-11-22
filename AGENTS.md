# bht_data Agent Rules

- **Python & dependencies:** Always use `uv` (`uv sync --extra dev`, `uv run pytest -v`, `uv run bht-etl ...`). Never use global `pip`.
- **Database safety:** Target `--branch dev` by default for migrations, ETL loads, and checks. Never run `migrate`, `load`, or destructive SQL against `--branch main` (production) without explicit user approval.
- **Secrets & PII:** Never commit, log, or expose `.env`, `00_raw/`, `config/aliases_parties.csv`, or database dumps.
- **Tests:** Run `uv run pytest -v` after modifying migrations, ETL logic, or config. Contract tests must pass without `00_raw/` or a live Neon connection.
- **Scope:** This repo owns Neon Postgres schemas (`raw_staging`, `erp`, `analytics`), versioned SQL migrations, and the idempotent ETL. The web app lives in `../bht_neon`.
