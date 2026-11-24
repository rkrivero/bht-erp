-- 027_sequences_period_locks_and_credit_gate.sql
-- Adds:
--   1. Atomic document sequence table and generator (erp.document_sequences, erp.fn_next_document_code).
--   2. Closed daily period guard trigger (erp.fn_guard_closed_daily_period) on erp.cash_ledger,
--      erp.ar_payments, and erp.sales_orders with audited override and open-day collection/status allowance.
--   3. credit_limit_exceeded_flag on erp.sales_orders for soft credit-limit approval gating.
--   4. Quantitative credit suggestion view (analytics.v_customer_credit_suggestion) using isolated CTEs
--      (order_stats, monthly_volatility, payment_delays) to prevent order/payment fan-out in America/Lima timezone.

-- ============================================================================
-- 1. Atomic Document Sequences & Generator Function
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp.document_sequences (
    doc_type    TEXT NOT NULL,
    period_key  TEXT NOT NULL,
    last_value  BIGINT NOT NULL DEFAULT 0 CHECK (last_value >= 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (doc_type, period_key)
);

CREATE OR REPLACE FUNCTION erp.fn_next_document_code(
    p_doc_type   TEXT,
    p_prefix     TEXT,
    p_period_key TEXT,
    p_pad        INT DEFAULT 4
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_next BIGINT;
BEGIN
    IF NULLIF(BTRIM(p_doc_type), '') IS NULL THEN
        RAISE EXCEPTION 'p_doc_type no puede ser vacío' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(BTRIM(p_prefix), '') IS NULL THEN
        RAISE EXCEPTION 'p_prefix no puede ser vacío' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(BTRIM(p_period_key), '') IS NULL THEN
        RAISE EXCEPTION 'p_period_key no puede ser vacío' USING ERRCODE = '22023';
    END IF;

    INSERT INTO erp.document_sequences (doc_type, period_key, last_value, updated_at)
    VALUES (BTRIM(p_doc_type), BTRIM(p_period_key), 1, NOW())
    ON CONFLICT (doc_type, period_key)
    DO UPDATE SET
        last_value = erp.document_sequences.last_value + 1,
        updated_at = NOW()
    RETURNING last_value INTO v_next;

    RETURN BTRIM(p_prefix) || '-' || BTRIM(p_period_key) || '-' || LPAD(v_next::text, GREATEST(COALESCE(p_pad, 4), 1), '0');
END;
$$;

-- ============================================================================
-- 2. Closed Daily Period Guard Trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION erp.fn_guard_closed_daily_period()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_old_date DATE;
    v_new_date DATE;
    v_is_closed BOOLEAN;
BEGIN
    -- Allow explicit transactional override (audited post-close corrections & Admin Undo)
    IF COALESCE(current_setting('bht.allow_closed_period_override', true), 'false') = 'true' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    -- Allow historical backfill imports
    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.source_origin = 'HISTORICAL_BACKFILL' THEN
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'cash_ledger' THEN
        IF TG_OP IN ('DELETE', 'UPDATE') THEN
            v_old_date := OLD.tx_date;
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            v_new_date := NEW.tx_date;
        END IF;
    ELSIF TG_TABLE_NAME = 'ar_payments' THEN
        IF TG_OP IN ('DELETE', 'UPDATE') THEN
            v_old_date := OLD.payment_date;
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            v_new_date := NEW.payment_date;
        END IF;
    ELSIF TG_TABLE_NAME = 'sales_orders' THEN
        IF TG_OP = 'UPDATE' THEN
            -- Allow operational status progression, warehouse picking/delivery, and open-day collection sync
            -- on a closed-period order when core commercial/financial terms of that date are unchanged.
            IF OLD.order_date IS NOT DISTINCT FROM NEW.order_date
               AND OLD.total_pen IS NOT DISTINCT FROM NEW.total_pen
               AND OLD.global_discount_pen IS NOT DISTINCT FROM NEW.global_discount_pen
               AND OLD.customer_party_id IS NOT DISTINCT FROM NEW.customer_party_id
               AND OLD.payment_mode IS NOT DISTINCT FROM NEW.payment_mode THEN
                RETURN NEW;
            END IF;
            v_old_date := OLD.order_date;
            v_new_date := NEW.order_date;
        ELSIF TG_OP = 'DELETE' THEN
            v_old_date := OLD.order_date;
        ELSIF TG_OP = 'INSERT' THEN
            v_new_date := NEW.order_date;
        END IF;
    END IF;

    IF v_old_date IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1
            FROM erp.daily_closures dc
            WHERE dc.closure_date = v_old_date
              AND dc.status = 'CLOSED'
        ) INTO v_is_closed;

        IF v_is_closed THEN
            RAISE EXCEPTION 'Periodo cerrado (%): no se permiten modificaciones sin corrección auditada de cierre diario', v_old_date
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF v_new_date IS NOT NULL AND (v_old_date IS NULL OR v_new_date IS DISTINCT FROM v_old_date) THEN
        SELECT EXISTS (
            SELECT 1
            FROM erp.daily_closures dc
            WHERE dc.closure_date = v_new_date
              AND dc.status = 'CLOSED'
        ) INTO v_is_closed;

        IF v_is_closed THEN
            RAISE EXCEPTION 'Periodo cerrado (%): no se permiten registros sin corrección auditada de cierre diario', v_new_date
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_closed_period_cash_ledger ON erp.cash_ledger;
CREATE TRIGGER trg_guard_closed_period_cash_ledger
    BEFORE INSERT OR UPDATE OR DELETE ON erp.cash_ledger
    FOR EACH ROW EXECUTE FUNCTION erp.fn_guard_closed_daily_period();

DROP TRIGGER IF EXISTS trg_guard_closed_period_ar_payments ON erp.ar_payments;
CREATE TRIGGER trg_guard_closed_period_ar_payments
    BEFORE INSERT OR UPDATE OR DELETE ON erp.ar_payments
    FOR EACH ROW EXECUTE FUNCTION erp.fn_guard_closed_daily_period();

DROP TRIGGER IF EXISTS trg_guard_closed_period_sales_orders ON erp.sales_orders;
CREATE TRIGGER trg_guard_closed_period_sales_orders
    BEFORE INSERT OR UPDATE OR DELETE ON erp.sales_orders
    FOR EACH ROW EXECUTE FUNCTION erp.fn_guard_closed_daily_period();

-- ============================================================================
-- 3. Credit Limit Exceeded Flag on Sales Orders
-- ============================================================================

ALTER TABLE erp.sales_orders
    ADD COLUMN IF NOT EXISTS credit_limit_exceeded_flag BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================================
-- 4. Quantitative Credit Limit Suggestion View (Zero Fan-Out across CTEs)
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_customer_credit_suggestion AS
WITH lima_now AS (
    SELECT (NOW() AT TIME ZONE 'America/Lima')::date AS today_lima
),
order_stats AS (
    SELECT
        so.customer_party_id AS party_id,
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (
            WHERE so.order_date >= (ln.today_lima - 180)
              AND so.operational_status = 'DELIVERED'
        )::int AS delivered_orders_6m,
        COALESCE(SUM(so.total_pen), 0)::NUMERIC(14,2) AS total_purchased_pen,
        COALESCE(
            SUM(so.total_pen) FILTER (WHERE so.order_date >= (ln.today_lima - 180)),
            0
        )::NUMERIC(14,2) AS sales_6m_pen,
        COALESCE(
            SUM(so.total_pen) FILTER (WHERE so.order_date >= (ln.today_lima - 90)) / 3.0,
            0
        )::NUMERIC(14,2) AS monthly_run_rate_90d_pen,
        COALESCE(
            SUM(so.balance_due_pen) FILTER (
                WHERE so.is_settled = FALSE
                  AND so.balance_due_pen > 0.05
            ),
            0
        )::NUMERIC(14,2) AS open_ar_balance_pen,
        COALESCE(
            SUM(so.balance_due_pen) FILTER (
                WHERE so.is_settled = FALSE
                  AND so.balance_due_pen > 0.05
                  AND ln.today_lima > COALESCE(so.due_date, so.promised_payment_date, so.order_date)
            ),
            0
        )::NUMERIC(14,2) AS current_overdue_pen
    FROM erp.sales_orders so
    CROSS JOIN lima_now ln
    WHERE so.customer_party_id IS NOT NULL
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY so.customer_party_id
),
monthly_buckets AS (
    SELECT
        so.customer_party_id AS party_id,
        DATE_TRUNC('month', so.order_date)::date AS period_month,
        SUM(so.total_pen)::NUMERIC(14,2) AS month_sales_pen
    FROM erp.sales_orders so
    CROSS JOIN lima_now ln
    WHERE so.customer_party_id IS NOT NULL
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
      AND so.order_date >= (ln.today_lima - 180)
    GROUP BY so.customer_party_id, DATE_TRUNC('month', so.order_date)::date
),
monthly_volatility AS (
    SELECT
        mb.party_id,
        COUNT(*)::int AS active_months_6m,
        ROUND(AVG(mb.month_sales_pen), 2)::NUMERIC(14,2) AS avg_active_month_sales_pen,
        CASE
            WHEN COUNT(*) >= 2 AND AVG(mb.month_sales_pen) > 0
                THEN ROUND((COALESCE(STDDEV_POP(mb.month_sales_pen), 0) / AVG(mb.month_sales_pen))::numeric, 4)
            ELSE 0::numeric(10,4)
        END AS cv_monthly_sales
    FROM monthly_buckets mb
    GROUP BY mb.party_id
),
payment_delays AS (
    SELECT
        so.customer_party_id AS party_id,
        COUNT(ap.ar_payment_id)::int AS payments_count,
        ROUND(
            COALESCE(
                AVG(
                    GREATEST(
                        0,
                        (ap.payment_date - COALESCE(so.due_date, so.promised_payment_date, so.order_date))
                    )
                ),
                0
            )::numeric,
            2
        ) AS avg_payment_delay_days
    FROM erp.sales_orders so
    JOIN erp.ar_payments ap
      ON ap.order_id = so.order_id
     AND ap.voided_at IS NULL
    WHERE so.customer_party_id IS NOT NULL
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY so.customer_party_id
),
overdue_open_orders AS (
    SELECT
        so.customer_party_id AS party_id,
        ROUND(
            COALESCE(
                AVG(
                    GREATEST(
                        0,
                        (ln.today_lima - COALESCE(so.due_date, so.promised_payment_date, so.order_date))
                    )
                ),
                0
            )::numeric,
            2
        ) AS avg_open_overdue_days
    FROM erp.sales_orders so
    CROSS JOIN lima_now ln
    WHERE so.customer_party_id IS NOT NULL
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
      AND so.is_settled = FALSE
      AND so.balance_due_pen > 0.05
      AND ln.today_lima > COALESCE(so.due_date, so.promised_payment_date, so.order_date)
    GROUP BY so.customer_party_id
),
scored AS (
    SELECT
        pa.party_id,
        pa.party_id AS customer_party_id,
        COALESCE(NULLIF(BTRIM(pa.trade_name), ''), pa.legal_name) AS customer_name,
        COALESCE(pa.credit_days_agreed, 7)::int AS credit_days,
        pa.credit_limit_pen AS current_credit_limit_pen,
        COALESCE(os.total_orders, 0)::int AS total_orders,
        COALESCE(os.delivered_orders_6m, 0)::int AS delivered_orders_6m,
        COALESCE(mv.active_months_6m, 0)::int AS active_months_6m,
        ROUND(
            CASE
                WHEN COALESCE(os.monthly_run_rate_90d_pen, 0) > 0
                    THEN os.monthly_run_rate_90d_pen
                WHEN COALESCE(mv.active_months_6m, 0) > 0
                    THEN COALESCE(os.sales_6m_pen, 0) / GREATEST(mv.active_months_6m, 1)::numeric
                ELSE 0
            END,
            2
        )::NUMERIC(14,2) AS avg_monthly_sales_pen,
        COALESCE(mv.cv_monthly_sales, 0)::NUMERIC(10,4) AS cv_monthly_sales,
        ROUND(
            GREATEST(
                COALESCE(pd.avg_payment_delay_days, 0),
                COALESCE(oo.avg_open_overdue_days, 0)
            ),
            2
        )::NUMERIC(10,2) AS avg_days_overdue,
        COALESCE(os.open_ar_balance_pen, 0)::NUMERIC(14,2) AS open_ar_balance_pen,
        COALESCE(os.current_overdue_pen, 0)::NUMERIC(14,2) AS current_overdue_pen,
        CASE
            WHEN COALESCE(os.current_overdue_pen, 0) > 100 THEN 0.00
            WHEN GREATEST(COALESCE(pd.avg_payment_delay_days, 0), COALESCE(oo.avg_open_overdue_days, 0)) <= 0 THEN 1.20
            WHEN GREATEST(COALESCE(pd.avg_payment_delay_days, 0), COALESCE(oo.avg_open_overdue_days, 0)) <= 7 THEN 0.90
            WHEN GREATEST(COALESCE(pd.avg_payment_delay_days, 0), COALESCE(oo.avg_open_overdue_days, 0)) <= 15 THEN 0.60
            ELSE 0.20
        END::NUMERIC(6,2) AS punctuality_factor,
        CASE
            WHEN COALESCE(mv.active_months_6m, 0) < 2 THEN 0.85
            WHEN COALESCE(mv.cv_monthly_sales, 0) <= 0.30 THEN 1.00
            WHEN COALESCE(mv.cv_monthly_sales, 0) <= 0.60 THEN 0.90
            ELSE 0.80
        END::NUMERIC(6,2) AS volatility_factor
    FROM erp.parties pa
    LEFT JOIN order_stats os ON os.party_id = pa.party_id
    LEFT JOIN monthly_volatility mv ON mv.party_id = pa.party_id
    LEFT JOIN payment_delays pd ON pd.party_id = pa.party_id
    LEFT JOIN overdue_open_orders oo ON oo.party_id = pa.party_id
    WHERE pa.party_type IN ('CUSTOMER', 'BOTH')
)
SELECT
    s.party_id,
    s.customer_party_id,
    s.customer_name,
    s.credit_days,
    s.current_credit_limit_pen,
    s.total_orders,
    s.delivered_orders_6m,
    s.active_months_6m,
    s.avg_monthly_sales_pen,
    s.avg_monthly_sales_pen AS monthly_run_rate_pen,
    s.cv_monthly_sales,
    s.cv_monthly_sales AS monthly_cv,
    s.avg_days_overdue,
    s.avg_days_overdue AS avg_delay_days,
    s.open_ar_balance_pen,
    s.current_overdue_pen,
    s.punctuality_factor,
    s.volatility_factor,
    CASE
        WHEN s.punctuality_factor = 0 OR s.avg_monthly_sales_pen <= 0 THEN 0::NUMERIC(14,2)
        ELSE (
            ROUND(
                (
                    s.avg_monthly_sales_pen
                    * (GREATEST(s.credit_days, 1)::numeric / 30.0)
                    * s.punctuality_factor
                    * s.volatility_factor
                ) / 100.0
            ) * 100
        )::NUMERIC(14,2)
    END AS suggested_credit_limit_pen,
    CASE
        WHEN s.current_overdue_pen > 100 OR s.punctuality_factor = 0 THEN 'FROZEN'
        WHEN s.total_orders = 0 THEN 'UNRATED'
        WHEN s.avg_days_overdue <= 0 AND s.cv_monthly_sales <= 0.30 THEN 'EXCELLENT'
        WHEN s.avg_days_overdue <= 7 THEN 'NORMAL'
        WHEN s.avg_days_overdue <= 15 THEN 'SLOW'
        ELSE 'RISKY'
    END AS risk_tier
FROM scored s;
