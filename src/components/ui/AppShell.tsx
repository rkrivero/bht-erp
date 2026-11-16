"use client";

import React from "react";
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

const SYNC_STATUS_CONFIG: Record<
  LiveSyncStatus,
  { label: string; dotClass: string; pillClass: string }
> = {
  live: {
    label: "En vivo",
    dotClass: "bg-[#15803D]",
    pillClass: "border-[#D4E0EC] bg-[#EDF3F8] text-[#0F2942]",
  },
  syncing: {
    label: "Sincronizando",
    dotClass: "bg-[#1E446B] animate-pulse",
    pillClass: "border-[#D4E0EC] bg-[#EDF3F8] text-[#0F2942]",
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
    <header className="sticky top-0 z-30 border-b border-[#E7E5E0] bg-[#FAF9F6]/95 backdrop-blur-md">
      <div
        className={`mx-auto flex ${widthClass} flex-wrap items-center justify-between gap-3 px-3.5 py-3 sm:px-5`}
      >
        <div className="flex min-w-[min(100%,14rem)] flex-1 items-center gap-3">
          <HorizonLogo className="h-9 w-9 flex-shrink-0 rounded-xl shadow-xs" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base sm:text-lg font-semibold tracking-tight text-[#0F2942] leading-tight">
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
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942] cursor-pointer ${syncCfg.pillClass}`}
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
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap ${syncCfg.pillClass}`}
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

        <div className="ml-auto flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
          {actions}
          <Button
            variant="outline"
            size="sm"
            onClick={onLogout}
            aria-label="Cerrar sesión"
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
      className={`${displayClass} items-center gap-1 overflow-x-auto no-scrollbar rounded-2xl border border-[#E7E5E0] bg-white p-1.5 shadow-[0_1px_2px_rgba(24,24,27,0.03)] ${className}`}
    >
      {items.map((item) => {
        const active = activeId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onChange(item.id)}
            className={`flex flex-shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942] focus-visible:ring-offset-1 cursor-pointer ${
              active
                ? "border-[#D4E0EC] bg-[#EDF3F8] text-[#0F2942] shadow-[0_1px_2px_rgba(15,41,66,0.06)]"
                : "border-transparent text-[#5C5A55] hover:bg-[#F2F6FA]/70 hover:text-[#0F2942]"
            }`}
          >
            <span
              className={active ? "text-[#0F2942]" : "text-[#6D6A64]"}
              aria-hidden="true"
            >
              {item.icon}
            </span>
            <span>{item.label}</span>
            {item.badgeCount !== undefined && item.badgeCount > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none ${
                  active
                    ? "bg-[#0F2942] text-white"
                    : "bg-[#F4F3EF] text-[#18181B]"
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
}: {
  items: NavTabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  maxWidth?: "2xl" | "full";
  className?: string;
}) {
  const widthClass = maxWidth === "2xl" ? "max-w-2xl" : "max-w-full";
  return (
    <nav
      aria-label="Navegación inferior"
      className={`bottom-bar fixed bottom-0 left-0 right-0 z-30 border-t border-[#D4E0EC]/80 bg-[#FAF9F6]/94 backdrop-blur-md ${className}`}
    >
      <div className={`mx-auto flex ${widthClass} items-stretch gap-1 pt-1.5`}>
        {items.map((item) => {
          const active = activeId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onChange(item.id)}
              className={`relative flex min-w-0 flex-1 min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl py-1.5 px-1 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942] cursor-pointer ${
                active
                  ? "text-[#0F2942]"
                  : "text-[#5C5A55] hover:text-[#0F2942]"
              }`}
            >
              <div
                className={`relative flex h-7 w-12 items-center justify-center rounded-full transition ${
                  active
                    ? "bg-[#E7EFF7] text-[#0F2942] ring-1 ring-[#D4E0EC] shadow-[0_1px_2px_rgba(15,41,66,0.06)]"
                    : ""
                }`}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.badgeCount !== undefined && item.badgeCount > 0 && (
                  <span
                    className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0F2942] px-1 text-[9px] font-bold text-white tabular-nums"
                  >
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
      </div>
    </nav>
  );
}

export function AppMain({
  children,
  maxWidth = "2xl",
  className = "",
}: {
  children: React.ReactNode;
  maxWidth?: "xl" | "2xl" | "5xl" | "6xl" | "7xl";
  className?: string;
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
      className={`mx-auto ${widthClass} px-3.5 pt-4 sm:px-5 outline-none ${className}`}
    >
      {children}
    </main>
  );
}
