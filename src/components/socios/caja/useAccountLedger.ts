"use client";

import { useEffect, useState } from "react";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import type { CashLedgerEntry } from "../types";

export function useAccountLedger(
  selectedAccountId: number | null,
  ledger: CashLedgerEntry[],
  onFeedback: (msg: string, isError?: boolean) => void
) {
  const [accountLedger, setAccountLedger] = useState<CashLedgerEntry[] | null>(null);
  const [accountTotalCount, setAccountTotalCount] = useState<number | null>(null);
  const [accountHasMore, setAccountHasMore] = useState(false);
  const [loadingAccountLedger, setLoadingAccountLedger] = useState(false);
  const [loadingMoreLedger, setLoadingMoreLedger] = useState(false);

  useEffect(() => {
    if (selectedAccountId === null) {
      setAccountLedger(null);
      setAccountTotalCount(null);
      setAccountHasMore(false);
      setLoadingAccountLedger(false);
      return;
    }

    const controller = new AbortController();
    setLoadingAccountLedger(true);

    fetchJson<{ ledger: CashLedgerEntry[]; totalCount: number; hasMore: boolean }>(
      `/api/treasury?accountId=${selectedAccountId}&ledgerOnly=1&limit=200&offset=0`,
      { signal: controller.signal }
    )
      .then((res) => {
        if (controller.signal.aborted) return;
        setAccountLedger(res.ledger ?? []);
        setAccountTotalCount(Number(res.totalCount ?? res.ledger?.length ?? 0));
        setAccountHasMore(Boolean(res.hasMore));
      })
      .catch((err) => {
        if (
          controller.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return;
        }
        setAccountLedger(null);
        setAccountTotalCount(null);
        setAccountHasMore(false);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingAccountLedger(false);
        }
      });

    return () => controller.abort();
  }, [selectedAccountId, ledger]);

  async function handleLoadMoreAccountLedger() {
    if (
      selectedAccountId === null ||
      accountLedger === null ||
      loadingMoreLedger ||
      !accountHasMore
    ) {
      return;
    }
    setLoadingMoreLedger(true);
    try {
      const res = await fetchJson<{
        ledger: CashLedgerEntry[];
        totalCount: number;
        hasMore: boolean;
      }>(
        `/api/treasury?accountId=${selectedAccountId}&ledgerOnly=1&limit=200&offset=${accountLedger.length}`
      );
      setAccountLedger((prev) => {
        const existing = prev ?? [];
        const seen = new Set(existing.map((m) => m.ledger_id));
        return [
          ...existing,
          ...(res.ledger ?? []).filter((m) => !seen.has(m.ledger_id)),
        ];
      });
      setAccountTotalCount(Number(res.totalCount ?? 0));
      setAccountHasMore(Boolean(res.hasMore));
    } catch (err) {
      onFeedback(
        err instanceof ApiClientError
          ? err.message
          : "No se pudieron cargar más movimientos.",
        true
      );
    } finally {
      setLoadingMoreLedger(false);
    }
  }

  return {
    accountLedger,
    accountTotalCount,
    accountHasMore,
    loadingAccountLedger,
    loadingMoreLedger,
    handleLoadMoreAccountLedger,
  };
}
