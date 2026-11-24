-- Migration 031: Security ownership on quotes, unique active email index,
-- concurrent payment trigger lock, closed-period guard hardening, stock_quants
-- alignment, analytics views global_discount_pen/cutoff fixes, and FK indexes.

-- ============================================================================
-- 1. Quote ownership & active user email uniqueness
-- ============================================================================

ALTER TABLE erp.quotes
    ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT REFERENCES erp.app_users(user_id);

WITH unique_active_users AS (
    SELECT
        LOWER(BTRIM(full_name)) AS norm_name,
        MIN(user_id) AS user_id
    FROM erp.app_users
    WHERE is_active = TRUE
      AND username NOT LIKE '%\_\_deleted\_%' ESCAPE '\'
      AND NULLIF(BTRIM(full_name), '') IS NOT NULL
    GROUP BY LOWER(BTRIM(full_name))
    HAVING COUNT(*) = 1
)
UPDATE erp.quotes q
SET created_by_user_id = u.user_id
FROM unique_active_users u
WHERE q.created_by_user_id IS NULL
  AND NULLIF(BTRIM(q.seller_name), '') IS NOT NULL
  AND LOWER(BTRIM(q.seller_name)) = u.norm_name;

CREATE INDEX IF NOT EXISTS idx_quotes_created_by_user
    ON erp.quotes (created_by_user_id)
    WHERE created_by_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_users_email_active
    ON erp.app_users (LOWER(BTRIM(email)))
    WHERE email IS NOT NULL
      AND BTRIM(email) <> ''
      AND username NOT LIKE '%\_\_deleted\_%' ESCAPE '\';

-- ============================================================================
-- 2. Serialize AR payment sync per sales_order (prevent lost updates)
-- ============================================================================

CREATE OR REPLACE FUNCTION erp.fn_sync_ar_payment_to_order()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_order_id BIGINT;
    v_old_order_id BIGINT;
    v_first_id BIGINT;
    v_second_id BIGINT;
    v_sum_paid NUMERIC(14,2);
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id THEN
        v_first_id := LEAST(OLD.order_id, NEW.order_id);
        v_second_id := GREATEST(OLD.order_id, NEW.order_id);
        PERFORM 1 FROM erp.sales_orders WHERE order_id = v_first_id FOR UPDATE;
        PERFORM 1 FROM erp.sales_orders WHERE order_id = v_second_id FOR UPDATE;
    ELSIF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM 1 FROM erp.sales_orders WHERE order_id = NEW.order_id FOR UPDATE;
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM 1 FROM erp.sales_orders WHERE order_id = OLD.order_id FOR UPDATE;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        v_order_id := NEW.order_id;
        SELECT COALESCE(SUM(amount_pen) FILTER (WHERE voided_at IS NULL), 0)
          INTO v_sum_paid
          FROM erp.ar_payments
         WHERE order_id = v_order_id;

        UPDATE erp.sales_orders
           SET paid_pen = v_sum_paid
         WHERE order_id = v_order_id;
    END IF;

    IF TG_OP IN ('DELETE', 'UPDATE') AND (TG_OP = 'DELETE' OR OLD.order_id IS DISTINCT FROM NEW.order_id) THEN
        v_old_order_id := OLD.order_id;
        SELECT COALESCE(SUM(amount_pen) FILTER (WHERE voided_at IS NULL), 0)
          INTO v_sum_paid
          FROM erp.ar_payments
         WHERE order_id = v_old_order_id;

        UPDATE erp.sales_orders
           SET paid_pen = v_sum_paid
         WHERE order_id = v_old_order_id;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============================================================================
-- 3. Harden closed-period guard (status transitions, backfill INSERT-only, lines)
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

    -- Allow historical backfill imports only on INSERT
    IF TG_OP = 'INSERT' AND NEW.source_origin = 'HISTORICAL_BACKFILL' THEN
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
            -- Allow warehouse picking/delivery progression and open-day collection sync
            -- only when commercial/financial terms AND cancellation/approval state are unchanged.
            IF OLD.order_date IS NOT DISTINCT FROM NEW.order_date
               AND OLD.total_pen IS NOT DISTINCT FROM NEW.total_pen
               AND OLD.global_discount_pen IS NOT DISTINCT FROM NEW.global_discount_pen
               AND OLD.customer_party_id IS NOT DISTINCT FROM NEW.customer_party_id
               AND OLD.payment_mode IS NOT DISTINCT FROM NEW.payment_mode
               AND (
                   OLD.operational_status IS NOT DISTINCT FROM NEW.operational_status
                   OR (
                       OLD.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
                       AND NEW.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
                   )
               ) THEN
                RETURN NEW;
            END IF;
            v_old_date := OLD.order_date;
            v_new_date := NEW.order_date;
        ELSIF TG_OP = 'DELETE' THEN
            v_old_date := OLD.order_date;
        ELSIF TG_OP = 'INSERT' THEN
            v_new_date := NEW.order_date;
        END IF;
    ELSIF TG_TABLE_NAME = 'sales_order_lines' THEN
        IF TG_OP IN ('DELETE', 'UPDATE') THEN
            SELECT so.order_date INTO v_old_date
            FROM erp.sales_orders so
            WHERE so.order_id = OLD.order_id;
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            SELECT so.order_date INTO v_new_date
            FROM erp.sales_orders so
            WHERE so.order_id = NEW.order_id;
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

DROP TRIGGER IF EXISTS trg_guard_closed_period_sales_order_lines ON erp.sales_order_lines;
CREATE TRIGGER trg_guard_closed_period_sales_order_lines
    BEFORE INSERT OR UPDATE OR DELETE ON erp.sales_order_lines
    FOR EACH ROW EXECUTE FUNCTION erp.fn_guard_closed_daily_period();

-- ============================================================================
-- 4. Use stock_quants in fn_flag_on_demand_sale_line & refresh last_movement_at
-- ============================================================================

CREATE OR REPLACE FUNCTION erp.fn_flag_on_demand_sale_line()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_prod_mode erp.fulfillment_mode;
    v_sku TEXT;
    v_wh_id BIGINT;
    v_on_hand NUMERIC(14,4);
    v_required NUMERIC(14,4);
