"use client";

import React, { useState } from "react";
import { Badge, Button, Card, EmptyState } from "@/components/ui/Primitives";
import { formatPaymentModeEs, formatPromiseStatusEs } from "@/lib/labels-es";
import { formatPen } from "../types";
import {
  type ActiveReportConcept,
  ConceptCardButton,
  ReportConceptModal,
} from "./ReportConceptModal";
import { type ReportCarteraDto, formatArBucketEs } from "./reportes-types";

interface ReportesCarteraTabProps {
  data: ReportCarteraDto;
  selectedZone: string;
  onSelectZone: (zone: string) => void;
  onOpenCollections: () => void;
}

export default function ReportesCarteraTab({
  data,
  selectedZone,
  onSelectZone,
  onOpenCollections,
}: ReportesCarteraTabProps) {
  const [activeConcept, setActiveConcept] = useState<ActiveReportConcept | null>(null);
  const { summary, agingBuckets, byZone, byCustomer, collectionSheet } = data;
  const maxBucket = Math.max(1, ...agingBuckets.map((b) => b.balanceDuePen));

  return (
    <div className="min-w-0 space-y-4">
      {/* KPI Summary Row */}
      <section
        aria-label="Indicadores de cartera CxC"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <ConceptCardButton
          onClick={() =>
            setActiveConcept({
              id: "cartera_total_cxc",
              currentValue: formatPen(summary.totalReceivablePen),
              currentSubtext: `${summary.openOrdersCount} pedido(s) en ${summary.openCustomersCount} cliente(s)`,
            })
          }
        >
          <span className="text-sm font-semibold text-bht-ink-soft">
            Cartera Total por Cobrar
          </span>
          <p className="text-2xl font-semibold text-bht-danger tabular-nums">
            {formatPen(summary.totalReceivablePen)}
          </p>
          <span className="block text-xs text-bht-ink-soft tabular-nums">
            {summary.openOrdersCount} pedido(s) en {summary.openCustomersCount}{" "}
            cliente(s)
          </span>
        </ConceptCardButton>

        <ConceptCardButton
          onClick={() =>
            setActiveConcept({
              id: "dso_estimado",
              currentValue:
                summary.dsoDays !== null ? `${summary.dsoDays.toFixed(1)} días` : "-",
              currentSubtext: `Antigüedad media abierta: ${summary.avgOpenAgeDays.toFixed(1)} d (ventana ${summary.referenceWindowDays}d)`,
            })
          }
        >
          <span className="text-sm font-semibold text-bht-ink-soft">
            DSO Estimado (Días promedio de cobro)
          </span>
          <p className="text-2xl font-semibold text-bht-navy-deep tabular-nums">
            {summary.dsoDays !== null ? `${summary.dsoDays.toFixed(1)} d` : "-"}
          </p>
          <span className="block text-xs text-bht-ink-soft tabular-nums">
            Antigüedad media abierta: {summary.avgOpenAgeDays.toFixed(1)} d (ventana{" "}
            {summary.referenceWindowDays}d)
          </span>
        </ConceptCardButton>

        <ConceptCardButton
          onClick={() =>
            setActiveConcept({
              id: "dias_vencidos_due_date",
              currentValue: formatPen(summary.pastDueExplicitPen),
              currentSubtext: `> 30d antigüedad: ${formatPen(summary.overdueGt30Pen)} · Sin fecha límite: ${formatPen(summary.noDueDatePen)}`,
            })
          }
        >
          <span className="text-sm font-semibold text-bht-ink-soft">
            Saldo con antigüedad &gt; 30 días
          </span>
          <p className="text-2xl font-semibold text-bht-warning tabular-nums">
            {formatPen(summary.overdueGt30Pen)}
          </p>
          <span className="block text-xs text-bht-ink-soft tabular-nums">
            Vencido por fecha límite: {formatPen(summary.pastDueExplicitPen)} · Sin
            fecha: {formatPen(summary.noDueDatePen)}
          </span>
        </ConceptCardButton>

        <ConceptCardButton
          tone={summary.brokenPromisesCount > 0 ? "warning" : "default"}
          onClick={() =>
            setActiveConcept({
              id: "promesas_vencidas",
              currentValue: formatPen(summary.brokenPromisesPen),
              currentSubtext: `${summary.brokenPromisesCount} compromiso(s) vencido(s)`,
            })
          }
        >
          <span className="text-sm font-semibold text-bht-ink-soft">
            Promesas de Pago Vencidas
          </span>
          <p className="text-2xl font-semibold text-bht-danger tabular-nums">
            {formatPen(summary.brokenPromisesPen)}
          </p>
          <Badge tone={summary.brokenPromisesCount > 0 ? "danger" : "success"}>
            {summary.brokenPromisesCount} compromiso(s) vencido(s)
          </Badge>
        </ConceptCardButton>
      </section>

      {/* AR Aging Buckets (0-15 / 16-30 / 31-60 / >60d) */}
      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
              Antigüedad de Cartera por Tramos (0–15 / 16–30 / 31–60 / &gt;60 días)
            </h3>
            <p className="mt-0.5 text-xs text-bht-ink-soft">
              Antigüedad desde la fecha del pedido (media{" "}
              {summary.avgInvoiceAgeDays.toFixed(1)} d); abajo en la Hoja de Cobranza se
              separa vencimiento real (fecha límite) vs. antigüedad del pedido.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onOpenCollections}>
            Registrar cobros en Cobranza →
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {agingBuckets.map((b) => {
            const pct = Math.min(
              100,
              Math.max(b.balanceDuePen > 0 ? 4 : 0, (b.balanceDuePen / maxBucket) * 100)
            );
            const barColor =
              b.bucket === "GT_60"
                ? "bg-bht-danger-vivid"
                : b.bucket === "31_60"
                  ? "bg-bht-tone-d97706"
                  : b.bucket === "16_30"
                    ? "bg-bht-navy-mid"
                    : "bg-bht-success";
            return (
              <div
                key={b.bucket}
                className="rounded-xl border border-bht-line bg-bht-paper/60 p-3 text-xs space-y-1.5"
              >
                <span className="font-medium text-bht-ink-soft">
                  {formatArBucketEs(b.bucket)}
                </span>
                <p className="text-lg font-semibold text-bht-ink-strong tabular-nums">
                  {formatPen(b.balanceDuePen)}
                </p>
                <span className="block text-bht-ink-muted tabular-nums">
                  {b.ordersCount} pedido(s)
                </span>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-bht-line">
                  <div
                    className={`h-full rounded-full ${barColor}`}
                    style={{ width: `${pct}%` }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Delinquency by Zone + Top Debtors */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card padding="md" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
              Morosidad por Zona
            </h3>
            {selectedZone && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onSelectZone("")}
              >
                Ver todas las zonas
              </Button>
            )}
          </div>
          {byZone.length === 0 ? (
            <EmptyState title="No hay saldos pendientes por zona" />
          ) : (
            <div className="space-y-2">
              {byZone.map((z) => {
                const isSelected = selectedZone === z.effective_zone;
                return (
                  <button
                    key={z.effective_zone}
                    type="button"
                    onClick={() => onSelectZone(isSelected ? "" : z.effective_zone)}
                    className={`w-full rounded-xl border p-3 text-left text-xs transition cursor-pointer ${
                      isSelected
                        ? "border-bht-navy-deep bg-bht-mist"
                        : "border-bht-line bg-bht-paper/60 hover:bg-bht-mist/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-bht-ink-strong">
                        {z.effective_zone}
                      </span>
                      <span className="font-semibold text-bht-danger tabular-nums">
                        {formatPen(z.balance_due_pen)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-bht-ink-soft tabular-nums">
                      <span>{z.customers_count} clientes</span>
                      <span>{z.orders_count} ped.</span>
                      <span>&gt;30d: {formatPen(z.overdue_gt_30_pen)}</span>
                      <span>Promesas vencidas: {z.broken_promises_count}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card padding="md" className="space-y-3">
          <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
            Deudores Prioritarios ({byCustomer.length})
          </h3>
          {byCustomer.length === 0 ? (
            <EmptyState title="No hay clientes con deuda pendiente" />
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {byCustomer.slice(0, 15).map((c, idx) => (
                <div
                  key={`${c.customer_name}-${idx}`}
                  className="rounded-xl border border-bht-line bg-bht-paper/60 p-3 text-xs space-y-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-bht-ink-strong">
                        {c.customer_name}
                      </p>
                      <span className="text-bht-ink-soft">
                        {c.effective_zone}
                        {c.customer_phone ? ` · ${c.customer_phone}` : ""}
                      </span>
                    </div>
                    <Badge tone={c.max_days_overdue >= 30 ? "danger" : "warning"}>
                      {c.max_days_overdue} d
                    </Badge>
                  </div>
                  <div className="flex justify-between text-bht-ink-soft tabular-nums">
                    <span>
                      {c.orders_count} ped. · Próx. promesa:{" "}
                      {c.next_promise_date || "Sin fecha"}
                    </span>
                    <strong className="text-bht-danger">
                      {formatPen(c.balance_due_pen)}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Printable Collection Sheet by Zone */}
      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3
              id="collection-sheet-heading"
              className="text-base font-bold text-bht-ink-strong sm:text-lg"
            >
              Hoja de Cobranza por Zona ({collectionSheet.length} documentos)
            </h3>
            <p className="mt-0.5 text-xs text-bht-ink-soft">
              Lista ordenada por zona y antigüedad desde la venta para imprimir antes de
              salir a ruta.
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="no-print"
            onClick={() => window.print()}
          >
            Imprimir Hoja
          </Button>
        </div>

        {collectionSheet.length === 0 ? (
          <EmptyState title="No hay documentos por cobrar con estos filtros" />
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="collection-sheet-heading"
            className="table-wrapper"
          >
            <table className="w-full text-left text-sm">
              <thead className="border-b border-bht-line bg-bht-paper text-xs font-semibold uppercase tracking-wide text-bht-ink-soft">
                <tr>
                  <th scope="col" className="p-2">
                    Zona
                  </th>
                  <th scope="col" className="p-2">
                    Cliente / Teléfono
                  </th>
                  <th scope="col" className="p-2">
                    Pedido / Fecha
                  </th>
                  <th scope="col" className="p-2">
                    Condición / Límite / Promesa
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Vencimiento / Antigüedad
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Saldo Pend.
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bht-line">
                {collectionSheet.map((row) => {
                  const dueTone =
                    row.due_status === "OVERDUE"
                      ? "danger"
                      : row.due_status === "DUE_SOON"
                        ? "warning"
                        : row.due_status === "CURRENT"
                          ? "success"
                          : row.invoice_age_days > 60
                            ? "danger"
                            : row.invoice_age_days > 30
                              ? "warning"
                              : "neutral";
                  const dueLabel =
                    row.due_status === "OVERDUE"
                      ? `Vencido ${row.days_past_due ?? row.days_overdue} d`
                      : row.due_status === "DUE_SOON"
                        ? "Vence pronto"
                        : row.due_status === "CURRENT"
                          ? "Al día"
                          : `Antig. ${row.invoice_age_days} d`;
                  return (
                    <tr key={row.order_id} className="hover:bg-bht-paper">
                      <td className="p-2 font-medium text-bht-ink-strong">
                        {row.effective_zone}
                      </td>
                      <td className="p-2">
                        <p className="font-semibold text-bht-ink-strong">
                          {row.customer_name}
                        </p>
                        <span className="text-bht-ink-soft">
                          {row.customer_phone || "Sin teléfono"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap p-2 tabular-nums">
                        <p className="font-medium text-bht-navy-deep">
                          {row.order_code}
                        </p>
                        <span className="text-bht-ink-soft">{row.order_date}</span>
                      </td>
                      <td className="p-2">
                        <span className="block text-bht-ink-strong">
                          {formatPaymentModeEs(row.payment_mode)}
                        </span>
                        <span className="block text-xs text-bht-ink-soft tabular-nums">
                          {row.due_date ? `Vence: ${row.due_date}` : "Sin fecha límite"}
                        </span>
                        <span className="block text-xs text-bht-ink-soft tabular-nums">
                          {row.promised_payment_date
                            ? `Promesa: ${row.promised_payment_date} (${formatPromiseStatusEs(row.promise_status)})`
                            : "Sin fecha pactada"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap p-2 text-right tabular-nums">
                        <Badge tone={dueTone}>{dueLabel}</Badge>
                        <span className="mt-1 block text-xs text-bht-ink-muted">
                          Pedido hace {row.invoice_age_days} d
                        </span>
                      </td>
                      <td className="whitespace-nowrap p-2 text-right font-semibold text-bht-danger tabular-nums">
                        {formatPen(row.balance_due_pen)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ReportConceptModal
        concept={activeConcept}
        onClose={() => setActiveConcept(null)}
      />
    </div>
  );
}
