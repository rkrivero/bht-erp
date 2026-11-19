"""Contract and transactional dev DB tests for migrations 020, 021, and 022."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

import psycopg
import psycopg.errors
import pytest

from bht_etl.db import get_connection
from bht_etl.normalize import build_normalized_dataset

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "db" / "migrations"


def test_migrations_020_022_declare_sql_contracts() -> None:
    sql_020 = (MIGRATIONS / "020_consolidate_caliper_and_brake_catalog.sql").read_text(encoding="utf-8")
    sql_021 = (MIGRATIONS / "021_flexible_stock_and_purchase_regularization.sql").read_text(encoding="utf-8")
    sql_022 = (MIGRATIONS / "022_operational_undo_audit.sql").read_text(encoding="utf-8")
    sql_023 = (MIGRATIONS / "023_correct_rony_caliper_5725_error.sql").read_text(encoding="utf-8")
    sql_024 = (MIGRATIONS / "024_adjust_caliper_5725_opening_stock.sql").read_text(encoding="utf-8")
    sql_025 = (MIGRATIONS / "025_close_historical_quotes_through_sep29.sql").read_text(encoding="utf-8")

    assert "CALIPER PARA TOYOTA BUFALO" in sql_020
    assert "CALIPER PARA TOYOTA 57-25" in sql_020
    assert "'47750-26120'" in sql_020
    assert "'47750-20480 R'" in sql_020
    assert "'31410-20150 LEFT-NEW'" in sql_020
    assert "'31410-20150 RIGHT-NEW'" in sql_020
    assert "OPENING_2026_06_26:D562-SET" in sql_020

    assert "UNPURCHASED_STOCK_DEFICIT" in sql_021
    assert "analytics.v_unpurchased_sales_regularization" in sql_021
    assert "formal_backed_qty" in sql_021
    assert "qty_to_regularize" in sql_021

    assert "erp.undoable_actions" in sql_022
    assert "trg_guard_undoable_actions_audit" in sql_022
    assert "UNDO_CANCEL" in sql_022
    assert "UNDO_STATUS" in sql_022

    assert "SO-2026-07-23-006" in sql_023
    assert "EXEL_RONY_CALIPER_ERROR_CORRECTED" in sql_023
    assert "47730-20480" in sql_023

    assert "OPENING_2026_06_26:47730-20480" in sql_024
    assert "47730-20480" in sql_024
    assert "OPENING_STOCK_2026_06_26_ADJUSTED" in sql_024

    assert "HISTORICAL_QUOTES_THROUGH_SEP29_CONVERTED" in sql_025
    assert "2026-09-29" in sql_025
    assert "'CONVERTED'" in sql_025


def test_etl_normalization_consolidates_calipers_and_opening_stock() -> None:
    ds = build_normalized_dataset(ROOT / "00_raw", ROOT / "config")
    prod_map = {p.sku: p for p in ds.products}

    for obsolete in ("47750-26120", "47730-20480 L", "47750-20480 R", "31410-20150 LEFT-NEW", "31410-20150 RIGHT-NEW"):
        assert obsolete not in prod_map

    assert prod_map["47730-26120"].name == "CALIPER PARA TOYOTA BUFALO"
    assert prod_map["47730-20480"].name == "CALIPER PARA TOYOTA 57-25"
    assert prod_map["47730-20480"].ref_cost_pen == 80.5882
    assert "31410-20150" in prod_map

    rony_order = next(o for o in ds.sales_orders if o.order_code == "SO-2026-07-23-006")
    assert rony_order.total_pen == 920.0
    assert [line.sku for line in rony_order.lines] == ["31410-20150"]
    sold_5725 = sum(
        line.quantity * line.pack_factor_applied
        for o in ds.sales_orders
        for line in o.lines
        if line.sku == "47730-20480"
    )
    assert sold_5725 == 208.0

    assert len(ds.opening_stocks) == 2
    assert {(op.sku, op.quantity_delta) for op in ds.opening_stocks} == {
        ("47730-20480", 4.0),
        ("D562-SET", 4210.0),
    }

    assert sum(1 for q in ds.raw_quotes if q.status == "OPEN") == 68
    assert sum(1 for q in ds.raw_quotes if q.status == "CONVERTED") == 138


def test_dev_catalog_consolidation_and_june26_stock_reconciliation() -> None:
    expected_eod_june26 = {
        "025200340010": Decimal("500.0000"),
        "31410-20150": Decimal("4940.0000"),
        "41200340000": Decimal("240.0000"),
        "47730-20480": Decimal("204.0000"),
        "47730-26120": Decimal("388.0000"),
        "CARPET VERDEX2MT": Decimal("120.0000"),
        "D2104-SET": Decimal("3960.0000"),
        "D562-SET": Decimal("4190.0000"),
        "FOCLED12W": Decimal("600.0000"),
        "FOCLED15W": Decimal("500.0000"),
        "TENT3X4": Decimal("30.0000"),
        "TENT5X6": Decimal("50.0000"),
    }

    with get_connection(branch="dev") as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT sku FROM erp.products
                WHERE sku IN ('47750-26120', '47730-20480 L', '47750-20480 R', '31410-20150 LEFT-NEW', '31410-20150 RIGHT-NEW');
                """
            )
            assert cur.fetchall() == []

            cur.execute(
                "SELECT sku, name, ref_cost_pen FROM erp.products WHERE sku IN ('47730-26120', '47730-20480') ORDER BY sku;"
            )
            assert cur.fetchall() == [
                ("47730-20480", "CALIPER PARA TOYOTA 57-25", Decimal("80.5882")),
                ("47730-26120", "CALIPER PARA TOYOTA BUFALO", Decimal("95.0000")),
            ]

            cur.execute(
                """
                SELECT p.sku,
                       COALESCE(SUM(im.quantity_delta) FILTER (
                           WHERE (im.movement_date AT TIME ZONE 'America/Lima')::date <= DATE '2026-06-26'
                       ), 0)::numeric(14,4)
                FROM erp.products p
                LEFT JOIN erp.inventory_movements im ON im.product_id = p.product_id
                WHERE p.sku = ANY(%s)
                GROUP BY p.sku;
                """,
                (list(expected_eod_june26.keys()),),
            )
            actual = dict(cur.fetchall())
            assert actual == expected_eod_june26

            cur.execute(
                """
                SELECT total_pen, paid_pen, balance_due_pen
                FROM erp.sales_orders
                WHERE order_code = 'SO-2026-07-23-006';
                """
            )
            assert cur.fetchone() == (Decimal("920.00"), Decimal("920.00"), Decimal("0.00"))

            cur.execute(
                """
                SELECT COUNT(*)::int
                FROM analytics.v_unpurchased_sales_regularization
                WHERE sku = '47730-20480';
                """
            )
            assert cur.fetchone() == (0,)

            cur.execute(
                """
                SELECT status::text, COUNT(*)::int
                FROM erp.quotes
                GROUP BY status
                ORDER BY status;
                """
            )
            assert cur.fetchall() == [("CONVERTED", 138), ("OPEN", 68)]