BEGIN
    SELECT p.fulfillment_mode, p.sku
      INTO v_prod_mode, v_sku
      FROM erp.products p
     WHERE p.product_id = NEW.product_id;

    SELECT so.warehouse_id
      INTO v_wh_id
      FROM erp.sales_orders so
     WHERE so.order_id = NEW.order_id;

    v_required := NEW.quantity * NEW.pack_factor_applied;

    SELECT COALESCE(sq.qty_on_hand, 0)
      INTO v_on_hand
      FROM erp.stock_quants sq
     WHERE sq.warehouse_id = v_wh_id
       AND sq.product_id = NEW.product_id;

    v_on_hand := COALESCE(v_on_hand, 0);

    IF TG_OP = 'INSERT' THEN
        NEW.fulfillment_mode := v_prod_mode;

        IF v_prod_mode = 'ON_DEMAND'
           AND NEW.fulfilling_purchase_line_id IS NULL
           AND v_on_hand < v_required
           AND NEW.source_origin = 'ERP_APP' THEN
            NEW.fulfillment_status := 'PENDING_SUPPLIER_PURCHASE';

            INSERT INTO erp.audit_flags (
                flag_code,
                severity,
                entity_table,
                entity_id,
                message,
                details,
                source_origin
            )
            VALUES (
                'ON_DEMAND_PENDING_PURCHASE',
                'WARNING',
                'erp.sales_order_lines',
                NEW.order_line_id::text,
                format('ON_DEMAND sale line #%s for SKU %s awaiting supplier purchase (on_hand=%s, required=%s)',
                       NEW.order_line_id, v_sku, v_on_hand, v_required),
                jsonb_build_object(
                    'order_id', NEW.order_id,
                    'order_line_id', NEW.order_line_id,
                    'product_id', NEW.product_id,
                    'sku', v_sku,
                    'warehouse_id', v_wh_id,
                    'on_hand_at_order', v_on_hand,
                    'required_base_qty', v_required
                ),
                NEW.source_origin
            )
            ON CONFLICT (flag_code, entity_table, entity_id)
            WHERE status = 'OPEN'
            DO UPDATE SET
                message = EXCLUDED.message,
                details = EXCLUDED.details;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.fulfilling_purchase_line_id IS NOT NULL
           AND OLD.fulfillment_status = 'PENDING_SUPPLIER_PURCHASE'
           AND NEW.fulfillment_status = 'PENDING_SUPPLIER_PURCHASE' THEN
            NEW.fulfillment_status := 'FULFILLED';
        END IF;

        IF NEW.fulfillment_status = 'FULFILLED' THEN
            UPDATE erp.audit_flags
               SET status = 'RESOLVED',
                   resolved_at = NOW(),
                   resolved_by = 'TRIGGER_FULFILLMENT_LINK'
             WHERE flag_code = 'ON_DEMAND_PENDING_PURCHASE'
               AND entity_table = 'erp.sales_order_lines'
               AND entity_id = NEW.order_line_id::text
               AND status = 'OPEN';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION erp.fn_sync_stock_quants()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_last_movement TIMESTAMPTZ;
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO erp.stock_quants (
            warehouse_id,
            product_id,
            qty_on_hand,
            qty_reserved,
            last_movement_at,
            updated_at
        )
        VALUES (
            NEW.warehouse_id,
            NEW.product_id,
            NEW.quantity_delta,
            0,
            NEW.movement_date,
            NOW()
        )
        ON CONFLICT (warehouse_id, product_id)
        DO UPDATE SET
            qty_on_hand = erp.stock_quants.qty_on_hand + EXCLUDED.qty_on_hand,
            last_movement_at = GREATEST(
                COALESCE(erp.stock_quants.last_movement_at, EXCLUDED.last_movement_at),
                EXCLUDED.last_movement_at
            ),
            updated_at = NOW();
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        SELECT MAX(im.movement_date)
          INTO v_last_movement
          FROM erp.inventory_movements im
         WHERE im.warehouse_id = OLD.warehouse_id
           AND im.product_id = OLD.product_id;

        INSERT INTO erp.stock_quants (
            warehouse_id,
            product_id,
            qty_on_hand,
            qty_reserved,
            last_movement_at,
            updated_at
        )
        VALUES (
            OLD.warehouse_id,
            OLD.product_id,
            -OLD.quantity_delta,
            0,
            v_last_movement,
            NOW()
        )
        ON CONFLICT (warehouse_id, product_id)
        DO UPDATE SET
            qty_on_hand = erp.stock_quants.qty_on_hand - OLD.quantity_delta,
            last_movement_at = v_last_movement,
            updated_at = NOW();
        RETURN OLD;

    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.warehouse_id = NEW.warehouse_id AND OLD.product_id = NEW.product_id THEN
            SELECT MAX(im.movement_date)
              INTO v_last_movement
              FROM erp.inventory_movements im
             WHERE im.warehouse_id = NEW.warehouse_id
               AND im.product_id = NEW.product_id;

            INSERT INTO erp.stock_quants (
                warehouse_id,
                product_id,
                qty_on_hand,
                qty_reserved,
                last_movement_at,
                updated_at
            )
            VALUES (
                NEW.warehouse_id,
                NEW.product_id,
                NEW.quantity_delta - OLD.quantity_delta,
                0,
                v_last_movement,
                NOW()
            )
            ON CONFLICT (warehouse_id, product_id)
            DO UPDATE SET
                qty_on_hand = erp.stock_quants.qty_on_hand + (NEW.quantity_delta - OLD.quantity_delta),
                last_movement_at = v_last_movement,
                updated_at = NOW();
        ELSE
            SELECT MAX(im.movement_date)
              INTO v_last_movement
              FROM erp.inventory_movements im
             WHERE im.warehouse_id = OLD.warehouse_id
               AND im.product_id = OLD.product_id;

            INSERT INTO erp.stock_quants (
                warehouse_id,
                product_id,
                qty_on_hand,
                qty_reserved,
                last_movement_at,
                updated_at
            )
            VALUES (
                OLD.warehouse_id,
                OLD.product_id,
                -OLD.quantity_delta,
                0,
                v_last_movement,
                NOW()
            )
            ON CONFLICT (warehouse_id, product_id)
            DO UPDATE SET
                qty_on_hand = erp.stock_quants.qty_on_hand - OLD.quantity_delta,
                last_movement_at = v_last_movement,
                updated_at = NOW();

            INSERT INTO erp.stock_quants (
                warehouse_id,
                product_id,
                qty_on_hand,
                qty_reserved,
                last_movement_at,
                updated_at
            )
            VALUES (
                NEW.warehouse_id,
                NEW.product_id,
                NEW.quantity_delta,
                0,
                NEW.movement_date,
                NOW()
            )
            ON CONFLICT (warehouse_id, product_id)
            DO UPDATE SET
                qty_on_hand = erp.stock_quants.qty_on_hand + EXCLUDED.qty_on_hand,
                last_movement_at = GREATEST(
                    COALESCE(erp.stock_quants.last_movement_at, EXCLUDED.last_movement_at),
                    EXCLUDED.last_movement_at
                ),
                updated_at = NOW();
        END IF;
        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$;

-- ============================================================================
-- 5. Harden analytics views: global_discount_pen, kpi_cutoff_date, ADMIN_OPEX, due date
-- ============================================================================

