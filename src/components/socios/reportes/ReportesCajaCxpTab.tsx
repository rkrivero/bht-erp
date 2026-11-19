"use client";

import React, { useState } from "react";
import { Badge, Button, Card, EmptyState } from "@/components/ui/Primitives";
import { formatAccountTypeEs, formatApStatusEs } from "@/lib/labels-es";
import { formatPen } from "../types";
import {
  type ActiveReportConcept,
  ConceptCardButton,
  ReportConceptModal,
} from "./ReportConceptModal";
import { type ReportCajaCxpDto, formatMaturityBucketEs } from "./reportes-types";

interface ReportesCajaCxpTabProps {
  data: ReportCajaCxpDto;
  onOpenCaja: () => void;
}

export default function ReportesCajaCxpTab({
  data,
  onOpenCaja,
}: ReportesCajaCxpTabProps) {
  const [activeConcept, setActiveConcept] = useState<ActiveReportConcept | null>(null);
  const {
    liquiditySummary,
    cashAccounts,
    apMaturityBuckets,
    upcomingApDocs,
    apBySupplier,
  } = data;

  const maxBucketAmount = Math.max(1, ...apMaturityBuckets.map((b) => b.balanceDuePen));

  return (
    <div className="min-w-0 space-y-4">
      <Card tone="warning" padding="sm" className="text-xs text-bht-ink-strong">
        <strong>Saldos registrados, no conciliados:</strong> confirma caja física y
        extractos bancarios antes de usar estas cifras como dinero disponible.
      </Card>

      {/* Liquidity vs AP 30d Coverage Cards */}
      <section
        aria-label="Liquidez y cobertura de CxP"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <ConceptCardButton
          onClick={() =>
            setActiveConcept({
              id: "saldo_cuentas_liquidas",
              currentValue: formatPen(liquiditySummary.liquidCashPen),
              currentSubtext: "Bancos, cajas y billeteras digitales",
            })
          }
        >
          <span className="text-sm font-semibold text-bht-ink-soft">
            Saldo registrado en cuentas líquidas
          </span>
          <p className="text-2xl font-semibold text-bht-navy-deep tabular-nums">
            {formatPen(liquiditySummary.liquidCashPen)}
          </p>
          <span className="block text-xs text-bht-ink-soft">
            Bancos, cajas y billeteras digitales
          </span>
        </ConceptCardButton>

        <ConceptCardButton
          onClick={() =>
            setActiveConcept({
              id: "custodia_socios",
              currentValue: formatPen(liquiditySummary.partnerCustodyPen),
              currentSubtext: `Saldo total cuentas: ${formatPen(liquiditySummary.totalCashPen)}`,
            })
          }
        >
          <span className="text-sm font-semibold text-bht-ink-soft">
            Custodia de Socios (por rendir)
          </span>
          <p className="text-2xl font-semibold text-bht-warning tabular-nums">
            {formatPen(liquiditySummary.partnerCustodyPen)}
          </p>
          <span className="block text-xs text-bht-ink-soft tabular-nums">
            Saldo total cuentas: {formatPen(liquiditySummary.totalCashPen)}
          </span>
        </ConceptCardButton>

        <ConceptCardButton
          onClick={() =>
            setActiveConcept({
              id: "total_cxp_abiertas",
              currentValue: formatPen(liquiditySummary.totalOpenApPen),
              currentSubtext: `Vencidas + ≤30d: ${formatPen(liquiditySummary.dueWithin30dPen)}`,
            })
          }
        >
          <span className="text-sm font-semibold text-bht-ink-soft">
            Total CxP Abiertas
          </span>
          <p className="text-2xl font-semibold text-bht-danger tabular-nums">
            {formatPen(liquiditySummary.totalOpenApPen)}
          </p>
          <span className="block text-xs text-bht-ink-soft tabular-nums">
            Vencidas + ≤30d: {formatPen(liquiditySummary.dueWithin30dPen)}
          </span>
        </ConceptCardButton>

        <ConceptCardButton
          tone={liquiditySummary.netLiquidityAfter30dApPen >= 0 ? "success" : "danger"}
          onClick={() =>
            setActiveConcept({
              id: "cobertura_cxp_30d",
              currentValue: formatPen(liquiditySummary.netLiquidityAfter30dApPen),
              currentSubtext:
                liquiditySummary.netLiquidityAfter30dApPen >= 0
                  ? "El saldo registrado cubre CxP ≤30d"
                  : "El saldo registrado no cubre CxP ≤30d",
            })
          }
        >
          <span className="text-sm font-semibold text-bht-ink-soft">
            Cobertura registrada tras CxP ≤30d
          </span>
          <p
            className={`text-2xl font-semibold tabular-nums ${
              liquiditySummary.netLiquidityAfter30dApPen >= 0
                ? "text-bht-success"
                : "text-bht-danger"
            }`}
          >
            {formatPen(liquiditySummary.netLiquidityAfter30dApPen)}
          </p>
          <Badge
            tone={
              liquiditySummary.netLiquidityAfter30dApPen >= 0 ? "success" : "danger"
            }
          >
            {liquiditySummary.netLiquidityAfter30dApPen >= 0
              ? "El saldo registrado cubre CxP ≤30d"
              : "El saldo registrado no cubre CxP ≤30d"}
          </Badge>
        </ConceptCardButton>
      </section>

      {/* AP Maturity Horizon 7 / 15 / 30d */}
      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
              Proyección de Vencimientos CxP (Vencidas / 7 / 15 / 30 días)
            </h3>
            <p className="mt-0.5 text-xs text-bht-ink-soft">
              Obligaciones abiertas y parciales clasificadas según su fecha de
              vencimiento.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onOpenCaja}>
            Gestionar pagos en Caja →
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {apMaturityBuckets.map((b) => {
            const pct = Math.min(
              100,
              Math.max(
                b.balanceDuePen > 0 ? 4 : 0,
                (b.balanceDuePen / maxBucketAmount) * 100
              )
            );
            const barColor =
              b.bucket === "OVERDUE"
                ? "bg-bht-danger-vivid"
                : b.bucket === "DUE_0_7"
                  ? "bg-bht-tone-d97706"
                  : "bg-bht-navy-mid";
            return (
              <div
                key={b.bucket}
                className="rounded-xl border border-bht-line bg-bht-paper/60 p-3 text-xs space-y-1.5"
              >
                <span className="block font-medium text-bht-ink-soft">
                  {formatMaturityBucketEs(b.bucket)}
                </span>
                <p className="text-base font-semibold text-bht-ink-strong tabular-nums">
                  {formatPen(b.balanceDuePen)}
                </p>
                <span className="block text-xs text-bht-ink-muted tabular-nums">
                  {b.docsCount} doc(s)
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

      {/* Accounts Breakdown */}
      <Card padding="md" className="space-y-3">
        <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
          Saldos registrados por caja, banco y custodia
        </h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {cashAccounts.map((acc) => (
            <div
              key={acc.account_id}
              className="rounded-xl border border-bht-line bg-bht-paper/60 p-3 text-xs space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-bht-ink-strong">{acc.name}</p>
                  <span className="text-bht-ink-soft">
                    {formatAccountTypeEs(acc.account_type)}
                  </span>
                </div>
                <Badge
                  tone={acc.net_balance_pen >= 0 ? "success" : "danger"}
                  className="tabular-nums"
                >
                  {formatPen(acc.net_balance_pen)}
                </Badge>
              </div>
              <div className="flex justify-between text-bht-ink-soft tabular-nums">
                <span>Ingresos: {formatPen(acc.total_in_pen)}</span>
                <span>Salidas: {formatPen(acc.total_out_pen)}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Upcoming AP Schedule + Supplier Summary */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card padding="md" className="space-y-3 lg:col-span-2">
          <h3
            id="ap-schedule-heading"
            className="text-base font-bold text-bht-ink-strong sm:text-lg"
          >
            Calendario de Pagos Pendientes ({upcomingApDocs.length})
          </h3>
          {upcomingApDocs.length === 0 ? (
            <EmptyState title="No hay cuentas por pagar pendientes" />
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-labelledby="ap-schedule-heading"
              className="table-wrapper"
            >
              <table className="w-full text-left text-sm">
                <thead className="border-b border-bht-line bg-bht-paper text-xs font-semibold uppercase tracking-wide text-bht-ink-soft">
                  <tr>
                    <th scope="col" className="p-2">
                      Documento / Proveedor
                    </th>
                    <th scope="col" className="p-2">
                      Vencimiento
                    </th>
                    <th scope="col" className="p-2">
                      Tramo
                    </th>
                    <th scope="col" className="p-2">
                      Estado
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Saldo
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bht-line">
                  {upcomingApDocs.map((doc) => (
                    <tr key={doc.ap_id} className="hover:bg-bht-paper">
                      <td className="p-2">
                        <p className="font-semibold text-bht-ink-strong">
                          {doc.doc_ref}
                        </p>
                        <span className="text-bht-ink-soft">{doc.supplier_name}</span>
                      </td>
                      <td className="whitespace-nowrap p-2 tabular-nums text-bht-ink-soft">
                        {doc.due_date || "Sin fecha"}
                      </td>
                      <td className="whitespace-nowrap p-2">
                        <Badge
                          tone={
                            doc.maturity_bucket === "OVERDUE"
                              ? "danger"
                              : doc.maturity_bucket === "DUE_0_7"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {formatMaturityBucketEs(doc.maturity_bucket)}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap p-2 text-bht-ink-soft">
                        {formatApStatusEs(doc.status)}
                      </td>
                      <td className="whitespace-nowrap p-2 text-right font-semibold text-bht-danger tabular-nums">
                        {formatPen(doc.balance_due_pen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card padding="md" className="space-y-3">
          <h3 className="text-base font-bold text-bht-ink-strong sm:text-lg">
            CxP por Proveedor
          </h3>
          {apBySupplier.length === 0 ? (
            <EmptyState title="Sin obligaciones por proveedor" />
          ) : (
            <div className="space-y-2">
              {apBySupplier.map((sup, idx) => (
                <div
                  key={`${sup.supplier_name}-${idx}`}
                  className="rounded-xl border border-bht-line bg-bht-paper/60 p-3 text-xs space-y-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-bht-ink-strong">
                      {sup.supplier_name}
                    </p>
                    <Badge tone="neutral">{sup.open_docs_count} pend.</Badge>
                  </div>
                  <div className="flex justify-between text-bht-ink-soft tabular-nums">
                    <span>Facturado: {formatPen(sup.total_billed_pen)}</span>
                    <strong
                      className={
                        sup.total_balance_due_pen > 0
                          ? "text-bht-danger"
                          : "text-bht-success"
                      }
                    >
                      Saldo: {formatPen(sup.total_balance_due_pen)}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <ReportConceptModal
        concept={activeConcept}
        onClose={() => setActiveConcept(null)}
      />
    </div>
  );
}
