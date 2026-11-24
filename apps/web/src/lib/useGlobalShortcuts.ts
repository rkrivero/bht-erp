"use client";

import { useEffect, useRef } from "react";

interface UseGlobalShortcutsOptions {
  enabled?: boolean;
  onGoTo?: Record<string, () => void>;
  onNewOrder?: () => void;
  onFocusSearch?: () => void;
  onOpenHelp?: () => void;
  onUndo?: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(target.closest("dialog[open], [role='dialog']"));
}

function defaultFocusSearch() {
  const candidates = document.querySelectorAll<HTMLInputElement>(
    'input[type="search"], input[aria-label*="Buscar" i], input[placeholder*="Buscar" i]'
  );
  for (const el of candidates) {
    if (el.offsetParent !== null && !el.disabled) {
      el.focus();
      el.select?.();
      return;
    }
  }
}

export function useGlobalShortcuts({
  enabled = true,
  onGoTo,
  onNewOrder,
  onFocusSearch,
  onOpenHelp,
  onUndo,
}: UseGlobalShortcutsOptions) {
  const gPendingRef = useRef(false);
  const gTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function clearPendingG() {
      gPendingRef.current = false;
      if (gTimerRef.current !== null) {
        window.clearTimeout(gTimerRef.current);
        gTimerRef.current = null;
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();

      if ((e.metaKey || e.ctrlKey) && key === "z" && !e.shiftKey) {
        if (isEditableTarget(e.target) || !onUndo) return;
        e.preventDefault();
        onUndo();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      if (gPendingRef.current) {
        clearPendingG();
        const handler = onGoTo?.[key];
        if (handler) {
          e.preventDefault();
          handler();
        }
        return;
      }

      if (key === "g" && onGoTo) {
        gPendingRef.current = true;
        gTimerRef.current = window.setTimeout(clearPendingG, 800);
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        if (onFocusSearch) onFocusSearch();
        else defaultFocusSearch();
        return;
      }

      if (key === "n" && onNewOrder) {
        e.preventDefault();
        onNewOrder();
        return;
      }

      if (e.key === "?" && onOpenHelp) {
        e.preventDefault();
        onOpenHelp();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      clearPendingG();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, onGoTo, onNewOrder, onFocusSearch, onOpenHelp, onUndo]);
}
