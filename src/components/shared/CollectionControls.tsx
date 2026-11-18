"use client";

import React, { useEffect, useId, useState } from "react";
import {
  formatFulfillmentModeEs,
  formatOperationalStatusEs,
  formatPaymentModeEs,
} from "@/lib/labels-es";
import {
  AlertTriangleIcon,
  CalendarIcon,
  ClockIcon,
  FlameIcon,
  PlusIcon,
} from "../ui/Icons";
import {
  Badge,
  Button,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
} from "../ui/Primitives";

export const CREDIT_DAY_CHIPS = [
  { days: 1, label: "Mañana (+1d)" },
  { days: 3, label: "En 3 días" },
  { days: 7, label: "En 7 días (1 sem)" },
  { days: 10, label: "En 10 días" },
  { days: 15, label: "En 15 días (2 sem)" },
] as const;

export function PromiseFilterBar({
  value,
  onChange,
  totalCount,
}: {
  value: string;
  onChange: (val: string) => void;
  totalCount?: number;
}) {
  const filters = [
    {
      id: "ALL",
      label: totalCount !== undefined ? `Todos (${totalCount})` : "Todos",
      icon: null,
    },
    {
      id: "DUE_TODAY_OR_TOMORROW",
      label: "Cobrar hoy / mañana",
      icon: <FlameIcon className="h-3.5 w-3.5 text-[#B45309]" />,
    },
    {
      id: "PROMISE_BROKEN",
      label: "Promesa vencida",
      icon: <AlertTriangleIcon className="h-3.5 w-3.5 text-[#B91C1C]" />,
    },
    {
      id: "ON_SCHEDULE",
      label: "En plazo",
      icon: <CalendarIcon className="h-3.5 w-3.5 text-[#15803D]" />,
    },
  ];

  return (
    <div
      className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
      role="group"
      aria-label="Filtrar cuentas por estado de cobranza"
    >
      {filters.map((f) => {
        const active = value === f.id;
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(f.id)}
            className={`inline-flex min-h-[40px] w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl sm:rounded-full border px-3 py-1.5 text-xs text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942] focus-visible:ring-offset-1 cursor-pointer ${
              active
                ? "border-[#0F2942]/45 bg-[#EDF3F8] font-semibold text-[#0F2942] shadow-[0_1px_2px_rgba(15,41,66,0.06)]"
                : "border-[#E7E5E0] bg-white font-medium text-[#5C5A55] hover:border-[#D4E0EC] hover:bg-[#F2F6FA]/70 hover:text-[#0F2942]"
            }`}
          >
            {f.icon && <span>{f.icon}</span>}
            <span>{f.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PromiseStatusPill({ status }: { status: string }) {
  if (status === "PROMISE_BROKEN") {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-[#B91C1C]">
        <AlertTriangleIcon className="h-3.5 w-3.5" />
        Promesa vencida
      </span>
    );
  }
  if (status === "DUE_TODAY_OR_TOMORROW") {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-[#B45309]">
        <FlameIcon className="h-3.5 w-3.5" />
        Cobrar hoy / mañana
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-medium text-[#5C5A55]">
      <CalendarIcon className="h-3.5 w-3.5" />
      En plazo
    </span>
  );
}

export interface AbonoCashAccountOption {
  account_id: number;
  code: string;
  name: string;
  account_type: string;
  current_balance_pen?: number | string;
  is_active?: boolean;
}

export function AbonoModal({
  open,
  onClose,
  title,
  summaryContent,
  balanceDuePen,
  amount,
  onAmountChange,
  paymentMode,
  onPaymentModeChange,
  nextDays,
  onNextDaysChange,
  accounts,
  accountId,
  onAccountIdChange,
  accountBalances,
  onSubmit,
  submitLabel = "Guardar Abono",
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  summaryContent: React.ReactNode;
  balanceDuePen: number;
  amount: string;
  onAmountChange: (val: string) => void;
  paymentMode: "CASH" | "YAPE_PLIN" | "TRANSFER";
  onPaymentModeChange: (val: "CASH" | "YAPE_PLIN" | "TRANSFER") => void;
  nextDays: number;
  onNextDaysChange: (days: number) => void;
  accounts?: AbonoCashAccountOption[];
  accountId?: string;
  onAccountIdChange?: (accountId: string) => void;
  accountBalances?: Record<number, number>;
  onSubmit: (e: React.FormEvent) => void;
  submitLabel?: string;
  busy?: boolean;
}) {
  const amountInputId = useId();
  const paymentLabelId = useId();
  const accountSelectId = useId();
  const nextDaysLabelId = useId();

  const activeAccounts = (accounts ?? []).filter(
    (acc) => acc.is_active !== false
  );
  const parsedAmount = Number(amount);
  const isFullPayoff =
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    balanceDuePen > 0 &&
    parsedAmount >= balanceDuePen - 0.05;

  return (
    <ModalSheet open={open} onClose={onClose} title={title}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="rounded-xl border border-[#D4E0EC] bg-[#F2F6FA]/85 p-3 text-xs text-[#0F2942]">
          {summaryContent}
        </div>

        <div>
          <FieldLabel htmlFor={amountInputId} required>
            Monto que abona hoy (S/)
          </FieldLabel>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <input
              id={amountInputId}
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              required
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              placeholder="0.00"
              className={`${INPUT_CLASS} flex-1 min-w-[140px] font-semibold tabular-nums`}
            />
            <Button
              variant="outline"
              size="sm"
              aria-label={`Completar monto total pendiente: S/ ${balanceDuePen.toFixed(2)}`}
              onClick={() => onAmountChange(balanceDuePen.toFixed(2))}
              className="border-[#D4E0EC] bg-[#F2F6FA] text-[#0F2942] hover:border-[#5B89B5]/60 hover:bg-[#E7EFF7]"
            >
              Todo (S/ {balanceDuePen.toFixed(2)})
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Completar mitad del saldo: S/ ${(balanceDuePen / 2).toFixed(2)}`}
              onClick={() => onAmountChange((balanceDuePen / 2).toFixed(2))}
              className="border-[#D4E0EC] bg-[#F2F6FA] text-[#0F2942] hover:border-[#5B89B5]/60 hover:bg-[#E7EFF7]"
            >
              Mitad
            </Button>
          </div>
        </div>

        <div>
          <span
            id={paymentLabelId}
            className="block text-xs font-medium text-[#5C5A55]"
          >
            Medio de pago
          </span>
          <div
            role="radiogroup"
            aria-labelledby={paymentLabelId}
            className="mt-1.5 grid grid-cols-3 gap-2"
          >
            {(["CASH", "YAPE_PLIN", "TRANSFER"] as const).map((m) => {
              const active = paymentMode === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onPaymentModeChange(m)}
                  className={`rounded-xl border px-3 py-2.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942] focus-visible:ring-offset-1 cursor-pointer ${
                    active
                      ? "border-[#0F2942] bg-[#EDF3F8] text-[#0F2942] ring-1 ring-[#0F2942]/15"
                      : "border-[#E7E5E0] bg-white text-[#5C5A55] hover:border-[#D4E0EC] hover:bg-[#F2F6FA]/60 hover:text-[#0F2942]"
                  }`}
                >
                  {formatPaymentModeEs(m)}
                </button>
              );
            })}
          </div>
        </div>

        {activeAccounts.length > 0 && onAccountIdChange && (
          <div>
            <FieldLabel htmlFor={accountSelectId}>
              Cuenta de ingreso
            </FieldLabel>
            <select
              id={accountSelectId}
              value={accountId ?? ""}
              onChange={(e) => onAccountIdChange(e.target.value)}
              className={`${INPUT_CLASS} mt-1.5 min-h-[44px]`}
            >
              <option value="">Por defecto según medio de pago</option>
              {activeAccounts.map((acc) => {
                const rawBalance =
                  accountBalances?.[acc.account_id] ?? acc.current_balance_pen;
                const parsedBalance =
                  rawBalance !== undefined && rawBalance !== null
                    ? Number(rawBalance)
                    : undefined;
                return (
                  <option key={acc.account_id} value={String(acc.account_id)}>
                    {acc.name} ({acc.code})
                    {parsedBalance !== undefined && Number.isFinite(parsedBalance)
                      ? ` · Saldo: S/ ${parsedBalance.toFixed(2)}`
                      : ""}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {isFullPayoff ? (
          <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-2.5 text-xs font-medium text-[#047857]">
            Este abono liquida el 100% del saldo pendiente; no se programará prórroga de cobranza.
          </div>
        ) : (
          <div>
            <span
              id={nextDaysLabelId}
              className="block text-xs font-medium text-[#5C5A55]"
            >
              Si aún queda saldo, ¿cuándo volver por el resto?
            </span>
            <div
              role="group"
              aria-labelledby={nextDaysLabelId}
              className="mt-1.5 flex flex-wrap gap-1.5"
            >
              {CREDIT_DAY_CHIPS.map((c) => {
                const active = nextDays === c.days;
                return (
                  <button
                    key={c.days}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onNextDaysChange(c.days)}
                    className={`min-h-[44px] rounded-full border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942] focus-visible:ring-offset-1 cursor-pointer ${
                      active
                        ? "border-[#B45309] bg-[#FFFBEB] text-[#B45309]"
                        : "border-[#E7E5E0] bg-white text-[#5C5A55] hover:border-[#D4E0EC] hover:bg-[#F2F6FA]/60 hover:text-[#0F2942]"
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="success"
            disabled={busy}
            className="flex-[2]"
          >
            {busy ? "Guardando..." : submitLabel}
          </Button>
        </div>
      </form>
    </ModalSheet>
  );
}

export interface DebtOrderLineDetail {
  orderLineId: number;
  lineNo: number;
  productId: number;
  sku: string;
  rawDescription: string;
  unitOfMeasure?: string;
  quantity: number;
  baseUnitPricePen: number;
  unitDiscountPen: number;
  unitPricePen: number;
  lineTotalPen: number;
  fulfillmentMode: string;
  fulfillmentStatus: string;
}

export interface DebtOrderDetail {
  orderId: number;
  orderCode: string;
  orderDate: string;
  customerKey?: string;
  customerPartyId: number | null;
  customerName: string;
  paymentMode: string;
  operationalStatus: string;
  totalPen: number;
  paidPen: number;
  balanceDuePen: number;
  daysOverdue: number;
  agingBucket: "GREEN_0_7" | "AMBER_8_29" | "RED_30_PLUS";
  promisedPaymentDate: string | null;
  promiseStatus: string;
  paymentCount: number;
  lastPaymentDate: string | null;
  createdByName?: string | null;
  lines?: DebtOrderLineDetail[];
}

interface PaymentTimelineEntry {
  arPaymentId: number;
  paymentDate: string;
  amountPen: number;
  paymentMode: string;
  collectedByName: string | null;
}

export function DebtorDetailModal({
  open,
  onClose,
  mode,
  customerName,
  orders,
  onSelectOrderAbono,
  onSelectCustomerAbono,
  canUseCustomerFifo = false,
}: {
  open: boolean;
  onClose: () => void;
  mode: "customer" | "order";
  customerName: string;
  orders: DebtOrderDetail[];
  onSelectOrderAbono?: (order: DebtOrderDetail) => void;
  onSelectCustomerAbono?: () => void;
  canUseCustomerFifo?: boolean;
}) {
  const [expandedTimelineOrderId, setExpandedTimelineOrderId] = useState<
    number | null
  >(null);
  const [loadingTimelineOrderId, setLoadingTimelineOrderId] = useState<
    number | null
  >(null);
  const [timelinesByOrder, setTimelinesByOrder] = useState<
    Record<number, PaymentTimelineEntry[]>
  >({});

  useEffect(() => {
    if (!open) {
      setExpandedTimelineOrderId(null);
      setLoadingTimelineOrderId(null);
    }
  }, [open, customerName]);

  const totalSold = orders.reduce((s, o) => s + Number(o.totalPen || 0), 0);
  const totalPaid = orders.reduce((s, o) => s + Number(o.paidPen || 0), 0);
  const totalBalance = orders.reduce(
    (s, o) => s + Number(o.balanceDuePen || 0),
    0
  );

  async function handleToggleTimeline(orderId: number) {
    if (expandedTimelineOrderId === orderId) {
      setExpandedTimelineOrderId(null);
      return;
    }
    if (timelinesByOrder[orderId]) {
      setExpandedTimelineOrderId(orderId);
      return;
    }
    setLoadingTimelineOrderId(orderId);
    try {
      const res = await fetch(`/api/collections?orderId=${orderId}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) {
        setTimelinesByOrder((prev) => ({
          ...prev,
          [orderId]: Array.isArray(data.timeline) ? data.timeline : [],
        }));
        setExpandedTimelineOrderId(orderId);
      }
    } finally {
      setLoadingTimelineOrderId(null);
    }
  }

  const singleOrder = mode === "order" ? orders[0] : undefined;
  const title =
    mode === "order" && singleOrder
      ? `Detalle de deuda · ${singleOrder.orderCode}`
      : `Detalle de deuda · ${customerName}`;
  const subtitle =
    mode === "order" && singleOrder
      ? `${singleOrder.customerName} · ${singleOrder.orderDate}`
      : `${orders.length} pedido(s) con saldo pendiente`;

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      maxWidth="lg"
    >
      <div className="space-y-3.5 text-xs">
        <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-[#D4E0EC] bg-[#F2F6FA]/85 p-3 sm:grid-cols-3 tabular-nums">
          <div>
            <span className="block text-xs text-[#5C5A55]">
              {mode === "customer" ? "Total vendido" : "Total pedido"}
            </span>
            <strong className="text-sm text-[#18181B]">
              S/ {totalSold.toFixed(2)}
            </strong>
          </div>
          <div>
            <span className="block text-xs text-[#5C5A55]">Abonado</span>
            <strong className="text-sm text-[#15803D]">
              S/ {totalPaid.toFixed(2)}
            </strong>
          </div>
          <div className="sm:text-right">
            <span className="block text-xs text-[#5C5A55]">
              Saldo pendiente
            </span>
            <strong className="text-sm text-[#B91C1C]">
              S/ {totalBalance.toFixed(2)}
            </strong>
          </div>
        </div>

        {orders.length === 0 ? (
          <p className="rounded-xl border border-[#E7E5E0] bg-[#FAF9F6] p-3 text-[#5C5A55]">
            No hay pedidos pendientes registrados para mostrar.
          </p>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => {
              const lines = Array.isArray(order.lines) ? order.lines : [];
              const timeline = timelinesByOrder[order.orderId];
              const isTimelineOpen = expandedTimelineOrderId === order.orderId;
              return (
                <div
                  key={order.orderId}
                  className="rounded-xl border border-[#E7E5E0] bg-[#FAF9F6]/75 p-3 space-y-2.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-[#1E446B] tabular-nums">
                          {order.orderCode} · {order.orderDate}
                        </span>
                        <Badge tone="neutral">
                          {formatOperationalStatusEs(order.operationalStatus)}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-[#5C5A55] tabular-nums">
                        Total: S/ {order.totalPen.toFixed(2)} · Abonado: S/{" "}
                        {order.paidPen.toFixed(2)} ·{" "}
                        <strong className="text-[#B91C1C]">
                          Debe: S/ {order.balanceDuePen.toFixed(2)}
                        </strong>
                      </p>
                    </div>
                    <Badge
                      tone={
                        order.agingBucket === "RED_30_PLUS"
                          ? "danger"
                          : order.agingBucket === "AMBER_8_29"
                          ? "warning"
                          : "success"
                      }
                      className="tabular-nums"
                    >
                      Hace {order.daysOverdue} días
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5C5A55]">
                    <span>
                      Pactado:{" "}
                      <strong className="text-[#18181B]">
                        {order.promisedPaymentDate || "No pactada"}
                      </strong>
                      {order.createdByName
                        ? ` · Vendedor: ${order.createdByName}`
                        : ""}
                    </span>
                    <PromiseStatusPill status={order.promiseStatus} />
                  </div>

                  <div className="space-y-1.5 border-t border-[#E7E5E0] pt-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#0F2942]">
                      Productos de este pedido ({lines.length})
                    </p>
                    {lines.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-[#DDDAD3] bg-white px-2.5 py-2 text-xs text-[#5C5A55]">
                        Pedido histórico sin desglose individual de productos.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {lines.map((ln) => (
                          <div
                            key={ln.orderLineId}
                            className="flex items-start justify-between gap-2 rounded-lg border border-[#E7E5E0] bg-white px-2.5 py-2"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-[#18181B]">
                                {ln.rawDescription || ln.sku}
                              </p>
                              <p className="mt-0.5 text-xs text-[#5C5A55] tabular-nums">
                                {ln.quantity} {ln.unitOfMeasure || "NIU"} × S/{" "}
                                {ln.unitPricePen.toFixed(2)}
                                {ln.unitDiscountPen > 0
                                  ? ` (desc. S/ ${ln.unitDiscountPen.toFixed(2)}/u)`
                                  : ""}{" "}
                                · {formatFulfillmentModeEs(ln.fulfillmentMode)}
                              </p>
                            </div>
                            <span className="flex-shrink-0 font-semibold text-[#18181B] tabular-nums">
                              S/ {ln.lineTotalPen.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {onSelectOrderAbono && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => onSelectOrderAbono(order)}
                        className="flex-1"
                      >
                        <PlusIcon className="h-3.5 w-3.5" />
                        Abonar S/ {order.balanceDuePen.toFixed(2)}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      aria-expanded={isTimelineOpen}
                      disabled={loadingTimelineOrderId === order.orderId}
                      onClick={() => void handleToggleTimeline(order.orderId)}
                    >
                      <ClockIcon className="h-3.5 w-3.5" />
                      {loadingTimelineOrderId === order.orderId
                        ? "Cargando..."
                        : `Pagos (${order.paymentCount})`}
                    </Button>
                  </div>

                  {isTimelineOpen && (
                    <div className="rounded-lg border border-[#D4E0EC] bg-[#F2F6FA]/70 p-2.5 text-xs">
                      {!timeline || timeline.length === 0 ? (
                        <p className="text-[#5C5A55]">
                          Este pedido aún no registra abonos previos.
                        </p>
                      ) : (
                        <ul className="divide-y divide-[#D4E0EC]/70">
                          {timeline.map((t) => (
                            <li
                              key={t.arPaymentId}
                              className="flex items-center justify-between gap-2 py-1"
                            >
                              <span className="text-[#5C5A55]">
                                {t.paymentDate} ·{" "}
                                {formatPaymentModeEs(t.paymentMode)} (
                                {t.collectedByName || "Histórico"})
                              </span>
                              <strong className="font-semibold text-[#15803D] tabular-nums">
                                S/ {Number(t.amountPen).toFixed(2)}
                              </strong>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {mode === "customer" &&
          canUseCustomerFifo &&
          onSelectCustomerAbono &&
          orders.length > 0 && (
            <div className="border-t border-[#E7E5E0] pt-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={onSelectCustomerAbono}
                className="w-full border-[#D4E0EC] bg-[#F2F6FA]/70 text-[#0F2942] hover:bg-[#EDF3F8]"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                Abonar a cuenta general (desde la deuda más antigua)
              </Button>
            </div>
          )}
      </div>
    </ModalSheet>
  );
}
