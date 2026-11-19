import { fetchJson } from "./api-client";
import type { UndoExecuteResponseDto, UndoListResponseDto } from "./contracts";

export function formatCountdownMmSs(remainingSeconds: number): string {
  const safe = Math.max(0, Math.floor(remainingSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function parseIsoTimestampMs(value: string): number {
  const raw = String(value || "").trim();
  if (!raw) return Number.NaN;
  const direct = Date.parse(raw);
  if (Number.isFinite(direct)) return direct;
  // Normalize Postgres `::text` format (`YYYY-MM-DD HH:MM:SS.ffffff+00`) for Safari/WebKit
  const normalized = raw
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return Date.parse(normalized);
}

export function getRemainingSeconds(expiresAtIso: string, nowMs = Date.now()): number {
  const target = parseIsoTimestampMs(expiresAtIso);
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, Math.floor((target - nowMs) / 1000));
}

export function fetchUndoableActions(params: {
  scope?: "mine" | "all";
  status?: "PENDING" | "UNDONE" | "ALL";
  actionType?: string;
  limit?: number;
}): Promise<UndoListResponseDto> {
  const search = new URLSearchParams();
  if (params.scope) search.set("scope", params.scope);
  if (params.status) search.set("status", params.status);
  if (params.actionType) search.set("actionType", params.actionType);
  if (params.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return fetchJson<UndoListResponseDto>(`/api/undo${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

export function executeUndoRequest(
  undoId: number,
  reason?: string
): Promise<UndoExecuteResponseDto> {
  return fetchJson<UndoExecuteResponseDto>("/api/undo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ undoId, reason: reason?.trim() || undefined }),
  });
}
