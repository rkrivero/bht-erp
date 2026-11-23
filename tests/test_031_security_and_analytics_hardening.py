"""Contract, unit, and dev DB tests for migration 031 and ETL hardening."""

from __future__ import annotations

from pathlib import Path

from bht_etl.db import get_connection
from bht_etl.extractors import parse_float

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "db" / "migrations"


def test_parse_float_handles_us_and_eu_formats() -> None:
    assert parse_float("1,250.50") == 1250.5
    assert parse_float("1.250,50") == 1250.5
    assert parse_float("1.234.567,89") == 1234567.89
    assert parse_float("25,750.00") == 25750.0
    assert parse_float("1,000") == 1000.0
    assert parse_float("12,5") == 12.5


def test_migration_005_and_030_clean_bootstrap_contracts() -> None:
    sql_005 = (MIGRATIONS / "005_analytics_kpi_views.sql").read_text(encoding="utf-8")
    sql_030 = (
        MIGRATIONS / "030_harden_analytics_views_settings_and_closure_defaults.sql"
    ).read_text(encoding="utf-8")

    assert "operational_status" not in sql_005
    assert not sql_030.lstrip().startswith("BEGIN;")
    assert "COMMIT;" not in sql_030


def test_migration_031_declares_sql_contracts() -> None:
    sql_031 = (MIGRATIONS / "031_security_locks_and_analytics_hardening.sql").read_text(
        encoding="utf-8"
    )

    assert "ADD COLUMN IF NOT EXISTS created_by_user_id" in sql_031
    assert "uq_app_users_email_active" in sql_031
    assert "PERFORM 1 FROM erp.sales_orders WHERE order_id = " in sql_031
    assert "FOR UPDATE" in sql_031
    assert "trg_guard_closed_period_sales_order_lines" in sql_031
    assert "FROM erp.stock_quants sq" in sql_031
    assert "global_discount_pen" in sql_031
    assert "erp.fn_get_setting_date('kpi_cutoff_date'" in sql_031
    assert "idx_inv_movements_reference" in sql_031


def test_migration_031_applied_on_dev() -> None:
    with get_connection(branch="dev") as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'erp'
                  AND table_name = 'quotes'
                  AND column_name = 'created_by_user_id';
                """
            )
            assert cur.fetchone() == ("created_by_user_id",)

            cur.execute(
                """
                SELECT indexname
                FROM pg_indexes
                WHERE schemaname = 'erp'
                  AND indexname IN (
                      'uq_app_users_email_active',
                      'idx_quotes_created_by_user',
                      'idx_inv_movements_reference',
                      'idx_party_aliases_party_id',
                      'idx_product_aliases_product_id',
                      'idx_cash_ledger_party_id'
                  );
                """
            )
            indexes = {row[0] for row in cur.fetchall()}
            assert len(indexes) == 6

            cur.execute(
                """
                SELECT tgname
                FROM pg_trigger
                WHERE tgrelid = 'erp.sales_order_lines'::regclass
                  AND tgname = 'trg_guard_closed_period_sales_order_lines'
                  AND NOT tgisinternal;
                """
            )
            assert cur.fetchone() == ("trg_guard_closed_period_sales_order_lines",)

            for view_name in (
                "analytics.v_kpi_cash_and_reinvestment",
                "analytics.v_report_monthly_pnl",
                "analytics.v_report_route_profitability",
                "analytics.v_kpi_sku_margin_and_opex",
                "analytics.v_kpi_ar_customers_and_quotes",
                "analytics.v_report_sales_by_zone",
                "analytics.v_report_sales_by_seller",
                "analytics.v_report_inventory_valuation",
            ):
                cur.execute(f"SELECT COUNT(*)::int FROM {view_name};")
                assert cur.fetchone()[0] >= 0
