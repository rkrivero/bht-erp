"use client";

import React, { useEffect, useId, useRef } from "react";
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
  default: "border-bht-slate-line bg-white",
  subtle: "border-bht-slate-line bg-bht-surface-cool",
  horizon: "border-bht-slate-line bg-bht-surface-cool",
  brand: "border-bht-info-line bg-bht-surface-cool",
  success: "border-bht-success-line bg-bht-tone-f5fbf7",
  warning: "border-bht-amber-line bg-bht-amber-bg",
  danger: "border-bht-danger-line bg-bht-tone-fef6f6",
  indigo: "border-bht-tone-c7d2fe bg-bht-tone-f6f7ff",
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
        ? "p-3"
        : padding === "lg"
          ? "p-5 sm:p-6"
          : "p-4";
  const accentClass =
    accent === "horizon" ? "border-bht-tone-cbd9e7 shadow-bht-elev-3" : "";
  return (
    <section
      className={`min-w-0 rounded-2xl border shadow-bht-elev-4 ${CARD_TONE_CLASSES[tone]} ${accentClass} ${padClass} ${className}`}
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
  neutral: "border-bht-slate-line bg-bht-surface-cool text-bht-slate-text",
  obsidian: "border-bht-ink-strong bg-bht-ink-strong text-white",
  horizon: "border-bht-slate-line bg-bht-surface-cool text-bht-ink-deep",
  brand: "border-bht-info-line bg-bht-cobalt-bg text-bht-cobalt-strong",
  success: "border-bht-tone-dcfce7 bg-bht-success-bg text-bht-success",
  warning: "border-bht-warning-line bg-bht-warning-bg text-bht-warning",
  danger: "border-bht-tone-fee2e2 bg-bht-danger-bg text-bht-danger",
  indigo: "border-bht-tone-e0e7ff bg-bht-tone-eef2ff text-bht-tone-4338ca",
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
      className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-4 ${
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
  "primary" | "brand" | "secondary" | "outline" | "ghost" | "success" | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-bht-cobalt text-white hover:bg-bht-tone-064fc3 shadow-bht-elev-5",
  brand: "bg-bht-navy-soft text-white hover:bg-bht-ink-deep shadow-bht-elev-6",
  secondary:
    "bg-bht-surface-cool text-bht-ink-deep border border-bht-slate-line hover:bg-bht-cobalt-bg",
  outline:
    "bg-white text-bht-ink-deep border border-bht-slate-line hover:bg-bht-surface-cool shadow-bht-elev-7",
  ghost:
    "bg-transparent text-bht-slate-text hover:bg-bht-surface-cool hover:text-bht-ink-deep",
  success: "bg-bht-success text-white hover:bg-bht-success-strong shadow-bht-elev-8",
  danger: "bg-bht-danger-vivid text-white hover:bg-bht-danger shadow-bht-elev-9",
};

const BUTTON_SIZES: Record<"sm" | "md" | "lg", string> = {
  sm: "px-3 py-1.5 text-xs rounded-lg",
  md: "px-4 py-2.5 text-xs sm:text-sm rounded-xl",
  lg: "px-5 py-3.5 text-sm rounded-xl",
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
      className={`${displayClass} items-center justify-center gap-2 font-semibold transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50 cursor-pointer ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${mobileTouchClass} ${className}`}
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
      className={`block text-xs font-medium text-bht-slate-text ${className}`}
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
  "w-full rounded-xl border border-bht-tone-cbd5e1 bg-white px-3.5 py-2.5 text-sm text-bht-ink-deep placeholder:text-bht-slate-muted transition focus:border-bht-cobalt focus:outline-none focus:ring-2 focus:ring-bht-cobalt/20 disabled:bg-bht-surface-cool disabled:text-bht-slate-muted";

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
      className={`flex gap-1 rounded-xl bg-bht-paper-alt p-1 border border-bht-line ${className}`}
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
            className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep focus-visible:ring-offset-1 cursor-pointer ${
              active
                ? "border-bht-line-blue bg-white text-bht-navy-deep shadow-bht-elev-10"
                : "border-transparent text-bht-ink-soft hover:text-bht-navy-deep"
            }`}
          >
            <span>{opt.label}</span>
            {opt.count !== undefined && (
              <span
                className={`ml-1.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                  active
                    ? "bg-bht-navy-deep text-white"
                    : "bg-bht-line text-bht-ink-soft"
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

export function ToastBanner({
  type,
  message,
  onDismiss,
  className = "",
}: {
  type: "ok" | "warn" | "err";
  message: string;
  onDismiss?: () => void;
  className?: string;
}) {
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
      <div className="flex items-start gap-2.5">
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
        <span>{message}</span>
      </div>
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-bht-navy-deep/35 backdrop-blur-[2px] sm:items-center sm:p-4"
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
        className={`flex max-h-[90dvh] w-full flex-col rounded-t-2xl sm:rounded-2xl border border-bht-line bg-white shadow-2xl outline-none ${widthClass}`}
      >
        <div
          className="mx-auto mt-2 h-1 w-10 rounded-full bg-bht-line-strong sm:hidden"
          aria-hidden="true"
        />
        <div className="flex items-start justify-between gap-3 border-b border-bht-line px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-sm sm:text-base font-semibold text-bht-ink-strong"
            >
              {title}
            </h2>
            {subtitle && (
              <p id={subtitleId} className="mt-0.5 text-xs text-bht-ink-soft">
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
      <p className="text-sm font-semibold text-bht-ink-strong">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-xs text-bht-ink-soft">{description}</p>
      )}
    </div>
  );
}
