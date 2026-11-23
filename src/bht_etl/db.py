"""Database connectivity and idempotent SQL migration runner for Neon Postgres."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

import psycopg

from bht_etl.config import get_database_url, get_project_paths


@dataclass(frozen=True)
class MigrationResult:
    version: str
    status: str  # 'APPLIED' | 'REAPPLIED' | 'SKIPPED' | 'SKIPPED_HISTORICAL'


# A previous release edited migration 005 after it had already been applied to
# main. Keep the runner strict for all other migrations; 012 reapplies the
# corrected view definitions to branches with this known historical checksum.
LEGACY_MIGRATION_CHECKSUMS = {
    "005_analytics_kpi_views": {
        "b3fb96944dd33227c3ba00f067ea7dc799862ff476178a66d97c9d55159b3bb6",
        "bcd00563f8990ea3beaddc5c93eab237678e6ca7bd5cbc6efb837600fa0bbddb",
    },
    "030_harden_analytics_views_settings_and_closure_defaults": {
        "beab47ca1053676ff50023d6cf965c04bbff894fbb7c228338542c1e660616fc",
    },
}
LEGACY_RECONCILIATION_MIGRATIONS = {
    "005_analytics_kpi_views": "012_analytics_view_refresh",
    "030_harden_analytics_views_settings_and_closure_defaults": "031_security_locks_and_analytics_hardening",
}
LEGACY_IDEMPOTENT_REAPPLY_CHECKSUMS = {
    "012_analytics_view_refresh": {
        "698fc58442b82dc560c388f450ec308cd3002c8eee633ff5a4076a1b64518d42",
        "25514ed8c4c071635a8d2bf654f4af260b18b6de0d6a39d850c74aa9bb5cf414",
    }
}


def get_connection(branch: str = "dev", root: Path | None = None) -> psycopg.Connection:
    """Open a psycopg3 connection against the requested Neon branch ('dev' or 'main')."""
    url = get_database_url(branch=branch, root=root)
    return psycopg.connect(url, autocommit=False)


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def run_migrations(branch: str = "dev", root: Path | None = None) -> list[MigrationResult]:
    """Apply pending SQL migrations in sorted filename order and record SHA-256 checksums."""
    paths = get_project_paths(root)
    migration_files = sorted(paths.migrations_dir.glob("*.sql"))
    if not migration_files:
        raise FileNotFoundError(f"No migration files found under {paths.migrations_dir}")

    results: list[MigrationResult] = []
    with get_connection(branch=branch, root=root) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_lock(hashtext('bht_schema_migrations'));")
            conn.commit()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS public.schema_migrations (
                        version    TEXT PRIMARY KEY,
                        checksum   TEXT NOT NULL,
                        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    """
                )
                conn.commit()

                cur.execute("SELECT version, checksum FROM public.schema_migrations;")
                existing = dict(cur.fetchall())

            for sql_path in migration_files:
                version = sql_path.stem
                sql_text = sql_path.read_text(encoding="utf-8")
                checksum = _sha256_text(sql_text)

                if version in existing:
                    if existing[version] != checksum:
                        reconciliation = LEGACY_RECONCILIATION_MIGRATIONS.get(version)
                        if (
                            existing[version]
                            in LEGACY_MIGRATION_CHECKSUMS.get(version, set())
                            and reconciliation
                            and (paths.migrations_dir / f"{reconciliation}.sql").is_file()
                        ):
                            results.append(
                                MigrationResult(version=version, status="SKIPPED_HISTORICAL")
                            )
                            continue
                        if existing[version] in LEGACY_IDEMPOTENT_REAPPLY_CHECKSUMS.get(
                            version, set()
                        ):
                            with conn.cursor() as cur:
                                cur.execute(sql_text)
                                cur.execute(
                                    "UPDATE public.schema_migrations SET checksum = %s, applied_at = NOW() WHERE version = %s;",
                                    (checksum, version),
                                )
                            conn.commit()
                            results.append(MigrationResult(version=version, status="REAPPLIED"))
                            continue
                        raise RuntimeError(
                            f"Checksum mismatch for already-applied migration {version}: "
                            f"db={existing[version][:12]}... file={checksum[:12]}..."
                        )
                    results.append(MigrationResult(version=version, status="SKIPPED"))
                    continue

                with conn.cursor() as cur:
                    cur.execute(sql_text)
                    cur.execute(
                        "INSERT INTO public.schema_migrations (version, checksum) VALUES (%s, %s);",
                        (version, checksum),
                    )
                conn.commit()
                results.append(MigrationResult(version=version, status="APPLIED"))
        finally:
            conn.rollback()
            with conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_unlock(hashtext('bht_schema_migrations'));")
            conn.commit()

    return results
