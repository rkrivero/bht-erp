"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import AuthCardShell from "@/components/auth/AuthCardShell";
import { authClient } from "@/lib/auth/client";

export const dynamic = "force-dynamic";
import { Button, FieldLabel, INPUT_CLASS, ToastBanner } from "@/components/ui/Primitives";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"email" | "reset">("email");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({ email: email.trim().toLowerCase(), type: "forget-password" });
      if (result.error) throw new Error(result.error.message);
      setStep("reset");
      setMessage("Si el correo tiene una cuenta, recibirás un código para restablecer la contraseña.");
    } catch {
      setError("No se pudo solicitar el código. Revisa el correo e inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 10 || !/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(password) || !/\d/.test(password)) {
      setError("Usa al menos 10 caracteres e incluye una letra y un número.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await authClient.emailOtp.resetPassword({ email: email.trim().toLowerCase(), otp: otp.trim(), password });
      if (result.error) throw new Error(result.error.message);
      setMessage("Contraseña actualizada. Ya puedes ingresar con tu nueva contraseña.");
      setStep("email");
    } catch {
      setError("No se pudo restablecer la contraseña. Revisa el código y vuelve a intentarlo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCardShell title="Restablecer contraseña" subtitle="Recibe un código de un solo uso por correo">
      <form onSubmit={step === "email" ? sendCode : resetPassword} className="flex flex-1 flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-7 sm:block sm:p-8">
        <div className="space-y-4">
          <div>
            <FieldLabel htmlFor="reset-email" required>Correo electrónico</FieldLabel>
            <input id="reset-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={step === "reset"} className={`${INPUT_CLASS} mt-1.5 w-full rounded-xl`} />
          </div>
          {step === "reset" && <>
            <div>
              <FieldLabel htmlFor="reset-otp" required>Código de verificación</FieldLabel>
              <input id="reset-otp" inputMode="numeric" autoComplete="one-time-code" required value={otp} onChange={(e) => setOtp(e.target.value)} className={`${INPUT_CLASS} mt-1.5 w-full rounded-xl`} />
            </div>
            <div>
              <FieldLabel htmlFor="reset-password" required>Nueva contraseña</FieldLabel>
              <input id="reset-password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} className={`${INPUT_CLASS} mt-1.5 w-full rounded-xl`} />
            </div>
          </>}
          {message && <p role="status" className="text-xs text-[#5C5A55]">{message}</p>}
          {error && <ToastBanner type="err" message={error} />}
        </div>
        <Button type="submit" variant="primary" size="lg" disabled={loading} className="mt-6 w-full">{loading ? "Procesando…" : step === "email" ? "Enviar código" : "Actualizar contraseña"}</Button>
        <p className="mt-4 text-center text-xs"><Link href="/login" className="font-medium text-[#1E446B] underline-offset-4 hover:underline">Volver a ingresar</Link></p>
      </form>
    </AuthCardShell>
  );
}
