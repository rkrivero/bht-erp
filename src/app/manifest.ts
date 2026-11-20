import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Blue Horizon Trade ERP",
    short_name: "BHT ERP",
    description:
      "Pedidos, almacén, cobranzas y control operativo de Blue Horizon Trade.",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F5F0",
    theme_color: "#102A43",
    lang: "es-PE",
    shortcuts: [
      {
        name: "Nuevo pedido",
        short_name: "Pedido",
        description: "Abrir Ventas para crear o continuar un pedido",
        url: "/vendedor",
        icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
      },
      {
        name: "Estado offline",
        short_name: "Sincronización",
        description: "Revisar operaciones pendientes y conflictos",
        url: "/offline",
        icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
      },
    ],
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
        purpose: "any",
      },
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
        purpose: "maskable",
      },
    ],
  };
}
