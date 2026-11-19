from pathlib import Path


def test_cash_kpi_reconciliation_subtracts_route_opex() -> None:
    migration = (
        Path(__file__).resolve().parents[1]
        / "db"
        / "migrations"
        / "016_reconcile_cash_kpi_view.sql"
    ).read_text(encoding="utf-8")

    assert "CREATE OR REPLACE VIEW analytics.v_kpi_cash_and_reinvestment" in migration
    assert "cl.expense_bucket = 'ROUTE_OPEX'" in migration
    assert "SELECT SUM(so.paid_pen)" in migration
    assert "- COALESCE((SELECT SUM(cl.amount_pen)" in migration
