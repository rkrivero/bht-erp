"""CLI entrypoint (`bht-etl`) for migrating, loading, auditing, and reporting on BHT ERP."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from decimal import Decimal
from pathlib import Path
from typing import Any

from psycopg import sql

from bht_etl.config import get_project_paths, load_expense_config
from bht_etl.db import get_connection, run_migrations
from bht_etl.loader import load_to_neon

FALLBACK_SENSITIVE_REGEXES = (
    r"PREGUNTAS?\s+SEGURIDAD",
    r"CLAVE",
    r"PRIMER\s+JEFE",
    r"PROFESOR.*FAVORITO",
    r"PRIMO.*MAYOR",
    r"\bCHARO\b",
    r"\bSORAYDA\b",
)


def _load_sensitive_regexes(root: Path | None) -> list[str]:
    try:
        paths = get_project_paths(root)
        cfg = load_expense_config(paths.config_dir)
        patterns = [p.pattern for p in cfg.sensitive_row_block_patterns]
        return patterns or list(FALLBACK_SENSITIVE_REGEXES)
    except Exception:
        return list(FALLBACK_SENSITIVE_REGEXES)


def _fmt_val(val: Any) -> str:
    if val is None:
        return "-"
    if isinstance(val, Decimal):
        return f"{val:,.2f}"
    if isinstance(val, float):
        return f"{val:,.2f}"
    if isinstance(val, bool):
        return "ALERT" if val else "OK"
    return str(val)


def _print_table(title: str, headers: list[str], rows: list[tuple[Any, ...]]) -> None:
    print(f"\n=== {title} ===")
    if not rows:
        print("(no rows)")
        return
    str_rows = [[_fmt_val(cell) for cell in row] for row in rows]
    widths = [max(len(h), *(len(r[i]) for r in str_rows)) for i, h in enumerate(headers)]
    sep = "-+-".join("-" * w for w in widths)
    print(" | ".join(h.ljust(widths[i]) for i, h in enumerate(headers)))
    print(sep)
    for row in str_rows:
        print(" | ".join(row[i].ljust(widths[i]) for i in range(len(headers))))


def _cmd_migrate(branch: str, root: Path | None) -> int:
    results = run_migrations(branch=branch, root=root)
    print(f"Target branch: {branch}")
    for res in results:
        print(f"  [{res.status}] {res.version}")
    return 0


def _cmd_load(branch: str, root: Path | None) -> int:
    summary = load_to_neon(branch=branch, root=root)
    print(json.dumps(asdict(summary), indent=2, default=str))
    return 0


def _cmd_check_quality(branch: str, root: Path | None) -> int:
    with get_connection(branch=branch, root=root) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT batch_id, TO_CHAR(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
                       target_branch, status, summary_stats::TEXT
                FROM raw_staging.etl_batches
                ORDER BY batch_id DESC
                LIMIT 5;
                """
            )
            batches = cur.fetchall()
            _print_table(
                f"Recent ETL Batches ({branch})",
                ["batch_id", "started_utc", "branch", "status", "summary_stats"],
                batches,
            )

            cur.execute(
                """
                SELECT 'erp.products', COUNT(*) FROM erp.products
                UNION ALL SELECT 'erp.parties', COUNT(*) FROM erp.parties
                UNION ALL SELECT 'erp.route_trips', COUNT(*) FROM erp.route_trips
                UNION ALL SELECT 'erp.purchase_invoices', COUNT(*) FROM erp.purchase_invoices
                UNION ALL SELECT 'erp.purchase_invoice_lines', COUNT(*) FROM erp.purchase_invoice_lines
                UNION ALL SELECT 'erp.quotes', COUNT(*) FROM erp.quotes
                UNION ALL SELECT 'erp.quote_lines', COUNT(*) FROM erp.quote_lines
                UNION ALL SELECT 'erp.sales_orders', COUNT(*) FROM erp.sales_orders
                UNION ALL SELECT 'erp.sales_order_lines', COUNT(*) FROM erp.sales_order_lines
                UNION ALL SELECT 'erp.inventory_movements', COUNT(*) FROM erp.inventory_movements
                UNION ALL SELECT 'erp.cash_ledger', COUNT(*) FROM erp.cash_ledger
                UNION ALL SELECT 'erp.ar_payments', COUNT(*) FROM erp.ar_payments
                UNION ALL SELECT 'erp.ap_obligations', COUNT(*) FROM erp.ap_obligations
                UNION ALL SELECT 'erp.audit_flags', COUNT(*) FROM erp.audit_flags;
                """
            )
            counts = cur.fetchall()
            _print_table(f"ERP Table Counts ({branch})", ["table_name", "row_count"], counts)

            leak_checks = [
                (("raw_staging", "raw_excel_daily_rows"), sql.SQL("raw_payload::TEXT")),
                (("raw_staging", "raw_compras_invoices"), sql.SQL("raw_payload::TEXT")),
                (("raw_staging", "raw_purchase_items"), sql.SQL("raw_payload::TEXT")),
                (("raw_staging", "raw_quotes_excel"), sql.SQL("raw_payload::TEXT")),
                (("raw_staging", "raw_json_doc_pages"), sql.SQL("raw_payload::TEXT")),
                (
                    ("erp", "cash_ledger"),
                    sql.SQL("COALESCE(description, '') || ' ' || COALESCE(expense_category, '')"),
                ),
                (
                    ("erp", "sales_orders"),
                    sql.SQL("COALESCE(customer_name_raw, '') || ' ' || COALESCE(notes, '')"),
                ),
                (("erp", "audit_flags"), sql.SQL("COALESCE(message, '')")),
            ]
            sensitive_regexes = _load_sensitive_regexes(root)
            total_leaks = 0
            leak_rows: list[tuple[Any, ...]] = []
            for (schema_name, table_name), expr_sql in leak_checks:
                query = sql.SQL("SELECT COUNT(*) FROM {} WHERE {} ~* ANY(%s);").format(
                    sql.Identifier(schema_name, table_name),
                    expr_sql,
                )
                cur.execute(query, (sensitive_regexes,))
                cnt = int(cur.fetchone()[0])
                total_leaks += cnt
                leak_rows.append((f"{schema_name}.{table_name}", cnt))
            _print_table("Sensitive Content Guard Check", ["table_name", "sensitive_hits"], leak_rows)

            cur.execute(
                """
                SELECT gap_category, severity, item_count, impacted_pen, description
                FROM analytics.v_data_quality_gaps
                ORDER BY
                    CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,
                    gap_category;
                """
            )
            gaps = cur.fetchall()
            _print_table(
                f"analytics.v_data_quality_gaps ({branch})",
                ["gap_category", "severity", "item_count", "impacted_pen", "description"],
                gaps,
            )

            cur.execute(
                """
                SELECT order_code, order_date, sku, quantity, current_stock_on_hand,
                       line_total_pen, fulfillment_status, source_origin
                FROM analytics.v_pending_on_demand_orders
                ORDER BY order_date, order_line_id
                LIMIT 25;
                """
            )
            on_demand_rows = cur.fetchall()
            _print_table(
                f"analytics.v_pending_on_demand_orders (up to 25 rows, {branch})",
                ["order_code", "order_date", "sku", "qty", "stock_on_hand", "line_total_pen", "status", "origin"],
                on_demand_rows,
            )

            if total_leaks > 0:
                print(f"\nERROR: Found {total_leaks} sensitive row leak(s)!", file=sys.stderr)
                return 2
    return 0


