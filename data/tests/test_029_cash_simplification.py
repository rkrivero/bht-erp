"""Contract and dev DB tests for migration 029 (cash account simplification & optional closure count)."""

from __future__ import annotations

from pathlib import Path

from bht_etl.db import get_connection

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "db" / "migrations"
LOADER_PY = ROOT / "src" / "bht_etl" / "loader.py"


def test_migration_029_declares_sql_contracts() -> None:
    sql_029 = (MIGRATIONS / "029_simplify_cash_accounts_and_optional_closure_count.sql").read_text(encoding="utf-8")
    loader_src = LOADER_PY.read_text(encoding="utf-8")

    assert "name = 'Caja General (archivada)'" in sql_029
    assert "name = 'Caja General'" in sql_029
    assert "code = 'CAJA_RUTA'" in sql_029
    assert "source_origin = 'HISTORICAL_BACKFILL'" in sql_029
    assert "reference_id = 'DEUDA_SAMUEL'" in sql_029
    assert "code IN ('YAPE_PLIN_BHT', 'CUSTODIA_SAMUEL')" in sql_029
    assert "ALTER COLUMN counted_cash_total_pen DROP NOT NULL" in sql_029
    assert "ALTER COLUMN variance_total_pen DROP NOT NULL" in sql_029
    assert "ALTER COLUMN counted_balance_pen DROP NOT NULL" in sql_029
    assert "flag_code = 'MISSING_BANK_STATEMENT_LEDGER'" in sql_029
    assert "WHERE NOT EXISTS" in loader_src
    assert "af.flag_code = 'MISSING_BANK_STATEMENT_LEDGER'" in loader_src


def test_active_cash_accounts_simplified_on_dev() -> None:
    with get_connection(branch="dev") as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT code, name, is_active FROM erp.cash_accounts;")
            rows = {code: (name, is_active) for code, name, is_active in cur.fetchall()}

            active_codes = {code for code, (_, is_active) in rows.items() if is_active}
            assert active_codes == {"CAJA_RUTA", "BCP_BHT", "INTERBANK_BHT"}
            assert rows["CAJA_RUTA"][0] == "Caja General"
            assert rows["CAJA_GENERAL"][1] is False
            assert rows["YAPE_PLIN_BHT"][1] is False
            assert rows["CUSTODIA_SAMUEL"][1] is False

            cur.execute(
                """
                SELECT COUNT(*)::int
                FROM erp.cash_ledger cl
                JOIN erp.cash_accounts ca ON ca.account_id = cl.account_id
                WHERE ca.code = 'CUSTODIA_SAMUEL';
                """
            )
            assert cur.fetchone()[0] == 0


def test_daily_closure_count_columns_nullable_on_dev() -> None:
    with get_connection(branch="dev") as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name, column_name, is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'erp'
                  AND (
                    (table_name = 'daily_closures' AND column_name IN ('counted_cash_total_pen', 'variance_total_pen'))
                    OR (table_name = 'daily_closure_accounts' AND column_name = 'counted_balance_pen')
                  );
                """
            )
            cols = {(t, c): n for t, c, n in cur.fetchall()}
            assert cols[("daily_closures", "counted_cash_total_pen")] == "YES"
            assert cols[("daily_closures", "variance_total_pen")] == "YES"
            assert cols[("daily_closure_accounts", "counted_balance_pen")] == "YES"


def test_missing_bank_statement_flag_resolved_on_dev() -> None:
    with get_connection(branch="dev") as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*)::int
                FROM erp.audit_flags
                WHERE flag_code = 'MISSING_BANK_STATEMENT_LEDGER'
                  AND status = 'OPEN';
                """
            )
            assert cur.fetchone()[0] == 0
