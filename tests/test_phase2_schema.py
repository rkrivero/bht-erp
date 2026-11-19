from __future__ import annotations

from bht_etl.db import get_connection


def test_phase2_users_and_min_price_initialized() -> None:
    with get_connection("dev") as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT username, role::text FROM erp.app_users ORDER BY user_id;")
            users = cur.fetchall()
            assert ("socio_admin", "PARTNER_ADMIN") in users
            assert ("socio_gerente", "PARTNER_MANAGER") in users
            assert ("vendedor1", "EXTERNAL_SELLER") in users
            assert ("almacen1", "WAREHOUSE_DELIVERY") in users
            assert ("reparto1", "WAREHOUSE_DELIVERY") in users

            cur.execute(
                "SELECT COUNT(*) FROM erp.products WHERE list_sale_price_pen IS NOT NULL AND min_sale_price_pen IS NULL;"
            )
            assert cur.fetchone()[0] == 0


def test_historical_orders_marked_delivered_and_debtors_view() -> None:
    with get_connection("dev") as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM erp.sales_orders WHERE source_origin = 'HISTORICAL_BACKFILL' AND operational_status <> 'DELIVERED';"
            )
            assert cur.fetchone()[0] == 0

            cur.execute(
                "SELECT COUNT(*), SUM(balance_due_pen) FROM analytics.v_debtors_aging WHERE aging_bucket = 'RED_30_PLUS';"
            )
            cnt, total_due = cur.fetchone()
            assert cnt == 13
            assert float(total_due) == 45745.00
            cur.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = 'analytics' AND table_name = 'v_debtors_aging' AND column_name IN ('promised_payment_date', 'promise_status');"
            )
            cols = {r[0] for r in cur.fetchall()}
            assert cols == {"promised_payment_date", "promise_status"}


def test_reconciled_qingdao_ap_and_preroute_cash_kpi() -> None:
    with get_connection("dev") as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COALESCE(SUM(ap.balance_due_pen), 0)
                FROM erp.ap_obligations ap
                JOIN erp.parties pa ON pa.party_id = ap.supplier_party_id
                WHERE pa.doc_number = '20610518398';
                """
            )
            assert float(cur.fetchone()[0]) == 51457.00

            cur.execute(
                """
                SELECT period_month::text, pre_route_foundational_outflow_pen
                FROM analytics.v_kpi_cash_and_reinvestment
                WHERE period_month = DATE '2026-06-01';
                """
            )
            row = cur.fetchone()
            assert row is not None
            assert float(row[1]) == 81267.86
