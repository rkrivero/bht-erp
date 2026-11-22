import Link from "next/link";
import { Card } from "@/components/ui/Primitives";

export default function NotFound() {
  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-bht-paper px-4 py-12"
    >
      <Card padding="lg" className="w-full max-w-md space-y-4 text-center">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-bht-cobalt">
            404 · Ruta no encontrada
          </p>
          <h1 className="text-lg font-bold text-bht-navy-deep">
            Esta página no existe en el ERP
          </h1>
          <p className="text-xs leading-relaxed text-bht-ink-soft">
            Verifica la dirección o regresa a tu módulo operativo.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <Link
            href="/"
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-bht-navy-deep px-4 py-2 text-xs font-semibold text-white"
          >
            Volver al inicio
          </Link>
        </div>
      </Card>
    </main>
  );
}
