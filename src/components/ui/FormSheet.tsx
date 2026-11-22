"use client";

import React, { useId, useState } from "react";
import { Badge, type BadgeTone } from "./Primitives";

export interface FormSheetStage {
  id: string;
  label: string;
  tone?: BadgeTone;
}

export interface FormSheetSmartButton {
  id: string;
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  onClick?: () => void;
  tone?: "default" | "danger" | "success" | "warning";
}

export interface FormSheetTab {
  id: string;
  label: string;
  count?: number;
  content: React.ReactNode;
}

export function FormSheet({
  documentCode,
  title,
  subtitle,
  actions,
  stages,
  currentStageId,
  smartButtons,
  tabs,
  defaultTabId,
  children,
  className = "",
}: {
  documentCode?: string;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  stages?: FormSheetStage[];
  currentStageId?: string;
  smartButtons?: FormSheetSmartButton[];
  tabs?: FormSheetTab[];
  defaultTabId?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const baseId = useId();
  const [activeTabId, setActiveTabId] = useState<string>(
    defaultTabId ?? tabs?.[0]?.id ?? ""
  );

  const resolvedTabId =
    tabs?.some((t) => t.id === activeTabId)
      ? activeTabId
      : (tabs?.[0]?.id ?? "");

  return (
    <div className={`mx-auto w-full max-w-[1140px] space-y-3 text-sm ${className}`}>
      {/* Action Header + Pipeline Statusbar */}
      {(actions || (stages && stages.length > 0)) && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-bht-line bg-bht-paper px-3.5 py-2.5">
          {actions ? (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          ) : (
            <div />
          )}
          {stages && stages.length > 0 && (
            <ol
              aria-label="Estado del documento"
              className="flex flex-wrap items-center gap-1"
            >
              {stages.map((stage, idx) => {
                const isCurrent = stage.id === currentStageId;
                return (
                  <li key={stage.id} className="flex items-center gap-1">
                    {idx > 0 && (
                      <span
                        aria-hidden="true"
                        className="text-xs text-bht-ink-muted"
                      >
                        →
                      </span>
                    )}
                    <Badge
                      tone={isCurrent ? (stage.tone ?? "horizon") : "neutral"}
                      className={
                        isCurrent
                          ? "ring-1 ring-bht-cobalt/30 font-bold"
                          : "opacity-75"
                      }
                    >
                      {stage.label}
                    </Badge>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}

      {/* White Document Sheet */}
      <div className="rounded-xl border border-bht-line bg-white p-4 sm:p-5 shadow-bht-elev-2 space-y-4">
        {/* Document Header & Smart Buttons Row */}
        {(documentCode || title || subtitle || (smartButtons && smartButtons.length > 0)) && (
          <div className="flex flex-col gap-3 border-b border-bht-line pb-3.5 sm:flex-row sm:items-start sm:justify-between">
            {(documentCode || title || subtitle) && (
              <div className="min-w-0 flex-1">
                {documentCode && (
                  <p className="font-mono text-xs font-semibold uppercase tracking-wider text-bht-cobalt tabular-nums">
                    {documentCode}
                  </p>
                )}
                {title && (
                  <h3 className="mt-0.5 text-lg font-bold tracking-tight text-bht-ink-strong sm:text-xl">
                    {title}
                  </h3>
                )}
                {subtitle && (
                  <p className="mt-0.5 text-xs text-bht-ink-soft">{subtitle}</p>
                )}
              </div>
            )}

            {smartButtons && smartButtons.length > 0 && (
              <div
                role="group"
                aria-label="Indicadores rápidos del documento"
                className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end"
              >
                {smartButtons.map((sb) => {
                  const valueColor =
                    sb.tone === "danger"
                      ? "text-bht-danger"
                      : sb.tone === "success"
                        ? "text-bht-success"
                        : sb.tone === "warning"
                          ? "text-bht-warning"
                          : "text-bht-ink-strong";
                  const content = (
                    <>
                      {sb.icon && (
                        <span className="text-bht-cobalt" aria-hidden="true">
                          {sb.icon}
                        </span>
                      )}
                      <div className="min-w-0 text-left">
                        <span
                          className={`block text-sm font-bold leading-tight tabular-nums ${valueColor}`}
                        >
                          {sb.value}
                        </span>
                        <span className="block truncate text-[11px] font-medium text-bht-ink-soft">
                          {sb.label}
                        </span>
                      </div>
                    </>
                  );

                  if (sb.onClick) {
                    return (
                      <button
                        key={sb.id}
                        type="button"
                        data-compact="true"
                        onClick={sb.onClick}
                        className="inline-flex min-h-11 items-center gap-2.5 rounded-xl border border-bht-line bg-bht-paper px-3 py-1.5 transition hover:border-bht-cobalt hover:bg-bht-cobalt-bg/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt cursor-pointer"
                      >
                        {content}
                      </button>
                    );
                  }
                  return (
                    <div
                      key={sb.id}
                      className="inline-flex min-h-11 items-center gap-2.5 rounded-xl border border-bht-line bg-bht-paper px-3 py-1.5"
                    >
                      {content}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Primary Body Fields */}
        {children && <div className="space-y-3">{children}</div>}

        {/* Notebook Tabs */}
        {tabs && tabs.length > 0 && (
          <div className="space-y-3 pt-1">
            <div
              role="tablist"
              aria-label="Pestañas del documento"
              className="flex flex-wrap gap-1 border-b border-bht-line pb-1.5"
            >
              {tabs.map((tab) => {
                const selected = tab.id === resolvedTabId;
                const tabDomId = `${baseId}-tab-${tab.id}`;
                const panelDomId = `${baseId}-panel-${tab.id}`;
                return (
                  <button
                    key={tab.id}
                    id={tabDomId}
                    type="button"
                    role="tab"
                    data-compact="true"
                    aria-selected={selected}
                    aria-controls={panelDomId}
                    onClick={() => setActiveTabId(tab.id)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                      selected
                        ? "bg-bht-cobalt-bg text-bht-cobalt-strong"
                        : "text-bht-ink-soft hover:bg-bht-paper hover:text-bht-ink-strong"
                    }`}
                  >
                    <span>{tab.label}</span>
                    {tab.count !== undefined && (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                          selected
                            ? "bg-bht-cobalt text-white"
                            : "bg-bht-mist text-bht-ink-soft"
                        }`}
                      >
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {tabs.map((tab) => {
              const selected = tab.id === resolvedTabId;
              const tabDomId = `${baseId}-tab-${tab.id}`;
              const panelDomId = `${baseId}-panel-${tab.id}`;
              if (!selected) return null;
              return (
                <div
                  key={tab.id}
                  id={panelDomId}
                  role="tabpanel"
                  aria-labelledby={tabDomId}
                  className="space-y-2.5"
                >
                  {tab.content}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
