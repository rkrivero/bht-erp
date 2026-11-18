"use client";

import { useCallback, useEffect, useState } from "react";
import { listOutbox, OUTBOX_EVENT } from "@/lib/offline/outbox";
import type { OfflineMutation } from "@/lib/offline/types";

const KIND_LABEL: Record<OfflineMutation["kind"], string> = {
  ORDER_CREATE: "Pedido",
  COLLECTION: "Cobro",
  ROUTE_EXPENSE: "Gasto de ruta",
};

export default function OfflineQueuePanel() {
  const [items, setItems] = useState<OfflineMutation[]>([]);
  const [available, setAvailable] = useState(true);

  const refresh = useCallback(async () => {
    if (typeof indexedDB === "undefined") {
      setAvailable(false);
      return;
    }
    try {
      setItems(await listOutbox());
    } catch {
      setAvailable(false);
    }
  }, []);

  useEffect(() => {
    const onUpdate = () => void refresh();
    window.addEventListener(OUTBOX_EVENT, onUpdate);
    window.addEventListener("online", onUpdate);
    void refresh();
    return () => {
      window.removeEventListener(OUTBOX_EVENT, onUpdate);
      window.removeEventListener("online", onUpdate);
    };
  }, [refresh]);

  const orderedItems = [...items].sort((a, b) => {
    const rank = { conflict: 0, pending: 1, syncing: 1, synced: 2 };
    const priority = rank[a.status] - rank[b.status];
    if (priority !== 0) return priority;
    if (a.status === "synced" && b.status === "synced") {
      return (b.syncedAt || b.createdAt).localeCompare(a.syncedAt || a.createdAt);
    }
    return a.createdAt.localeCompare(b.createdAt);
  });
  const pendingCount = items.filter(
    (item) => item.status === "pending" || item.status === "syncing"
  ).length;
  const conflictCount = items.filter((item) => item.status === "conflict").length;
  const syncedCount = items.filter((item) => item.status === "synced").length;

  if (!available) {
    return (
      <p className="mt-4 rounded-xl bg-[#FEF2F2] p-3 text-left text-xs text-[#991B1B]">
        Este navegador no permite almacenamiento offline. Usa una ventana normal o
        habilita el almacenamiento del sitio.
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="mt-4 rounded-xl bg-[#F0FDF4] p-3 text-xs font-medium text-[#166534]">
        No hay operaciones pendientes en este dispositivo.
      </p>
    );
  }

  return (
    <section aria-labelledby="offline-queue-heading" className="mt-5 text-left">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="offline-queue-heading" className="text-sm font-semibold text-[#0F2942]">
          Actividad de sincronización
        </h2>
        <p className="text-xs text-[#5C5A55]">
          {pendingCount} pendiente(s) · {syncedCount} sincronizada(s) · {conflictCount}{" "}
          en revisión
        </p>
      </div>
      <ul className="mt-2 space-y-2">
        {orderedItems.map((item) => (
          <li
            key={item.id}
            className={`rounded-xl border p-3 text-xs ${
              item.status === "conflict"
                ? "border-[#FECACA] bg-[#FEF2F2]"
                : item.status === "synced"
                  ? "border-[#BBF7D0] bg-[#F0FDF4]"
                  : "border-[#D4E0EC] bg-[#F8FAFC]"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <strong className="text-[#18181B]">{KIND_LABEL[item.kind]}</strong>
              <span
                className={
                  item.status === "conflict"
                    ? "text-[#991B1B]"
                    : item.status === "synced"
                      ? "text-[#166534]"
                      : "text-[#1E446B]"
                }
              >
                {item.status === "conflict"
                  ? "Requiere revisión"
                  : item.status === "syncing"
                    ? "Sincronizando"
                    : item.status === "synced"
                      ? "Sincronizada"
                      : "Pendiente"}
              </span>
            </div>
            <p className="mt-1 text-[#5C5A55]">
              {new Intl.DateTimeFormat("es-PE", {
                dateStyle: "short",
                timeStyle: "short",
              }).format(
                new Date(
                  item.status === "synced"
                    ? item.syncedAt || item.createdAt
                    : item.createdAt
                )
              )}
            </p>
            {item.lastError && (
              <p className="mt-2 font-medium text-[#991B1B]">{item.lastError}</p>
            )}
            {item.conflictCode && (
              <p className="mt-1 text-xs text-[#7F1D1D]">
                Código: {item.conflictCode}
                {item.entityRef ? ` · Referencia: ${item.entityRef}` : ""}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-[#5C5A55]">
        Los conflictos no modifican automáticamente dinero, precios ni stock. Permanecen
        bloqueados hasta revisar la información con conexión.
      </p>
    </section>
  );
}
