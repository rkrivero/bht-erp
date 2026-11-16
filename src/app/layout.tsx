import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blue Horizon Trade — Gestión y Ventas (S/)",
  description:
    "Sistema interno adaptado a móvil y computadora para distribución mayorista y ventas en Soles (S/)",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FAF9F6",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-[#FAF9F6] text-[#18181B] antialiased selection:bg-[#0F2942] selection:text-white">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-xl focus:bg-[#0F2942] focus:px-4 focus:py-2.5 focus:text-xs focus:font-semibold focus:text-white focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#5B89B5] focus:ring-offset-2"
        >
          Saltar al contenido principal
        </a>
        {children}
      </body>
    </html>
  );
}
