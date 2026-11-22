import type { ReactNode } from "react";
import { HorizonLogo } from "@/components/ui/Icons";

export default function AuthCardShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-[100dvh] overflow-x-clip bg-[var(--bht-paper)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 hidden h-[340px] w-[620px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--glow-cobalt),transparent)] sm:block"
      />
      <main
        id="main-content"
        tabIndex={-1}
        className="relative mx-auto flex min-h-[100dvh] w-full max-w-[28rem] flex-col outline-none sm:justify-center sm:px-6 sm:py-10"
      >
        <section className="flex min-h-[100dvh] flex-1 flex-col overflow-hidden bg-white sm:min-h-0 sm:flex-none sm:rounded-2xl sm:border sm:border-[var(--border-hairline)] sm:shadow-bht-elev-17">
          <div className="h-[3px] bg-bht-cobalt" aria-hidden="true" />
          <header className="flex flex-col items-center border-b border-[var(--border-hairline)] bg-white px-6 pb-6 pt-[max(2.25rem,env(safe-area-inset-top))] text-center sm:px-8 sm:py-7">
            <span className="flex h-14 w-28 items-center justify-center rounded-2xl border border-bht-line-strong/70 bg-bht-paper p-2 shadow-xs">
              <HorizonLogo className="h-full w-full" />
            </span>
            <h1 className="mt-4 text-xl font-bold tracking-tight text-bht-ink-strong">
              {title}
            </h1>
            <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-bht-ink-soft">
              {subtitle}
            </p>
          </header>
          {children}
        </section>
      </main>
    </div>
  );
}
