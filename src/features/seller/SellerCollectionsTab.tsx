"use client";

import {
  PromiseFilterBar,
  PromiseStatusPill,
} from "@/components/shared/CollectionControls";
import {
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  PlusIcon,
  SearchIcon,
  WalletIcon,
} from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLASS,
  SegmentedControl,
} from "@/components/ui/Primitives";
import { formatPaymentModeEs } from "@/lib/labels-es";
import type { SellerCollections } from "@/features/seller/useSellerCollections";

export default function SellerCollectionsTab({
  collections,
}: {
  collections: SellerCollections;
}) {
  const {
    collectionSummary,
    debtorView,
    setDebtorView,
    debtorsByOrder,
    debtorsByCustomer,
    debtorSearch,
    setDebtorSearch,
    promiseFilter,
    setPromiseFilter,
    filteredDebtOrders,
    prioritizedDebtOrders,
    filteredDebtorsByCustomer,
    setDebtDetailTarget,
    startOrderAbono,
    startCustomerAbono,
    timelineOrderId,
    timelineEntries,
    timelineLoadingId,
    handleOpenTimeline,
  } = collections;
  return (
    <section aria-label="Cobros y deudores" className="space-y-3.5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {[
          {
            label: "Saldo pendiente",
            amount: collectionSummary.total,
            tone: "text-bht-navy-deep",
          },
          {
            label: "Cobrar hoy / mañana",
            amount: collectionSummary.dueSoon,
            tone: "text-bht-warning",
          },
          {
            label: "Promesa vencida",
            amount: collectionSummary.overdue,
            tone: "text-bht-danger",
          },
        ].map((item) => (
          <Card key={item.label} padding="sm" className="space-y-1">
            <p className="text-xs text-bht-ink-soft">{item.label}</p>
            <p className={`text-lg font-semibold tabular-nums ${item.tone}`}>
              S/ {item.amount.toFixed(2)}
            </p>
          </Card>
        ))}
      </div>
      <Card padding="sm" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <SegmentedControl
            ariaLabel="Agrupación de cobros"
            value={debtorView}
            onChange={setDebtorView}
            options={[
              {
                id: "orders",
                label: "Por Pedido",
                count: debtorsByOrder.length,
              },
              {
                id: "customers",
                label: "Por Cliente",
                count: debtorsByCustomer.length,
              },
            ]}
          />
          <div className="relative w-full sm:w-64">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-bht-ink-muted">
              <SearchIcon className="h-3.5 w-3.5" />
            </span>
            <input
              type="text"
              value={debtorSearch}
              onChange={(e) => setDebtorSearch(e.target.value)}
              aria-label="Buscar cliente o pedido en cobros"
              placeholder="Buscar cliente o pedido..."
              className={`${INPUT_CLASS} py-1.5 pl-9 pr-8 text-xs`}
            />
            {debtorSearch && (
              <button
                type="button"
                data-compact="true"
                aria-label="Limpiar búsqueda de cobros"
                onClick={() => setDebtorSearch("")}
                className="absolute inset-y-0 right-2 flex items-center text-bht-ink-muted hover:text-bht-ink-strong cursor-pointer"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {debtorView === "orders" && (
          <PromiseFilterBar
            value={promiseFilter}
            onChange={setPromiseFilter}
            totalCount={debtorsByOrder.length}
          />
        )}
      </Card>

      {debtorView === "orders" ? (
        filteredDebtOrders.length === 0 ? (
          <EmptyState
            icon={<WalletIcon className="h-5 w-5" />}
            title="Sin cobros pendientes en este filtro"
            description="Prueba seleccionando 'Todos' o cambia a la vista por cliente."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:items-start">
            {prioritizedDebtOrders.map((item) => {
              const lineCount = Array.isArray(item.lines) ? item.lines.length : 0;
              return (
                <Card key={item.orderId} padding="md" className="space-y-3">
                  <button
                    type="button"
                    onClick={() =>
                      setDebtDetailTarget({
                        mode: "order",
                        orderId: item.orderId,
                      })
                    }
                    aria-label={`Ver detalle de productos del pedido ${item.orderCode} de ${item.customerName}`}
                    className="w-full space-y-2.5 text-left rounded-xl transition hover:bg-bht-mist/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep/45 cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-bht-navy-mid tabular-nums">
                          {item.orderCode} · {item.orderDate}
                        </span>
                        <h2 className="mt-0.5 text-sm sm:text-base font-semibold text-bht-ink-strong">
                          {item.customerName}
                        </h2>
                      </div>
                      <Badge
                        tone={
                          item.agingBucket === "RED_30_PLUS"
                            ? "danger"
                            : item.agingBucket === "AMBER_8_29"
                              ? "warning"
                              : "success"
                        }
                        className="tabular-nums"
                      >
                        Hace {item.daysOverdue} días
                      </Badge>
                    </div>

                    <div className="grid grid-cols-3 gap-2 rounded-xl bg-bht-mist/70 p-2.5 text-xs tabular-nums">
                      <div>
                        <span className="block text-xs text-bht-ink-soft">Total</span>
                        <span className="font-semibold text-bht-ink-strong">
                          S/ {item.totalPen.toFixed(2)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-xs text-bht-ink-soft">
                          Abonado ({item.paymentCount})
                        </span>
                        <span className="font-semibold text-bht-success">
                          S/ {item.paidPen.toFixed(2)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="block text-xs text-bht-ink-soft">
                          Saldo pendiente
                        </span>
                        <span className="text-sm font-semibold text-bht-danger">
                          S/ {item.balanceDuePen.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-bht-ink-soft">
                      <span>
                        Pactado:{" "}
                        <strong className="text-bht-ink-strong">
                          {item.promisedPaymentDate || "No pactada"}
                        </strong>
                      </span>
                      <div className="flex items-center gap-2">
                        <PromiseStatusPill status={item.promiseStatus} />
                        <span className="inline-flex items-center gap-0.5 font-medium text-bht-navy-mid">
                          {lineCount > 0 ? `${lineCount} prod.` : "Ver detalle"}
                          <ChevronRightIcon className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </div>
                  </button>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      aria-label={`Registrar abono para ${item.customerName}, pedido ${item.orderCode}`}
                      onClick={() => startOrderAbono(item)}
                      className="flex-1"
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                      Registrar Abono
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-expanded={timelineOrderId === item.orderId}
                      aria-label={`Ver historial de pagos del pedido ${item.orderCode}`}
                      disabled={timelineLoadingId === item.orderId}
                      onClick={() => handleOpenTimeline(item.orderId)}
                    >
                      <ClockIcon className="h-3.5 w-3.5" />
                      {timelineLoadingId === item.orderId
                        ? "Cargando..."
                        : `Historial (${item.paymentCount})`}
                    </Button>
                  </div>

                  {timelineOrderId === item.orderId && (
                    <div className="rounded-xl border border-bht-line-blue bg-bht-mist/60 p-3 text-xs">
                      <p className="mb-2 font-semibold text-bht-navy-deep">
                        Historial de pagos de este pedido
                      </p>
                      {timelineEntries.length === 0 ? (
                        <p className="text-bht-ink-soft">Sin abonos previos.</p>
                      ) : (
                        <ul className="divide-y divide-bht-line-blue/70">
                          {timelineEntries.map((t) => (
                            <li
                              key={String(t.arPaymentId)}
                              className="flex items-center justify-between gap-2 py-1.5"
                            >
                              <span className="text-bht-ink-soft">
                                {String(t.paymentDate)} ·{" "}
                                {formatPaymentModeEs(t.paymentMode)} (
                                {String(t.collectedByName || "Histórico")})
                              </span>
                              <strong className="font-semibold text-bht-success tabular-nums">
                                S/ {Number(t.amountPen).toFixed(2)}
                              </strong>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )
      ) : filteredDebtorsByCustomer.length === 0 ? (
        <EmptyState
          icon={<WalletIcon className="h-5 w-5" />}
          title={
            debtorSearch
              ? "No hay clientes que coincidan con tu búsqueda"
              : "Sin clientes con saldo pendiente"
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:items-start">
          {filteredDebtorsByCustomer.map((c) => (
            <Card key={c.customerKey} padding="md" className="space-y-2.5">
              <button
                type="button"
                onClick={() =>
                  setDebtDetailTarget({
                    mode: "customer",
                    customerKey: c.customerKey,
                    customerName: c.customerName,
                    customerPartyId: c.customerPartyId,
                  })
                }
                aria-label={`Ver pedidos y productos que debe ${c.customerName}`}
                className="w-full space-y-1.5 text-left rounded-xl transition hover:bg-bht-mist/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep/45 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm sm:text-base font-semibold text-bht-ink-strong">
                    {c.customerName}
                  </h2>
                  <Badge tone="danger" className="tabular-nums">
                    Debe S/ {c.totalBalanceDuePen.toFixed(2)}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-bht-ink-soft tabular-nums">
                  <span>
                    {c.openOrdersCount} pedido(s) · Antigüedad máx: {c.maxDaysOverdue}{" "}
                    días · Próxima visita: {c.earliestPromisedPaymentDate || "-"}
                  </span>
                  <span className="inline-flex items-center gap-0.5 font-medium text-bht-navy-mid">
                    Ver detalle
                    <ChevronRightIcon className="h-3.5 w-3.5" />
                  </span>
                </div>
              </button>
              {c.customerPartyId && (
                <Button
                  variant="primary"
                  size="sm"
                  aria-label={`Abonar a cuenta de ${c.customerName}`}
                  onClick={() => startCustomerAbono(c)}
                  className="w-full"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Abonar a Cuenta (deudas más antiguas)
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