CREATE OR REPLACE VIEW analytics.v_kpi_cash_and_reinvestment AS
WITH params AS (
    SELECT
        erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26') AS cutoff_date,
        erp.fn_get_setting_numeric('drain_alert_pct', 30.0) AS drain_alert_pct,
        erp.fn_get_setting_numeric('route_opex_alert_pct', 8.0) AS route_opex_alert_pct
),
monthly_sales AS (
    SELECT
        DATE_TRUNC('month', so.order_date)::DATE AS period_month,
        COUNT(*) AS order_count,
        COALESCE(SUM(so.total_pen), 0)::NUMERIC(14,2) AS sales_total_pen,
        COALESCE(SUM(so.paid_pen), 0)::NUMERIC(14,2) AS cash_collected_pen,
        COALESCE(SUM(so.balance_due_pen), 0)::NUMERIC(14,2) AS ar_pending_pen
    FROM erp.sales_orders so
    CROSS JOIN params p
    WHERE so.order_date >= p.cutoff_date
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY DATE_TRUNC('month', so.order_date)::DATE
),
monthly_collections AS (
    SELECT
        DATE_TRUNC('month', ap.payment_date)::DATE AS period_month,
        COALESCE(SUM(ap.amount_pen), 0)::NUMERIC(14,2) AS effective_cash_collected_pen
    FROM erp.ar_payments ap
    JOIN erp.sales_orders so ON so.order_id = ap.order_id
    CROSS JOIN params p
    WHERE ap.voided_at IS NULL
      AND ap.payment_date >= p.cutoff_date
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY DATE_TRUNC('month', ap.payment_date)::DATE
),
monthly_cash AS (
    SELECT
        DATE_TRUNC('month', cl.tx_date)::DATE AS period_month,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'IN' AND NOT cl.is_internal_transfer), 0)::NUMERIC(14,2) AS ledger_inflow_pen,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'MERCHANDISE_PAYMENT'), 0)::NUMERIC(14,2) AS merchandise_outflow_pen,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'ROUTE_OPEX'), 0)::NUMERIC(14,2) AS route_opex_pen,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'ADMIN_OPEX'), 0)::NUMERIC(14,2) AS admin_opex_bucket_pen,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_bucket = 'NON_OPEX_OR_CAPEX'), 0)::NUMERIC(14,2) AS non_opex_capex_drain_pen,
        COALESCE(SUM(cl.amount_pen) FILTER (
            WHERE cl.direction = 'OUT'
              AND NOT cl.is_internal_transfer
              AND cl.expense_bucket = 'NON_OPEX_OR_CAPEX'
              AND cl.expense_category IN (
                  'PAYROLL_ADVANCE', 'ACCOUNTING_OR_LEGAL', 'ACCOUNTING_SERVICE',
                  'LEGAL_NOTARIA', 'FINANCIAL_FEE', 'SUELDO_SOCIO',
                  'PLANILLA_PERSONAL', 'ALQUILER', 'SERVICIOS_BASICOS',
                  'IMPUESTOS_OPERATIVOS', 'SOFTWARE_OFICINA', 'OTROS_ADMIN'
              )
        ), 0)::NUMERIC(14,2) AS legacy_admin_in_non_opex_pen,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer AND cl.expense_category = 'SUELDO_SOCIO'), 0)::NUMERIC(14,2) AS owner_salary_recorded_pen,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.is_internal_transfer AND cl.direction = 'OUT'), 0)::NUMERIC(14,2) AS internal_deposits_pen
    FROM erp.cash_ledger cl
    CROSS JOIN params p
    WHERE cl.tx_date >= p.cutoff_date
      AND NOT cl.is_reversal
      AND cl.expense_category IS DISTINCT FROM 'CONCILIACION_SALDO'
      AND NOT EXISTS (
          SELECT 1 FROM erp.cash_ledger rev
          WHERE rev.reversal_of_ledger_id = cl.ledger_id
      )
    GROUP BY DATE_TRUNC('month', cl.tx_date)::DATE
),
trip_paid AS (
    SELECT
        so.trip_id,
        COALESCE(SUM(so.paid_pen), 0)::NUMERIC(14,2) AS paid_pen
    FROM erp.sales_orders so
    WHERE so.trip_id IS NOT NULL
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY so.trip_id
),
trip_route_opex AS (
    SELECT
        cl.trip_id,
        COALESCE(SUM(cl.amount_pen), 0)::NUMERIC(14,2) AS route_opex_pen
    FROM erp.cash_ledger cl
    WHERE cl.trip_id IS NOT NULL
      AND cl.direction = 'OUT'
      AND NOT cl.is_internal_transfer
      AND NOT cl.is_reversal
      AND cl.expense_category IS DISTINCT FROM 'CONCILIACION_SALDO'
      AND cl.expense_bucket = 'ROUTE_OPEX'
      AND NOT EXISTS (
          SELECT 1 FROM erp.cash_ledger rev
          WHERE rev.reversal_of_ledger_id = cl.ledger_id
      )
    GROUP BY cl.trip_id
),
monthly_trips AS (
    SELECT
        DATE_TRUNC('month', rt.trip_date)::DATE AS period_month,
        COUNT(*) FILTER (WHERE rt.declared_net_cash_pen IS NOT NULL) AS reconciled_trips_count,
        COALESCE(SUM(rt.declared_net_cash_pen) FILTER (WHERE rt.declared_net_cash_pen IS NOT NULL), 0)::NUMERIC(14,2) AS declared_net_cash_pen,
        COALESCE(
            SUM(COALESCE(tp.paid_pen, 0) - COALESCE(tro.route_opex_pen, 0))
            FILTER (WHERE rt.declared_net_cash_pen IS NOT NULL),
            0
        )::NUMERIC(14,2) AS expected_net_cash_pen
    FROM erp.route_trips rt
    CROSS JOIN params p
    LEFT JOIN trip_paid tp ON tp.trip_id = rt.trip_id
    LEFT JOIN trip_route_opex tro ON tro.trip_id = rt.trip_id
    WHERE rt.trip_date >= p.cutoff_date
    GROUP BY DATE_TRUNC('month', rt.trip_date)::DATE
),
pre_route_outflows AS (
    SELECT
        DATE_TRUNC('month', cl.tx_date)::DATE AS period_month,
        COALESCE(SUM(cl.amount_pen) FILTER (WHERE cl.direction = 'OUT' AND NOT cl.is_internal_transfer), 0)::NUMERIC(14,2) AS pre_route_foundational_outflow_pen
    FROM erp.cash_ledger cl
    CROSS JOIN params p
    WHERE cl.tx_date < p.cutoff_date
      AND NOT cl.is_reversal
      AND cl.expense_category IS DISTINCT FROM 'CONCILIACION_SALDO'
      AND NOT EXISTS (
          SELECT 1 FROM erp.cash_ledger rev
          WHERE rev.reversal_of_ledger_id = cl.ledger_id
      )
    GROUP BY DATE_TRUNC('month', cl.tx_date)::DATE
),
all_months AS (
    SELECT period_month FROM monthly_sales
    UNION
    SELECT period_month FROM monthly_collections
    UNION
    SELECT period_month FROM monthly_cash
    UNION
    SELECT period_month FROM monthly_trips
    UNION
    SELECT period_month FROM pre_route_outflows
)
SELECT
    m.period_month,
    COALESCE(ms.order_count, 0) AS order_count,
    COALESCE(ms.sales_total_pen, 0)::NUMERIC(14,2) AS sales_total_pen,
    COALESCE(mcol.effective_cash_collected_pen, 0)::NUMERIC(14,2) AS cash_collected_pen,
    COALESCE(ms.ar_pending_pen, 0)::NUMERIC(14,2) AS ar_pending_pen,
    COALESCE(mc.route_opex_pen, 0)::NUMERIC(14,2) AS route_opex_pen,
    ROUND(COALESCE(mc.route_opex_pen, 0) * 100.0 / NULLIF(ms.sales_total_pen, 0), 2) AS route_opex_pct,
    (COALESCE(ms.sales_total_pen, 0) - COALESCE(mc.route_opex_pen, 0))::NUMERIC(14,2) AS route_operating_cash_margin_pen,
    ROUND((COALESCE(ms.sales_total_pen, 0) - COALESCE(mc.route_opex_pen, 0)) * 100.0 / NULLIF(ms.sales_total_pen, 0), 2) AS route_operating_cash_margin_pct,
    COALESCE(mc.merchandise_outflow_pen, 0)::NUMERIC(14,2) AS merchandise_outflow_pen,
    COALESCE(mc.non_opex_capex_drain_pen, 0)::NUMERIC(14,2) AS non_opex_capex_drain_pen,
    COALESCE(mc.internal_deposits_pen, 0)::NUMERIC(14,2) AS internal_deposits_pen,
    ROUND(
        COALESCE(mc.non_opex_capex_drain_pen, 0) * 100.0
        / NULLIF(
            COALESCE(mc.merchandise_outflow_pen, 0)
            + COALESCE(mc.route_opex_pen, 0)
            + COALESCE(mc.admin_opex_bucket_pen, 0)
            + COALESCE(mc.non_opex_capex_drain_pen, 0),
            0
        ),
        2
    ) AS non_opex_drain_of_outflows_pct,
    ROUND(
        COALESCE(mc.merchandise_outflow_pen, 0) * 100.0
        / NULLIF(COALESCE(mc.merchandise_outflow_pen, 0) + COALESCE(mc.non_opex_capex_drain_pen, 0), 0),
        2
    ) AS reinvestment_share_pct,
    ROUND(
        COALESCE(mc.non_opex_capex_drain_pen, 0) * 100.0
        / NULLIF(COALESCE(mc.merchandise_outflow_pen, 0) + COALESCE(mc.non_opex_capex_drain_pen, 0), 0),
        2
    ) AS drain_vs_reinvestment_pct,
    COALESCE(mt.reconciled_trips_count, 0) AS reconciled_trips_count,
    COALESCE(mt.declared_net_cash_pen, 0)::NUMERIC(14,2) AS declared_net_cash_pen,
    COALESCE(mt.expected_net_cash_pen, 0)::NUMERIC(14,2) AS expected_net_cash_pen,
    (COALESCE(mt.declared_net_cash_pen, 0) - COALESCE(mt.expected_net_cash_pen, 0))::NUMERIC(14,2) AS cash_reconciliation_gap_pen,
    ROUND(
        ABS(COALESCE(mt.declared_net_cash_pen, 0) - COALESCE(mt.expected_net_cash_pen, 0)) * 100.0
        / NULLIF(GREATEST(ABS(COALESCE(mt.expected_net_cash_pen, 0)), ABS(COALESCE(ms.sales_total_pen, 0))), 0),
        2
    ) AS cash_reconciliation_gap_pct,
    (
        ROUND(
            COALESCE(mc.non_opex_capex_drain_pen, 0) * 100.0
            / NULLIF(COALESCE(mc.merchandise_outflow_pen, 0) + COALESCE(mc.non_opex_capex_drain_pen, 0), 0),
            2
        ) > p.drain_alert_pct
    ) AS drain_above_30pct_alert,
    (COALESCE(mc.route_opex_pen, 0) * 100.0 / NULLIF(ms.sales_total_pen, 0) > p.route_opex_alert_pct) AS route_opex_above_8pct_alert,
    COALESCE(pro.pre_route_foundational_outflow_pen, 0)::NUMERIC(14,2) AS pre_route_foundational_outflow_pen,
    (COALESCE(mc.admin_opex_bucket_pen, 0) + COALESCE(mc.legacy_admin_in_non_opex_pen, 0))::NUMERIC(14,2) AS admin_opex_pen,
    COALESCE(mc.admin_opex_bucket_pen, 0)::NUMERIC(14,2) AS admin_opex_bucket_pen,
    GREATEST(COALESCE(mc.non_opex_capex_drain_pen, 0) - COALESCE(mc.legacy_admin_in_non_opex_pen, 0), 0)::NUMERIC(14,2) AS owner_capex_debt_outflow_pen,
    COALESCE(mc.owner_salary_recorded_pen, 0)::NUMERIC(14,2) AS owner_salary_recorded_pen,
    COALESCE(ms.cash_collected_pen, 0)::NUMERIC(14,2) AS order_cohort_collected_pen
