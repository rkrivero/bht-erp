-- 017_add_admin_opex_bucket.sql
-- Add ADMIN_OPEX value to erp.expense_bucket in its own committed transaction
-- before migration 018 references it (avoids PostgreSQL 55P04 unsafe enum use).

ALTER TYPE erp.expense_bucket ADD VALUE IF NOT EXISTS 'ADMIN_OPEX';
