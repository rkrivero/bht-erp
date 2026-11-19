"""Unit tests for OCR JSON extraction (cotizaciones-facturas.json)."""

from __future__ import annotations

from pathlib import Path

import pytest

from bht_etl.extractors.json_docs import extract_json_documents

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "00_raw"


def test_json_supplier_docs_completeness_and_totals() -> None:
    res = extract_json_documents(RAW_DIR)

    assert len(res.staged_pages) == 242
    assert len(res.supplier_docs) == 20

    fqq1_nums = sorted(int(d.doc_number) for d in res.supplier_docs if d.doc_series == "FQQ1")
    nv_nums = sorted(int(d.doc_number) for d in res.supplier_docs if d.doc_type == "NV")
    assert len(fqq1_nums) == 18
    assert nv_nums == [2, 3]

    for doc in res.supplier_docs:
        assert doc.issue_date is not None, f"Missing issue_date on {doc.doc_series}-{doc.doc_number}"
        assert len(doc.lines) >= 1, f"No extracted lines on {doc.doc_series}-{doc.doc_number}"
        line_sum = sum(line.line_total_pen for line in doc.lines)
        assert line_sum == pytest.approx(doc.total_pen, abs=0.50), (
            f"Total mismatch on {doc.doc_series}-{doc.doc_number}: lines={line_sum} vs doc={doc.total_pen}"
        )
