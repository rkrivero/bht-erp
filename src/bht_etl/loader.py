"""Idempotent PostgreSQL / Neon loader populating raw_staging and erp schemas."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from psycopg.types.json import Jsonb

from bht_etl.db import get_connection
from bht_etl.extractors import stable_hash
from bht_etl.normalize import NormalizedDataset, build_normalized_dataset


@dataclass(frozen=True)
class LoadSummary:
    batch_id: int
    branch: str
    products: int
    parties: int
    purchase_invoices: int
    purchase_lines: int
    quotes: int
    sales_orders: int
    sales_lines: int
    inventory_movements: int
    cash_ledger_rows: int
    ar_payments: int
    ap_obligations: int
    audit_flags: int
    blocked_sensitive_rows: int
    inserted_deltas: dict[str, int] = field(default_factory=dict)


def _ts(dt_val: Any) -> datetime:
    return datetime(dt_val.year, dt_val.month, dt_val.day, 12, 0, tzinfo=timezone.utc)


def _snapshot_table_counts(cur: Any) -> dict[str, int]:
    cur.execute(
        """
        SELECT 'raw_excel_daily_rows', COUNT(*) FROM raw_staging.raw_excel_daily_rows
        UNION ALL SELECT 'raw_compras_invoices', COUNT(*) FROM raw_staging.raw_compras_invoices
        UNION ALL SELECT 'raw_purchase_items', COUNT(*) FROM raw_staging.raw_purchase_items
        UNION ALL SELECT 'raw_catalog_products', COUNT(*) FROM raw_staging.raw_catalog_products
        UNION ALL SELECT 'raw_catalog_entities', COUNT(*) FROM raw_staging.raw_catalog_entities
        UNION ALL SELECT 'raw_quotes_excel', COUNT(*) FROM raw_staging.raw_quotes_excel
        UNION ALL SELECT 'raw_json_doc_pages', COUNT(*) FROM raw_staging.raw_json_doc_pages
        UNION ALL SELECT 'erp_products', COUNT(*) FROM erp.products
        UNION ALL SELECT 'erp_product_aliases', COUNT(*) FROM erp.product_aliases
        UNION ALL SELECT 'erp_parties', COUNT(*) FROM erp.parties
        UNION ALL SELECT 'erp_party_aliases', COUNT(*) FROM erp.party_aliases
        UNION ALL SELECT 'erp_route_trips', COUNT(*) FROM erp.route_trips
        UNION ALL SELECT 'erp_purchase_invoices', COUNT(*) FROM erp.purchase_invoices
        UNION ALL SELECT 'erp_purchase_invoice_lines', COUNT(*) FROM erp.purchase_invoice_lines
        UNION ALL SELECT 'erp_quotes', COUNT(*) FROM erp.quotes
        UNION ALL SELECT 'erp_quote_lines', COUNT(*) FROM erp.quote_lines
        UNION ALL SELECT 'erp_sales_orders', COUNT(*) FROM erp.sales_orders
        UNION ALL SELECT 'erp_sales_order_lines', COUNT(*) FROM erp.sales_order_lines
        UNION ALL SELECT 'erp_inventory_movements', COUNT(*) FROM erp.inventory_movements
        UNION ALL SELECT 'erp_cash_ledger', COUNT(*) FROM erp.cash_ledger
        UNION ALL SELECT 'erp_ar_payments', COUNT(*) FROM erp.ar_payments
        UNION ALL SELECT 'erp_ap_obligations', COUNT(*) FROM erp.ap_obligations
        UNION ALL SELECT 'erp_audit_flags', COUNT(*) FROM erp.audit_flags;
        """
    )
    return {row[0]: int(row[1]) for row in cur.fetchall()}


def load_to_neon(
    branch: str = "dev",
    root: Path | None = None,
) -> LoadSummary:
    """Extract from 00_raw, normalize, and idempotently load raw_staging + erp tables."""
    from bht_etl.config import get_project_paths

    paths = get_project_paths(root)
    ds = build_normalized_dataset(paths.raw_dir, paths.config_dir)

    with get_connection(branch=branch, root=root) as conn:
        with conn.cursor() as cur:
            before_counts = _snapshot_table_counts(cur)
            cur.execute(
                """
                INSERT INTO raw_staging.etl_batches (target_branch, status, notes)
                VALUES (%s, 'RUNNING', 'Phase 1 historical backfill >= 2026-06-26')
                RETURNING batch_id;
                """,
                (branch,),
            )
            batch_id = cur.fetchone()[0]

            # 1. Stage raw tables idempotently
            _stage_raw_tables(cur, batch_id, ds)

            # 2. Load master tables: products, product_aliases, parties, party_aliases
            sku_to_id = _upsert_products_and_aliases(cur, ds)
            party_key_to_id = _upsert_parties_and_aliases(cur, ds)

            cur.execute("SELECT code, warehouse_id FROM erp.warehouses;")
            wh_map = dict(cur.fetchall())
            main_wh_id = wh_map["MAIN"]
            camioneta_wh_id = wh_map["CAMIONETA_01"]

            cur.execute("SELECT code, account_id FROM erp.cash_accounts WHERE is_active = TRUE;")
            acct_map = dict(cur.fetchall())
            caja_ruta_id = acct_map["CAJA_RUTA"]
            interbank_id = acct_map["INTERBANK_BHT"]
            bcp_id = acct_map["BCP_BHT"]

            # 3. Route Trips
            trip_map = _upsert_route_trips(cur, ds, camioneta_wh_id, caja_ruta_id)

            # 3b. Opening Stocks (verified as of cutoff_date, idempotent by source_row_hash)
            _load_opening_stocks(cur, ds, sku_to_id=sku_to_id, main_wh_id=main_wh_id)

            # 4. Purchase Invoices, Lines, Inventory PURCHASE_IN, & AP/Direct Bank Cash
            purchase_map = _load_purchases_and_stock_in(
                cur,
                ds,
                sku_to_id=sku_to_id,
                party_key_to_id=party_key_to_id,
                main_wh_id=main_wh_id,
                interbank_id=interbank_id,
                bcp_id=bcp_id,
            )

            # 5. Quotes & Quote Lines
            _load_quotes(cur, ds, sku_to_id=sku_to_id)

            # 6. Sales Orders, Sales Lines, AR Payments, Cash IN, & Inventory SALE_OUT
            so_count = _load_sales_and_stock_out(
                cur,
                ds,
                sku_to_id=sku_to_id,
                party_key_to_id=party_key_to_id,
                trip_map=trip_map,
                main_wh_id=main_wh_id,
                caja_ruta_id=caja_ruta_id,
            )

            # 7. Daily cash outflows & internal bank deposits
            _load_daily_cash_events(cur, ds, trip_map=trip_map, acct_map=acct_map)

            # 8. Audit flags (ETL anomalies + missing bank transfer visibility note)
            _load_audit_flags(cur, ds)

            after_counts = _snapshot_table_counts(cur)
            inserted_deltas = {k: after_counts[k] - before_counts[k] for k in after_counts}

            summary_stats = {
                "products": after_counts["erp_products"],
                "parties": after_counts["erp_parties"],
                "purchase_invoices": after_counts["erp_purchase_invoices"],
                "purchase_lines": after_counts["erp_purchase_invoice_lines"],
                "quotes": after_counts["erp_quotes"],
                "sales_orders": after_counts["erp_sales_orders"],
                "sales_lines": after_counts["erp_sales_order_lines"],
                "inventory_movements": after_counts["erp_inventory_movements"],
                "cash_ledger_rows": after_counts["erp_cash_ledger"],
                "ar_payments": after_counts["erp_ar_payments"],
                "ap_obligations": after_counts["erp_ap_obligations"],
                "audit_flags": after_counts["erp_audit_flags"],
                "blocked_sensitive_rows": ds.daily_extraction.blocked_sensitive_count,
                "inserted_deltas": inserted_deltas,
            }
            cur.execute(
                """
                UPDATE raw_staging.etl_batches
                   SET finished_at = NOW(),
                       status = 'SUCCEEDED',
                       summary_stats = %s
                 WHERE batch_id = %s;
                """,
                (Jsonb(summary_stats), batch_id),
            )
        conn.commit()

    return LoadSummary(
        batch_id=batch_id,
        branch=branch,
        products=len(ds.products),
        parties=len(ds.parties),
        purchase_invoices=len(purchase_map),
        purchase_lines=sum(len(p.lines) for p in ds.purchase_invoices),
        quotes=len(ds.raw_quotes),
        sales_orders=so_count,
        sales_lines=inserted_deltas["erp_sales_order_lines"],
        inventory_movements=inserted_deltas["erp_inventory_movements"],
        cash_ledger_rows=inserted_deltas["erp_cash_ledger"],
        ar_payments=inserted_deltas["erp_ar_payments"],
        ap_obligations=inserted_deltas["erp_ap_obligations"],
        audit_flags=after_counts["erp_audit_flags"],
        blocked_sensitive_rows=ds.daily_extraction.blocked_sensitive_count,
        inserted_deltas=inserted_deltas,
    )


def _stage_raw_tables(cur: Any, batch_id: int, ds: NormalizedDataset) -> None:
    if ds.daily_extraction.staged_rows:
        cur.executemany(
            """
            INSERT INTO raw_staging.raw_excel_daily_rows
                (batch_id, source_file, sheet_name, row_num, block_section, row_date, raw_payload, row_hash)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (row_hash) DO NOTHING;
            """,
            [
                (batch_id, r.source_file, r.sheet_name, r.row_num, r.block_section, r.row_date, Jsonb(r.raw_payload), r.row_hash)
                for r in ds.daily_extraction.staged_rows
            ],
        )

    if ds.raw_compras:
        cur.executemany(
            """
            INSERT INTO raw_staging.raw_compras_invoices
                (batch_id, source_file, sheet_name, row_num, issue_date, supplier_ruc, supplier_name,
                 doc_type, doc_series, doc_number, currency, exchange_rate, total_amount, raw_payload, row_hash)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (row_hash) DO NOTHING;
            """,
            [
                (
                    batch_id, r.source_file, r.sheet_name, r.row_num, r.issue_date, r.supplier_ruc,
                    r.supplier_name, r.doc_type, r.doc_series, r.doc_number, r.orig_currency,
                    r.exchange_rate, r.orig_total, Jsonb(r.raw_payload), r.row_hash,
                )
                for r in ds.raw_compras
            ],
        )

    if ds.raw_purchase_items:
        cur.executemany(
            """
            INSERT INTO raw_staging.raw_purchase_items
                (batch_id, source_file, sheet_name, row_num, raw_payload, row_hash)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (row_hash) DO NOTHING;
            """,
            [(batch_id, r.source_file, r.sheet_name, r.row_num, Jsonb(r.raw_payload), r.row_hash) for r in ds.raw_purchase_items],
        )

    if ds.raw_products:
        cur.executemany(
            """
            INSERT INTO raw_staging.raw_catalog_products
                (batch_id, source_file, sheet_name, row_num, raw_payload, row_hash)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (row_hash) DO NOTHING;
            """,
            [(batch_id, r.source_file, r.sheet_name, r.row_num, Jsonb(r.raw_payload), r.row_hash) for r in ds.raw_products],
        )

    if ds.raw_entities:
        cur.executemany(
            """
            INSERT INTO raw_staging.raw_catalog_entities
                (batch_id, source_file, sheet_name, row_num, raw_payload, row_hash)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (row_hash) DO NOTHING;
            """,
            [(batch_id, r.source_file, r.sheet_name, r.row_num, Jsonb(r.raw_payload), r.row_hash) for r in ds.raw_entities],
        )

    if ds.raw_quotes:
        cur.executemany(
            """
            INSERT INTO raw_staging.raw_quotes_excel
                (batch_id, source_file, sheet_name, row_num, raw_payload, row_hash)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (row_hash) DO NOTHING;
            """,
            [(batch_id, r.source_file, r.sheet_name, r.row_num, Jsonb(r.raw_payload), r.row_hash) for r in ds.raw_quotes],
        )

    if ds.json_extraction.staged_pages:
        cur.executemany(
            """
            INSERT INTO raw_staging.raw_json_doc_pages
                (batch_id, source_file, page_index, doc_kind, issuer_ruc, doc_series, doc_number, raw_payload, row_hash)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (row_hash) DO NOTHING;
            """,
            [
                (batch_id, r.source_file, r.page_index, r.doc_kind, r.issuer_ruc, r.doc_series, r.doc_number, Jsonb(r.raw_payload), r.row_hash)
                for r in ds.json_extraction.staged_pages
            ],
        )


def _upsert_products_and_aliases(cur: Any, ds: NormalizedDataset) -> dict[str, int]:
    cur.executemany(
        """
        INSERT INTO erp.products
            (sku, name, category, unit_of_measure, fulfillment_mode, list_sale_price_pen, ref_cost_pen, cost_source, source_origin)
        VALUES (%s, %s, %s, %s, %s::erp.fulfillment_mode, %s, %s, %s, 'HISTORICAL_BACKFILL')
        ON CONFLICT (sku) DO UPDATE SET
            ref_cost_pen = COALESCE(erp.products.ref_cost_pen, EXCLUDED.ref_cost_pen),
            cost_source = COALESCE(erp.products.cost_source, EXCLUDED.cost_source),
            updated_at = NOW();
        """,
        [
            (p.sku, p.name, p.category, p.uom, p.fulfillment_mode, p.list_sale_price_pen, p.ref_cost_pen, p.cost_source)
            for p in ds.products
        ],
    )
    cur.execute("SELECT sku, product_id FROM erp.products;")
    sku_to_id = dict(cur.fetchall())

    cur.executemany(
        """
        INSERT INTO erp.product_aliases
            (product_id, alias_raw, alias_normalized, pack_factor, confidence, needs_review, source)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (alias_normalized) DO UPDATE SET
            product_id = EXCLUDED.product_id,
            pack_factor = EXCLUDED.pack_factor,
            confidence = EXCLUDED.confidence,
            needs_review = EXCLUDED.needs_review,
            source = EXCLUDED.source;
        """,
        [
            (sku_to_id[a.sku], a.alias_raw, a.alias_normalized, a.pack_factor, a.confidence, a.needs_review, a.source)
            for a in ds.product_aliases
            if a.sku in sku_to_id
        ],
    )
    return sku_to_id


def _upsert_parties_and_aliases(cur: Any, ds: NormalizedDataset) -> dict[str, int]:
    cur.executemany(
        """
        INSERT INTO erp.parties
            (canonical_key, party_type, doc_type, doc_number, is_generic_doc, legal_name, trade_name, phone, email, address, source_origin)
        VALUES (%s, %s::erp.party_type, %s::erp.doc_id_type, %s, %s, %s, %s, %s, %s, %s, 'HISTORICAL_BACKFILL')
        ON CONFLICT (canonical_key) DO UPDATE SET
            party_type = CASE
                WHEN erp.parties.party_type <> EXCLUDED.party_type THEN 'BOTH'::erp.party_type
                ELSE erp.parties.party_type
            END,
            trade_name = COALESCE(erp.parties.trade_name, EXCLUDED.trade_name),
            phone = COALESCE(erp.parties.phone, EXCLUDED.phone),
            email = COALESCE(erp.parties.email, EXCLUDED.email),
            address = COALESCE(erp.parties.address, EXCLUDED.address),
            updated_at = NOW();
        """,
        [
            (
                p.canonical_key, p.party_type, p.doc_type, p.doc_number, p.is_generic_doc,
                p.legal_name, p.trade_name, p.phone, p.email, p.address,
            )
            for p in ds.parties
        ],
    )
    cur.execute("SELECT canonical_key, party_id FROM erp.parties;")
    key_to_id = dict(cur.fetchall())

    cur.executemany(
        """
        INSERT INTO erp.party_aliases
            (party_id, alias_raw, alias_normalized, confidence, needs_review, source)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (alias_normalized) DO UPDATE SET
            party_id = EXCLUDED.party_id,
            confidence = EXCLUDED.confidence,
            needs_review = EXCLUDED.needs_review,
            source = EXCLUDED.source;
        """,
        [
            (key_to_id[a.canonical_key], a.alias_raw, a.alias_normalized, a.confidence, a.needs_review, a.source)
            for a in ds.party_aliases
            if a.canonical_key in key_to_id
        ],
    )
    return key_to_id


def _upsert_route_trips(
    cur: Any, ds: NormalizedDataset, camioneta_wh_id: int, caja_ruta_id: int
) -> dict[str, int]:
    cur.executemany(
        """
        INSERT INTO erp.route_trips
            (trip_code, trip_date, end_date, zone_name, driver_name, warehouse_id, cash_account_id,
             status, declared_gross_sales_pen, declared_route_opex_pen, declared_net_cash_pen,
             source_origin, source_sheet, notes)
        VALUES (%s, %s, %s, 'MADRE DE DIOS / LABERINTO / PUERTO', 'SAMUEL / RENZO', %s, %s,
                %s::erp.trip_status, %s, %s, %s, 'HISTORICAL_BACKFILL', %s, %s)
        ON CONFLICT (trip_code) DO NOTHING;
        """,
        [
            (
                t.trip_code, t.trip_date, t.end_date, camioneta_wh_id, caja_ruta_id,
                "RECONCILED" if t.declared_net_cash_pen is not None else "CLOSED",
                t.declared_gross_sales_pen, t.declared_route_opex_pen, t.declared_net_cash_pen,
                t.source_sheet, t.notes,
            )
            for t in ds.trips
        ],
    )
    cur.execute("SELECT trip_code, trip_id FROM erp.route_trips;")
    return dict(cur.fetchall())


def _load_opening_stocks(
    cur: Any,
    ds: NormalizedDataset,
    sku_to_id: dict[str, int],
    main_wh_id: int,
) -> None:
    if not ds.opening_stocks:
        return
    params = [
        (
            main_wh_id,
            sku_to_id[op.sku],
            datetime(op.movement_date.year, op.movement_date.month, op.movement_date.day, 5, 0, tzinfo=timezone.utc),
            op.quantity_delta,
            op.unit_cost_pen,
            f"STOCKS-{op.movement_date.isoformat()}:{op.sku}",
            op.notes,
            op.row_hash,
        )
        for op in ds.opening_stocks
        if op.sku in sku_to_id
    ]
    if params:
        cur.executemany(
            """
            INSERT INTO erp.inventory_movements
                (warehouse_id, product_id, movement_date, movement_type, quantity_delta,
                 unit_cost_pen, reference_table, reference_id, source_origin, notes, source_row_hash)
            VALUES (%s, %s, %s, 'OPENING', %s, %s, 'raw_staging.opening_stock_2026_06_26', %s,
                    'HISTORICAL_BACKFILL', %s, %s)
            ON CONFLICT (source_row_hash) DO NOTHING;
            """,
            params,
        )


def _load_purchases_and_stock_in(
    cur: Any,
    ds: NormalizedDataset,
    sku_to_id: dict[str, int],
    party_key_to_id: dict[str, int],
    main_wh_id: int,
    interbank_id: int,
    bcp_id: int,
) -> dict[tuple[str, str, str, str], int]:
    if ds.purchase_invoices:
        cur.executemany(
            """
            INSERT INTO erp.purchase_invoices
                (supplier_party_id, supplier_ruc, supplier_name_raw, doc_type, doc_series, doc_number,
                 issue_date, due_date, orig_currency, exchange_rate, total_pen, orig_total,
                 expense_bucket, expense_category, currency_anomaly_flag, has_itemized_lines,
                 source_origin, source_file, raw_notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s::erp.expense_bucket, %s, %s, %s, 'HISTORICAL_BACKFILL', %s, %s)
            ON CONFLICT (supplier_ruc, doc_type, doc_series, doc_number) DO NOTHING;
            """,
            [
                (
                    party_key_to_id.get(pinv.supplier_canonical_key),
                    pinv.supplier_ruc,
                    pinv.supplier_name_raw,
                    pinv.doc_type,
                    pinv.doc_series,
                    pinv.doc_number,
                    pinv.issue_date,
                    pinv.due_date,
                    pinv.orig_currency,
                    pinv.exchange_rate,
                    pinv.total_pen,
                    pinv.orig_total,
                    pinv.expense_bucket,
                    pinv.expense_category,
                    pinv.currency_anomaly_flag,
                    bool(pinv.lines),
                    pinv.source_file,
                    pinv.raw_notes,
                )
                for pinv in ds.purchase_invoices
            ],
        )

    cur.execute("SELECT supplier_ruc, doc_type, doc_series, doc_number, purchase_id FROM erp.purchase_invoices;")
    purchase_map = {(r[0], r[1], r[2], r[3]): r[4] for r in cur.fetchall()}

    line_params: list[tuple[Any, ...]] = []
    inv_params: list[tuple[Any, ...]] = []
    ap_params: list[tuple[Any, ...]] = []
    fiscal_cash_params: list[tuple[Any, ...]] = []

    for pinv in ds.purchase_invoices:
        purchase_id = purchase_map[(pinv.supplier_ruc, pinv.doc_type, pinv.doc_series, pinv.doc_number)]
        sup_id = party_key_to_id.get(pinv.supplier_canonical_key)
        doc_code = f"{pinv.doc_series}-{pinv.doc_number}"

        for line in pinv.lines:
            pid = sku_to_id.get(line.sku) if line.sku else None
            line_params.append(
                (
                    purchase_id,
                    line.line_no,
                    pid,
                    line.raw_description,
                    line.uom,
                    line.quantity,
                    line.unit_cost_pen,
                    line.line_total_pen,
                    line.anomaly_flag,
                    line.row_hash,
                )
            )
            if pid and line.quantity > 0:
                mv_hash = stable_hash("PURCHASE_IN", pinv.supplier_ruc, pinv.doc_series, pinv.doc_number, line.line_no)
                inv_params.append(
                    (
                        main_wh_id,
                        pid,
                        _ts(pinv.issue_date),
                        line.quantity,
                        line.unit_cost_pen,
                        str(purchase_id),
                        doc_code,
                        mv_hash,
                    )
                )

        # Record fiscal invoices in AP or direct non-route bank cash_ledger without double-counting route cash
        if pinv.supplier_ruc == "20610518398" and pinv.total_pen > 0:
            qingdao_paid_docs = {
                "FQQ1-113",
                "FQQ1-115",
                "FQQ1-116",
                "FQQ1-117",
                "FQQ1-118",
                "FQQ1-120",
                "FQQ1-122",
                "FQQ1-123",
                "FQQ1-124",
                "FQQ1-125",
                "FQQ1-127",
            }
            if doc_code in qingdao_paid_docs:
                paid_pen = float(pinv.total_pen)
                ap_status = "PAID"
                ap_note = "Qingdao invoice reconciled as PAID per EXEL BLUE HORIZON.xlsx (Hoja20 / 29-07-2026 / 24-08-2026)."
            elif doc_code == "FQQ1-126":
                paid_pen = 3456.0
                ap_status = "PARTIAL"
                ap_note = "Qingdao FQQ1-126 partial settlement reconciled per EXEL 24-08-2026 (BLUE DEBE 3,194)."
            else:
                paid_pen = 0.0
                ap_status = "OPEN"
                ap_note = "Qingdao August invoice open per EXEL 24-08-2026 reconciliation."
            ap_hash = stable_hash("AP_QINGDAO", pinv.supplier_ruc, pinv.doc_type, doc_code)
            ap_params.append(
                (
                    purchase_id,
                    sup_id,
                    doc_code,
                    pinv.issue_date,
                    pinv.due_date,
                    pinv.total_pen,
                    paid_pen,
                    ap_status,
                    ap_hash,
                    ap_note,
                )
            )
        else:
            # Avoid duplicating COMBUSTIBLE / PEAJE / SOCOPUR MOTO / PUNTO EDUCATIVO 71 / NOTARIA 70 already in EXEL route cash
            skip_dup = (
                pinv.expense_category in {"COMBUSTIBLE", "PEAJE", "LEGAL_NOTARIA"}
                or doc_code in {"FE86-1639", "F004-12603"}
            )
            if not skip_dup and pinv.total_pen > 0:
                acct_id = bcp_id if pinv.supplier_ruc == "20100047218" else interbank_id
                cl_hash = stable_hash("FISCAL_CASH", pinv.supplier_ruc, pinv.doc_type, doc_code)
                fiscal_cash_params.append(
                    (
                        pinv.issue_date,
                        acct_id,
                        sup_id,
                        pinv.total_pen,
                        pinv.expense_bucket,
                        pinv.expense_category,
                        str(purchase_id),
                        f"{pinv.supplier_name_raw} ({doc_code})",
                        pinv.source_file,
                        cl_hash,
                    )
                )

    if line_params:
        cur.executemany(
            """
            INSERT INTO erp.purchase_invoice_lines
                (purchase_id, line_no, product_id, raw_description, unit_of_measure,
                 quantity, unit_cost_pen, line_total_pen, anomaly_flag, source_origin, source_row_hash)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'HISTORICAL_BACKFILL', %s)
            ON CONFLICT (purchase_id, line_no) DO NOTHING;
            """,
            line_params,
        )
    if inv_params:
        cur.executemany(
            """
            INSERT INTO erp.inventory_movements
                (warehouse_id, product_id, movement_date, movement_type, quantity_delta,
                 unit_cost_pen, reference_table, reference_id, source_origin, notes, source_row_hash)
            VALUES (%s, %s, %s, 'PURCHASE_IN', %s, %s, 'erp.purchase_invoices', %s,
                    'HISTORICAL_BACKFILL', %s, %s)
            ON CONFLICT (source_row_hash) DO NOTHING;
            """,
            inv_params,
        )
    if ap_params:
        cur.executemany(
            """
            INSERT INTO erp.ap_obligations
                (purchase_id, supplier_party_id, doc_ref, obligation_type, issue_date, due_date,
                 original_amount_pen, paid_amount_pen, status, source_origin, source_row_hash, notes)
            VALUES (%s, %s, %s, 'SUPPLIER_INVOICE', %s, %s, %s, %s, %s, 'HISTORICAL_BACKFILL', %s, %s)
            ON CONFLICT (source_row_hash) DO NOTHING;
            """,
            ap_params,
        )
    if fiscal_cash_params:
        cur.executemany(
            """
            INSERT INTO erp.cash_ledger
                (tx_date, account_id, party_id, direction, amount_pen, expense_bucket,
                 expense_category, is_internal_transfer, reference_table, reference_id,
                 description, source_origin, source_file, source_row_hash)
            VALUES (%s, %s, %s, 'OUT', %s, %s::erp.expense_bucket, %s, FALSE,
                    'erp.purchase_invoices', %s, %s, 'HISTORICAL_BACKFILL', %s, %s)
            ON CONFLICT (source_row_hash) DO NOTHING;
            """,
            fiscal_cash_params,
        )

    return purchase_map


def _load_quotes(cur: Any, ds: NormalizedDataset, sku_to_id: dict[str, int]) -> None:
    if not ds.raw_quotes:
        return

    cur.execute("SELECT doc_type::text, doc_number, party_id FROM erp.parties WHERE doc_number IS NOT NULL AND is_generic_doc = FALSE;")
    doc_lookup = {(r[0], r[1]): r[2] for r in cur.fetchall()}
    cur.execute("SELECT alias_normalized, party_id FROM erp.party_aliases;")
    alias_lookup = dict(cur.fetchall())

    from bht_etl.config import normalize_text

    quote_params = [
        (
            q.quote_code,
            q.issue_date,
            doc_lookup.get((q.doc_type, q.customer_doc or "")) or alias_lookup.get(normalize_text(q.customer_name)),
            q.customer_name,
            q.currency,
            q.total_pen,
            q.status,
            q.related_cpe,
            q.notes,
        )
        for q in ds.raw_quotes
    ]
    cur.executemany(
        """
        INSERT INTO erp.quotes
            (quote_code, issue_date, customer_party_id, customer_name_raw, currency,
             tax_regime, total_pen, status, related_cpe, source_origin, notes)
        VALUES (%s, %s, %s, %s, %s, 'EXONERADA', %s, %s::erp.quote_status, %s, 'HISTORICAL_BACKFILL', %s)
        ON CONFLICT (quote_code) DO NOTHING;
        """,
        quote_params,
    )

    cur.execute("SELECT quote_code, quote_id FROM erp.quotes;")
    quote_id_map = dict(cur.fetchall())

    ql_params = [
        (
            quote_id_map[q.quote_code],
            ql.line_no,
            sku_to_id.get(ql.sku) if ql.sku else None,
            ql.description,
            ql.quantity,
            ql.unit_price_pen,
            ql.line_total_pen,
        )
        for q in ds.raw_quotes
        for ql in q.lines
    ]
    if ql_params:
        cur.executemany(
            """
            INSERT INTO erp.quote_lines
                (quote_id, line_no, product_id, raw_description, quantity, unit_price_pen, line_total_pen)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (quote_id, line_no) DO NOTHING;
            """,
            ql_params,
        )


def _load_sales_and_stock_out(
    cur: Any,
    ds: NormalizedDataset,
    sku_to_id: dict[str, int],
    party_key_to_id: dict[str, int],
    trip_map: dict[str, int],
    main_wh_id: int,
    caja_ruta_id: int,
) -> int:
    if not ds.sales_orders:
        return 0

    order_params = [
        (
            so.order_code,
            so.order_date,
            trip_map.get(so.trip_code),
            main_wh_id,
            party_key_to_id.get(so.customer_canonical_key) if so.customer_canonical_key else None,
            so.customer_name_raw,
            so.payment_mode,
            so.historical_status_assumed,
            so.payment_status_raw,
            so.doc_ref,
            so.total_pen,
            so.due_date,
            so.source_file,
            so.source_sheet,
            so.source_row_num,
            so.row_hash,
            so.notes,
        )
        for so in ds.sales_orders
    ]
    cur.executemany(
        """
        INSERT INTO erp.sales_orders
            (order_code, order_date, trip_id, warehouse_id, customer_party_id, customer_name_raw,
             payment_mode, historical_status_assumed, payment_status_raw, doc_ref,
             total_pen, paid_pen, due_date, source_origin, source_file, source_sheet,
             source_row_num, source_row_hash, notes)
        VALUES (%s, %s, %s, %s, %s, %s, %s::erp.payment_mode, %s, %s, %s, %s, 0, %s,
                'HISTORICAL_BACKFILL', %s, %s, %s, %s, %s)
        ON CONFLICT (order_code) DO NOTHING;
        """,
        order_params,
    )

    cur.execute("SELECT order_code, order_id FROM erp.sales_orders;")
    order_id_map = dict(cur.fetchall())

    sol_params: list[tuple[Any, ...]] = []
    inv_params: list[tuple[Any, ...]] = []
    ar_params: list[tuple[Any, ...]] = []
    cash_in_params: list[tuple[Any, ...]] = []

    for so in ds.sales_orders:
        order_id = order_id_map[so.order_code]
        cid = party_key_to_id.get(so.customer_canonical_key) if so.customer_canonical_key else None
        tid = trip_map.get(so.trip_code)

        for line in so.lines:
            pid = sku_to_id[line.sku]
            sol_params.append(
                (
                    order_id,
                    line.line_no,
                    pid,
                    line.raw_description,
                    line.quantity,
                    line.pack_factor_applied,
                    line.unit_price_pen,
                    line.line_total_pen,
                    line.unit_cost_snapshot_pen,
                    line.fulfillment_mode,
                    line.fulfillment_status,
                    line.row_hash,
                )
            )
            mv_hash = stable_hash("SALE_OUT", so.order_code, line.line_no, pid)
            inv_params.append(
                (
                    main_wh_id,
                    pid,
                    _ts(so.order_date),
                    -(line.quantity * line.pack_factor_applied),
                    line.unit_cost_snapshot_pen,
                    str(order_id),
                    so.order_code,
                    mv_hash,
                )
            )

        if so.initial_paid_pen > 0:
            ar_hash = stable_hash("AR_INIT", so.order_code)
            ar_params.append(
                (
                    order_id,
                    so.order_date,
                    so.initial_paid_pen,
                    caja_ruta_id,
                    so.doc_ref,
                    "Assumed CASH historical collection" if so.historical_status_assumed else "Route cash collection",
                    ar_hash,
                )
            )
            in_hash = stable_hash("CASH_SALE_IN", so.order_code)
            cash_in_params.append(
                (
                    so.order_date,
                    caja_ruta_id,
                    tid,
                    cid,
                    so.initial_paid_pen,
                    str(order_id),
                    f"Venta {so.customer_name_raw} ({so.order_code})",
                    so.source_file,
                    so.source_sheet,
                    so.source_row_num,
                    in_hash,
                )
            )

    if sol_params:
        cur.executemany(
            """
            INSERT INTO erp.sales_order_lines
                (order_id, line_no, product_id, raw_description, quantity, pack_factor_applied,
                 unit_price_pen, line_total_pen, unit_cost_snapshot_pen, fulfillment_mode,
                 fulfillment_status, source_origin, source_row_hash)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::erp.fulfillment_mode,
                    %s::erp.fulfillment_status, 'HISTORICAL_BACKFILL', %s)
            ON CONFLICT (order_id, line_no) DO NOTHING;
            """,
            sol_params,
        )
    if inv_params:
        cur.executemany(
            """
            INSERT INTO erp.inventory_movements
                (warehouse_id, product_id, movement_date, movement_type, quantity_delta,
                 unit_cost_pen, reference_table, reference_id, source_origin, notes, source_row_hash)
            VALUES (%s, %s, %s, 'SALE_OUT', %s, %s, 'erp.sales_orders', %s,
                    'HISTORICAL_BACKFILL', %s, %s)
            ON CONFLICT (source_row_hash) DO NOTHING;
            """,
            inv_params,
        )
    if ar_params:
        cur.executemany(
            """
            INSERT INTO erp.ar_payments
                (order_id, payment_date, amount_pen, payment_mode, account_id, reference_doc,
                 notes, source_origin, source_row_hash)
            VALUES (%s, %s, %s, 'CASH'::erp.payment_mode, %s, %s, %s, 'HISTORICAL_BACKFILL', %s)
            ON CONFLICT (source_row_hash) DO NOTHING;
            """,
            ar_params,
        )
    if cash_in_params:
        cur.executemany(
            """
            INSERT INTO erp.cash_ledger
                (tx_date, account_id, trip_id, party_id, direction, amount_pen,
                 expense_category, is_internal_transfer, reference_table, reference_id,
                 description, source_origin, source_file, source_sheet, source_row_num, source_row_hash)
            VALUES (%s, %s, %s, %s, 'IN', %s, 'SALE_CASH_COLLECTION', FALSE,
                    'erp.sales_orders', %s, %s, 'HISTORICAL_BACKFILL', %s, %s, %s, %s)
            ON CONFLICT (source_row_hash) DO NOTHING;
            """,
            cash_in_params,
        )

    return len(ds.sales_orders)


def _load_daily_cash_events(
    cur: Any,
    ds: NormalizedDataset,
    trip_map: dict[str, int],
    acct_map: dict[str, int],
) -> None:
    if not ds.cash_events:
        return
    campaign_end = date(2026, 7, 1)
    params = []
    for ce in ds.cash_events:
        tcode = "TRIP-2026-06-26-CAMPAIGN-01" if ce.tx_date <= campaign_end else f"TRIP-{ce.tx_date.isoformat()}"
        tid = trip_map.get(tcode)
        acct_id = acct_map.get(ce.account_code, acct_map["CAJA_RUTA"])
        params.append(
            (
                ce.tx_date,
                acct_id,
                tid,
                ce.amount_pen,
                ce.expense_bucket,
                ce.expense_category,
                ce.is_internal_transfer,
                "erp.ap_obligations" if ce.reference_doc else None,
                ce.reference_doc,
                ce.description,
                ce.source_file,
                ce.sheet_name,
                ce.row_num,
                ce.row_hash,
            )
        )
    cur.executemany(
        """
        INSERT INTO erp.cash_ledger
            (tx_date, account_id, trip_id, direction, amount_pen, expense_bucket,
             expense_category, is_internal_transfer, reference_table, reference_id,
             description, source_origin, source_file, source_sheet, source_row_num, source_row_hash)
        VALUES (%s, %s, %s, 'OUT', %s, %s::erp.expense_bucket, %s, %s, %s, %s, %s,
                'HISTORICAL_BACKFILL', %s, %s, %s, %s)
        ON CONFLICT (source_row_hash) DO NOTHING;
        """,
        params,
    )


def _load_audit_flags(cur: Any, ds: NormalizedDataset) -> None:
    if ds.audit_flags:
        cur.executemany(
            """
            INSERT INTO erp.audit_flags
                (flag_code, severity, entity_table, entity_id, message, details, source_origin)
            SELECT %s, %s::erp.audit_severity, %s, %s, %s, %s, %s::erp.data_origin
            WHERE NOT EXISTS (
                SELECT 1
                FROM erp.audit_flags af
                WHERE af.flag_code = %s
                  AND af.entity_table = %s
                  AND af.entity_id = %s
            );
            """,
            [
                (
                    af.flag_code,
                    af.severity,
                    af.entity_table,
                    af.entity_id,
                    af.message,
                    Jsonb(af.details),
                    af.source_origin,
                    af.flag_code,
                    af.entity_table,
                    af.entity_id,
                )
                for af in ds.audit_flags
            ],
        )

    # Record historical missing bank-statement gap only if not already recorded (including RESOLVED)
    cur.execute(
        """
        INSERT INTO erp.audit_flags
            (flag_code, severity, entity_table, entity_id, message, details, source_origin)
        SELECT
            'MISSING_BANK_STATEMENT_LEDGER',
            'WARNING'::erp.audit_severity,
            'erp.cash_ledger',
            '2026-06-26..2026-09-29',
            'Historical BCP/Interbank statements were not in 00_raw; Qingdao AP settlements outside route cash remain unverified until bank extract is provided.',
            '{"impacted_supplier":"20610518398"}'::jsonb,
            'HISTORICAL_BACKFILL'::erp.data_origin
        WHERE NOT EXISTS (
            SELECT 1
            FROM erp.audit_flags af
            WHERE af.flag_code = 'MISSING_BANK_STATEMENT_LEDGER'
              AND af.entity_table = 'erp.cash_ledger'
              AND af.entity_id = '2026-06-26..2026-09-29'
        );
        """
    )
