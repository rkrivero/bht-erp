"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

const PRESET_USERS = [
  {
    username: "socio_admin",
    label: "1. Socio Operativo y Admin",
    subtitle: "Ruta, Cobros, Costos, Catálogo y Aprobaciones",
    defaultPinHint: "PIN inicial: 1111",
    badge: "ACCESO TOTAL",
  },
  {
    username: "socio_gerente",
    label: "2. Socio Gerente",
    subtitle: "Monitoreo en Vivo, Márgenes, KPIs y Aprobaciones",
    defaultPinHint: "PIN inicial: 2222",
    badge: "GERENCIA",
  },
  {
    username: "vendedor1",
    label: "3. Vendedor Externo",
    subtitle: "Pedidos, Descuentos en S/, Cobros y Gastos Ruta",
    defaultPinHint: "PIN inicial: 3333",
    badge: "VENTAS RUTA",
  },
  {
    username: "almacen1",
    label: "4. Almacén (Alistamiento)",
    subtitle: "Solo cantidades y productos por armar (Sin precios)",
    defaultPinHint: "PIN inicial: 4444",
    badge: "ALMACÉN",
  },
  {
    username: "reparto1",
    label: "5. Movilidad y Reparto",
    subtitle: "Salida a ruta y entrega en destino (Sin precios)",
    defaultPinHint: "PIN inicial: 5555",
    badge: "REPARTO",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("socio_admin");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Credenciales inválidas");
        setLoading(false);
        return;
      }
      const role = data.user.role;
      if (role === "WAREHOUSE_DELIVERY") router.push("/almacen");
      else if (role === "EXTERNAL_SELLER") router.push("/vendedor");
      else router.push("/socios");
    } catch {
      setError("Error de red al iniciar sesión");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5">
          <span className="inline-block rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">
            BLUE HORIZON TRADE · PEN (S/)
          </span>
          <h1 className="mt-2 text-2xl font-extrabold text-slate-900">
            Ingreso Rápido ERP
          </h1>
          <p className="text-sm text-slate-600">
            Selecciona tu puesto e ingresa tu PIN de 4 dígitos.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase text-slate-500">
              Puesto / Usuario
            </label>
            <div className="space-y-2">
              {PRESET_USERS.map((u) => {
                const active = username === u.username;
                return (
                  <button
                    key={u.username}
                    type="button"
                    onClick={() => {
                      setUsername(u.username);
                      setError(null);
                    }}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      active
                        ? "border-blue-600 bg-blue-50 ring-2 ring-blue-500"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">{u.label}</span>
                      <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                        {u.badge}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-600">{u.subtitle}</p>
                    <p className="mt-1 text-[11px] font-medium text-blue-700">
                      {u.defaultPinHint}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-slate-500">
              PIN de Acceso
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
              required
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3.5 text-center text-2xl font-bold tracking-widest focus:border-blue-600 focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-blue-600 py-4 text-base font-bold text-white shadow hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Ingresando..." : "Entrar al Sistema"}
          </button>
        </form>
      </div>
    </main>
  );
}
