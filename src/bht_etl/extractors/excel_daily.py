"""Extractor for daily route sheets and cash reconciliation (EXEL BLUE HORIZON.xlsx)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

import openpyxl

from bht_etl.config import ExpenseClassificationConfig, normalize_text
from bht_etl.extractors import json_safe, parse_date_flexible, parse_float, stable_hash


@dataclass(frozen=True)
class RawDailyStageRow:
    source_file: str
    sheet_name: str
    row_num: int
    block_section: str  # 'LEFT_SALE' | 'RIGHT_EXPENSE' | 'ARQUEO' | 'IGNORED_SUMMARY'
    row_date: date | None
    raw_payload: dict[str, Any]
    row_hash: str


@dataclass(frozen=True)
class ExtractedSaleLine:
    source_file: str
    sheet_name: str
    row_num: int
    sale_date: date
    customer_name_raw: str
    product_desc_raw: str
    quantity: float
    pack_factor: float
    unit_price_pen: float
    line_total_pen: float
    payment_mode: str
    historical_status_assumed: bool
    payment_status_raw: str | None
    doc_ref: str | None
    explicit_debt_pen: float | None
    qty_price_swapped_flag: bool
    line_math_mismatch: bool
    row_hash: str


@dataclass(frozen=True)
class ExtractedDailyCashEvent:
    source_file: str
    sheet_name: str
    row_num: int
    tx_date: date
    description: str
    amount_pen: float
    expense_bucket: str | None
    expense_category: str
    is_internal_transfer: bool
    reference_doc: str | None
    account_code: str
    row_hash: str


@dataclass(frozen=True)
class ExtractedTripDeclaration:
    trip_code: str
    trip_date: date
    end_date: date | None
    source_sheet: str
    declared_gross_sales_pen: float | None
    declared_route_opex_pen: float | None
    declared_net_cash_pen: float | None
    notes: str | None


@dataclass
class DailyWorkbookExtraction:
    staged_rows: list[RawDailyStageRow]
    sale_lines: list[ExtractedSaleLine]
    cash_events: list[ExtractedDailyCashEvent]
    trip_declarations: list[ExtractedTripDeclaration]
    blocked_sensitive_count: int = 0


_RIGHT_SKIP_PATTERNS = re.compile(
    r"^(?:TOTAL|TOTAL\s+GASTOS|TOTAL\s+DEUDA|TOTAL\s+VENTAS|TOTAL\s+BANCARIZAR|"
    r"TOTAL\s+CTA|TOTAL\s+EN\s+CTA|GASTOS$|GAASTOS|SALDO|ANTERIOR|CAJA\s+CHICA|"
    r"ARQUE[O0]|VENTAS\s+TOTALES|DEUDA\s+ANTERIO|DEUDAS?\s+A?\s*QINGDAO|"
    r"FACTURA\s+FQQ1|NOTA\s+VENTA|BLUE\s+DEBE|3/4-10|REGULARIZAR|COMPRA$)",
    flags=re.I,
)


def _sheet_date_from_name(sheet_name: str) -> date | None:
    m = re.search(r"(\d{2})[-/](\d{2})[-/](\d{4})", sheet_name)
    if not m:
        return None
    try:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    except ValueError:
        return None


def _parse_payment_status(raw_status: Any, extra_status: Any = None) -> tuple[str, bool, str | None, float | None]:
    txt = str(raw_status).strip().upper() if raw_status is not None and str(raw_status).strip() else ""
    extra_txt = str(extra_status).strip().upper() if extra_status is not None and str(extra_status).strip() else ""
    m_doc = re.search(r"(F\w{3}-\d+|NOTA\s+DE\s+VENTA[^\n]*)", txt)
    doc_ref = m_doc.group(1).strip() if m_doc else None

    # Check secondary column (e.g. col H 'SALDO 220' alongside col G 'CANCELADO')
    if extra_txt:
        m_saldo = re.search(r"SALDO\s+(\d+(?:[.,]\d+)?)", extra_txt)
        if m_saldo:
            return "CREDIT", False, doc_ref, parse_float(m_saldo.group(1))

    if not txt:
        return "CASH", True, None, None

    if "DEBE" in txt or "CREDITO" in txt:
        # Check for partial/explicit debt amount such as 'DEBE 290' or 'DEBE 3000'
        debt = None
        m_num = re.search(r"DEBE\s+(\d+(?:[.,]\d+)?)", txt)
        if m_num:
            debt = parse_float(m_num.group(1))
        return "CREDIT", False, doc_ref, debt

    if "CANCELADO" in txt:
        return "CASH", False, doc_ref, None

    # Doc reference only (FQQ1-000153, NOTA DE VENTA NO BOLETEAR) -> payment mode wasn't stated
    return "CASH", True, doc_ref, None


def extract_daily_workbook(
    raw_dir: Path,
    expense_cfg: ExpenseClassificationConfig,
    catalog_price_lookup: dict[str, float] | None = None,
) -> DailyWorkbookExtraction:
    path = raw_dir / "excels" / "EXEL BLUE HORIZON.xlsx"
    wb = openpyxl.load_workbook(path, data_only=True)
    result = DailyWorkbookExtraction(staged_rows=[], sale_lines=[], cash_events=[], trip_declarations=[])
    price_map = catalog_price_lookup or {}

    try:
        sheets_2026 = [s for s in wb.sheetnames if "2026" in s]
        for sheet_name in sheets_2026:
            ws = wb[sheet_name]
            if "ARQUEO" in sheet_name.upper():
                _extract_arqueo_sheet(path.name, sheet_name, ws, expense_cfg, result)
                continue

            sheet_dt = _sheet_date_from_name(sheet_name)
            if not sheet_dt or sheet_dt < expense_cfg.cutoff_date:
                continue

            hdr_d = str(ws.cell(1, 4).value or "").upper()
            d_is_qty = "CANT" in hdr_d
            right_col_is_text_then_val = True

            # Some sheets (e.g. '24-08-2026') place an expense item directly in row 1 right block (I1:J1)
            row1_vals = [ws.cell(1, c).value for c in range(1, min(ws.max_column, 18) + 1)]
            if row1_vals and not expense_cfg.is_sensitive_row(row1_vals):
                row1_right = row1_vals[8:16]
                if (
                    len(row1_right) >= 2
                    and isinstance(row1_right[0], str)
                    and row1_right[0].strip()
                    and (parse_float(row1_right[1]) or 0.0) > 0
                ):
                    _extract_right_cash_item(path.name, sheet_name, sheet_dt, 1, row1_right, expense_cfg, result)

            for r_idx in range(2, ws.max_row + 1):
                row_vals = [ws.cell(r_idx, c).value for c in range(1, min(ws.max_column, 18) + 1)]
                if not any(v is not None for v in row_vals):
                    continue

                if expense_cfg.is_sensitive_row(row_vals):
                    result.blocked_sensitive_count += 1
                    continue

                left = row_vals[:8]
                right = row_vals[8:16]
                a, b, c, d, e, f, g, _h = left

                # 1. Left-side sale lines vs cash notes/summaries
                b_date = b.date() if isinstance(b, datetime) else (b if isinstance(b, date) else None)
                if b_date and b_date >= date(2026, 6, 26) and isinstance(c, str) and c.strip():
                    qty_raw = parse_float(d if d_is_qty else e)
                    price_raw = parse_float(e if d_is_qty else d)
                    tot_raw = parse_float(f)
                    if qty_raw is not None and price_raw is not None and qty_raw > 0 and price_raw >= 0:
                        qty, price = qty_raw, price_raw
                        swapped = False
                        cat_p = price_map.get(normalize_text(c))
                        if cat_p and cat_p > 0 and qty != price:
                            rel_price = abs(price - cat_p) / cat_p
                            rel_qty = abs(qty - cat_p) / cat_p
                            if rel_price > 0.35 and rel_qty <= 0.12:
                                qty, price = price, qty
                                swapped = True

                        # Detect box/hundred pack sale on 12W LED bulbs sold per 100-unit carton
                        pack_factor = 100.0 if ("FOCO LED 12" in normalize_text(c) and price >= 300.0) else 1.0
                        line_total = round(tot_raw if tot_raw is not None else qty * price, 2)
                        mismatch = abs((qty * price) - line_total) > 0.05
                        if mismatch:
                            line_total = round(qty * price, 2)

                        pay_mode, assumed, doc_ref, debt_pen = _parse_payment_status(g, _h)
                        raw_status_parts = [str(x).strip() for x in (g, _h) if x is not None and str(x).strip()]
                        raw_status_joined = (
                            f"{str(g).strip()} | {str(_h).strip()}"
                            if debt_pen is not None and _h is not None and str(_h).strip() and g is not None and str(g).strip()
                            else (str(g).strip() if g is not None else (raw_status_parts[0] if debt_pen is not None and raw_status_parts else None))
                        )
                        rh = stable_hash(path.name, sheet_name, r_idx, "LEFT_SALE", left)
                        result.staged_rows.append(
                            RawDailyStageRow(
                                source_file=path.name,
                                sheet_name=sheet_name,
                                row_num=r_idx,
                                block_section="LEFT_SALE",
                                row_date=b_date,
                                raw_payload=json_safe({"left": left}),
                                row_hash=rh,
                            )
                        )
                        result.sale_lines.append(
                            ExtractedSaleLine(
                                source_file=path.name,
                                sheet_name=sheet_name,
                                row_num=r_idx,
                                sale_date=b_date,
                                customer_name_raw=str(a or "CLIENTES VARIOS").strip(),
                                product_desc_raw=c.strip(),
                                quantity=qty,
                                pack_factor=pack_factor,
                                unit_price_pen=price,
                                line_total_pen=line_total,
                                payment_mode=pay_mode,
                                historical_status_assumed=assumed,
                                payment_status_raw=raw_status_joined,
                                doc_ref=doc_ref,
                                explicit_debt_pen=debt_pen,
                                qty_price_swapped_flag=swapped,
                                line_math_mismatch=mismatch,
                                row_hash=rh,
                            )
                        )
                elif any(v is not None for v in left):
                    _extract_left_cash_note(path.name, sheet_name, sheet_dt, r_idx, left, expense_cfg, result)

                # 2. Right-side daily expenses & bank deposits (columns I..O)
                if any(v is not None for v in right):
                    _extract_right_cash_item(path.name, sheet_name, sheet_dt, r_idx, right, expense_cfg, result)
    finally:
        wb.close()

    return result


def _extract_left_cash_note(
    source_file: str,
    sheet_name: str,
    sheet_dt: date,
    row_num: int,
    left: list[Any],
    expense_cfg: ExpenseClassificationConfig,
    result: DailyWorkbookExtraction,
) -> None:
    joined = " ".join(str(x) for x in left if x is not None).strip()
    upper = joined.upper()
    rh = stable_hash(source_file, sheet_name, row_num, "LEFT_NOTE", left)
    result.staged_rows.append(
        RawDailyStageRow(
            source_file=source_file,
            sheet_name=sheet_name,
            row_num=row_num,
            block_section="IGNORED_SUMMARY",
            row_date=sheet_dt,
            raw_payload=json_safe({"left": left}),
            row_hash=rh,
        )
    )
    if "JORGE CHAVEZ CONTADOR" in upper and parse_float(left[5]):
        amt = parse_float(left[5]) or 0.0
        if amt > 0:
            result.cash_events.append(
                ExtractedDailyCashEvent(
                    source_file=source_file,
                    sheet_name=sheet_name,
                    row_num=row_num,
                    tx_date=sheet_dt,
                    description="JORGE CHAVEZ CONTADOR",
                    amount_pen=amt,
                    expense_bucket="NON_OPEX_OR_CAPEX",
                    expense_category="ACCOUNTING_OR_LEGAL",
                    is_internal_transfer=False,
                    reference_doc=None,
                    account_code="CAJA_RUTA",
                    row_hash=stable_hash(rh, "CONTADOR"),
                )
            )
    elif "COMPRA QINGDAO" in upper and parse_float(left[5]):
        amt = parse_float(left[5]) or 0.0
        if amt > 0:
            result.cash_events.append(
                ExtractedDailyCashEvent(
                    source_file=source_file,
                    sheet_name=sheet_name,
                    row_num=row_num,
                    tx_date=sheet_dt,
                    description=f"COMPRA QINGDAO ({left[3] or ''})".strip(),
                    amount_pen=amt,
                    expense_bucket="MERCHANDISE_PAYMENT",
                    expense_category="MERCHANDISE_PAYMENT",
                    is_internal_transfer=False,
                    reference_doc="FQQ1-117",
                    account_code="CAJA_RUTA",
                    row_hash=stable_hash(rh, "QINGDAO_20_07"),
                )
            )
    elif "DEUDA DE SAMUEL" in upper and parse_float(left[3]):
        amt = parse_float(left[3]) or 0.0
        if amt > 0:
            result.cash_events.append(
                ExtractedDailyCashEvent(
                    source_file=source_file,
                    sheet_name=sheet_name,
                    row_num=row_num,
                    tx_date=sheet_dt,
                    description=f"DEUDA DE SAMUEL ({left[4] or ''})".strip(),
                    amount_pen=amt,
                    expense_bucket="NON_OPEX_OR_CAPEX",
                    expense_category="PRIOR_DEBT",
                    is_internal_transfer=False,
                    reference_doc="DEUDA_SAMUEL",
                    account_code="CUSTODIA_SAMUEL",
                    row_hash=stable_hash(rh, "DEUDA_SAMUEL"),
                )
            )
    elif ("DEPOSITO INTERBANK" in upper or "DEPOSITADO INTERBANK" in upper) and parse_float(left[3]):
        amt = parse_float(left[3]) or 0.0
        if amt > 0:
            desc = " ".join(str(x).strip() for x in left[:3] if x is not None and str(x).strip()) or "DEPOSITO INTERBANK"
            result.cash_events.append(
                ExtractedDailyCashEvent(
                    source_file=source_file,
                    sheet_name=sheet_name,
                    row_num=row_num,
                    tx_date=sheet_dt,
                    description=desc,
                    amount_pen=amt,
                    expense_bucket=None,
                    expense_category="BANK_DEPOSIT_TRANSFER",
                    is_internal_transfer=True,
                    reference_doc=None,
                    account_code="CAJA_RUTA",
                    row_hash=stable_hash(rh, "LEFT_DEPOSIT_XFER"),
                )
            )
    elif "ARQUEO DE CAJA" in upper or "TOTAL BRUTO" in upper or "TOTAL VENTAS" in upper:
        # Capture trip summary if present
        pass


def _extract_right_cash_item(
    source_file: str,
    sheet_name: str,
    sheet_dt: date,
    row_num: int,
    right: list[Any],
    expense_cfg: ExpenseClassificationConfig,
    result: DailyWorkbookExtraction,
) -> None:
    rh = stable_hash(source_file, sheet_name, row_num, "RIGHT_BLOCK", right)
    result.staged_rows.append(
        RawDailyStageRow(
            source_file=source_file,
            sheet_name=sheet_name,
            row_num=row_num,
            block_section="RIGHT_EXPENSE",
            row_date=sheet_dt,
            raw_payload=json_safe({"right": right}),
            row_hash=rh,
        )
    )

    label = str(right[0] or "").strip()
    val = parse_float(right[1])
    trailing_start = 2
    # Handle right-side expenses shifted one column right (cols J:K instead of I:J, e.g. 26-06 / 30-06 / 01-07)
    if right[0] is None and len(right) >= 3 and isinstance(right[1], str) and right[1].strip():
        shifted_val = parse_float(right[2])
        if shifted_val is not None and shifted_val > 0:
            label = right[1].strip()
            val = shifted_val
            trailing_start = 3

    # Handle staggered right-side sub-blocks (cols K..P) such as CANCELACION FACTURA FQQ1-000127 9285
    # or DEPOSITADO INTERBANK 18000 while skipping summary blocks.
    trailing = [v for v in right[trailing_start:] if v is not None]
    if len(trailing) >= 2 and isinstance(trailing[0], str):
        t_label = trailing[0].strip()
        t_val = parse_float(trailing[1])
        t_up = t_label.upper()
        if t_val and t_val > 0:
            if "CANCELACION FACTURA" in t_up:
                m_doc = re.search(r"(F\w{3}-\d+)", t_up)
                ref = m_doc.group(1) if m_doc else None
                result.cash_events.append(
                    ExtractedDailyCashEvent(
                        source_file=source_file,
                        sheet_name=sheet_name,
                        row_num=row_num,
                        tx_date=sheet_dt,
                        description=t_label,
                        amount_pen=t_val,
                        expense_bucket="MERCHANDISE_PAYMENT",
                        expense_category="MERCHANDISE_PAYMENT",
                        is_internal_transfer=False,
                        reference_doc=ref,
                        account_code="CAJA_RUTA",
                        row_hash=stable_hash(rh, "RIGHT_EXTRA"),
                    )
                )
            elif "DEPOSITADO INTERBANK" in t_up:
                result.cash_events.append(
                    ExtractedDailyCashEvent(
                        source_file=source_file,
                        sheet_name=sheet_name,
                        row_num=row_num,
                        tx_date=sheet_dt,
                        description=t_label,
                        amount_pen=t_val,
                        expense_bucket=None,
                        expense_category="BANK_DEPOSIT_TRANSFER",
                        is_internal_transfer=True,
                        reference_doc=None,
                        account_code="CAJA_RUTA",
                        row_hash=stable_hash(rh, "RIGHT_DEPOSIT_XFER"),
                    )
                )

    if not label or val is None or val <= 0:
        return
    if _RIGHT_SKIP_PATTERNS.search(label):
        return
    # Skip standalone date strings representing prior days
    if re.match(r"^\d{4}-\d{2}-\d{2}", label):
        return

    bucket, cat, is_xfer = expense_cfg.classify_daily_note(label)
    if cat == "CAPEX_ASSET" and "MOTO" in label.upper():
        return  # Recorded once from ARQUEO 15-07-2026 / FE86-1639
    result.cash_events.append(
        ExtractedDailyCashEvent(
            source_file=source_file,
            sheet_name=sheet_name,
            row_num=row_num,
            tx_date=sheet_dt,
            description=label,
            amount_pen=val,
            expense_bucket=bucket,
            expense_category=cat,
            is_internal_transfer=is_xfer,
            reference_doc=None,
            account_code="CAJA_RUTA",
            row_hash=stable_hash(rh, "RIGHT_PRIMARY"),
        )
    )


def _extract_arqueo_sheet(
    source_file: str,
    sheet_name: str,
    ws: Any,
    expense_cfg: ExpenseClassificationConfig,
    result: DailyWorkbookExtraction,
) -> None:
    """Parse ARQUEO 15-07-2026 reconciling campaign 2026-06-26..2026-07-01."""
    declared_gross = None
    declared_opex = None
    declared_net = None

    for r_idx in range(1, ws.max_row + 1):
        vals = [ws.cell(r_idx, c).value for c in range(1, min(ws.max_column, 16) + 1)]
        if not any(v is not None for v in vals) or expense_cfg.is_sensitive_row(vals):
            continue
        rh = stable_hash(source_file, sheet_name, r_idx, "ARQUEO", vals)
        result.staged_rows.append(
            RawDailyStageRow(
                source_file=source_file,
                sheet_name=sheet_name,
                row_num=r_idx,
                block_section="ARQUEO",
                row_date=date(2026, 7, 15),
                raw_payload=json_safe({"row": vals}),
                row_hash=rh,
            )
        )
        col_a = str(vals[0] or "").strip().upper()
        col_d = parse_float(vals[3])
        col_f = parse_float(vals[5])

        if "VENTAS DESDE" in col_a and col_f:
            declared_gross = col_f
        elif "GASTOS VIAJE" in col_a and col_f:
            declared_opex = col_f
        elif col_a == "TOTAL NETO" and col_f:
            declared_net = col_f
        elif col_d and col_d > 0 and col_a and col_a != "TOTAL":
            # Avoid double counting the 400 COMBUSTIBLE already recorded on 26-06, 30-06, 01-07
            amt = col_d - 400.0 if col_a == "COMBUSTIBLE" and col_d >= 860.0 else col_d
            if amt > 0:
                desc = f"ARQUEO {col_a}" + (" (INCREMENTAL OVER DAILY)" if col_a == "COMBUSTIBLE" else "")
                # Note: 26-06..01-07 daily sheets already recorded 72.0 (60 alimentos + 12 energizante)
                if "ALIMENTACION RUTA" in col_a and amt > 72.0:
                    amt = round(amt - 72.0, 2)
                bucket, cat, is_xfer = expense_cfg.classify_daily_note(col_a)
                result.cash_events.append(
                    ExtractedDailyCashEvent(
                        source_file=source_file,
                        sheet_name=sheet_name,
                        row_num=r_idx,
                        tx_date=date(2026, 7, 1),
                        description=desc,
                        amount_pen=amt,
                        expense_bucket=bucket,
                        expense_category=cat,
                        is_internal_transfer=is_xfer,
                        reference_doc="ARQUEO_15_07_2026",
                        account_code="CAJA_RUTA",
                        row_hash=stable_hash(rh, "ARQUEO_OPEX"),
                    )
                )

        # Check right side for DEPOSITO 15-07-2026 and COMPRA MOTO across staggered columns
        r_non = [v for v in vals[8:] if v is not None]
        if len(r_non) >= 2 and isinstance(r_non[0], str):
            right_label = r_non[0].strip().upper()
            right_val = parse_float(r_non[1])
            if right_val and right_val > 0:
                if "COMPRA MOTO" in right_label:
                    result.cash_events.append(
                        ExtractedDailyCashEvent(
                            source_file=source_file,
                            sheet_name=sheet_name,
                            row_num=r_idx,
                            tx_date=date(2026, 7, 15),
                            description="COMPRA MOTO (SOCOPUR FE86-1639)",
                            amount_pen=right_val,
                            expense_bucket="NON_OPEX_OR_CAPEX",
                            expense_category="CAPEX_ASSET",
                            is_internal_transfer=False,
                            reference_doc="FE86-1639",
                            account_code="INTERBANK_BHT",
                            row_hash=stable_hash(rh, "COMPRA_MOTO"),
                        )
                    )
                elif "DEPOSITO 15-07-2026" in right_label:
                    result.cash_events.append(
                        ExtractedDailyCashEvent(
                            source_file=source_file,
                            sheet_name=sheet_name,
                            row_num=r_idx,
                            tx_date=date(2026, 7, 15),
                            description=right_label,
                            amount_pen=right_val,
                            expense_bucket=None,
                            expense_category="BANK_DEPOSIT_TRANSFER",
                            is_internal_transfer=True,
                            reference_doc="ARQUEO_15_07_2026",
                            account_code="INTERBANK_BHT",
                            row_hash=stable_hash(rh, "DEPOSITO_15_07"),
                        )
                    )

    result.trip_declarations.append(
        ExtractedTripDeclaration(
            trip_code="TRIP-2026-06-26-CAMPAIGN-01",
            trip_date=date(2026, 6, 26),
            end_date=date(2026, 7, 1),
            source_sheet=sheet_name,
            declared_gross_sales_pen=declared_gross,
            declared_route_opex_pen=declared_opex,
            declared_net_cash_pen=declared_net,
            notes="Reconciles sales & campaign expenses from 26-06-2026 to 01-07-2026.",
        )
    )
