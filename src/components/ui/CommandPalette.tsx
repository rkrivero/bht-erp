"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { CloseIcon, SearchIcon } from "./Icons";
import { Badge } from "./Primitives";

export interface CommandPaletteItem {
  id: string;
  label: string;
  subtitle?: string;
  group: string;
  keywords?: string;
  badge?: string;
  onSelect: () => void;
}

export function CommandPalette({
  items,
  placeholder = "Ir a sección, buscar pedido, cliente o producto...",
}: {
  items: CommandPaletteItem[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const titleId = useId();
  const listboxId = useId();
  const optionBaseId = useId();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    function handleCustomOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("bht:open-command-palette", handleCustomOpen);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("bht:open-command-palette", handleCustomOpen);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      setQuery("");
      setActiveIndex(0);
      if (typeof dialog.showModal === "function") {
        if (!dialog.open) {
          try {
            dialog.showModal();
          } catch {
            dialog.setAttribute("open", "");
          }
        }
      } else {
        dialog.setAttribute("open", "");
      }
      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 20);
    } else if (dialog.open) {
      if (typeof dialog.close === "function") {
        try {
          dialog.close();
        } catch {
          dialog.removeAttribute("open");
        }
      } else {
        dialog.removeAttribute("open");
      }
    }
  }, [open]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 30);
    return items
      .filter((item) => {
        const haystack =
          `${item.label} ${item.subtitle ?? ""} ${item.group} ${item.keywords ?? ""}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 30);
  }, [items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const activeOptionId =
    filteredItems.length > 0 && filteredItems[activeIndex]
      ? `${optionBaseId}-opt-${activeIndex}`
      : undefined;

  const pressedOutsideRef = useRef(false);

  if (!open) return null;

  function executeItem(item: CommandPaletteItem | undefined) {
    if (!item) return;
    setOpen(false);
    item.onSelect();
  }

  function isOutsideDialog(
    e: React.PointerEvent<HTMLDialogElement>,
    dialog: HTMLDialogElement
  ) {
    const rect = dialog.getBoundingClientRect();
    return (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    );
  }

  function handleDialogPointerDown(e: React.PointerEvent<HTMLDialogElement>) {
    const dialog = dialogRef.current;
    pressedOutsideRef.current = Boolean(dialog && isOutsideDialog(e, dialog));
  }

  function handleDialogPointerUp(e: React.PointerEvent<HTMLDialogElement>) {
    const dialog = dialogRef.current;
    if (pressedOutsideRef.current && dialog && isOutsideDialog(e, dialog)) {
      setOpen(false);
    }
    pressedOutsideRef.current = false;
  }

  return (
    <dialog
      ref={dialogRef}
      closedby="any"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        setOpen(false);
      }}
      onClose={() => {
        if (open) setOpen(false);
      }}
      onPointerDown={handleDialogPointerDown}
      onPointerUp={handleDialogPointerUp}
      className="bht-dialog fixed inset-x-0 top-14 z-50 mx-auto open:flex max-h-[80dvh] w-[calc(100%-1.5rem)] max-w-xl flex-col overflow-hidden rounded-2xl border border-bht-line bg-white p-0 text-bht-ink-strong shadow-bht-elev-17 outline-none"
    >
      <div className="flex items-center gap-2.5 border-b border-bht-line px-4 py-3">
        <SearchIcon className="h-4 w-4 text-bht-ink-muted" />
        <label id={titleId} htmlFor="bht-command-input" className="sr-only">
          Paleta de comandos y búsqueda rápida
        </label>
        <input
          ref={inputRef}
          id="bht-command-input"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((prev) =>
                filteredItems.length > 0 ? (prev + 1) % filteredItems.length : 0
              );
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((prev) =>
                filteredItems.length > 0
                  ? (prev - 1 + filteredItems.length) % filteredItems.length
                  : 0
              );
            } else if (e.key === "Enter" && filteredItems[activeIndex]) {
              e.preventDefault();
              executeItem(filteredItems[activeIndex]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm text-bht-ink-strong placeholder:text-bht-ink-muted focus:outline-none"
        />
        <button
          type="button"
          data-compact="true"
          onClick={() => setOpen(false)}
          aria-label="Cerrar paleta de comandos"
          className="rounded-lg p-1 text-bht-ink-soft hover:bg-bht-mist hover:text-bht-ink-strong cursor-pointer"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      <div
        id={listboxId}
        role="listbox"
        aria-label="Resultados de comandos"
        className="max-h-[60dvh] overflow-y-auto p-2"
      >
        {filteredItems.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-bht-ink-soft">
              No se encontraron acciones o registros para &ldquo;{query}&rdquo;.
            </p>
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="mt-2 rounded-lg border border-bht-line px-3 py-1.5 text-xs font-semibold text-bht-cobalt-strong hover:bg-bht-cobalt-bg cursor-pointer"
              >
                Limpiar búsqueda
              </button>
            )}
          </div>
        ) : (
          filteredItems.map((item, idx) => {
            const active = idx === activeIndex;
            const prevGroup = idx > 0 ? filteredItems[idx - 1]?.group : undefined;
            const showGroup = item.group !== prevGroup;
            return (
              <React.Fragment key={item.id}>
                {showGroup && (
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-bht-ink-muted">
                    {item.group}
                  </p>
                )}
                <button
                  ref={(el) => {
                    optionRefs.current[idx] = el;
                  }}
                  id={`${optionBaseId}-opt-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => executeItem(item)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors duration-150 cursor-pointer ${
                    active
                      ? "bg-bht-cobalt-bg/75 text-bht-navy-deep ring-1 ring-bht-cobalt/20"
                      : "text-bht-ink-strong hover:bg-bht-paper"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{item.label}</p>
                    {item.subtitle && (
                      <p className="truncate text-xs text-bht-ink-soft">
                        {item.subtitle}
                      </p>
                    )}
                  </div>
                  {item.badge && <Badge tone="neutral">{item.badge}</Badge>}
                </button>
              </React.Fragment>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between border-t border-bht-line bg-bht-paper px-4 py-2 text-[11px] text-bht-ink-soft">
        <span>Usa ↑↓ para navegar y Enter para abrir</span>
        <kbd className="rounded border border-bht-line bg-white px-1.5 py-0.5 font-mono text-[10px]">
          ESC
        </kbd>
      </div>
    </dialog>
  );
}
