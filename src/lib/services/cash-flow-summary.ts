import type { PoolClient } from "pg";
import type { DailyCashFlowSummary } from "@/components/socios/types";

export interface CashAccountFlowBreakdown {
  dayInPen: number;
  dayOutPen: number;
  dayTransfersNetPen: number;
  dayNetPen: number;
  monthInPen: number;
  monthOutPen: number;
  monthNetPen: number;
}

function round2(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

export async function getCashFlowSummary(
  client: PoolClient
): Promise<DailyCashFlowSummary> {
  const res = await client.query<{
    as_of_lima_date: string;
    inflows_today_pen: string | number;
    outflows_today_pen: string | number;
    inflows_month_pen: string | number;
    outflows_month_pen: string | number;
  }>(
    `WITH lima_bounds AS (
       SELECT
         (NOW() AT TIME ZONE 'America/Lima')::date AS today_date,
         date_trunc('month', NOW() AT TIME ZONE 'America/Lima')::date AS month_start
     )
     SELECT
       lb.today_date::text AS as_of_lima_date,
       COALESCE(SUM(CASE
         WHEN cl.tx_date = lb.today_date AND cl.direction = 'IN' THEN cl.amount_pen
         ELSE 0
       END), 0)::NUMERIC(14,2) AS inflows_today_pen,
       COALESCE(SUM(CASE
         WHEN cl.tx_date = lb.today_date AND cl.direction = 'OUT' THEN cl.amount_pen
         ELSE 0
       END), 0)::NUMERIC(14,2) AS outflows_today_pen,
       COALESCE(SUM(CASE
         WHEN cl.tx_date >= lb.month_start AND cl.tx_date <= lb.today_date AND cl.direction = 'IN' THEN cl.amount_pen
         ELSE 0
       END), 0)::NUMERIC(14,2) AS inflows_month_pen,
       COALESCE(SUM(CASE
         WHEN cl.tx_date >= lb.month_start AND cl.tx_date <= lb.today_date AND cl.direction = 'OUT' THEN cl.amount_pen
         ELSE 0
       END), 0)::NUMERIC(14,2) AS outflows_month_pen
     FROM lima_bounds lb
     LEFT JOIN erp.cash_ledger cl
       ON cl.tx_date >= lb.month_start
      AND cl.tx_date <= lb.today_date
      AND NOT cl.is_internal_transfer
      AND NOT cl.is_reversal
     GROUP BY lb.today_date`
  );

  const row = res.rows[0];
  const inflowsTodayPen = round2(row?.inflows_today_pen);
  const outflowsTodayPen = round2(row?.outflows_today_pen);
  const inflowsMonthPen = round2(row?.inflows_month_pen);
  const outflowsMonthPen = round2(row?.outflows_month_pen);

  return {
    asOfLimaDate: String(row?.as_of_lima_date ?? ""),
    inflowsTodayPen,
    outflowsTodayPen,
    netTodayPen: round2(inflowsTodayPen - outflowsTodayPen),
    inflowsMonthPen,
    outflowsMonthPen,
    netMonthPen: round2(inflowsMonthPen - outflowsMonthPen),
  };
}

export async function getCashAccountFlowBreakdown(
  client: PoolClient
): Promise<Map<number, CashAccountFlowBreakdown>> {
  const res = await client.query<{
    account_id: number | string;
    day_in_pen: string | number;
    day_out_pen: string | number;
    day_transfers_net_pen: string | number;
    month_in_pen: string | number;
    month_out_pen: string | number;
  }>(
    `WITH lima_bounds AS (
       SELECT
         (NOW() AT TIME ZONE 'America/Lima')::date AS today_date,
         date_trunc('month', NOW() AT TIME ZONE 'America/Lima')::date AS month_start
     )
     SELECT
       cl.account_id,
       COALESCE(SUM(CASE
         WHEN cl.tx_date = lb.today_date AND NOT cl.is_internal_transfer AND cl.direction = 'IN'
           THEN cl.amount_pen ELSE 0
       END), 0)::NUMERIC(14,2) AS day_in_pen,
       COALESCE(SUM(CASE
         WHEN cl.tx_date = lb.today_date AND NOT cl.is_internal_transfer AND cl.direction = 'OUT'
           THEN cl.amount_pen ELSE 0
       END), 0)::NUMERIC(14,2) AS day_out_pen,
       COALESCE(SUM(CASE
         WHEN cl.tx_date = lb.today_date AND cl.is_internal_transfer
           THEN CASE WHEN cl.direction = 'IN' THEN cl.amount_pen ELSE -cl.amount_pen END
         ELSE 0
       END), 0)::NUMERIC(14,2) AS day_transfers_net_pen,
       COALESCE(SUM(CASE
         WHEN cl.tx_date >= lb.month_start AND cl.tx_date <= lb.today_date AND NOT cl.is_internal_transfer AND cl.direction = 'IN'
           THEN cl.amount_pen ELSE 0
       END), 0)::NUMERIC(14,2) AS month_in_pen,
       COALESCE(SUM(CASE
         WHEN cl.tx_date >= lb.month_start AND cl.tx_date <= lb.today_date AND NOT cl.is_internal_transfer AND cl.direction = 'OUT'
           THEN cl.amount_pen ELSE 0
       END), 0)::NUMERIC(14,2) AS month_out_pen
     FROM erp.cash_ledger cl
     CROSS JOIN lima_bounds lb
     WHERE cl.tx_date >= lb.month_start
       AND cl.tx_date <= lb.today_date
       AND NOT cl.is_reversal
     GROUP BY cl.account_id`
  );

  const map = new Map<number, CashAccountFlowBreakdown>();
  for (const r of res.rows) {
    const dayInPen = round2(r.day_in_pen);
    const dayOutPen = round2(r.day_out_pen);
    const dayTransfersNetPen = round2(r.day_transfers_net_pen);
    const monthInPen = round2(r.month_in_pen);
    const monthOutPen = round2(r.month_out_pen);
    map.set(Number(r.account_id), {
      dayInPen,
      dayOutPen,
      dayTransfersNetPen,
      dayNetPen: round2(dayInPen - dayOutPen + dayTransfersNetPen),
      monthInPen,
      monthOutPen,
      monthNetPen: round2(monthInPen - monthOutPen),
    });
  }
  return map;
}
