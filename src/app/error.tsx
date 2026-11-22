"use client";

import Link from "next/link";
import { Button, Card } from "@/components/ui/Primitives";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-bht-paper px-4 py-12"
    >
      <Card padding="lg" className="w-full max-w-md space-y-4 text-center">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-bht-danger-strong">
            Error operativo
          </p>
          <h1 className="text-lg font-bold text-bht-navy-deep">
            No se pudo cargar esta vista
          </h1>
          <p className="text-xs leading-relaxed text-bht-ink-soft">
            {error.message ||
              "Ocurrió un problema inesperado al procesar la pantalla. Puedes reintentar o volver al inicio."}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <Button type="button" variant="primary" size="md" onClick={reset}>
            Reintentar
          </Button>
          <Link
            href="/"
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-bht-line bg-white px-4 py-2 text-xs font-semibold text-bht-ink-strong hover:bg-bht-paper"
          >
            Ir al inicio
          </Link>
        </div>
      </Card>
    </main>
  );
}
