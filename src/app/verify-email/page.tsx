"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthCardShell from "@/components/auth/AuthCardShell";
import { authClient } from "@/lib/auth/client";
import {
  Button,
  FieldLabel,
  INPUT_CLASS,
  ToastBanner,
} from "@/components/ui/Primitives";

export const dynamic = "force-dynamic";

function routeForRole(role: string): string {
  if (role === "WAREHOUSE_DELIVERY") return "/almacen";
  if (role === "EXTERNAL_SELLER") return "/vendedor";
  return "/socios";
}

export default function VerifyEmailPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("Ingresa el código enviado a tu correo.");
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("email");
    if (value) setEmail(value);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await authClient.emailOtp.verifyEmail({
        email: email.trim().toLowerCase(),
        otp: otp.trim(),
      });
      if (result.error) {
        setError(
          "El código no es válido o ya venció. Solicita uno nuevo e inténtalo otra vez."
        );
        return;
      }
      const response = await fetch("/api/erp/session", { cache: "no-store" });
      const data = await response.json();
      if (response.ok && data.session) {
        router.replace(routeForRole(data.session.role));
        return;
      }
      if (response.status === 403) {
        await authClient.signOut();
        setVerified(true);
        setMessage(
          "Correo verificado. Inicia sesión o restablece tu contraseña para continuar."
        );
        return;
      }
      setError("No pudimos confirmar la sesión. Intenta ingresar nuevamente.");
    } catch {
      setError(
        "No se pudo verificar el correo. Revisa la conexión e inténtalo nuevamente."
      );
    } finally {
      setLoading(false);
    }
  }

  async function resendCode() {
    setLoading(true);
    setError(null);
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: email.trim().toLowerCase(),
        type: "email-verification",
      });
      if (result.error) throw new Error(result.error.message);
      setMessage("Enviamos otro código de verificación.");
    } catch {
      setError("No pudimos enviar el código. Revisa el correo e inténtalo nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCardShell
      title="Verifica tu correo"
      subtitle="Usamos un código de un solo uso"
    >
      <form
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-7 sm:block sm:p-8"
      >
        <div className="space-y-4">
          <div>
            <FieldLabel htmlFor="verify-email" required>
              Correo electrónico
            </FieldLabel>
            <input
              id="verify-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${INPUT_CLASS} mt-1.5 w-full rounded-xl`}
            />
          </div>
          <div>
            <FieldLabel htmlFor="verify-otp" required>
              Código de verificación
            </FieldLabel>
            <input
              id="verify-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={12}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              className={`${INPUT_CLASS} mt-1.5 w-full rounded-xl`}
            />
          </div>
          <p role="status" className="text-xs text-bht-ink-muted">
            {message}
          </p>
          {error && <ToastBanner type="err" message={error} />}
          {verified && (
            <p className="flex justify-between gap-3 text-xs font-medium">
              <Link
                href="/login"
                className="text-bht-navy-mid underline-offset-4 hover:underline"
              >
                Ingresar
              </Link>
              <Link
                href="/forgot-password"
                className="text-bht-navy-mid underline-offset-4 hover:underline"
              >
                Crear o restablecer contraseña
              </Link>
            </p>
          )}
        </div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={loading}
          className="mt-6 w-full"
        >
          {loading ? "Verificando…" : "Verificar correo"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="md"
          disabled={loading || !email}
          onClick={() => void resendCode()}
          className="mt-2 w-full"
        >
          Reenviar código
        </Button>
        <p className="mt-4 text-center text-xs">
          <Link
            href="/login"
            className="font-medium text-bht-navy-mid underline-offset-4 hover:underline"
          >
            Volver a ingresar
          </Link>
        </p>
      </form>
    </AuthCardShell>
  );
}
