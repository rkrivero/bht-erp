"""Contract and transactional dev DB tests for migration 028 (stock_quants O(1) parity, system_settings & pin_hash retirement)."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

from bht_etl.db import get_connection

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "db" / "migrations"


def test_migration_028_declares_sql_contracts() -> None:
    sql_028 = (MIGRATIONS / "028_stock_quants_and_system_settings.sql").read_text(encoding="utf-8")

    assert "CREATE TABLE IF NOT EXISTS erp.stock_quants" in sql_028
    assert "CREATE OR REPLACE FUNCTION erp.fn_sync_stock_quants" in sql_028
    assert "CREATE OR REPLACE VIEW erp.v_current_stock" in sql_028
    assert "CREATE OR REPLACE FUNCTION erp.fn_guard_negative_stock" in sql_028
    assert "CREATE TABLE IF NOT EXISTS erp.system_settings" in sql_028
    assert "CREATE OR REPLACE FUNCTION erp.fn_get_setting_numeric" in sql_028
    assert "CREATE OR REPLACE FUNCTION erp.fn_get_setting_date" in sql_028
    assert "DROP COLUMN IF EXISTS pin_hash" in sql_028


def test_stock_quants_backfill_matches_sum_of_inventory_movements_on_dev() -> None:
    with get_connection(branch="dev") as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                WITH movement_totals AS (
                    SELECT
                        warehouse_id,
                        product_id,
                        COALESCE(SUM(quantity_delta), 0)::numeric(14,4) AS sum_qty
                    FROM erp.inventory_movements
                    GROUP BY warehouse_id, product_id
                )
                SELECT COUNT(*)::int
                FROM movement_totals mt
                FULL OUTER JOIN erp.stock_quants sq
                  ON sq.warehouse_id = mt.warehouse_id
                 AND sq.product_id = mt.product_id
                WHERE COALESCE(mt.sum_qty, 0) <> COALESCE(sq.qty_on_hand, 0);
                """
            )
            mismatches = cur.fetchone()[0]
            assert mismatches == 0


