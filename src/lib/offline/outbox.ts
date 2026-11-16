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
  window.dispatchEvent(new CustomEvent(OUTBOX_EVENT));
}

export async function listOutbox(): Promise<OfflineMutation[]> {
  const items = await withStore<OfflineMutation[]>(OUTBOX_STORE, "readonly", (store) =>
    store.getAll()
  );
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function putOutboxMutation(mutation: OfflineMutation): Promise<void> {
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
  await withStore<undefined>(OUTBOX_STORE, "readwrite", (store) => store.delete(id));
  announceOutboxChange();
}

export async function saveOfflineSnapshot(
  actorUsername: string,
  name: string,
  value: unknown
): Promise<void> {
  const key = `${actorUsername}:${name}`;
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
  const row = await withStore<{ value: T } | undefined>(
    SNAPSHOT_STORE,
    "readonly",
    (store) => store.get(`${actorUsername}:${name}`)
  );
  return row?.value ?? null;
}

export async function deleteOfflineSnapshot(
  actorUsername: string,
  name: string
): Promise<void> {
  const key = `${actorUsername}:${name}`;
  await enqueueSnapshotWrite(key, () =>
    withStore<undefined>(SNAPSHOT_STORE, "readwrite", (store) =>
      store.delete(key)
    ).then(() => undefined)
  );
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
  };

  if (navigator.onLine === false) {
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
