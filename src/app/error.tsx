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
      className="flex min-h-[100dvh] items-center justify-center bg-bht-paper px-4 py-12"
    >
      <Card padding="lg" className="w-full max-w-md space-y-4 text-center">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-bht-danger-strong">
            Error operativo
          </p>
          <h1 className="text-lg font-bold tracking-tight text-bht-navy-deep">
            No se pudo cargar esta vista
          </h1>
          <p className="text-sm leading-relaxed text-bht-ink-soft">
            Ocurrió un problema inesperado al procesar la pantalla. Puedes reintentar o
            volver al inicio.
            {error.digest ? ` (Ref: ${error.digest})` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <Button type="button" variant="primary" size="md" onClick={reset}>
            Reintentar
          </Button>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-bht-line-strong bg-white px-4 py-2.5 text-sm font-semibold text-bht-ink-strong shadow-bht-elev-2 transition-colors hover:border-bht-cobalt/60 hover:bg-bht-cobalt-bg/40 hover:text-bht-cobalt-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt focus-visible:ring-offset-2"
          >
            Ir al inicio
          </Link>
        </div>
      </Card>
    </main>
  );
}
