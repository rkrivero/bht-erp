"use client";

import { ReceiptIcon } from "@/components/ui/Icons";
import { Badge, Button, Card, EmptyState } from "@/components/ui/Primitives";
import type { SellerQuoteDto } from "./types";

interface SellerQuotesTabProps {
  quotes: SellerQuoteDto[];
  busyQuoteId: number | null;
  onCreate: () => void;
  onConvert: (quoteId: number, paymentMode: "CASH" | "CREDIT") => void;
  onCancel: (quoteId: number) => void;
}

export default function SellerQuotesTab({
  quotes,
  busyQuoteId,
  onCreate,
  onConvert,
  onCancel,
}: SellerQuotesTabProps) {
  return (
    <section aria-label="Cotizaciones" className="space-y-3">
      <Card padding="sm" className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[#18181B] sm:text-base">
            Cotizaciones ({quotes.length})
          </h2>
          <p className="text-xs text-[#5C5A55]">
            Arma ítems en Pedido y usa “Cotizar”, o convierte una cotización abierta en
            pedido real.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onCreate}>
          + Nueva Cotización
        </Button>
      </Card>
      {quotes.length === 0 ? (
        <EmptyState
          icon={<ReceiptIcon className="h-5 w-5" />}
          title="Sin cotizaciones registradas"
          description="Arma un pedido y presiona Cotizar para guardar una propuesta."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
          {quotes.map((quote) => {
            const busy = busyQuoteId === quote.quote_id;
            const tone =
              quote.status === "CONVERTED"
                ? "success"
                : quote.status === "OPEN"
                  ? "brand"
                  : "neutral";
            const status =
              quote.status === "OPEN"
                ? "Abierta"
                : quote.status === "CONVERTED"
                  ? `Pedido ${quote.converted_order_code || quote.related_cpe || ""}`.trim()
                  : quote.status === "EXPIRED"
                    ? "Vencida"
                    : "Anulada";
            return (
              <Card key={quote.quote_id} padding="md" className="space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-[#1E446B] tabular-nums">
                      {quote.quote_code} · {quote.issue_date}
                    </span>
                    <h3 className="text-sm font-semibold text-[#18181B] sm:text-base">
                      {quote.customer_name}
                    </h3>
                  </div>
                  <Badge tone={tone}>{status}</Badge>
                </div>
                <div className="divide-y divide-[#E7E5E0] rounded-lg border border-[#E7E5E0] bg-[#FAF9F6] px-2.5 py-1 text-xs">
                  {quote.lines.map((line) => (
                    <div
                      key={line.quote_line_id}
                      className="flex items-center justify-between gap-2 py-1.5"
                    >
                      <span className="min-w-0 truncate text-[#18181B]">
                        {line.quantity} {line.unit_of_measure} × {line.raw_description}
                      </span>
                      <span className="flex-shrink-0 font-semibold tabular-nums">
                        S/ {line.line_total_pen.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-[#0F2942] tabular-nums">
                    Total: S/ {quote.total_pen.toFixed(2)}
                  </span>
                  {quote.status === "OPEN" && (
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        variant="success"
                        size="sm"
                        data-compact="true"
                        disabled={busy}
                        onClick={() => onConvert(quote.quote_id, "CASH")}
                      >
                        Convertir Contado
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        data-compact="true"
                        disabled={busy}
                        onClick={() => onConvert(quote.quote_id, "CREDIT")}
                      >
                        A Crédito 7d
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-compact="true"
                        disabled={busy}
                        onClick={() => onCancel(quote.quote_id)}
                      >
                        Anular
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
