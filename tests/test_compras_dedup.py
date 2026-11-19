"""Unit tests for COMPRAS deduplication, cutoff window, and line anomaly overrides."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from bht_etl.config import load_expense_config
from bht_etl.extractors.excel_compras import extract_compras_files
from bht_etl.normalize import build_normalized_dataset

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "00_raw"
CONFIG_DIR = ROOT / "config"


def test_compras_cutoff_and_supporting_purchase_window() -> None:
    cfg = load_expense_config(CONFIG_DIR)
    all_rows, deduped = extract_compras_files(RAW_DIR, cfg)

    assert len(all_rows) > len(deduped) > 0
    assert any(inv.issue_date < date(2026, 6, 23) for inv in all_rows)

    for inv in deduped:
        assert inv.issue_date >= date(2026, 6, 23)


def test_f602_14172_dedup_and_fqq1_139_override() -> None:
    ds = build_normalized_dataset(RAW_DIR, CONFIG_DIR)

    f602 = [inv for inv in ds.purchase_invoices if inv.doc_series == "F602" and inv.doc_number == "14172"]
    assert len(f602) == 1
    assert f602[0].total_pen == pytest.approx(80542.86, abs=0.05)
    assert f602[0].currency_anomaly_flag is True

    fqq1_139 = [inv for inv in ds.purchase_invoices if inv.doc_series == "FQQ1" and inv.doc_number == "139"]
    assert len(fqq1_139) == 1
    tent_lines = [ln for ln in fqq1_139[0].lines if ln.sku == "TENT8X10"]
    assert len(tent_lines) == 1
    assert tent_lines[0].quantity == pytest.approx(3.0, abs=0.001)
    assert tent_lines[0].unit_cost_pen == pytest.approx(270.0, abs=0.05)
    assert tent_lines[0].line_total_pen == pytest.approx(810.0, abs=0.05)
    assert tent_lines[0].anomaly_flag is True

    flag_codes = {af.flag_code for af in ds.audit_flags}
    assert "PURCHASE_CURRENCY_MISMATCH_FIXED" in flag_codes
    assert "PURCHASE_LINE_QTY_PRICE_SWAP" in flag_codes
    assert "EXEL_QTY_PRICE_SWAPPED_CORRECTED" in flag_codes