def _cmd_report_kpis(branch: str, root: Path | None) -> int:
    with get_connection(branch=branch, root=root) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT period_month, order_count, sales_total_pen, cash_collected_pen,
                       ar_pending_pen, route_opex_pen, route_opex_pct,
                       route_operating_cash_margin_pen, route_operating_cash_margin_pct,
                       merchandise_outflow_pen, non_opex_capex_drain_pen,
                       internal_deposits_pen, drain_vs_reinvestment_pct,
                       reconciled_trips_count, cash_reconciliation_gap_pen,
                       cash_reconciliation_gap_pct, drain_above_30pct_alert,
                       route_opex_above_8pct_alert
                FROM analytics.v_kpi_cash_and_reinvestment
                ORDER BY period_month;
                """
            )
            q1_rows = cur.fetchall()
            _print_table(
                f"Q1 KPI: Cash, Route OpEx & Reinvestment ({branch})",
                [
                    "month", "orders", "sales_pen", "collected_pen", "ar_pen",
                    "route_opex", "opex%", "op_margin_pen", "op_margin%",
                    "merch_out", "non_opex_drain", "bank_dep", "drain_vs_reinv%",
                    "rec_trips", "recon_gap_pen", "recon_gap%", "drain>30%", "opex>8%",
                ],
                q1_rows,
            )

            cur.execute(
                """
                SELECT sku, LEFT(product_name, 34), fulfillment_mode, sales_line_count,
                       total_units_sold, total_revenue_pen, avg_unit_sale_price_pen,
                       ref_cost_pen, cost_coverage_pct, real_gross_margin_pen,
                       real_gross_margin_pct, portfolio_route_opex_pct,
                       low_margin_below_20pct_alert, missing_cost_alert
                FROM analytics.v_kpi_sku_margin_and_opex
                ORDER BY total_revenue_pen DESC
                LIMIT 20;
                """
            )
            q2_top = cur.fetchall()
            _print_table(
                f"Q2 KPI: Top 20 SKUs by Revenue & Gross Margin ({branch})",
                [
                    "sku", "product", "mode", "lines", "units", "rev_pen",
                    "avg_px", "ref_cost", "cost_cov%", "gm_pen", "gm%",
                    "port_opex%", "gm<20%", "no_cost",
                ],
                q2_top,
            )

            cur.execute(
                """
                SELECT sku, LEFT(product_name, 34), total_revenue_pen,
                       ref_cost_pen, real_gross_margin_pct
                FROM analytics.v_kpi_sku_margin_and_opex
                WHERE low_margin_below_20pct_alert = TRUE
                ORDER BY total_revenue_pen DESC;
                """
            )
            q2_alerts = cur.fetchall()
            _print_table(
                f"Q2 Alerts: SKUs with Gross Margin < 20% ({branch})",
                ["sku", "product", "rev_pen", "ref_cost", "gm%"],
                q2_alerts,
            )

            cur.execute(
                """
                SELECT period_month, orders_total, total_sales_pen, credit_sales_pen,
                       pending_ar_pen, ar_pending_of_credit_pct, ar_pending_of_total_sales_pct,
                       overdue_gt_30d_count, overdue_gt_30d_pen, quotes_total,
                       quotes_converted_count, quote_conversion_rate_pct,
                       explicit_payment_status_pct, matched_customer_pct,
                       ar_above_15pct_alert, overdue_gt_30d_alert
                FROM analytics.v_kpi_ar_customers_and_quotes
                ORDER BY period_month;
                """
            )
            q3_rows = cur.fetchall()
            _print_table(
                f"Q3 KPI: AR Collections, Quotes & Data Quality ({branch})",
                [
                    "month", "orders", "sales_pen", "credit_pen", "pending_ar",
                    "ar/cred%", "ar/sales%", ">30d_cnt", ">30d_pen", "quotes",
                    "conv_q", "conv%", "explicit_st%", "matched_cust%",
                    "ar>15%", ">30d_alrt",
                ],
                q3_rows,
            )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="bht-etl", description="Blue Horizon Trade ERP Phase 1 CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    for cmd in ("migrate", "load", "check-quality", "report-kpis"):
        sp = sub.add_parser(cmd)
        sp.add_argument("--branch", choices=("dev", "main"), default="dev", help="Target Neon branch")
        sp.add_argument("--root", type=Path, default=None, help="Optional workspace root")
        if cmd in ("migrate", "load"):
            sp.add_argument(
                "--confirm-main",
                action="store_true",
                default=False,
                help="Required explicit confirmation to mutate Neon main",
            )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command in ("migrate", "load") and args.branch == "main" and not args.confirm_main:
        print(
            f"Refusing to run '{args.command}' against Neon 'main' without --confirm-main.",
            file=sys.stderr,
        )
        return 2
    if args.command == "migrate":
        return _cmd_migrate(args.branch, args.root)
    if args.command == "load":
        return _cmd_load(args.branch, args.root)
    if args.command == "check-quality":
        return _cmd_check_quality(args.branch, args.root)
    if args.command == "report-kpis":
        return _cmd_report_kpis(args.branch, args.root)
    parser.error(f"Unknown command: {args.command}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
