"""Normalization, alias resolution, entity consolidation, and business classification."""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any

from bht_etl.config import (
    ExpenseClassificationConfig,
    PartyAliasEntry,
    ProductAliasEntry,
    load_expense_config,
    load_party_aliases,
    load_product_aliases,
    normalize_text,
)
from bht_etl.extractors import stable_hash
from bht_etl.extractors.excel_catalogs import (
    RawCatalogProduct,
    RawCostCatalogRow,
    RawEntityRow,
    RawQuoteHeader,
    extract_cost_catalog,
    extract_entities,
    extract_master_products,
    extract_quotes,
)
from bht_etl.extractors.excel_compras import (
    RawCompraInvoice,
    RawPurchaseItem,
    extract_compras_files,
    extract_purchase_items,
)
from bht_etl.extractors.excel_daily import (
    DailyWorkbookExtraction,
    ExtractedDailyCashEvent,
    ExtractedSaleLine,
    ExtractedTripDeclaration,
    extract_daily_workbook,
)
from bht_etl.extractors.json_docs import (
    JsonDocsExtraction,
    JsonSupplierDocument,
    extract_json_documents,
)


@dataclass(frozen=True)
class NormalizedProduct:
    sku: str
    name: str
    category: str
    uom: str
    fulfillment_mode: str  # 'STOCKED' | 'ON_DEMAND'
    list_sale_price_pen: float | None
    ref_cost_pen: float | None
    cost_source: str


@dataclass(frozen=True)
class NormalizedParty:
    canonical_key: str
    party_type: str  # 'CUSTOMER' | 'SUPPLIER' | 'BOTH' | 'EMPLOYEE_OR_PARTNER'
    doc_type: str
    doc_number: str | None
    is_generic_doc: bool
    legal_name: str
    trade_name: str | None
    address: str | None
    email: str | None
    phone: str | None


@dataclass(frozen=True)
class NormalizedPurchaseLine:
    line_no: int
    sku: str | None
    raw_description: str
    uom: str
    quantity: float
    unit_cost_pen: float
    line_total_pen: float
    anomaly_flag: bool
    row_hash: str


@dataclass(frozen=True)
class NormalizedPurchaseInvoice:
    supplier_canonical_key: str
    supplier_ruc: str
    supplier_name_raw: str
    doc_type: str
    doc_series: str
    doc_number: str
    issue_date: date
    due_date: date | None
    orig_currency: str
    exchange_rate: float
    orig_total: float
    total_pen: float
    expense_bucket: str
    expense_category: str
    currency_anomaly_flag: bool
    source_file: str
    raw_notes: str | None
    lines: list[NormalizedPurchaseLine] = field(default_factory=list)


@dataclass(frozen=True)
class NormalizedSalesOrderLine:
    line_no: int
    sku: str
    raw_description: str
    quantity: float
    pack_factor_applied: float
    unit_price_pen: float
    line_total_pen: float
    unit_cost_snapshot_pen: float | None
    fulfillment_mode: str
    fulfillment_status: str
    row_hash: str


@dataclass(frozen=True)
class NormalizedSalesOrder:
    order_code: str
    order_date: date
    trip_code: str
    customer_canonical_key: str | None
    customer_name_raw: str
    payment_mode: str
    historical_status_assumed: bool
    payment_status_raw: str | None
    doc_ref: str | None
    total_pen: float
    initial_paid_pen: float
    due_date: date | None
    source_file: str
    source_sheet: str
    source_row_num: int
    row_hash: str
    notes: str | None
    lines: list[NormalizedSalesOrderLine]


@dataclass(frozen=True)
class AuditFlagRecord:
    flag_code: str
    severity: str
    entity_table: str
    entity_id: str
    message: str
    details: dict[str, Any]
    source_origin: str = "HISTORICAL_BACKFILL"


