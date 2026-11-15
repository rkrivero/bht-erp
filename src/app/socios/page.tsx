"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface PartnerCatalogItem {
  product_id: number;
  sku: string;
  name: string;
  unit_of_measure: string;
  fulfillment_mode: "STOCKED" | "ON_DEMAND";
  stock_on_hand: number;
  list_sale_price_pen: number | null;
  min_sale_price_pen: number | null;
  ref_cost_pen: number | null;
}

const CREDIT_DAY_CHIPS = [
  { days: 1, label: "Mañana (+1d)" },
  { days: 3, label: "En 3 días" },
  { days: 7, label: "En 7 días (1 sem)" },
  { days: 10, label: "En 10 días" },
  { days: 15, label: "En 15 días (2 sem)" },
];

export default function SociosPage() {
  const router = useRouter();
  const [tab, setTab] = useState<
    "control" | "deudores" | "stock" | "caja" | "kpis"
  >("control");
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([]);
  const [catalog, setCatalog] = useState<PartnerCatalogItem[]>([]);
  const [debtorsByOrder, setDebtorsByOrder] = useState<Array<Record<string, unknown>>>([]);
  const [debtorsByCustomer, setDebtorsByCustomer] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [partnerData, setPartnerData] = useState<Record<string, unknown> | null>(
    null
  );
  const [treasuryData, setTreasuryData] = useState<Record<string, unknown> | null>(
    null
  );
  const [feedback, setFeedback] = useState<string | null>(null);

  // Stock & Pricing edit state
  const [searchSku, setSearchSku] = useState("");
  const [editingProd, setEditingProd] = useState<PartnerCatalogItem | null>(null);
  const [editStock, setEditStock] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editMinPrice, setEditMinPrice] = useState("");
  const [editMode, setEditMode] = useState<"STOCKED" | "ON_DEMAND">("STOCKED");

  // Abono state
  const [promiseFilter, setPromiseFilter] = useState("ALL");
  const [abonoOrder, setAbonoOrder] = useState<Record<string, unknown> | null>(
    null
  );
  const [fifoCustomer, setFifoCustomer] = useState<Record<string, unknown> | null>(
    null
  );
  const [abonoAmount, setAbonoAmount] = useState("");
  const [abonoMode, setAbonoMode] = useState<"CASH" | "YAPE_PLIN" | "TRANSFER">(
    "CASH"
  );
  const [abonoNextDays, setAbonoNextDays] = useState<number>(7);

  // Outflow state
  const [outflowBucket, setOutflowBucket] = useState<
    "ROUTE_OPEX" | "MERCHANDISE_PAYMENT" | "NON_OPEX_OR_CAPEX"
  >("ROUTE_OPEX");
  const [outflowCategory, setOutflowCategory] = useState("COMBUSTIBLE");
  const [outflowAmount, setOutflowAmount] = useState("");
  const [outflowDesc, setOutflowDesc] = useState("");

  async function loadDashboard() {
    const [ordRes, colRes, partRes, trRes] = await Promise.all([
      fetch("/api/orders"),
      fetch("/api/collections"),
      fetch("/api/partners"),
      fetch("/api/treasury"),
    ]);
    if (ordRes.status === 401 || partRes.status === 403) {
      router.push("/login");
      return;
    }
    const [ordJson, colJson, partJson, trJson] = await Promise.all([
      ordRes.json(),
      colRes.json(),
      partRes.json(),
      trRes.json(),
    ]);
    setOrders(ordJson.orders || []);
    setCatalog(ordJson.catalog || []);
    setDebtorsByOrder(colJson.byOrder || []);
    setDebtorsByCustomer(colJson.byCustomer || []);
    setPartnerData(partJson);
    setTreasuryData(trJson);
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  async function handleApproveDiscount(orderId: number) {
    setFeedback(null);
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", orderId }),
    });
    const data = await res.json();
    if (res.ok) {
      setFeedback(`Pedido #${orderId} aprobado y enviado a Almacén.`);
      await loadDashboard();
    } else {
      setFeedback(data.error || "Error al aprobar");
    }
  }

  async function handleResetNegativeStock() {
    setFeedback(null);
    const res = await fetch("/api/partners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset_negative_stock" }),
    });
    const data = await res.json();
    if (res.ok) {
      setFeedback(
        `¡Listo! Se pusieron en 0 exactamente ${data.adjustedSkuCount} SKUs con saldo negativo histórico.`
      );
      await loadDashboard();
    } else {
      setFeedback(data.error || "Error al poner en 0 saldos negativos");
    }
  }

  async function handleSaveProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!editingProd) return;
    const res = await fetch("/api/partners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_product",
        productId: editingProd.product_id,
        physicalStock: editStock,
        refCostPen: editCost,
        listSalePricePen: editPrice,
        minSalePricePen: editMinPrice,
        fulfillmentMode: editMode,
      }),
    });
    if (res.ok) {
      setFeedback(`Producto ${editingProd.sku} actualizado.`);
      setEditingProd(null);
      await loadDashboard();
    }
  }

  async function handleSaveAbono(e: React.FormEvent) {
    e.preventDefault();
    if (!abonoOrder && !fifoCustomer) return;
    const payload = fifoCustomer
      ? {
          mode: "fifo_customer",
          customerPartyId: Number(fifoCustomer.customerPartyId),
          totalAmountPen: Number(abonoAmount),
          paymentMode: abonoMode,
          nextCollectionDays: abonoNextDays,
          notes: "Abono general FIFO registrado por Socio",
        }
      : {
          mode: "single_order",
          orderId: Number(abonoOrder!.orderId),
          amountPen: Number(abonoAmount),
          paymentMode: abonoMode,
          nextCollectionDays: abonoNextDays,
          notes: "Cobro registrado por Socio",
        };
    const res = await fetch("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setFeedback("Abono registrado correctamente.");
      setAbonoOrder(null);
      setFifoCustomer(null);
      setAbonoAmount("");
      await loadDashboard();
    }
  }

  async function handleSaveOutflow(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/treasury", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amountPen: Number(outflowAmount),
        expenseBucket: outflowBucket,
        expenseCategory: outflowCategory,
        description: outflowDesc,
      }),
    });
    if (res.ok) {
      setFeedback("Egreso registrado en Caja.");
      setOutflowAmount("");
      setOutflowDesc("");
      await loadDashboard();
    }
  }

  const pendingApprovals = orders.filter(
    (o) => o.operational_status === "PENDING_PARTNER_APPROVAL"
  );
  const pendingOnDemand =
    (partnerData?.pendingOnDemand as Array<Record<string, unknown>>) || [];
  const kpiQ1 = (partnerData?.kpiQ1 as Record<string, unknown>) || null;
  const kpiQ2TopSkus =
    (partnerData?.kpiQ2TopSkus as Array<Record<string, unknown>>) || [];
  const qualityGaps =
    (partnerData?.qualityGaps as Array<Record<string, unknown>>) || [];
  const negStockCount = Number(partnerData?.negativeStockSkuCount ?? 0);

  return (
    <div className="min-h-screen bg-slate-100 pb-24">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 bg-slate-950 px-4 py-3 text-white shadow">
        <div>
          <span className="rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-extrabold text-slate-950">
            TORRE DE CONTROL SOCIOS · ACCESO TOTAL (MÓVIL + PC)
          </span>
          <h1 className="text-lg font-extrabold">
            Blue Horizon Trade — Gestión en Vivo e Insights
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/vendedor")}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold"
          >
            + Tomar Pedido Rápido
          </button>
          <button
            onClick={() => router.push("/almacen")}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950"
          >
            Vista Almacén
          </button>
          <button
            onClick={async () => {
              await fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "logout" }),
              });
              router.push("/login");
            }}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold"
          >
            Salir
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-3 pt-3">
        <div className="flex gap-1.5 overflow-x-auto rounded-2xl bg-white p-2 shadow-sm">
          {[
            {
              id: "control",
              label: `1. Control en Vivo (${pendingApprovals.length} por aprobar)`,
            },
            {
              id: "deudores",
              label: `2. Deudores y Cobros (${debtorsByOrder.length})`,
            },
            {
              id: "stock",
              label: `3. Stock y Precios Día 1 (${negStockCount} neg)`,
            },
            { id: "caja", label: "4. Caja, Compras y Proveedores" },
            { id: "kpis", label: "5. KPIs e Insights (PC)" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as typeof tab)}
              className={`flex-shrink-0 rounded-xl px-3.5 py-2.5 text-xs font-extrabold transition ${
                tab === t.id
                  ? "bg-slate-900 text-white shadow"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {feedback && (
          <div className="mt-3 rounded-xl bg-emerald-100 p-3 text-sm font-bold text-emerald-950">
            {feedback}
          </div>
        )}

        {tab === "control" && (
          <div className="mt-4 space-y-6">
            {/* 1-Tap Discount Approval Queue */}
            <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
              <h2 className="text-base font-extrabold text-amber-950">
                Bandeja de Aprobación de Descuentos bajo el Precio Mínimo (
                {pendingApprovals.length})
              </h2>
              {pendingApprovals.length === 0 ? (
                <p className="mt-1 text-xs text-amber-800">
                  No hay pedidos retenidos por descuento en este momento.
                </p>
              ) : (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {pendingApprovals.map((o) => (
                    <div
                      key={String(o.order_id)}
                      className="rounded-xl bg-white p-3.5 shadow-sm"
                    >
                      <div className="flex justify-between">
                        <span className="text-xs font-bold text-amber-800">
                          {String(o.order_code)} · Vendedor:{" "}
                          {String(o.created_by_name || "-")}
                        </span>
                        <span className="text-xs font-extrabold text-emerald-700">
                          Margen Real: S/ {Number(o.order_margin_pen ?? 0).toFixed(2)}
                        </span>
                      </div>
                      <h3 className="mt-1 text-sm font-extrabold">
                        {String(o.customer_name)} — Total S/{" "}
                        {Number(o.total_pen).toFixed(2)}
                      </h3>
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => handleApproveDiscount(Number(o.order_id))}
                          className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-xs font-extrabold text-white"
                        >
                          ✓ Aprobar con 1 Toque y Enviar a Almacén
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ON_DEMAND Pending Supplier Purchases */}
            {pendingOnDemand.length > 0 && (
              <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
                <h2 className="text-base font-extrabold text-blue-950">
                  Pedidos ON_DEMAND Pendientes de Compra/Recojo de Proveedor (
                  {pendingOnDemand.length})
                </h2>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {pendingOnDemand.map((od) => (
                    <div
                      key={String(od.order_line_id)}
                      className="rounded-xl bg-white p-3 text-xs shadow-sm"
                    >
                      <p className="font-extrabold text-slate-900">
                        {String(od.sku)} — {String(od.product_name)} (x{" "}
                        {Number(od.quantity)})
                      </p>
                      <p className="text-slate-600">
                        Pedido: {String(od.order_code)} · Cliente:{" "}
                        {String(od.customer_name_raw)} · Venta: S/{" "}
                        {Number(od.line_total_pen).toFixed(2)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Live 4-Responsible Order Monitor */}
            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-base font-extrabold text-slate-900">
                Monitor en Tiempo Real — Trazabilidad de 4 Responsables y Márgenes
              </h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-extrabold uppercase text-slate-600">
                    <tr>
                      <th className="p-2.5">Pedido / Fecha</th>
                      <th className="p-2.5">Cliente</th>
                      <th className="p-2.5">Estado Operativo</th>
                      <th className="p-2.5">1. Tomó Pedido</th>
                      <th className="p-2.5">2. Alistó Almacén</th>
                      <th className="p-2.5">3. Repartió Ruta</th>
                      <th className="p-2.5 text-right">Venta Total</th>
                      <th className="p-2.5 text-right">Margen Real</th>
                      <th className="p-2.5 text-right">Saldo Debe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders.slice(0, 35).map((o) => (
                      <tr key={String(o.order_id)} className="hover:bg-slate-50">
                        <td className="p-2.5 font-bold text-blue-700">
                          {String(o.order_code)}
                          <span className="block text-[10px] text-slate-500">
                            {String(o.order_date)}
                          </span>
                        </td>
                        <td className="p-2.5 font-bold text-slate-900">
                          {String(o.customer_name)}
                        </td>
                        <td className="p-2.5">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold">
                            {String(o.operational_status)}
                          </span>
                        </td>
                        <td className="p-2.5">{String(o.created_by_name || "Histórico")}</td>
                        <td className="p-2.5">{String(o.picked_by_name || "-")}</td>
                        <td className="p-2.5">{String(o.delivered_by_name || "-")}</td>
                        <td className="p-2.5 text-right font-bold">
                          S/ {Number(o.total_pen).toFixed(2)}
                        </td>
                        <td className="p-2.5 text-right font-extrabold text-emerald-700">
                          S/ {Number(o.order_margin_pen ?? 0).toFixed(2)}
                        </td>
                        <td className="p-2.5 text-right font-extrabold text-red-700">
                          S/ {Number(o.balance_due_pen).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {tab === "deudores" && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-2 rounded-2xl bg-white p-3 shadow-sm">
              {[
                { id: "ALL", label: `Todos los Pedidos (${debtorsByOrder.length})` },
                {
                  id: "DUE_TODAY_OR_TOMORROW",
                  label: "🔥 Toca Cobrar Hoy / Mañana",
                },
                { id: "PROMISE_BROKEN", label: "🚨 Promesa Vencida" },
                { id: "ON_SCHEDULE", label: "📅 En Plazo" },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setPromiseFilter(f.id)}
                  className={`rounded-xl px-3 py-2 text-xs font-extrabold ${
                    promiseFilter === f.id
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {(abonoOrder || fifoCustomer) && (
              <form
                onSubmit={handleSaveAbono}
                className="rounded-2xl border-2 border-blue-600 bg-white p-4 shadow-lg space-y-3"
              >
                <div className="flex justify-between">
                  <h3 className="text-sm font-extrabold">
                    {fifoCustomer
                      ? `Abono General FIFO · ${String(fifoCustomer.customerName)}`
                      : `Registrar Abono · ${String(abonoOrder!.customerName)} (Pedido ${String(abonoOrder!.orderCode)})`}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setAbonoOrder(null);
                      setFifoCustomer(null);
                    }}
                    className="text-xs font-bold text-slate-500"
                  >
                    Cerrar
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.50"
                    required
                    value={abonoAmount}
                    onChange={(e) => setAbonoAmount(e.target.value)}
                    placeholder="Monto en Soles (S/)"
                    className="flex-1 rounded-xl border px-3 py-2 text-sm font-bold"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setAbonoAmount(
                        String(
                          fifoCustomer
                            ? fifoCustomer.totalBalanceDuePen
                            : abonoOrder!.balanceDuePen
                        )
                      )
                    }
                    className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-bold"
                  >
                    Todo (S/{" "}
                    {Number(
                      fifoCustomer
                        ? fifoCustomer.totalBalanceDuePen
                        : abonoOrder!.balanceDuePen
                    ).toFixed(2)}
                    )
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setAbonoAmount(
                        String(
                          Number(
                            (
                              Number(
                                fifoCustomer
                                  ? fifoCustomer.totalBalanceDuePen
                                  : abonoOrder!.balanceDuePen
                              ) / 2
                            ).toFixed(2)
                          )
                        )
                      )
                    }
                    className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-bold"
                  >
                    La Mitad
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-600">
                    Re-agendar saldo:
                  </span>
                  {CREDIT_DAY_CHIPS.map((c) => (
                    <button
                      key={c.days}
                      type="button"
                      onClick={() => setAbonoNextDays(c.days)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
                        abonoNextDays === c.days
                          ? "bg-amber-600 text-white"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-extrabold text-white"
                >
                  Confirmar Abono
                </button>
              </form>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <h3 className="text-sm font-extrabold text-slate-900">
                  Ranking de Clientes Deudores ({debtorsByCustomer.length})
                </h3>
                <div className="mt-3 space-y-2">
                  {debtorsByCustomer.map((c) => (
                    <div
                      key={String(c.customerKey)}
                      className="flex items-center justify-between rounded-xl border border-slate-200 p-3"
                    >
                      <div>
                        <p className="text-xs font-extrabold text-slate-900">
                          {String(c.customerName)}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {Number(c.openOrdersCount)} pedido(s) · Antigüedad máx:{" "}
                          {Number(c.maxDaysOverdue)} días · Próxima fecha:{" "}
                          {String(c.earliestPromisedPaymentDate || "-")}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-extrabold text-red-800">
                          S/ {Number(c.totalBalanceDuePen).toFixed(2)}
                        </span>
                        {Boolean(c.customerPartyId) && (
                          <button
                            onClick={() => {
                              setAbonoOrder(null);
                              setFifoCustomer(c);
                              setAbonoAmount(String(c.totalBalanceDuePen));
                            }}
                            className="rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-extrabold text-white"
                          >
                            + Abono FIFO
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <h3 className="text-sm font-extrabold text-slate-900">
                  Pedidos Pendientes de Cobro y Fechas Pactadas
                </h3>
                <div className="mt-3 space-y-2">
                  {debtorsByOrder
                    .filter(
                      (o) =>
                        promiseFilter === "ALL" ||
                        o.promiseStatus === promiseFilter
                    )
                    .map((o) => (
                      <div
                        key={String(o.orderId)}
                        className="rounded-xl border border-slate-200 p-3"
                      >
                        <div className="flex justify-between">
                          <span className="text-xs font-bold text-slate-700">
                            {String(o.orderCode)} · {String(o.customerName)}
                          </span>
                          <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-extrabold text-red-800">
                            Hace {Number(o.daysOverdue)} días
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600">
                          Total: S/ {Number(o.totalPen).toFixed(2)} · Abonado: S/{" "}
                          {Number(o.paidPen).toFixed(2)} ·{" "}
                          <strong className="text-red-700">
                            Falta: S/ {Number(o.balanceDuePen).toFixed(2)}
                          </strong>
                        </p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-slate-600">
                            Pactado: {String(o.promisedPaymentDate || "-")} (
                            {String(o.promiseStatus)})
                          </span>
                          <button
                            onClick={() => {
                              setAbonoOrder(o);
                              setAbonoAmount(String(o.balanceDuePen));
                            }}
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-extrabold text-white"
                          >
                            + Abonar
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "stock" && (
          <div className="mt-4 space-y-4">
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
              <div>
                <h2 className="text-base font-extrabold text-amber-950">
                  Puesta a Punto de Inventario (Día 1)
                </h2>
                <p className="text-xs text-amber-900">
                  Existen actualmente <strong>{negStockCount} SKUs</strong> con
                  saldo negativo histórico por ventas sin compra previa registrada.
                </p>
              </div>
              <button
                onClick={handleResetNegativeStock}
                className="rounded-xl bg-amber-600 px-4 py-3 text-xs font-extrabold text-white shadow hover:bg-amber-700"
              >
                Poner en 0 los {negStockCount} Saldos Negativos Históricos
              </button>
            </section>

            {editingProd && (
              <form
                onSubmit={handleSaveProduct}
                className="rounded-2xl border-2 border-blue-600 bg-white p-4 shadow-lg space-y-3"
              >
                <div className="flex justify-between">
                  <h3 className="text-sm font-extrabold">
                    Editar Producto: {editingProd.sku} — {editingProd.name}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setEditingProd(null)}
                    className="text-xs font-bold text-slate-500"
                  >
                    Cerrar
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500">
                      Stock Físico Real
                    </label>
                    <input
                      type="number"
                      step="1"
                      value={editStock}
                      onChange={(e) => setEditStock(e.target.value)}
                      className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500">
                      Costo Real (S/)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editCost}
                      onChange={(e) => setEditCost(e.target.value)}
                      className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500">
                      Precio Normal (S/)
                    </label>
                    <input
                      type="number"
                      step="0.50"
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                      className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500">
                      Precio Mínimo (S/)
                    </label>
                    <input
                      type="number"
                      step="0.50"
                      value={editMinPrice}
                      onChange={(e) => setEditMinPrice(e.target.value)}
                      className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500">
                      Modalidad
                    </label>
                    <select
                      value={editMode}
                      onChange={(e) =>
                        setEditMode(e.target.value as "STOCKED" | "ON_DEMAND")
                      }
                      className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-bold"
                    >
                      <option value="STOCKED">STOCKED (Con Stock)</option>
                      <option value="ON_DEMAND">ON_DEMAND (Bajo Pedido)</option>
                    </select>
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-blue-600 py-2.5 text-xs font-extrabold text-white"
                >
                  Guardar Cambios en Catálogo e Inventario
                </button>
              </form>
            )}

            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <input
                type="text"
                value={searchSku}
                onChange={(e) => setSearchSku(e.target.value)}
                placeholder="Buscar producto por nombre o SKU para editar costo, precio mínimo o stock..."
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              />
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b bg-slate-50 text-[11px] font-extrabold uppercase text-slate-600">
                    <tr>
                      <th className="p-2">SKU / Producto</th>
                      <th className="p-2">Modo</th>
                      <th className="p-2 text-right">Stock Actual</th>
                      <th className="p-2 text-right">Costo Real (S/)</th>
                      <th className="p-2 text-right">Precio Normal (S/)</th>
                      <th className="p-2 text-right">Precio Mínimo (S/)</th>
                      <th className="p-2 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {catalog
                      .filter(
                        (p) =>
                          p.name.toLowerCase().includes(searchSku.toLowerCase()) ||
                          p.sku.toLowerCase().includes(searchSku.toLowerCase())
                      )
                      .slice(0, 40)
                      .map((p) => (
                        <tr key={p.product_id}>
                          <td className="p-2 font-bold">
                            {p.name}
                            <span className="block text-[10px] text-slate-500">
                              {p.sku}
                            </span>
                          </td>
                          <td className="p-2">{p.fulfillment_mode}</td>
                          <td
                            className={`p-2 text-right font-extrabold ${
                              p.stock_on_hand < 0
                                ? "text-red-600"
                                : "text-slate-900"
                            }`}
                          >
                            {p.stock_on_hand}
                          </td>
                          <td className="p-2 text-right">
                            {p.ref_cost_pen !== null
                              ? `S/ ${p.ref_cost_pen.toFixed(2)}`
                              : "SIN COSTO"}
                          </td>
                          <td className="p-2 text-right font-bold">
                            S/ {Number(p.list_sale_price_pen ?? 0).toFixed(2)}
                          </td>
                          <td className="p-2 text-right font-bold text-blue-700">
                            S/ {Number(p.min_sale_price_pen ?? 0).toFixed(2)}
                          </td>
                          <td className="p-2 text-right">
                            <button
                              onClick={() => {
                                setEditingProd(p);
                                setEditStock(String(p.stock_on_hand));
                                setEditCost(
                                  p.ref_cost_pen !== null
                                    ? String(p.ref_cost_pen)
                                    : ""
                                );
                                setEditPrice(String(p.list_sale_price_pen ?? ""));
                                setEditMinPrice(String(p.min_sale_price_pen ?? ""));
                                setEditMode(p.fulfillment_mode);
                              }}
                              className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-bold text-white"
                            >
                              Editar
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {tab === "caja" && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <form
              onSubmit={handleSaveOutflow}
              className="space-y-3 rounded-2xl bg-white p-4 shadow-sm"
            >
              <h2 className="text-base font-extrabold text-slate-900">
                Registrar Salida de Caja / Pago a Proveedor / Retiro
              </h2>
              <select
                value={outflowBucket}
                onChange={(e) =>
                  setOutflowBucket(e.target.value as typeof outflowBucket)
                }
                className="w-full rounded-xl border px-3 py-2.5 text-sm font-bold"
              >
                <option value="ROUTE_OPEX">Gasto Operativo de Ruta (ROUTE_OPEX)</option>
                <option value="MERCHANDISE_PAYMENT">
                  Pago de Mercadería / Proveedor (MERCHANDISE_PAYMENT)
                </option>
                <option value="NON_OPEX_OR_CAPEX">
                  Retiro Socio / Gasto No Operativo (NON_OPEX_OR_CAPEX)
                </option>
              </select>
              <input
                type="text"
                required
                value={outflowCategory}
                onChange={(e) => setOutflowCategory(e.target.value)}
                placeholder="Categoría (ej. PAGO_PROVEEDOR, COMBUSTIBLE, RETIRO_SOCIO)"
                className="w-full rounded-xl border px-3 py-2 text-sm font-bold"
              />
              <input
                type="number"
                step="0.50"
                required
                value={outflowAmount}
                onChange={(e) => setOutflowAmount(e.target.value)}
                placeholder="Monto en Soles (S/)"
                className="w-full rounded-xl border px-3 py-2 text-sm font-bold"
              />
              <input
                type="text"
                required
                value={outflowDesc}
                onChange={(e) => setOutflowDesc(e.target.value)}
                placeholder="Descripción detallada"
                className="w-full rounded-xl border px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="w-full rounded-xl bg-blue-600 py-3 text-sm font-extrabold text-white"
              >
                Guardar Movimiento de Caja
              </button>
            </form>

            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-base font-extrabold text-slate-900">
                Cuentas por Pagar a Proveedores (Qingdao / AP)
              </h2>
              <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
                {(
                  (treasuryData?.apObligations as Array<Record<string, unknown>>) ||
                  []
                ).map((ap) => (
                  <div
                    key={String(ap.obligation_id)}
                    className="flex items-center justify-between rounded-xl border p-2.5 text-xs"
                  >
                    <div>
                      <p className="font-bold text-slate-900">
                        {String(ap.doc_ref)} · {String(ap.issue_date)}
                      </p>
                      <p className="text-slate-500">
                        Total: S/ {Number(ap.principal_pen).toFixed(2)} · Pagado: S/{" "}
                        {Number(ap.paid_pen).toFixed(2)}
                      </p>
                    </div>
                    <span className="font-extrabold text-red-700">
                      Saldo: S/ {Number(ap.balance_pen).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "kpis" && kpiQ1 && (
          <div className="mt-4 space-y-6">
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <span className="text-xs font-bold uppercase text-slate-500">
                  Ventas Totales ({String(kpiQ1.period_start)} a{" "}
                  {String(kpiQ1.period_end)})
                </span>
                <p className="mt-1 text-2xl font-extrabold text-slate-900">
                  S/ {Number(kpiQ1.total_sales_pen).toLocaleString("es-PE")}
                </p>
                <span className="text-xs text-emerald-700 font-bold">
                  Cobrado: S/{" "}
                  {Number(kpiQ1.collected_sales_pen).toLocaleString("es-PE")}
                </span>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <span className="text-xs font-bold uppercase text-slate-500">
                  Cuentas por Cobrar (AR Pendiente)
                </span>
                <p className="mt-1 text-2xl font-extrabold text-red-600">
                  S/ {Number(kpiQ1.accounts_receivable_pen).toLocaleString("es-PE")}
                </p>
                <span className="text-xs text-slate-600">
                  12 pedidos históricos vencidos + cartera activa
                </span>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <span className="text-xs font-bold uppercase text-slate-500">
                  Ratio Drenaje No-OpEx vs Reinversión
                </span>
                <p className="mt-1 text-2xl font-extrabold text-amber-600">
                  {Number(kpiQ1.non_opex_vs_reinvestment_ratio_pct).toFixed(2)}%
                </p>
                <span className="text-xs font-bold text-red-700">
                  {String(kpiQ1.reinvestment_health_flag)} (Meta &lt; 30%)
                </span>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <span className="text-xs font-bold uppercase text-slate-500">
                  Brecha Arqueo Efectivo Ruta
                </span>
                <p className="mt-1 text-2xl font-extrabold text-slate-900">
                  S/ {Number(kpiQ1.reconciliation_gap_pen).toFixed(2)} (
                  {Number(kpiQ1.reconciliation_gap_pct).toFixed(2)}%)
                </p>
                <span className="text-xs text-emerald-700 font-bold">
                  {String(kpiQ1.reconciliation_health_flag)}
                </span>
              </div>
            </section>

            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-base font-extrabold text-slate-900">
                Top SKUs por Ingresos y Margen Bruto Real (P2)
              </h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b bg-slate-50 text-[11px] font-extrabold uppercase text-slate-600">
                    <tr>
                      <th className="p-2">SKU / Producto</th>
                      <th className="p-2 text-right">Unid. Vendidas</th>
                      <th className="p-2 text-right">Ingresos (S/)</th>
                      <th className="p-2 text-right">Costo COGS (S/)</th>
                      <th className="p-2 text-right">Margen Bruto (S/)</th>
                      <th className="p-2 text-right">Margen %</th>
                      <th className="p-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {kpiQ2TopSkus.map((sku) => (
                      <tr key={String(sku.sku)}>
                        <td className="p-2 font-bold">
                          {String(sku.product_name)}
                          <span className="block text-[10px] text-slate-500">
                            {String(sku.sku)}
                          </span>
                        </td>
                        <td className="p-2 text-right">
                          {Number(sku.total_units_sold)}
                        </td>
                        <td className="p-2 text-right font-bold">
                          S/ {Number(sku.total_revenue_pen).toFixed(2)}
                        </td>
                        <td className="p-2 text-right">
                          {sku.total_cogs_pen !== null
                            ? `S/ ${Number(sku.total_cogs_pen).toFixed(2)}`
                            : "-"}
                        </td>
                        <td className="p-2 text-right font-extrabold text-emerald-700">
                          {sku.gross_margin_pen !== null
                            ? `S/ ${Number(sku.gross_margin_pen).toFixed(2)}`
                            : "-"}
                        </td>
                        <td className="p-2 text-right font-bold">
                          {sku.gross_margin_pct !== null
                            ? `${Number(sku.gross_margin_pct).toFixed(1)}%`
                            : "-"}
                        </td>
                        <td className="p-2">
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold">
                            {String(sku.margin_health_status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-base font-extrabold text-slate-900">
                 Estado de Calidad de Datos e Integridad Operativa
              </h2>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {qualityGaps.map((g) => (
                  <div
                    key={String(g.metric_code)}
                    className="rounded-xl border border-slate-200 p-3 text-xs"
                  >
                    <span className="font-bold text-slate-500">
                      {String(g.metric_code)}
                    </span>
                    <p className="mt-0.5 font-extrabold text-slate-900">
                      {String(g.metric_label)}: {Number(g.gap_count)} casos (S/{" "}
                      {Number(g.impacted_amount_pen).toFixed(2)})
                    </p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      {String(g.recommended_action)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
