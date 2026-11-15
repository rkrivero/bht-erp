"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface CatalogItem {
  product_id: number;
  sku: string;
  name: string;
  unit_of_measure: string;
  fulfillment_mode: "STOCKED" | "ON_DEMAND";
  stock_on_hand: number;
  list_sale_price_pen: number | null;
  min_sale_price_pen: number | null;
}

interface CartLine {
  product: CatalogItem;
  quantity: number;
  unitDiscountPen: number;
}

interface OrderDebtItem {
  orderId: number;
  orderCode: string;
  orderDate: string;
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
  promiseStatus:
    | "DUE_TODAY_OR_TOMORROW"
    | "PROMISE_BROKEN"
    | "ON_SCHEDULE"
    | "NO_PROMISE_DATE";
  paymentCount: number;
  lastPaymentDate: string | null;
}

interface CustomerDebtSummary {
  customerKey: string;
  customerPartyId: number | null;
  customerName: string;
  openOrdersCount: number;
  totalSoldPen: number;
  totalPaidPen: number;
  totalBalanceDuePen: number;
  maxDaysOverdue: number;
  agingBucket: "GREEN_0_7" | "AMBER_8_29" | "RED_30_PLUS";
  earliestPromisedPaymentDate: string | null;
  promiseStatus: string;
}

const CREDIT_DAY_CHIPS = [
  { days: 1, label: "Mañana (+1d)" },
  { days: 3, label: "En 3 días" },
  { days: 7, label: "En 7 días (1 sem)" },
  { days: 10, label: "En 10 días" },
  { days: 15, label: "En 15 días (2 sem)" },
];

