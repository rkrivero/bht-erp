"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { CloseIcon, SearchIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLASS,
  SegmentedControl,
} from "@/components/ui/Primitives";
import type { SellerQuoteDto } from "@/features/seller/types";
import { formatQuoteStatusEs } from "@/lib/labels-es";
import { formatPen } from "./types";

type QuoteStatusFilter = "OPEN" | "ALL" | "CONVERTED" | "CANCELLED";

interface PartnerQuotesPanelProps {
  quotes: SellerQuoteDto[];
  busyQuoteId: number | null;
  onSelectQuote: (quote: SellerQuoteDto) => void;
  onConvertQuote: (quoteId: number, mode: "CASH" | "CREDIT") => void;
  onCancelQuote: (quoteId: number) => void;
}

export function PartnerQuotesPanel({
  quotes,
  busyQuoteId,
  onSelectQuote,
  onConvertQuote,
  onCancelQuote,
}: PartnerQuotesPanelProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState<QuoteStatusFilter>("OPEN");

  const openCount = useMemo(
    () => quotes.filter((q) => q.status === "OPEN").length,
    [quotes]
  );

  const filteredQuotes = useMemo(() => {
    const q = deferredSearch.trim().toLocaleLowerCase("es");
    return quotes.filter((quote) => {
      if (statusFilter !== "ALL" && quote.status !== statusFilter) return false;
      if (!q) return true;
      const code = String(quote.quote_code || "").toLocaleLowerCase("es");
      const customer = String(quote.customer_name || "").toLocaleLowerCase("es");
      const seller = String(quote.seller_name || "").toLocaleLowerCase("es");
      const hasLineMatch = Array.isArray(quote.lines)
        ? quote.lines.some((line) =>
            `${line.sku ?? ""} ${line.raw_description ?? ""}`
              .toLocaleLowerCase("es")
              .includes(q)
          )
        : false;
      return (
        code.includes(q) || customer.includes(q) || seller.includes(q) || hasLineMatch
      );
    });
  }, [quotes, statusFilter, deferredSearch]);

  return (
    <Card padding="md" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-bht-ink-strong">
            Cotizaciones Comerciales ({filteredQuotes.length}
            {filteredQuotes.length !== quotes.length ? ` de ${quotes.length}` : ""})
          </h2>
          <p className="text-xs text-bht-ink-soft">
            Revisa cualquier cotización o conviértela en pedido al contado o crédito sin
            bloqueos por stock.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(260px,1fr)_auto] xl:items-center">
        <div className="relative min-w-0">
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-bht-ink-muted">
            <SearchIcon className="h-4 w-4" />
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar cotizaciones por código, cliente o producto"
            placeholder="Buscar por COT-, cliente, vendedor o SKU..."
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
        <SegmentedControl<QuoteStatusFilter>
          ariaLabel="Filtrar cotizaciones por estado"
          value={statusFilter}
          onChange={setStatusFilter}
          className="w-full xl:w-auto"
          options={[
            { id: "OPEN", label: "Abiertas", count: openCount },
            { id: "ALL", label: "Todas", count: quotes.length },
            { id: "CONVERTED", label: "Convertidas" },
            { id: "CANCELLED", label: "Anuladas" },
          ]}
        />
      </div>

      {filteredQuotes.length === 0 ? (
        <EmptyState title="No hay cotizaciones en este filtro" />
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {filteredQuotes.map((q) => {
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
                    <span className="text-xs font-semibold text-bht-navy-mid tabular-nums">
                      {String(q.quote_code)} · {String(q.issue_date)}
                    </span>
                    <p className="truncate text-base font-bold text-bht-ink-strong">
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
                  onClick={() => onSelectQuote(q)}
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
                      onClick={() => onConvertQuote(qId, "CASH")}
                    >
                      Convertir Contado
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      data-compact="true"
                      disabled={isBusy}
                      onClick={() => onConvertQuote(qId, "CREDIT")}
                    >
                      A Crédito
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-compact="true"
                      disabled={isBusy}
                      onClick={() => onCancelQuote(qId)}
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
  );
}
