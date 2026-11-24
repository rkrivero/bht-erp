-- Use Lima calendar dates for debtor aging and promised-payment status.
CREATE OR REPLACE VIEW analytics.v_debtors_aging AS
WITH payment_stats AS (
    SELECT
        p.order_id,
        COUNT(*) AS payment_count,
        MAX(p.payment_date) AS last_payment_date
    FROM erp.ar_payments p
    GROUP BY p.order_id
)
SELECT
    so.order_id,
    so.order_code,
    so.order_date,
    so.customer_party_id,
    COALESCE(pa.trade_name, pa.legal_name, so.customer_name_raw, 'CLIENTE SIN NOMBRE') AS customer_name,
    so.payment_mode::text AS payment_mode,
    so.operational_status::text AS operational_status,
    ROUND(so.total_pen, 2) AS total_pen,
    ROUND(so.paid_pen, 2) AS paid_pen,
    ROUND(so.balance_due_pen, 2) AS balance_due_pen,
    GREATEST(0, ((NOW() AT TIME ZONE 'America/Lima')::date - so.order_date))::int AS days_overdue,
    CASE
        WHEN ((NOW() AT TIME ZONE 'America/Lima')::date - so.order_date) >= 30 THEN 'RED_30_PLUS'
        WHEN ((NOW() AT TIME ZONE 'America/Lima')::date - so.order_date) >= 8 THEN 'AMBER_8_29'
        ELSE 'GREEN_0_7'
    END AS aging_bucket,
    so.promised_payment_date,
    CASE
        WHEN so.promised_payment_date IS NULL THEN 'NO_PROMISE_DATE'
        WHEN so.promised_payment_date < (NOW() AT TIME ZONE 'America/Lima')::date THEN 'PROMISE_BROKEN'
        WHEN so.promised_payment_date <= ((NOW() AT TIME ZONE 'America/Lima')::date + 1) THEN 'DUE_TODAY_OR_TOMORROW'
        ELSE 'ON_SCHEDULE'
    END AS promise_status,
    COALESCE(ps.payment_count, 0)::int AS payment_count,
    ps.last_payment_date,
    u.full_name AS created_by_name
FROM erp.sales_orders so
LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
LEFT JOIN payment_stats ps ON ps.order_id = so.order_id
LEFT JOIN erp.app_users u ON u.user_id = so.created_by_user_id
WHERE so.is_settled = FALSE
  AND so.balance_due_pen > 0.05
  AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
ORDER BY so.promised_payment_date ASC NULLS LAST, so.order_date ASC, so.order_id ASC;
