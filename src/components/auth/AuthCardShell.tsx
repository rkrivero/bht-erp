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
    <div className="relative min-h-[100dvh] overflow-x-clip bg-[#F8FAFC]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 hidden h-[340px] w-[620px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(7,94,232,0.07),transparent)] sm:block"
      />
      <main
        id="main-content"
        tabIndex={-1}
        className="relative mx-auto flex min-h-[100dvh] w-full max-w-[29rem] flex-col outline-none sm:justify-center sm:px-6 sm:py-8"
      >
        <section className="flex min-h-[100dvh] flex-1 flex-col overflow-hidden bg-white sm:min-h-0 sm:flex-none sm:rounded-2xl sm:border sm:border-[#E2E8F0] sm:shadow-[0_18px_46px_-18px_rgba(11,25,44,0.14)]">
          <header className="flex min-h-[31dvh] flex-col items-center justify-end border-b border-[#D9E7FA] bg-[#EAF2FE] px-6 pb-8 pt-[max(2rem,env(safe-area-inset-top))] text-center sm:min-h-0 sm:justify-center sm:px-8 sm:py-8">
            <span className="flex h-20 w-20 items-center justify-center">
              <HorizonLogo className="h-full w-full" />
            </span>
            <h1 className="mt-4 text-xl font-semibold tracking-tight text-[#0B192C]">
              {title}
            </h1>
            <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-[#475569]">
              {subtitle}
            </p>
          </header>
          {children}
        </section>
      </main>
    </div>
  );
}