def test_stock_quants_trigger_maintains_o1_parity_across_insert_update_delete() -> None:
    with get_connection(branch="dev") as conn:
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT warehouse_id FROM erp.warehouses WHERE code = 'MAIN' LIMIT 1;")
                main_wh_id = int(cur.fetchone()[0])
                cur.execute("SELECT warehouse_id FROM erp.warehouses WHERE code = 'CAMIONETA_01' LIMIT 1;")
                alt_wh_id = int(cur.fetchone()[0])

                cur.execute(
                    """
                    INSERT INTO erp.products
                        (sku, name, category, unit_of_measure, fulfillment_mode, list_sale_price_pen, ref_cost_pen, cost_source)
                    VALUES ('TEST-QUANT-O1-001', 'Producto Stock Quants O1', 'TEST', 'NIU', 'STOCKED', 100.00, 60.00, 'TEST')
                    RETURNING product_id;
                    """
                )
                prod_id = int(cur.fetchone()[0])

                # 1. INSERT purchase movement (+25)
                cur.execute(
                    """
                    INSERT INTO erp.inventory_movements
                        (warehouse_id, product_id, movement_date, movement_type, quantity_delta, unit_cost_pen, source_origin)
                    VALUES (%s, %s, %s, 'PURCHASE_IN', 25.0000, 60.00, 'ERP_APP')
                    RETURNING movement_id;
                    """,
                    (main_wh_id, prod_id, datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)),
                )
                mov_in_id = int(cur.fetchone()[0])

                cur.execute(
                    "SELECT qty_on_hand FROM erp.stock_quants WHERE warehouse_id = %s AND product_id = %s;",
                    (main_wh_id, prod_id),
                )
                assert cur.fetchone()[0] == Decimal("25.0000")

                # 2. INSERT sale movement (-8)
                cur.execute(
                    """
                    INSERT INTO erp.inventory_movements
                        (warehouse_id, product_id, movement_date, movement_type, quantity_delta, unit_cost_pen, source_origin)
                    VALUES (%s, %s, %s, 'SALE_OUT', -8.0000, 60.00, 'ERP_APP')
                    RETURNING movement_id;
                    """,
                    (main_wh_id, prod_id, datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)),
                )
                mov_out_id = int(cur.fetchone()[0])

                cur.execute(
                    "SELECT stock_on_hand FROM erp.v_current_stock WHERE warehouse_id = %s AND product_id = %s;",
                    (main_wh_id, prod_id),
                )
                assert cur.fetchone()[0] == Decimal("17.0000")

                # 3. UPDATE sale movement quantity_delta (-8 -> -10) => net 15
                cur.execute(
                    "UPDATE erp.inventory_movements SET quantity_delta = -10.0000 WHERE movement_id = %s;",
                    (mov_out_id,),
                )
                cur.execute(
                    "SELECT qty_on_hand FROM erp.stock_quants WHERE warehouse_id = %s AND product_id = %s;",
                    (main_wh_id, prod_id),
                )
                assert cur.fetchone()[0] == Decimal("15.0000")

                # 4. UPDATE warehouse_id on movement (move -10 from MAIN to CAMIONETA_01)
                cur.execute(
                    "UPDATE erp.inventory_movements SET warehouse_id = %s WHERE movement_id = %s;",
                    (alt_wh_id, mov_out_id),
                )
                cur.execute(
                    "SELECT qty_on_hand FROM erp.stock_quants WHERE warehouse_id = %s AND product_id = %s;",
                    (main_wh_id, prod_id),
                )
                assert cur.fetchone()[0] == Decimal("25.0000")
                cur.execute(
                    "SELECT qty_on_hand FROM erp.stock_quants WHERE warehouse_id = %s AND product_id = %s;",
                    (alt_wh_id, prod_id),
                )
                assert cur.fetchone()[0] == Decimal("-10.0000")

                # 5. DELETE movements and verify exact parity with SUM(inventory_movements)
                cur.execute("DELETE FROM erp.inventory_movements WHERE movement_id = %s;", (mov_out_id,))
                cur.execute(
                    "SELECT qty_on_hand FROM erp.stock_quants WHERE warehouse_id = %s AND product_id = %s;",
                    (alt_wh_id, prod_id),
                )
                assert cur.fetchone()[0] == Decimal("0.0000")

                cur.execute("DELETE FROM erp.inventory_movements WHERE movement_id = %s;", (mov_in_id,))
                cur.execute(
                    "SELECT qty_on_hand FROM erp.stock_quants WHERE warehouse_id = %s AND product_id = %s;",
                    (main_wh_id, prod_id),
                )
                assert cur.fetchone()[0] == Decimal("0.0000")
        finally:
            conn.rollback()


def test_system_settings_seed_and_sql_helpers_on_dev() -> None:
    with get_connection(branch="dev") as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        erp.fn_get_setting_int('undo_window_minutes', 0),
                        erp.fn_get_setting_int('default_credit_days', 0),
                        erp.fn_get_setting_numeric('min_margin_pct', 0),
                        erp.fn_get_setting_numeric('route_opex_alert_pct', 0),
                        erp.fn_get_setting_numeric('drain_alert_pct', 0),
                        erp.fn_get_setting_date('kpi_cutoff_date', DATE '2020-01-01'),
                        erp.fn_get_setting_text('credit_limit_mode', ''),
                        erp.fn_get_setting_text('company_name', '');
                    """
                )
                assert cur.fetchone() == (
                    15,
                    7,
                    Decimal("20"),
                    Decimal("8"),
                    Decimal("30"),
                    date(2026, 6, 26),
                    "APPROVAL_GATE",
                    "Blue Horizon Trade",
                )

                # Updating a setting inside transaction reflects immediately via helper
                cur.execute(
                    "UPDATE erp.system_settings SET value_json = '21'::jsonb WHERE setting_key = 'default_credit_days';"
                )
                cur.execute("SELECT erp.fn_get_setting_int('default_credit_days', 7);")
                assert cur.fetchone()[0] == 21

                # Verify pin_hash column is dropped from erp.app_users
                cur.execute(
                    """
                    SELECT COUNT(*)::int
                    FROM information_schema.columns
                    WHERE table_schema = 'erp'
                      AND table_name = 'app_users'
                      AND column_name = 'pin_hash';
                    """
                )
                assert cur.fetchone()[0] == 0
        finally:
            conn.rollback()
