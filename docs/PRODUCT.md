# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Socios y administradores:** supervisan caja, excepciones, pedidos, cobranza, inventario, compras, márgenes, reportes y accesos. Trabajan principalmente en escritorio, aunque necesitan responder desde móvil.
- **Vendedores externos:** registran cotizaciones, pedidos, cobros y gastos en campo, con conectividad intermitente y uso móvil prioritario.
- **Almacén y reparto:** alistan pedidos, registran faltantes, preparan rutas, confirman entregas y consultan trazabilidad desde dispositivos móviles.

## Product Purpose

El ERP de Blue Horizon Trade coordina la operación comercial desde la venta hasta la cobranza y la entrega. Su objetivo central es reducir el tiempo entre detectar un problema y ejecutar la acción correcta, sin perder trazabilidad ni control financiero.

El éxito significa que cada rol reconoce su siguiente acción, la completa con pocos pasos y puede verificar qué quedó registrado y qué sigue.

## Positioning

La aplicación conecta pedido, aprobación, alistamiento, ruta, entrega y cobranza en una sola cadena operativa con permisos, auditoría, tolerancia a conectividad intermitente e idempotencia. La interfaz debe reflejar esa cadena, no comportarse como un dashboard genérico.

## Operating Context

- Idioma español de Perú, moneda PEN y zona horaria `America/Lima`.
- PWA web con uso móvil operativo prioritario y escritorio para supervisión, análisis y administración.
- La operación de campo puede quedar offline; los borradores y operaciones pendientes deben preservar actor y orden causal.
- Los socios necesitan decidir primero sobre excepciones, caja, bloqueos y vencimientos; el análisis detallado es posterior.
- Almacén trabaja por etapas: por alistar, listos/en ruta y entregados.

## Capabilities and Constraints

- Conservar reglas comerciales, contables, stock, auditoría, reversión y retención de pedidos.
- Conservar RBAC, `Idempotency-Key`, validación de actor, SSE y watermarks existentes durante el rediseño.
- No eliminar endpoints, cambiar payloads públicos, crear migraciones ni modificar la arquitectura server-side en esta intervención.
- Los enlaces antiguos deben seguir funcionando y canonicalizarse sin perder filtros.
- No incorporar otra librería global de estado sin evidencia medible de necesidad.
- Al cerrar sesión se pueden limpiar snapshots de lectura y borradores del usuario; nunca se eliminan operaciones pendientes sin advertencia y confirmación.
- No inventar KPIs, urgencias, cifras, clientes ni resultados comerciales. Toda alerta debe derivar de datos existentes.

## Brand Commitments

- Nombre: Blue Horizon Trade.
- Dirección visual aprobada: **Precision Modern**; precisión y velocidad operativa por encima de decoración.
- Paleta vinculante: Horizon Navy `#0F1E30`, Marine `#16324F`, Trade Cobalt `#1D5FA8`, Mist `#94AEC9`, Glacial `#EDF4FC`, Steel `#475569`, Ink `#0F1E30` y Paper `#F6F8FB`.
- Tipografía de producto: `Inter` (interfaz y títulos) y `JetBrains Mono` (códigos y datos tabulares), servidas mediante `next/font/google`.
- Un solo sistema visual para todos los roles; cada área se distingue mediante icono, etiqueta y acento funcional discreto.

## Evidence on Hand

- Código y flujos operativos existentes en `src/app`, `src/components` y `src/lib`.
- Logotipo e íconos de aplicación en `public/isotipo.svg` y `public/icons/` (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`).
- Datos reales disponibles únicamente en los entornos autorizados; los conceptos y pruebas deben usar contenido neutral o fixtures controlados cuando no exista una sesión de desarrollo.
- No hay testimonios, métricas de negocio ni cifras promocionales autorizadas para fabricar.

## Product Principles

1. **Decidir antes de analizar:** la primera vista prioriza excepciones y siguiente acción.
2. **Una cadena, un contexto:** cada estado explica qué ocurrió, qué sigue y quién puede actuar.
3. **Campo resiliente:** la conectividad intermitente no debe causar pérdida, duplicación ni ambigüedad.
4. **Detalle bajo demanda:** la densidad aparece cuando ayuda a ejecutar, no antes.
5. **Reglas visibles:** permisos, bloqueos y validaciones explican el motivo y la recuperación posible.

## Accessibility & Inclusion

- Cumplimiento WCAG 2.1 AA como mínimo.
- Navegación completa por teclado y estados accesibles para menús, combobox, modales y filtros.
- Objetivos táctiles de al menos 44 px en dispositivos `coarse-pointer`.
- Texto operativo mínimo de 14 px; 10–11 px reservado únicamente para badges compactos.
- Contraste AA, foco visible y alternativa intencional para `prefers-reduced-motion`.
