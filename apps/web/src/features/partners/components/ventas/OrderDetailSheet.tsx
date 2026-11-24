"use client";

import React from "react";
import { formatPen } from "@/features/partners/components/types";
import { FormSheet } from "@/components/ui/FormSheet";
import { Badge, Button } from "@/components/ui/Primitives";
import {
  formatFulfillmentModeEs,
  formatOperationalStatusEs,
  formatUnitTitleEs,
} from "@/lib/labels-es";
import type { SellerOrderDto } from "@/features/seller/types";
import {
  formatTraceabilitySummary,
  getMarginTextClass,
  operationalStatusTone,
} from "@/features/partners/partnerShared";

const ORDER_PIPELINE_STAGES = [
  { id: "PENDING_PARTNER_APPROVAL", label: "Por aprobar", tone: "warning" as const },
  { id: "REGISTERED", label: "Registrado", tone: "warning" as const },
  { id: "PICKING", label: "En alistamiento", tone: "warning" as const },
  { id: "READY", label: "Listo", tone: "brand" as const },
  { id: "IN_ROUTE", label: "En ruta", tone: "brand" as const },
  { id: "DELIVERED", label: "Entregado", tone: "success" as const },
];

export function OrderDetailSheet({
  order,
  onAbonar,
  onCancel,
}: {
  order: SellerOrderDto;
  onAbonar: () => void;
  onCancel: () => void;
}) {
  const marginVal = Number(order.order_margin_pen ?? 0);
  const totalVal = Number(order.total_pen ?? 0);
  const debtVal = Number(order.balance_due_pen ?? 0);
  const statusStr = String(order.operational_status ?? "");
  const creditExceeded = Boolean(
    (order as { credit_limit_exceeded_flag?: boolean }).credit_limit_exceeded_flag
  );
  const canAbonar =
    debtVal > 0.05 &&
    statusStr !== "CANCELLED" &&
    statusStr !== "PENDING_PARTNER_APPROVAL";
  const canCancel = statusStr !== "CANCELLED" && statusStr !== "DELIVERED";

  const stages =
    statusStr === "CANCELLED"
      ? [
          ...ORDER_PIPELINE_STAGES,
          { id: "CANCELLED", label: "Anulado", tone: "danger" as const },
        ]
      : ORDER_PIPELINE_STAGES.filter(
          (s) =>
            s.id !== "PENDING_PARTNER_APPROVAL" ||
            statusStr === "PENDING_PARTNER_APPROVAL"
        );

  const lines = Array.isArray(order.lines) ? order.lines : [];
  const auditHistory = Array.isArray(order.audit_history) ? order.audit_history : [];

  return (
    <FormSheet
      documentCode={`Pedido ${String(order.order_code)}`}
      title={String(order.customer_name)}
      subtitle={`Fecha: ${String(order.order_date)} · ${formatTraceabilitySummary(order)}`}
      stages={stages}
      currentStageId={statusStr}
      actions={
        <>
          <Badge tone={operationalStatusTone(order.operational_status)}>
            {formatOperationalStatusEs(order.operational_status)}
          </Badge>
          {creditExceeded && <Badge tone="danger">Excede límite de crédito</Badge>}
          {canAbonar && (
            <Button type="button" variant="primary" size="sm" onClick={onAbonar}>
              Registrar Abono ({formatPen(debtVal)})
            </Button>
          )}
          {canCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              className="border-bht-danger-line text-bht-danger hover:bg-bht-danger-bg"
            >
              Anular Pedido
            </Button>
          )}
        </>
      }
      smartButtons={[
        {
          id: "total",
          label: "Venta Total",
          value: formatPen(totalVal),
        },
        {
          id: "margin",
          label: "Margen Real",
          value: formatPen(marginVal),
          tone: marginVal <= 0 ? "danger" : "success",
        },
        {
          id: "debt",
          label: "Saldo Pendiente",
          value: formatPen(debtVal),
          tone: debtVal > 0.05 ? "danger" : "success",
          onClick: canAbonar ? onAbonar : undefined,
        },
      ]}
      tabs={[
        {
          id: "lines",
          label: "Productos comprados",
          count: lines.length,
          content: (
            <div className="space-y-1.5">
              {lines.length > 0 ? (
                lines.map((ln) => (
                  <div
                    key={String(ln.order_line_id)}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bht-line bg-bht-paper px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-bht-ink-strong">
                        {String(ln.raw_description || ln.sku)}
                      </p>
                      <p className="text-xs text-bht-ink-soft tabular-nums">
                        {Number(ln.quantity)}{" "}
                        <span title={formatUnitTitleEs(ln.unit_of_measure)}>
                          {String(ln.unit_of_measure || "NIU")}
                        </span>{" "}
                        × {formatPen(ln.unit_price_pen)}
                        {Number(ln.unit_discount_pen || 0) > 0
                          ? ` (desc. ${formatPen(ln.unit_discount_pen)}/u)`
                          : ""}{" "}
                        · {formatFulfillmentModeEs(ln.fulfillment_mode)}
                      </p>
                    </div>
                    <div className="text-right tabular-nums">
                      <span className="block font-semibold text-bht-ink-strong">
                        {formatPen(ln.line_total_pen)}
                      </span>
                      {ln.line_margin_pen !== null &&
                        ln.line_margin_pen !== undefined && (
                          <span
                            className={`block text-xs font-medium ${getMarginTextClass(
                              Number(ln.line_margin_pen),
                              Number(ln.line_total_pen)
                            )}`}
                          >
                            {Number(ln.line_margin_pen) >= 0 ? "+" : ""}
                            {formatPen(ln.line_margin_pen)}
                          </span>
                        )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-bht-ink-soft">Sin líneas registradas.</p>
              )}
            </div>
          ),
        },
        {
          id: "audit",
          label: "Notas e Historial",
          count: auditHistory.length,
          content: (
            <div className="space-y-2.5">
              {order.notes ? (
                <p className="rounded-lg border border-bht-line bg-bht-paper px-3 py-2 text-xs text-bht-ink-soft">
                  <strong className="text-bht-ink-strong">Nota operativa:</strong>{" "}
                  {String(order.notes)}
                </p>
              ) : (
                <p className="text-xs text-bht-ink-soft">Sin notas operativas.</p>
              )}
              {auditHistory.length > 0 && (
                <div className="space-y-2 rounded-lg border border-bht-line-blue bg-bht-mist/60 p-3">
                  <p className="text-xs font-semibold text-bht-navy-deep">
                    Historial de cambios ({auditHistory.length})
                  </p>
                  {auditHistory.map((entry) => (
                    <div
                      key={String(entry.audit_id)}
                      className="border-t border-bht-line-blue pt-2 text-xs text-bht-ink-soft"
                    >
                      <p className="font-medium text-bht-ink-strong">
                        {String(entry.action) === "CANCEL"
                          ? "Anulación"
                          : String(entry.action) === "UNDO_CANCEL"
                            ? "Reversión de anulación"
                            : String(entry.action) === "UNDO_STATUS"
                              ? "Reversión de estado"
                              : "Modificación"}{" "}
                        · {String(entry.reason)}
                      </p>
                      <p>
                        {String(entry.actor_name || "Usuario")} ·{" "}
                        {new Date(String(entry.created_at)).toLocaleString("es-PE")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ),
        },
      ]}
    />
  );
}
