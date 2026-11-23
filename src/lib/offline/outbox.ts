"use client";

import type {
  OfflineMutation,
  OfflineMutationKind,
  OfflineSubmitResult,
} from "./types";

const DB_NAME = "bht-erp-offline-v1";
const DB_VERSION = 1;
const OUTBOX_STORE = "outbox";
const SNAPSHOT_STORE = "snapshots";
const SYNC_HISTORY_LIMIT = 50;
const SYNC_HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const OUTBOX_EVENT = "bht:outbox-update";
const snapshotWriteQueues = new Map<string, Promise<void>>();

const memoryOutbox = new Map<string, OfflineMutation>();
const memorySnapshots = new Map<
  string,
  { key: string; value: unknown; savedAt: number }
>();

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function enqueueSnapshotWrite(
  key: string,
  operation: () => Promise<void>
): Promise<void> {
  const previous = snapshotWriteQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  snapshotWriteQueues.set(key, next);
  return next.finally(() => {
    if (snapshotWriteQueues.get(key) === next) snapshotWriteQueues.delete(key);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = operation(tx.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function announceOutboxChange(): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(OUTBOX_EVENT));
  }
}

export async function listOutbox(): Promise<OfflineMutation[]> {
  if (!hasIndexedDb()) {
    return Array.from(memoryOutbox.values()).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
  }
  const items = await withStore<OfflineMutation[]>(OUTBOX_STORE, "readonly", (store) =>
    store.getAll()
  );
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function putOutboxMutation(mutation: OfflineMutation): Promise<void> {
  if (!hasIndexedDb()) {
    memoryOutbox.set(mutation.id, mutation);
    if (mutation.status === "synced") await pruneSyncHistory();
    announceOutboxChange();
    return;
  }
  await withStore<IDBValidKey>(OUTBOX_STORE, "readwrite", (store) =>
    store.put(mutation)
  );
  if (mutation.status === "synced") await pruneSyncHistory();
  announceOutboxChange();
}

async function pruneSyncHistory(): Promise<void> {
  const items = await listOutbox();
  const synced = items.filter((item) => item.status === "synced");
  const cutoff = Date.now() - SYNC_HISTORY_MAX_AGE_MS;
  const expired = synced.filter(
    (item) => Date.parse(item.syncedAt || item.createdAt) < cutoff
  );
  const excess = synced.slice(0, Math.max(0, synced.length - SYNC_HISTORY_LIMIT));
  const removeIds = new Set([...expired, ...excess].map((item) => item.id));
  if (!removeIds.size) return;
  if (!hasIndexedDb()) {
    removeIds.forEach((id) => memoryOutbox.delete(id));
    return;
  }
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, "readwrite");
      const store = tx.objectStore(OUTBOX_STORE);
      removeIds.forEach((id) => store.delete(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function deleteOutboxMutation(id: string): Promise<void> {
  if (!hasIndexedDb()) {
    memoryOutbox.delete(id);
    announceOutboxChange();
    return;
  }
  await withStore<undefined>(OUTBOX_STORE, "readwrite", (store) => store.delete(id));
  announceOutboxChange();
}

function shouldRegenerateIdempotencyKey(mutation: OfflineMutation): boolean {
  return (
    mutation.conflictCode === "IDEMPOTENCY_KEY_REUSED" ||
    mutation.errorCode === "IDEMPOTENCY_KEY_REUSED"
  );
}

export async function clearSyncedOutbox(): Promise<void> {
  const items = await listOutbox();
  const syncedIds = items.filter((item) => item.status === "synced").map((item) => item.id);
  if (syncedIds.length === 0) return;
  if (!hasIndexedDb()) {
    syncedIds.forEach((id) => memoryOutbox.delete(id));
    announceOutboxChange();
    return;
  }
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, "readwrite");
      const store = tx.objectStore(OUTBOX_STORE);
      syncedIds.forEach((id) => store.delete(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  announceOutboxChange();
}

async function replaceOutboxRecordAtomic(
  deleteId: string | null,
  updated: OfflineMutation
): Promise<void> {
  if (!hasIndexedDb()) {
    if (deleteId) memoryOutbox.delete(deleteId);
    memoryOutbox.set(updated.id, updated);
    announceOutboxChange();
    return;
  }
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, "readwrite");
      const store = tx.objectStore(OUTBOX_STORE);
      if (deleteId && deleteId !== updated.id) {
        store.delete(deleteId);
      }
      store.put(updated);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  announceOutboxChange();
}

export async function retryOutboxMutation(id: string): Promise<OfflineMutation | null> {
  const items = await listOutbox();
  const existing = items.find((item) => item.id === id);
  if (!existing) return null;

  const regenerate = shouldRegenerateIdempotencyKey(existing);
  const nextId = regenerate ? crypto.randomUUID() : existing.id;

  const updated: OfflineMutation = {
    ...existing,
    id: nextId,
    status: "pending",
    lastError: undefined,
    conflictCode: undefined,
    errorCode: undefined,
    causalKey: getOfflineCausalKey({
      id: nextId,
      kind: existing.kind,
      actorUsername: existing.actorUsername,
      body: existing.body,
      causalKey: undefined,
    }),
  };

  await replaceOutboxRecordAtomic(regenerate ? existing.id : null, updated);
  return updated;
}

export async function updateAndRetryOutboxMutation(
  id: string,
  nextPayload: Record<string, unknown>,
  options?: { replaceBody?: boolean }
): Promise<OfflineMutation | null> {
  const items = await listOutbox();
  const existing = items.find((item) => item.id === id);
  if (!existing) return null;

  const nextId = crypto.randomUUID();
  const nextBody: Record<string, unknown> = options?.replaceBody
    ? { ...nextPayload }
    : {
        ...existing.body,
        ...nextPayload,
      };

  const updated: OfflineMutation = {
    ...existing,
    id: nextId,
    body: nextBody,
    status: "pending",
    lastError: undefined,
    conflictCode: undefined,
    errorCode: undefined,
    causalKey: getOfflineCausalKey({
      id: nextId,
      kind: existing.kind,
      actorUsername: existing.actorUsername,
      body: nextBody,
      causalKey: undefined,
    }),
  };

  await replaceOutboxRecordAtomic(existing.id, updated);
  return updated;
}

export async function saveOfflineSnapshot(
  actorUsername: string,
  name: string,
  value: unknown
): Promise<void> {
  const key = `${actorUsername}:${name}`;
  if (!hasIndexedDb()) {
    memorySnapshots.set(key, { key, value, savedAt: Date.now() });
    return;
  }
  await enqueueSnapshotWrite(key, () =>
    withStore<IDBValidKey>(SNAPSHOT_STORE, "readwrite", (store) =>
      store.put({ key, value, savedAt: Date.now() })
    ).then(() => undefined)
  );
}

export async function readOfflineSnapshot<T>(
  actorUsername: string,
  name: string
): Promise<T | null> {
  const key = `${actorUsername}:${name}`;
  if (!hasIndexedDb()) {
    const row = memorySnapshots.get(key);
    return (row?.value as T | undefined) ?? null;
  }
  const row = await withStore<{ value: T } | undefined>(
    SNAPSHOT_STORE,
    "readonly",
    (store) => store.get(key)
  );
  return row?.value ?? null;
}

export async function deleteOfflineSnapshot(
  actorUsername: string,
  name: string
): Promise<void> {
  const key = `${actorUsername}:${name}`;
  if (!hasIndexedDb()) {
    memorySnapshots.delete(key);
    return;
  }
  await enqueueSnapshotWrite(key, () =>
    withStore<undefined>(SNAPSHOT_STORE, "readwrite", (store) =>
      store.delete(key)
    ).then(() => undefined)
  );
}

export async function deleteOfflineSnapshotsForActor(
  actorUsername: string
): Promise<void> {
  const prefix = `${actorUsername}:`;
  if (!hasIndexedDb()) {
    for (const key of Array.from(memorySnapshots.keys())) {
      if (key.startsWith(prefix)) memorySnapshots.delete(key);
    }
    return;
  }
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SNAPSHOT_STORE, "readwrite");
      const store = tx.objectStore(SNAPSHOT_STORE);
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        if (String(row.key).startsWith(prefix)) row.delete();
        row.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function getOfflineCausalKey(
  mutation: Pick<
    OfflineMutation,
    "id" | "kind" | "actorUsername" | "body" | "causalKey"
  >
): string {
  if (mutation.causalKey) return mutation.causalKey;
  const body = mutation.body;
  if (mutation.kind === "WAREHOUSE_ADVANCE") {
    return `order:${String(body.orderId ?? mutation.id)}`;
  }
  const entity =
    body.orderId ??
    body.customerPartyId ??
    body.customerNameRaw ??
    body.expenseDate ??
    mutation.id;
  return `${mutation.actorUsername}:${mutation.kind}:${String(entity)}`;
}

export async function submitOfflineCapable<T>({
  kind,
  actorUsername,
  url,
  body,
}: {
  kind: OfflineMutationKind;
  actorUsername: string;
  url: OfflineMutation["url"];
  body: Record<string, unknown>;
}): Promise<OfflineSubmitResult<T>> {
  if (!actorUsername.trim()) {
    throw new Error(
      "No se pudo identificar al usuario. Vuelve a iniciar sesión antes de guardar la operación."
    );
  }
  const id = crypto.randomUUID();
  const mutation: OfflineMutation = {
    id,
    kind,
    actorUsername,
    url,
    body,
    createdAt: new Date().toISOString(),
    status: "pending",
    causalKey: getOfflineCausalKey({
      id,
      kind,
      actorUsername,
      body,
      causalKey: undefined,
    }),
  };

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    await putOutboxMutation(mutation);
    return { queued: true, mutationId: id };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": id,
        "X-BHT-Offline-Actor": actorUsername,
      },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      const error = new Error(data.error || "La operación no pudo completarse");
      Object.assign(error, { status: response.status });
      throw error;
    }
    return { queued: false, mutationId: id, data };
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status ?? 0);
    if (status > 0) throw error;
    await putOutboxMutation(mutation);
    return { queued: true, mutationId: id };
  }
}
