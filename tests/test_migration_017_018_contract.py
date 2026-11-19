"""Contract and transactional behavior tests for Bloque B migrations 017 & 018."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

from bht_etl.db import get_connection


def test_migrations_017_018_declare_bloque_b_contract() -> None:
    migrations_dir = Path(__file__).resolve().parents[1] / "db" / "migrations"
    sql_017 = (migrations_dir / "017_add_admin_opex_bucket.sql").read_text(encoding="utf-8")
    sql_018 = (migrations_dir / "018_bloque_b_financial_truth_and_daily_close.sql").read_text(
        encoding="utf-8"
    )

    assert "ADD VALUE IF NOT EXISTS 'ADMIN_OPEX'" in sql_017
    for fragment in [
        "ADD COLUMN IF NOT EXISTS credit_days_agreed",
        "ADD COLUMN IF NOT EXISTS credit_limit_pen",
        "ADD COLUMN IF NOT EXISTS last_contact_date",
        "ADD COLUMN IF NOT EXISTS cost_updated_at",
        "ADD COLUMN IF NOT EXISTS default_supplier_party_id",
        "ADD COLUMN IF NOT EXISTS lead_time_days",
        "ADD COLUMN IF NOT EXISTS min_stock_qty",
        "ADD COLUMN IF NOT EXISTS last_reconciled_at",
        "CREATE TABLE IF NOT EXISTS erp.daily_closures",
        "CREATE TABLE IF NOT EXISTS erp.daily_closure_accounts",
        "CREATE OR REPLACE VIEW analytics.v_kpi_cash_and_reinvestment",
        "CREATE OR REPLACE VIEW analytics.v_report_monthly_pnl",
        "CREATE OR REPLACE VIEW analytics.v_debtors_aging",
        "CREATE OR REPLACE VIEW analytics.v_report_ar_aging_detail",
        "CREATE OR REPLACE VIEW analytics.v_kpi_registration_coverage_24h",
    ]:
        assert fragment in sql_018


def test_bloque_b_effective_cash_admin_opex_due_date_and_daily_close_on_dev() -> None:
    with get_connection("dev") as conn:
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN';")
                wh_id = int(cur.fetchone()[0])
                cur.execute("SELECT account_id FROM erp.cash_accounts WHERE code = 'CAJA_RUTA';")
                acct_id = int(cur.fetchone()[0])
                cur.execute("SELECT user_id FROM erp.app_users WHERE username = 'socio_admin';")
                user_id = int(cur.fetchone()[0])

                # 1. Cross-month credit order (month M) collected in month M+1
                cur.execute(
                    """
                    INSERT INTO erp.products (sku, name, unit_of_measure, fulfillment_mode, list_sale_price_pen, ref_cost_pen)
                    VALUES ('TEST-BLOQUE-B-01', 'Producto Bloque B', 'NIU', 'STOCKED', 200.00, 120.00)
                    RETURNING product_id;
                    """
                )
                prod_id = int(cur.fetchone()[0])

                cur.execute(
                    """
                    INSERT INTO erp.sales_orders
                        (order_code, order_date, warehouse_id, customer_name_raw, payment_mode, total_pen, paid_pen, due_date, source_origin)
                    VALUES ('TEST-BB-M1', DATE '2027-01-15', %s, 'CLIENTE MES 1', 'CREDIT', 200.00, 0.00, DATE '2027-02-14', 'ERP_APP')
                    RETURNING order_id;
                    """,
                    (wh_id,),
                )
                order_m1 = int(cur.fetchone()[0])
                cur.execute(
                    """
                    INSERT INTO erp.sales_order_lines
                        (order_id, line_no, product_id, raw_description, quantity, pack_factor_applied, unit_price_pen, line_total_pen, unit_cost_snapshot_pen, source_origin)
                    VALUES (%s, 1, %s, 'Producto Bloque B', 1, 1.0, 200.00, 200.00, 120.00, 'ERP_APP');
                    """,
                    (order_m1, prod_id),
                )
                cur.execute(
                    """
                    INSERT INTO erp.ar_payments (order_id, payment_date, amount_pen, payment_mode, account_id, source_origin)
                    VALUES (%s, DATE '2027-02-10', 150.00, 'TRANSFER', %s, 'ERP_APP');
                    """,
                    (order_m1, acct_id),
                )

                # 2. ADMIN_OPEX with SUELDO_SOCIO in month M+1 (no double counting in net_cash_flow_pen)
                cur.execute(
                    """
                    INSERT INTO erp.cash_ledger
                        (tx_date, account_id, direction, amount_pen, expense_bucket, expense_category, is_internal_transfer, description, source_origin)
                    VALUES (DATE '2027-02-12', %s, 'OUT', 40.00, 'ADMIN_OPEX', 'SUELDO_SOCIO', FALSE, 'Sueldo test', 'ERP_APP');
                    """,
                    (acct_id,),
                )

                cur.execute(
                    """
                    SELECT period_month, sales_total_pen, cash_collected_pen, admin_opex_pen, owner_salary_recorded_pen
                    FROM analytics.v_kpi_cash_and_reinvestment
                    WHERE period_month IN (DATE '2027-01-01', DATE '2027-02-01')
                    ORDER BY period_month ASC;
                    """
                )
                kpi_rows = {row[0]: row[1:] for row in cur.fetchall()}
                assert kpi_rows[date(2027, 1, 1)] == (
                    Decimal("200.00"),
                    Decimal("0.00"),
                    Decimal("0.00"),
                    Decimal("0.00"),
                )
                assert kpi_rows[date(2027, 2, 1)] == (
                    Decimal("0.00"),
                    Decimal("150.00"),
                    Decimal("40.00"),
                    Decimal("40.00"),
                )

                cur.execute(
                    """
                    SELECT period_month, gross_margin_pen, admin_opex_pen, operating_result_pen, net_cash_flow_pen, owner_salary_recorded_pen
                    FROM analytics.v_report_monthly_pnl
                    WHERE period_month IN (DATE '2027-01-01', DATE '2027-02-01')
                    ORDER BY period_month ASC;
                    """
                )
                pnl_rows = {row[0]: row[1:] for row in cur.fetchall()}
                assert pnl_rows[date(2027, 1, 1)] == (
                    Decimal("80.00"),
                    Decimal("0.00"),
                    Decimal("80.00"),
                    Decimal("0.00"),
                    Decimal("0.00"),
                )
                assert pnl_rows[date(2027, 2, 1)] == (
                    Decimal("0.00"),
                    Decimal("40.00"),
                    Decimal("-40.00"),
                    Decimal("110.00"),
                    Decimal("40.00"),
                )

                # 3. Invoice age vs explicit due_date overdue separation
                cur.execute(
                    """
                    INSERT INTO erp.sales_orders
                        (order_code, order_date, warehouse_id, customer_name_raw, payment_mode, total_pen, paid_pen, due_date, promised_payment_date, source_origin)
                    VALUES
                        ('TEST-BB-CURR', (NOW() AT TIME ZONE 'America/Lima')::date - 20, %s, 'CLIENTE VIGENTE', 'CREDIT', 100.00, 0.00, (NOW() AT TIME ZONE 'America/Lima')::date + 10, (NOW() AT TIME ZONE 'America/Lima')::date + 10, 'ERP_APP'),
                        ('TEST-BB-PAST', (NOW() AT TIME ZONE 'America/Lima')::date - 20, %s, 'CLIENTE VENCIDO', 'CREDIT', 100.00, 0.00, (NOW() AT TIME ZONE 'America/Lima')::date - 5, (NOW() AT TIME ZONE 'America/Lima')::date - 5, 'ERP_APP')
                    RETURNING order_id, order_code;
                    """,
                    (wh_id, wh_id),
                )
                age_ids = {code: int(oid) for oid, code in cur.fetchall()}

                for view_name in ("v_debtors_aging", "v_report_ar_aging_detail"):
                    cur.execute(
                        f"""
                        SELECT order_code, invoice_age_days, days_past_due, due_status, days_overdue
                        FROM analytics.{view_name}
                        WHERE order_id = ANY(%s)
                        ORDER BY order_code ASC;
                        """,
                        (list(age_ids.values()),),
                    )
                    by_code = {row[0]: row[1:] for row in cur.fetchall()}
                    assert by_code["TEST-BB-CURR"] == (20, 0, "CURRENT", 0)
                    assert by_code["TEST-BB-PAST"] == (20, 5, "OVERDUE", 5)

                # 4. Daily close & per-account variance
                cur.execute(
                    """
                    INSERT INTO erp.daily_closures
                        (closure_date, closed_by_user_id, expected_cash_total_pen, counted_cash_total_pen, variance_total_pen)
                    VALUES (DATE '2027-02-12', %s, 1000.00, 985.50, -14.50)
                    RETURNING closure_id;
                    """,
                    (user_id,),
                )
                closure_id = int(cur.fetchone()[0])
                cur.execute(
                    """
                    INSERT INTO erp.daily_closure_accounts (closure_id, account_id, system_balance_pen, counted_balance_pen)
                    VALUES (%s, %s, 1000.00, 985.50)
                    RETURNING variance_pen;
                    """,
                    (closure_id, acct_id),
                )
                assert cur.fetchone()[0] == Decimal("-14.50")

                # 5. Registration coverage 24h SQL view
                cur.execute("SELECT COUNT(*), COUNT(*) FILTER (WHERE is_complete_24h) FROM analytics.v_kpi_registration_coverage_24h;")
                cov_total, cov_ok = cur.fetchone()
                assert cov_total is not None and cov_ok is not None
        finally:
            conn.rollback()