def test_regularization_view_tracks_unpurchased_sales_and_clears_on_formal_purchase() -> None:
    with get_connection(branch="dev") as conn:
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1;")
                wh_id = int(cur.fetchone()[0])

                cur.execute(
                    """
                    INSERT INTO erp.products (sku, name, category, unit_of_measure, fulfillment_mode, list_sale_price_pen, ref_cost_pen, cost_source)
                    VALUES ('000999TESTREG', 'PRODUCTO REGULARIZACION TEST', 'TEST', 'NIU', 'STOCKED', 100.00, 60.00, 'TEST')
                    RETURNING product_id;
                    """
                )
                prod_id = int(cur.fetchone()[0])

                # Formal invoice backs 10 units
                cur.execute(
                    """
                    INSERT INTO erp.inventory_movements
                        (warehouse_id, product_id, movement_date, movement_type, quantity_delta, unit_cost_pen, source_origin)
                    VALUES (%s, %s, %s, 'PURCHASE_IN', 10.0, 60.00, 'ERP_APP');
                    """,
                    (wh_id, prod_id, datetime(2026, 9, 10, 12, 0, tzinfo=timezone.utc)),
                )

                # Sell 14 units -> 4 units exceed formal invoice backing
                cur.execute(
                    """
                    INSERT INTO erp.sales_orders
                        (order_code, order_date, warehouse_id, customer_name_raw, payment_mode, operational_status, total_pen, paid_pen, source_origin)
                    VALUES ('TEST-SO-REG-001', %s, %s, 'CLIENTE REG TEST', 'CASH', 'REGISTERED', 1400.00, 1400.00, 'ERP_APP')
                    RETURNING order_id;
                    """,
                    (date(2026, 9, 15), wh_id),
                )
                order_id = int(cur.fetchone()[0])

                cur.execute(
                    """
                    INSERT INTO erp.sales_order_lines
                        (order_id, line_no, product_id, raw_description, quantity, pack_factor_applied,
                         unit_price_pen, line_total_pen, source_origin)
                    VALUES (%s, 1, %s, 'PRODUCTO REGULARIZACION TEST', 14, 1.0, 100.00, 1400.00, 'ERP_APP');
                    """,
                    (order_id, prod_id),
                )
                cur.execute(
                    """
                    INSERT INTO erp.inventory_movements
                        (warehouse_id, product_id, movement_date, movement_type, quantity_delta, unit_cost_pen, source_origin)
                    VALUES (%s, %s, %s, 'SALE_OUT', -14.0, 60.00, 'ERP_APP');
                    """,
                    (wh_id, prod_id, datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)),
                )

                cur.execute(
                    """
                    SELECT formal_backed_qty, sold_qty, qty_to_regularize, estimated_purchase_pen, has_sold_deficit
                    FROM analytics.v_unpurchased_sales_regularization
                    WHERE product_id = %s;
                    """,
                    (prod_id,),
                )
                assert cur.fetchone() == (
                    Decimal("10.0000"),
                    Decimal("14.0000"),
                    Decimal("4.0000"),
                    Decimal("240.00"),
                    True,
                )

                # Manual ADJUSTMENT must NOT erase supplier regularization deficit
                cur.execute(
                    """
                    INSERT INTO erp.inventory_movements
                        (warehouse_id, product_id, movement_date, movement_type, quantity_delta, unit_cost_pen, source_origin)
                    VALUES (%s, %s, %s, 'ADJUSTMENT', 4.0, 60.00, 'ERP_APP');
                    """,
                    (wh_id, prod_id, datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)),
                )
                cur.execute(
                    "SELECT qty_to_regularize FROM analytics.v_unpurchased_sales_regularization WHERE product_id = %s;",
                    (prod_id,),
                )
                assert cur.fetchone() == (Decimal("4.0000"),)

                # Formal PURCHASE_IN of 4 clears regularization completely
                cur.execute(
                    """
                    INSERT INTO erp.inventory_movements
                        (warehouse_id, product_id, movement_date, movement_type, quantity_delta, unit_cost_pen, source_origin)
                    VALUES (%s, %s, %s, 'PURCHASE_IN', 4.0, 60.00, 'ERP_APP');
                    """,
                    (wh_id, prod_id, datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc)),
                )
                cur.execute(
                    "SELECT COUNT(*) FROM analytics.v_unpurchased_sales_regularization WHERE product_id = %s;",
                    (prod_id,),
                )
                assert cur.fetchone() == (0,)
        finally:
            conn.rollback()