FROM all_months m
CROSS JOIN params p
LEFT JOIN monthly_sales ms ON ms.period_month = m.period_month
LEFT JOIN monthly_collections mcol ON mcol.period_month = m.period_month
LEFT JOIN monthly_cash mc ON mc.period_month = m.period_month
LEFT JOIN monthly_trips mt ON mt.period_month = m.period_month
LEFT JOIN pre_route_outflows pro ON pro.period_month = m.period_month
ORDER BY m.period_month;

CREATE OR REPLACE VIEW analytics.v_report_monthly_pnl AS
WITH line_net AS (
    SELECT
        DATE_TRUNC('month', so.order_date)::DATE AS period_month,
        (
            sol.line_total_pen * GREATEST(
                0::NUMERIC,
                1.0 - COALESCE(so.global_discount_pen, 0)
                    / NULLIF(SUM(sol.line_total_pen) OVER (PARTITION BY sol.order_id), 0)
            )
        ) AS net_line_total_pen,
        (sol.quantity * sol.pack_factor_applied) * COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) AS line_cogs_pen,
        (COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL) AS has_cost
    FROM erp.sales_order_lines sol
    JOIN erp.sales_orders so ON so.order_id = sol.order_id
    JOIN erp.products p ON p.product_id = sol.product_id
    WHERE so.order_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26')
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
),
monthly_cogs AS (
    SELECT
        period_month,
        ROUND(COALESCE(SUM(net_line_total_pen) FILTER (WHERE has_cost), 0), 2)::NUMERIC(14,2) AS cost_covered_sales_pen,
        ROUND(COALESCE(SUM(line_cogs_pen) FILTER (WHERE has_cost), 0), 2)::NUMERIC(14,2) AS cogs_pen
    FROM line_net
    GROUP BY period_month
),
joined AS (
    SELECT
        k.period_month,
        k.order_count,
        k.sales_total_pen,
        COALESCE(mc.cost_covered_sales_pen, 0)::NUMERIC(14,2) AS cost_covered_sales_pen,
        COALESCE(mc.cogs_pen, 0)::NUMERIC(14,2) AS cogs_pen,
        (COALESCE(mc.cost_covered_sales_pen, 0) - COALESCE(mc.cogs_pen, 0))::NUMERIC(14,2) AS gross_margin_pen,
        k.route_opex_pen,
        k.route_opex_pct,
        k.cash_collected_pen,
        k.ar_pending_pen,
        k.merchandise_outflow_pen,
        k.non_opex_capex_drain_pen,
        k.internal_deposits_pen,
        k.pre_route_foundational_outflow_pen,
        k.admin_opex_pen,
        k.admin_opex_bucket_pen,
        k.owner_capex_debt_outflow_pen,
        k.owner_salary_recorded_pen
    FROM analytics.v_kpi_cash_and_reinvestment k
    LEFT JOIN monthly_cogs mc ON mc.period_month = k.period_month
)
SELECT
    j.period_month,
    j.order_count,
    j.sales_total_pen,
    j.cost_covered_sales_pen,
    ROUND(j.cost_covered_sales_pen * 100.0 / NULLIF(j.sales_total_pen, 0), 2) AS cost_coverage_pct,
    j.cogs_pen,
    j.gross_margin_pen,
    ROUND(j.gross_margin_pen * 100.0 / NULLIF(j.cost_covered_sales_pen, 0), 2) AS gross_margin_pct,
    j.route_opex_pen,
    j.route_opex_pct,
    (j.gross_margin_pen - j.route_opex_pen)::NUMERIC(14,2) AS operating_ebitda_pen,
    ROUND((j.gross_margin_pen - j.route_opex_pen) * 100.0 / NULLIF(j.cost_covered_sales_pen, 0), 2) AS operating_ebitda_pct,
    j.cash_collected_pen,
    j.ar_pending_pen,
    j.merchandise_outflow_pen,
    j.non_opex_capex_drain_pen,
    j.internal_deposits_pen,
    j.pre_route_foundational_outflow_pen,
    (
        j.cash_collected_pen
        - j.merchandise_outflow_pen
        - j.route_opex_pen
        - j.admin_opex_bucket_pen
        - j.non_opex_capex_drain_pen
    )::NUMERIC(14,2) AS net_cash_flow_pen,
    j.admin_opex_pen,
    (j.route_opex_pen + j.admin_opex_pen)::NUMERIC(14,2) AS total_opex_pen,
    (j.gross_margin_pen - j.route_opex_pen - j.admin_opex_pen)::NUMERIC(14,2) AS operating_result_pen,
    ROUND(
        (j.gross_margin_pen - j.route_opex_pen - j.admin_opex_pen) * 100.0 / NULLIF(j.cost_covered_sales_pen, 0),
        2
    ) AS operating_result_pct,
    j.owner_salary_recorded_pen,
    j.owner_capex_debt_outflow_pen
