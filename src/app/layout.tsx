import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BHT ERP Ligero — Operaciones y Finanzas (PEN)",
  description:
    "Sistema interno mobile-first de distribución mayorista y venta en ruta en Soles (PEN)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
