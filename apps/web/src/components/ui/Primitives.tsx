"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { parseIsoTimestampMs } from "@/lib/undo-client";
import { AlertTriangleIcon, CheckIcon, CloseIcon } from "./Icons";

export type Tone =
  "default" | "subtle" | "horizon" | "brand" | "success" | "warning" | "danger";

const CARD_TONE_CLASSES: Record<Tone, string> = {
  default: "border-bht-line bg-white shadow-bht-elev-2 transition-colors duration-150",
  subtle: "border-bht-line bg-bht-paper shadow-none transition-colors duration-150",
  horizon:
    "border-bht-cobalt/25 bg-bht-cobalt-bg/55 shadow-none transition-colors duration-150",
  brand:
    "border-bht-navy-deep/15 bg-bht-mist shadow-none transition-colors duration-150",
  success:
    "border-bht-success-line bg-bht-success-bg/75 shadow-none transition-colors duration-150",
  warning:
    "border-bht-warning-line bg-bht-warning-bg/75 shadow-none transition-colors duration-150",
  danger:
    "border-bht-danger-line bg-bht-danger-bg/75 shadow-none transition-colors duration-150",
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
        ? "p-3.5 sm:p-4"
        : padding === "lg"
          ? "p-6 sm:p-8"
          : "p-[var(--card-pad,1.25rem)]";
  const accentClass =
    accent === "horizon"
      ? "border-bht-cobalt/30 shadow-bht-elev-3 ring-1 ring-bht-cobalt/10"
      : "";
  return (
    <section
      className={`bht-card-surface min-w-0 rounded-xl border ${CARD_TONE_CLASSES[tone]} ${accentClass} ${padClass} ${className}`}
      {...props}
    >
      {children}
    </section>
  );
}

export type BadgeTone =
  "neutral" | "obsidian" | "horizon" | "brand" | "success" | "warning" | "danger";

