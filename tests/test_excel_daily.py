"""Unit tests for daily Excel route sheet extraction and sensitive-row blocking."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from bht_etl.config import load_expense_config, normalize_text
from bht_etl.extractors.excel_daily import extract_daily_workbook
from bht_etl.normalize import build_normalized_dataset

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "00_raw"
CONFIG_DIR = ROOT / "config"

FORBIDDEN_TERMS = ("CHARO", "SORAYDA", "PRIMER JEFE", "PREGUNTAS SEGURIDAD")


def test_daily_extraction_blocks_sensitive_bcp_rows() -> None:
    cfg = load_expense_config(CONFIG_DIR)
    daily = extract_daily_workbook(RAW_DIR, cfg)

    assert daily.blocked_sensitive_count == 4

    for row in daily.staged_rows:
        payload_text = str(row.raw_payload).upper()
        for term in FORBIDDEN_TERMS:
            assert term not in payload_text, f"Sensitive term {term} leaked into staged_rows: {row.sheet_name} r{row.row_num}"

    for ev in daily.cash_events:
        desc_u = ev.description.upper()
        for term in FORBIDDEN_TERMS:
            assert term not in desc_u, f"Sensitive term {term} leaked into cash_events: {ev.sheet_name} r{ev.row_num}"


def test_daily_column_orientation_flip_and_explicit_swaps() -> None:
    ds = build_normalized_dataset(RAW_DIR, CONFIG_DIR)
    daily = ds.daily_extraction

    june26_lines = [s for s in daily.sale_lines if s.sheet_name == "26-06-2026"]
    july23_lines = [s for s in daily.sale_lines if s.sheet_name == "23-07-2026"]

    assert len(june26_lines) > 0
    assert len(july23_lines) > 0

    for line in june26_lines + july23_lines:
        assert line.quantity > 0
        assert not line.product_desc_raw.strip().isdigit()
        assert line.line_total_pen > 0

    swap_17 = [s for s in daily.sale_lines if s.sheet_name == "17-07-2026" and s.row_num == 4]
    assert len(swap_17) == 1
    assert swap_17[0].qty_price_swapped_flag is True
    assert swap_17[0].quantity == 36.0
    assert swap_17[0].unit_price_pen == 70.0
    assert swap_17[0].line_total_pen == 2520.0
    assert "ALFOMBRA VERDE" in normalize_text(swap_17[0].product_desc_raw)

    swap_18 = [s for s in daily.sale_lines if s.sheet_name == "18-07-2026" and s.row_num == 12]
    assert len(swap_18) == 1
    assert swap_18[0].qty_price_swapped_flag is True
    assert swap_18[0].quantity == 15.0
    assert swap_18[0].unit_price_pen == 10.0
    assert swap_18[0].line_total_pen == 150.0


def test_payment_modes_and_box_pack_factor() -> None:
    cfg = load_expense_config(CONFIG_DIR)
    daily = extract_daily_workbook(RAW_DIR, cfg)

    blank_cash = [s for s in daily.sale_lines if s.historical_status_assumed]
    assert len(blank_cash) > 0
    assert all(s.payment_mode == "CASH" for s in blank_cash)

    credit_lines = [s for s in daily.sale_lines if s.payment_mode == "CREDIT"]
    assert len(credit_lines) > 0
    assert any(s.explicit_debt_pen is not None and s.explicit_debt_pen > 0 for s in credit_lines)

    pack_lines = [s for s in daily.sale_lines if s.pack_factor > 1.0]
    assert len(pack_lines) > 0
    assert any(s.pack_factor == 100.0 and "FOCO" in normalize_text(s.product_desc_raw) for s in pack_lines)


def test_normalized_dataset_resolves_all_daily_skus_and_dates() -> None:
    ds = build_normalized_dataset(RAW_DIR, CONFIG_DIR)
    assert ds.daily_extraction.blocked_sensitive_count == 4
    assert len(ds.sales_orders) >= 150
    for order in ds.sales_orders:
        assert order.order_date >= date(2026, 6, 26)
        assert order.payment_mode in {"CASH", "CREDIT", "TRANSFER", "YAPE_PLIN", "MIXED"}
        for line in order.lines:
            assert line.sku, f"Missing canonical SKU on {order.order_code} line {line.line_no}"


def test_reconciled_product_costs_and_daily_cash_fixes() -> None:
    ds = build_normalized_dataset(RAW_DIR, CONFIG_DIR)
    prod_map = {p.sku: p for p in ds.products}

    assert prod_map["0212001099100"].ref_cost_pen == 20.0
    assert prod_map["0212001088100"].ref_cost_pen == 22.0
    assert prod_map["025200580010"].cost_source == "ITEMS_COMPRAS_AVG"
    assert prod_map["PSS-000282"].ref_cost_pen == 2.9
    assert prod_map["ALLB67"].ref_cost_pen == 10.0
    assert prod_map["ALLB68"].ref_cost_pen == 10.0
    assert prod_map["ALLB80"].ref_cost_pen == 15.0
    assert prod_map["TENT6x10"].ref_cost_pen is None

    # 24-08-2026 row 1 GASTOS VARIOS = S/ 1,000.00
    aug24_gv = [
        e for e in ds.cash_events if e.tx_date == date(2026, 8, 24) and "GASTOS VARIOS" in e.description.upper()
    ]
    assert len(aug24_gv) == 1
    assert aug24_gv[0].amount_pen == 1000.0
    assert aug24_gv[0].expense_bucket == "ROUTE_OPEX"
    assert aug24_gv[0].expense_category == "OTROS_RUTA"

    # Shifted J:K campaign-01 opex recovers S/ 472.00 -> S/ 1,890.40 total
    c01_opex = sum(
        e.amount_pen
        for e in ds.cash_events
        if date(2026, 6, 26) <= e.tx_date <= date(2026, 7, 1)
        and e.expense_bucket == "ROUTE_OPEX"
        and not e.is_internal_transfer
    )
    assert round(c01_opex, 2) == 1890.40

    # 5 internal bank transfers totaling S/ 51,140.00
    xfers = [e for e in ds.cash_events if e.is_internal_transfer]
    assert len(xfers) == 5
    assert round(sum(e.amount_pen for e in xfers), 2) == 51140.00

    # 17-07-2026 row 4 Eusebio Huantupa SALDO 220 -> CREDIT 2,520 total, 2,300 paid, 220 due
    eusebio = [
        o for o in ds.sales_orders if o.order_date == date(2026, 7, 17) and "EUSEBIO" in o.customer_canonical_key
    ]
    assert len(eusebio) == 1
    assert eusebio[0].payment_mode == "CREDIT"
    assert eusebio[0].total_pen == 2520.0
    assert eusebio[0].initial_paid_pen == 2300.0
