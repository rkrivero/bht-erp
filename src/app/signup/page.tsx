"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthCardShell from "@/components/auth/AuthCardShell";
import { authClient } from "@/lib/auth/client";

export const dynamic = "force-dynamic";
import { Button, FieldLabel, INPUT_CLASS, ToastBanner } from "@/components/ui/Primitives";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    if (password.length < 10 || !/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(password) || !/\d/.test(password)) {
      setError("Usa al menos 10 caracteres e incluye una letra y un número.");
      return;
    }
    setLoading(true);
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    try {
      const result = await authClient.signUp.email({
        name: name.trim(),
        email: normalizedEmail,
        password,
      });
      if (result.error) {
        setError("No se pudo crear la cuenta. Revisa los datos o solicita ayuda a un socio.");
        return;
      }
      router.replace(`/verify-email?email=${encodeURIComponent(normalizedEmail)}`);
    } catch {
      setError("No se pudo crear la cuenta. Intenta nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCardShell title="Crear cuenta" subtitle="Confirma tu correo para activar el acceso">
      <form onSubmit={handleSubmit} className="flex flex-1 flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-7 sm:block sm:p-8">
        <div className="space-y-4">
          <div>
            <FieldLabel htmlFor="signup-name" required>Nombre</FieldLabel>
            <input id="signup-name" autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={`${INPUT_CLASS} mt-1.5 w-full rounded-xl`} />
          </div>
          <div>
            <FieldLabel htmlFor="signup-email" required>Correo electrónico</FieldLabel>
            <input id="signup-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className={`${INPUT_CLASS} mt-1.5 w-full rounded-xl`} />
          </div>
          <div>
            <FieldLabel htmlFor="signup-password" required>Contraseña</FieldLabel>
            <input id="signup-password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} className={`${INPUT_CLASS} mt-1.5 w-full rounded-xl`} />
            <p className="mt-1.5 text-xs text-[#6D6A64]">10 caracteres como mínimo, con una letra y un número.</p>
          </div>
          {error && <ToastBanner type="err" message={error} />}
          <p className="text-xs leading-relaxed text-[#6D6A64]">Crear una cuenta no asigna permisos. Un socio administrador debe habilitar tu correo en el ERP.</p>
        </div>
        <Button type="submit" variant="primary" size="lg" disabled={loading} className="mt-6 w-full">{loading ? "Creando cuenta…" : "Crear cuenta"}</Button>
        <p className="mt-4 text-center text-xs text-[#5C5A55]">¿Ya tienes cuenta? <Link href="/login" className="font-medium text-[#1E446B] underline-offset-4 hover:underline">Ingresar</Link></p>
      </form>
    </AuthCardShell>
  );
}
