"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { parseIsoTimestampMs } from "@/lib/undo-client";
import { AlertTriangleIcon, CheckIcon, CloseIcon } from "./Icons";

export type Tone =
  | "default"
  | "subtle"
  | "horizon"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "indigo";

const CARD_TONE_CLASSES: Record<Tone, string> = {
  default:
    "border-black/[0.06] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.02),0_6px_20px_-4px_rgba(28,33,39,0.035)] transition-all duration-300 ease-in-out",
  subtle:
    "border-black/[0.04] bg-[#f8fafc] shadow-[0_1px_2px_rgba(0,0,0,0.015)] transition-all duration-300 ease-in-out",
  horizon:
    "border-[#3373b0]/20 bg-[#f4f8fc] shadow-[0_2px_12px_rgba(51,115,176,0.04)] transition-all duration-300 ease-in-out",
  brand:
    "border-[#1c2127]/15 bg-[#f1f5f9] shadow-[0_2px_12px_rgba(28,33,39,0.04)] transition-all duration-300 ease-in-out",
  success: "border-emerald-500/15 bg-emerald-50/50 shadow-[0_1px_2px_rgba(0,0,0,0.01)] transition-all duration-300 ease-in-out",
  warning: "border-amber-500/15 bg-amber-50/50 shadow-[0_1px_2px_rgba(0,0,0,0.01)] transition-all duration-300 ease-in-out",
  danger: "border-rose-500/15 bg-rose-50/50 shadow-[0_1px_2px_rgba(0,0,0,0.01)] transition-all duration-300 ease-in-out",
  indigo: "border-[#1c2127]/15 bg-[#f1f5f9] shadow-[0_1px_2px_rgba(0,0,0,0.01)] transition-all duration-300 ease-in-out",
};

export function Card({
  children,
  tone = "default",
  accent = "none",
  padding = "md",
  className = "",
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  children: React.ReactNode;
  tone?: Tone;
  accent?: "none" | "horizon";
  padding?: "none" | "sm" | "md" | "lg";
  className?: string;
}) {
  const padClass =
    padding === "none"
      ? ""
      : padding === "sm"
        ? "p-4 sm:p-5"
        : padding === "lg"
          ? "p-8 sm:p-12"
          : "p-6 sm:p-8";
  const accentClass =
    accent === "horizon"
      ? "border-[#3373b0]/35 shadow-[0_4px_20px_rgba(51,115,176,0.08)] ring-1 ring-[#3373b0]/15"
      : "";
  return (
    <section
      className={`min-w-0 rounded-2xl border ${CARD_TONE_CLASSES[tone]} ${accentClass} ${padClass} ${className}`}
      {...props}
    >
      {children}
    </section>
  );
}

export type BadgeTone =
  | "neutral"
  | "obsidian"
  | "horizon"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "indigo";

const BADGE_CLASSES: Record<BadgeTone, string> = {
  neutral: "border-black/[0.06] bg-[#f1f5f9] text-[#1c2127]",
  obsidian: "border-[#1c2127] bg-[#1c2127] text-white shadow-xs",
  horizon: "border-[#3373b0]/25 bg-[#e7f1fb] text-[#3373b0]",
  brand: "border-[#1c2127]/20 bg-[#f1f5f9] text-[#1c2127]",
  success: "border-emerald-600/20 bg-emerald-50 text-emerald-800",
  warning: "border-amber-600/20 bg-amber-50 text-amber-900",
  danger: "border-rose-600/20 bg-rose-50 text-rose-800",
  indigo: "border-[#1c2127]/20 bg-[#f1f5f9] text-[#1c2127]",
};

