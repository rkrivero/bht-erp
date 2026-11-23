"use client";

import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body className="flex min-h-screen items-center justify-center bg-bht-paper px-4 py-12 text-bht-ink-strong antialiased">
        <main className="w-full max-w-md rounded-xl border border-bht-line bg-white p-6 text-center shadow-sm space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-bht-danger-strong">
            Blue Horizon Trade ERP
          </p>
          <h1 className="text-lg font-bold text-bht-navy-deep">
            Interrupción crítica de aplicación
          </h1>
          <p className="text-xs leading-relaxed text-bht-ink-soft">
            Se produjo un fallo al inicializar el sistema. Recarga la ventana para continuar.
            {error.digest ? ` (Ref: ${error.digest})` : ""}
          </p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-bht-navy-deep px-4 py-2 text-xs font-semibold text-white cursor-pointer"
          >
            Reintentar carga
          </button>
        </main>
      </body>
    </html>
  );
}
