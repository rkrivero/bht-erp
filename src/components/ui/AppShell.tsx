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
        <HorizonLogo className="h-10 w-10 flex-none rounded-xl ring-1 ring-white/20" />
        <div className="min-w-0">
          <p className="text-sm font-bold leading-tight">Blue Horizon Trade</p>
          <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--bht-sky)]">
            {areaLabel}
          </p>
        </div>
      </div>
      <nav aria-label="Secciones principales" className="grid gap-1">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onChange(item.id)}
              className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                active
                  ? "bg-white text-[var(--bht-navy)]"
                  : "text-[var(--bht-sky)] hover:bg-white/10 hover:text-white"
              }`}
            >
              <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center">
                {item.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.badgeCount !== undefined && item.badgeCount > 0 && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] tabular-nums ${active ? "bg-[var(--bht-sky)]" : "bg-white/10 text-white"}`}>
                  {item.badgeCount > 99 ? "99+" : item.badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      {footer && <div className="mt-auto border-t border-white/15 px-2 pt-4 text-xs text-[var(--bht-sky)]">{footer}</div>}
    </aside>
  );
}

const SYNC_STATUS_CONFIG: Record<
  LiveSyncStatus,
  { label: string; dotClass: string; pillClass: string }
> = {
  live: {
    label: "En vivo",
    dotClass: "bg-[#15803D]",
    pillClass: "border-[#E2E8F0] bg-[#F8FAFC] text-[#0B192C]",
  },
  syncing: {
    label: "Sincronizando",
    dotClass: "bg-[#075EE8] animate-pulse",
    pillClass: "border-[#E2E8F0] bg-[#F8FAFC] text-[#0B192C]",
  },
  paused: {
    label: "En pausa",
    dotClass: "bg-[#6D6A64]",
    pillClass: "border-[#E7E5E0] bg-[#F4F3EF] text-[#5C5A55]",
  },
  offline: {
    label: "Sin conexión",
    dotClass: "bg-[#B45309]",
    pillClass: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]",
  },
};

export function AppHeader({
  title,
  roleLabel,
  roleTone = "horizon",
  roleDotColor = "bg-[#15803D]",
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

  const syncCfg = syncStatus ? SYNC_STATUS_CONFIG[syncStatus] : null;

  return (
    <header className={`sticky top-0 z-30 border-b border-[var(--border-hairline)] bg-white/95 backdrop-blur-md ${withSidebar ? "md:ml-[232px]" : ""}`}>
      <div
        className={`mx-auto grid ${widthClass} grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-2 px-3.5 py-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-5`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <HorizonLogo className="h-9 w-9 flex-shrink-0 rounded-xl shadow-xs" />
          <div className="min-w-0 flex-1">
            <h1 className="line-clamp-2 text-sm font-semibold leading-tight tracking-[-0.02em] text-[#0B192C] min-[380px]:text-base sm:truncate sm:text-lg">
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
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-4 whitespace-nowrap transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#075EE8] cursor-pointer ${syncCfg.pillClass}`}
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
                <span className="hidden truncate text-xs font-medium text-[#5C5A55] sm:inline">
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
      className={`${displayClass} items-center gap-1 overflow-x-auto no-scrollbar rounded-xl border border-[#E2E8F0] bg-white p-1.5 ${className}`}
    >
      {items.map((item) => {
        const active = activeId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onChange(item.id)}
            className={`flex flex-shrink-0 items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#075EE8] focus-visible:ring-offset-1 cursor-pointer ${
              active
                ? "border-[#B9D3FA] bg-[#EAF2FE] text-[#075EE8]"
                : "border-transparent text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0B192C]"
            }`}
          >
            <span
              className={active ? "text-[#075EE8]" : "text-[#475569]"}
              aria-hidden="true"
            >
              {item.icon}
            </span>
            <span>{item.label}</span>
            {item.badgeCount !== undefined && item.badgeCount > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none ${
                  active ? "bg-[#075EE8] text-white" : "bg-[#F8FAFC] text-[#475569]"
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
}: {
  items: NavTabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  maxWidth?: "2xl" | "full";
  className?: string;
  visibleCount?: number;
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
      className={`bottom-bar fixed bottom-0 left-0 right-0 z-30 border-t border-[#E2E8F0] bg-white/95 backdrop-blur-md ${className}`}
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
              className={`relative flex min-w-0 flex-1 min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl py-1.5 px-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942] cursor-pointer ${
                active ? "text-[#0062FF]" : "text-[#475569] hover:text-[#0B192C]"
              }`}
            >
              <div
                className={`relative flex h-7 w-12 items-center justify-center rounded-full transition ${
                  active
                    ? "bg-[#EAF2FF] text-[#0062FF] ring-1 ring-[#BFDBFE]"
                    : ""
                }`}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.badgeCount !== undefined && item.badgeCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0F2942] px-1 text-[10px] font-bold text-white tabular-nums">
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
        {extraItems.length > 0 && (
          <div ref={moreRef} className="relative flex min-w-0 flex-1">
            {moreOpen && (
              <div className="absolute bottom-full right-0 mb-3 w-56 rounded-xl border border-[#E2E8F0] bg-white p-1.5 shadow-lg">
                {extraItems.map((item) => (
                  <button key={item.id} type="button" aria-current={activeId === item.id ? "page" : undefined}
                    onClick={() => { onChange(item.id); setMoreOpen(false); moreButtonRef.current?.focus(); }}
                    className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0062FF] ${activeId === item.id ? "bg-[#EAF2FF] text-[#0052D4]" : "text-[#475569] hover:bg-[#F8FAFC]"}`}>
                    <span aria-hidden="true">{item.icon}</span><span className="flex-1">{item.label}</span>
                    {item.badgeCount !== undefined && item.badgeCount > 0 && <span className="tabular-nums">{item.badgeCount > 99 ? "99+" : item.badgeCount}</span>}
                  </button>
                ))}
              </div>
            )}
            <button ref={moreButtonRef} type="button" aria-expanded={moreOpen}
              aria-label={selectedExtra ? `Más secciones, actual: ${selectedExtra.label}` : "Más secciones"}
              onClick={() => setMoreOpen((open) => !open)}
              className={`flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0062FF] ${selectedExtra || moreOpen ? "text-[#0052D4]" : "text-[#475569]"}`}>
              <span className={`flex h-7 w-12 items-center justify-center rounded-full text-lg leading-none ${selectedExtra || moreOpen ? "bg-[#EAF2FF] ring-1 ring-[#BFDBFE]" : ""}`} aria-hidden="true">···</span>
              <span className="max-w-full truncate">{selectedExtra?.mobileLabel || "Más"}</span>
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
