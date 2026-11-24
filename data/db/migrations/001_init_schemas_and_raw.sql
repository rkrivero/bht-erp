-- 001_init_schemas_and_raw.sql
-- Phase 1: Schemas, migration registry, core ERP enums, and immutable raw_staging tables.

CREATE SCHEMA IF NOT EXISTS raw_staging;
CREATE SCHEMA IF NOT EXISTS erp;
CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version     TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Core ERP Enumerations
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'party_type' AND n.nspname = 'erp') THEN
        CREATE TYPE erp.party_type AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH', 'EMPLOYEE_OR_PARTNER');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'doc_id_type' AND n.nspname = 'erp') THEN
        CREATE TYPE erp.doc_id_type AS ENUM ('RUC', 'DNI', 'CE', 'PASSPORT', 'NONE');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'fulfillment_mode' AND n.nspname = 'erp') THEN
        CREATE TYPE erp.fulfillment_mode AS ENUM ('STOCKED', 'ON_DEMAND');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'fulfillment_status' AND n.nspname = 'erp') THEN
        CREATE TYPE erp.fulfillment_status AS ENUM ('FULFILLED', 'PENDING_SUPPLIER_PURCHASE', 'PARTIALLY_FULFILLED', 'CANCELLED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'expense_bucket' AND n.nspname = 'erp') THEN
        CREATE TYPE erp.expense_bucket AS ENUM ('MERCHANDISE_PAYMENT', 'ROUTE_OPEX', 'NON_OPEX_OR_CAPEX');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'payment_mode' AND n.nspname = 'erp') THEN
        CREATE TYPE erp.payment_mode AS ENUM ('CASH', 'CREDIT', 'TRANSFER', 'YAPE_PLIN', 'MIXED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'quote_status' AND n.nspname = 'erp') THEN
        CREATE TYPE erp.quote_status AS ENUM ('OPEN', 'CONVERTED', 'EXPIRED', 'CANCELLED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'trip_status' AND n.nspname = 'erp') THEN
        CREATE TYPE erp.trip_status AS ENUM ('OPEN', 'CLOSED', 'RECONCILED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'movement_type' AND n.nspname = 'erp') THEN
        CREATE TYPE erp.movement_type AS ENUM ('OPENING', 'PURCHASE_IN', 'SALE_OUT', 'RETURN_IN', 'ADJUSTMENT');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'cash_direction' AND n.nspname = 'erp') THEN
        CREATE TYPE erp.cash_direction AS ENUM ('IN', 'OUT');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'data_origin' AND n.nspname = 'erp') THEN
        CREATE TYPE erp.data_origin AS ENUM ('HISTORICAL_BACKFILL', 'ERP_APP');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'audit_severity' AND n.nspname = 'erp') THEN
        CREATE TYPE erp.audit_severity AS ENUM ('INFO', 'WARNING', 'CRITICAL');
    END IF;
END
$$;

-- ============================================================================
-- Raw Staging Tables (Immutable Lineage From 00_raw/)
-- ============================================================================

CREATE TABLE IF NOT EXISTS raw_staging.etl_batches (
    batch_id       BIGSERIAL PRIMARY KEY,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at    TIMESTAMPTZ,
    target_branch  TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'RUNNING',
    summary_stats  JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes          TEXT
);

CREATE TABLE IF NOT EXISTS raw_staging.raw_excel_daily_rows (
    id             BIGSERIAL PRIMARY KEY,
    batch_id       BIGINT REFERENCES raw_staging.etl_batches(batch_id) ON DELETE SET NULL,
    source_file    TEXT NOT NULL,
    sheet_name     TEXT NOT NULL,
    row_num        INT NOT NULL,
    block_section  TEXT NOT NULL,
    row_date       DATE,
    raw_payload    JSONB NOT NULL,
    row_hash       TEXT NOT NULL UNIQUE,
    ingested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_daily_sheet_row
    ON raw_staging.raw_excel_daily_rows (sheet_name, row_num);

CREATE TABLE IF NOT EXISTS raw_staging.raw_compras_invoices (
    id             BIGSERIAL PRIMARY KEY,
    batch_id       BIGINT REFERENCES raw_staging.etl_batches(batch_id) ON DELETE SET NULL,
    source_file    TEXT NOT NULL,
    sheet_name     TEXT NOT NULL,
    row_num        INT NOT NULL,
    issue_date     DATE,
    supplier_ruc   TEXT,
    supplier_name  TEXT,
    doc_type       TEXT,
    doc_series     TEXT,
    doc_number     TEXT,
    currency       TEXT,
    exchange_rate  NUMERIC(10,4),
    total_amount   NUMERIC(14,2),
    raw_payload    JSONB NOT NULL,
    row_hash       TEXT NOT NULL UNIQUE,
    ingested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_compras_doc_key
    ON raw_staging.raw_compras_invoices (supplier_ruc, doc_type, doc_series, doc_number);

CREATE TABLE IF NOT EXISTS raw_staging.raw_purchase_items (
    id             BIGSERIAL PRIMARY KEY,
    batch_id       BIGINT REFERENCES raw_staging.etl_batches(batch_id) ON DELETE SET NULL,
    source_file    TEXT NOT NULL,
    sheet_name     TEXT NOT NULL,
    row_num        INT NOT NULL,
    raw_payload    JSONB NOT NULL,
    row_hash       TEXT NOT NULL UNIQUE,
    ingested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_staging.raw_catalog_products (
    id             BIGSERIAL PRIMARY KEY,
    batch_id       BIGINT REFERENCES raw_staging.etl_batches(batch_id) ON DELETE SET NULL,
    source_file    TEXT NOT NULL,
    sheet_name     TEXT NOT NULL,
    row_num        INT NOT NULL,
    raw_payload    JSONB NOT NULL,
    row_hash       TEXT NOT NULL UNIQUE,
    ingested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_staging.raw_catalog_entities (
    id             BIGSERIAL PRIMARY KEY,
    batch_id       BIGINT REFERENCES raw_staging.etl_batches(batch_id) ON DELETE SET NULL,
    source_file    TEXT NOT NULL,
    sheet_name     TEXT NOT NULL,
    row_num        INT NOT NULL,
    raw_payload    JSONB NOT NULL,
    row_hash       TEXT NOT NULL UNIQUE,
    ingested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_staging.raw_quotes_excel (
    id             BIGSERIAL PRIMARY KEY,
    batch_id       BIGINT REFERENCES raw_staging.etl_batches(batch_id) ON DELETE SET NULL,
    source_file    TEXT NOT NULL,
    sheet_name     TEXT NOT NULL,
    row_num        INT NOT NULL,
    raw_payload    JSONB NOT NULL,
    row_hash       TEXT NOT NULL UNIQUE,
    ingested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_staging.raw_json_doc_pages (
    id             BIGSERIAL PRIMARY KEY,
    batch_id       BIGINT REFERENCES raw_staging.etl_batches(batch_id) ON DELETE SET NULL,
    source_file    TEXT NOT NULL,
    page_index     INT NOT NULL,
    doc_kind       TEXT NOT NULL,
    issuer_ruc     TEXT,
    doc_series     TEXT,
    doc_number     TEXT,
    raw_payload    JSONB NOT NULL,
    row_hash       TEXT NOT NULL UNIQUE,
    ingested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_json_doc_ref
    ON raw_staging.raw_json_doc_pages (doc_kind, issuer_ruc, doc_series, doc_number);