FROM joined j
ORDER BY j.period_month ASC;

CREATE OR REPLACE VIEW analytics.v_report_route_profitability AS
WITH trip_orders AS (
    SELECT
        so.trip_id,
        COUNT(*)::int AS order_count,
        COALESCE(SUM(so.total_pen), 0)::NUMERIC(14,2) AS sales_total_pen,
        COALESCE(SUM(so.paid_pen), 0)::NUMERIC(14,2) AS cash_collected_pen,
        COALESCE(SUM(so.balance_due_pen), 0)::NUMERIC(14,2) AS ar_pending_pen
    FROM erp.sales_orders so
    WHERE so.trip_id IS NOT NULL
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY so.trip_id
),
trip_line_net AS (
    SELECT
        so.trip_id,
        (
            sol.line_total_pen * GREATEST(
                0::NUMERIC,
                1.0 - COALESCE(so.global_discount_pen, 0)
                    / NULLIF(SUM(sol.line_total_pen) OVER (PARTITION BY sol.order_id), 0)
            )
        ) AS net_line_total_pen,
        (sol.quantity * sol.pack_factor_applied) * COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) AS line_cogs_pen,
        (COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL) AS has_cost
    FROM erp.sales_order_lines sol
    JOIN erp.sales_orders so ON so.order_id = sol.order_id
    JOIN erp.products p ON p.product_id = sol.product_id
    WHERE so.trip_id IS NOT NULL
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
),
trip_cogs AS (
    SELECT
        trip_id,
        ROUND(COALESCE(SUM(net_line_total_pen) FILTER (WHERE has_cost), 0), 2)::NUMERIC(14,2) AS cost_covered_sales_pen,
        ROUND(COALESCE(SUM(line_cogs_pen) FILTER (WHERE has_cost), 0), 2)::NUMERIC(14,2) AS known_cogs_pen
    FROM trip_line_net
    GROUP BY trip_id
),
trip_opex AS (
    SELECT
        cl.trip_id,
        COALESCE(SUM(cl.amount_pen), 0)::NUMERIC(14,2) AS route_opex_pen
    FROM erp.cash_ledger cl
    WHERE cl.trip_id IS NOT NULL
      AND cl.direction = 'OUT'
      AND NOT cl.is_internal_transfer
      AND NOT cl.is_reversal
      AND cl.expense_category IS DISTINCT FROM 'CONCILIACION_SALDO'
      AND cl.expense_bucket = 'ROUTE_OPEX'
      AND NOT EXISTS (
          SELECT 1 FROM erp.cash_ledger rev
          WHERE rev.reversal_of_ledger_id = cl.ledger_id
      )
    GROUP BY cl.trip_id
),
trip_base AS (
    SELECT
        rt.trip_id,
        rt.trip_code,
        rt.trip_date,
        rt.end_date,
        COALESCE(NULLIF(BTRIM(rt.zone_name), ''), 'Sin zona') AS zone_name,
        rt.driver_name,
        rt.status::text AS status,
        COALESCE(tord.order_count, 0) AS order_count,
        COALESCE(tord.sales_total_pen, 0)::NUMERIC(14,2) AS sales_total_pen,
        COALESCE(tord.cash_collected_pen, 0)::NUMERIC(14,2) AS cash_collected_pen,
        COALESCE(tord.ar_pending_pen, 0)::NUMERIC(14,2) AS ar_pending_pen,
        COALESCE(tc.cost_covered_sales_pen, 0)::NUMERIC(14,2) AS cost_covered_sales_pen,
        COALESCE(tc.known_cogs_pen, 0)::NUMERIC(14,2) AS known_cogs_pen,
        (COALESCE(tc.cost_covered_sales_pen, 0) - COALESCE(tc.known_cogs_pen, 0))::NUMERIC(14,2) AS gross_margin_pen,
        COALESCE(topx.route_opex_pen, 0)::NUMERIC(14,2) AS route_opex_pen
    FROM erp.route_trips rt
    LEFT JOIN trip_orders tord ON tord.trip_id = rt.trip_id
    LEFT JOIN trip_cogs tc ON tc.trip_id = rt.trip_id
    LEFT JOIN trip_opex topx ON topx.trip_id = rt.trip_id
)
SELECT
    tb.trip_id,
    tb.trip_code,
    tb.trip_date,
    tb.end_date,
    tb.zone_name,
    tb.driver_name,
    tb.status,
    tb.order_count,
    tb.sales_total_pen,
    tb.cash_collected_pen,
    tb.ar_pending_pen,
    tb.cost_covered_sales_pen,
    tb.known_cogs_pen,
    tb.gross_margin_pen,
    ROUND(tb.gross_margin_pen * 100.0 / NULLIF(tb.cost_covered_sales_pen, 0), 2) AS gross_margin_pct,
    tb.route_opex_pen,
    ROUND(tb.route_opex_pen * 100.0 / NULLIF(tb.sales_total_pen, 0), 2) AS route_opex_pct,
    (tb.gross_margin_pen - tb.route_opex_pen)::NUMERIC(14,2) AS trip_net_contribution_pen,
    ROUND((tb.gross_margin_pen - tb.route_opex_pen) * 100.0 / NULLIF(tb.sales_total_pen, 0), 2) AS trip_net_contribution_pct,
    (tb.route_opex_pen * 100.0 / NULLIF(tb.sales_total_pen, 0) > erp.fn_get_setting_numeric('route_opex_alert_pct', 8.0)) AS route_opex_above_8pct_alert
FROM trip_base tb
ORDER BY tb.trip_date DESC, tb.trip_id DESC;

