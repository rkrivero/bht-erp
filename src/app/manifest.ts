import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Blue Horizon Trade ERP",
    short_name: "BHT ERP",
    description:
      "Pedidos, almacén, cobranzas y control operativo de Blue Horizon Trade.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#1c2127",
    lang: "es-PE",
    shortcuts: [
      {
        name: "Nuevo pedido",
        short_name: "Pedido",
        description: "Abrir Ventas para crear o continuar un pedido",
        url: "/vendedor",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        ],
      },
      {
        name: "Almacén y reparto",
        short_name: "Almacén",
        description: "Abrir cola de alistamiento, despacho y confirmación de entregas",
        url: "/almacen",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        ],
      },
      {
        name: "Estado offline",
        short_name: "Sincronización",
        description: "Revisar operaciones pendientes y conflictos",
        url: "/offline",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        ],
      },
    ],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
        purpose: "any",
      },
    ],
  };
}