@dataclass
class NormalizedDataset:
    raw_products: list[RawCatalogProduct]
    raw_entities: list[RawEntityRow]
    raw_quotes: list[RawQuoteHeader]
    raw_compras: list[RawCompraInvoice]
    raw_purchase_items: list[RawPurchaseItem]
    daily_extraction: DailyWorkbookExtraction
    json_extraction: JsonDocsExtraction
    products: list[NormalizedProduct]
    product_aliases: list[ProductAliasEntry]
    parties: list[NormalizedParty]
    party_aliases: list[PartyAliasEntry]
    trips: list[ExtractedTripDeclaration]
    purchase_invoices: list[NormalizedPurchaseInvoice]
    sales_orders: list[NormalizedSalesOrder]
    cash_events: list[ExtractedDailyCashEvent]
    audit_flags: list[AuditFlagRecord]


def build_normalized_dataset(raw_dir: Path, config_dir: Path) -> NormalizedDataset:
    """Extract all post-cutoff sources, normalize entities/SKUs, and prepare ERP payloads."""
    exp_cfg = load_expense_config(config_dir)
    prod_aliases_map = load_product_aliases(config_dir)
    party_aliases_map = load_party_aliases(config_dir)

    raw_products = extract_master_products(raw_dir)
    cost_catalog = extract_cost_catalog(raw_dir)
    raw_entities = extract_entities(raw_dir)
    raw_quotes = extract_quotes(raw_dir, cutoff_date=exp_cfg.cutoff_date)
    raw_compras_all, compras_dedup = extract_compras_files(raw_dir, exp_cfg)
    raw_purchase_items = extract_purchase_items(raw_dir, exp_cfg)
    json_res = extract_json_documents(raw_dir)

    # 1. Build SKU unit cost averages from ITEMS-COMPRAS, JSON docs, and COSTO DE PRODUCTO catalog
    ic_cost_totals: dict[str, tuple[float, float]] = defaultdict(lambda: (0.0, 0.0))
    for item in raw_purchase_items:
        amt, qty = ic_cost_totals[item.sku]
        ic_cost_totals[item.sku] = (amt + item.line_total_pen, qty + item.quantity)

    json_cost_totals: dict[str, tuple[float, float]] = defaultdict(lambda: (0.0, 0.0))
    for doc in json_res.supplier_docs:
        for line in doc.lines:
            if line.sku:
                amt, qty = json_cost_totals[line.sku]
                json_cost_totals[line.sku] = (amt + line.line_total_pen, qty + line.quantity)

    raw_prod_by_sku = {rp.sku: rp for rp in raw_products}
    costo_by_sku: dict[str, float] = {}
    for crow in cost_catalog:
        norm_cname = normalize_text(crow.name)
        alias_hit = prod_aliases_map.get(norm_cname)
        if (
            alias_hit
            and not alias_hit.needs_review
            and crow.unit_cost_pen is not None
            and alias_hit.sku not in costo_by_sku
        ):
            cost_val = crow.unit_cost_pen
            rp = raw_prod_by_sku.get(alias_hit.sku)
            if (
                crow.pack_factor > 1
                and crow.sale_price_pen is not None
                and rp is not None
                and rp.sale_price_pen is not None
                and abs((crow.sale_price_pen / crow.pack_factor) - rp.sale_price_pen) <= 0.05
            ):
                cost_val = round(crow.unit_cost_pen / crow.pack_factor, 4)
            costo_by_sku[alias_hit.sku] = cost_val

        # Map range-based belt rows (e.g. FAJA INDUSTRIAL ALLWYN TIPO B B41 AL B70 / B80 AL B100)
        m_faja = re.search(
            r"FAJA\s+INDUSTRIAL\s+ALLWYN\s+TIPO\s+([A-Z])\s+[A-Z]?(\d+)\s+AL\s+[A-Z]?(\d+)",
            norm_cname,
        )
        if m_faja and crow.unit_cost_pen is not None:
            faja_type = m_faja.group(1)
            lo_num, hi_num = int(m_faja.group(2)), int(m_faja.group(3))
            for rp in raw_products:
                m_sku = re.match(r"^ALL([A-Z])(\d+)$", rp.sku.strip().upper())
                if m_sku and m_sku.group(1) == faja_type:
                    sku_num = int(m_sku.group(2))
                    if lo_num <= sku_num <= hi_num and rp.sku not in costo_by_sku:
                        costo_by_sku[rp.sku] = crow.unit_cost_pen

    # 2. Canonical Products & price lookup for EXEL qty/price swap detection
    norm_products: list[NormalizedProduct] = []
    prod_by_sku: dict[str, NormalizedProduct] = {}
    catalog_price_lookup: dict[str, float] = {}

    for rp in raw_products:
        ref_cost: float | None = None
        cost_src = "MISSING"
        if rp.sku in ic_cost_totals and ic_cost_totals[rp.sku][1] > 0:
            amt, qty = ic_cost_totals[rp.sku]
            ref_cost = round(amt / qty, 4)
            cost_src = "ITEMS_COMPRAS_AVG"
        elif rp.sku in json_cost_totals and json_cost_totals[rp.sku][1] > 0:
            amt, qty = json_cost_totals[rp.sku]
            ref_cost = round(amt / qty, 4)
            cost_src = "QINGDAO_JSON_AVG"
        elif rp.sku in costo_by_sku:
            ref_cost = round(costo_by_sku[rp.sku], 4)
            cost_src = "COSTO_CATALOG"
        elif rp.cost_inc_igv is not None and rp.cost_inc_igv > 0:
            ref_cost = round(rp.cost_inc_igv, 4)
            cost_src = "PRODUCTS_FILE"

        mode = "ON_DEMAND" if rp.sku in exp_cfg.on_demand_skus else "STOCKED"
        np_obj = NormalizedProduct(
            sku=rp.sku,
            name=rp.name,
            category=rp.category or "GENERAL",
            uom=rp.uom,
            fulfillment_mode=mode,
            list_sale_price_pen=rp.sale_price_pen,
            ref_cost_pen=ref_cost,
            cost_source=cost_src,
        )
        norm_products.append(np_obj)
        prod_by_sku[rp.sku] = np_obj

    for alias_key, entry in prod_aliases_map.items():
        p_obj = prod_by_sku.get(entry.sku)
        if p_obj and p_obj.list_sale_price_pen:
            catalog_price_lookup[alias_key] = p_obj.list_sale_price_pen

    # 3. Extract Daily Workbook now that catalog_price_lookup is populated
    daily_res = extract_daily_workbook(raw_dir, exp_cfg, catalog_price_lookup=catalog_price_lookup)

    # 4. Canonical Parties map (ENTIDADES + COMPRAS suppliers + ALIASES_PARTIES canonical entries)
    parties_by_key: dict[str, NormalizedParty] = {}
    for ent in raw_entities:
        parties_by_key[ent.canonical_key] = NormalizedParty(
            canonical_key=ent.canonical_key,
            party_type="CUSTOMER",
            doc_type=ent.doc_type,
            doc_number=ent.doc_number,
            is_generic_doc=ent.is_generic_doc,
            legal_name=ent.legal_name,
            trade_name=ent.trade_name,
            address=ent.address,
            email=ent.email,
            phone=ent.phone,
        )

    for alias in party_aliases_map.values():
        if alias.canonical_key not in parties_by_key:
            doc_type = "RUC" if alias.canonical_key.startswith("RUC:") else ("DNI" if alias.canonical_key.startswith("DNI:") else "NONE")
            doc_num = alias.canonical_key.split(":", 1)[1] if doc_type in {"RUC", "DNI"} else None
            parties_by_key[alias.canonical_key] = NormalizedParty(
                canonical_key=alias.canonical_key,
                party_type=alias.party_type,
                doc_type=doc_type,
                doc_number=doc_num,
                is_generic_doc=False,
                legal_name=alias.canonical_name,
                trade_name=None,
                address=None,
                email=None,
                phone=None,
            )

    for inv in compras_dedup:
        skey = f"RUC:{inv.supplier_ruc}"
        if skey in parties_by_key:
            existing = parties_by_key[skey]
            ptype = "BOTH" if existing.party_type == "CUSTOMER" else existing.party_type
            parties_by_key[skey] = NormalizedParty(
                canonical_key=skey,
                party_type=ptype,
                doc_type="RUC",
                doc_number=inv.supplier_ruc,
                is_generic_doc=False,
                legal_name=existing.legal_name,
                trade_name=existing.trade_name,
                address=existing.address,
                email=existing.email,
                phone=existing.phone,
            )
        else:
            parties_by_key[skey] = NormalizedParty(
                canonical_key=skey,
                party_type="SUPPLIER",
                doc_type="RUC",
                doc_number=inv.supplier_ruc,
                is_generic_doc=False,
                legal_name=inv.supplier_name,
                trade_name=None,
                address=None,
                email=None,
                phone=None,
            )

    # Ensure Qingdao supplier exists even if missing from one file
    q_key = "RUC:20610518398"
    if q_key not in parties_by_key:
        parties_by_key[q_key] = NormalizedParty(
            canonical_key=q_key,
            party_type="SUPPLIER",
            doc_type="RUC",
            doc_number="20610518398",
            is_generic_doc=False,
            legal_name="QINGDAO TUOYUAN RIGGING HARDWARE E.I.R.L.",
            trade_name=None,
            address=None,
            email=None,
            phone=None,
        )

    # 5. Merge Purchase Invoices (COMPRAS + ITEMS-COMPRAS + JSON Supplier Docs)
    items_by_doc: dict[tuple[str, str, str], list[RawPurchaseItem]] = defaultdict(list)
    for it in raw_purchase_items:
        items_by_doc[(it.supplier_ruc, it.doc_series, it.doc_number)].append(it)

    json_docs_by_key: dict[tuple[str, str, str, str], JsonSupplierDocument] = {
        (d.supplier_ruc, d.doc_type, d.doc_series, d.doc_number): d for d in json_res.supplier_docs
    }

    merged_purchases: dict[tuple[str, str, str, str], NormalizedPurchaseInvoice] = {}
    audit_flags: list[AuditFlagRecord] = []

    def _build_lines_for_invoice(ruc: str, dtype: str, ser: str, num: str) -> list[NormalizedPurchaseLine]:
        ex_lines = items_by_doc.get((ruc, ser, num))
        if ex_lines:
            out: list[NormalizedPurchaseLine] = []
            for idx, it in enumerate(ex_lines, start=1):
                if it.anomaly_flag:
                    audit_flags.append(
                        AuditFlagRecord(
                            flag_code="PURCHASE_LINE_QTY_PRICE_SWAP",
                            severity="WARNING",
                            entity_table="erp.purchase_invoice_lines",
                            entity_id=f"{ruc}:{ser}:{num}:{it.sku}",
                            message=f"Corrected qty/unit cost swap on {ser}-{num} {it.sku} (qty=3, cost=270, total=810)",
                            details={"supplier_ruc": ruc, "doc": f"{ser}-{num}", "sku": it.sku},
                        )
                    )
                out.append(
                    NormalizedPurchaseLine(
                        line_no=idx,
                        sku=it.sku if it.sku in prod_by_sku else None,
                        raw_description=it.description,
                        uom=it.uom,
                        quantity=it.quantity,
                        unit_cost_pen=it.unit_cost_pen,
                        line_total_pen=it.line_total_pen,
                        anomaly_flag=it.anomaly_flag,
                        row_hash=it.row_hash,
                    )
                )
            return out

        jdoc = json_docs_by_key.get((ruc, dtype, ser, num))
        if jdoc and jdoc.lines:
            out = []
            for l in jdoc.lines:
                sku = l.sku if (l.sku and l.sku in prod_by_sku) else None
                qty, ucost, ltot = l.quantity, l.unit_cost_pen, l.line_total_pen
                anom_flag = False
                anom_key = f"{ruc}:{ser}:{num}:{sku}"
                if sku and anom_key in exp_cfg.purchase_anomalies:
                    anom = exp_cfg.purchase_anomalies[anom_key]
                    qty = float(anom["override_quantity"])
                    ucost = float(anom["override_unit_cost_pen"])
                    ltot = float(anom["override_line_total_pen"])
                    anom_flag = True
                out.append(
                    NormalizedPurchaseLine(
                        line_no=l.line_no,
                        sku=sku,
                        raw_description=l.description,
                        uom=l.uom,
                        quantity=qty,
                        unit_cost_pen=ucost,
                        line_total_pen=ltot,
                        anomaly_flag=anom_flag,
                        row_hash=stable_hash("JSON_LINE", ruc, ser, num, l.line_no, sku),
                    )
                )
            return out
        return []

    for inv in compras_dedup:
        if inv.currency_anomaly_flag:
            audit_flags.append(
                AuditFlagRecord(
                    flag_code="PURCHASE_CURRENCY_MISMATCH_FIXED",
                    severity="WARNING",
                    entity_table="erp.purchase_invoices",
                    entity_id=f"{inv.supplier_ruc}:{inv.doc_series}:{inv.doc_number}",
                    message=inv.raw_notes or f"Normalized converted USD/PEN anomaly on {inv.doc_series}-{inv.doc_number}",
                    details={"supplier_ruc": inv.supplier_ruc, "doc": f"{inv.doc_series}-{inv.doc_number}", "total_pen": inv.total_pen},
                )
            )
        merged_purchases[inv.dedup_key] = NormalizedPurchaseInvoice(
            supplier_canonical_key=f"RUC:{inv.supplier_ruc}",
            supplier_ruc=inv.supplier_ruc,
            supplier_name_raw=inv.supplier_name,
            doc_type=inv.doc_type,
            doc_series=inv.doc_series,
            doc_number=inv.doc_number,
            issue_date=inv.issue_date,
            due_date=None,
            orig_currency=inv.orig_currency,
            exchange_rate=inv.exchange_rate,
            orig_total=inv.orig_total,
            total_pen=inv.total_pen,
            expense_bucket=inv.expense_bucket,
            expense_category=inv.expense_category,
            currency_anomaly_flag=inv.currency_anomaly_flag,
            source_file=inv.source_file,
            raw_notes=inv.raw_notes,
            lines=_build_lines_for_invoice(inv.supplier_ruc, inv.doc_type, inv.doc_series, inv.doc_number),
        )

    for key, jdoc in json_docs_by_key.items():
        if key in merged_purchases or not jdoc.issue_date or jdoc.issue_date < exp_cfg.supporting_purchase_start_date:
            continue
        merged_purchases[key] = NormalizedPurchaseInvoice(
            supplier_canonical_key=f"RUC:{jdoc.supplier_ruc}",
            supplier_ruc=jdoc.supplier_ruc,
            supplier_name_raw=jdoc.supplier_name,
            doc_type=jdoc.doc_type,
            doc_series=jdoc.doc_series,
            doc_number=jdoc.doc_number,
            issue_date=jdoc.issue_date,
            due_date=jdoc.due_date,
            orig_currency="PEN",
            exchange_rate=1.0,
            orig_total=jdoc.total_pen,
            total_pen=jdoc.total_pen,
            expense_bucket="MERCHANDISE_PAYMENT",
            expense_category="MERCHANDISE",
            currency_anomaly_flag=False,
            source_file="cotizaciones-facturas.json",
            raw_notes=f"Extracted from PDF JSON pages {jdoc.page_numbers}",
            lines=_build_lines_for_invoice(jdoc.supplier_ruc, jdoc.doc_type, jdoc.doc_series, jdoc.doc_number),
        )

    # 6. Build Route Trips
    trips_by_code: dict[str, ExtractedTripDeclaration] = {
        t.trip_code: t for t in daily_res.trip_declarations
    }

    def _trip_code_for_date(dt: date) -> str:
        if date(2026, 6, 26) <= dt <= date(2026, 7, 1):
            return "TRIP-2026-06-26-CAMPAIGN-01"
        tcode = f"TRIP-{dt.isoformat()}"
        if tcode not in trips_by_code:
            trips_by_code[tcode] = ExtractedTripDeclaration(
                trip_code=tcode,
                trip_date=dt,
                end_date=dt,
                source_sheet=dt.strftime("%d-%m-%Y"),
                declared_gross_sales_pen=None,
                declared_route_opex_pen=None,
                declared_net_cash_pen=None,
                notes="Daily route trip generated from EXEL 2026",
            )
        return tcode

    # 7. Group daily sale lines into Sales Orders & resolve SKUs/Customers
    def _resolve_customer_key(name_raw: str) -> str:
        n = normalize_text(name_raw)
        if n in party_aliases_map:
            return party_aliases_map[n].canonical_key
        ckey = f"NAME:{n}"
        if ckey not in parties_by_key:
            parties_by_key[ckey] = NormalizedParty(
                canonical_key=ckey,
                party_type="CUSTOMER",
                doc_type="NONE",
                doc_number=None,
                is_generic_doc=False,
                legal_name=name_raw.strip().upper(),
                trade_name=None,
                address=None,
                email=None,
                phone=None,
            )
            party_aliases_map[n] = PartyAliasEntry(
                alias_raw=name_raw,
                alias_normalized=n,
                canonical_key=ckey,
                party_type="CUSTOMER",
                canonical_name=name_raw.strip().upper(),
                confidence=0.70,
                needs_review=True,
                source="RUNTIME_FALLBACK",
            )
        return ckey

    def _resolve_sku(desc_raw: str) -> str:
        n = normalize_text(desc_raw)
        if n in prod_aliases_map:
            return prod_aliases_map[n].sku
        raise KeyError(f"Unmapped EXEL product description {desc_raw!r} (norm={n!r})")

    grouped_blocks: list[list[tuple[ExtractedSaleLine, str, str]]] = []
    current_group: list[tuple[ExtractedSaleLine, str, str]] = []
    for sl in daily_res.sale_lines:
        ckey = _resolve_customer_key(sl.customer_name_raw)
        sku = _resolve_sku(sl.product_desc_raw)
        if not current_group:
            current_group.append((sl, ckey, sku))
            continue
        prev_sl, prev_ckey, _ = current_group[-1]
        same_sheet_cust = (sl.sheet_name == prev_sl.sheet_name) and (ckey == prev_ckey)
        # Split if different sheet/customer OR explicit payment mode change on same customer (unless trailing None continues CREDIT)
        prev_has_explicit_credit = any(item[0].payment_mode == "CREDIT" for item in current_group)
        explicit_flip = (
            (not sl.historical_status_assumed and sl.payment_mode != prev_sl.payment_mode)
            or (prev_has_explicit_credit and not sl.historical_status_assumed and sl.payment_mode == "CASH")
        )
        if same_sheet_cust and not explicit_flip:
            current_group.append((sl, ckey, sku))
        else:
            grouped_blocks.append(current_group)
            current_group = [(sl, ckey, sku)]
    if current_group:
        grouped_blocks.append(current_group)

    sales_orders: list[NormalizedSalesOrder] = []
    seq_per_date: dict[date, int] = defaultdict(int)

    for grp in grouped_blocks:
        first_sl, ckey, _ = grp[0]
        seq_per_date[first_sl.sale_date] += 1
        seq = seq_per_date[first_sl.sale_date]
        ocode = f"SO-{first_sl.sale_date.isoformat()}-{seq:03d}"
        tcode = _trip_code_for_date(first_sl.sale_date)

        # Determine order-level payment mode & partial debt (e.g. MERY LABERINTO DEBE 3000 block)
        explicit_debts = [item[0].explicit_debt_pen for item in grp if item[0].explicit_debt_pen is not None]
        has_credit = any(item[0].payment_mode == "CREDIT" for item in grp)
        order_total = round(sum(item[0].line_total_pen for item in grp), 2)

        if has_credit:
            order_pay_mode = "CREDIT"
            assumed_flag = False
            if explicit_debts:
                debt = min(sum(explicit_debts), order_total)
                initial_paid = round(max(order_total - debt, 0.0), 2)
            else:
                initial_paid = 0.0
        else:
            order_pay_mode = "CASH"
            assumed_flag = any(item[0].historical_status_assumed for item in grp)
            initial_paid = order_total

        raw_statuses = sorted({item[0].payment_status_raw for item in grp if item[0].payment_status_raw})
        doc_refs = sorted({item[0].doc_ref for item in grp if item[0].doc_ref})

        order_lines: list[NormalizedSalesOrderLine] = []
        for lno, (sl, _, sku) in enumerate(grp, start=1):
            p_obj = prod_by_sku[sku]
            if sl.qty_price_swapped_flag:
                audit_flags.append(
                    AuditFlagRecord(
                        flag_code="EXEL_QTY_PRICE_SWAPPED_CORRECTED",
                        severity="INFO",
                        entity_table="erp.sales_order_lines",
                        entity_id=f"{ocode}:{lno}",
                        message=f"Swapped D/E values corrected on {sl.sheet_name} r{sl.row_num} ({sl.product_desc_raw}: qty={sl.quantity}, price={sl.unit_price_pen})",
                        details={"sheet": sl.sheet_name, "row": sl.row_num, "sku": sku},
                    )
                )
            if sl.line_math_mismatch:
                audit_flags.append(
                    AuditFlagRecord(
                        flag_code="EXEL_LINE_MATH_NORMALIZED",
                        severity="WARNING",
                        entity_table="erp.sales_order_lines",
                        entity_id=f"{ocode}:{lno}",
                        message=f"Normalized line total mismatch on {sl.sheet_name} r{sl.row_num} ({sl.quantity} x {sl.unit_price_pen} = {sl.line_total_pen})",
                        details={"sheet": sl.sheet_name, "row": sl.row_num, "sku": sku},
                    )
                )
            order_lines.append(
                NormalizedSalesOrderLine(
                    line_no=lno,
                    sku=sku,
                    raw_description=sl.product_desc_raw,
                    quantity=sl.quantity,
                    pack_factor_applied=sl.pack_factor,
                    unit_price_pen=sl.unit_price_pen,
                    line_total_pen=sl.line_total_pen,
                    unit_cost_snapshot_pen=p_obj.ref_cost_pen,
                    fulfillment_mode=p_obj.fulfillment_mode,
                    fulfillment_status="FULFILLED",
                    row_hash=sl.row_hash,
                )
            )

        sales_orders.append(
            NormalizedSalesOrder(
                order_code=ocode,
                order_date=first_sl.sale_date,
                trip_code=tcode,
                customer_canonical_key=ckey,
                customer_name_raw=first_sl.customer_name_raw,
                payment_mode=order_pay_mode,
                historical_status_assumed=assumed_flag,
                payment_status_raw=" | ".join(raw_statuses) if raw_statuses else None,
                doc_ref=" | ".join(doc_refs) if doc_refs else None,
                total_pen=order_total,
                initial_paid_pen=initial_paid,
                due_date=None,
                source_file=first_sl.source_file,
                source_sheet=first_sl.sheet_name,
                source_row_num=first_sl.row_num,
                row_hash=stable_hash("ORDER", first_sl.sheet_name, first_sl.row_num, ocode),
                notes=f"Explicit debt recorded: {explicit_debts}" if explicit_debts else None,
                lines=order_lines,
            )
        )

    # Guarantee trip declarations exist for daily cash events as well
    for ce in daily_res.cash_events:
        _trip_code_for_date(ce.tx_date)

    return NormalizedDataset(
        raw_products=raw_products,
        raw_entities=raw_entities,
        raw_quotes=raw_quotes,
        raw_compras=raw_compras_all,
        raw_purchase_items=raw_purchase_items,
        daily_extraction=daily_res,
        json_extraction=json_res,
        products=norm_products,
        product_aliases=list(prod_aliases_map.values()),
        parties=list(parties_by_key.values()),
        party_aliases=list(party_aliases_map.values()),
        trips=sorted(trips_by_code.values(), key=lambda t: (t.trip_date, t.trip_code)),
        purchase_invoices=sorted(merged_purchases.values(), key=lambda p: (p.issue_date, p.doc_series, p.doc_number)),
        sales_orders=sales_orders,
        cash_events=daily_res.cash_events,
        audit_flags=audit_flags,
    )
