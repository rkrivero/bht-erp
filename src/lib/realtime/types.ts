export type SyncScope =
  "orders" | "inventory" | "collections" | "treasury" | "purchases" | "partners";

export type LiveStatus = "live" | "syncing" | "paused" | "offline";

export type SyncEngineMode = "postgres-watermark" | "neon-realtime";

export type LiveSyncTransport = "efficient" | "sse";

export interface SyncSnapshotResponse {
  version: string;
  changedScopes: SyncScope[];
  allowedScopes: SyncScope[];
  serverTime: string;
  mode: SyncEngineMode;
}

export interface UseLiveSyncOptions {
  /** Called when one or more subscribed scopes changed remotely on the server. */
  onRemoteChange: (changedScopes: SyncScope[]) => void | Promise<void>;
  /** Optional subset of scopes to watch; defaults to all scopes allowed for the user's role. */
  scopes?: SyncScope[];
  /** Enable or pause live synchronization (e.g. pause while editing a modal or logged out). Default: true. */
  enabled?: boolean;
  /** Transport mode: "efficient" (BroadcastChannel + 45s focus cooldown + 60s JSON poll) or "sse" (opt-in EventSource). Default: "efficient". */
  transport?: LiveSyncTransport;
  /** HTTP conditional polling interval in ms (Default: 60000 in "efficient" mode, 5000 in "sse" fallback). */
  pollIntervalMs?: number;
  /** Optional callback when /api/sync responds with 401 or 403. */
  onAuthError?: (status: number) => void;
}

export interface UseLiveSyncResult {
  liveStatus: LiveStatus;
  lastSyncedAt: Date | null;
  triggerSync: (opts?: {
    force?: boolean;
    broadcast?: boolean;
    scopes?: SyncScope[];
  }) => Promise<void>;
}
