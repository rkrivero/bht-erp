"use client";

import React, { useEffect, useRef, useState } from "react";
import { HorizonLogo, LogOutIcon } from "./Icons";
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
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[232px] flex-col bg-[var(--bht-navy)] px-3.5 py-5 text-white md:flex">
      <div className="flex items-center gap-3 px-2 pb-6">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-[var(--bht-paper)] p-1">
          <HorizonLogo className="h-full w-full" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold leading-tight">Blue Horizon Trade</p>
          <p className="mt-1 truncate text-xs font-semibold uppercase tracking-[0.04em] text-[var(--bht-sky)]">
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
                  className={`px-3 pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--bht-sky)] ${
                    idx === 0 ? "pt-0" : "pt-3"
                  }`}
                >
                  {item.group}
                </p>
              )}
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onChange(item.id)}
                className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer ${
                  active
                    ? "bg-white text-[var(--bht-navy)]"
                    : "text-[var(--bht-sky)] hover:bg-white/10 hover:text-white"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="flex h-5 w-5 items-center justify-center"
                >
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.badgeCount !== undefined && item.badgeCount > 0 && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] tabular-nums ${active ? "bg-[var(--bht-sky)]" : "bg-white/10 text-white"}`}
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
        <div className="mt-auto border-t border-white/15 px-2 pt-4 text-xs text-[var(--bht-sky)]">
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
    label: "Sincronizado",
    dotClass: "bg-bht-success",
    pillClass: "border-bht-slate-line bg-bht-surface-cool text-bht-ink-deep",
  },
  syncing: {
    label: "Sincronizando",
    dotClass: "bg-bht-cobalt animate-pulse",
    pillClass: "border-bht-slate-line bg-bht-surface-cool text-bht-ink-deep",
  },
  paused: {
    label: "En pausa",
    dotClass: "bg-bht-ink-muted",
    pillClass: "border-bht-line bg-bht-paper-alt text-bht-ink-soft",
  },
  offline: {
    label: "Sin conexión",
    dotClass: "bg-bht-warning",
    pillClass: "border-bht-warning-line bg-bht-warning-bg text-bht-warning-strong",
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
  withSidebar?: boolean;
}) {
  const [displaySyncStatus, setDisplaySyncStatus] = useState(syncStatus);

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
        className={`mx-auto grid ${widthClass} grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-2 px-3.5 py-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-5`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center">
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

        <div className="ml-auto flex min-w-0 flex-shrink-0 flex-wrap items-center justify-end gap-2">
          {actions}
          <Button
            variant="outline"
            size="sm"
            onClick={onLogout}
            aria-label="Salir y cerrar sesión"
            className="min-h-[38px] sm:min-h-[40px] rounded-xl px-3.5 text-xs sm:text-sm"
          >
            <LogOutIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Salir</span>
          </Button>
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
      className={`${displayClass} items-center gap-1 overflow-x-auto no-scrollbar rounded-xl border border-bht-slate-line bg-white p-1.5 ${className}`}
    >
      {items.map((item) => {
        const active = activeId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onChange(item.id)}
            className={`flex flex-shrink-0 items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt focus-visible:ring-offset-1 cursor-pointer ${
              active
                ? "border-bht-tone-b9d3fa bg-bht-tone-eaf2fe text-bht-cobalt"
                : "border-transparent text-bht-slate-text hover:bg-bht-surface-cool hover:text-bht-ink-deep"
            }`}
          >
            <span
              className={active ? "text-bht-cobalt" : "text-bht-slate-text"}
              aria-hidden="true"
            >
              {item.icon}
            </span>
            <span>{item.label}</span>
            {item.badgeCount !== undefined && item.badgeCount > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none ${
                  active
                    ? "bg-bht-cobalt text-white"
                    : "bg-bht-surface-cool text-bht-slate-text"
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
  const moreRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const widthClass = maxWidth === "2xl" ? "max-w-2xl" : "max-w-full";
  const primaryItems = items.slice(0, visibleCount);
  const extraItems = items.slice(visibleCount);
  const selectedExtra = extraItems.find((item) => item.id === activeId);
  useEffect(() => {
    if (!moreOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [moreOpen]);
  return (
    <nav
      aria-label="Navegación inferior"
      className={`bottom-bar fixed bottom-0 left-0 right-0 z-30 border-t border-bht-slate-line bg-white/95 backdrop-blur-md ${className}`}
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
              className={`relative flex min-w-0 flex-1 min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl py-1.5 px-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep cursor-pointer ${
                active
                  ? "text-bht-cobalt-vivid"
                  : "text-bht-slate-text hover:text-bht-ink-deep"
              }`}
            >
              <div
                className={`relative flex h-7 w-12 items-center justify-center rounded-full transition ${
                  active
                    ? "bg-bht-cobalt-bg text-bht-cobalt-vivid ring-1 ring-bht-info-line"
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
          <div ref={moreRef} className="relative flex min-w-0 flex-1">
            {moreOpen && (
              <div className="absolute bottom-full right-0 mb-3 w-56 rounded-xl border border-bht-slate-line bg-white p-1.5 shadow-lg">
                {extraItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={activeId === item.id ? "page" : undefined}
                    onClick={() => {
                      onChange(item.id);
                      setMoreOpen(false);
                      moreButtonRef.current?.focus();
                    }}
                    className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt-vivid ${activeId === item.id ? "bg-bht-cobalt-bg text-bht-cobalt-strong" : "text-bht-slate-text hover:bg-bht-surface-cool"}`}
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
                          setMoreOpen(false);
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
            )}
            <button
              ref={moreButtonRef}
              type="button"
              aria-expanded={moreOpen}
              aria-label={
                selectedExtra
                  ? `Más secciones, actual: ${selectedExtra.label}`
                  : "Más secciones"
              }
              onClick={() => setMoreOpen((open) => !open)}
              className={`flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt-vivid ${selectedExtra || moreOpen ? "text-bht-cobalt-strong" : "text-bht-slate-text"}`}
            >
              <span
                className={`flex h-7 w-12 items-center justify-center rounded-full text-lg leading-none ${selectedExtra || moreOpen ? "bg-bht-cobalt-bg ring-1 ring-bht-info-line" : ""}`}
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
