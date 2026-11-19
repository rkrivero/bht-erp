from __future__ import annotations

from pathlib import Path

from bht_etl.db import get_connection


EXPECTED_INDEXES = [
    "idx_sales_orders_trip",
    "idx_sales_orders_created_by",
    "idx_cash_ledger_trip",
    "idx_sales_order_lines_product_order",
]

EXPECTED_VIEWS = [
    "v_report_monthly_pnl",
    "v_report_ap_maturity",
    "v_report_ar_aging_detail",
    "v_report_route_profitability",
    "v_report_sales_by_zone",
    "v_report_sales_by_seller",
    "v_report_inventory_valuation",
    "v_report_inactive_customers",
]


def test_migration_015_declares_indexes_and_tier1_report_views() -> None:
    sql = (
        Path(__file__).resolve().parents[1]
        / "db"
        / "migrations"
        / "015_analytics_tier1_reports.sql"
    ).read_text(encoding="utf-8")

    for index_name in EXPECTED_INDEXES:
        assert f"CREATE INDEX IF NOT EXISTS {index_name}" in sql

    for view_name in EXPECTED_VIEWS:
        assert f"CREATE OR REPLACE VIEW analytics.{view_name}" in sql


def test_tier1_report_views_execute_and_reconcile_on_dev() -> None:
    with get_connection("dev") as conn:
        with conn.cursor() as cur:
            for view_name in EXPECTED_VIEWS:
                cur.execute(f"SELECT COUNT(*) FROM analytics.{view_name};")
                count = cur.fetchone()[0]
                assert count is not None

            cur.execute(
                "SELECT ROUND(COALESCE(SUM(balance_due_pen), 0), 2) FROM analytics.v_report_ap_maturity;"
            )
            assert float(cur.fetchone()[0]) == 51457.00

            cur.execute(
                "SELECT ROUND(COALESCE(SUM(balance_due_pen), 0), 2) FROM analytics.v_report_ar_aging_detail;"
            )
            assert float(cur.fetchone()[0]) == 45745.00

            cur.execute(
                """
                SELECT
                    COUNT(*) FILTER (WHERE valuation_pen < 0),
                    ROUND(COALESCE(SUM(valuation_pen), 0), 2)
                FROM analytics.v_report_inventory_valuation;
                """
            )
            neg_val_count, total_val = cur.fetchone()
            assert neg_val_count == 0
            assert float(total_val) > 0

            cur.execute("SELECT COUNT(*) FROM analytics.v_report_route_profitability;")
            assert cur.fetchone()[0] >= 47