export function Badge({
  children,
  tone = "neutral",
  dotColor,
  className = "",
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  dotColor?: string;
  className?: string;
}) {
  const hasCustomWrap = /\bwhitespace-(?:normal|pre-wrap|break-spaces)\b/.test(
    className
  );
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium leading-4 transition-all duration-300 ease-in-out ${
        hasCustomWrap ? "" : "whitespace-nowrap"
      } ${BADGE_CLASSES[tone]} ${className}`}
    >
      {dotColor && (
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} aria-hidden="true" />
      )}
      {children}
    </span>
  );
}

export type ButtonVariant =
  | "primary" | "brand" | "secondary" | "outline" | "ghost" | "success" | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[#3373b0] text-white hover:bg-[#285d8f] shadow-[0_1px_2px_rgba(0,0,0,0.08),0_2px_8px_rgba(51,115,176,0.25)] transition-all duration-300 ease-in-out active:scale-[0.985]",
  brand:
    "bg-[#1c2127] text-white hover:bg-[#0b385f] shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-all duration-300 ease-in-out active:scale-[0.985]",
  secondary:
    "bg-white text-[#1c2127] border border-black/[0.08] hover:bg-[#f8fafc] hover:border-black/[0.14] hover:text-[#1c2127] active:scale-[0.985] shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all duration-300 ease-in-out",
  outline:
    "bg-white text-[#1c2127] border border-black/[0.08] hover:border-[#3373b0] hover:text-[#3373b0] hover:bg-[#e7f1fb]/50 active:scale-[0.985] shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all duration-300 ease-in-out",
  ghost:
    "bg-transparent text-[#5a6578] hover:bg-black/[0.04] hover:text-[#1c2127] active:scale-[0.985] transition-all duration-300 ease-in-out",
  success:
    "bg-emerald-600 text-white hover:bg-emerald-700 shadow-[0_1px_2px_rgba(0,0,0,0.08)] active:scale-[0.985] transition-all duration-300 ease-in-out",
  danger:
    "bg-[#dc2626] text-white hover:bg-[#b91c1c] shadow-[0_1px_2px_rgba(0,0,0,0.08)] active:scale-[0.985] transition-all duration-300 ease-in-out",
};

const BUTTON_SIZES: Record<"sm" | "md" | "lg", string> = {
  sm: "px-3 py-1.5 text-xs rounded-[10px]",
  md: "px-4 py-2.5 text-sm rounded-xl",
  lg: "px-5 py-3 text-sm rounded-xl",
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  compact = false,
  className = "",
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  compact?: boolean;
}) {
  const isCompact =
    compact ||
    (props as Record<string, unknown>)["data-compact"] === "true" ||
    (props as Record<string, unknown>)["data-compact"] === true;
  const mobileTouchClass =
    size === "sm" && !isCompact ? "min-h-[36px] sm:min-h-[32px]" : "";
  const hasDisplayOverride =
    /(?:^|\s)(?:hidden|block|inline-block|flex|inline-flex|grid|inline-grid)(?:\s|$)/.test(
      className
    );
  const displayClass = hasDisplayOverride ? "" : "inline-flex";
  return (
    <button
      type={type}
      data-compact={isCompact ? "true" : undefined}
      className={`${displayClass} items-center justify-center gap-2 font-semibold transition-all duration-120 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bht-cobalt)] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50 cursor-pointer ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${mobileTouchClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function FieldLabel({
  htmlFor,
  children,
  required,
  className = "",
}: {
  htmlFor?: string;
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={`block text-xs sm:text-sm font-semibold text-[var(--bht-steel)] ${className}`}
    >
      {children}
      {required && (
        <span className="ml-0.5 text-bht-danger" aria-hidden="true">
          *
        </span>
      )}
    </label>
  );
}

export const INPUT_CLASS =
  "min-h-11 w-full rounded-xl border border-black/[0.08] bg-white px-4 py-2.5 text-sm text-[#1c2127] placeholder:text-[#8c98a9] shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all duration-300 ease-in-out hover:border-black/[0.16] focus:border-[#3373b0] focus:outline-none focus:ring-4 focus:ring-[#3373b0]/10 disabled:bg-[#f1f5f9] disabled:text-[#8c98a9] disabled:border-black/[0.05]";

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel = "Opciones",
  className = "",
}: {
  options: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (val: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hasMatch = options.some((o) => o.id === value);

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, idx: number) {
    if (options.length === 0) return;
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextIdx = (idx + 1) % options.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIdx = (idx - 1 + options.length) % options.length;
    } else if (e.key === "Home") {
      nextIdx = 0;
    } else if (e.key === "End") {
      nextIdx = options.length - 1;
    }
    if (nextIdx !== null) {
      e.preventDefault();
      onChange(options[nextIdx].id);
      btnRefs.current[nextIdx]?.focus();
    }
  }

  return (
    <div
      className={`no-scrollbar flex min-w-0 max-w-full gap-1 overflow-x-auto rounded-xl border border-black/[0.06] bg-[#f1f5f9] p-1.5 transition-all duration-300 ease-in-out ${className}`}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((opt, idx) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            ref={(el) => {
              btnRefs.current[idx] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active || (!hasMatch && idx === 0) ? 0 : -1}
            onClick={() => onChange(opt.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`min-h-10 min-w-max flex-1 shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-semibold leading-tight transition-all duration-300 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3373b0] focus-visible:ring-offset-1 sm:text-sm cursor-pointer ${
              active
                ? "border border-black/[0.06] bg-white text-[#1c2127] font-semibold shadow-sm"
                : "border border-transparent bg-transparent text-[#5a6578] hover:text-[#1c2127] hover:bg-white/60"
            }`}
          >
            <span className="whitespace-nowrap">{opt.label}</span>
            {opt.count !== undefined && (
              <span
                className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
                  active
                    ? "bg-[#1c2127] text-white"
                    : "bg-black/[0.06] text-[#5a6578]"
                }`}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface ToastBannerAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  expiresAt?: string;
  windowSeconds?: number;
  showCountdown?: boolean;
}

function formatToastCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function ToastBanner({
  type,
  message,
  action,
  onDismiss,
  className = "",
}: {
  type: "ok" | "warn" | "err";
  message: string;
  action?: ToastBannerAction;
  onDismiss?: () => void;
  className?: string;
}) {
  const [anchorDeadlineMs, setAnchorDeadlineMs] = useState<number>(() => {
    if (action?.windowSeconds && action.windowSeconds > 0) {
      return Date.now() + action.windowSeconds * 1000;
    }
    return action?.expiresAt ? parseIsoTimestampMs(action.expiresAt) : Number.NaN;
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const parsedExpiresMs = action?.expiresAt
    ? parseIsoTimestampMs(action.expiresAt)
    : Number.NaN;
  const effectiveDeadlineMs =
    Number.isFinite(anchorDeadlineMs) && action?.windowSeconds
      ? anchorDeadlineMs
      : parsedExpiresMs;
  const trackCountdown = Boolean(
    action?.showCountdown && Number.isFinite(effectiveDeadlineMs)
  );

  useEffect(() => {
    const now = Date.now();
    setNowMs(now);
    if (action?.windowSeconds && action.windowSeconds > 0) {
      setAnchorDeadlineMs(now + action.windowSeconds * 1000);
    } else if (action?.expiresAt) {
      setAnchorDeadlineMs(parseIsoTimestampMs(action.expiresAt));
    } else {
      setAnchorDeadlineMs(Number.NaN);
    }
  }, [action?.expiresAt, action?.windowSeconds]);

  useEffect(() => {
    if (!trackCountdown) return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [trackCountdown]);

  const remainingSeconds = trackCountdown
    ? Math.max(0, Math.ceil((effectiveDeadlineMs - nowMs) / 1000))
    : null;
  const showActionButton =
    Boolean(action) && (!trackCountdown || (remainingSeconds ?? 0) > 0);

  const styles =
    type === "ok"
      ? "border-bht-success-line bg-bht-success-bg text-bht-tone-14532d"
      : type === "warn"
        ? "border-bht-warning-line bg-bht-warning-bg text-bht-warning-text"
        : "border-bht-danger-line bg-bht-danger-bg text-bht-tone-7f1d1d";
  const isError = type === "err";

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
      className={`flex items-start justify-between gap-3 rounded-xl border px-3.5 py-3 text-xs sm:text-sm font-medium shadow-xs ${styles} ${className}`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-0.5 flex-shrink-0">
          {type === "ok" ? (
            <CheckIcon className="h-4 w-4 text-bht-success" />
          ) : (
            <AlertTriangleIcon
              className={`h-4 w-4 ${
                type === "warn" ? "text-bht-warning" : "text-bht-danger"
              }`}
            />
          )}
        </span>
        <span className="min-w-0 flex-1">{message}</span>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1.5">
        {showActionButton && action && (
          <button
            type="button"
            data-compact="true"
            disabled={action.disabled}
            onClick={action.onClick}
            className="inline-flex items-center gap-1.5 rounded-lg border border-bht-line bg-white/90 px-2.5 py-1 text-xs font-semibold text-bht-ink-strong shadow-xs transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep disabled:opacity-50 cursor-pointer"
          >
            <span>{action.label}</span>
            {trackCountdown && remainingSeconds !== null && (
              <span className="text-xs font-medium text-bht-ink-soft tabular-nums">
                ({formatToastCountdown(remainingSeconds)})
              </span>
            )}
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            data-compact="true"
            onClick={onDismiss}
            aria-label="Cerrar notificación"
            className="rounded-lg p-1 opacity-75 transition hover:bg-black/5 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep cursor-pointer"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export function ModalSheet({
  open,
  onClose,
  title,
  subtitle,
  maxWidth = "lg",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidth?: "md" | "lg" | "2xl";
  children: React.ReactNode;
}) {
  const titleId = useId();
  const subtitleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move focus into the dialog unless a child control already received autoFocus.
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      panel.focus({ preventScroll: true });
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key === "Tab" && panelRef.current) {
        const focusables = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);

        if (focusables.length === 0) {
          e.preventDefault();
          panelRef.current.focus();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (
            active === first ||
            active === panelRef.current ||
            !panelRef.current.contains(active)
          ) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !panelRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
      const prev = previousFocusRef.current;
      previousFocusRef.current = null;
      if (prev && prev.isConnected && typeof prev.focus === "function") {
        try {
          prev.focus({ preventScroll: true });
        } catch {
          // Ignore focus restoration errors if element became unfocusable.
        }
      }
    };
  }, [open]);

  if (!open) return null;

  const widthClass =
    maxWidth === "md"
      ? "sm:max-w-md"
      : maxWidth === "2xl"
        ? "sm:max-w-2xl"
        : "sm:max-w-lg";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-[3px] sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        className={`flex max-h-[90dvh] w-full flex-col rounded-t-2xl sm:rounded-2xl border border-black/[0.06] bg-white shadow-[0_12px_40px_-6px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.04)] outline-none ${widthClass}`}
      >
        <div
          className="mx-auto mt-2 h-1 w-10 rounded-full bg-bht-line-strong sm:hidden"
          aria-hidden="true"
        />
        <div className="flex items-start justify-between gap-3 border-b border-bht-line px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-base sm:text-lg font-bold text-bht-ink-strong"
            >
              {title}
            </h2>
            {subtitle && (
              <p
                id={subtitleId}
                className="mt-0.5 text-xs sm:text-sm text-bht-ink-soft"
              >
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            data-compact="true"
            onClick={() => onCloseRef.current()}
            aria-label="Cerrar"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-bht-ink-soft transition hover:bg-bht-mist hover:text-bht-navy-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep cursor-pointer"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:px-5 sm:pb-5">
          {children}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-bht-line-strong bg-white/70 px-6 py-10 text-center">
      {icon && (
        <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-full bg-bht-paper-alt text-bht-ink-soft">
          {icon}
        </div>
      )}
      <p className="text-base font-semibold text-bht-ink-strong">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-bht-ink-soft">{description}</p>
      )}
    </div>
  );
}
