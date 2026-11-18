---
name: Blue Horizon Trade ERP
description: Precision Modern para decisiones y operación logística confiable
colors:
  horizon-navy: "#102A43"
  trade-cobalt: "#1463FF"
  steel: "#486581"
  sky: "#D9E8FF"
  cargo-amber: "#F6A623"
  ink: "#0B192C"
  paper: "#F7F5F0"
  surface: "#FFFFFF"
  success: "#15803D"
  danger: "#B91C1C"
typography:
  headline:
    fontFamily: "Plus Jakarta Sans, Avenir Next, Avenir, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Plus Jakarta Sans, Avenir Next, Avenir, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Plus Jakarta Sans, Avenir Next, Avenir, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Plus Jakarta Sans, Avenir Next, Avenir, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.35
  badge:
    fontFamily: "Plus Jakarta Sans, Avenir Next, Avenir, Helvetica Neue, Arial, sans-serif"
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

- **Horizon Navy** (`#102A43`): estructura, sidebar, títulos y alta autoridad.
- **Trade Cobalt** (`#1463FF`): acción primaria, selección, foco y progreso.
- **Steel** (`#486581`): texto secundario e información industrial.
- **Sky** (`#D9E8FF`): selección suave, contexto y guía.
- **Cargo Amber** (`#F6A623`): logística y vencimiento moderado; nunca error.
- **Ink** (`#0B192C`), **Paper** (`#F7F5F0`) y blanco crean texto, canvas y superficies.
- **Success** (`#15803D`) y **Danger** (`#B91C1C`) conservan significado semántico.

**Regla 60/30/8/2.** Aproximadamente 60% superficies, 30% estructura/texto, 8% acciones y 2% acentos.

## Typography

Plus Jakarta Sans variable es la única familia descargada y se sirve autoalojada mediante `next/font/google`.

- **Headline** (700–800, 20–24 px): decisión o tarea principal.
- **Title** (600–700, 14–18 px): secciones y entidades.
- **Body** (400, 14–16 px): texto operativo, idealmente 65–75 caracteres.
- **Data** (500, 12–16 px): montos, cantidades y códigos con números tabulares.
- **Label** (600, 12–13 px): controles y metadata. 10–11 px solo para badges.

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

Socios: Hoy, Ventas, Cobranza, Inventario, Finanzas y análisis. Vendedor: Vender, Ventas, Cobrar, Más. Almacén: Por alistar, Listos / En ruta, Entregados. Sidebar en escritorio y barra inferior en móvil.

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