CREATE OR REPLACE VIEW analytics.v_kpi_sku_margin_and_opex AS
WITH params AS (
    SELECT
        erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26') AS cutoff_date,
        erp.fn_get_setting_numeric('min_margin_pct', 20.0) AS min_margin_pct
),
global_totals AS (
    SELECT
        COALESCE((
            SELECT SUM(so.total_pen)
            FROM erp.sales_orders so
            CROSS JOIN params p
            WHERE so.order_date >= p.cutoff_date
              AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
        ), 0)::NUMERIC(14,2) AS total_sales_pen,
        COALESCE((
            SELECT SUM(cl.amount_pen)
            FROM erp.cash_ledger cl
            CROSS JOIN params p
            WHERE cl.tx_date >= p.cutoff_date
              AND cl.direction = 'OUT'
              AND NOT cl.is_internal_transfer
              AND NOT cl.is_reversal
              AND cl.expense_category IS DISTINCT FROM 'CONCILIACION_SALDO'
              AND cl.expense_bucket = 'ROUTE_OPEX'
              AND NOT EXISTS (
                  SELECT 1 FROM erp.cash_ledger rev
                  WHERE rev.reversal_of_ledger_id = cl.ledger_id
              )
        ), 0)::NUMERIC(14,2) AS total_route_opex_pen
),
order_lines_net AS (
    SELECT
        p.product_id,
        p.sku,
        p.name AS product_name,
        p.category,
        p.fulfillment_mode,
        p.ref_cost_pen,
        p.cost_source,
        sol.order_line_id,
        sol.quantity,
        sol.pack_factor_applied,
        sol.unit_cost_snapshot_pen,
        (
            sol.line_total_pen * GREATEST(
                0::NUMERIC,
                1.0 - COALESCE(so.global_discount_pen, 0)
                    / NULLIF(SUM(sol.line_total_pen) OVER (PARTITION BY sol.order_id), 0)
            )
        ) AS net_line_total_pen
    FROM erp.products p
    JOIN erp.sales_order_lines sol ON sol.product_id = p.product_id
    JOIN erp.sales_orders so ON so.order_id = sol.order_id
    CROSS JOIN params prm
    WHERE so.order_date >= prm.cutoff_date
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
),
sku_sales AS (
    SELECT
        oln.product_id,
        oln.sku,
        oln.product_name,
        oln.category,
        oln.fulfillment_mode,
        oln.ref_cost_pen,
        oln.cost_source,
        COUNT(oln.order_line_id) AS sales_line_count,
        COALESCE(SUM(oln.quantity * oln.pack_factor_applied), 0)::NUMERIC(14,4) AS total_units_sold,
        ROUND(COALESCE(SUM(oln.net_line_total_pen), 0), 2)::NUMERIC(14,2) AS total_revenue_pen,
        ROUND(
            COALESCE(
                SUM(oln.net_line_total_pen) FILTER (WHERE COALESCE(oln.unit_cost_snapshot_pen, oln.ref_cost_pen) IS NOT NULL),
                0
            ),
            2
        )::NUMERIC(14,2) AS cost_covered_revenue_pen,
        COALESCE(
            SUM((oln.quantity * oln.pack_factor_applied) * COALESCE(oln.unit_cost_snapshot_pen, oln.ref_cost_pen))
            FILTER (WHERE COALESCE(oln.unit_cost_snapshot_pen, oln.ref_cost_pen) IS NOT NULL),
            0
        )::NUMERIC(14,2) AS known_cogs_pen
    FROM order_lines_net oln
    GROUP BY oln.product_id, oln.sku, oln.product_name, oln.category, oln.fulfillment_mode, oln.ref_cost_pen, oln.cost_source
)
SELECT
    s.product_id,
    s.sku,
    s.product_name,
    s.category,
    s.fulfillment_mode,
    s.sales_line_count,
    s.total_units_sold,
    s.total_revenue_pen,
    ROUND(s.total_revenue_pen / NULLIF(s.total_units_sold, 0), 4) AS avg_unit_sale_price_pen,
    s.ref_cost_pen,
    s.cost_source,
    s.cost_covered_revenue_pen,
    ROUND(s.cost_covered_revenue_pen * 100.0 / NULLIF(s.total_revenue_pen, 0), 2) AS cost_coverage_pct,
    s.known_cogs_pen,
    CASE
        WHEN s.cost_covered_revenue_pen > 0 THEN (s.cost_covered_revenue_pen - s.known_cogs_pen)::NUMERIC(14,2)
        ELSE NULL
    END AS real_gross_margin_pen,
    CASE
        WHEN s.cost_covered_revenue_pen > 0 THEN ROUND((s.cost_covered_revenue_pen - s.known_cogs_pen) * 100.0 / s.cost_covered_revenue_pen, 2)
        ELSE NULL
    END AS real_gross_margin_pct,
    ROUND(gt.total_route_opex_pen * 100.0 / NULLIF(gt.total_sales_pen, 0), 2) AS portfolio_route_opex_pct,
    (
        s.cost_covered_revenue_pen > 0
        AND ROUND((s.cost_covered_revenue_pen - s.known_cogs_pen) * 100.0 / s.cost_covered_revenue_pen, 2) < prm.min_margin_pct
    ) AS low_margin_below_20pct_alert,
    (s.cost_covered_revenue_pen < s.total_revenue_pen) AS missing_cost_alert
FROM sku_sales s
CROSS JOIN global_totals gt
CROSS JOIN params prm
ORDER BY s.total_revenue_pen DESC;

CREATE OR REPLACE VIEW analytics.v_kpi_ar_customers_and_quotes AS
WITH params AS (
    SELECT erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26') AS cutoff_date
),
monthly_orders AS (
    SELECT
        DATE_TRUNC('month', so.order_date)::DATE AS period_month,
        COUNT(*) AS orders_total,
        COALESCE(SUM(so.total_pen), 0)::NUMERIC(14,2) AS total_sales_pen,
        COALESCE(SUM(so.total_pen) FILTER (WHERE so.payment_mode = 'CREDIT'), 0)::NUMERIC(14,2) AS credit_sales_pen,
        COALESCE(SUM(so.balance_due_pen), 0)::NUMERIC(14,2) AS pending_ar_pen,
        COUNT(*) FILTER (
            WHERE NOT so.is_settled
              AND so.balance_due_pen > 0.05
              AND ((NOW() AT TIME ZONE 'America/Lima')::date - COALESCE(so.due_date, so.promised_payment_date, so.order_date)) > 30
        ) AS overdue_gt_30d_count,
        COALESCE(SUM(so.balance_due_pen) FILTER (
            WHERE NOT so.is_settled
              AND so.balance_due_pen > 0.05
              AND ((NOW() AT TIME ZONE 'America/Lima')::date - COALESCE(so.due_date, so.promised_payment_date, so.order_date)) > 30
        ), 0)::NUMERIC(14,2) AS overdue_gt_30d_pen,
        COUNT(*) FILTER (WHERE so.historical_status_assumed) AS assumed_status_orders_count,
        COUNT(*) FILTER (WHERE NOT so.historical_status_assumed) AS explicit_status_orders_count,
        COUNT(*) FILTER (WHERE so.customer_party_id IS NOT NULL) AS matched_customer_orders_count
    FROM erp.sales_orders so
    CROSS JOIN params p
    WHERE so.order_date >= p.cutoff_date
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY DATE_TRUNC('month', so.order_date)::DATE
),
monthly_quotes AS (
    SELECT
        DATE_TRUNC('month', q.issue_date)::DATE AS period_month,
        COUNT(*) AS quotes_total,
        COUNT(*) FILTER (WHERE q.status = 'CONVERTED' OR q.related_cpe IS NOT NULL) AS quotes_converted_count,
        COALESCE(SUM(q.total_pen), 0)::NUMERIC(14,2) AS quotes_total_pen
    FROM erp.quotes q
    CROSS JOIN params p
    WHERE q.issue_date >= p.cutoff_date
    GROUP BY DATE_TRUNC('month', q.issue_date)::DATE
),
all_months AS (
    SELECT period_month FROM monthly_orders
    UNION
    SELECT period_month FROM monthly_quotes
)
SELECT
    m.period_month,
    COALESCE(mo.orders_total, 0) AS orders_total,
    COALESCE(mo.total_sales_pen, 0)::NUMERIC(14,2) AS total_sales_pen,
    COALESCE(mo.credit_sales_pen, 0)::NUMERIC(14,2) AS credit_sales_pen,
    COALESCE(mo.pending_ar_pen, 0)::NUMERIC(14,2) AS pending_ar_pen,
    ROUND(COALESCE(mo.pending_ar_pen, 0) * 100.0 / NULLIF(mo.credit_sales_pen, 0), 2) AS ar_pending_of_credit_pct,
    ROUND(COALESCE(mo.pending_ar_pen, 0) * 100.0 / NULLIF(mo.total_sales_pen, 0), 2) AS ar_pending_of_total_sales_pct,
    COALESCE(mo.overdue_gt_30d_count, 0) AS overdue_gt_30d_count,
    COALESCE(mo.overdue_gt_30d_pen, 0)::NUMERIC(14,2) AS overdue_gt_30d_pen,
    COALESCE(mq.quotes_total, 0) AS quotes_total,
    COALESCE(mq.quotes_converted_count, 0) AS quotes_converted_count,
    ROUND(COALESCE(mq.quotes_converted_count, 0) * 100.0 / NULLIF(mq.quotes_total, 0), 2) AS quote_conversion_rate_pct,
    COALESCE(mq.quotes_total_pen, 0)::NUMERIC(14,2) AS quotes_total_pen,
    COALESCE(mo.explicit_status_orders_count, 0) AS explicit_status_orders_count,
    COALESCE(mo.assumed_status_orders_count, 0) AS assumed_status_orders_count,
    ROUND(COALESCE(mo.explicit_status_orders_count, 0) * 100.0 / NULLIF(mo.orders_total, 0), 2) AS explicit_payment_status_pct,
    ROUND(COALESCE(mo.matched_customer_orders_count, 0) * 100.0 / NULLIF(mo.orders_total, 0), 2) AS matched_customer_pct,
    (ROUND(COALESCE(mo.pending_ar_pen, 0) * 100.0 / NULLIF(mo.credit_sales_pen, 0), 2) > 15.0) AS ar_above_15pct_alert,
    (COALESCE(mo.overdue_gt_30d_count, 0) > 0) AS overdue_gt_30d_alert
