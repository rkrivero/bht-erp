"""Extractor for OCR/parsed PDF pages in cotizaciones-facturas.json."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from bht_etl.extractors import (
    json_safe,
    normalize_doc_ref,
    parse_date_flexible,
    parse_float,
    stable_hash,
)


class _HtmlTableParser(HTMLParser):
    """Lightweight stdlib HTML table parser extracting rows as lists of cell strings."""

    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._in_tr = False
        self._in_cell = False
        self._cur_row: list[str] = []
        self._cur_cell: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._in_tr = True
            self._cur_row = []
        elif tag in {"td", "th"} and self._in_tr:
            self._in_cell = True
            self._cur_cell = []

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self._in_cell:
            self._cur_row.append(" ".join("".join(self._cur_cell).split()))
            self._in_cell = False
        elif tag == "tr" and self._in_tr:
            if any(self._cur_row):
                self.rows.append(self._cur_row)
            self._in_tr = False

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._cur_cell.append(data)


def parse_html_table(html: str | None) -> list[list[str]]:
    if not html:
        return []
    parser = _HtmlTableParser()
    parser.feed(html)
    return parser.rows


@dataclass(frozen=True)
class RawJsonPageStage:
    source_file: str
    page_index: int
    doc_kind: str
    issuer_ruc: str | None
    doc_series: str | None
    doc_number: str | None
    raw_payload: dict[str, Any]
    row_hash: str


@dataclass(frozen=True)
class JsonPurchaseLine:
    line_no: int
    sku: str | None
    description: str
    uom: str
    quantity: float
    unit_cost_pen: float
    line_total_pen: float


@dataclass
class JsonSupplierDocument:
    supplier_ruc: str
    supplier_name: str
    doc_type: str  # '01' | 'NV'
    doc_series: str
    doc_number: str
    issue_date: date | None
    due_date: date | None
    total_pen: float
    payment_terms: str  # 'CONTADO' | 'CREDITO'
    page_numbers: list[int] = field(default_factory=list)
    lines: list[JsonPurchaseLine] = field(default_factory=list)


@dataclass
class JsonDocsExtraction:
    staged_pages: list[RawJsonPageStage]
    supplier_docs: list[JsonSupplierDocument]


def _classify_page(elements: list[dict[str, Any]]) -> tuple[str, str | None, str | None, str | None]:
    titles = " ".join(e.get("text") or "" for e in elements if e.get("type") == "Title")
    all_text = " ".join(e.get("text") or "" for e in elements)
    titles_u = titles.upper()
    all_u = all_text.upper()

    if not titles.strip():
        return "CONTINUATION_NO_TITLE", None, None, None

    if "20610518398" in titles_u or "QINGDAO" in all_u:
        m_fac = re.search(r"(FQQ1)\s*-\s*0*(\d+)", titles_u)
        if m_fac:
            ser, num = normalize_doc_ref(m_fac.group(1), m_fac.group(2))
            return "QINGDAO_FACTURA", "20610518398", ser, num
        m_nv = re.search(r"(\d{4})\s*-\s*0*(\d+)", titles_u)
        if "NOTA DE VENTA" in titles_u and m_nv:
            ser, num = m_nv.group(1), str(int(m_nv.group(2)))
            return "QINGDAO_NOTA_VENTA", "20610518398", ser, num

    if "20614786851" in titles_u or "COTIZACI" in titles_u:
        m_cot = re.search(r"COTIZACI[ÓO]N\s+0*(\d+)", titles_u)
        num = str(int(m_cot.group(1))) if m_cot else None
        return "BHT_COTIZACION", "20614786851", "COT", num

    return "OTHER", None, None, None


def _extract_lines_from_page(elements: list[dict[str, Any]], start_line_no: int = 1) -> tuple[list[JsonPurchaseLine], float | None]:
    lines: list[JsonPurchaseLine] = []
    total_pen: float | None = None
    line_no = start_line_no

    for el in elements:
        if el.get("type") != "Table":
            continue
        html = (el.get("metadata") or {}).get("text_as_html")
        rows = parse_html_table(html) if html else []
        if not rows:
            txt = el.get("text") or ""
            m_tot = re.search(r"TOTAL\s+S/\s*([\d,]+\.\d{2})", txt, flags=re.I)
            if m_tot:
                total_pen = parse_float(m_tot.group(1))
            continue

        # Iterate row-by-row because OCR sometimes merges line items and EXONERADA/TOTAL rows into one HTML table.
        for r in rows:
            first = (r[0] or "").strip().upper() if r else ""
            if not first:
                continue
            if any(h in " ".join(r).upper() for h in ("CANT.", "DESCRIPCIÓN", "DESCRIPCION")) and "IMPORTE" in " ".join(r).upper():
                continue
            if first.startswith(("EXONERADA", "INAFECTA", "GRAVADA", "IGV", "ISC", "OTROS")):
                continue
            if first.startswith("TOTAL"):
                val = parse_float(r[-1])
                if val is not None:
                    total_pen = val
                continue
            if len(r) < 5:
                continue
            qty = parse_float(r[0])
            if not qty or qty <= 0:
                continue
            if len(r) >= 7:
                uom, sku, desc = r[1], r[2], r[3]
                pu = parse_float(r[5]) or parse_float(r[4]) or 0.0
                imp = parse_float(r[6]) or round(qty * pu, 2)
            elif len(r) == 6:
                uom, sku, desc = r[1], r[2], r[3]
                pu = parse_float(r[4]) or 0.0
                imp = parse_float(r[5]) or round(qty * pu, 2)
            else:
                uom, sku, desc = "NIU", None, r[1]
                pu = parse_float(r[3]) or 0.0
                imp = parse_float(r[4]) or round(qty * pu, 2)

            lines.append(
                JsonPurchaseLine(
                    line_no=line_no,
                    sku=sku.strip() if sku else None,
                    description=desc.strip(),
                    uom=uom.strip() or "NIU",
                    quantity=qty,
                    unit_cost_pen=round(imp / qty, 4) if qty > 0 else pu,
                    line_total_pen=round(imp, 2),
                )
            )
            line_no += 1

    return lines, total_pen


def extract_json_documents(raw_dir: Path) -> JsonDocsExtraction:
    path = raw_dir / "otros" / "cotizaciones-facturas.json"
    with open(path, encoding="utf-8") as fh:
        payload = json.load(fh)

    pages_by_num: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for el in payload.get("elements", []):
        pno = int((el.get("metadata") or {}).get("page_number") or 0)
        pages_by_num[pno].append(el)

    staged: list[RawJsonPageStage] = []
    supplier_map: dict[tuple[str, str, str, str], JsonSupplierDocument] = {}
    last_supplier_key: tuple[str, str, str, str] | None = None

    for pno in sorted(pages_by_num):
        els = pages_by_num[pno]
        kind, ruc, series, num = _classify_page(els)
        page_summary = {
            "page_number": pno,
            "element_count": len(els),
            "texts": [(e.get("type"), (e.get("text") or "")[:300]) for e in els],
        }
        staged.append(
            RawJsonPageStage(
                source_file=path.name,
                page_index=pno,
                doc_kind=kind,
                issuer_ruc=ruc,
                doc_series=series,
                doc_number=num,
                raw_payload=json_safe(page_summary),
                row_hash=stable_hash(path.name, pno, kind, series, num),
            )
        )

        if kind in {"QINGDAO_FACTURA", "QINGDAO_NOTA_VENTA"} and ruc and series and num:
            doc_type = "NV" if kind == "QINGDAO_NOTA_VENTA" else "01"
            key = (ruc, doc_type, series, num)
            last_supplier_key = key

            all_text = "\n".join(e.get("text") or "" for e in els)
            m_em = re.search(r"FECHA\s+EMISI[ÓO]N[\s:]+(\d{2}/\d{2}/\d{4})", all_text, flags=re.I)
            m_vc = re.search(r"FECHA\s+DE\s+VENC\.?[\s:]+(\d{2}/\d{2}/\d{4})", all_text, flags=re.I)
            issue_dt = parse_date_flexible(m_em.group(1)) if m_em else None
            due_dt = parse_date_flexible(m_vc.group(1)) if m_vc else issue_dt
            terms = "CREDITO" if "CREDITO" in all_text.upper() or "CRÉDITO" in all_text.upper() else "CONTADO"

            lines, tot = _extract_lines_from_page(els, start_line_no=1)
            doc = supplier_map.get(key)
            if doc is None:
                doc = JsonSupplierDocument(
                    supplier_ruc=ruc,
                    supplier_name="QINGDAO TUOYUAN RIGGING HARDWARE E.I.R.L.",
                    doc_type=doc_type,
                    doc_series=series,
                    doc_number=num,
                    issue_date=issue_dt,
                    due_date=due_dt,
                    total_pen=tot or round(sum(l.line_total_pen for l in lines), 2),
                    payment_terms=terms,
                    page_numbers=[pno],
                    lines=lines,
                )
                supplier_map[key] = doc
            else:
                doc.page_numbers.append(pno)
                if tot is not None:
                    doc.total_pen = tot
                offset = len(doc.lines)
                for l in lines:
                    doc.lines.append(
                        JsonPurchaseLine(
                            line_no=offset + l.line_no,
                            sku=l.sku,
                            description=l.description,
                            uom=l.uom,
                            quantity=l.quantity,
                            unit_cost_pen=l.unit_cost_pen,
                            line_total_pen=l.line_total_pen,
                        )
                    )
        elif kind == "CONTINUATION_NO_TITLE" and last_supplier_key is not None:
            # Attach continuation page table lines only if the previous page was a Qingdao purchase document
            prev_doc = supplier_map.get(last_supplier_key)
            if prev_doc and any(e.get("type") == "Table" for e in els):
                lines, tot = _extract_lines_from_page(els, start_line_no=len(prev_doc.lines) + 1)
                prev_doc.page_numbers.append(pno)
                prev_doc.lines.extend(lines)
                if tot is not None:
                    prev_doc.total_pen = tot
        else:
            last_supplier_key = None

    return JsonDocsExtraction(
        staged_pages=staged,
        supplier_docs=sorted(supplier_map.values(), key=lambda d: (d.issue_date or date.min, d.doc_series, int(d.doc_number))),
    )
