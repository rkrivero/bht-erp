"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LiveStatus,
  SyncScope,
  SyncSnapshotResponse,
  UseLiveSyncOptions,
  UseLiveSyncResult,
} from "./types";

export type {
  LiveStatus,
  SyncEngineMode,
  SyncScope,
  SyncSnapshotResponse,
  UseLiveSyncOptions,
  UseLiveSyncResult,
} from "./types";

const DEFAULT_POLL_INTERVAL_MS = 5000;
const MIN_POLL_INTERVAL_MS = 1500;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 30000;
const SSE_RETRY_AFTER_FALLBACK_MS = 60000;
export const BHT_SYNC_CHANNEL_NAME = "bht_live_sync_v1";

export function notifyLocalSync(scopes?: SyncScope[]): void {
  if (typeof BroadcastChannel === "undefined") return;
  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel(BHT_SYNC_CHANNEL_NAME);
    ch.postMessage({
      type: "mutation",
      scopes: scopes ?? [],
      ts: Date.now(),
    });
  } catch {
    // Ignore environments where BroadcastChannel throws
  } finally {
    try {
      ch?.close();
    } catch {
      // ignore
    }
  }
}

function computeBackoffDelay(attempt: number): number {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(attempt, 4));
  const jitter = exp * 0.15 * (Math.random() * 2 - 1);
  return Math.max(1000, Math.round(exp + jitter));
}

function buildSyncUrl(since: string | null, scopesKey: string): string {
  const params = new URLSearchParams();
  if (since) params.set("since", since);
  if (scopesKey) params.set("scopes", scopesKey);
  const qs = params.toString();
  return qs ? `/api/sync?${qs}` : "/api/sync";
}

function isTabHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function isNavigatorOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Visibility-aware live synchronization hook for /socios, /vendedor, and /almacen.
 *
 * Uses SSE (`GET /api/sync` with `EventSource`) as primary transport with automatic
 * fallback to conditional JSON polling (`GET /api/sync?since=...`), pauses when the
 * tab is hidden, resumes immediately on `visibilitychange` / `focus` / `online`, and
 * applies exponential backoff when the network drops.
 */