FROM all_months m
LEFT JOIN monthly_orders mo ON mo.period_month = m.period_month
LEFT JOIN monthly_quotes mq ON mq.period_month = m.period_month
ORDER BY m.period_month;

CREATE OR REPLACE VIEW analytics.v_report_sales_by_zone AS
WITH order_line_net AS (
    SELECT
        sol.order_id,
        (
            sol.line_total_pen * GREATEST(
                0::NUMERIC,
                1.0 - COALESCE(so.global_discount_pen, 0)
                    / NULLIF(SUM(sol.line_total_pen) OVER (PARTITION BY sol.order_id), 0)
            )
        ) AS net_line_total_pen,
        (sol.quantity * sol.pack_factor_applied) * COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) AS line_cogs_pen,
        (COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL) AS has_cost
    FROM erp.sales_order_lines sol
    JOIN erp.sales_orders so ON so.order_id = sol.order_id
    JOIN erp.products p ON p.product_id = sol.product_id
    WHERE so.order_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26')
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
),
order_cogs AS (
    SELECT
        order_id,
        ROUND(COALESCE(SUM(net_line_total_pen) FILTER (WHERE has_cost), 0), 2)::NUMERIC(14,2) AS cost_covered_sales_pen,
        ROUND(COALESCE(SUM(line_cogs_pen) FILTER (WHERE has_cost), 0), 2)::NUMERIC(14,2) AS known_cogs_pen
    FROM order_line_net
    GROUP BY order_id
),
zone_agg AS (
    SELECT
        COALESCE(NULLIF(BTRIM(pa.city_zone), ''), NULLIF(BTRIM(rt.zone_name), ''), 'Sin zona') AS effective_zone,
        COUNT(*)::int AS orders_count,
        COUNT(DISTINCT COALESCE(so.customer_party_id::text, so.customer_name_raw))::int AS customers_count,
        COALESCE(SUM(so.total_pen), 0)::NUMERIC(14,2) AS sales_total_pen,
        COALESCE(SUM(so.paid_pen), 0)::NUMERIC(14,2) AS cash_collected_pen,
        COALESCE(SUM(so.balance_due_pen), 0)::NUMERIC(14,2) AS ar_pending_pen,
        COALESCE(SUM(oc.cost_covered_sales_pen), 0)::NUMERIC(14,2) AS cost_covered_sales_pen,
        COALESCE(SUM(oc.known_cogs_pen), 0)::NUMERIC(14,2) AS known_cogs_pen
    FROM erp.sales_orders so
    LEFT JOIN erp.parties pa ON pa.party_id = so.customer_party_id
    LEFT JOIN erp.route_trips rt ON rt.trip_id = so.trip_id
    LEFT JOIN order_cogs oc ON oc.order_id = so.order_id
    WHERE so.order_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26')
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY COALESCE(NULLIF(BTRIM(pa.city_zone), ''), NULLIF(BTRIM(rt.zone_name), ''), 'Sin zona')
)
SELECT
    za.effective_zone,
    za.orders_count,
    za.customers_count,
    za.sales_total_pen,
    za.cash_collected_pen,
    za.ar_pending_pen,
    za.cost_covered_sales_pen,
    za.known_cogs_pen,
    (za.cost_covered_sales_pen - za.known_cogs_pen)::NUMERIC(14,2) AS gross_margin_pen,
    ROUND((za.cost_covered_sales_pen - za.known_cogs_pen) * 100.0 / NULLIF(za.cost_covered_sales_pen, 0), 2) AS gross_margin_pct
FROM zone_agg za
ORDER BY za.sales_total_pen DESC, za.effective_zone ASC;

CREATE OR REPLACE VIEW analytics.v_report_sales_by_seller AS
WITH order_line_net AS (
    SELECT
        sol.order_id,
        (
            sol.line_total_pen * GREATEST(
                0::NUMERIC,
                1.0 - COALESCE(so.global_discount_pen, 0)
                    / NULLIF(SUM(sol.line_total_pen) OVER (PARTITION BY sol.order_id), 0)
            )
        ) AS net_line_total_pen,
        (sol.quantity * sol.pack_factor_applied) * COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) AS line_cogs_pen,
        (COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL) AS has_cost,
        sol.quantity * COALESCE(sol.unit_discount_pen, 0) AS line_unit_discount_pen
    FROM erp.sales_order_lines sol
    JOIN erp.sales_orders so ON so.order_id = sol.order_id
    JOIN erp.products p ON p.product_id = sol.product_id
    WHERE so.order_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26')
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
),
order_line_stats AS (
    SELECT
        order_id,
        ROUND(COALESCE(SUM(net_line_total_pen) FILTER (WHERE has_cost), 0), 2)::NUMERIC(14,2) AS cost_covered_sales_pen,
        ROUND(COALESCE(SUM(line_cogs_pen) FILTER (WHERE has_cost), 0), 2)::NUMERIC(14,2) AS known_cogs_pen,
        COALESCE(SUM(line_unit_discount_pen), 0)::NUMERIC(14,2) AS unit_discount_total_pen
    FROM order_line_net
    GROUP BY order_id
),
seller_agg AS (
    SELECT
        so.created_by_user_id AS seller_user_id,
        COALESCE(u.full_name, 'Sin vendedor asignado (Histórico)') AS seller_name,
        COUNT(*)::int AS orders_count,
        COALESCE(SUM(so.total_pen), 0)::NUMERIC(14,2) AS sales_total_pen,
        COALESCE(SUM(so.paid_pen), 0)::NUMERIC(14,2) AS cash_collected_pen,
        COALESCE(SUM(so.balance_due_pen), 0)::NUMERIC(14,2) AS ar_pending_pen,
        COALESCE(SUM(ols.cost_covered_sales_pen), 0)::NUMERIC(14,2) AS cost_covered_sales_pen,
        COALESCE(SUM(ols.known_cogs_pen), 0)::NUMERIC(14,2) AS known_cogs_pen,
        COALESCE(SUM(COALESCE(ols.unit_discount_total_pen, 0) + COALESCE(so.global_discount_pen, 0)), 0)::NUMERIC(14,2) AS discount_total_pen
    FROM erp.sales_orders so
    LEFT JOIN erp.app_users u ON u.user_id = so.created_by_user_id
    LEFT JOIN order_line_stats ols ON ols.order_id = so.order_id
    WHERE so.order_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26')
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY so.created_by_user_id, COALESCE(u.full_name, 'Sin vendedor asignado (Histórico)')
)
SELECT
    sa.seller_user_id,
    sa.seller_name,
    sa.orders_count,
    sa.sales_total_pen,
    sa.cash_collected_pen,
    ROUND(sa.cash_collected_pen * 100.0 / NULLIF(sa.sales_total_pen, 0), 2) AS collection_rate_pct,
    sa.ar_pending_pen,
    sa.cost_covered_sales_pen,
    (sa.cost_covered_sales_pen - sa.known_cogs_pen)::NUMERIC(14,2) AS gross_margin_pen,
    ROUND((sa.cost_covered_sales_pen - sa.known_cogs_pen) * 100.0 / NULLIF(sa.cost_covered_sales_pen, 0), 2) AS gross_margin_pct,
    sa.discount_total_pen
