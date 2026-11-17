import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Blue Horizon Trade ERP",
    short_name: "BHT ERP",
    description:
      "Pedidos, almacén, cobranzas y control operativo de Blue Horizon Trade.",
    start_url: "/",
    display: "standalone",
    background_color: "#F8FAFC",
    theme_color: "#0B192C",
    lang: "es-PE",
    shortcuts: [
      {
        name: "Nuevo pedido",
        short_name: "Pedido",
        description: "Abrir Ventas para crear o continuar un pedido",
        url: "/vendedor",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      {
        name: "Estado offline",
        short_name: "Sincronización",
        description: "Revisar operaciones pendientes y conflictos",
        url: "/offline",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
    ],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
