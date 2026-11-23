"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { HorizonLogo, LockIcon, LogOutIcon, SearchIcon } from "./Icons";
import { Badge, type BadgeTone, Button } from "./Primitives";

export interface NavTabItem<T extends string = string> {
  id: T;
  label: string;
  mobileLabel?: string;
  icon: React.ReactNode;
  badgeCount?: number;
  group?: string;
}

export interface NavExtraAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

export type LiveSyncStatus = "live" | "syncing" | "paused" | "offline";
export type UiDensity = "comfortable" | "compact";

const DENSITY_STORAGE_KEY = "bht_density";

export function DesktopSidebar<T extends string>({
  items,
  activeId,
  onChange,
  areaLabel,
  footer,
}: {
  items: NavTabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  areaLabel: string;
  footer?: React.ReactNode;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[232px] flex-col bg-bht-navy-deep border-r border-bht-navy-soft px-3.5 py-5 text-white md:flex">
      <div className="mb-4 flex items-center gap-3 border-b border-white/10 px-2 pb-5">
        <span className="flex h-10 w-16 flex-none items-center justify-center rounded-xl bg-white/10 border border-white/15 p-1 shadow-xs">
          <HorizonLogo className="h-full w-full" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-[-0.01em] text-white leading-tight">
            Blue Horizon Trade
          </p>
          <p className="mt-0.5 truncate text-[11px] font-medium tracking-[0.03em] text-bht-info-line/80">
            {areaLabel}
          </p>
        </div>
      </div>
      <nav aria-label="Secciones principales" className="grid gap-1">
        {items.map((item, idx) => {
          const active = item.id === activeId;
          const prevGroup = idx > 0 ? items[idx - 1]?.group : undefined;
          const showGroupHeader = Boolean(item.group && item.group !== prevGroup);
          return (
            <React.Fragment key={item.id}>
              {showGroupHeader && (
                <p
                  className={`px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-bht-info-line/75 ${
                    idx === 0 ? "pt-0" : "mt-2 border-t border-white/10 pt-3"
                  }`}
                >
                  {item.group}
                </p>
              )}
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onChange(item.id)}
                className={`relative flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer ${
                  active
                    ? "bg-white font-semibold text-bht-navy-deep shadow-sm"
                    : "text-bht-info-line/85 hover:bg-white/[0.08] hover:text-white font-medium"
                }`}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute left-1 top-2.5 bottom-2.5 w-[3px] rounded-full bg-bht-cobalt"
                  />
                )}
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 items-center justify-center ${
                    active ? "text-bht-cobalt" : ""
                  }`}
                >
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.badgeCount !== undefined && item.badgeCount > 0 && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
                      active
                        ? "bg-bht-cobalt-bg text-bht-cobalt-strong"
                        : "bg-white/15 text-white"
                    }`}
                  >
                    {item.badgeCount > 99 ? "99+" : item.badgeCount}
                  </span>
                )}
              </button>
            </React.Fragment>
          );
        })}
      </nav>
      {footer && (
        <div className="mt-auto border-t border-white/10 px-2 pt-4 text-xs text-bht-info-line/75">
          {footer}
        </div>
      )}
    </aside>
  );
}

const SYNC_STATUS_CONFIG: Record<
  LiveSyncStatus,
  { label: string; dotClass: string; pillClass: string }
> = {
  live: {
    label: "En línea",
    dotClass: "bg-emerald-600",
    pillClass: "border-emerald-600/20 bg-emerald-50 text-emerald-800",
  },
  syncing: {
    label: "Sincronizando",
    dotClass: "bg-bht-cobalt animate-pulse",
    pillClass: "border-bht-cobalt/30 bg-bht-cobalt-bg text-bht-cobalt",
  },
  paused: {
    label: "En pausa",
    dotClass: "bg-slate-400",
    pillClass: "border-bht-line bg-bht-mist text-slate-600",
  },
  offline: {
    label: "Sin conexión",
    dotClass: "bg-amber-600",
    pillClass: "border-amber-600/20 bg-amber-50 text-amber-900",
  },
};

