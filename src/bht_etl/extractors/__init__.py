"""Shared parsing, hashing, and extraction utilities for 00_raw Excel and JSON sources."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timedelta
from typing import Any


def parse_date_flexible(val: Any) -> date | None:
    """Parse datetime, date, Excel serial integers/floats, or dd/mm/yyyy / yyyy-mm-dd strings."""
    if val is None or isinstance(val, bool):
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    if isinstance(val, (int, float)) and 30000 <= float(val) <= 65000:
        return date(1899, 12, 30) + timedelta(days=int(float(val)))
    s = str(val).strip()
    if not s:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s[:19], fmt).date()
        except ValueError:
            continue
    m = re.search(r"(\d{2})[/-](\d{2})[/-](\d{4})", s)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    return None


def parse_float(val: Any) -> float | None:
    """Convert numbers or localized numeric strings ('25,750.00') into floats."""
    if val is None or isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip()
    if not s:
        return None
    s = re.sub(r"[^\d,.\-]", "", s)
    if not s or s in {"-", ".", ","}:
        return None
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s and "." not in s:
        # Handle either thousands separator (e.g. '1,000') or decimal comma
        parts = s.split(",")
        if len(parts[-1]) == 3 and len(parts) >= 2:
            s = "".join(parts)
        else:
            s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def json_safe(obj: Any) -> Any:
    """Convert dates/datetimes/tuples into JSON-serializable primitives."""
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {str(k): json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_safe(v) for v in obj]
    return obj


def stable_hash(*parts: Any) -> str:
    """Deterministic SHA-256 hex digest for idempotent staging and ledger deduplication."""
    payload = json.dumps([json_safe(p) for p in parts], sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def normalize_doc_ref(series: str | None, number: Any) -> tuple[str, str]:
    """Normalize SUNAT series and integer/string invoice numbers for deduplication."""
    s = (series or "").strip().upper()
    n_raw = str(number or "").strip().upper()
    if n_raw.endswith(".0"):
        n_raw = n_raw[:-2]
    if n_raw.isdigit():
        n_raw = str(int(n_raw))
    return s, n_raw
