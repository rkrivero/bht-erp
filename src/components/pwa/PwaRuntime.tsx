"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  getOfflineCausalKey,
  listOutbox,
  OUTBOX_EVENT,
  putOutboxMutation,
} from "@/lib/offline/outbox";
import type { OfflineMutation, OfflineMutationKind } from "@/lib/offline/types";
import type { SyncScope } from "@/lib/realtime/types";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";

function scopesForOutboxKind(kind: OfflineMutationKind): SyncScope[] {
  if (kind === "ORDER_CREATE") {
    return ["orders", "inventory", "collections", "treasury", "partners"];
  }
  if (kind === "COLLECTION") {
    return ["collections", "orders", "treasury", "partners"];
  }
  if (kind === "ROUTE_EXPENSE") {
    return ["treasury", "partners"];
  }
  return ["orders", "inventory", "partners"];
}

interface RuntimeState {
  online: boolean;
  pending: number;
  conflicts: number;
  syncing: boolean;
}

const INITIAL_STATE: RuntimeState = {
  online: true,
  pending: 0,
  conflicts: 0,
  syncing: false,
};

const OFFLINE_WARM_ROUTES = ["/vendedor", "/almacen"] as const;

export default function PwaRuntime() {
  const [state, setState] = useState<RuntimeState>(INITIAL_STATE);
  const processingRef = useRef(false);

  const refreshCounts = useCallback(async () => {
    if (typeof indexedDB === "undefined") return;
    const items = await listOutbox();
    setState((prev) => ({
      ...prev,
      online: navigator.onLine,
      pending: items.filter(
        (item) => item.status === "pending" || item.status === "syncing"
      ).length,
      conflicts: items.filter((item) => item.status === "conflict").length,
    }));
  }, []);

  const processOutbox = useCallback(async () => {
    if (
      processingRef.current ||
      typeof indexedDB === "undefined" ||
      navigator.onLine === false
    ) {
      await refreshCounts();
      return;
    }
    processingRef.current = true;
    setState((prev) => ({ ...prev, syncing: true, online: true }));
    try {
      const items = await listOutbox();
      const blockedChains = new Set(
        items
          .filter((item) => item.status === "conflict")
          .map((item) => getOfflineCausalKey(item))
      );
      for (const item of items) {
        if (item.status === "synced") continue;
        const causalKey = getOfflineCausalKey(item);
        // Preserve order inside one entity chain while allowing independent work.
        if (item.status === "conflict" || blockedChains.has(causalKey)) continue;
        const syncing: OfflineMutation = { ...item, status: "syncing" };
        await putOutboxMutation(syncing);
        try {
          const response = await fetch(item.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": item.id,
              "X-BHT-Offline-Actor": item.actorUsername,
            },
            body: JSON.stringify(item.body),
          });
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
            code?: string;
            entityRef?: string;
          };
          if (response.ok) {
            await putOutboxMutation({
              ...item,
              status: "synced",
              syncedAt: new Date().toISOString(),
              lastError: undefined,
              conflictCode: undefined,
              errorCode: undefined,
              entityRef: undefined,
            });
            notifyLocalSync(scopesForOutboxKind(item.kind));
            continue;
          }
          if (response.status === 401) {
            await putOutboxMutation({
              ...item,
              status: "pending",
              lastError: "Inicia sesión para sincronizar esta operación",
            });
            break;
          }
          if (response.status === 403) {
            await putOutboxMutation({
              ...item,
              status: "conflict",
              lastError:
                payload.error ||
                "Permiso denegado o sesión de otro usuario en este equipo",
              conflictCode: payload.code || "FORBIDDEN",
              errorCode: payload.code || "FORBIDDEN",
              entityRef: payload.entityRef,
              causalKey,
            });
            blockedChains.add(causalKey);
            continue;
          }
          if (response.status >= 500 || response.status === 429) {
            await putOutboxMutation({
              ...item,
              status: "pending",
              lastError: "Error temporal del servidor; se reintentará automáticamente",
            });
            break;
          }
          await putOutboxMutation({
            ...item,
            status: "conflict",
            lastError: payload.error || "La operación cambió y requiere revisión",
            conflictCode: payload.code,
            errorCode: payload.code,
            entityRef: payload.entityRef,
            causalKey,
          });
          blockedChains.add(causalKey);
          continue;
        } catch {
          await putOutboxMutation({
            ...item,
            status: "pending",
            lastError: "Sin conexión; se reintentará automáticamente",
          });
          break;
        }
      }
    } finally {
      processingRef.current = false;
      setState((prev) => ({ ...prev, syncing: false }));
      await refreshCounts();
    }
  }, [refreshCounts]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js")
        .then(async () => {
          await navigator.serviceWorker.ready;
          if (navigator.onLine) {
            await Promise.all(
              OFFLINE_WARM_ROUTES.map((route) =>
                fetch(route, {
                  cache: "no-store",
                  headers: { Accept: "text/html" },
                }).catch(() => undefined)
              )
            );
          }
        })
        .catch(() => {
          // The application remains usable online if service-worker setup fails.
        });
    }
    const onOnline = () => void processOutbox();
    const onOffline = () =>
      setState((prev) => ({ ...prev, online: false, syncing: false }));
    const onOutbox = () => {
      void refreshCounts();
      if (navigator.onLine) void processOutbox();
    };
    const onResume = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void processOutbox();
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(OUTBOX_EVENT, onOutbox);
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    void refreshCounts();
    if (navigator.onLine) void processOutbox();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(OUTBOX_EVENT, onOutbox);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [processOutbox, refreshCounts]);

  const visible =
    !state.online || state.pending > 0 || state.conflicts > 0 || state.syncing;

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (visible) {
      document.documentElement.style.setProperty("--bht-pwa-banner-offset", "3.5rem");
    } else {
      document.documentElement.style.removeProperty("--bht-pwa-banner-offset");
    }
    return () => {
      document.documentElement.style.removeProperty("--bht-pwa-banner-offset");
    };
  }, [visible]);

  if (!visible) return null;

  const message = state.conflicts
    ? `${state.conflicts} operación(es) necesitan revisión`
    : state.syncing
      ? "Sincronizando operaciones pendientes…"
      : !state.online
        ? `Sin conexión${state.pending ? ` · ${state.pending} pendiente(s)` : ""}`
        : `${state.pending} operación(es) pendientes`;

  return (
    <div
      role={state.conflicts ? "alert" : "status"}
      aria-live={state.conflicts ? "assertive" : "polite"}
      className={`fixed bottom-[var(--bht-floating-bottom,5.4rem)] left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 rounded-xl border px-3.5 py-2.5 text-center text-xs font-semibold shadow-lg md:bottom-4 ${
        state.conflicts
          ? "border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-text)]"
          : "border-[var(--horizon-border)] bg-white text-[var(--horizon-ink)]"
      }`}
    >
      <Link
        href="/offline"
        className="inline-flex min-h-6 items-center underline-offset-2 hover:underline"
      >
        {message}
      </Link>
    </div>
  );
}
