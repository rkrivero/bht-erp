"""Configuration, environment loading, and normalization dictionary loaders."""

from __future__ import annotations

import csv
import os
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv


def normalize_text(text: str | None) -> str:
    """Normalize names and item descriptions identically to alias CSV keys."""
    if not text:
        return ""
    s = str(text).strip().upper()
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))
    s = s.replace('"', " ").replace("'", " ").replace("\n", " ")
    s = re.sub(r"[^A-Z0-9./X\- ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


@dataclass(frozen=True)
class ProductAliasEntry:
    alias_raw: str
    alias_normalized: str
    sku: str
    pack_factor: float
    confidence: float
    needs_review: bool
    source: str


@dataclass(frozen=True)
class PartyAliasEntry:
    alias_raw: str
    alias_normalized: str
    canonical_key: str
    party_type: str
    canonical_name: str
    confidence: float
    needs_review: bool
    source: str


@dataclass
class ExpenseClassificationConfig:
    cutoff_date: date
    supporting_purchase_start_date: date
    supplier_by_ruc: dict[str, dict[str, str]]
    daily_keyword_rules: list[dict[str, Any]]
    purchase_anomalies: dict[str, dict[str, Any]]
    on_demand_skus: set[str]
    sensitive_patterns: list[re.Pattern[str]] = field(default_factory=list)

    def is_sensitive_row(self, values: list[Any] | tuple[Any, ...]) -> bool:
        """Return True when a spreadsheet row matches personal security Q&A / sensitive patterns."""
        joined = " ".join(str(v) for v in values if v is not None)
        if not joined.strip():
            return False
        return any(p.search(joined) for p in self.sensitive_patterns)

    def classify_supplier(self, ruc: str, supplier_name: str | None = None) -> tuple[str, str]:
        """Return (expense_bucket, expense_category) for a fiscal supplier RUC or fallback name."""
        if ruc in self.supplier_by_ruc:
            info = self.supplier_by_ruc[ruc]
            return info["bucket"], info["category"]
        name_u = (supplier_name or "").upper()
        if any(k in name_u for k in ("SERVICENTRO", "GRIF", "EESS", "PETRO", "REPSOL", "PRIMAX")):
            return "ROUTE_OPEX", "COMBUSTIBLE"
        if "INTEROCEANICA" in name_u or "PEAJE" in name_u:
            return "ROUTE_OPEX", "PEAJE"
        if any(k in name_u for k in ("BANCO", "INTERBANK", "BCP", "SCOTIABANK", "BBVA")):
            return "NON_OPEX_OR_CAPEX", "FINANCIAL_FEE"
        if any(k in name_u for k in ("FERRETER", "QINGDAO", "HARDWARE", "FALARI", "IMPORT")):
            return "MERCHANDISE_PAYMENT", "MERCHANDISE"
        return "ROUTE_OPEX", "OTROS_RUTA"

    def classify_daily_note(self, text: str) -> tuple[str | None, str, bool]:
        """Return (expense_bucket, expense_category, is_internal_transfer) for daily sheet text."""
        normed = normalize_text(text)
        for rule in self.daily_keyword_rules:
            if re.search(rule["pattern"], normed, flags=re.I):
                return rule.get("bucket"), rule["category"], bool(rule.get("is_transfer", False))
        return "ROUTE_OPEX", "OTROS_RUTA", False


@dataclass(frozen=True)
class ProjectPaths:
    root: Path
    raw_dir: Path
    config_dir: Path
    migrations_dir: Path


def get_project_paths(root: Path | None = None) -> ProjectPaths:
    base = Path(root) if root else Path(__file__).resolve().parents[2]
    return ProjectPaths(
        root=base,
        raw_dir=base / "00_raw",
        config_dir=base / "config",
        migrations_dir=base / "db" / "migrations",
    )


def get_database_url(branch: str = "dev", root: Path | None = None) -> str:
    """Resolve the direct (unpooled) Postgres connection string for migrations & ETL."""
    paths = get_project_paths(root)
    load_dotenv(paths.root / ".env", override=False)
    branch_norm = branch.strip().lower()
    if branch_norm == "dev":
        env_var = "DEV_DATABASE_URL_UNPOOLED"
        fallback = "DEV_DATABASE_URL"
    elif branch_norm == "main":
        env_var = "DATABASE_URL_UNPOOLED"
        fallback = "DATABASE_URL"
    else:
        raise ValueError(f"Unsupported Neon branch {branch!r}; expected 'dev' or 'main'.")

    url = os.getenv(env_var) or os.getenv(fallback)
    if not url:
        raise RuntimeError(f"Missing {env_var} in environment/.env for branch {branch_norm!r}.")
    return url


def load_expense_config(config_dir: Path) -> ExpenseClassificationConfig:
    with open(config_dir / "expense_classification.yaml", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    patterns = [re.compile(p, flags=re.I) for p in raw.get("sensitive_row_block_patterns", [])]
    return ExpenseClassificationConfig(
        cutoff_date=date.fromisoformat(raw["cutoff_date"]),
        supporting_purchase_start_date=date.fromisoformat(raw["supporting_purchase_start_date"]),
        supplier_by_ruc=raw.get("supplier_classification_by_ruc", {}),
        daily_keyword_rules=raw.get("daily_expense_keyword_rules", []),
        purchase_anomalies=raw.get("purchase_anomalies", {}),
        on_demand_skus=set(raw.get("on_demand_skus", [])),
        sensitive_patterns=patterns,
    )


def load_product_aliases(config_dir: Path) -> dict[str, ProductAliasEntry]:
    mapping: dict[str, ProductAliasEntry] = {}
    with open(config_dir / "aliases_products.csv", newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            key = row["alias_normalized"].strip()
            mapping[key] = ProductAliasEntry(
                alias_raw=row["alias_raw"],
                alias_normalized=key,
                sku=row["sku"].strip(),
                pack_factor=float(row["pack_factor"] or 1.0),
                confidence=float(row["confidence"] or 1.0),
                needs_review=row["needs_review"].strip().lower() == "true",
                source=row["source"].strip(),
            )
    return mapping


def load_party_aliases(config_dir: Path) -> dict[str, PartyAliasEntry]:
    mapping: dict[str, PartyAliasEntry] = {}
    with open(config_dir / "aliases_parties.csv", newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            key = row["alias_normalized"].strip()
            mapping[key] = PartyAliasEntry(
                alias_raw=row["alias_raw"],
                alias_normalized=key,
                canonical_key=row["canonical_key"].strip(),
                party_type=row["party_type"].strip(),
                canonical_name=row["canonical_name"].strip(),
                confidence=float(row["confidence"] or 1.0),
                needs_review=row["needs_review"].strip().lower() == "true",
                source=row["source"].strip(),
            )
    return mapping