export function AppHeader({
  title,
  roleLabel,
  roleTone = "horizon",
  roleDotColor = "bg-bht-success",
  userSubtitle,
  syncStatus,
  onSyncClick,
  maxWidth = "2xl",
  actions,
  onLogout,
  onOpenCommandPalette,
  withSidebar = false,
}: {
  title: string;
  roleLabel: string;
  roleTone?: BadgeTone;
  roleDotColor?: string;
  userSubtitle?: string;
  syncStatus?: LiveSyncStatus;
  onSyncClick?: () => void;
  maxWidth?: "xl" | "2xl" | "5xl" | "6xl" | "7xl";
  actions?: React.ReactNode;
  onLogout: () => void;
  onOpenCommandPalette?: () => void;
  withSidebar?: boolean;
}) {
  const accountMenuId = useId();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [displaySyncStatus, setDisplaySyncStatus] = useState(syncStatus);
  const [density, setDensity] = useState<UiDensity>("comfortable");
  const [shortcutHint, setShortcutHint] = useState("Ctrl K");

  useEffect(() => {
    try {
      const isApple = /Mac|iPhone|iPad|iPod/i.test(
        navigator.platform || navigator.userAgent || ""
      );
      setShortcutHint(isApple ? "⌘K" : "Ctrl K");
    } catch {
      // Keep default
    }
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DENSITY_STORAGE_KEY);
      const initial: UiDensity = saved === "compact" ? "compact" : "comfortable";
      setDensity(initial);
      document.documentElement.dataset.density = initial;
    } catch {
      // Ignore storage access errors
    }
  }, []);

  function toggleDensity() {
    const next: UiDensity = density === "compact" ? "comfortable" : "compact";
    setDensity(next);
    document.documentElement.dataset.density = next;
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
    } catch {
      // Ignore storage write errors
    }
  }

  function triggerCommandPalette() {
    if (onOpenCommandPalette) {
      onOpenCommandPalette();
      return;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("bht:open-command-palette"));
    }
  }

  useEffect(() => {
    if (!syncStatus) {
      setDisplaySyncStatus(undefined);
      return;
    }

    const browserIsOffline =
      typeof navigator !== "undefined" && navigator.onLine === false;
    const delayMs =
      syncStatus === "live"
        ? 0
        : syncStatus === "offline" && browserIsOffline
          ? 0
          : syncStatus === "offline"
            ? 2500
            : 900;
    const timer = window.setTimeout(() => setDisplaySyncStatus(syncStatus), delayMs);
    return () => window.clearTimeout(timer);
  }, [syncStatus]);

  const widthClass =
    maxWidth === "xl"
      ? "max-w-xl"
      : maxWidth === "5xl"
        ? "max-w-5xl"
        : maxWidth === "6xl"
          ? "max-w-6xl"
          : maxWidth === "7xl"
            ? "max-w-7xl"
            : "max-w-2xl";

  const syncCfg = displaySyncStatus ? SYNC_STATUS_CONFIG[displaySyncStatus] : null;

  return (
    <header
      className={`sticky top-0 z-30 border-b border-[var(--border-hairline)] bg-white/95 backdrop-blur-md ${withSidebar ? "md:ml-[232px]" : ""}`}
    >
      <div
        className={`mx-auto grid ${widthClass} grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-2 px-3.5 py-2.5 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-5 sm:py-3`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className={`flex h-10 w-16 flex-shrink-0 items-center justify-center ${
              withSidebar ? "md:hidden" : ""
            }`}
          >
            <HorizonLogo className="h-full w-full" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="line-clamp-2 text-base font-bold leading-tight tracking-[-0.02em] text-bht-ink-deep sm:truncate sm:text-xl">
              {title}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge tone={roleTone} dotColor={roleDotColor}>
                {roleLabel}
              </Badge>
              {syncCfg &&
                (onSyncClick ? (
                  <button
                    type="button"
                    data-compact="true"
                    onClick={onSyncClick}
                    aria-label={`Estado de sincronización: ${syncCfg.label}. Tocar para actualizar`}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-4 whitespace-nowrap transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt cursor-pointer ${syncCfg.pillClass}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${syncCfg.dotClass}`}
                      aria-hidden="true"
                    />
                    <span>{syncCfg.label}</span>
                  </button>
                ) : (
                  <span
                    role="status"
                    aria-live="polite"
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-4 whitespace-nowrap ${syncCfg.pillClass}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${syncCfg.dotClass}`}
                      aria-hidden="true"
                    />
                    <span>{syncCfg.label}</span>
                  </span>
                ))}
              {userSubtitle && (
                <span className="hidden truncate text-xs font-medium text-bht-ink-soft sm:inline">
                  {userSubtitle}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="ml-auto flex min-w-0 flex-shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          <button
            type="button"
            data-compact="true"
            onClick={triggerCommandPalette}
            aria-label="Abrir paleta de comandos (Cmd+K o Ctrl+K)"
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-bht-line-strong/80 bg-bht-paper/80 px-2.5 py-1.5 text-xs font-semibold text-bht-ink-soft transition-colors duration-150 hover:border-bht-cobalt/50 hover:bg-white hover:text-bht-navy-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt cursor-pointer"
          >
            <SearchIcon className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Ir a...</span>
            <kbd className="hidden md:inline-block rounded border border-bht-line bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold text-bht-ink-strong">
              {shortcutHint}
            </kbd>
          </button>

          {actions}

          <div className="relative">
            <Button
              type="button"
              variant="outline"
              size="sm"
              popoverTarget={accountMenuId}
              aria-expanded={accountMenuOpen}
              className="min-h-[36px] sm:min-h-[38px] rounded-xl px-3 text-xs sm:text-sm"
            >
              <span>Cuenta</span>
            </Button>
            <div
              id={accountMenuId}
              popover="auto"
              onToggle={(e) => {
                const evt = e as React.SyntheticEvent<HTMLDivElement> & {
                  newState?: string;
                };
                if (evt.newState) {
                  setAccountMenuOpen(evt.newState === "open");
                }
              }}
              className="bht-anchored-popover z-40 mt-1.5 w-60 max-w-[calc(100vw-1.5rem)] rounded-xl border border-bht-line bg-white p-2 shadow-bht-elev-17"
            >
              <div className="space-y-1 text-sm">
                <button
                  type="button"
                  onClick={toggleDensity}
                  aria-pressed={density === "compact"}
                  className="flex min-h-10 w-full items-center justify-between rounded-lg px-2.5 py-2 font-medium text-bht-ink-strong transition-colors duration-150 hover:bg-bht-paper cursor-pointer"
                >
                  <span>Densidad visual</span>
                  <span className="rounded-md border border-bht-cobalt/20 bg-bht-cobalt-bg px-2 py-0.5 text-xs font-semibold text-bht-cobalt-strong">
                    {density === "compact" ? "Compacto" : "Cómodo"}
                  </span>
                </button>
                <Link
                  href="/change-password"
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 py-2 font-medium text-bht-ink-strong transition-colors duration-150 hover:bg-bht-paper"
                >
                  <LockIcon className="h-4 w-4 text-bht-ink-soft" />
                  <span>Cambiar contraseña</span>
                </Link>
                <div className="my-1 border-t border-bht-line" />
                <button
                  type="button"
                  onClick={onLogout}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 py-2 font-semibold text-bht-danger transition-colors duration-150 hover:bg-bht-danger-bg cursor-pointer"
                >
                  <LogOutIcon className="h-4 w-4" />
                  <span>Cerrar sesión</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

export function DesktopTabBar<T extends string>({
  items,
  activeId,
  onChange,
  className = "",
}: {
  items: NavTabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  const hasDisplayOverride =
    /(?:^|\s)(?:hidden|block|inline-block|flex|inline-flex|grid)(?:\s|$)/.test(
      className
    );
  const displayClass = hasDisplayOverride ? "" : "flex";
  return (
    <nav
      aria-label="Secciones principales"
      className={`${displayClass} items-center gap-1 overflow-x-auto no-scrollbar rounded-xl border border-[var(--border-hairline)] bg-white p-1.5 shadow-xs ${className}`}
    >
      {items.map((item) => {
        const active = activeId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onChange(item.id)}
            className={`flex flex-shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt focus-visible:ring-offset-1 cursor-pointer ${
              active
                ? "border border-bht-cobalt/25 bg-bht-cobalt-bg text-bht-cobalt-strong font-bold shadow-2xs"
                : "border border-transparent text-bht-ink-soft hover:bg-bht-mist hover:text-bht-ink-strong"
            }`}
          >
            <span
              className={active ? "text-bht-cobalt" : "text-bht-ink-soft"}
              aria-hidden="true"
            >
              {item.icon}
            </span>
            <span>{item.label}</span>
            {item.badgeCount !== undefined && item.badgeCount > 0 && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums leading-none ${
                  active
                    ? "bg-bht-cobalt text-white"
                    : "bg-bht-cobalt-bg text-bht-ink-soft"
                }`}
              >
                {item.badgeCount}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

export function BottomNav<T extends string>({
  items,
  activeId,
  onChange,
  maxWidth = "2xl",
  className = "",
  visibleCount = 4,
  extraActions,
}: {
  items: NavTabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  maxWidth?: "2xl" | "full";
  className?: string;
  visibleCount?: number;
  extraActions?: NavExtraAction[];
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const popoverId = useId();
  const popoverRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const widthClass = maxWidth === "2xl" ? "max-w-2xl" : "max-w-full";
  const primaryItems = items.slice(0, visibleCount);
  const extraItems = items.slice(visibleCount);
  const selectedExtra = extraItems.find((item) => item.id === activeId);

  function closeMorePopover() {
    setMoreOpen(false);
    const pop = popoverRef.current as
      (HTMLDivElement & { hidePopover?: () => void }) | null;
    if (pop && typeof pop.hidePopover === "function") {
      try {
        pop.hidePopover();
      } catch {
        // Ignore if already closed
      }
    }
  }

  return (
    <nav
      aria-label="Navegación inferior"
      className={`bottom-bar fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--border-hairline)] bg-white/95 backdrop-blur-md shadow-bht-elev-3 ${className}`}
    >
      <div className={`mx-auto flex ${widthClass} items-stretch gap-1 pt-1.5`}>
        {primaryItems.map((item) => {
          const active = activeId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onChange(item.id)}
              className={`relative flex min-w-0 flex-1 min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl py-1.5 px-1 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt cursor-pointer ${
                active
                  ? "text-bht-cobalt-strong"
                  : "text-bht-ink-soft hover:text-bht-ink-strong"
              }`}
            >
              <div
                className={`relative flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-150 ${
                  active
                    ? "bg-bht-cobalt-bg text-bht-cobalt-strong ring-1 ring-bht-cobalt/20"
                    : ""
                }`}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.badgeCount !== undefined && item.badgeCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-bht-navy-deep px-1 text-[10px] font-bold text-white tabular-nums">
                    {item.badgeCount > 99 ? "99+" : item.badgeCount}
                  </span>
                )}
              </div>
              <span className="truncate max-w-full leading-tight">
                {item.mobileLabel || item.label}
              </span>
            </button>
          );
        })}
        {(extraItems.length > 0 || (extraActions && extraActions.length > 0)) && (
          <div className="relative flex min-w-0 flex-1">
            <div
              ref={popoverRef}
              id={popoverId}
              popover="auto"
              onToggle={(e) => {
                const evt = e as React.SyntheticEvent<HTMLDivElement> & {
                  newState?: string;
                };
                if (evt.newState) {
                  setMoreOpen(evt.newState === "open");
                }
              }}
              className="fixed inset-x-3 bottom-20 z-50 mx-auto w-auto max-w-sm rounded-xl border border-bht-slate-line bg-white p-1.5 shadow-bht-elev-17"
            >
              {extraItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={activeId === item.id ? "page" : undefined}
                  onClick={() => {
                    onChange(item.id);
                    closeMorePopover();
                    moreButtonRef.current?.focus();
                  }}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt-vivid ${
                    activeId === item.id
                      ? "bg-bht-cobalt-bg text-bht-cobalt-strong"
                      : "text-bht-slate-text hover:bg-bht-surface-cool"
                  }`}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.badgeCount !== undefined && item.badgeCount > 0 && (
                    <span className="tabular-nums">
                      {item.badgeCount > 99 ? "99+" : item.badgeCount}
                    </span>
                  )}
                </button>
              ))}
              {extraActions && extraActions.length > 0 && (
                <div
                  className={
                    extraItems.length > 0
                      ? "mt-1.5 border-t border-bht-slate-line pt-1.5"
                      : ""
                  }
                >
                  {extraActions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => {
                        closeMorePopover();
                        action.onClick();
                      }}
                      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-bht-navy-deep hover:bg-bht-surface-cool focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt-vivid cursor-pointer"
                    >
                      <span aria-hidden="true">{action.icon}</span>
                      <span className="flex-1">{action.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              ref={moreButtonRef}
              type="button"
              popoverTarget={popoverId}
              aria-expanded={moreOpen}
              aria-label={
                selectedExtra
                  ? `Más secciones, actual: ${selectedExtra.label}`
                  : "Más secciones"
              }
              className={`flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt-vivid cursor-pointer ${
                selectedExtra || moreOpen
                  ? "text-bht-cobalt-strong"
                  : "text-bht-slate-text"
              }`}
            >
              <span
                className={`flex h-7 w-12 items-center justify-center rounded-full text-lg leading-none ${
                  selectedExtra || moreOpen
                    ? "bg-bht-cobalt-bg ring-1 ring-bht-info-line"
                    : ""
                }`}
                aria-hidden="true"
              >
                ···
              </span>
              <span className="max-w-full truncate">
                {selectedExtra?.mobileLabel || "Más"}
              </span>
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

export function AppMain({
  children,
  maxWidth = "2xl",
  className = "",
  withSidebar = false,
}: {
  children: React.ReactNode;
  maxWidth?: "xl" | "2xl" | "5xl" | "6xl" | "7xl";
  className?: string;
  withSidebar?: boolean;
}) {
  const widthClass =
    maxWidth === "xl"
      ? "max-w-xl"
      : maxWidth === "5xl"
        ? "max-w-5xl"
        : maxWidth === "6xl"
          ? "max-w-6xl"
          : maxWidth === "7xl"
            ? "max-w-7xl"
            : "max-w-2xl";
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={`mx-auto ${widthClass} px-3.5 pt-4 sm:px-5 outline-none ${withSidebar ? "md:ml-[232px] md:max-w-none md:px-6 lg:px-8" : ""} ${className}`}
    >
      {children}
    </main>
  );
}
