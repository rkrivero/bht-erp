"use client";

import React, { useId, useMemo, useState } from "react";
import { Button, EmptyState } from "./Primitives";

export interface ResponsiveTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T, rowIndex: number) => React.ReactNode;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  sortValue?: (row: T) => string | number | null | undefined;
  optional?: boolean;
  defaultHidden?: boolean;
  headerClassName?: string;
  cellClassName?: string;
  stopRowClickPropagation?: boolean;
}

export function ResponsiveDataTable<T>({
  columns,
  data,
  getRowKey,
  ariaLabel,
  ariaLabelledBy,
  onRowClick,
  getRowAriaLabel,
  emptyTitle = "No hay registros que coincidan con el filtro",
  emptyDescription,
  deferAfterRow = 15,
  className = "",
}: {
  columns: ResponsiveTableColumn<T>[];
  data: T[];
  getRowKey: (row: T, index: number) => string | number;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  onRowClick?: (row: T) => void;
  getRowAriaLabel?: (row: T) => string;
  emptyTitle?: string;
  emptyDescription?: string;
  deferAfterRow?: number;
  className?: string;
}) {
  const columnsPopoverId = useId();
  const [colsOpen, setColsOpen] = useState(false);

  const [hiddenColumnIds, setHiddenColumnIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const col of columns) {
      if (col.optional && col.defaultHidden) {
        initial.add(col.id);
      }
    }
    return initial;
  });

  const [sortState, setSortState] = useState<{
    columnId: string;
    direction: "asc" | "desc";
  } | null>(null);

  const optionalColumns = useMemo(
    () => columns.filter((col) => col.optional),
    [columns]
  );

  const visibleColumns = useMemo(
    () => columns.filter((col) => !hiddenColumnIds.has(col.id)),
    [columns, hiddenColumnIds]
  );

  const sortedData = useMemo(() => {
    if (!sortState) return data;
    const col = columns.find((c) => c.id === sortState.columnId);
    if (!col || !col.sortValue) return data;
    const factor = sortState.direction === "asc" ? 1 : -1;
    return [...data].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * factor;
      }
      return String(va).localeCompare(String(vb), "es-PE", { numeric: true }) * factor;
    });
  }, [data, sortState, columns]);

  function handleSort(col: ResponsiveTableColumn<T>) {
    if (!col.sortable && !col.sortValue) return;
    setSortState((prev) => {
      if (!prev || prev.columnId !== col.id) {
        return { columnId: col.id, direction: "asc" };
      }
      if (prev.direction === "asc") {
        return { columnId: col.id, direction: "desc" };
      }
      return null;
    });
  }

  function toggleColumnVisibility(colId: string) {
    setHiddenColumnIds((prev) => {
      const next = new Set(prev);
      if (next.has(colId)) {
        next.delete(colId);
      } else {
        next.add(colId);
      }
      return next;
    });
  }

  if (data.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {optionalColumns.length > 0 && (
        <div className="flex justify-end">
          <div className="relative">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-compact="true"
              popoverTarget={columnsPopoverId}
              aria-expanded={colsOpen}
            >
              Columnas ({visibleColumns.length}/{columns.length})
            </Button>
            <div
              id={columnsPopoverId}
              popover="auto"
              onToggle={(e) => {
                const evt = e as React.SyntheticEvent<HTMLDivElement> & {
                  newState?: string;
                };
                if (evt.newState) {
                  setColsOpen(evt.newState === "open");
                }
              }}
              className="bht-anchored-popover z-40 mt-1 w-56 rounded-xl border border-bht-line bg-white p-2.5 shadow-bht-elev-17"
            >
              <p className="px-2 pb-1.5 text-xs font-semibold text-bht-ink-soft">
                Columnas opcionales
              </p>
              <div className="space-y-1">
                {optionalColumns.map((col) => {
                  const checked = !hiddenColumnIds.has(col.id);
                  return (
                    <label
                      key={col.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-bht-ink-strong hover:bg-bht-paper"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleColumnVisibility(col.id)}
                        className="h-4 w-4 rounded border-bht-line text-bht-cobalt focus:ring-bht-cobalt"
                      />
                      <span>{col.header}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        tabIndex={0}
        role="region"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className="table-wrapper rounded-xl border border-bht-line bg-white"
      >
        <table className="bht-responsive-table w-full text-left text-sm">
          <thead className="border-b border-bht-line bg-[var(--bg-rail)] text-[11px] font-semibold uppercase tracking-[0.06em] text-bht-ink-muted">
            <tr>
              {visibleColumns.map((col) => {
                const isSortable = Boolean(col.sortable || col.sortValue);
                const isSorted = sortState?.columnId === col.id;
                const ariaSort: React.AriaAttributes["aria-sort"] = isSortable
                  ? isSorted
                    ? sortState.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                  : undefined;
                const alignClass =
                  col.align === "right"
                    ? "text-right"
                    : col.align === "center"
                      ? "text-center"
                      : "text-left";
                return (
                  <th
                    key={col.id}
                    scope="col"
                    aria-sort={ariaSort}
                    className={`whitespace-nowrap ${alignClass} ${col.headerClassName ?? ""}`}
                  >
                    {isSortable ? (
                      <button
                        type="button"
                        data-compact="true"
                        onClick={() => handleSort(col)}
                        className={`inline-flex items-center gap-1 font-semibold uppercase tracking-wider transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt cursor-pointer ${
                          isSorted
                            ? "text-bht-cobalt-strong"
                            : "text-bht-ink-soft hover:text-bht-ink-strong"
                        } ${col.align === "right" ? "ml-auto" : ""}`}
                      >
                        <span>{col.header}</span>
                        <span aria-hidden="true" className="text-[10px]">
                          {isSorted ? (sortState.direction === "asc" ? "▲" : "▼") : "⇅"}
                        </span>
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-bht-line">
            {sortedData.map((row, rowIndex) => {
              const rowKey = getRowKey(row, rowIndex);
              const deferClass = rowIndex >= deferAfterRow ? "bht-defer-row" : "";
              const clickableClass = onRowClick
                ? "cursor-pointer transition-colors duration-150 hover:bg-bht-cobalt-bg/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bht-cobalt"
                : "bht-table-row";

              return (
                <tr
                  key={rowKey}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={getRowAriaLabel ? getRowAriaLabel(row) : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  className={`${deferClass} ${clickableClass}`}
                >
                  {visibleColumns.map((col) => {
                    const alignClass =
                      col.align === "right"
                        ? "text-right"
                        : col.align === "center"
                          ? "text-center"
                          : "text-left";
                    return (
                      <td
                        key={col.id}
                        data-label={col.header}
                        onClick={
                          col.stopRowClickPropagation
                            ? (e) => e.stopPropagation()
                            : undefined
                        }
                        className={`${alignClass} ${col.cellClassName ?? ""}`}
                      >
                        <div
                          className={
                            col.align === "right"
                              ? "min-w-0 max-w-full sm:ml-auto"
                              : "min-w-0 max-w-full"
                          }
                        >
                          {col.cell(row, rowIndex)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
