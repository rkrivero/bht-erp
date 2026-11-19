"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { CloseIcon, ReceiptIcon, SearchIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLASS,
  SegmentedControl,
} from "@/components/ui/Primitives";
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
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState<"OPEN" | "ALL">("OPEN");

  const openCount = useMemo(
    () => quotes.filter((q) => q.status === "OPEN").length,
    [quotes]
  );

  const filteredQuotes = useMemo(() => {
    const q = deferredSearch.trim().toLocaleLowerCase("es");
    return quotes.filter((quote) => {
      if (statusFilter === "OPEN" && quote.status !== "OPEN") return false;
      if (!q) return true;
      const inHeader =
        quote.quote_code.toLocaleLowerCase("es").includes(q) ||
        quote.customer_name.toLocaleLowerCase("es").includes(q);
      if (inHeader) return true;
      return quote.lines.some((line) =>
        `${line.sku ?? ""} ${line.raw_description ?? ""}`
          .toLocaleLowerCase("es")
          .includes(q)
      );
    });
  }, [quotes, statusFilter, deferredSearch]);

  return (
    <section aria-label="Cotizaciones" className="space-y-3">
      <Card padding="sm" className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
              Cotizaciones ({filteredQuotes.length}
              {filteredQuotes.length !== quotes.length ? ` de ${quotes.length}` : ""})
            </h2>
            <p className="text-xs text-bht-ink-soft">
              Arma ítems en Pedido y usa “Cotizar”, o convierte una cotización abierta
              en pedido real.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onCreate}>
            + Nueva Cotización
          </Button>
        </div>
        {quotes.length > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="relative min-w-0">
              <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-bht-ink-muted">
                <SearchIcon className="h-4 w-4" />
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Buscar cotizaciones"
                placeholder="Buscar por COT-, cliente o producto..."
                className={`${INPUT_CLASS} pl-10 pr-8`}
              />
              {search && (
                <button
                  type="button"
                  data-compact="true"
                  aria-label="Limpiar búsqueda de cotizaciones"
                  onClick={() => setSearch("")}
                  className="absolute inset-y-0 right-2.5 flex items-center text-bht-ink-muted hover:text-bht-ink-strong cursor-pointer"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              )}
            </div>
            <SegmentedControl<"OPEN" | "ALL">
              ariaLabel="Filtrar estado de cotizaciones"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { id: "OPEN", label: "Abiertas", count: openCount },
                { id: "ALL", label: "Todas", count: quotes.length },
              ]}
            />
          </div>
        )}
      </Card>
      {filteredQuotes.length === 0 ? (
        <EmptyState
          icon={<ReceiptIcon className="h-5 w-5" />}
          title={
            quotes.length === 0
              ? "Sin cotizaciones registradas"
              : "No hay cotizaciones en este filtro"
          }
          description={
            quotes.length === 0
              ? "Arma un pedido y presiona Cotizar para guardar una propuesta."
              : "Prueba otro texto de búsqueda o cambia a Todas."
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
          {filteredQuotes.map((quote) => {
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
                    <span className="text-xs font-semibold text-bht-navy-mid tabular-nums">
                      {quote.quote_code} · {quote.issue_date}
                    </span>
                    <h3 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
                      {quote.customer_name}
                    </h3>
                  </div>
                  <Badge tone={tone}>{status}</Badge>
                </div>
                <div className="divide-y divide-bht-line rounded-lg border border-bht-line bg-bht-paper px-2.5 py-1 text-xs">
                  {quote.lines.map((line) => (
                    <div
                      key={line.quote_line_id}
                      className="flex items-center justify-between gap-2 py-1.5"
                    >
                      <span className="min-w-0 truncate text-bht-ink-strong">
                        {line.quantity} {line.unit_of_measure} × {line.raw_description}
                      </span>
                      <span className="flex-shrink-0 font-semibold tabular-nums">
                        S/ {line.line_total_pen.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-bht-navy-deep tabular-nums">
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
