"use client";

import React from "react";

export function SkeletonLine({
  width = "w-full",
  height = "h-4",
  className = "",
}: {
  width?: string;
  height?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-bht-mist ${width} ${height} ${className}`}
    />
  );
}

export function SkeletonKpiStrip({
  count = 4,
  className = "",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Cargando indicadores principales"
      className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 ${className}`}
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="rounded-xl border border-bht-line bg-white p-[var(--card-pad,1.5rem)] shadow-bht-elev-2 space-y-3"
        >
          <SkeletonLine width="w-28" height="h-3" />
          <SkeletonLine width="w-36" height="h-7" />
          <SkeletonLine width="w-44" height="h-3" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({
  count = 3,
  className = "",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Cargando tarjetas"
      className={`space-y-3 ${className}`}
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="rounded-xl border border-bht-line bg-white p-4 shadow-bht-elev-2 space-y-2.5"
        >
          <div className="flex items-center justify-between gap-3">
            <SkeletonLine width="w-40" height="h-4" />
            <SkeletonLine width="w-20" height="h-5" className="rounded-full" />
          </div>
          <SkeletonLine width="w-3/4" height="h-3.5" />
          <div className="flex items-center justify-between gap-2 pt-1">
            <SkeletonLine width="w-24" height="h-3" />
            <SkeletonLine width="w-20" height="h-7" className="rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({
  rows = 6,
  cols = 5,
  className = "",
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Cargando tabla de datos"
      className={`overflow-hidden rounded-xl border border-bht-line bg-white shadow-bht-elev-2 ${className}`}
    >
      <div className="grid grid-cols-5 gap-3 border-b border-bht-line bg-bht-paper px-4 py-3">
        {Array.from({ length: cols }).map((_, idx) => (
          <SkeletonLine key={idx} width="w-20" height="h-3" />
        ))}
      </div>
      <div className="divide-y divide-bht-line">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={rowIdx} className="grid grid-cols-5 items-center gap-3 px-4 py-3.5">
            {Array.from({ length: cols }).map((__, colIdx) => (
              <SkeletonLine
                key={colIdx}
                width={colIdx === 0 ? "w-32" : "w-20"}
                height="h-3.5"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
