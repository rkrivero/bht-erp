"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { CloseIcon, SearchIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
  SegmentedControl,
} from "@/components/ui/Primitives";
import { ApiClientError } from "@/lib/api-client";
import type { UndoableActionDto } from "@/lib/contracts";
import { formatRoleEs, formatUndoActionTypeEs } from "@/lib/labels-es";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import {
  executeUndoRequest,
  fetchUndoableActions,
  formatCountdownMmSs,
  getRemainingSeconds,
} from "@/lib/undo-client";

interface AdminUndoPanelProps {
  onRefreshDashboard: () => Promise<void>;
  onFeedback: (message: string, isError?: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
}

const ACTION_TYPE_OPTIONS = [
  { value: "", label: "Todos los tipos de acción" },
  { value: "QUOTE_STATUS_CHANGE", label: "Cambio de estado en cotización" },
  { value: "QUOTE_CONVERT_TO_ORDER", label: "Conversión de cotización a pedido" },
  { value: "ORDER_CANCEL", label: "Anulación de pedido" },
  { value: "ORDER_STATUS_ADVANCE", label: "Avance de estado en almacén" },
  { value: "ORDER_CREATE", label: "Registro de pedido" },
  { value: "TRIP_CLOSE", label: "Cierre de hoja de ruta" },
  { value: "AUDIT_FLAG_STATUS", label: "Cambio de estado en alerta" },
] as const;

function formatLimaDateTime(value: string): string {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Lima",
  }).format(dt);
}

