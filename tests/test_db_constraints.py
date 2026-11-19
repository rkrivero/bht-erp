"""Transactional PostgreSQL integration tests verifying ERP triggers and constraints on Neon dev."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import psycopg
import psycopg.errors
import pytest

from bht_etl.db import get_connection


@pytest.fixture()
def db_tx():
    """Open a connection to Neon dev and roll back all changes after each test."""
    with get_connection(branch="dev") as conn:
        try:
            yield conn
        finally:
            conn.rollback()


def _get_main_wh_and_acct(cur: psycopg.Cursor) -> tuple[int, int]:
    cur.execute("SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN';")
    wh_id = cur.fetchone()[0]
    cur.execute("SELECT account_id FROM erp.cash_accounts WHERE code = 'CAJA_RUTA';")
    acct_id = cur.fetchone()[0]
    return int(wh_id), int(acct_id)


def _create_dummy_product(cur: psycopg.Cursor, sku: str, mode: str) -> int:
    cur.execute(
        """
        INSERT INTO erp.products (sku, name, category, unit_of_measure, fulfillment_mode, list_sale_price_pen, ref_cost_pen, cost_source)
        VALUES (%s, %s, 'TEST', 'NIU', %s, 100.00, 60.00, 'TEST')
        RETURNING product_id;
        """,
        (sku, f"Producto {sku}", mode),
    )
    return int(cur.fetchone()[0])


def _create_dummy_order(cur: psycopg.Cursor, wh_id: int, code: str, payment_mode: str = "CASH", total_pen: float = 100.0) -> int:
    cur.execute(
        """
        INSERT INTO erp.sales_orders
            (order_code, order_date, warehouse_id, customer_name_raw, payment_mode, total_pen, paid_pen, source_origin)
        VALUES (%s, %s, %s, 'TEST CUSTOMER', %s, %s, 0, 'ERP_APP')
        RETURNING order_id;
        """,
        (code, date(2026, 9, 15), wh_id, payment_mode, total_pen),
    )
    return int(cur.fetchone()[0])


def test_stocked_product_blocks_negative_stock_in_erp_app(db_tx: psycopg.Connection) -> None:
    with db_tx.cursor() as cur:
        wh_id, _ = _get_main_wh_and_acct(cur)
        prod_id = _create_dummy_product(cur, "TEST-STOCKED-ZERO-001", "STOCKED")

        cur.execute("SAVEPOINT sp_neg_stock;")
        with pytest.raises(psycopg.errors.CheckViolation):
            cur.execute(
                """
                INSERT INTO erp.inventory_movements
                    (warehouse_id, product_id, movement_date, movement_type, quantity_delta, source_origin)
                VALUES (%s, %s, %s, 'SALE_OUT', -1.0, 'ERP_APP');
                """,
                (wh_id, prod_id, datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)),
            )
        cur.execute("ROLLBACK TO SAVEPOINT sp_neg_stock;")


def test_on_demand_allows_zero_stock_emits_alerts_and_resolves_on_purchase_link(db_tx: psycopg.Connection) -> None:
    with db_tx.cursor() as cur:
        wh_id, _ = _get_main_wh_and_acct(cur)
        prod_id = _create_dummy_product(cur, "TEST-ONDEMAND-001", "ON_DEMAND")
        order_id = _create_dummy_order(cur, wh_id, "TEST-SO-OD-001", payment_mode="CASH", total_pen=500.0)

        cur.execute(
            """
            INSERT INTO erp.sales_order_lines
                (order_id, line_no, product_id, raw_description, quantity, pack_factor_applied,
                 unit_price_pen, line_total_pen, source_origin)
            VALUES (%s, 1, %s, 'Producto ON_DEMAND Test', 5, 1.0, 100.00, 500.00, 'ERP_APP')
            RETURNING order_line_id, fulfillment_mode, fulfillment_status;
            """,
            (order_id, prod_id),
        )
        order_line_id, f_mode, f_status = cur.fetchone()
        assert f_mode == "ON_DEMAND"
        assert f_status == "PENDING_SUPPLIER_PURCHASE"

        cur.execute(
            """
            SELECT flag_code, status
            FROM erp.audit_flags
            WHERE entity_table = 'erp.sales_order_lines'
              AND entity_id = %s
              AND flag_code = 'ON_DEMAND_PENDING_PURCHASE';
            """,
            (str(order_line_id),),
        )
        flag_row = cur.fetchone()
        assert flag_row == ("ON_DEMAND_PENDING_PURCHASE", "OPEN")

        cur.execute(
            "SELECT order_line_id, fulfillment_status FROM analytics.v_pending_on_demand_orders WHERE order_line_id = %s;",
            (order_line_id,),
        )
        assert cur.fetchone() == (order_line_id, "PENDING_SUPPLIER_PURCHASE")

        # Dispatching SALE_OUT at 0 stock is allowed for ON_DEMAND and records deficit alert
        cur.execute(
            """
            INSERT INTO erp.inventory_movements
                (warehouse_id, product_id, movement_date, movement_type, quantity_delta, source_origin)
            VALUES (%s, %s, %s, 'SALE_OUT', -5.0, 'ERP_APP');
            """,
            (wh_id, prod_id, datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)),
        )
        cur.execute(
            """
            SELECT flag_code, status
            FROM erp.audit_flags
            WHERE entity_table = 'erp.products'
              AND entity_id = %s
              AND flag_code = 'ON_DEMAND_STOCK_DEFICIT';
            """,
            (f"{prod_id}@{wh_id}",),
        )
        assert cur.fetchone() == ("ON_DEMAND_STOCK_DEFICIT", "OPEN")

        # Link fulfilling purchase line -> status auto-updates to FULFILLED & alert becomes RESOLVED
        cur.execute(
            """
            INSERT INTO erp.purchase_invoices
                (supplier_ruc, supplier_name_raw, doc_type, doc_series, doc_number, issue_date,
                 orig_currency, exchange_rate, total_pen, expense_bucket, expense_category, has_itemized_lines, source_origin)
            VALUES ('20999999999', 'SUPPLIER TEST', '01', 'F999', '999001', %s,
                    'PEN', 1.0, 300.00, 'MERCHANDISE_PAYMENT', 'MERCHANDISE', TRUE, 'ERP_APP')
            RETURNING purchase_id;
            """,
            (date(2026, 9, 16),),
        )
        purchase_id = cur.fetchone()[0]
        cur.execute(
            """
            INSERT INTO erp.purchase_invoice_lines
                (purchase_id, line_no, product_id, raw_description, unit_of_measure,
                 quantity, unit_cost_pen, line_total_pen, source_origin)
            VALUES (%s, 1, %s, 'Producto ON_DEMAND Compra', 'NIU', 5, 60.00, 300.00, 'ERP_APP')
            RETURNING purchase_line_id;
            """,
            (purchase_id, prod_id),
        )
        purchase_line_id = cur.fetchone()[0]

        cur.execute(
            """
            UPDATE erp.sales_order_lines
               SET fulfilling_purchase_line_id = %s
             WHERE order_line_id = %s
            RETURNING fulfillment_status;
            """,
            (purchase_line_id, order_line_id),
        )
        assert cur.fetchone()[0] == "FULFILLED"

        cur.execute(
            """
            SELECT status
            FROM erp.audit_flags
            WHERE entity_table = 'erp.sales_order_lines'
              AND entity_id = %s
              AND flag_code = 'ON_DEMAND_PENDING_PURCHASE';
            """,
            (str(order_line_id),),
        )
        assert cur.fetchone()[0] == "RESOLVED"

        cur.execute("SELECT COUNT(*) FROM analytics.v_pending_on_demand_orders WHERE order_line_id = %s;", (order_line_id,))
        assert cur.fetchone()[0] == 0


def test_chk_line_math_rejects_mismatched_line_total(db_tx: psycopg.Connection) -> None:
    with db_tx.cursor() as cur:
        wh_id, _ = _get_main_wh_and_acct(cur)
        prod_id = _create_dummy_product(cur, "TEST-MATH-001", "STOCKED")
        order_id = _create_dummy_order(cur, wh_id, "TEST-SO-MATH-001", total_pen=99.0)

        cur.execute("SAVEPOINT sp_math;")
        with pytest.raises(psycopg.errors.CheckViolation):
            cur.execute(
                """
                INSERT INTO erp.sales_order_lines
                    (order_id, line_no, product_id, raw_description, quantity, pack_factor_applied,
                     unit_price_pen, line_total_pen, source_origin)
                VALUES (%s, 1, %s, 'Mismatch Item', 2, 1.0, 10.00, 99.00, 'ERP_APP');
                """,
                (order_id, prod_id),
            )
        cur.execute("ROLLBACK TO SAVEPOINT sp_math;")


def test_uq_purchase_invoice_doc_rejects_duplicates(db_tx: psycopg.Connection) -> None:
    with db_tx.cursor() as cur:
        cur.execute(
            """
            INSERT INTO erp.purchase_invoices
                (supplier_ruc, doc_type, doc_series, doc_number, issue_date,
                 total_pen, expense_bucket, expense_category, source_origin)
            VALUES ('20888888888', '01', 'F888', '1001', %s, 100.00, 'MERCHANDISE_PAYMENT', 'MERCHANDISE', 'ERP_APP');
            """,
            (date(2026, 9, 15),),
        )
        cur.execute("SAVEPOINT sp_dup_inv;")
        with pytest.raises(psycopg.errors.UniqueViolation):
            cur.execute(
                """
                INSERT INTO erp.purchase_invoices
                    (supplier_ruc, doc_type, doc_series, doc_number, issue_date,
                     total_pen, expense_bucket, expense_category, source_origin)
                VALUES ('20888888888', '01', 'F888', '1001', %s, 100.00, 'MERCHANDISE_PAYMENT', 'MERCHANDISE', 'ERP_APP');
                """,
                (date(2026, 9, 16),),
            )
        cur.execute("ROLLBACK TO SAVEPOINT sp_dup_inv;")


def test_payment_mode_not_null_enforced(db_tx: psycopg.Connection) -> None:
    with db_tx.cursor() as cur:
        wh_id, _ = _get_main_wh_and_acct(cur)
        cur.execute("SAVEPOINT sp_null_pm;")
        with pytest.raises(psycopg.errors.NotNullViolation):
            cur.execute(
                """
                INSERT INTO erp.sales_orders
                    (order_code, order_date, warehouse_id, customer_name_raw, payment_mode, total_pen, paid_pen, source_origin)
                VALUES ('TEST-SO-NULL-PM', %s, %s, 'NULL PM', NULL, 50.00, 0, 'ERP_APP');
                """,
                (date(2026, 9, 15), wh_id),
            )
        cur.execute("ROLLBACK TO SAVEPOINT sp_null_pm;")


def test_ar_payment_sync_trigger_updates_paid_balance_and_settled(db_tx: psycopg.Connection) -> None:
    with db_tx.cursor() as cur:
        wh_id, acct_id = _get_main_wh_and_acct(cur)
        order_id = _create_dummy_order(cur, wh_id, "TEST-SO-AR-001", payment_mode="CREDIT", total_pen=100.0)

        cur.execute("SELECT paid_pen, balance_due_pen, is_settled FROM erp.sales_orders WHERE order_id = %s;", (order_id,))
        assert cur.fetchone() == (Decimal("0.00"), Decimal("100.00"), False)

        cur.execute(
            """
            INSERT INTO erp.ar_payments (order_id, payment_date, amount_pen, payment_mode, account_id, source_origin)
            VALUES (%s, %s, 40.00, 'CASH', %s, 'ERP_APP');
            """,
            (order_id, date(2026, 9, 16), acct_id),
        )
        cur.execute("SELECT paid_pen, balance_due_pen, is_settled FROM erp.sales_orders WHERE order_id = %s;", (order_id,))
        assert cur.fetchone() == (Decimal("40.00"), Decimal("60.00"), False)

        cur.execute(
            """
            INSERT INTO erp.ar_payments (order_id, payment_date, amount_pen, payment_mode, account_id, source_origin)
            VALUES (%s, %s, 60.00, 'TRANSFER', %s, 'ERP_APP');
            """,
            (order_id, date(2026, 9, 18), acct_id),
        )
        cur.execute("SELECT paid_pen, balance_due_pen, is_settled FROM erp.sales_orders WHERE order_id = %s;", (order_id,))
        assert cur.fetchone() == (Decimal("100.00"), Decimal("0.00"), True)
