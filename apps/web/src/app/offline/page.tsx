import Link from "next/link";
import OfflineQueuePanel from "@/components/pwa/OfflineQueuePanel";
import { HorizonLogo } from "@/components/ui/Icons";
import { Card } from "@/components/ui/Primitives";

export default function OfflinePage() {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-[100dvh] max-w-lg items-center px-5 py-12"
    >
      <Card padding="lg" className="w-full text-center">
        <span className="mx-auto flex h-14 w-28 items-center justify-center rounded-2xl border border-bht-line-strong/70 bg-bht-paper p-2 shadow-xs">
          <HorizonLogo className="h-full w-full" />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-bht-ink-strong">
          Sin conexión
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-bht-ink-soft">
          Puedes continuar con los borradores disponibles. Los pedidos, cobros y gastos
          permitidos se enviarán cuando vuelva Internet.
        </p>
        <a
          href="/vendedor"
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-bht-cobalt px-5 py-2.5 text-sm font-semibold text-white shadow-bht-elev-5 transition-colors hover:bg-bht-cobalt-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt focus-visible:ring-offset-2"
        >
          Abrir Ventas en este dispositivo
        </a>
        <p className="mt-2 text-xs leading-relaxed text-bht-ink-soft">
          Disponible sin conexión si ya abriste Ventas aquí. El borrador se guarda por
          usuario en este dispositivo.
        </p>
        <OfflineQueuePanel />
        <Link
          href="/"
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-bht-line-strong bg-white px-5 py-2.5 text-sm font-semibold text-bht-ink-strong shadow-bht-elev-2 transition-colors hover:border-bht-cobalt/60 hover:bg-bht-cobalt-bg/40 hover:text-bht-cobalt-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-cobalt focus-visible:ring-offset-2"
        >
          Volver a intentar
        </Link>
      </Card>
    </main>
  );
}
