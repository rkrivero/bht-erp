import { useCallback, useEffect, useState } from "react";
import type { CheckedLines } from "./types";
import { isCheckedLines } from "./warehouse-utils";

export const CHECKED_STORAGE_KEY = "bht_almacen_checked_lines";

export function useWarehouseChecklist() {
  const [checkedLines, setCheckedLines] = useState<CheckedLines>({});

  useEffect(() => {
    const loadChecklist = () => {
      try {
        const saved =
          localStorage.getItem(CHECKED_STORAGE_KEY) ||
          sessionStorage.getItem(CHECKED_STORAGE_KEY);
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          if (isCheckedLines(parsed)) setCheckedLines(parsed);
        }
      } catch {
        // ignore storage failure
      }
    };
    loadChecklist();
    const onStorage = (e: StorageEvent) => {
      if (e.key === CHECKED_STORAGE_KEY) loadChecklist();
    };
    window.addEventListener("storage", onStorage);
    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel(CHECKED_STORAGE_KEY);
      bc.onmessage = (ev: MessageEvent<unknown>) => {
        if (isCheckedLines(ev.data)) setCheckedLines(ev.data);
      };
    }
    return () => {
      window.removeEventListener("storage", onStorage);
      bc?.close();
    };
  }, []);

  const persistChecklist = useCallback((next: CheckedLines) => {
    try {
      localStorage.setItem(CHECKED_STORAGE_KEY, JSON.stringify(next));
      sessionStorage.setItem(CHECKED_STORAGE_KEY, JSON.stringify(next));
      if (typeof BroadcastChannel !== "undefined") {
        const bc = new BroadcastChannel(CHECKED_STORAGE_KEY);
        bc.postMessage(next);
        bc.close();
      }
    } catch {
      // ignore storage failure
    }
  }, []);

  const toggleLineChecked = useCallback(
    (orderLineId: number) => {
      setCheckedLines((prev) => {
        const next = { ...prev, [orderLineId]: !prev[orderLineId] };
        persistChecklist(next);
        return next;
      });
    },
    [persistChecklist]
  );

  const pruneChecklist = useCallback(
    (activeLineIds: Set<number>) => {
      setCheckedLines((prev) => {
        let changed = false;
        const pruned: CheckedLines = {};
        for (const [k, v] of Object.entries(prev)) {
          const idNum = Number(k);
          if (v && activeLineIds.has(idNum)) {
            pruned[idNum] = true;
          } else if (v) {
            changed = true;
          }
        }
        if (changed) persistChecklist(pruned);
        return changed ? pruned : prev;
      });
    },
    [persistChecklist]
  );

  return { checkedLines, toggleLineChecked, pruneChecklist };
}
