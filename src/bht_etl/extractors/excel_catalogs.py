"""Extractors for master products, cost catalogs, customer entities, and quotations."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import openpyxl

from bht_etl.extractors import json_safe, parse_date_flexible, parse_float, stable_hash


@dataclass(frozen=True)
class RawCatalogProduct:
    source_file: str
    sheet_name: str
    row_num: int
    sku: str
    name: str
    uom: str
    category: str
    cost_inc_igv: float | None
    sale_price_pen: float | None
    raw_payload: dict[str, Any]
    row_hash: str


@dataclass(frozen=True)
class RawCostCatalogRow:
    source_file: str
    sheet_name: str
    row_num: int
    prod_code: str
    name: str
    pack_factor: float
    unit_cost_pen: float | None
    sale_price_pen: float | None
    raw_payload: dict[str, Any]
    row_hash: str


@dataclass(frozen=True)
class RawEntityRow:
    source_file: str
    sheet_name: str
    row_num: int
    doc_type: str  # 'RUC' | 'DNI' | 'NONE'
    doc_number: str | None
    is_generic_doc: bool
    canonical_key: str
    legal_name: str
    trade_name: str | None
    address: str | None
    email: str | None
    phone: str | None
    raw_payload: dict[str, Any]
    row_hash: str


@dataclass(frozen=True)
class RawQuoteLine:
    line_no: int
    sku: str | None
    description: str
    quantity: float
    unit_price_pen: float
    line_total_pen: float


@dataclass(frozen=True)
class RawQuoteHeader:
    source_file: str
    sheet_name: str
    row_num: int
    quote_code: str
    issue_date: date
    doc_type: str
    customer_doc: str | None
    customer_name: str
    currency: str
    total_pen: float
    related_cpe: str | None
    status: str  # 'CONVERTED' | 'OPEN'
    notes: str | None
    lines: list[RawQuoteLine]
    raw_payload: dict[str, Any]
    row_hash: str


def extract_master_products(raw_dir: Path) -> list[RawCatalogProduct]:
    path = raw_dir / "excels" / "20614786851-PRODUCTS-261112231114.xlsx"
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    sheet_name = ws.title
    rows_out: list[RawCatalogProduct] = []
    headers: list[str] = []
    for r_idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
        if r_idx == 1:
            headers = [str(c or f"col_{i}") for i, c in enumerate(row)]
            continue
        if not row or not row[0]:
            continue
        payload = json_safe(dict(zip(headers, row)))
        sku = str(row[0]).strip()
        name = str(row[1] or sku).strip()
        uom = str(row[2] or "NIU").strip()
        cost_inc = parse_float(row[6])
        sale_p = parse_float(row[7])
        category = str((row[11] if len(row) > 11 else None) or (row[10] if len(row) > 10 else None) or "").strip()
        rows_out.append(
            RawCatalogProduct(
                source_file=path.name,
                sheet_name=sheet_name,
                row_num=r_idx,
                sku=sku,
                name=name,
                uom=uom,
                category=category,
                cost_inc_igv=cost_inc,
                sale_price_pen=sale_p,
                raw_payload=payload,
                row_hash=stable_hash(path.name, sheet_name, r_idx, sku),
            )
        )
    wb.close()
    return rows_out


def extract_cost_catalog(raw_dir: Path) -> list[RawCostCatalogRow]:
    path = raw_dir / "otros" / "COSTO DE PRODUCTO-PRECIO DE VENTA .xlsx"
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    sheet_name = ws.title
    rows_out: list[RawCostCatalogRow] = []
    headers: list[str] = []
    for r_idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
        if r_idx == 1:
            headers = [str(c or f"col_{i}") for i, c in enumerate(row)]
            continue
        if not row or not row[0]:
            continue
        payload = json_safe(dict(zip(headers, row)))
        rows_out.append(
            RawCostCatalogRow(
                source_file=path.name,
                sheet_name=sheet_name,
                row_num=r_idx,
                prod_code=str(row[0]).strip(),
                name=str(row[3] or "").strip(),
                pack_factor=parse_float(row[6]) or 1.0,
                unit_cost_pen=parse_float(row[7]),
                sale_price_pen=parse_float(row[8]),
                raw_payload=payload,
                row_hash=stable_hash(path.name, sheet_name, r_idx, row[0]),
            )
        )
    wb.close()
    return rows_out


def _map_doc_type(code: str | None) -> str:
    c = (code or "").strip()
    if c == "6":
        return "RUC"
    if c == "1":
        return "DNI"
    return "NONE"


def extract_entities(raw_dir: Path) -> list[RawEntityRow]:
    path = raw_dir / "excels" / "20614786851-ENTIDADES-261112231146.xlsx"
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    sheet_name = ws.title
    rows_out: list[RawEntityRow] = []
    headers: list[str] = []
    for r_idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
        if r_idx == 1:
            headers = [str(c or f"col_{i}").replace("\n", " ") for i, c in enumerate(row)]
            continue
        if not row or not row[2]:
            continue
        payload = json_safe(dict(zip(headers, row)))
        raw_dt = str(row[0] or "").strip()
        doc_type = _map_doc_type(raw_dt)
        doc_num = str(row[1] or "").strip() or None
        is_generic = doc_type == "NONE" or (doc_num is not None and doc_num.startswith("000000"))
        entity_idx = r_idx - 1
        ckey = f"ENTITY:{doc_num or 'NONE'}:{entity_idx}" if is_generic else f"{doc_type}:{doc_num}"
        rows_out.append(
            RawEntityRow(
                source_file=path.name,
                sheet_name=sheet_name,
                row_num=r_idx,
                doc_type=doc_type,
                doc_number=doc_num,
                is_generic_doc=is_generic,
                canonical_key=ckey,
                legal_name=str(row[2]).strip(),
                trade_name=str(row[3] or "").strip() or None,
                address=str(row[4] or "").strip() or None,
                email=str(row[5] or "").strip() or None,
                phone=str(row[8] or "").strip() or None,
                raw_payload=payload,
                row_hash=stable_hash(path.name, sheet_name, r_idx, ckey),
            )
        )
    wb.close()
    return rows_out


def _parse_quote_lines(detail_text: str | None) -> list[RawQuoteLine]:
    if not detail_text:
        return []
    lines: list[RawQuoteLine] = []
    for idx, block in enumerate(re.findall(r"\[(.*?)\]", str(detail_text), flags=re.S), start=1):
        fields: dict[str, str] = {}
        for part in block.split("|"):
            if "=" in part:
                k, v = part.split("=", 1)
                fields[k.strip().upper()] = v.strip()
        qty = parse_float(fields.get("CANT")) or 0.0
        vu = parse_float(fields.get("VU")) or 0.0
        tot = parse_float(fields.get("TOTAL")) or round(qty * vu, 2)
        if qty <= 0:
            continue
        lines.append(
            RawQuoteLine(
                line_no=idx,
                sku=fields.get("COD") or None,
                description=fields.get("DETALLE") or fields.get("COD") or "ITEM",
                quantity=qty,
                unit_price_pen=vu,
                line_total_pen=tot,
            )
        )
    return lines


def extract_quotes(raw_dir: Path, cutoff_date: date | None = None) -> list[RawQuoteHeader]:
    path = raw_dir / "excels" / "20614786851-COTIZACIONES-1-6-2026-12-11-2026.xlsx"
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    sheet_name = ws.title
    rows_out: list[RawQuoteHeader] = []
    headers: list[str] = []
    for r_idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
        if r_idx == 1:
            headers = [str(c or f"col_{i}") for i, c in enumerate(row)]
            continue
        if not row or not row[0]:
            continue
        issue_dt = parse_date_flexible(row[0])
        if not issue_dt:
            continue
        if cutoff_date and issue_dt < cutoff_date:
            continue
        payload = json_safe(dict(zip(headers, row)))
        num_str = str(row[2] or r_idx).strip()
        quote_code = f"COT-{num_str.zfill(6)}" if num_str.isdigit() else num_str
        rel_cpe = str(row[20] or "").strip() or None if len(row) > 20 else None
        rows_out.append(
            RawQuoteHeader(
                source_file=path.name,
                sheet_name=sheet_name,
                row_num=r_idx,
                quote_code=quote_code,
                issue_date=issue_dt,
                doc_type=_map_doc_type(str(row[3] or "")),
                customer_doc=str(row[4] or "").strip() or None,
                customer_name=str(row[5] or "CLIENTES VARIOS").strip(),
                currency="PEN" if str(row[6] or "SOLES").upper().startswith("SOL") else "USD",
                total_pen=parse_float(row[14]) or 0.0,
                related_cpe=rel_cpe,
                status="CONVERTED" if rel_cpe else "OPEN",
                notes=str(row[19] or "").strip() or None if len(row) > 19 else None,
                lines=_parse_quote_lines(row[18] if len(row) > 18 else None),
                raw_payload=payload,
                row_hash=stable_hash(path.name, sheet_name, r_idx, quote_code),
            )
        )
    wb.close()
    return rows_out
