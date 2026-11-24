"use client";

import React from "react";
import { formatPen } from "@/components/socios/types";
import {
  AbonoModal,
  DebtorDetailModal,
  PromiseFilterBar,
  PromiseStatusPill,
} from "@/components/shared/CollectionControls";
import {
  ChevronRightIcon,
  CloseIcon,
  PlusIcon,
  SearchIcon,
} from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLASS,
} from "@/components/ui/Primitives";
import { formatPromiseStatusEs } from "@/lib/labels-es";
import {} from "./partnerShared";
import type { PartnerData } from "./usePartnerData";
import type { CollectionsFlow } from "./useCollectionsFlow";

interface CobranzaProps {
  data: PartnerData;
  flow: CollectionsFlow;
}

export function Cobranza({ data, flow }: CobranzaProps) {
  const { debtorsByOrder } = data;
  const {
    collectionSummary,
    debtorSearch,
    setDebtorSearch,
    promiseFilter,
    setPromiseFilter,
    filteredDebtorsByCustomer,
    filteredDebtorsByOrder,
    prioritizedDebtorsByOrder,
    setDebtDetailTarget,
    setAbonoOrder,
    setFifoCustomer,
    setAbonoAmount,
    setAbonoAccountId,
  } = flow;
  return (
    <div className="space-y-4">
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
            <p className="text-xs sm:text-sm font-medium text-bht-ink-soft">
              {item.label}
            </p>
            <p className={`text-xl font-bold sm:text-2xl tabular-nums ${item.tone}`}>
              S/ {item.amount.toFixed(2)}
            </p>
          </Card>
        ))}
      </div>
      <Card padding="sm" className="space-y-2.5">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-bht-ink-muted">
            <SearchIcon className="h-4 w-4" />
          </span>
          <input
            type="text"
            value={debtorSearch}
            onChange={(e) => setDebtorSearch(e.target.value)}
            aria-label="Buscar cliente o código de pedido en deudores"
            placeholder="Buscar cliente o pedido pendiente..."
            className={`${INPUT_CLASS} pl-10 pr-8`}
          />
          {debtorSearch && (
            <button
              type="button"
              data-compact="true"
              aria-label="Limpiar búsqueda de deudores"
              onClick={() => setDebtorSearch("")}
              className="absolute inset-y-0 right-2.5 flex items-center text-bht-ink-muted hover:text-bht-ink-strong cursor-pointer"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        <PromiseFilterBar
          value={promiseFilter}
          onChange={setPromiseFilter}
          totalCount={debtorsByOrder.length}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padding="md" className="space-y-3">
          <h2 className="text-base sm:text-lg font-bold text-bht-ink-strong">
            Ranking de Clientes Deudores ({filteredDebtorsByCustomer.length})
          </h2>
          {filteredDebtorsByCustomer.length === 0 ? (
            <EmptyState title="No hay clientes deudores con este filtro" />
          ) : (
            <div className="space-y-2.5">
              {filteredDebtorsByCustomer.map((c) => (
                <div
                  key={String(c.customerKey)}
                  className="flex min-h-[88px] items-center justify-between gap-3 rounded-xl border border-bht-line bg-bht-paper/60 p-3.5"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setDebtDetailTarget({
                        mode: "customer",
                        customerKey: String(c.customerKey),
                        customerName: String(c.customerName),
                        customerPartyId:
                          c.customerPartyId !== null && c.customerPartyId !== undefined
                            ? Number(c.customerPartyId)
                            : null,
                      })
                    }
                    aria-label={`Ver pedidos y productos que debe ${String(c.customerName)}`}
                    className="min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left transition hover:bg-bht-mist/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep/45 cursor-pointer"
                  >
                    <p className="truncate text-base font-bold text-bht-ink-strong">
                      {String(c.customerName)}
                    </p>
                    <p className="mt-0.5 text-xs text-bht-ink-soft tabular-nums">
                      {Number(c.openOrdersCount)} pedido(s) · Antigüedad máx.:{" "}
                      {Number(c.maxInvoiceAgeDays ?? c.maxDaysOverdue)} días · Próx.
                      visita: {String(c.earliestPromisedPaymentDate || "-")}
                    </p>
                    <span className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-bht-navy-mid">
                      Ver detalle y productos
                      <ChevronRightIcon className="h-3 w-3" />
                    </span>
                  </button>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                    <Badge tone="danger" className="tabular-nums">
                      {formatPen(c.totalBalanceDuePen)}
                    </Badge>
                    {Boolean(c.customerPartyId) && (
                      <Button
                        variant="primary"
                        size="sm"
                        aria-label={`Abonar cuenta de ${String(c.customerName)}`}
                        onClick={() => {
                          setAbonoOrder(null);
                          setFifoCustomer(c);
                          setAbonoAmount(String(c.totalBalanceDuePen));
                          setAbonoAccountId("");
                        }}
                      >
                        <PlusIcon className="h-3 w-3" />
                        Abonar Cuenta
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card padding="md" className="space-y-3">
          <h2 className="text-base sm:text-lg font-bold text-bht-ink-strong">
            Pedidos Pendientes de Cobro y Fechas Pactadas (
            {filteredDebtorsByOrder.length})
          </h2>
          {filteredDebtorsByOrder.length === 0 ? (
            <EmptyState title="No hay pedidos pendientes con este filtro" />
          ) : (
            <div className="space-y-2.5">
              {prioritizedDebtorsByOrder.map((o) => {
                const lineCount = Array.isArray(o.lines) ? o.lines.length : 0;
                const invoiceAge = Number(o.invoiceAgeDays ?? o.daysOverdue);
                const overdueDays = o.daysPastDue ?? o.daysOverdue;
                const dueBadgeTone =
                  o.dueStatus === "OVERDUE"
                    ? "danger"
                    : o.dueStatus === "DUE_SOON"
                      ? "warning"
                      : o.dueStatus === "CURRENT"
                        ? "success"
                        : invoiceAge > 30
                          ? "warning"
                          : "neutral";
                const dueBadgeLabel =
                  o.dueStatus === "OVERDUE"
                    ? `Vencido ${overdueDays} d`
                    : o.dueStatus === "DUE_SOON"
                      ? "Vence pronto"
                      : o.dueStatus === "CURRENT"
                        ? `Al día (hace ${invoiceAge} d)`
                        : `Hace ${invoiceAge} d`;
                return (
                  <div
                    key={String(o.orderId)}
                    className="rounded-xl border border-bht-line bg-bht-paper/60 p-3 space-y-2"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setDebtDetailTarget({
                          mode: "order",
                          orderId: Number(o.orderId),
                        })
                      }
                      aria-label={`Ver productos del pedido pendiente ${String(o.orderCode)} de ${String(o.customerName)}`}
                      className="w-full space-y-2 rounded-lg text-left transition hover:bg-bht-mist/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep/45 cursor-pointer"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="text-sm sm:text-base font-bold text-bht-ink-strong">
                          {String(o.orderCode)} · {String(o.customerName)}
                        </span>
                        <Badge tone={dueBadgeTone} className="tabular-nums">
                          {dueBadgeLabel}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-bht-ink-soft tabular-nums">
                        <span>Total: {formatPen(o.totalPen)}</span>
                        <span>Abonado: {formatPen(o.paidPen)}</span>
                        <strong className="text-bht-danger">
                          Falta: {formatPen(o.balanceDuePen)}
                        </strong>
                        <span className="ml-auto inline-flex items-center gap-0.5 font-medium text-bht-navy-mid">
                          {lineCount > 0 ? `${lineCount} prod.` : "Ver detalle"}
                          <ChevronRightIcon className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </button>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-bht-ink-soft tabular-nums">
                        {o.dueDate && <span>Vence: {o.dueDate}</span>}
                        <span>Pedido: hace {invoiceAge} d</span>
                        <span>Pactado: {String(o.promisedPaymentDate || "-")}</span>
                        <PromiseStatusPill status={String(o.promiseStatus ?? "")} />
                        <span className="sr-only">
                          {formatPromiseStatusEs(o.promiseStatus)}
                        </span>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        aria-label={`Registrar abono para pedido ${String(o.orderCode)}`}
                        onClick={() => {
                          setFifoCustomer(null);
                          setAbonoOrder(o);
                          setAbonoAmount(String(o.balanceDuePen));
                          setAbonoAccountId("");
                        }}
                      >
                        <PlusIcon className="h-3.5 w-3.5" />
                        Abonar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

interface CobranzaModalsProps {
  data: PartnerData;
  flow: CollectionsFlow;
}

export function CobranzaModals({ data, flow }: CobranzaModalsProps) {
  const { debtorsByOrder, debtorsByCustomer, accounts } = data;
  const {
    debtDetailTarget,
    setDebtDetailTarget,
    abonoOrder,
    setAbonoOrder,
    fifoCustomer,
    setFifoCustomer,
    abonoAmount,
    setAbonoAmount,
    abonoMode,
    setAbonoMode,
    abonoNextDays,
    setAbonoNextDays,
    abonoAccountId,
    setAbonoAccountId,
    busyAbono,
    handleSaveAbono,
  } = flow;
  return (
    <>
      <DebtorDetailModal
        open={Boolean(debtDetailTarget)}
        onClose={() => setDebtDetailTarget(null)}
        mode={debtDetailTarget?.mode ?? "order"}
        customerName={
          debtDetailTarget?.mode === "customer" ? debtDetailTarget.customerName : ""
        }
        orders={
          !debtDetailTarget
            ? []
            : debtDetailTarget.mode === "order"
              ? debtorsByOrder.filter(
                  (o) => Number(o.orderId) === debtDetailTarget.orderId
                )
              : debtorsByOrder.filter((o) => {
                  const oKey =
                    o.customerKey ||
                    (o.customerPartyId !== null && o.customerPartyId !== undefined
                      ? `PARTY-${Number(o.customerPartyId)}`
                      : `RAW-${String(o.customerName || "").toUpperCase()}`);
                  return oKey === debtDetailTarget.customerKey;
                })
        }
        canUseCustomerFifo={Boolean(
          debtDetailTarget?.mode === "customer" && debtDetailTarget.customerPartyId
        )}
        onSelectOrderAbono={(order) => {
          setDebtDetailTarget(null);
          setFifoCustomer(null);
          setAbonoOrder({
            orderId: order.orderId,
            orderCode: order.orderCode,
            customerName: order.customerName,
            totalPen: order.totalPen,
            paidPen: order.paidPen,
            balanceDuePen: order.balanceDuePen,
          });
          setAbonoAmount(String(order.balanceDuePen));
          setAbonoAccountId("");
        }}
        onSelectCustomerAbono={() => {
          if (debtDetailTarget?.mode !== "customer") return;
          const matched = debtorsByCustomer.find(
            (c) => String(c.customerKey) === debtDetailTarget.customerKey
          );
          if (!matched) return;
          setDebtDetailTarget(null);
          setAbonoOrder(null);
          setFifoCustomer(matched);
          setAbonoAmount(String(matched.totalBalanceDuePen));
          setAbonoAccountId("");
        }}
      />

      <AbonoModal
        open={Boolean(abonoOrder || fifoCustomer)}
        onClose={() => {
          setAbonoOrder(null);
          setFifoCustomer(null);
          setAbonoAccountId("");
        }}
        title={
          fifoCustomer
            ? `Abono General · ${String(fifoCustomer.customerName)}`
            : `Registrar Abono · ${String(abonoOrder?.customerName ?? "")}`
        }
        summaryContent={
          fifoCustomer ? (
            <>
              Se repartirá desde el pedido más antiguo (
              {Number(fifoCustomer.openOrdersCount)} pedidos) ·{" "}
              <strong className="text-bht-danger tabular-nums">
                Deuda Total: {formatPen(fifoCustomer.totalBalanceDuePen)}
              </strong>
            </>
          ) : abonoOrder ? (
            <>
              Pedido {String(abonoOrder.orderCode)} · Total:{" "}
              {formatPen(abonoOrder.totalPen)} · Abonado:{" "}
              {formatPen(abonoOrder.paidPen)} ·{" "}
              <strong className="text-bht-danger tabular-nums">
                Saldo: {formatPen(abonoOrder.balanceDuePen)}
              </strong>
            </>
          ) : null
        }
        balanceDuePen={
          fifoCustomer
            ? Number(fifoCustomer.totalBalanceDuePen ?? 0)
            : Number(abonoOrder?.balanceDuePen ?? 0)
        }
        amount={abonoAmount}
        onAmountChange={setAbonoAmount}
        paymentMode={abonoMode}
        onPaymentModeChange={setAbonoMode}
        nextDays={abonoNextDays}
        onNextDaysChange={setAbonoNextDays}
        accounts={accounts}
        accountId={abonoAccountId}
        onAccountIdChange={setAbonoAccountId}
        onSubmit={handleSaveAbono}
        submitLabel="Confirmar Abono"
        busy={busyAbono}
      />
    </>
  );
}
