"""Contract and transactional dev DB tests for migration 027 (sequences, period locks, credit gate & suggestion view)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import psycopg
import psycopg.errors
import pytest

from bht_etl.db import get_connection

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "db" / "migrations"


def test_migration_027_declares_sql_contracts() -> None:
    sql_027 = (MIGRATIONS / "027_sequences_period_locks_and_credit_gate.sql").read_text(encoding="utf-8")

    assert "CREATE TABLE IF NOT EXISTS erp.document_sequences" in sql_027
    assert "CREATE OR REPLACE FUNCTION erp.fn_next_document_code" in sql_027
    assert "CREATE OR REPLACE FUNCTION erp.fn_guard_closed_daily_period" in sql_027
    assert "bht.allow_closed_period_override" in sql_027
    assert "Periodo cerrado" in sql_027
    assert "ADD COLUMN IF NOT EXISTS credit_limit_exceeded_flag" in sql_027
    assert "CREATE OR REPLACE VIEW analytics.v_customer_credit_suggestion" in sql_027
    assert "order_stats AS" in sql_027
    assert "monthly_volatility AS" in sql_027
    assert "payment_delays AS" in sql_027
    assert "punctuality_factor" in sql_027
    assert "volatility_factor" in sql_027
    assert "suggested_credit_limit_pen" in sql_027


def test_atomic_document_sequences_generate_consecutive_codes_on_dev() -> None:
    with get_connection(branch="dev") as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT erp.fn_next_document_code('SALES_ORDER', 'SO', '20991231', 4);"
                )
                first_so = cur.fetchone()[0]
                assert first_so == "SO-20991231-0001"

                cur.execute(
                    "SELECT erp.fn_next_document_code('SALES_ORDER', 'SO', '20991231', 4);"
                )
                second_so = cur.fetchone()[0]
                assert second_so == "SO-20991231-0002"

                cur.execute(
                    "SELECT erp.fn_next_document_code('QUOTE', 'COT', '20991231', 4);"
                )
                first_quote = cur.fetchone()[0]
                assert first_quote == "COT-20991231-0001"
        finally:
            conn.rollback()


def test_closed_daily_period_guard_blocks_writes_allows_override_and_open_day_collection() -> None:
    with get_connection(branch="dev") as conn:
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1;")
                wh_id = int(cur.fetchone()[0])
                cur.execute("SELECT account_id FROM erp.cash_accounts WHERE code = 'CAJA_RUTA' LIMIT 1;")
                acct_id = int(cur.fetchone()[0])
                cur.execute("SELECT user_id FROM erp.app_users WHERE role = 'PARTNER_ADMIN' ORDER BY user_id LIMIT 1;")
                admin_id = int(cur.fetchone()[0])

                closed_date = date(2099, 5, 10)
                open_date = date(2099, 5, 11)

                # Create a CREDIT order on closed_date BEFORE closing the period
                cur.execute(
                    """
                    INSERT INTO erp.sales_orders
                        (order_code, order_date, warehouse_id, customer_name_raw, payment_mode,
                         operational_status, total_pen, paid_pen, credit_limit_exceeded_flag, source_origin)
                    VALUES ('TEST-SO-LOCK-001', %s, %s, 'CLIENTE PERIODO CERRADO', 'CREDIT',
                            'REGISTERED', 500.00, 0.00, TRUE, 'ERP_APP')
                    RETURNING order_id, credit_limit_exceeded_flag;
                    """,
                    (closed_date, wh_id),
                )
                order_id, flag_val = cur.fetchone()
                assert flag_val is True

                # Close the period 2099-05-10
                cur.execute(
                    """
                    INSERT INTO erp.daily_closures
                        (closure_date, status, closed_by_user_id, expected_cash_total_pen, counted_cash_total_pen, variance_total_pen)
                    VALUES (%s, 'CLOSED', %s, 1000.00, 1000.00, 0.00);
                    """,
                    (closed_date, admin_id),
                )

                # 1. Inserting cash_ledger on closed_date must be rejected with Periodo cerrado (23514)
                cur.execute("SAVEPOINT sp_closed_cash;")
                with pytest.raises(psycopg.errors.CheckViolation, match="Periodo cerrado"):
                    cur.execute(
                        """
                        INSERT INTO erp.cash_ledger
                            (tx_date, account_id, direction, amount_pen, expense_bucket, expense_category, description, source_origin)
                        VALUES (%s, %s, 'OUT', 25.00, 'ROUTE_OPEX', 'COMBUSTIBLE', 'Gasto en fecha cerrada', 'ERP_APP');
                        """,
                        (closed_date, acct_id),
                    )
                cur.execute("ROLLBACK TO SAVEPOINT sp_closed_cash;")

                # 2. Inserting ar_payments on closed_date must be rejected
                cur.execute("SAVEPOINT sp_closed_ar;")
                with pytest.raises(psycopg.errors.CheckViolation, match="Periodo cerrado"):
                    cur.execute(
                        """
                        INSERT INTO erp.ar_payments
                            (order_id, payment_date, amount_pen, payment_mode, account_id, source_origin)
                        VALUES (%s, %s, 100.00, 'CASH', %s, 'ERP_APP');
                        """,
                        (order_id, closed_date, acct_id),
                    )
                cur.execute("ROLLBACK TO SAVEPOINT sp_closed_ar;")

                # 3. Inserting a new sales_order on closed_date must be rejected
                cur.execute("SAVEPOINT sp_closed_so;")
                with pytest.raises(psycopg.errors.CheckViolation, match="Periodo cerrado"):
                    cur.execute(
                        """
                        INSERT INTO erp.sales_orders
                            (order_code, order_date, warehouse_id, customer_name_raw, payment_mode, total_pen, paid_pen, source_origin)
                        VALUES ('TEST-SO-LOCK-002', %s, %s, 'CLIENTE BLOQUEADO', 'CASH', 100.00, 100.00, 'ERP_APP');
                        """,
                        (closed_date, wh_id),
                    )
                cur.execute("ROLLBACK TO SAVEPOINT sp_closed_so;")

                # 4. Mutating total_pen on the closed-period order must be rejected
                cur.execute("SAVEPOINT sp_closed_so_total;")
                with pytest.raises(psycopg.errors.CheckViolation, match="Periodo cerrado"):
                    cur.execute(
                        "UPDATE erp.sales_orders SET total_pen = 600.00 WHERE order_id = %s;",
                        (order_id,),
                    )
                cur.execute("ROLLBACK TO SAVEPOINT sp_closed_so_total;")

                # 5. Advancing operational_status (e.g., PICKING -> DELIVERED) and collecting on open_date MUST succeed!
                cur.execute(
                    """
                    UPDATE erp.sales_orders
                       SET operational_status = 'DELIVERED',
                           delivered_at = NOW()
                     WHERE order_id = %s;
                    """,
                    (order_id,),
                )
                cur.execute(
                    """
                    INSERT INTO erp.ar_payments
                        (order_id, payment_date, amount_pen, payment_mode, account_id, source_origin)
                    VALUES (%s, %s, 200.00, 'CASH', %s, 'ERP_APP');
                    """,
                    (order_id, open_date, acct_id),
                )
                cur.execute(
                    "SELECT operational_status::text, paid_pen, balance_due_pen FROM erp.sales_orders WHERE order_id = %s;",
                    (order_id,),
                )
                assert cur.fetchone() == ("DELIVERED", Decimal("200.00"), Decimal("300.00"))

                # 6. Override with SET LOCAL bht.allow_closed_period_override = 'true' allows audited write on closed_date
                cur.execute("SET LOCAL bht.allow_closed_period_override = 'true';")
                cur.execute(
                    """
                    INSERT INTO erp.cash_ledger
                        (tx_date, account_id, direction, amount_pen, expense_bucket, expense_category, description, source_origin)
                    VALUES (%s, %s, 'IN', 50.00, NULL, 'CONCILIACION_SALDO', 'Ajuste auditado post-cierre', 'ERP_APP')
                    RETURNING ledger_id;
                    """,
                    (closed_date, acct_id),
                )
                assert cur.fetchone()[0] is not None
        finally:
            conn.rollback()


def test_customer_credit_suggestion_view_has_zero_fan_out_with_multiple_payments() -> None:
    with get_connection(branch="dev") as conn:
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1;")
                wh_id = int(cur.fetchone()[0])
                cur.execute("SELECT account_id FROM erp.cash_accounts WHERE code = 'CAJA_RUTA' LIMIT 1;")
                acct_id = int(cur.fetchone()[0])
                cur.execute("SELECT (NOW() AT TIME ZONE 'America/Lima')::date;")
                today_lima: date = cur.fetchone()[0]

                cur.execute(
                    """
                    INSERT INTO erp.parties
                        (canonical_key, party_type, doc_type, doc_number, legal_name, trade_name,
                         credit_days_agreed, credit_limit_pen, source_origin)
                    VALUES ('TEST:CREDIT:SUGG:001', 'CUSTOMER', 'RUC', '20999888771',
                            'DISTRIBUIDORA FANOUT SAC', 'DIST FANOUT', 15, 2000.00, 'ERP_APP')
                    RETURNING party_id;
                    """
                )
                party_id = int(cur.fetchone()[0])

                # Single 3,000 PEN order within last 30 days (so 90d monthly run rate = 3000 / 3 = 1000 PEN)
                order_dt = date.fromordinal(today_lima.toordinal() - 10)
                due_dt = date.fromordinal(today_lima.toordinal() - 5)
                cur.execute(
                    """
                    INSERT INTO erp.sales_orders
                        (order_code, order_date, due_date, promised_payment_date, warehouse_id,
                         customer_party_id, customer_name_raw, payment_mode, operational_status,
                         total_pen, paid_pen, source_origin)
                    VALUES ('TEST-SO-FANOUT-001', %s, %s, %s, %s, %s, 'DIST FANOUT', 'CREDIT',
                            'DELIVERED', 3000.00, 0.00, 'ERP_APP')
                    RETURNING order_id;
                    """,
                    (order_dt, due_dt, due_dt, wh_id, party_id),
                )
                order_id = int(cur.fetchone()[0])

                # 3 partial payments on the SAME order (1,000 PEN each = 3,000 PEN settled on due_dt, 0 days overdue)
                for idx in range(3):
                    cur.execute(
                        """
                        INSERT INTO erp.ar_payments
                            (order_id, payment_date, amount_pen, payment_mode, account_id, notes, source_origin)
                        VALUES (%s, %s, 1000.00, 'TRANSFER', %s, %s, 'ERP_APP');
                        """,
                        (order_id, due_dt, acct_id, f"Abono parcial {idx + 1}"),
                    )

                cur.execute(
                    """
                    SELECT
                        party_id,
                        total_orders,
                        delivered_orders_6m,
                        active_months_6m,
                        avg_monthly_sales_pen,
                        avg_days_overdue,
                        punctuality_factor,
                        volatility_factor,
                        suggested_credit_limit_pen,
                        risk_tier
                    FROM analytics.v_customer_credit_suggestion
                    WHERE party_id = %s;
                    """,
                    (party_id,),
                )
                row = cur.fetchone()
                assert row is not None
                (
                    r_party_id,
                    r_total_orders,
                    r_delivered_6m,
                    r_active_months,
                    r_avg_monthly_sales,
                    r_avg_overdue,
                    r_fp,
                    r_fv,
                    r_suggested,
                    r_tier,
                ) = row

                assert r_party_id == party_id
                assert r_total_orders == 1
                assert r_delivered_6m == 1
                assert r_active_months == 1
                # Without fan-out: 3000 / 3 = 1000.00 (if fanned out by 3 payments it would wrongly be 3000.00)
                assert r_avg_monthly_sales == Decimal("1000.00")
                assert r_avg_overdue == Decimal("0.00")
                assert r_fp == Decimal("1.20")
                assert r_fv == Decimal("0.85")
                # 1000 * (15/30) * 1.20 * 0.85 = 510 -> rounded to nearest 100 = 500.00
                assert r_suggested == Decimal("500.00")
                assert r_tier == "EXCELLENT"
        finally:
            conn.rollback()