export default function AdminUndoPanel({
  onRefreshDashboard,
  onFeedback,
  onEditingChange,
}: AdminUndoPanelProps) {
  const [statusFilter, setStatusFilter] = useState<"PENDING" | "UNDONE" | "ALL">(
    "PENDING"
  );
  const [actionType, setActionType] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [actions, setActions] = useState<UndoableActionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<UndoableActionDto | null>(null);
  const [undoReason, setUndoReason] = useState("");
  const [busyUndoId, setBusyUndoId] = useState<number | null>(null);

  useEffect(() => {
    onEditingChange?.(Boolean(confirmUndo));
    return () => onEditingChange?.(false);
  }, [confirmUndo, onEditingChange]);

  const loadActions = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetchUndoableActions({
        scope: "all",
        status: statusFilter,
        actionType: actionType || undefined,
        limit: 120,
      });
      setActions(res.actions);
    } catch (error) {
      setErrorMsg(
        error instanceof ApiClientError
          ? error.message
          : "No se pudo cargar el historial de acciones reversibles."
      );
    } finally {
      setLoading(false);
    }
  }, [statusFilter, actionType]);

  useEffect(() => {
    void loadActions();
  }, [loadActions]);

  const filteredActions = useMemo(() => {
    const q = deferredSearch.trim().toLocaleLowerCase("es");
    if (!q) return actions;
    return actions.filter((item) => {
      return (
        item.summary.toLocaleLowerCase("es").includes(q) ||
        (item.entity_code ?? "").toLocaleLowerCase("es").includes(q) ||
        item.actor_name.toLocaleLowerCase("es").includes(q) ||
        item.actor_username.toLocaleLowerCase("es").includes(q) ||
        formatUndoActionTypeEs(item.action_type).toLocaleLowerCase("es").includes(q)
      );
    });
  }, [actions, deferredSearch]);

  async function handleConfirmUndo(event: React.FormEvent) {
    event.preventDefault();
    if (!confirmUndo || busyUndoId !== null) return;
    setBusyUndoId(confirmUndo.undo_id);
    try {
      const res = await executeUndoRequest(
        confirmUndo.undo_id,
        undoReason.trim() || "Reversión administrativa desde centro de deshacer"
      );
      setConfirmUndo(null);
      setUndoReason("");
      onFeedback(res.restoredMessage);
      notifyLocalSync([
        "orders",
        "inventory",
        "collections",
        "treasury",
        "purchases",
        "partners",
      ]);
      await Promise.all([loadActions(), onRefreshDashboard()]);
    } catch (error) {
      onFeedback(
        error instanceof ApiClientError
          ? error.message
          : "No se pudo revertir la acción seleccionada.",
        true
      );
    } finally {
      setBusyUndoId(null);
    }
  }

  return (
    <>
      <Card accent="horizon" padding="md" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Badge tone="horizon">Exclusivo Administrador</Badge>
            <h2 className="mt-2 text-base font-bold text-bht-ink-strong sm:text-lg">
              Centro de Reversión (Deshacer Acciones)
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-bht-ink-soft sm:text-sm">
              Como Administrador puedes deshacer errores operativos de cualquier usuario
              sin límite de tiempo, conservando toda la auditoría inmutable. Los demás
              roles solo disponen de 15 minutos para deshacer sus propias acciones.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void loadActions()}
            className="shrink-0"
          >
            {loading ? "Actualizando..." : "Actualizar historial"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <SegmentedControl<"PENDING" | "UNDONE" | "ALL">
            ariaLabel="Filtrar acciones reversibles por estado"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { id: "PENDING", label: "Reversibles" },
              { id: "UNDONE", label: "Ya deshechas" },
              { id: "ALL", label: "Todas" },
            ]}
          />
          <span className="text-xs font-medium text-bht-ink-soft tabular-nums">
            {filteredActions.length} registro(s)
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_minmax(220px,280px)]">
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-bht-ink-muted">
              <SearchIcon className="h-4 w-4" />
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar acciones reversibles"
              placeholder="Buscar por código (COT-, SO-), usuario o detalle..."
              className={`${INPUT_CLASS} pl-10 pr-8`}
            />
            {search && (
              <button
                type="button"
                data-compact="true"
                aria-label="Limpiar búsqueda de acciones"
                onClick={() => setSearch("")}
                className="absolute inset-y-0 right-2.5 flex items-center text-bht-ink-muted hover:text-bht-ink-strong cursor-pointer"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            )}
          </div>
          <select
            aria-label="Filtrar por tipo de acción"
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
            className={`${INPUT_CLASS} font-medium`}
          >
            {ACTION_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {loading && actions.length === 0 ? (
          <p className="py-8 text-center text-sm text-bht-ink-soft">
            Cargando historial de acciones reversibles...
          </p>
        ) : errorMsg ? (
          <EmptyState title={errorMsg} />
        ) : filteredActions.length === 0 ? (
          <EmptyState
            title="Sin acciones en este filtro"
            description="Cada anulación de cotización, conversión, anulación de pedido o cambio de etapa quedará registrada aquí."
          />
        ) : (
          <div className="space-y-2.5">
            {filteredActions.map((item) => {
              const isUndone = item.undone_at !== null;
              const remaining = getRemainingSeconds(item.expires_at);
              return (
                <article
                  key={item.undo_id}
                  className={`rounded-xl border p-3.5 text-sm ${
                    isUndone
                      ? "border-bht-line bg-bht-paper/70"
                      : "border-bht-line bg-white"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={isUndone ? "neutral" : "brand"}>
                          {formatUndoActionTypeEs(item.action_type)}
                        </Badge>
                        {item.entity_code && (
                          <Badge tone="horizon" className="tabular-nums">
                            {item.entity_code}
                          </Badge>
                        )}
                        {isUndone ? (
                          <Badge tone="success">Deshecha</Badge>
                        ) : item.is_expired ? (
                          <Badge tone="warning">
                            Ventana usuario vencida · Admin habilitado
                          </Badge>
                        ) : (
                          <Badge tone="brand" className="tabular-nums">
                            Ventana usuario: {formatCountdownMmSs(remaining)}
                          </Badge>
                        )}
                      </div>
                      <p className="font-semibold text-bht-ink-strong">
                        {item.summary}
                      </p>
                      <p className="text-xs text-bht-ink-soft">
                        Ejecutada por{" "}
                        <strong className="text-bht-ink-strong">
                          {item.actor_name}
                        </strong>{" "}
                        ({formatRoleEs(item.actor_role)}) ·{" "}
                        {formatLimaDateTime(item.created_at)}
                      </p>
                      {isUndone && (
                        <p className="rounded-lg border border-bht-success-line bg-bht-success-bg px-2.5 py-1.5 text-xs text-bht-success-strong">
                          Deshecha por{" "}
                          <strong>{item.undone_by_name || "Administrador"}</strong> el{" "}
                          {formatLimaDateTime(item.undone_at!)}
                          {item.undone_reason ? ` · Motivo: ${item.undone_reason}` : ""}
                        </p>
                      )}
                    </div>

                    {item.can_undo && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busyUndoId !== null}
                        onClick={() => {
                          setUndoReason("");
                          setConfirmUndo(item);
                        }}
                        className="shrink-0 border-bht-cobalt text-bht-cobalt-strong hover:bg-bht-cobalt-bg"
                      >
                        Deshacer acción
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Card>

      <ModalSheet
        open={Boolean(confirmUndo)}
        onClose={() => {
          if (busyUndoId === null) {
            setConfirmUndo(null);
            setUndoReason("");
          }
        }}
        title="Confirmar reversión administrativa"
        subtitle={confirmUndo?.summary}
      >
        {confirmUndo && (
          <form onSubmit={handleConfirmUndo} className="space-y-4">
            <div className="rounded-xl border border-bht-line-blue bg-bht-mist/70 p-3 text-xs text-bht-navy-deep space-y-1">
              <p>
                <strong>Tipo:</strong> {formatUndoActionTypeEs(confirmUndo.action_type)}
              </p>
              <p>
                <strong>Responsable original:</strong> {confirmUndo.actor_name} (
                {formatRoleEs(confirmUndo.actor_role)})
              </p>
              <p>
                La reversión restaurará el estado previo verificando integridad de
                stock, caja y estados intermedios sin eliminar historial.
              </p>
            </div>
            <div>
              <FieldLabel htmlFor="admin-undo-reason">
                Motivo de la reversión (opcional)
              </FieldLabel>
              <input
                id="admin-undo-reason"
                type="text"
                value={undoReason}
                onChange={(e) => setUndoReason(e.target.value)}
                placeholder="Ej. Se anuló cotización por equivocación"
                className={`${INPUT_CLASS} mt-1.5`}
              />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={busyUndoId !== null}
                onClick={() => {
                  setConfirmUndo(null);
                  setUndoReason("");
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={busyUndoId !== null}>
                {busyUndoId !== null ? "Revirtiendo..." : "Sí, deshacer acción"}
              </Button>
            </div>
          </form>
        )}
      </ModalSheet>
    </>
  );
}
