from pathlib import Path

from bht_etl import cli

ROOT = Path(__file__).resolve().parents[1]


def test_cli_blocks_main_without_confirm_main(capsys) -> None:
    assert cli.main(["migrate", "--branch", "main"]) == 2
    assert "--confirm-main" in capsys.readouterr().err

    assert cli.main(["load", "--branch", "main"]) == 2
    assert "--confirm-main" in capsys.readouterr().err


def test_loader_preserves_live_erp_and_resolved_flags() -> None:
    loader_src = (ROOT / "src/bht_etl/loader.py").read_text(encoding="utf-8")
    assert "FROM erp.cash_accounts WHERE is_active = TRUE" in loader_src
    assert "ON CONFLICT (quote_code) DO NOTHING" in loader_src
    assert "ON CONFLICT (order_code) DO NOTHING" in loader_src
    assert "ON CONFLICT (trip_code) DO NOTHING" in loader_src
    assert "ON CONFLICT (supplier_ruc, doc_type, doc_series, doc_number) DO NOTHING" in loader_src
    assert "ON CONFLICT (flag_code, entity_table, entity_id) WHERE status = 'OPEN'" not in loader_src
    assert "WHERE NOT EXISTS" in loader_src


def test_excel_daily_targets_active_caja_ruta_for_deuda_samuel() -> None:
    src = (ROOT / "src/bht_etl/extractors/excel_daily.py").read_text(encoding="utf-8")
    assert 'account_code="CUSTODIA_SAMUEL"' not in src


def test_db_migration_runner_uses_advisory_lock() -> None:
    db_src = (ROOT / "src/bht_etl/db.py").read_text(encoding="utf-8")
    assert "pg_advisory_lock(hashtext('bht_schema_migrations'))" in db_src
    assert "pg_advisory_unlock(hashtext('bht_schema_migrations'))" in db_src
