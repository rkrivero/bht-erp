"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "@/lib/api-client";
import type { UndoableActionDto } from "@/lib/contracts";
import {
  executeUndoRequest,
  fetchUndoableActions,
  formatCountdownMmSs,
  getRemainingSeconds,
} from "@/lib/undo-client";
import { Button } from "@/components/ui/Primitives";

interface RecentUndoStripProps {
  /** Incremented whenever a local mutation occurs so recent undoables reload immediately. */
  refreshKey?: number;
  /** Hide strip when a toast is already displaying the same undoId. */
  activeToastUndoId?: number | null;
  /** Admins have no time limit; non-admins see a live 15-minute countdown. */
  isAdmin?: boolean;
  onUndone: (message: string) => void;
  onError: (message: string) => void;
}

export function RecentUndoStrip({
  refreshKey = 0,
  activeToastUndoId = null,
  isAdmin = false,
  onUndone,
  onError,
}: RecentUndoStripProps) {
  const [items, setItems] = useState<UndoableActionDto[]>([]);
  const [fetchedAtMs, setFetchedAtMs] = useState<number>(() => Date.now());
  const [busyId, setBusyId] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const loadMine = useCallback(async () => {
    try {
      const res = await fetchUndoableActions({
        scope: "mine",
        status: "PENDING",
        limit: 3,
      });
      const now = Date.now();
      setFetchedAtMs(now);
      setNowMs(now);
      setItems(res.actions.filter((a) => a.can_undo && (isAdmin || !a.is_expired)));
    } catch {
      // Non-critical strip: fail silently to avoid noisy polling errors
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadMine();
  }, [loadMine, refreshKey]);

  useEffect(() => {
    if (items.length === 0) return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [items.length]);

  function computeRemaining(item: UndoableActionDto): number {
    if (
      typeof item.remaining_seconds === "number" &&
      Number.isFinite(item.remaining_seconds)
    ) {
      const elapsedSec = Math.max(0, Math.floor((nowMs - fetchedAtMs) / 1000));
      return Math.max(0, item.remaining_seconds - elapsedSec);
    }
    return getRemainingSeconds(item.expires_at, nowMs);
  }

  const visible = items.filter((item) => {
    if (activeToastUndoId !== null && item.undo_id === activeToastUndoId) {
      return false;
    }
    return isAdmin || computeRemaining(item) > 0;
  });

  if (visible.length === 0) return null;

  const latest = visible[0];
  const remaining = computeRemaining(latest);

  async function handleUndo(action: UndoableActionDto) {
    if (busyId !== null) return;
    setBusyId(action.undo_id);
    try {
      const res = await executeUndoRequest(action.undo_id);
      setItems((prev) => prev.filter((item) => item.undo_id !== action.undo_id));
      onUndone(res.restoredMessage);
    } catch (error) {
      onError(
        error instanceof ApiClientError
          ? error.message
          : "No se pudo deshacer la acción reciente."
      );
      void loadMine();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      role="region"
      aria-label="Acción reciente reversible"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bht-line-blue bg-bht-mist/80 px-3.5 py-2 text-xs text-bht-navy-deep"
    >
      <div className="min-w-0 flex-1">
        <span className="font-semibold">Acción reciente:</span>{" "}
        <span className="text-bht-ink-strong">{latest.summary}</span>
        {!isAdmin && (
          <span className="ml-1.5 text-bht-ink-soft tabular-nums">
            (disponible {formatCountdownMmSs(remaining)})
          </span>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-compact="true"
        disabled={busyId !== null}
        onClick={() => void handleUndo(latest)}
      >
        {busyId === latest.undo_id ? "Deshaciendo..." : "Deshacer"}
      </Button>
    </div>
  );
}