const BADGE_CLASSES: Record<BadgeTone, string> = {
  neutral: "border-bht-line bg-bht-mist text-bht-ink-strong",
  obsidian: "border-bht-navy-deep bg-bht-navy-deep text-white shadow-xs",
  horizon: "border-bht-cobalt/20 bg-bht-cobalt-bg text-bht-cobalt-strong",
  brand: "border-bht-navy-deep/20 bg-bht-mist text-bht-ink-strong",
  success: "border-bht-success-line bg-bht-success-bg text-bht-success-strong",
  warning: "border-bht-warning-line bg-bht-warning-bg text-bht-warning-strong",
  danger: "border-bht-danger-line bg-bht-danger-bg text-bht-danger-strong",
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
      className={`inline-flex flex-shrink-0 items-center gap-1.5 ${
        dotColor ? "rounded-full" : "rounded-md"
      } border px-2 py-0.5 text-[11px] font-medium tracking-[0.01em] leading-4 transition-colors duration-150 ${
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
  primary: "bg-bht-cobalt text-white hover:bg-bht-cobalt-strong shadow-xs",
  brand: "bg-bht-navy-deep text-white hover:bg-bht-navy-mid shadow-xs",
  secondary:
    "bg-white text-bht-ink-strong border border-bht-line hover:bg-bht-paper hover:border-bht-line-strong",
  outline:
    "bg-white text-bht-ink-strong border border-bht-line-strong/80 hover:border-bht-cobalt/50 hover:text-bht-cobalt-strong hover:bg-bht-cobalt-bg/35",
  ghost: "bg-transparent text-bht-ink-soft hover:bg-bht-mist hover:text-bht-ink-strong",
  success: "bg-bht-success text-white hover:bg-bht-success-strong shadow-xs",
  danger: "bg-bht-danger text-white hover:bg-bht-danger-strong shadow-xs",
};

const BUTTON_SIZES: Record<"sm" | "md" | "lg", string> = {
  sm: "px-2.5 py-1.5 text-xs rounded-lg",
  md: "px-3.5 py-2 text-sm rounded-lg",
  lg: "px-4 py-2.5 text-sm rounded-lg",
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
      className={`${displayClass} items-center justify-center gap-2 font-semibold transition-colors duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bht-cobalt)] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50 cursor-pointer ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${mobileTouchClass} ${className}`}
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
  "min-h-10 w-full rounded-lg border border-bht-line-strong/80 bg-white px-3 py-2 text-sm text-bht-ink-strong placeholder:text-bht-ink-muted shadow-none transition-colors duration-150 hover:border-bht-line-stronger focus:border-bht-cobalt focus:outline-none focus:ring-2 focus:ring-bht-cobalt/15 disabled:bg-bht-mist disabled:text-bht-ink-muted disabled:border-bht-line";

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
      className={`no-scrollbar flex min-w-0 max-w-full gap-1 overflow-x-auto rounded-lg border border-bht-line bg-bht-rail p-0.5 transition-colors duration-150 ${className}`}
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
            className={`min-h-9 min-w-max flex-1 shrink-0 rounded-md px-2.5 sm:px-3 py-1.5 text-xs font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt focus-visible:ring-offset-1 sm:text-sm cursor-pointer ${
              active
                ? "border border-bht-line bg-white text-bht-ink-deep font-semibold shadow-xs"
                : "border border-transparent bg-transparent text-bht-ink-soft hover:text-bht-ink-strong hover:bg-white/60"
            }`}
          >
            <span className="whitespace-nowrap">{opt.label}</span>
            {opt.count !== undefined && (
              <span
                className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
                  active
                    ? "bg-bht-cobalt-bg text-bht-cobalt-strong"
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
  floating = true,
  className = "",
}: {
  type: "ok" | "warn" | "err";
  message: string;
  action?: ToastBannerAction;
  onDismiss?: () => void;
  floating?: boolean;
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
      ? "border-bht-success-line bg-bht-success-bg text-bht-success-strong"
      : type === "warn"
        ? "border-bht-warning-line bg-bht-warning-bg text-bht-warning-text"
        : "border-bht-danger-line bg-bht-danger-bg text-bht-danger-strong";
  const isError = type === "err";
  const positionClass = floating
    ? "fixed top-4 right-4 z-50 max-w-md w-[calc(100%-2rem)] shadow-bht-elev-17"
    : "shadow-xs";

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
      className={`flex items-start justify-between gap-3 rounded-xl border px-3.5 py-3 text-xs sm:text-sm font-medium ${positionClass} ${styles} ${className}`}
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
  confirmLabel,
  cancelLabel = "Cancelar",
  onConfirm,
  confirmVariant = "primary",
  confirmDisabled = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidth?: "md" | "lg" | "2xl" | "4xl" | "6xl";
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  confirmVariant?: ButtonVariant;
  confirmDisabled?: boolean;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const subtitleId = useId();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const pressedOutsideRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open) {
      if (document.activeElement instanceof HTMLElement) {
        previousFocusRef.current = document.activeElement;
      }
      if (!dialog || dialog.open) return;
      try {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      } catch {
        dialog.setAttribute("open", "");
      }
    } else {
      previousFocusRef.current?.focus?.();
      previousFocusRef.current = null;
    }
  }, [open]);

  if (!open) return null;

  const widthClass =
    maxWidth === "md"
      ? "sm:max-w-md"
      : maxWidth === "2xl"
        ? "sm:max-w-2xl"
        : maxWidth === "4xl"
          ? "sm:max-w-4xl"
          : maxWidth === "6xl"
            ? "sm:max-w-[1140px]"
            : "sm:max-w-lg";

  const outside = (e: React.PointerEvent<HTMLDialogElement>) => {
    const r = dialogRef.current?.getBoundingClientRect();
    return Boolean(
      r &&
      (e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom)
    );
  };

  return (
    <dialog
      ref={dialogRef}
      closedby="any"
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onClose={() => {
        if (open) onCloseRef.current();
      }}
      onPointerDown={(e) => {
        pressedOutsideRef.current = outside(e);
      }}
      onPointerUp={(e) => {
        if (pressedOutsideRef.current && outside(e)) onCloseRef.current();
        pressedOutsideRef.current = false;
      }}
      className={`bht-dialog fixed inset-x-0 bottom-0 top-auto z-50 m-0 open:flex max-h-[92dvh] w-full max-w-full flex-col rounded-t-2xl border border-bht-line bg-white p-0 text-bht-ink-strong shadow-bht-elev-17 outline-none sm:inset-0 sm:m-auto sm:h-fit sm:w-[calc(100%-2rem)] sm:rounded-2xl ${widthClass}`}
    >
      <div
        className="mx-auto mt-2 h-1 w-10 rounded-full bg-bht-line-strong sm:hidden"
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-3 border-b border-bht-line bg-bht-paper/60 px-4 py-3.5 sm:px-5 sm:py-4">
        <div className="min-w-0">
          <h2
            id={titleId}
            className="text-base sm:text-lg font-bold tracking-tight text-bht-ink-strong"
          >
            {title}
          </h2>
          {subtitle && (
            <p id={subtitleId} className="mt-0.5 text-xs sm:text-sm text-bht-ink-soft">
              {subtitle}
            </p>
          )}
        </div>
        <button
          type="button"
          data-compact="true"
          onClick={() => onCloseRef.current()}
          aria-label="Cerrar"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-bht-ink-soft transition-colors duration-150 hover:bg-bht-mist hover:text-bht-navy-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt cursor-pointer"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="overflow-y-auto px-4 pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:px-5 sm:pb-5">
        {children}
        {onConfirm && confirmLabel && (
          <div className="mt-4 flex flex-col-reverse gap-2 border-t border-bht-line pt-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onCloseRef.current()}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant={confirmVariant}
              size="sm"
              disabled={confirmDisabled}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        )}
      </div>
    </dialog>
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
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-bht-line-strong bg-bht-paper/60 px-6 py-10 text-center">
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-bht-cobalt-bg/80 text-bht-cobalt ring-1 ring-bht-cobalt/15">
          {icon}
        </div>
      )}
      <p className="text-base font-semibold tracking-tight text-bht-ink-strong">
        {title}
      </p>
      {description && (
        <p className="mt-1 max-w-sm text-sm leading-relaxed text-bht-ink-soft">
          {description}
        </p>
      )}
    </div>
  );
}
