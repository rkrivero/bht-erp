---
name: Blue Horizon Trade ERP
description: Precision Modern para decisiones y operación logística confiable
colors:
  horizon-navy: "#1C2127"
  marine: "#0B385F"
  trade-cobalt: "#3373B0"
  mist: "#BED4E9"
  glacial: "#E7F1FB"
  steel: "#5A6578"
  ink: "#1C2127"
  paper: "#F8FAFC"
  surface: "#FFFFFF"
  success: "#059669"
  warning: "#B45309"
  danger: "#DC2626"
typography:
  headline:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "-0.011em"
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.35
  badge:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1.2
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.trade-cobalt}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "40px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: Blue Horizon Trade ERP

## Overview

**Creative North Star: “Precision Modern”**

Una interfaz operativa sobria en la que prioridad, estado y tiempo crean la jerarquía. El sistema reduce el trayecto entre detectar una excepción y ejecutar la acción autorizada. Paper aporta respiración, Sky guía y Cargo Amber señala logística con moderación.

La composición sigue “primero decidir, después ejecutar y finalmente analizar”. Evita gradientes ornamentales, vidrio y conjuntos de tarjetas equivalentes que compitan por atención.

**Características clave:** cola dominante, densidad progresiva, móvil operativo, escritorio supervisor y estados semánticos estables.

## Colors

- **Graphite Slate** (`#1C2127`): estructura primaria, sidebar, títulos y alta autoridad ("definitly, darker is nice").
- **Marine Navy** (`#0B385F`): estructura profunda secundaria y estados hover oscuros.
- **Cobalt Accent** (`#3373B0`): exactamente UN color de acento para acciones primarias, selecciones activas y foco.
- **Mist Blue** (`#BED4E9`): bordes sutiles, hairlines y micro-divisores.
- **Glacial Tint** (`#E7F1FB`): selección suave, chips activos y fondos de píldoras.
- **Paper & Canvas** (`#F8FAFC` y `#FFFFFF`): lienzos y tarjetas con alta respiración visual.

## Taste Rules (learn-taste / frontend-design)

- **Enforce Whitespace with Tailwind:**
  Utilizar padding y gap amplios (`p-6 sm:p-8`, `p-8 sm:p-12`, `gap-6 sm:gap-8`) para separar contenido de forma natural, en lugar de recurrir a bordes pesados o fondos cargados.
  <!-- 2026-11-20: "Enforce Whitespace with Tailwind: Use large padding and gap utilities to separate content naturally" -->
- **Refine Typography:**
  Aplicar `tracking-tight` (`letter-spacing: -0.025em`) para títulos grandes y `leading-relaxed` (`line-height: 1.625`) para texto de cuerpo descriptivo, creando una composición editorial y legible.
  <!-- 2026-11-20: "Refine Typography: Apply tracking-tight for large headings and leading-relaxed for body text" -->
- **Create Calm Transitions:**
  Utilizar `transition-all duration-300 ease-in-out` para efectos de hover suaves, deliberados y no estridentes.
  <!-- 2026-11-20: "Create Calm Transitions: Use transition-all duration-300 ease-in-out for subtle, non-jarring hover effects" -->
- **Build Bento Grids:**
  Aprovechar CSS Grid modular y asimétrico (`grid grid-cols-1 md:grid-cols-3`, `col-span-2`) para organizar tableros de control con alta densidad pero abundante espacio para respirar.
  <!-- 2026-11-20: "Build Bento Grids: Utilize Tailwind's CSS Grid classes to easily construct modular, asymmetrical layouts" -->
- **Strictly Limit Your Palette:**
  Limitar la paleta a una escala monocromática neutra (`#1C2127`, `#5A6578`, `#F8FAFC`, `#FFFFFF`) y definir **exactamente un color de acento** (`#3373B0`) para acciones primarias y estados activos.
  <!-- 2026-11-20: "Strictly Limit Your Palette: define exactly one accent color for primary actions" -->

## Typography

`Inter` (interfaz general y títulos) y `JetBrains Mono` (códigos, montos tabulares y atajos) se sirven autoalojadas mediante `next/font/google` (`--font-inter` y `--font-jetbrains-mono`).

- **Headline** (700–800, 20–24 px): decisión o tarea principal (`Inter`).
- **Title** (600–700, 14–18 px): secciones y entidades (`Inter`).
- **Body** (400, 14–16 px): texto operativo, idealmente 65–75 caracteres (`Inter`).
- **Data** (500, 12–16 px): montos, cantidades y códigos con números tabulares (`JetBrains Mono` / `tabular-nums`).
- **Label** (600, 12–13 px): controles y metadata. 10–11 px solo para badges (`Inter`).

Los títulos describen situaciones o acciones; la UI no expone nombres técnicos como “BI” o “Neon PostgreSQL”.

## Layout

