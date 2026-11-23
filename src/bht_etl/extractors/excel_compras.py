"""Extractors for monthly purchase invoice registers (COMPRAS) and itemized purchases."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import openpyxl

from bht_etl.config import ExpenseClassificationConfig, normalize_text
from bht_etl.extractors import json_safe, normalize_doc_ref, parse_date_flexible, parse_float, stable_hash


@dataclass(frozen=True)
class RawCompraInvoice:
    source_file: str
    sheet_name: str
    row_num: int
    issue_date: date
    doc_type: str
    doc_series: str
    doc_number: str
    supplier_ruc: str
    supplier_name: str
    orig_currency: str
    exchange_rate: float
    orig_total: float
    total_pen: float
    expense_bucket: str
    expense_category: str
    currency_anomaly_flag: bool
    raw_notes: str | None
    raw_payload: dict[str, Any]
    row_hash: str

    @property
    def dedup_key(self) -> tuple[str, str, str, str]:
        return (self.supplier_ruc, self.doc_type, self.doc_series, self.doc_number)


@dataclass(frozen=True)
class RawPurchaseItem:
    source_file: str
    sheet_name: str
    row_num: int
    issue_date: date
    doc_series: str
    doc_number: str
    supplier_ruc: str
    supplier_name: str
    currency: str
    exchange_rate: float
    uom: str
    sku: str
    description: str
    quantity: float
    unit_cost_pen: float
    line_total_pen: float
    anomaly_flag: bool
    raw_payload: dict[str, Any]
    row_hash: str


def _norm_header(val: Any) -> str:
    return normalize_text(str(val or "")).replace(" ", "")


def _doc_type_code(raw: Any) -> str:
    s = normalize_text(str(raw or "FACTURA"))
    if "NOTA DE VENT" in s or s == "NV":
        return "NV"
    if "BOLETA" in s:
        return "03"
    return "01"


def _find_compras_header(rows: list[tuple[Any, ...]]) -> tuple[int, dict[str, int]]:
    for idx, row in enumerate(rows[:10]):
        joined = [_norm_header(c) for c in row]
        if "FECHA" in joined and ("SERIE" in joined or "RUC" in joined):
            col_map: dict[str, int] = {}
            for col_i, h in enumerate(joined):
                if h == "FECHA":
                    col_map["fecha"] = col_i
                elif h == "TIPO":
                    col_map["tipo"] = col_i
                elif h == "SERIE":
                    col_map["serie"] = col_i
                elif h.startswith("NUM"):
                    col_map["numero"] = col_i
                elif h == "RUC":
                    col_map["ruc"] = col_i
                elif "RAZON" in h:
                    col_map["razon"] = col_i
                elif h.startswith("TOTAL"):
                    col_map["total"] = col_i
                elif h in {"MONEDA", "MOND"}:
                    col_map["moneda"] = col_i
                elif h in {"T/C", "TC"}:
                    col_map["tc"] = col_i
            return idx, col_map
    raise RuntimeError("Could not locate header row in COMPRAS worksheet.")


def extract_compras_files(
    raw_dir: Path,
    expense_cfg: ExpenseClassificationConfig,
) -> tuple[list[RawCompraInvoice], list[RawCompraInvoice]]:
    """Return (all_raw_rows, deduplicated_post_cutoff_rows) across June/July/August COMPRAS Excels."""
    files = [
        raw_dir / "excels" / "COMPRAS BLUE HORIZON A JUNIO 2026.xlsx",
        raw_dir / "excels" / "COMPRAS BLUE HORIZON JULIO  2026.xlsx",
        raw_dir / "excels" / "COMPRAS DE BLUE HORIZONT 08.2026.xlsx",
    ]
    all_rows: list[RawCompraInvoice] = []
    deduped: dict[tuple[str, str, str, str], RawCompraInvoice] = {}

    for path in files:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        ws = wb.active
        sheet_name = ws.title
        raw_matrix = list(ws.iter_rows(values_only=True))
        wb.close()
        if not raw_matrix:
            continue
        hdr_idx, cmap = _find_compras_header(raw_matrix)
        hdr_labels = [str(c or f"col_{i}").strip() for i, c in enumerate(raw_matrix[hdr_idx])]

        for offset, row in enumerate(raw_matrix[hdr_idx + 1 :], start=hdr_idx + 2):
            if not row or len(row) <= max(cmap.values()):
                continue
            issue_dt = parse_date_flexible(row[cmap["fecha"]])
            ruc_raw = str(row[cmap["ruc"]] or "").strip()
            if ruc_raw.endswith(".0"):
                ruc_raw = ruc_raw[:-2]
            if not issue_dt or not ruc_raw:
                continue

            doc_type = _doc_type_code(row[cmap["tipo"]] if "tipo" in cmap else "FACTURA")
            doc_series, doc_number = normalize_doc_ref(
                str(row[cmap["serie"]] or ""), row[cmap["numero"]]
            )
            supplier_name = str(row[cmap["razon"]] or ruc_raw).strip()
            currency_raw = (
                str(row[cmap["moneda"]] or "PEN").strip().upper()
                if "moneda" in cmap
                else "PEN"
            )
            orig_currency = "USD" if "USD" in currency_raw or "DOL" in currency_raw else "PEN"
            tc = parse_float(row[cmap["tc"]]) if "tc" in cmap else None
            exchange_rate = tc if (tc and tc > 0) else 1.0
            orig_total = parse_float(row[cmap["total"]]) or 0.0

            anomaly_key = f"{ruc_raw}:{doc_series}:{doc_number}"
            currency_anomaly = False
            notes = None
            if anomaly_key in expense_cfg.purchase_anomalies:
                anom = expense_cfg.purchase_anomalies[anomaly_key]
                total_pen = float(anom["override_total_pen"])
                orig_currency = anom.get("orig_currency", orig_currency)
                orig_total = float(anom.get("orig_total", orig_total))
                exchange_rate = float(anom.get("exchange_rate", exchange_rate))
                currency_anomaly = True
                notes = anom.get("reason")
            elif orig_currency == "USD":
                total_pen = round(orig_total * exchange_rate, 2)
            else:
                total_pen = round(orig_total, 2)

            bucket, category = expense_cfg.classify_supplier(ruc_raw, supplier_name)
            payload = json_safe(dict(zip(hdr_labels, row)))
            item = RawCompraInvoice(
                source_file=path.name,
                sheet_name=sheet_name,
                row_num=offset,
                issue_date=issue_dt,
                doc_type=doc_type,
                doc_series=doc_series,
                doc_number=doc_number,
                supplier_ruc=ruc_raw,
                supplier_name=supplier_name,
                orig_currency=orig_currency,
                exchange_rate=exchange_rate,
                orig_total=orig_total,
                total_pen=total_pen,
                expense_bucket=bucket,
                expense_category=category,
                currency_anomaly_flag=currency_anomaly,
                raw_notes=notes,
                raw_payload=payload,
                row_hash=stable_hash(path.name, sheet_name, offset, anomaly_key, orig_total),
            )
            all_rows.append(item)

            if issue_dt >= expense_cfg.supporting_purchase_start_date:
                existing = deduped.get(item.dedup_key)
                if existing is None or (item.currency_anomaly_flag and not existing.currency_anomaly_flag):
                    deduped[item.dedup_key] = item

    return all_rows, sorted(deduped.values(), key=lambda x: (x.issue_date, x.doc_series, x.doc_number))


def extract_purchase_items(
    raw_dir: Path,
    expense_cfg: ExpenseClassificationConfig,
) -> list[RawPurchaseItem]:
    path = raw_dir / "excels" / "20614786851-ITEMS-COMPRAS-1-6-2026-12-11-2026.xlsx"
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    sheet_name = ws.title
    rows_out: list[RawPurchaseItem] = []
    headers: list[str] = []

    for r_idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
        if r_idx == 1:
            headers = [str(c or f"col_{i}").strip() for i, c in enumerate(row)]
            continue
        if not row or not row[0] or not row[8]:
            continue
        issue_dt = parse_date_flexible(row[0])
        if not issue_dt or issue_dt < expense_cfg.supporting_purchase_start_date:
            continue
        doc_series, doc_number = normalize_doc_ref(str(row[1] or ""), row[2])
        ruc = str(row[3] or "").strip()
        if ruc.endswith(".0"):
            ruc = ruc[:-2]
        sku = str(row[8]).strip()
        qty = parse_float(row[10]) or 0.0
        total_raw = parse_float(row[19]) or 0.0
        unit_val = parse_float(row[12]) or parse_float(row[11]) or 0.0
        currency = str(row[5] or "PEN").strip().upper()
        tc = parse_float(row[6]) or 1.0
        if currency == "USD" and tc > 0:
            total_pen = round(total_raw * tc, 2)
        else:
            total_pen = round(total_raw, 2)

        anomaly_flag = False
        anom_key = f"{ruc}:{doc_series}:{doc_number}:{sku}"
        if anom_key in expense_cfg.purchase_anomalies:
            anom = expense_cfg.purchase_anomalies[anom_key]
            qty = float(anom["override_quantity"])
            unit_cost_pen = float(anom["override_unit_cost_pen"])
            total_pen = float(anom["override_line_total_pen"])
            anomaly_flag = True
        elif qty > 0:
            unit_cost_pen = round(total_pen / qty, 4)
        else:
            unit_cost_pen = round(unit_val * (tc if currency == "USD" else 1.0), 4)

        payload = json_safe(dict(zip(headers, row)))
        rows_out.append(
            RawPurchaseItem(
                source_file=path.name,
                sheet_name=sheet_name,
                row_num=r_idx,
                issue_date=issue_dt,
                doc_series=doc_series,
                doc_number=doc_number,
                supplier_ruc=ruc,
                supplier_name=str(row[4] or ruc).strip(),
                currency="USD" if currency == "USD" else "PEN",
                exchange_rate=tc if tc > 0 else 1.0,
                uom=str(row[7] or "NIU").strip(),
                sku=sku,
                description=str(row[9] or sku).strip(),
                quantity=qty,
                unit_cost_pen=unit_cost_pen,
                line_total_pen=total_pen,
                anomaly_flag=anomaly_flag,
                raw_payload=payload,
                row_hash=stable_hash(path.name, sheet_name, r_idx, anom_key, qty, total_pen),
            )
        )
    wb.close()
    return rows_out