export default function VendedorPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"nuevo" | "pedidos" | "deudores" | "gastos">("nuevo");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [debtorsByOrder, setDebtorsByOrder] = useState<OrderDebtItem[]>([]);
  const [debtorsByCustomer, setDebtorsByCustomer] = useState<CustomerDebtSummary[]>([]);
  const [searchProduct, setSearchProduct] = useState("");
  const [customerNameRaw, setCustomerNameRaw] = useState("");
  const [paymentMode, setPaymentMode] = useState<"CASH" | "CREDIT" | "YAPE_PLIN" | "TRANSFER">("CASH");
  const [creditDays, setCreditDays] = useState<number>(7);
  const [customPromiseDate, setCustomPromiseDate] = useState<string>("");
  const [initialPaidPen, setInitialPaidPen] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [feedback, setFeedback] = useState<{ type: "ok" | "warn" | "err"; msg: string } | null>(null);

  // Debtors state
  const [debtorView, setDebtorView] = useState<"orders" | "customers">("orders");
  const [promiseFilter, setPromiseFilter] = useState<string>("ALL");
  const [selectedOrderForAbono, setSelectedOrderForAbono] = useState<OrderDebtItem | null>(null);
  const [abonoAmount, setAbonoAmount] = useState("");
  const [abonoMode, setAbonoMode] = useState<"CASH" | "YAPE_PLIN" | "TRANSFER">("CASH");
  const [abonoNextDays, setAbonoNextDays] = useState<number>(7);
  const [timelineOrderId, setTimelineOrderId] = useState<number | null>(null);
  const [timelineEntries, setTimelineEntries] = useState<Array<Record<string, unknown>>>([]);

  // Route expenses state
  const [expenseCategory, setExpenseCategory] = useState("COMBUSTIBLE");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDesc, setExpenseDesc] = useState("");

  async function loadAll() {
    const [ordRes, colRes] = await Promise.all([
      fetch("/api/orders"),
      fetch("/api/collections"),
    ]);
    if (ordRes.status === 401 || ordRes.status === 403) {
      router.push("/login");
      return;
    }
    const ordData = await ordRes.json();
    const colData = await colRes.json();
    setCatalog(ordData.catalog || []);
    setOrders(ordData.orders || []);
    setDebtorsByOrder(colData.byOrder || []);
    setDebtorsByCustomer(colData.byCustomer || []);
  }

  useEffect(() => {
    loadAll();
  }, []);

  function addToCart(prod: CatalogItem) {
    setCart((prev) => {
      const existing = prev.find((c) => c.product.product_id === prod.product_id);
      if (existing) {
        return prev.map((c) =>
          c.product.product_id === prod.product_id
            ? { ...c, quantity: c.quantity + 1 }
            : c
        );
      }
      return [...prev, { product: prod, quantity: 1, unitDiscountPen: 0 }];
    });
  }

  const cartTotalPen = cart.reduce((sum, item) => {
    const base = item.product.list_sale_price_pen ?? 0;
    const finalUnit = Math.max(0, base - item.unitDiscountPen);
    return sum + item.quantity * finalUnit;
  }, 0);

  const hasBelowMinFloor = cart.some((item) => {
    const base = item.product.list_sale_price_pen ?? 0;
    const min = item.product.min_sale_price_pen ?? base;
    return base - item.unitDiscountPen < min - 0.001;
  });

  async function handleSubmitOrder(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        customerNameRaw,
        paymentMode,
        creditDays: paymentMode === "CREDIT" ? creditDays : undefined,
        promisedPaymentDate:
          paymentMode === "CREDIT" && customPromiseDate ? customPromiseDate : null,
        initialPaidPen:
          paymentMode === "CREDIT" && initialPaidPen
            ? Number(initialPaidPen)
            : undefined,
        notes,
        lines: cart.map((c) => ({
          productId: c.product.product_id,
          quantity: c.quantity,
          unitDiscountPen: c.unitDiscountPen,
        })),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ type: "err", msg: data.error || "Error al guardar pedido" });
      return;
    }
    setCart([]);
    setCustomerNameRaw("");
    setInitialPaidPen("");
    setNotes("");
    setFeedback({
      type: data.requiresApproval ? "warn" : "ok",
      msg: data.requiresApproval
        ? `Pedido ${data.orderCode} guardado en PENDIENTE APROBACIÓN SOCIO (descuento bajo el precio mínimo).`
        : `Pedido ${data.orderCode} registrado y enviado a Almacén.`,
    });
    await loadAll();
  }

  async function handleSubmitAbono(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedOrderForAbono) return;
    setFeedback(null);
    const res = await fetch("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "single_order",
        orderId: selectedOrderForAbono.orderId,
        amountPen: Number(abonoAmount),
        paymentMode: abonoMode,
        nextCollectionDays: abonoNextDays,
        notes: "Abono registrado en ruta",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ type: "err", msg: data.error || "Error al registrar abono" });
      return;
    }
    setSelectedOrderForAbono(null);
    setAbonoAmount("");
    setFeedback({
      type: "ok",
      msg: data.isSettled
        ? "¡Pedido cancelado al 100%!"
        : `Abono registrado. Nuevo saldo pendiente: S/ ${Number(data.newBalanceDuePen).toFixed(2)}`,
    });
    await loadAll();
  }

  async function handleOpenTimeline(orderId: number) {
    if (timelineOrderId === orderId) {
      setTimelineOrderId(null);
      return;
    }
    const res = await fetch(`/api/collections?orderId=${orderId}`);
    const data = await res.json();
    setTimelineOrderId(orderId);
    setTimelineEntries(data.timeline || []);
  }

  async function handleSubmitExpense(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const res = await fetch("/api/treasury", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amountPen: Number(expenseAmount),
        expenseBucket: "ROUTE_OPEX",
        expenseCategory,
        description: expenseDesc,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ type: "err", msg: data.error || "Error al guardar gasto" });
      return;
    }
    setExpenseAmount("");
    setExpenseDesc("");
    setFeedback({ type: "ok", msg: "Gasto operativo de ruta registrado." });
  }

  const filteredCatalog = catalog
    .filter(
      (c) =>
        c.name.toLowerCase().includes(searchProduct.toLowerCase()) ||
        c.sku.toLowerCase().includes(searchProduct.toLowerCase())
    )
    .slice(0, 20);

  const filteredDebtOrders = debtorsByOrder.filter((o) => {
    if (promiseFilter === "ALL") return true;
    return o.promiseStatus === promiseFilter;
  });

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-slate-100 pb-24">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-blue-900 px-4 py-3 text-white shadow">
        <div>
          <span className="rounded bg-blue-700 px-2 py-0.5 text-[10px] font-bold">
            VENDEDOR EXTERNO · PEN (S/)
          </span>
          <h1 className="text-lg font-extrabold">Ventas en Ruta y Cobranzas</h1>
        </div>
        <button
          onClick={async () => {
            await fetch("/api/auth", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "logout" }),
            });
            router.push("/login");
          }}
          className="rounded-lg bg-blue-800 px-3 py-1.5 text-xs font-bold"
        >
          Salir
        </button>
      </header>

      {feedback && (
        <div
          className={`m-3 rounded-xl p-3 text-sm font-bold ${
            feedback.type === "ok"
              ? "bg-emerald-100 text-emerald-900"
              : feedback.type === "warn"
              ? "bg-amber-100 text-amber-900"
              : "bg-red-100 text-red-900"
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {tab === "nuevo" && (
        <main className="space-y-4 p-3">
          <form
            onSubmit={handleSubmitOrder}
            className="space-y-4 rounded-2xl bg-white p-4 shadow-sm"
          >
            <div>
              <label className="block text-xs font-bold uppercase text-slate-500">
                Cliente
              </label>
              <input
                type="text"
                required
                value={customerNameRaw}
                onChange={(e) => setCustomerNameRaw(e.target.value)}
                placeholder="Nombre del cliente o ferretería..."
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-slate-500">
                Condición de Pago
              </label>
              <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    ["CASH", "Contado Efectivo"],
                    ["YAPE_PLIN", "Yape / Plin"],
                    ["TRANSFER", "Transferencia"],
                    ["CREDIT", "A Crédito"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPaymentMode(mode)}
                    className={`rounded-xl border py-2.5 text-xs font-bold ${
                      paymentMode === mode
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {paymentMode === "CREDIT" && (
              <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div>
                  <label className="block text-xs font-extrabold text-amber-900">
                    ¿Cuándo dijo el cliente que volvamos a cobrar? (1 toque)
                  </label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {CREDIT_DAY_CHIPS.map((chip) => (
                      <button
                        key={chip.days}
                        type="button"
                        onClick={() => {
                          setCreditDays(chip.days);
                          setCustomPromiseDate("");
                        }}
                        className={`rounded-lg px-3 py-2 text-xs font-bold ${
                          creditDays === chip.days && !customPromiseDate
                            ? "bg-amber-600 text-white shadow"
                            : "bg-white text-amber-900 border border-amber-300"
                        }`}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-amber-900">O fecha exacta:</span>
                    <input
                      type="date"
                      value={customPromiseDate}
                      onChange={(e) => setCustomPromiseDate(e.target.value)}
                      className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs font-bold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-amber-900">
                    ¿Dejó adelanto inicial hoy? (Opcional, en S/)
                  </label>
                  <input
                    type="number"
                    step="0.50"
                    min="0"
                    value={initialPaidPen}
                    onChange={(e) => setInitialPaidPen(e.target.value)}
                    placeholder="Ej. 200.00 (dejar vacío si no dio adelanto)"
                    className="mt-1 w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-bold"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold uppercase text-slate-500">
                Buscar Producto para Agregar
              </label>
              <input
                type="text"
                value={searchProduct}
                onChange={(e) => setSearchProduct(e.target.value)}
                placeholder="Escribe nombre o SKU..."
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
                {filteredCatalog.map((prod) => (
                  <div
                    key={prod.product_id}
                    className="flex items-center justify-between rounded-xl border border-slate-200 p-2.5"
                  >
                    <div>
                      <p className="text-xs font-bold text-slate-900">{prod.name}</p>
                      <p className="text-[11px] text-slate-500">
                        Precio: S/ {Number(prod.list_sale_price_pen ?? 0).toFixed(2)} ·
                        Mín: S/ {Number(prod.min_sale_price_pen ?? 0).toFixed(2)} · Stock:{" "}
                        {prod.stock_on_hand} ({prod.fulfillment_mode})
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => addToCart(prod)}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white"
                    >
                      + Agregar
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {cart.length > 0 && (
              <div className="space-y-2 border-t border-slate-200 pt-3">
                <h3 className="text-xs font-bold uppercase text-slate-500">
                  Productos en el Pedido (Descuento en Soles por unidad)
                </h3>
                {cart.map((line, idx) => {
                  const base = line.product.list_sale_price_pen ?? 0;
                  const min = line.product.min_sale_price_pen ?? base;
                  const finalUnit = Math.max(0, base - line.unitDiscountPen);
                  const belowMin = finalUnit < min - 0.001;
                  return (
                    <div
                      key={line.product.product_id}
                      className={`rounded-xl border p-3 ${
                        belowMin
                          ? "border-amber-400 bg-amber-50"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900">
                          {line.product.name}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setCart((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-xs font-bold text-red-600"
                        >
                          Quitar
                        </button>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500">
                            Cantidad
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={line.quantity}
                            onChange={(e) => {
                              const q = Number(e.target.value);
                              setCart((prev) =>
                                prev.map((c, i) =>
                                  i === idx ? { ...c, quantity: q } : c
                                )
                              );
                            }}
                            className="w-full rounded-lg border bg-white px-2 py-1.5 text-sm font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500">
                            Dscto S/ x Und
                          </label>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                setCart((prev) =>
                                  prev.map((c, i) =>
                                    i === idx
                                      ? {
                                          ...c,
                                          unitDiscountPen: Math.max(
                                            0,
                                            c.unitDiscountPen - 1
                                          ),
                                        }
                                      : c
                                  )
                                )
                              }
                              className="rounded bg-slate-200 px-2 py-1 text-xs font-bold"
                            >
                              -1
                            </button>
                            <input
                              type="number"
                              step="0.50"
                              min={0}
                              value={line.unitDiscountPen}
                              onChange={(e) => {
                                const d = Number(e.target.value);
                                setCart((prev) =>
                                  prev.map((c, i) =>
                                    i === idx ? { ...c, unitDiscountPen: d } : c
                                  )
                                );
                              }}
                              className="w-full rounded-lg border bg-white px-2 py-1.5 text-center text-sm font-bold"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setCart((prev) =>
                                  prev.map((c, i) =>
                                    i === idx
                                      ? {
                                          ...c,
                                          unitDiscountPen: c.unitDiscountPen + 1,
                                        }
                                      : c
                                  )
                                )
                              }
                              className="rounded bg-slate-200 px-2 py-1 text-xs font-bold"
                            >
                              +1
                            </button>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="block text-[10px] font-bold text-slate-500">
                            Final x Und / Subtotal
                          </span>
                          <span className="text-xs font-extrabold text-slate-900">
                            S/ {finalUnit.toFixed(2)}
                          </span>
                          <span className="block text-sm font-extrabold text-blue-700">
                            S/ {(line.quantity * finalUnit).toFixed(2)}
                          </span>
                        </div>
                      </div>
                      {belowMin && (
                        <p className="mt-1 text-[11px] font-bold text-amber-800">
                          ⚠️ Precio menor al mínimo permitido (S/ {min.toFixed(2)}).
                          Requerirá aprobación de Socio con 1 toque.
                        </p>
                      )}
                    </div>
                  );
                })}

                <div className="flex items-center justify-between rounded-xl bg-slate-900 p-3 text-white">
                  <span className="text-sm font-bold">Total del Pedido</span>
                  <span className="text-xl font-extrabold">
                    S/ {cartTotalPen.toFixed(2)}
                  </span>
                </div>

                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Dirección de entrega o nota para almacén..."
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                />

                <button
                  type="submit"
                  className="w-full rounded-xl bg-emerald-600 py-4 text-base font-extrabold text-white shadow hover:bg-emerald-700"
                >
                  {hasBelowMinFloor
                    ? "Enviar Pedido a Aprobación de Socio"
                    : "Confirmar Pedido y Enviar a Almacén"}
                </button>
              </div>
            )}
          </form>
        </main>
      )}

      {tab === "deudores" && (
        <main className="space-y-3 p-3">
          <div className="rounded-2xl bg-white p-3 shadow-sm">
            <div className="flex gap-2">
              <button
                onClick={() => setDebtorView("orders")}
                className={`flex-1 rounded-xl py-2 text-xs font-bold ${
                  debtorView === "orders"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                Por Pedido ({debtorsByOrder.length})
              </button>
              <button
                onClick={() => setDebtorView("customers")}
                className={`flex-1 rounded-xl py-2 text-xs font-bold ${
                  debtorView === "customers"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                Por Cliente ({debtorsByCustomer.length})
              </button>
            </div>

            {debtorView === "orders" && (
              <div className="mt-2 flex gap-1.5 overflow-x-auto pt-1">
                {[
                  { id: "ALL", label: "Todos" },
                  { id: "DUE_TODAY_OR_TOMORROW", label: "🔥 Toca Cobrar Hoy/Mañana" },
                  { id: "PROMISE_BROKEN", label: "🚨 Promesa Vencida" },
                  { id: "ON_SCHEDULE", label: "📅 En Plazo" },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setPromiseFilter(f.id)}
                    className={`flex-shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${
                      promiseFilter === f.id
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedOrderForAbono && (
            <form
              onSubmit={handleSubmitAbono}
              className="rounded-2xl border-2 border-blue-600 bg-white p-4 shadow-lg space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-slate-900">
                  Registrar Abono · {selectedOrderForAbono.customerName}
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedOrderForAbono(null)}
                  className="text-xs font-bold text-slate-500"
                >
                  Cerrar
                </button>
              </div>
              <p className="text-xs text-slate-600">
                Pedido {selectedOrderForAbono.orderCode} · Total: S/{" "}
                {selectedOrderForAbono.totalPen.toFixed(2)} · Ya abonó: S/{" "}
                {selectedOrderForAbono.paidPen.toFixed(2)} ·{" "}
                <strong className="text-red-700">
                  Saldo: S/ {selectedOrderForAbono.balanceDuePen.toFixed(2)}
                </strong>
              </p>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.50"
                  required
                  value={abonoAmount}
                  onChange={(e) => setAbonoAmount(e.target.value)}
                  placeholder="Monto que abona hoy (S/)"
                  className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
                />
                <button
                  type="button"
                  onClick={() =>
                    setAbonoAmount(String(selectedOrderForAbono.balanceDuePen))
                  }
                  className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-bold"
                >
                  Todo / Saldo
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setAbonoAmount(
                      String(
                        Number((selectedOrderForAbono.balanceDuePen / 2).toFixed(2))
                      )
                    )
                  }
                  className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-bold"
                >
                  La Mitad
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["CASH", "YAPE_PLIN", "TRANSFER"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAbonoMode(m)}
                    className={`rounded-lg py-2 text-xs font-bold ${
                      abonoMode === m
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div>
                <span className="block text-[11px] font-bold text-slate-600">
                  Si aún queda saldo, ¿cuándo volver por el resto? (1 toque):
                </span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {CREDIT_DAY_CHIPS.map((c) => (
                    <button
                      key={c.days}
                      type="button"
                      onClick={() => setAbonoNextDays(c.days)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${
                        abonoNextDays === c.days
                          ? "bg-amber-600 text-white"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="submit"
                className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-extrabold text-white"
              >
                Guardar Abono
              </button>
            </form>
          )}

          {debtorView === "orders" ? (
            <div className="space-y-2.5">
              {filteredDebtOrders.map((item) => (
                <div
                  key={item.orderId}
                  className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-500">
                        {item.orderCode} · Venta: {item.orderDate}
                      </span>
                      <h3 className="text-sm font-extrabold text-slate-900">
                        {item.customerName}
                      </h3>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
                        item.agingBucket === "RED_30_PLUS"
                          ? "bg-red-100 text-red-800"
                          : item.agingBucket === "AMBER_8_29"
                          ? "bg-amber-100 text-amber-900"
                          : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      Hace {item.daysOverdue} días
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span>Total: S/ {item.totalPen.toFixed(2)}</span>
                    <span className="text-emerald-700 font-semibold">
                      Abonado: S/ {item.paidPen.toFixed(2)} ({item.paymentCount} abonos)
                    </span>
                    <span className="text-sm font-extrabold text-red-700">
                      Falta: S/ {item.balanceDuePen.toFixed(2)}
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-600">
                    <span>
                      📅 Fecha pactada cobro:{" "}
                      <strong>{item.promisedPaymentDate || "No pactada"}</strong>
                    </span>
                    <span className="font-bold">
                      {item.promiseStatus === "PROMISE_BROKEN"
                        ? "🚨 Promesa vencida"
                        : item.promiseStatus === "DUE_TODAY_OR_TOMORROW"
                        ? "🔥 Cobrar Hoy/Mañana"
                        : "📅 En plazo"}
                    </span>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => {
                        setSelectedOrderForAbono(item);
                        setAbonoAmount(String(item.balanceDuePen));
                      }}
                      className="flex-1 rounded-xl bg-blue-600 py-2 text-xs font-extrabold text-white"
                    >
                      + Registrar Abono
                    </button>
                    <button
                      onClick={() => handleOpenTimeline(item.orderId)}
                      className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700"
                    >
                      Ver Fechas de Abono ({item.paymentCount})
                    </button>
                  </div>

                  {timelineOrderId === item.orderId && (
                    <div className="mt-2 rounded-xl bg-slate-50 p-2.5 text-xs">
                      <p className="font-bold text-slate-700 mb-1">
                        Historial de pagos de este pedido:
                      </p>
                      {timelineEntries.length === 0 ? (
                        <p className="text-slate-500">Sin abonos previos.</p>
                      ) : (
                        <ul className="space-y-1">
                          {timelineEntries.map((t) => (
                            <li
                              key={String(t.arPaymentId)}
                              className="flex justify-between border-b border-slate-200 pb-1"
                            >
                              <span>
                                {String(t.paymentDate)} · {String(t.paymentMode)} (
                                {String(t.collectedByName || "Histórico")})
                              </span>
                              <strong className="text-emerald-700">
                                S/ {Number(t.amountPen).toFixed(2)}
                              </strong>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2.5">
              {debtorsByCustomer.map((c) => (
                <div
                  key={c.customerKey}
                  className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-extrabold text-slate-900">
                      {c.customerName}
                    </h3>
                    <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-extrabold text-red-800">
                      Debe S/ {c.totalBalanceDuePen.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    {c.openOrdersCount} pedido(s) pendientes · Más antiguo: hace{" "}
                    {c.maxDaysOverdue} días · Próxima visita:{" "}
                    {c.earliestPromisedPaymentDate || "-"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {tab === "pedidos" && (
        <main className="space-y-2.5 p-3">
          {orders.map((o) => (
            <div
              key={String(o.order_id)}
              className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-700">
                  {String(o.order_code)} · {String(o.order_date)}
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold">
                  {String(o.operational_status)}
                </span>
              </div>
              <h3 className="mt-1 text-sm font-extrabold text-slate-900">
                {String(o.customer_name)}
              </h3>
              <p className="text-xs text-slate-600">
                Total: S/ {Number(o.total_pen).toFixed(2)} · Pagado: S/{" "}
                {Number(o.paid_pen).toFixed(2)} · Saldo: S/{" "}
                {Number(o.balance_due_pen).toFixed(2)}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Tomó: {String(o.created_by_name || "-")} · Alistó:{" "}
                {String(o.picked_by_name || "Pendiente")} · Repartió:{" "}
                {String(o.delivered_by_name || "Pendiente")}
              </p>
            </div>
          ))}
        </main>
      )}

      {tab === "gastos" && (
        <main className="p-3">
          <form
            onSubmit={handleSubmitExpense}
            className="space-y-3 rounded-2xl bg-white p-4 shadow-sm"
          >
            <h2 className="text-base font-extrabold text-slate-900">
              Registrar Gasto Operativo de Ruta
            </h2>
            <select
              value={expenseCategory}
              onChange={(e) => setExpenseCategory(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-bold"
            >
              <option value="COMBUSTIBLE">Combustible / Gasolina</option>
              <option value="PEAJE">Peaje / Cochera</option>
              <option value="ALMUERZO_VIATICOS">Almuerzo / Viáticos Ruta</option>
              <option value="ESTIBADOR_APOYO">Estibador / Descarga</option>
            </select>
            <input
              type="number"
              step="0.50"
              required
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              placeholder="Monto en Soles (S/)"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-bold"
            />
            <input
              type="text"
              required
              value={expenseDesc}
              onChange={(e) => setExpenseDesc(e.target.value)}
              placeholder="Detalle breve (ej. Gasolina movilidad placa X)"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            />
            <button
              type="submit"
              className="w-full rounded-xl bg-blue-600 py-3.5 text-sm font-extrabold text-white"
            >
              Guardar Gasto de Ruta
            </button>
          </form>
        </main>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-20 mx-auto flex max-w-2xl border-t border-slate-200 bg-white">
        {[
          { id: "nuevo", label: "1. Nuevo Pedido" },
          { id: "deudores", label: "2. Cobros / Deudores" },
          { id: "pedidos", label: "3. Mis Pedidos" },
          { id: "gastos", label: "4. Gastos Ruta" },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id as typeof tab)}
            className={`flex-1 py-3.5 text-xs font-extrabold ${
              tab === item.id
                ? "border-t-2 border-blue-600 text-blue-600"
                : "text-slate-500"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