Ritmo base de 4 px con separaciones de 8, 12, 16, 24 y 32 px. En móvil hay una tarea dominante, máximo cuatro destinos visibles y objetivos táctiles de 44 px. Las etapas completadas pueden colapsarse en resúmenes editables.

En escritorio, la sidebar persistente mide 232 px; el encabezado reúne búsqueda, sincronización y acciones. Validar 360, 390, 412, 768, 1280 y 1440 px.

## Elevation & Depth

Plano por defecto: bordes tonales separan superficies. Las sombras ambientales se reservan para encabezados fijos, menús y zonas activas.

- **Ambient low:** `0 1px 2px rgba(24,24,27,0.03)`.
- **Active surface:** `0 2px 10px rgba(15,41,66,0.05)`.
- **Floating:** `0 12px 28px rgba(15,41,66,0.12)`.

## Shapes

Superficies principales con radios de 12–16 px; inputs y botones, 8–12 px. Las píldoras se limitan a badges, filtros breves y estados. Las tarjetas agrupan una decisión o entidad; no se anidan como decoración.

## Components

### Buttons

Primario Cobalt con texto blanco y radio de 12 px; una acción dominante por región. Outline para acciones secundarias. Foco visible de 2 px y 44 px en móvil.

### Cards and queues

Fondo blanco, radio de 16 px, borde tonal y padding de 16 px. La cola usa filas con categoría, vencimiento, entidad y acción. Empty states explican ausencia y siguiente acción.

### Inputs and fields

Fondo blanco, borde fuerte, radio de 12 px y texto mínimo de 14 px. El error se asocia al campo, conserva el trabajo e indica recuperación.

### Navigation

Socios: Hoy, Ventas, Cobranza, Inventario, Finanzas y análisis. Vendedor: Vender, Ventas, Cobrar, Más. Almacén: Por alistar, Listos / En ruta, Entregados. Sidebar en escritorio (`232 px`) y barra inferior en móvil con menú "Más" sobre `popover="auto"` nativo.

### Primitivas Enterprise Nativas (0 Librerías UI Externas)

- **`ControlPanel`**: Cabecera de vista con *breadcrumbs*, CTA primario, barra contextual de acciones en lote, `SearchBar` con *facets* removibles, filtros en `popover="auto"` con CSS Anchor Positioning (`@supports (position-area: block-end)` y respaldo *bottom-sheet*), paginador y selector de vista sincronizados con `URLSearchParams`.
- **`ResponsiveDataTable`**: Un único árbol DOM (`<table>`) dentro de `container-type: inline-size`. Ordenamiento con `aria-sort`, selector nativo de columnas opcionales (`popover="auto"`), transformación CSS a tarjetas en `@container (width < 640px)` vía `data-label` y diferimiento `.bht-defer-row` (`content-visibility: auto`) a partir de la fila índice 15.
- **`ModalSheet` (`<dialog>`)**: Basado en `<dialog>` nativo con `showModal()`, `closedby="any"` y respaldo de clic en *backdrop* por coordenadas de puntero, animaciones top-layer con `@starting-style` y variante de confirmación.
- **`CommandPalette` (`Cmd/Ctrl+K`)**: Modal `<dialog>` ligero en cliente que indexa espacios RBAC, acciones rápidas y registros cargados en memoria.
- **`FormSheet`**: Vista de documento estilo Odoo (`max-w-[1140px]`) con cabecera de acciones, *Statusbar* de etapas (pipeline), hoja blanca, fila de *Smart Buttons* sin consultas N+1 y *Notebook Tabs* accesibles (`role="tablist"`).
- **`Skeleton` y `ToastBanner` (`CLS = 0`)**: Esqueletos con `aria-busy="true"` (`SkeletonLine`, `SkeletonTable`, `SkeletonCards`, `SkeletonKpiStrip`) y notificaciones flotantes fijas (`fixed top-4 right-4 z-50`).
- **Densidad configurable**: Conmutador `Cómodo` / `Compacto` persistido en `localStorage` aplicando `data-density="compact"` en `document.documentElement`.

### Motion

Transiciones breves de color, borde y opacidad confirman estados. `prefers-reduced-motion` elimina desplazamientos y escalados, pero conserva foco y feedback instantáneo.

## Do's and Don'ts

### Do

- **Do** mostrar la siguiente acción antes que el análisis.
- **Do** usar color, icono y texto juntos para comunicar estado.
- **Do** usar números tabulares en montos, cantidades y códigos.
- **Do** revelar detalle y campos condicionales cuando son relevantes.

### Don't

- **Don't** inventar KPIs, urgencias, clientes o cifras.
- **Don't** usar Cargo Amber como peligro ni Cobalt como estado semántico.
- **Don't** construir páginas con tarjetas equivalentes sin prioridad.
- **Don't** usar gradientes decorativos, glassmorphism, emoji como iconos o metadata operativa de 10 px.
