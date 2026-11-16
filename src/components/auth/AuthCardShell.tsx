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
    <div className="relative min-h-[100dvh] overflow-x-clip bg-[#FAF9F6]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 hidden h-[340px] w-[620px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(30,68,107,0.07),transparent)] sm:block"
      />
      <main
        id="main-content"
        tabIndex={-1}
        className="relative mx-auto flex min-h-[100dvh] w-full max-w-[29rem] flex-col outline-none sm:justify-center sm:px-6 sm:py-8"
      >
        <section className="flex min-h-[100dvh] flex-1 flex-col overflow-hidden bg-white sm:min-h-0 sm:flex-none sm:rounded-[28px] sm:border sm:border-[#E7E5E0] sm:shadow-[0_18px_46px_-18px_rgba(15,41,66,0.12)]">
          <header className="flex min-h-[31dvh] flex-col items-center justify-end bg-[linear-gradient(180deg,#F4F7FA_0%,#EDF3F9_100%)] px-6 pb-8 pt-[max(2rem,env(safe-area-inset-top))] text-center sm:min-h-0 sm:justify-center sm:px-8 sm:py-8">
            <HorizonLogo className="h-12 w-12 rounded-2xl shadow-sm" />
            <h1 className="mt-4 text-xl font-semibold tracking-tight text-[#0F2942]">
              {title}
            </h1>
            <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-[#5C5A55]">
              {subtitle}
            </p>
          </header>
          {children}
        </section>
      </main>
    </div>
  );
}
