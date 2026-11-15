"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface WarehouseLine {
  order_line_id: number;
  line_no: number;
  sku: string;
  raw_description: string;
  quantity: number;
  fulfillment_mode: "STOCKED" | "ON_DEMAND";
  fulfillment_status: string;
  needs_supplier_pickup: boolean;
}

interface WarehouseOrder {
  order_id: number;
  order_code: string;
  order_date: string;
  customer_name: string;
  operational_status: "REGISTERED" | "PICKING" | "READY" | "IN_ROUTE" | "DELIVERED";
  notes: string | null;
  created_by_name: string | null;
  picked_by_name: string | null;
  delivered_by_name: string | null;
  lines: WarehouseLine[];
}

const STATUS_TABS = [
  { id: "REGISTERED", label: "Por Alistar" },
  { id: "PICKING", label: "En Alistamiento" },
  { id: "READY", label: "Listos" },
  { id: "IN_ROUTE", label: "En Ruta" },
  { id: "DELIVERED", label: "Entregados" },
] as const;

export default function AlmacenPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<WarehouseOrder[]>([]);
  const [activeTab, setActiveTab] = useState<string>("REGISTERED");
  const [checkedLines, setCheckedLines] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null);

  async function loadOrders() {
    setLoading(true);
    const res = await fetch("/api/orders");
    if (res.status === 401 || res.status === 403) {
      router.push("/login");
      return;
    }
    const data = await res.json();
    setOrders(data.orders || []);
    setLoading(false);
  }

  useEffect(() => {
    loadOrders();
  }, []);

  async function handleAdvance(
    orderId: number,
    nextStatus: "PICKING" | "READY" | "IN_ROUTE" | "DELIVERED"
  ) {
    setBusyOrderId(orderId);
    await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "advance", orderId, nextStatus }),
    });
    setBusyOrderId(null);
    await loadOrders();
  }

  async function handleLogout() {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    router.push("/login");
  }

  const filtered = orders.filter((o) => o.operational_status === activeTab);

  return (
    <div className="mx-auto min-h-screen max-w-xl bg-slate-100 pb-20">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-slate-900 px-4 py-3 text-white shadow">
        <div>
          <span className="rounded bg-amber-500 px-2 py-0.5 text-[10px] font-extrabold text-slate-950">
            ALMACÉN Y REPARTO (MODO OPERATIVO SIN PRECIOS)
          </span>
          <h1 className="text-lg font-bold">Cola de Pedidos y Despacho</h1>
        </div>
        <button
          onClick={handleLogout}
          className="rounded-lg bg-slate-700 px-3 py-2 text-xs font-bold hover:bg-slate-600"
        >
          Salir
        </button>
      </header>

      <div className="flex gap-1 overflow-x-auto bg-white p-2 shadow-sm">
        {STATUS_TABS.map((tab) => {
          const count = orders.filter((o) => o.operational_status === tab.id).length;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-shrink-0 rounded-xl px-3 py-2.5 text-xs font-bold transition ${
                active
                  ? "bg-blue-600 text-white shadow"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {tab.label} ({count})
            </button>
          );
        })}
      </div>

      <main className="space-y-3 p-3">
        {loading ? (
          <p className="p-6 text-center text-sm text-slate-500">
            Cargando pedidos operativos...
          </p>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
            No hay pedidos en la etapa seleccionada.
          </div>
        ) : (
          filtered.map((order) => (
            <div
              key={order.order_id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between border-b border-slate-100 pb-2">
                <div>
                  <span className="text-xs font-bold text-blue-700">
                    {order.order_code} · {order.order_date}
                  </span>
                  <h2 className="text-base font-extrabold text-slate-900">
                    {order.customer_name}
                  </h2>
                  {order.notes && (
                    <p className="mt-0.5 text-xs font-medium text-amber-800">
                      Nota/Destino: {order.notes}
                    </p>
                  )}
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                  {order.lines.length} ítems
                </span>
              </div>

              <ul className="my-3 divide-y divide-slate-100">
                {order.lines.map((line) => {
                  const checked = Boolean(checkedLines[line.order_line_id]);
                  return (
                    <li
                      key={line.order_line_id}
                      onClick={() =>
                        setCheckedLines((prev) => ({
                          ...prev,
                          [line.order_line_id]: !checked,
                        }))
                      }
                      className="flex cursor-pointer items-center justify-between py-2.5"
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          readOnly
                          className="h-5 w-5 rounded border-slate-300 text-blue-600"
                        />
                        <div>
                          <p
                            className={`text-sm font-bold ${
                              checked
                                ? "line-through text-slate-400"
                                : "text-slate-900"
                            }`}
                          >
                            {line.raw_description}
                          </p>
                          <div className="flex flex-wrap gap-1.5 mt-0.5">
                            <span className="text-[11px] font-medium text-slate-500">
                              SKU: {line.sku}
                            </span>
                            {line.needs_supplier_pickup && (
                              <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-900">
                                POR RECOGER DE PROVEEDOR (ON_DEMAND)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-900 px-3 py-1.5 text-base font-extrabold text-white">
                        x {line.quantity}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="mb-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
                <span>Tomó: {order.created_by_name || "Sistema"}</span>
                {order.picked_by_name && (
                  <span>· Alistó: {order.picked_by_name}</span>
                )}
                {order.delivered_by_name && (
                  <span>· Repartió: {order.delivered_by_name}</span>
                )}
              </div>

              {order.operational_status === "REGISTERED" && (
                <button
                  disabled={busyOrderId === order.order_id}
                  onClick={() => handleAdvance(order.order_id, "PICKING")}
                  className="w-full rounded-xl bg-amber-500 py-3.5 text-sm font-extrabold text-slate-950 shadow hover:bg-amber-400"
                >
                  Empezar Alistamiento en Almacén
                </button>
              )}
              {order.operational_status === "PICKING" && (
                <button
                  disabled={busyOrderId === order.order_id}
                  onClick={() => handleAdvance(order.order_id, "READY")}
                  className="w-full rounded-xl bg-blue-600 py-3.5 text-sm font-extrabold text-white shadow hover:bg-blue-700"
                >
                  Marcar Pedido LISTO para Cargar
                </button>
              )}
              {order.operational_status === "READY" && (
                <button
                  disabled={busyOrderId === order.order_id}
                  onClick={() => handleAdvance(order.order_id, "IN_ROUTE")}
                  className="w-full rounded-xl bg-indigo-600 py-3.5 text-sm font-extrabold text-white shadow hover:bg-indigo-700"
                >
                  Salir a Ruta (En Movilidad)
                </button>
              )}
              {order.operational_status === "IN_ROUTE" && (
                <button
                  disabled={busyOrderId === order.order_id}
                  onClick={() => handleAdvance(order.order_id, "DELIVERED")}
                  className="w-full rounded-xl bg-emerald-600 py-3.5 text-sm font-extrabold text-white shadow hover:bg-emerald-700"
                >
                  Confirmar ENTREGA al Cliente
                </button>
              )}
            </div>
          ))
        )}
      </main>
    </div>
  );
}
