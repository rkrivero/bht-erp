import Link from "next/link";
import OfflineQueuePanel from "@/components/pwa/OfflineQueuePanel";

export default function OfflinePage() {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-12"
    >
      <section className="w-full rounded-2xl border border-[var(--horizon-border)] bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--horizon-mist)] text-xl text-[var(--horizon-ink)]">
          BHT
        </div>
        <h1 className="mt-4 text-xl font-semibold text-[var(--horizon-ink)]">
          Sin conexión
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-secondary)]">
          Puedes continuar con los borradores disponibles. Los pedidos, cobros y gastos
          permitidos se enviarán cuando vuelva Internet.
        </p>
        <a
          href="/vendedor"
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[var(--horizon-ink)] px-5 text-sm font-semibold text-white"
        >
          Abrir Ventas en este dispositivo
        </a>
        <p className="mt-2 text-xs leading-relaxed text-[var(--ink-secondary)]">
          Disponible sin conexión si ya abriste Ventas aquí. El borrador se guarda por
          usuario en este dispositivo.
        </p>
        <OfflineQueuePanel />
        <Link
          href="/"
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--horizon-ink)] px-5 text-sm font-semibold text-white"
        >
          Volver a intentar
        </Link>
      </section>
    </main>
  );
}