FROM seller_agg sa
ORDER BY sa.sales_total_pen DESC, sa.seller_name ASC;

CREATE OR REPLACE VIEW analytics.v_report_inventory_valuation AS
WITH sku_sales_stats AS (
    SELECT
        sol.product_id,
        COALESCE(SUM(sol.quantity * sol.pack_factor_applied), 0)::NUMERIC(14,4) AS units_sold_total,
        COALESCE(
            SUM(sol.quantity * sol.pack_factor_applied)
            FILTER (WHERE so.order_date >= ((NOW() AT TIME ZONE 'America/Lima')::date - 90)),
            0
        )::NUMERIC(14,4) AS units_sold_90d,
        COUNT(DISTINCT so.order_id)::int AS order_frequency_total,
        COUNT(DISTINCT so.order_id)
            FILTER (WHERE so.order_date >= ((NOW() AT TIME ZONE 'America/Lima')::date - 90))::int AS order_frequency_90d,
        MAX(so.order_date) AS last_sale_date,
        COALESCE(SUM(sol.line_total_pen), 0)::NUMERIC(14,2) AS revenue_total_pen,
        COALESCE(
            SUM(sol.line_total_pen)
            FILTER (WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL),
            0
        )::NUMERIC(14,2) AS cost_covered_revenue_pen,
        COALESCE(
            SUM((sol.quantity * sol.pack_factor_applied) * COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen))
            FILTER (WHERE COALESCE(sol.unit_cost_snapshot_pen, p.ref_cost_pen) IS NOT NULL),
            0
        )::NUMERIC(14,2) AS known_cogs_pen
    FROM erp.sales_order_lines sol
    JOIN erp.sales_orders so ON so.order_id = sol.order_id
    JOIN erp.products p ON p.product_id = sol.product_id
    WHERE so.order_date >= erp.fn_get_setting_date('kpi_cutoff_date', DATE '2026-06-26')
      AND so.operational_status NOT IN ('CANCELLED', 'PENDING_PARTNER_APPROVAL')
    GROUP BY sol.product_id
),
base_stock AS (
    SELECT
        p.product_id,
        p.sku,
        p.name AS product_name,
        p.category,
        p.fulfillment_mode::text AS fulfillment_mode,
        p.unit_of_measure,
        COALESCE(vcs.stock_on_hand, 0)::NUMERIC(14,4) AS stock_on_hand,
        GREATEST(COALESCE(vcs.stock_on_hand, 0), 0)::NUMERIC(14,4) AS positive_stock_qty,
        p.ref_cost_pen,
        p.list_sale_price_pen,
        p.min_sale_price_pen,
        p.cost_source,
        CASE
            WHEN COALESCE(vcs.stock_on_hand, 0) > 0 AND p.ref_cost_pen IS NOT NULL
                THEN ROUND(vcs.stock_on_hand * p.ref_cost_pen, 2)
            ELSE 0
        END::NUMERIC(14,2) AS valuation_pen,
        COALESCE(ss.units_sold_total, 0)::NUMERIC(14,4) AS units_sold_total,
        COALESCE(ss.units_sold_90d, 0)::NUMERIC(14,4) AS units_sold_90d,
        COALESCE(ss.order_frequency_total, 0) AS order_frequency_total,
        COALESCE(ss.order_frequency_90d, 0) AS order_frequency_90d,
        ss.last_sale_date,
        CASE
            WHEN ss.last_sale_date IS NOT NULL
                THEN GREATEST(0, ((NOW() AT TIME ZONE 'America/Lima')::date - ss.last_sale_date))::int
            ELSE NULL
        END AS days_since_last_sale,
        ROUND(COALESCE(ss.units_sold_90d, 0) / 90.0, 4) AS daily_velocity_90d,
        CASE
            WHEN GREATEST(COALESCE(vcs.stock_on_hand, 0), 0) > 0 AND COALESCE(ss.units_sold_90d, 0) > 0
                THEN ROUND(GREATEST(COALESCE(vcs.stock_on_hand, 0), 0) / (ss.units_sold_90d / 90.0), 1)
            WHEN GREATEST(COALESCE(vcs.stock_on_hand, 0), 0) <= 0 AND COALESCE(ss.units_sold_90d, 0) > 0
                THEN 0.0
            ELSE NULL
        END AS days_of_coverage,
        COALESCE(ss.revenue_total_pen, 0)::NUMERIC(14,2) AS revenue_total_pen,
        CASE
            WHEN COALESCE(ss.cost_covered_revenue_pen, 0) > 0
                THEN ROUND((ss.cost_covered_revenue_pen - ss.known_cogs_pen) * 100.0 / ss.cost_covered_revenue_pen, 2)
            ELSE NULL
        END AS real_gross_margin_pct
    FROM erp.products p
    JOIN erp.warehouses w ON w.code = 'MAIN' AND w.is_active = TRUE
    LEFT JOIN erp.v_current_stock vcs
           ON vcs.warehouse_id = w.warehouse_id
          AND vcs.product_id = p.product_id
    LEFT JOIN sku_sales_stats ss ON ss.product_id = p.product_id
    WHERE p.is_active = TRUE
)
SELECT
    bs.*,
    CASE
        WHEN bs.stock_on_hand < -0.0001 THEN 'NEGATIVE_STOCK'
        WHEN bs.positive_stock_qty > 0 AND (bs.days_since_last_sale IS NULL OR bs.days_since_last_sale >= 90) THEN 'DEAD_90D'
        WHEN bs.positive_stock_qty > 0 AND bs.days_since_last_sale >= 60 THEN 'SLOW_60D'
        WHEN bs.fulfillment_mode = 'STOCKED'
             AND ((bs.days_of_coverage IS NOT NULL AND bs.days_of_coverage <= 14) OR (bs.positive_stock_qty <= 5 AND bs.units_sold_total > 0))
            THEN 'LOW_COVERAGE'
        WHEN bs.positive_stock_qty > 0 THEN 'HEALTHY'
        ELSE 'NO_STOCK'
    END AS dead_stock_status
FROM base_stock bs
ORDER BY bs.valuation_pen DESC, bs.revenue_total_pen DESC, bs.product_id ASC;

-- ============================================================================
-- 6. Secondary foreign-key and reference indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_inv_movements_reference
    ON erp.inventory_movements (reference_table, reference_id)
    WHERE reference_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_party_aliases_party_id
    ON erp.party_aliases (party_id);

CREATE INDEX IF NOT EXISTS idx_product_aliases_product_id
    ON erp.product_aliases (product_id);

CREATE INDEX IF NOT EXISTS idx_cash_ledger_party_id
    ON erp.cash_ledger (party_id)
    WHERE party_id IS NOT NULL;
