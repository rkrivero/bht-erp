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
        className="pointer-events-none absolute -top-24 left-1/2 hidden h-[340px] w-[620px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(51,115,176,0.08),transparent)] sm:block"
      />
      <main
        id="main-content"
        tabIndex={-1}
        className="relative mx-auto flex min-h-[100dvh] w-full max-w-[28rem] flex-col outline-none sm:justify-center sm:px-6 sm:py-10"
      >
        <section className="flex min-h-[100dvh] flex-1 flex-col overflow-hidden bg-white sm:min-h-0 sm:flex-none sm:rounded-2xl sm:border sm:border-[var(--border-hairline)] sm:shadow-[0_12px_40px_rgba(28,33,39,0.06)]">
          <header className="flex flex-col items-center justify-center border-b border-[var(--border-hairline)] bg-white px-6 pb-6 pt-[max(2.5rem,env(safe-area-inset-top))] text-center sm:px-8 sm:pt-8 sm:pb-7">
            <span className="flex h-14 w-28 items-center justify-center rounded-2xl bg-[#f8fafc] p-2 shadow-xs border border-black/[0.06]">
              <HorizonLogo className="h-full w-full" />
            </span>
            <h1 className="mt-4 text-xl font-bold tracking-tight text-[#1c2127]">
              {title}
            </h1>
            <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-[#5a6578]">
              {subtitle}
            </p>
          </header>
          {children}
        </section>
      </main>
    </div>
  );
}
