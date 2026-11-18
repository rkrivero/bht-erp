export type OfflineMutationKind = "ORDER_CREATE" | "COLLECTION" | "ROUTE_EXPENSE";
export type OutboxStatus = "pending" | "syncing" | "synced" | "conflict";

export interface OfflineMutation {
  id: string;
  kind: OfflineMutationKind;
  actorUsername: string;
  url: "/api/orders" | "/api/collections" | "/api/treasury";
  body: Record<string, unknown>;
  createdAt: string;
  status: OutboxStatus;
  lastError?: string;
  syncedAt?: string;
  conflictCode?: string;
  entityRef?: string;
  causalKey?: string;
}

export interface SyncConflict {
  mutationId: string;
  kind: OfflineMutationKind;
  message: string;
}

export interface OfflineSubmitResult<T = Record<string, unknown>> {
  queued: boolean;
  mutationId: string;
  data?: T;
}
