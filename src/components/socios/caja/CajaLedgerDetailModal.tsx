"use client";

import { Badge, Button, ModalSheet } from "@/components/ui/Primitives";
import { formatCashDirectionEs, formatExpenseCategoryEs } from "@/lib/labels-es";
import { formatPen, type CashLedgerEntry } from "../types";
import { formatExpenseBucketEs } from "./caja-utils";

export function LedgerMovementDetailModal({
  movement,
  onClose,
}: {
  movement: CashLedgerEntry | null;
  onClose: () => void;
}) {
  const isIn = movement?.direction === "IN";
  const badgeTone = movement?.is_internal_transfer
    ? "brand"
    : isIn
      ? "success"
      : "danger";

  return (
    <ModalSheet
      open={Boolean(movement)}
      onClose={onClose}
      maxWidth="lg"
      title={
        movement ? `Detalle de movimiento #${movement.ledger_id}` : "Detalle de caja"
      }
      subtitle={movement ? `${movement.account_name} · ${movement.tx_date}` : undefined}
    >
      {movement && (
        <div className="space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bht-line bg-bht-paper p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={badgeTone}>
                {formatCashDirectionEs(
                  movement.direction,
                  movement.is_internal_transfer
                )}
              </Badge>
              <span className="font-semibold text-bht-ink-strong">
                {formatExpenseCategoryEs(movement.expense_category)}
              </span>
            </div>
            <span
              className={`text-lg font-bold tabular-nums ${
                movement.is_internal_transfer
                  ? "text-bht-navy-mid"
                  : isIn
                    ? "text-bht-success"
                    : "text-bht-danger"
              }`}
            >
              {isIn ? "+" : "-"}
              {formatPen(movement.amount_pen)}
            </span>
          </div>

          <dl className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="rounded-xl border border-bht-line bg-white p-2.5">
              <dt className="text-[11px] text-bht-ink-muted">Fecha del movimiento</dt>
              <dd className="mt-0.5 font-semibold text-bht-ink-strong tabular-nums">
                {movement.tx_date}
              </dd>
            </div>
            <div className="rounded-xl border border-bht-line bg-white p-2.5">
              <dt className="text-[11px] text-bht-ink-muted">Cuenta</dt>
              <dd className="mt-0.5 font-semibold text-bht-ink-strong">
                {movement.account_name}
                {movement.account_code ? ` (${movement.account_code})` : ""}
              </dd>
            </div>
            <div className="rounded-xl border border-bht-line bg-white p-2.5">
              <dt className="text-[11px] text-bht-ink-muted">Clasificación</dt>
              <dd className="mt-0.5 font-semibold text-bht-ink-strong">
                {formatExpenseBucketEs(
                  movement.expense_bucket,
                  movement.is_internal_transfer
                )}
              </dd>
            </div>
            <div className="rounded-xl border border-bht-line bg-white p-2.5">
              <dt className="text-[11px] text-bht-ink-muted">Origen del registro</dt>
              <dd className="mt-0.5 font-semibold text-bht-ink-strong">
                {movement.source_origin === "ERP_APP" ? "Aplicación ERP" : "Histórico"}
              </dd>
            </div>
            {(movement.trip_code || movement.trip_zone) && (
              <div className="rounded-xl border border-bht-line bg-white p-2.5">
                <dt className="text-[11px] text-bht-ink-muted">Ruta / Viaje</dt>
                <dd className="mt-0.5 font-semibold text-bht-navy-mid">
                  {movement.trip_code || `#${movement.trip_id}`}
                  {movement.trip_zone ? ` · ${movement.trip_zone}` : ""}
                </dd>
              </div>
            )}
            {movement.party_name && (
              <div className="rounded-xl border border-bht-line bg-white p-2.5">
                <dt className="text-[11px] text-bht-ink-muted">Cliente / Proveedor</dt>
                <dd className="mt-0.5 font-semibold text-bht-ink-strong">
                  {movement.party_name}
                </dd>
              </div>
            )}
            {movement.reference_id && (
              <div className="rounded-xl border border-bht-line bg-white p-2.5 sm:col-span-2">
                <dt className="text-[11px] text-bht-ink-muted">Referencia técnica</dt>
                <dd className="mt-0.5 font-mono text-[11px] text-bht-ink-soft">
                  {movement.reference_table ? `${movement.reference_table} · ` : ""}#
                  {movement.reference_id}
                </dd>
              </div>
            )}
          </dl>

          <div className="rounded-xl border border-bht-line bg-bht-paper p-3">
            <span className="block text-[11px] font-medium text-bht-ink-muted">
              Descripción completa
            </span>
            <p className="mt-1 whitespace-pre-wrap text-bht-ink-strong">
              {movement.description}
            </p>
          </div>

          <div className="flex justify-end border-t border-bht-line pt-3">
            <Button variant="outline" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </div>
      )}
    </ModalSheet>
  );
}
