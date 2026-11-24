from pathlib import Path


def test_user_access_audit_migration_is_immutable_and_actor_attributed() -> None:
    sql = (
        Path(__file__).resolve().parents[1]
        / "db"
        / "migrations"
        / "013_user_access_audit.sql"
    ).read_text(encoding="utf-8")

    assert "CREATE TABLE IF NOT EXISTS erp.user_access_audit_log" in sql
    assert "target_user_id BIGINT NOT NULL REFERENCES erp.app_users" in sql
    assert "actor_user_id BIGINT NOT NULL REFERENCES erp.app_users" in sql
    assert "before_data JSONB" in sql
    assert "after_data JSONB NOT NULL" in sql
    assert "BEFORE UPDATE OR DELETE ON erp.user_access_audit_log" in sql
    assert "USER_CREATED" in sql
    assert "USER_ROLE_CHANGED" in sql
    assert "USER_DEACTIVATED" in sql
