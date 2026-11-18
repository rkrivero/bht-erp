"use client";

import React from "react";
import { formatPen } from "@/components/socios/types";
import {} from "@/components/shared/CollectionControls";
import {} from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLASS,
} from "@/components/ui/Primitives";
import { formatQuoteStatusEs, formatRouteTripStatusEs } from "@/lib/labels-es";
import {} from "./partnerShared";
import type { PartnerData } from "./usePartnerData";
import type { OrderFlow } from "./useOrderFlow";

interface HoyRoutesQuotesProps {
  routeTrips: PartnerData["routeTrips"];
  partnerQuotes: PartnerData["partnerQuotes"];
  flow: OrderFlow;
}

export function HoyRoutesQuotes({
  routeTrips,
  partnerQuotes,
  flow,
}: HoyRoutesQuotesProps) {
  const {
    busyTripId,
    tripDeclaredNetById,
    setTripDeclaredNetById,
    busyQuoteId,
    setSelectedPartnerQuote,
    handlePartnerTripAction,
    handlePartnerConvertQuote,
    handlePartnerCancelQuote,
  } = flow;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card padding="md" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-bht-ink-strong">
              Rutas y Despachos ({routeTrips.length})
            </h2>
            <p className="text-xs text-bht-ink-soft">
              Cierra la ruta y compara lo cobrado en el día con los pedidos registrados.
            </p>
          </div>
        </div>
        {routeTrips.length === 0 ? (
          <EmptyState title="Sin rutas registradas" />
        ) : (
          <div className="space-y-2.5">
            {routeTrips.slice(0, 8).map((tr) => {
              const tId = Number(tr.trip_id);
              const status = String(tr.status);
              const isBusy = busyTripId === tId;
              return (
                <div
                  key={tId}
                  className="rounded-xl border border-bht-line bg-bht-paper p-3 text-xs space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-bht-navy-deep tabular-nums">
                        {String(tr.trip_code)} · {String(tr.trip_date)}
                      </span>
                      <p className="text-bht-ink-soft">
                        {String(tr.zone_name || "Ruta")} ·{" "}
                        {String(tr.driver_name || "Reparto")} ·{" "}
                        {Number(tr.order_count ?? 0)} pedido(s) (
                        {Number(tr.in_route_count ?? 0)} en ruta /{" "}
                        {Number(tr.delivered_count ?? 0)} entregados)
                      </p>
                      <p className="mt-1 text-bht-ink-soft tabular-nums">
                        Ventas registradas:{" "}
                        <strong className="text-bht-ink-strong">
                          {formatPen(tr.computed_sales_pen)}
                        </strong>
                      </p>
                    </div>
                    <Badge
                      tone={
                        status === "RECONCILED"
                          ? "success"
                          : status === "CLOSED"
                            ? "brand"
                            : "warning"
                      }
                    >
                      {formatRouteTripStatusEs(status)}
                    </Badge>
                  </div>
                  {status !== "RECONCILED" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex flex-col gap-1 text-xs font-medium text-bht-ink-soft">
                        Cobrado del día (S/)
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Total cobrado"
                          aria-label={`Cobrado del día de la ruta ${String(tr.trip_code)}`}
                          value={tripDeclaredNetById[tId] ?? ""}
                          onChange={(e) =>
                            setTripDeclaredNetById((prev) => ({
                              ...prev,
                              [tId]: e.target.value,
                            }))
                          }
                          className={`${INPUT_CLASS} w-40 py-1.5 text-xs tabular-nums`}
                        />
                      </label>
                      {status === "OPEN" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-compact="true"
                          disabled={isBusy}
                          onClick={() => handlePartnerTripAction(tId, "CLOSED")}
                        >
                          Cerrar
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="success"
                        size="sm"
                        data-compact="true"
                        disabled={isBusy}
                        onClick={() => handlePartnerTripAction(tId, "RECONCILED")}
                      >
                        Conciliar
                      </Button>
                    </div>
                  )}
                  {status !== "RECONCILED" && (
                    <p className="text-xs text-bht-ink-muted">
                      Ingresa lo cobrado por las ventas de ese día. Los gastos de ruta
                      se registran aparte, incluso retroactivamente; no se descuentan
                      aquí. El monto es opcional si solo necesitas marcar la ruta como
                      revisada.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card padding="md" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-bht-ink-strong">
              Ventas y Cotizaciones Comerciales ({partnerQuotes.length})
            </h2>
            <p className="text-xs text-bht-ink-soft">
              Revisa el detalle de cualquier venta; las abiertas también pueden
              convertirse en pedido.
            </p>
          </div>
        </div>
        {partnerQuotes.length === 0 ? (
          <EmptyState title="Sin cotizaciones recientes" />
        ) : (
          <div className="space-y-2.5">
            {partnerQuotes.slice(0, 8).map((q) => {
              const qId = Number(q.quote_id);
              const status = String(q.status);
              const isBusy = busyQuoteId === qId;
              return (
                <div
                  key={qId}
                  className="rounded-xl border border-bht-line bg-bht-paper p-3 text-xs space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-semibold text-bht-navy-mid tabular-nums">
                        {String(q.quote_code)} · {String(q.issue_date)}
                      </span>
                      <p className="truncate font-semibold text-bht-ink-strong">
                        {String(q.customer_name)}
                      </p>
                      <p className="text-bht-ink-soft tabular-nums">
                        Total: {formatPen(q.total_pen)} ·{" "}
                        {Array.isArray(q.lines) ? q.lines.length : 0} ítem(s)
                      </p>
                    </div>
                    <Badge
                      tone={
                        status === "CONVERTED"
                          ? "success"
                          : status === "OPEN"
                            ? "brand"
                            : "neutral"
                      }
                    >
                      {status === "CONVERTED"
                        ? `Pedido ${String(q.converted_order_code || q.related_cpe || "")}`.trim()
                        : formatQuoteStatusEs(status)}
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-compact="true"
                    onClick={() => setSelectedPartnerQuote(q)}
                    className="w-full"
                  >
                    Ver detalle
                  </Button>
                  {status === "OPEN" && (
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        variant="success"
                        size="sm"
                        data-compact="true"
                        disabled={isBusy}
                        onClick={() => handlePartnerConvertQuote(qId, "CASH")}
                      >
                        Convertir Contado
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        data-compact="true"
                        disabled={isBusy}
                        onClick={() => handlePartnerConvertQuote(qId, "CREDIT")}
                      >
                        A Crédito
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-compact="true"
                        disabled={isBusy}
                        onClick={() => handlePartnerCancelQuote(qId)}
                      >
                        Anular
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