def test_undoable_actions_immutability_and_one_time_stamp_on_dev() -> None:
    with get_connection(branch="dev") as conn:
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT user_id FROM erp.app_users WHERE role = 'PARTNER_ADMIN' ORDER BY user_id LIMIT 1;")
                admin_id = int(cur.fetchone()[0])

                cur.execute(
                    """
                    INSERT INTO erp.undoable_actions
                        (action_type, entity_table, entity_id, entity_code, summary, actor_user_id, actor_role, undo_payload)
                    VALUES
                        ('QUOTE_STATUS_CHANGE', 'erp.quotes', '1', 'COT-TEST', 'Anuló cotización prueba', %s, 'PARTNER_ADMIN', '{"previousStatus":"OPEN"}'::jsonb)
                    RETURNING undo_id;
                    """,
                    (admin_id,),
                )
                undo_id = int(cur.fetchone()[0])

                # Deleting audit row must fail
                cur.execute("SAVEPOINT sp_del;")
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    cur.execute("DELETE FROM erp.undoable_actions WHERE undo_id = %s;", (undo_id,))
                cur.execute("ROLLBACK TO SAVEPOINT sp_del;")

                # Mutating immutable payload must fail
                cur.execute("SAVEPOINT sp_mut;")
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    cur.execute(
                        "UPDATE erp.undoable_actions SET summary = 'Alterado' WHERE undo_id = %s;",
                        (undo_id,),
                    )
                cur.execute("ROLLBACK TO SAVEPOINT sp_mut;")

                # Stamping undone_at once succeeds
                cur.execute(
                    """
                    UPDATE erp.undoable_actions
                       SET undone_at = NOW(),
                           undone_by_user_id = %s,
                           undone_reason = 'Prueba de reversión'
                     WHERE undo_id = %s;
                    """,
                    (admin_id, undo_id),
                )

                # Second update after already undone must fail
                cur.execute("SAVEPOINT sp_second;")
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    cur.execute(
                        "UPDATE erp.undoable_actions SET undone_reason = 'Segundo cambio' WHERE undo_id = %s;",
                        (undo_id,),
                    )
                cur.execute("ROLLBACK TO SAVEPOINT sp_second;")
        finally:
            conn.rollback()
