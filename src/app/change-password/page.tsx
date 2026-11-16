"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthCardShell from "@/components/auth/AuthCardShell";
import { LockIcon } from "@/components/ui/Icons";
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

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!data.session) {
          router.replace("/login");
          return;
        }
        if (!data.session.mustChangePassword) {
          router.replace(routeForRole(data.session.role));
          return;
        }
        setChecking(false);
      })
      .catch(() => {
        setError("No se pudo validar la sesión. Revisa tu conexión.");
        setChecking(false);
      });
  }, [router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("La confirmación de contraseña no coincide.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "change_password",
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "No se pudo cambiar la contraseña.");
        return;
      }
      router.replace(routeForRole(data.user.role));
    } catch {
      setError("Error de red al cambiar la contraseña.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCardShell
      title="Crea tu contraseña personal"
      subtitle="La credencial actual es temporal. Debes reemplazarla antes de usar el ERP."
    >
      {checking ? (
        <p
          role="status"
          className="flex flex-1 items-center justify-center p-8 text-center text-sm text-[#5C5A55]"
        >
          Validando sesión…
        </p>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="flex flex-1 flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-7 sm:block sm:p-8"
        >
          <div className="space-y-4">
            <PasswordField
              id="current-password"
              label="Contraseña temporal"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
            />
            <PasswordField
              id="new-password"
              label="Nueva contraseña"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
            />
            <p className="text-xs leading-relaxed text-[#5C5A55]">
              Usa 10 caracteres o más e incluye al menos una letra y un número.
            </p>
            <PasswordField
              id="confirm-password"
              label="Confirma la nueva contraseña"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
            />
            {error && <ToastBanner type="err" message={error} />}
          </div>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={loading}
            className="mt-auto w-full sm:mt-6"
          >
            {loading ? "Guardando…" : "Guardar y continuar"}
          </Button>
        </form>
      )}
    </AuthCardShell>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id} required>
        {label}
      </FieldLabel>
      <div className="relative mt-1.5">
        <LockIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6D6A64]" />
        <input
          id={id}
          type="password"
          autoComplete={autoComplete}
          minLength={10}
          maxLength={128}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          className={`${INPUT_CLASS} w-full rounded-xl pl-10`}
        />
      </div>
    </div>
  );
}
