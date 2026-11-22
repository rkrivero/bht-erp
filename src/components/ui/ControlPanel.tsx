"use client";

import React, { useId, useState } from "react";
import { ChevronRightIcon, CloseIcon, SearchIcon } from "./Icons";
import {
  Badge,
  Button,
  type ButtonVariant,
  Card,
  INPUT_CLASS,
  SegmentedControl,
} from "./Primitives";

export interface ControlPanelBreadcrumb {
  label: string;
  onClick?: () => void;
}

export interface ControlPanelFacet {
  id: string;
  label: string;
  value: string;
  onRemove: () => void;
}

export interface ControlPanelBatchAction {
  id: string;
  label: string;
  onClick: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
}

export interface ControlPanelPagination {
  shownCount: number;
  totalCount: number;
  itemLabel?: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  loadMoreLabel?: string;
}

export function readControlPanelUrlParam(key: string, fallback = ""): string {
  if (typeof window === "undefined") return fallback;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function syncControlPanelUrlParams(
  updates: Record<string, string | null | undefined>
): void {
  if (typeof window === "undefined") return;
  try {
    const current = new URL(window.location.href);
    let changed = false;
    for (const [key, val] of Object.entries(updates)) {
      const normalized = val?.trim() ?? "";
      if (!normalized || normalized === "ALL") {
        if (current.searchParams.has(key)) {
          current.searchParams.delete(key);
          changed = true;
        }
      } else if (current.searchParams.get(key) !== normalized) {
        current.searchParams.set(key, normalized);
        changed = true;
      }
    }
    if (changed) {
      window.history.replaceState(
        null,
        "",
        current.pathname + current.search + current.hash
      );
    }
  } catch {
    // Ignore history API errors in restricted environments
  }
}

export function ControlPanel<TView extends string = string>({
  title,
  subtitle,
  breadcrumbs,
  primaryAction,
  secondaryActions,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Buscar...",
  searchAriaLabel = "Buscar registros",
  facets = [],
  onClearAllFacets,
  filterPopoverContent,
  filterButtonLabel = "Filtros",
  activeFiltersCount = 0,
  quickFilters,
  viewMode,
  viewOptions,
  onViewModeChange,
  viewAriaLabel = "Cambiar vista",
  selectedCount = 0,
  batchActions = [],
  onClearSelection,
  pagination,
  className = "",
  children,
}: {
  title?: string;
  subtitle?: string;
  breadcrumbs?: ControlPanelBreadcrumb[];
  primaryAction?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
    disabled?: boolean;
  };
  secondaryActions?: React.ReactNode;
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  facets?: ControlPanelFacet[];
  onClearAllFacets?: () => void;
  filterPopoverContent?: React.ReactNode;
  filterButtonLabel?: string;
  activeFiltersCount?: number;
  quickFilters?: React.ReactNode;
  viewMode?: TView;
  viewOptions?: Array<{ id: TView; label: string; count?: number }>;
  onViewModeChange?: (val: TView) => void;
  viewAriaLabel?: string;
  selectedCount?: number;
  batchActions?: ControlPanelBatchAction[];
  onClearSelection?: () => void;
  pagination?: ControlPanelPagination;
  className?: string;
  children?: React.ReactNode;
}) {
  const filterPopoverId = useId();
  const [filterOpen, setFilterOpen] = useState(false);

  return (
    <Card padding="md" className={`space-y-3 ${className}`}>
      {(breadcrumbs ||
        title ||
        subtitle ||
        primaryAction ||
        secondaryActions ||
        (viewOptions && viewMode && onViewModeChange)) && (
        <div className="flex flex-wrap items-start justify-between gap-3 sm:items-center">
          <div className="min-w-0 flex-1">
            {breadcrumbs && breadcrumbs.length > 0 && (
              <nav
                aria-label="Ruta de navegación"
                className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-bht-ink-muted"
              >
                {breadcrumbs.map((crumb, idx) => {
                  const isLast = idx === breadcrumbs.length - 1;
                  return (
                    <React.Fragment key={`${crumb.label}-${idx}`}>
                      {idx > 0 && (
                        <ChevronRightIcon
                          className="h-3 w-3 text-bht-ink-muted"
                          aria-hidden="true"
                        />
                      )}
                      {crumb.onClick && !isLast ? (
                        <button
                          type="button"
                          data-compact="true"
                          onClick={crumb.onClick}
                          className="font-medium text-bht-ink-soft hover:text-bht-cobalt hover:underline cursor-pointer"
                        >
                          {crumb.label}
                        </button>
                      ) : (
                        <span
                          className={
                            isLast
                              ? "font-semibold text-bht-navy-deep"
                              : "font-medium text-bht-ink-soft"
                          }
                        >
                          {crumb.label}
                        </span>
                      )}
                    </React.Fragment>
                  );
                })}
              </nav>
            )}
            {title && (
              <h2 className="text-base sm:text-lg font-bold text-bht-ink-strong">
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 text-xs text-bht-ink-soft">{subtitle}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {viewOptions && viewMode && onViewModeChange && (
              <SegmentedControl<TView>
                ariaLabel={viewAriaLabel}
                value={viewMode}
                onChange={onViewModeChange}
                options={viewOptions}
              />
            )}
            {secondaryActions}
            {primaryAction && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={primaryAction.disabled}
                onClick={primaryAction.onClick}
              >
                {primaryAction.icon}
                <span>{primaryAction.label}</span>
              </Button>
            )}
          </div>
        </div>
      )}

      {selectedCount > 0 && (
        <div
          role="region"
          aria-label="Acciones en lote"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bht-cobalt/25 bg-bht-cobalt-bg/70 px-3.5 py-2 text-xs"
        >
          <div className="flex items-center gap-2">
            <Badge tone="horizon" className="tabular-nums">
              {selectedCount} seleccionado(s)
            </Badge>
            {onClearSelection && (
              <button
                type="button"
                data-compact="true"
                onClick={onClearSelection}
                className="font-semibold text-bht-cobalt-strong hover:underline cursor-pointer"
              >
                Deseleccionar
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {batchActions.map((act) => (
              <Button
                key={act.id}
                type="button"
                size="sm"
                data-compact="true"
                variant={act.variant ?? "secondary"}
                disabled={act.disabled}
                onClick={act.onClick}
              >
                {act.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {(onSearchChange !== undefined ||
        filterPopoverContent !== undefined ||
        quickFilters !== undefined) && (
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
          {onSearchChange !== undefined && (
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-bht-ink-muted">
                <SearchIcon className="h-4 w-4" />
              </span>
              <input
                type="search"
                value={searchValue ?? ""}
                onChange={(e) => onSearchChange(e.target.value)}
                aria-label={searchAriaLabel}
                placeholder={searchPlaceholder}
                className={`${INPUT_CLASS} pl-10 ${searchValue ? "pr-9" : "pr-3"}`}
              />
              {searchValue && (
                <button
                  type="button"
                  data-compact="true"
                  aria-label="Limpiar búsqueda"
                  onClick={() => onSearchChange("")}
                  className="absolute inset-y-0 right-2.5 flex items-center text-bht-ink-muted hover:text-bht-ink-strong cursor-pointer"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {quickFilters}
            {filterPopoverContent && (
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  popoverTarget={filterPopoverId}
                  aria-expanded={filterOpen}
                >
                  <span>{filterButtonLabel}</span>
                  {activeFiltersCount > 0 && (
                    <Badge tone="horizon" className="px-2 py-0.5 tabular-nums">
                      {activeFiltersCount}
                    </Badge>
                  )}
                </Button>
                <div
                  id={filterPopoverId}
                  popover="auto"
                  onToggle={(e) => {
                    const evt = e as React.SyntheticEvent<HTMLDivElement> & {
                      newState?: string;
                    };
                    if (evt.newState) {
                      setFilterOpen(evt.newState === "open");
                    }
                  }}
                  className="bht-anchored-popover z-40 mt-1.5 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-bht-line bg-white p-4 shadow-bht-elev-17"
                >
                  {filterPopoverContent}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {facets.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5 pt-0.5"
          aria-label="Filtros activos"
        >
          {facets.map((facet) => (
            <span
              key={facet.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-bht-info-line bg-bht-cobalt-bg/80 px-2.5 py-1 text-xs font-medium text-bht-cobalt-strong"
            >
              <span className="text-bht-ink-soft">{facet.label}:</span>
              <strong className="font-semibold">{facet.value}</strong>
              <button
                type="button"
                data-compact="true"
                onClick={facet.onRemove}
                aria-label={`Quitar filtro ${facet.label}: ${facet.value}`}
                className="ml-0.5 rounded-full p-0.5 text-bht-cobalt hover:bg-bht-cobalt/15 cursor-pointer"
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
          {onClearAllFacets && facets.length > 1 && (
            <button
              type="button"
              data-compact="true"
              onClick={onClearAllFacets}
              className="px-2 py-0.5 text-xs font-semibold text-bht-ink-soft hover:text-bht-ink-strong hover:underline cursor-pointer"
            >
              Limpiar todos
            </button>
          )}
        </div>
      )}

      {children}

      {pagination && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-bht-line pt-2.5 text-xs text-bht-ink-soft">
          <span className="tabular-nums">
            Mostrando{" "}
            <strong className="text-bht-ink-strong">{pagination.shownCount}</strong> de{" "}
            <strong className="text-bht-ink-strong">{pagination.totalCount}</strong>{" "}
            {pagination.itemLabel ?? "registros"}
          </span>
          {pagination.hasMore && pagination.onLoadMore && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pagination.loadingMore}
              onClick={pagination.onLoadMore}
            >
              {pagination.loadingMore
                ? "Cargando..."
                : (pagination.loadMoreLabel ?? "Cargar más")}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