export function useLiveSync({
  onRemoteChange,
  scopes,
  enabled = true,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  onAuthError,
}: UseLiveSyncOptions): UseLiveSyncResult {
  const effectivePollMs = Math.max(MIN_POLL_INTERVAL_MS, pollIntervalMs);
  const scopesKey = scopes ? Array.from(new Set(scopes)).sort().join(",") : "";

  const [liveStatus, setLiveStatus] = useState<LiveStatus>(() => {
    if (!enabled) return "paused";
    if (isNavigatorOffline()) return "offline";
    if (isTabHidden()) return "paused";
    return "syncing";
  });
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const versionRef = useRef<string | null>(null);
  const pendingVersionRef = useRef<string | null>(null);
  const onRemoteChangeRef = useRef(onRemoteChange);
  const onAuthErrorRef = useRef(onAuthError);
  const scopesRef = useRef<SyncScope[] | undefined>(scopes);
  const enabledRef = useRef(enabled);
  const stoppedByAuthRef = useRef(false);
  const inFlightRefreshRef = useRef(false);
  const queuedScopesRef = useRef<Set<SyncScope>>(new Set());
  const backoffAttemptRef = useRef(0);
  const forceConnectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onRemoteChangeRef.current = onRemoteChange;
  }, [onRemoteChange]);

  useEffect(() => {
    onAuthErrorRef.current = onAuthError;
  }, [onAuthError]);

  useEffect(() => {
    scopesRef.current = scopes;
  }, [scopesKey, scopes]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (enabled) {
      stoppedByAuthRef.current = false;
    }
  }, [enabled]);

  const filterMatchedScopes = useCallback((incoming: SyncScope[]): SyncScope[] => {
    const watched = scopesRef.current;
    if (!watched || watched.length === 0) return incoming;
    const set = new Set(watched);
    return incoming.filter((s) => set.has(s));
  }, []);

  const deliverScopes = useCallback(
    async (
      incoming: SyncScope[],
      restoreLive: () => void,
      targetVersion?: string | null
    ): Promise<boolean> => {
      const matched = filterMatchedScopes(incoming);
      if (matched.length === 0) {
        if (targetVersion && !inFlightRefreshRef.current) {
          versionRef.current = targetVersion;
        }
        return true;
      }

      if (inFlightRefreshRef.current) {
        for (const s of matched) queuedScopesRef.current.add(s);
        if (targetVersion) pendingVersionRef.current = targetVersion;
        return true;
      }

      inFlightRefreshRef.current = true;
      if (targetVersion) pendingVersionRef.current = targetVersion;
      setLiveStatus("syncing");
      let succeeded = false;
      try {
        await onRemoteChangeRef.current(matched);
        while (queuedScopesRef.current.size > 0) {
          const queued = Array.from(queuedScopesRef.current);
          queuedScopesRef.current.clear();
          await onRemoteChangeRef.current(queued);
        }
        if (pendingVersionRef.current) {
          versionRef.current = pendingVersionRef.current;
        }
        succeeded = true;
      } catch {
        // Do NOT advance versionRef so the next cycle retries missed changes
      } finally {
        pendingVersionRef.current = null;
        inFlightRefreshRef.current = false;
        restoreLive();
      }
      return succeeded;
    },
    [filterMatchedScopes]
  );

  const computeIdleStatus = useCallback((): LiveStatus => {
    if (!enabledRef.current || stoppedByAuthRef.current || isTabHidden()) {
      return "paused";
    }
    if (isNavigatorOffline()) return "offline";
    return "live";
  }, []);

  const fetchSnapshotOnce = useCallback(
    async (forceNotify = false): Promise<"ok" | "auth" | "network"> => {
      if (isNavigatorOffline()) {
        setLiveStatus("offline");
        return "network";
      }

      try {
        const url = buildSyncUrl(versionRef.current, scopesKey);
        const res = await fetch(url, {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        if (res.status === 401 || res.status === 403) {
          stoppedByAuthRef.current = true;
          setLiveStatus("paused");
          onAuthErrorRef.current?.(res.status);
          return "auth";
        }

        if (!res.ok) {
          return "network";
        }

        const data = (await res.json()) as SyncSnapshotResponse;
        backoffAttemptRef.current = 0;
        setLastSyncedAt(new Date());

        const toDeliver =
          data.changedScopes.length > 0
            ? data.changedScopes
            : forceNotify
              ? scopesRef.current && scopesRef.current.length > 0
                ? data.allowedScopes.filter((s) => scopesRef.current!.includes(s))
                : data.allowedScopes
              : [];

        if (toDeliver.length > 0) {
          await deliverScopes(
            toDeliver,
            () => {
              setLiveStatus(computeIdleStatus());
            },
            data.version
          );
        } else {
          versionRef.current = data.version;
          setLiveStatus(computeIdleStatus());
        }

        return "ok";
      } catch {
        return "network";
      }
    },
    [computeIdleStatus, deliverScopes, scopesKey]
  );

  const triggerSync = useCallback(
    async (opts?: { force?: boolean; broadcast?: boolean; scopes?: SyncScope[] }) => {
      if (opts?.broadcast) {
        notifyLocalSync(opts.scopes);
      }
      if (stoppedByAuthRef.current) return;
      if (isNavigatorOffline()) {
        setLiveStatus("offline");
        return;
      }
      setLiveStatus("syncing");
      const status = await fetchSnapshotOnce(Boolean(opts?.force));
      if (status === "network") {
        setLiveStatus(isNavigatorOffline() ? "offline" : "syncing");
      }
      if (status === "ok" && enabledRef.current && !isTabHidden()) {
        forceConnectRef.current?.();
      }
    },
    [fetchSnapshotOnce]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!enabled) {
      setLiveStatus("paused");
      return;
    }

    let disposed = false;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let resumeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pollModeUntil = 0;
    let lastCheckedMs = 0;

    const clearTimers = () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (resumeDebounceTimer) {
        clearTimeout(resumeDebounceTimer);
        resumeDebounceTimer = null;
      }
    };

    const closeEventSource = () => {
      if (es) {
        es.close();
        es = null;
      }
    };

    const stopAll = (nextStatus?: LiveStatus) => {
      closeEventSource();
      clearTimers();
      if (!disposed && nextStatus) {
        setLiveStatus(nextStatus);
      }
    };

    const schedulePollLoop = () => {
      if (disposed || stoppedByAuthRef.current || isTabHidden()) return;
      if (isNavigatorOffline()) {
        stopAll("offline");
        return;
      }

      pollTimer = setTimeout(async () => {
        if (disposed || stoppedByAuthRef.current || isTabHidden()) return;
        lastCheckedMs = Date.now();
        const outcome = await fetchSnapshotOnce(false);
        if (disposed) return;

        if (outcome === "auth") {
          stopAll("paused");
          return;
        }
        if (outcome === "network") {
          backoffAttemptRef.current += 1;
          setLiveStatus(
            isNavigatorOffline() || backoffAttemptRef.current >= 2
              ? "offline"
              : "syncing"
          );
          reconnectTimer = setTimeout(
            startTransport,
            computeBackoffDelay(backoffAttemptRef.current)
          );
          return;
        }

        if (Date.now() >= pollModeUntil && typeof EventSource !== "undefined") {
          startTransport();
          return;
        }
        schedulePollLoop();
      }, effectivePollMs);
    };

    const startTransport = () => {
      if (disposed || stoppedByAuthRef.current) return;
      if (!enabledRef.current || isTabHidden()) {
        stopAll("paused");
        return;
      }
      if (isNavigatorOffline()) {
        stopAll("offline");
        return;
      }

      closeEventSource();
      clearTimers();
      setLiveStatus("syncing");

      const canUseSse =
        typeof EventSource !== "undefined" && Date.now() >= pollModeUntil;

      if (!canUseSse) {
        void (async () => {
          lastCheckedMs = Date.now();
          const outcome = await fetchSnapshotOnce(false);
          if (disposed) return;
          if (outcome === "ok") {
            schedulePollLoop();
          } else if (outcome === "network") {
            backoffAttemptRef.current += 1;
            setLiveStatus(
              isNavigatorOffline() || backoffAttemptRef.current >= 2
                ? "offline"
                : "syncing"
            );
            reconnectTimer = setTimeout(
              startTransport,
              computeBackoffDelay(backoffAttemptRef.current)
            );
          }
        })();
        return;
      }

      const sseUrl = buildSyncUrl(versionRef.current, scopesKey);
      const source = new EventSource(sseUrl);
      es = source;

      source.addEventListener("sync", (event) => {
        if (disposed || es !== source) return;
        try {
          const payload = JSON.parse(
            (event as MessageEvent<string>).data
          ) as SyncSnapshotResponse;
          backoffAttemptRef.current = 0;
          lastCheckedMs = Date.now();
          setLastSyncedAt(new Date());

          if (payload.changedScopes && payload.changedScopes.length > 0) {
            void deliverScopes(
              payload.changedScopes,
              () => {
                if (!disposed) setLiveStatus(computeIdleStatus());
              },
              payload.version
            );
          } else {
            versionRef.current = payload.version;
            setLiveStatus(computeIdleStatus());
          }
        } catch {
          // Ignore malformed event frame
        }
      });

      source.addEventListener("heartbeat", () => {
        if (disposed || es !== source) return;
        lastCheckedMs = Date.now();
        backoffAttemptRef.current = 0;
        setLastSyncedAt(new Date());
      });

      source.addEventListener("reconnect", () => {
        if (disposed || es !== source) return;
        closeEventSource();
        backoffAttemptRef.current = 0;
        startTransport();
      });

      source.onerror = () => {
        if (disposed || es !== source) return;
        closeEventSource();

        // Probe HTTP endpoint to distinguish auth failure, network drop, or SSE blocking
        void (async () => {
          lastCheckedMs = Date.now();
          const outcome = await fetchSnapshotOnce(false);
          if (disposed) return;

          if (outcome === "auth") {
            stopAll("paused");
            return;
          }

          if (outcome === "ok") {
            // HTTP works even though SSE dropped; smoothly run HTTP conditional polling
            pollModeUntil = Date.now() + SSE_RETRY_AFTER_FALLBACK_MS;
            schedulePollLoop();
            return;
          }

          backoffAttemptRef.current += 1;
          setLiveStatus(
            isNavigatorOffline() || backoffAttemptRef.current >= 2
              ? "offline"
              : "syncing"
          );
          reconnectTimer = setTimeout(
            startTransport,
            computeBackoffDelay(backoffAttemptRef.current)
          );
        })();
      };
    };

    forceConnectRef.current = () => {
      if (es || pollTimer) return;
      startTransport();
    };

    const scheduleResume = () => {
      if (disposed || stoppedByAuthRef.current) return;
      if (isTabHidden()) {
        stopAll("paused");
        return;
      }
      if (isNavigatorOffline()) {
        stopAll("offline");
        return;
      }
      if (resumeDebounceTimer) clearTimeout(resumeDebounceTimer);
      resumeDebounceTimer = setTimeout(() => {
        if (disposed || isTabHidden() || isNavigatorOffline()) return;
        // Reconnect immediately if paused/disconnected, or perform a quick catch-up check
        if (!es && !pollTimer) {
          backoffAttemptRef.current = 0;
          startTransport();
        } else if (Date.now() - lastCheckedMs > 1500) {
          lastCheckedMs = Date.now();
          void fetchSnapshotOnce(false);
        }
      }, 120);
    };

    const handleVisibilityChange = () => {
      if (isTabHidden()) {
        stopAll("paused");
      } else {
        scheduleResume();
      }
    };

    const handleFocus = () => {
      scheduleResume();
    };

    const handleOnline = () => {
      backoffAttemptRef.current = 0;
      pollModeUntil = 0;
      scheduleResume();
    };

    const handleOffline = () => {
      stopAll("offline");
    };

    let broadcastChannel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        broadcastChannel = new BroadcastChannel(BHT_SYNC_CHANNEL_NAME);
        broadcastChannel.onmessage = () => {
          if (
            disposed ||
            !enabledRef.current ||
            stoppedByAuthRef.current ||
            isTabHidden() ||
            isNavigatorOffline()
          ) {
            return;
          }
          lastCheckedMs = Date.now();
          void fetchSnapshotOnce(false);
        };
      } catch {
        broadcastChannel = null;
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    startTransport();

    return () => {
      disposed = true;
      forceConnectRef.current = null;
      stopAll();
      try {
        broadcastChannel?.close();
      } catch {
        // ignore
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [
    computeIdleStatus,
    deliverScopes,
    effectivePollMs,
    enabled,
    fetchSnapshotOnce,
    scopesKey,
  ]);

  return {
    liveStatus,
    lastSyncedAt,
    triggerSync,
  };
}
