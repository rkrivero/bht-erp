from pathlib import Path


def test_phase3_migration_defines_password_and_idempotency_contract() -> None:
    sql = (
        Path(__file__).parents[1]
        / "db"
        / "migrations"
        / "009_client_mutations_passwords_and_pwa.sql"
    ).read_text(encoding="utf-8")

    assert "password_hash TEXT" in sql
    assert "must_change_password BOOLEAN" in sql
    assert "CREATE TABLE IF NOT EXISTS erp.client_mutations" in sql
    assert "mutation_id UUID PRIMARY KEY" in sql
    assert "request_hash CHAR(64)" in sql
    assert "result_json JSONB" in sql
