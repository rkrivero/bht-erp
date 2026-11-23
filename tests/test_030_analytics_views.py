"""Contract and dev DB tests for migration 030 (analytics views, settings & closure defaults)."""

from __future__ import annotations

from pathlib import Path

from bht_etl.db import get_connection

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "db" / "migrations"


def test_migration_030_declares_sql_contracts() -> None:
    sql_030 = (
        MIGRATIONS / "030_harden_analytics_views_settings_and_closure_defaults.sql"
    ).read_text(encoding="utf-8")

    assert "ALTER COLUMN counted_cash_total_pen DROP DEFAULT" in sql_030
    assert "ALTER COLUMN variance_total_pen DROP DEFAULT" in sql_030
    assert "erp.fn_get_setting_date('kpi_cutoff_date'" in sql_030
    assert "erp.fn_get_setting_numeric('min_margin_pct'" in sql_030
    assert "erp.fn_get_setting_numeric('route_opex_alert_pct'" in sql_030
    assert "erp.fn_get_setting_numeric('drain_alert_pct'" in sql_030
    assert "rev.reversal_of_ledger_id = cl.ledger_id" in sql_030
    assert "CONCILIACION_SALDO" in sql_030
    assert "so.balance_due_pen > 0.05" in sql_030


def test_migration_030_applied_on_dev() -> None:
    with get_connection(branch="dev") as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT column_name, column_default
                FROM information_schema.columns
                WHERE table_schema = 'erp'
                  AND table_name = 'daily_closures'
                  AND column_name IN ('counted_cash_total_pen', 'variance_total_pen');
                """
            )
            defaults = dict(cur.fetchall())
            assert defaults == {
                "counted_cash_total_pen": None,
                "variance_total_pen": None,
            }

            for view_name in (
                "analytics.v_kpi_cash_and_reinvestment",
                "analytics.v_report_monthly_pnl",
                "analytics.v_report_route_profitability",
                "analytics.v_kpi_sku_margin_and_opex",
                "analytics.v_kpi_ar_customers_and_quotes",
            ):
                cur.execute(f"SELECT COUNT(*)::int FROM {view_name};")
                count = cur.fetchone()[0]
                assert count >= 0
