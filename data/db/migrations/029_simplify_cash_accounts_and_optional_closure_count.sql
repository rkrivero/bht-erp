-- 029_simplify_cash_accounts_and_optional_closure_count.sql
-- Simplifies cash accounts to 3 active bags (Caja General [CAJA_RUTA], Cuenta BCP, Cuenta Interbank),
-- makes daily closure physical/bank count & variance columns nullable, and resolves the historical
-- MISSING_BANK_STATEMENT_LEDGER audit flag.

-- ============================================================================
-- 1. Consolidate Active Cash Accounts (3 Active Accounts)
-- ============================================================================

-- Archive unused empty CAJA_GENERAL row before renaming CAJA_RUTA
UPDATE erp.cash_accounts
SET name = 'Caja General (archivada)',
    is_active = FALSE
WHERE code = 'CAJA_GENERAL';

-- Rename CAJA_RUTA to 'Caja General' while preserving immutable technical code 'CAJA_RUTA'
UPDATE erp.cash_accounts
SET name = 'Caja General',
    is_active = TRUE
WHERE code = 'CAJA_RUTA';

-- Reassign historical CUSTODIA_SAMUEL entry (DEUDA_SAMUEL) to CAJA_RUTA
UPDATE erp.cash_ledger
SET account_id = (SELECT account_id FROM erp.cash_accounts WHERE code = 'CAJA_RUTA')
WHERE account_id = (SELECT account_id FROM erp.cash_accounts WHERE code = 'CUSTODIA_SAMUEL')
  AND source_origin = 'HISTORICAL_BACKFILL'
  AND reference_id = 'DEUDA_SAMUEL';

-- Deactivate YAPE_PLIN_BHT and CUSTODIA_SAMUEL
UPDATE erp.cash_accounts
SET is_active = FALSE
WHERE code IN ('YAPE_PLIN_BHT', 'CUSTODIA_SAMUEL');

-- ============================================================================
-- 2. Optional Daily Closure Counts (Allow NULL instead of fake 0.00)
-- ============================================================================

ALTER TABLE erp.daily_closures
    ALTER COLUMN counted_cash_total_pen DROP NOT NULL,
    ALTER COLUMN variance_total_pen DROP NOT NULL;

ALTER TABLE erp.daily_closure_accounts
    ALTER COLUMN counted_balance_pen DROP NOT NULL;

-- ============================================================================
-- 3. Resolve Historical Missing Bank Statement Flag
-- ============================================================================

UPDATE erp.audit_flags
SET status = 'RESOLVED',
    resolved_at = COALESCE(resolved_at, NOW()),
    resolved_by = COALESCE(resolved_by, 'socio_admin'),
    resolution_note = COALESCE(
        resolution_note,
        'Operación migrada a flujo diario sin extractos bancarios históricos (migración 029).'
    )
WHERE flag_code = 'MISSING_BANK_STATEMENT_LEDGER'
  AND status <> 'RESOLVED';
