"""Offline SQL contract tests for migration 032."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "db" / "migrations"


def test_migration_032_declares_sql_contracts() -> None:
    sql_032 = (MIGRATIONS / "032_ola1_period_locks_and_valuation_fix.sql").read_text(
        encoding="utf-8"
    )

    assert "CREATE OR REPLACE FUNCTION erp.fn_guard_closed_daily_period()" in sql_032
    assert "PENDING_SUPPLIER_PURCHASE" in sql_032
    assert "PARTIALLY_FULFILLED" in sql_032
    assert "NEW.fulfillment_status = 'FULFILLED'" in sql_032
    assert "OLD.fulfillment_status IS DISTINCT FROM 'CANCELLED'" in sql_032
    assert "NEW.fulfillment_status IS DISTINCT FROM 'CANCELLED'" in sql_032
    assert "CREATE OR REPLACE VIEW analytics.v_report_inventory_valuation AS" in sql_032
    assert "COALESCE(so.global_discount_pen, 0)" in sql_032
    assert "OVER (PARTITION BY sol.order_id)" in sql_032
    assert "net_line_total_pen" in sql_032
    assert not sql_032.lstrip().startswith("BEGIN;")
    assert "COMMIT;" not in sql_032
