"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import AuthCardShell from "@/components/auth/AuthCardShell";
import { EyeIcon, EyeOffIcon, LockIcon } from "@/components/ui/Icons";
import {
  Button,
  FieldLabel,
  INPUT_CLASS,
  ToastBanner,
} from "@/components/ui/Primitives";

function routeForRole(role: string): string {
  if (role === "WAREHOUSE_DELIVERY") return "/almacen";
  if (role === "EXTERNAL_SELLER") return "/vendedor";
  return "/socios";
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Usuario o contraseña incorrectos");
        return;
      }
      router.replace(
        data.user.mustChangePassword ? "/change-password" : routeForRole(data.user.role)
      );
    } catch {
      setError("Error de red al iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCardShell
      title="Blue Horizon Trade"
      subtitle="Ingresa con tu usuario y contraseña"
    >
      <form
        onSubmit={handleLogin}
        className="flex flex-1 flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-7 sm:block sm:p-8"
      >
        <div className="space-y-5">
          <div>
            <FieldLabel htmlFor="login-username" required>
              Usuario
            </FieldLabel>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              maxLength={80}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              aria-invalid={Boolean(error)}
              placeholder="Ej. juan.perez"
              required
              className={`${INPUT_CLASS} mt-1.5 w-full rounded-xl`}
            />
          </div>

          <div>
            <FieldLabel htmlFor="login-password" required>
              Contraseña
            </FieldLabel>
            <div className="relative mt-1.5">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#6D6A64]"
              >
                <LockIcon className="h-4 w-4" />
              </span>
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={Boolean(error)}
                placeholder="Tu contraseña"
                required
                className={`${INPUT_CLASS} w-full rounded-xl pl-10 pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                aria-pressed={showPassword}
                className="absolute inset-y-1 right-1.5 flex min-w-[38px] items-center justify-center rounded-lg px-2 text-[#5C5A55] transition hover:bg-[#F2F6FA] hover:text-[#0F2942] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/40"
              >
                {showPassword ? (
                  <EyeOffIcon className="h-4 w-4" />
                ) : (
                  <EyeIcon className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {error && <ToastBanner type="err" message={error} />}

          <p className="text-xs leading-relaxed text-[#6D6A64]">
            Tu sesión y permisos son personales. No compartas tu contraseña.
          </p>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={loading}
          className="mt-auto w-full sm:mt-6"
        >
          {loading ? "Ingresando..." : "Ingresar"}
        </Button>
      </form>
    </AuthCardShell>
  );
}
