"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  HorizonLogo,
  LockIcon,
} from "@/components/ui/Icons";
import {
  Badge,
  Button,
  FieldLabel,
  INPUT_CLASS,
  ToastBanner,
} from "@/components/ui/Primitives";

interface AuthUserSummary {
  user_id: number;
  username: string;
  full_name: string;
  role: string;
  pin_hint?: string;
}

const LEGACY_SEED_NAMES: Record<string, string> = {
  socio_gerente: "Socio Gerente",
  socio_admin: "Socio Operativo y Admin",
  vendedor1: "Vendedor Externo Ruta",
  almacen1: "Encargado de Almacén",
  reparto1: "Chofer y Reparto",
};

const SHOW_INITIAL_PIN_HINTS =
  process.env.NEXT_PUBLIC_SHOW_INITIAL_PIN_HINTS === "true";

const PRESET_USERS = [
  {
    username: "socio_gerente",
    label: "Gerencia",
    scope: "Indicadores, caja y compras",
    fallbackPerson: "Samuel",
  },
  {
    username: "socio_admin",
    label: "Ventas y Control",
    scope: "Control operativo, pedidos y cobranza",
    fallbackPerson: "Renzo",
  },
  {
    username: "vendedor1",
    label: "Vendedor",
    scope: "Pedidos en ruta y cobranza",
    fallbackPerson: "Franco",
  },
  {
    username: "almacen1",
    label: "Almacén",
    scope: "Preparación de pedidos",
    fallbackPerson: "Manuel",
  },
  {
    username: "reparto1",
    label: "Almacén y Reparto",
    scope: "Carga, ruta y entregas",
    fallbackPerson: "Emerson",
  },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState<string>("socio_gerente");
  const [liveUsers, setLiveUsers] = useState<AuthUserSummary[]>([]);
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/auth", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data || !Array.isArray(data.users)) return;
        setLiveUsers(data.users);
      })
      .catch(() => {
        // Fallback smoothly to preset labels if network check fails on mount
      });
    return () => {
      active = false;
    };
  }, []);

  const userByUsername = useMemo(() => {
    const map = new Map<string, AuthUserSummary>();
    for (const u of liveUsers) {
      map.set(u.username, u);
    }
    return map;
  }, [liveUsers]);

  function selectRoleAtIndex(index: number, focusRadio = false) {
    const normalized =
      ((index % PRESET_USERS.length) + PRESET_USERS.length) %
      PRESET_USERS.length;
    const nextUsername = PRESET_USERS[normalized].username;
    if (nextUsername !== username) {
      setPin("");
    }
    setUsername(nextUsername);
    setError(null);
    if (focusRadio) {
      radioRefs.current[normalized]?.focus();
    }
  }

  function handleRadioKeyDown(
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      selectRoleAtIndex(index + 1, true);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      selectRoleAtIndex(index - 1, true);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
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

  const resolvePersonName = (preset: (typeof PRESET_USERS)[number]) => {
    const dbUser = userByUsername.get(preset.username);
    const rawDbName = (dbUser?.full_name || "").trim();
    const legacySeed = LEGACY_SEED_NAMES[preset.username];
    return rawDbName && rawDbName !== legacySeed ? rawDbName : preset.fallbackPerson;
  };

  const selectedPreset =
    PRESET_USERS.find((u) => u.username === username) ?? PRESET_USERS[0];
  const selectedPersonName = resolvePersonName(selectedPreset);
  const selectedInitial = selectedPersonName.charAt(0).toUpperCase() || "B";

  return (
    <div className="relative min-h-[100dvh] overflow-x-clip bg-[#FAF9F6]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-[340px] w-[620px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(30,68,107,0.07),transparent)]"
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center px-4 py-4 outline-none md:max-w-[780px] md:px-6 md:py-10"
      >
        {/* Mobile compact header */}
        <header className="mb-3.5 flex items-center justify-center gap-3 md:hidden">
          <HorizonLogo className="h-9 w-9 flex-shrink-0 rounded-2xl shadow-sm" />
          <div className="text-left">
            <h1 className="text-lg font-semibold tracking-tight text-[#18181B]">
              Blue Horizon Trade
            </h1>
            <p className="text-xs text-[#5C5A55]">
              Acceso operativo por puesto
            </p>
          </div>
        </header>

        {/* Single Unified Horizon Workspace Sheet */}
        <section className="overflow-hidden rounded-[26px] border border-[#E7E5E0] bg-white shadow-[0_18px_46px_-18px_rgba(15,41,66,0.12)] md:grid md:grid-cols-[248px_1fr]">
          {/* Desktop quiet editorial brand rail (zero extra floating box) */}
          <aside className="hidden md:flex md:flex-col md:justify-between md:border-r md:border-[#E7E5E0]/80 md:bg-[#F4F7FA] md:p-7">
            <div>
              <HorizonLogo className="h-11 w-11 rounded-2xl shadow-sm" />
              <h1 className="mt-5 text-[22px] font-semibold leading-snug tracking-tight text-[#0F2942]">
                Blue Horizon Trade
              </h1>
              <p className="mt-2 text-xs leading-relaxed text-[#5C5A55]">
                Selecciona tu puesto operativo e ingresa con tu PIN personal.
              </p>
            </div>

            <div className="border-t border-[#D4E0EC]/80 pt-5">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#0F2942] text-sm font-semibold text-white"
                >
                  {selectedInitial}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#18181B]">
                    {selectedPersonName}
                  </p>
                  <p className="truncate text-xs font-medium text-[#1E446B]">
                    {selectedPreset.label}
                  </p>
                </div>
              </div>
              <p className="mt-2.5 text-[11px] leading-relaxed text-[#5C5A55]">
                {selectedPreset.scope}
              </p>
            </div>
          </aside>

          {/* Main selection & unlock pane */}
          <div className="p-4 sm:p-6 md:p-7">
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <p
                  id="login-role-group-label"
                  className="mb-2 block text-xs font-medium text-[#5C5A55]"
                >
                  Puesto operativo
                </p>

                <div
                  className="space-y-1 rounded-2xl border border-[#E7E5E0]/75 bg-[#F6F5F1]/85 p-1.5"
                  role="radiogroup"
                  aria-labelledby="login-role-group-label"
                >
                  {PRESET_USERS.map((u, idx) => {
                    const active = username === u.username;
                    const personName = resolvePersonName(u);
                    const initial = personName.charAt(0).toUpperCase() || "B";
                    return (
                      <button
                        key={u.username}
                        ref={(el) => {
                          radioRefs.current[idx] = el;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        tabIndex={active ? 0 : -1}
                        onKeyDown={(e) => handleRadioKeyDown(e, idx)}
                        onClick={() => selectRoleAtIndex(idx)}
                        className={`flex min-h-[50px] w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 ${
                          active
                            ? "bg-white shadow-[0_2px_10px_rgba(15,41,66,0.08)] ring-1 ring-[#0F2942]/18"
                            : "bg-transparent hover:bg-white/65"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold transition ${
                            active
                              ? "bg-[#0F2942] text-white"
                              : "border border-[#E7E5E0] bg-white text-[#1E446B]"
                          }`}
                        >
                          {active ? <CheckIcon className="h-4 w-4" /> : initial}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold text-[#18181B]">
                              {u.label}
                            </span>
                            <Badge
                              tone={active ? "obsidian" : "horizon"}
                              className={`px-2.5 py-0.5 text-[11px] font-medium ${
                                active
                                  ? "!border-[#0F2942] !bg-[#0F2942] !text-white"
                                  : ""
                              }`}
                            >
                              {personName}
                            </Badge>
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-[#5C5A55]">
                            {u.scope}
                          </p>
                          {SHOW_INITIAL_PIN_HINTS &&
                            showHints &&
                            userByUsername.get(u.username)?.pin_hint && (
                              <p className="mt-0.5 text-[11px] font-medium text-[#1E446B] tabular-nums">
                                PIN inicial: {userByUsername.get(u.username)?.pin_hint}
                              </p>
                            )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <FieldLabel htmlFor="login-pin" required>
                  PIN de acceso para {selectedPersonName}
                </FieldLabel>
                <div className="mt-1.5 grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_auto]">
                  <div className="relative">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#6D6A64]"
                    >
                      <LockIcon className="h-4 w-4" />
                    </span>
                    <input
                      id="login-pin"
                      type={showPin ? "text" : "password"}
                      inputMode="numeric"
                      autoComplete="current-password"
                      maxLength={8}
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      aria-invalid={Boolean(error)}
                      placeholder="••••"
                      required
                      className={`${INPUT_CLASS} h-full rounded-xl pl-10 pr-11 text-center text-lg font-semibold tracking-[0.28em] tabular-nums`}
                    />
                    <button
                      type="button"
                      data-compact="true"
                      onClick={() => setShowPin((prev) => !prev)}
                      aria-label={showPin ? "Ocultar PIN" : "Mostrar PIN"}
                      aria-pressed={showPin}
                      className="absolute inset-y-1 right-1.5 flex min-w-[38px] items-center justify-center rounded-lg px-2 text-[#5C5A55] transition hover:bg-[#F2F6FA] hover:text-[#0F2942] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/40 cursor-pointer"
                    >
                      {showPin ? (
                        <EyeOffIcon className="h-4 w-4" />
                      ) : (
                        <EyeIcon className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    disabled={loading}
                    className="sm:min-w-[164px] whitespace-nowrap"
                  >
                    {loading ? "Ingresando..." : "Entrar al Sistema"}
                  </Button>
                </div>
              </div>

              {error && <ToastBanner type="err" message={error} />}
            </form>

            {SHOW_INITIAL_PIN_HINTS &&
              liveUsers.some((u) => Boolean(u.pin_hint)) && (
                <div className="mt-4 border-t border-[#E7E5E0]/80 pt-3 text-center">
                  <button
                    type="button"
                    onClick={() => setShowHints((prev) => !prev)}
                    aria-expanded={showHints}
                    className="inline-flex min-h-[36px] items-center justify-center rounded-full px-3.5 py-1.5 text-xs font-medium text-[#5C5A55] underline-offset-4 transition hover:bg-[#F2F6FA] hover:text-[#0F2942] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/40 cursor-pointer"
                  >
                    {showHints
                      ? "Ocultar PINes iniciales"
                      : "¿Primer ingreso? Ver PINes iniciales"}
                  </button>
                </div>
              )}
          </div>
        </section>
      </main>
    </div>
  );
}
