"use client";

import React from "react";
import { formatPen } from "@/components/socios/types";
import { Badge, Button, Card, EmptyState } from "@/components/ui/Primitives";
import { formatQuoteStatusEs, formatRouteTripStatusEs } from "@/lib/labels-es";
import type { PartnerData } from "./usePartnerData";
import type { OrderFlow } from "./useOrderFlow";

interface HoyRoutesQuotesProps {
  routeTrips: PartnerData["routeTrips"];
  partnerQuotes: PartnerData["partnerQuotes"];
  flow: OrderFlow;
  onOpenReports: () => void;
  onOpenOrders: () => void;
}

export function HoyRoutesQuotes({
  routeTrips,
  partnerQuotes,
  flow,
  onOpenReports,
  onOpenOrders,
}: HoyRoutesQuotesProps) {
  const {
    busyTripId,
    busyQuoteId,
    setSelectedPartnerQuote,
    handlePartnerTripAction,
    handlePartnerConvertQuote,
    handlePartnerCancelQuote,
  } = flow;

  const openTrips = routeTrips.filter((tr) => String(tr.status) === "OPEN");
  const visibleTrips = openTrips.length > 0 ? openTrips : routeTrips.slice(0, 3);
  const openQuotes = partnerQuotes.filter((q) => String(q.status) === "OPEN");

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-bht-ink-strong">
              Rutas Activas
            </h2>
            <p className="text-xs text-bht-ink-soft">
              {openTrips.length > 0
                ? "Salidas de reparto actualmente abiertas para control y cierre."
                : "Sin salidas abiertas hoy; últimos 3 viajes registrados."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={openTrips.length > 0 ? "warning" : "neutral"}>
              {openTrips.length > 0
                ? `${openTrips.length} en ruta`
                : `${routeTrips.length} registradas`}
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-compact="true"
              onClick={onOpenReports}
            >
              Ver rentabilidad en Reportes →
            </Button>
          </div>
        </div>

        {visibleTrips.length === 0 ? (
          <EmptyState title="Sin rutas registradas" />
        ) : (
          <div className="space-y-2.5">
            {visibleTrips.map((tr) => {
              const tId = Number(tr.trip_id);
              const status = String(tr.status);
              const isBusy = busyTripId === tId;
              return (
                <div
                  key={tId}
                  className="rounded-xl border border-bht-line bg-bht-paper p-3 text-sm space-y-2"
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
                    <Badge tone={status === "OPEN" ? "warning" : "success"}>
                      {formatRouteTripStatusEs(status)}
                    </Badge>
                  </div>
                  {status === "OPEN" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="success"
                        size="sm"
                        data-compact="true"
                        disabled={isBusy}
                        onClick={() =>
                          handlePartnerTripAction(
                            tId,
                            Number(tr.computed_sales_pen ?? 0)
                          )
                        }
                      >
                        Cerrar ruta
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-bht-ink-strong">
              Cotizaciones Abiertas ({openQuotes.length})
            </h2>
            <p className="text-xs text-bht-ink-soft">
              Cotizaciones pendientes listas para convertir en pedido de contado o
              crédito.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-compact="true"
            onClick={onOpenOrders}
          >
            Ver todas en Pedidos →
          </Button>
        </div>

        {openQuotes.length === 0 ? (
          <EmptyState title="No hay cotizaciones abiertas pendientes" />
        ) : (
          <div className="space-y-2.5">
            {openQuotes.slice(0, 5).map((q) => {
              const qId = Number(q.quote_id);
              const status = String(q.status);
              const isBusy = busyQuoteId === qId;
              return (
                <div
                  key={qId}
                  className="rounded-xl border border-bht-line bg-bht-paper p-3 text-sm space-y-2"
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
                    <Badge tone="brand">{formatQuoteStatusEs(status)}</Badge>
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
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
