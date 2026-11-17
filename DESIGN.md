# Design System — Blue Horizon Trade ERP

> Contrato inicial aprobado para la implementación. Al finalizar el rediseño debe actualizarse desde la interfaz construida y acompañarse por `.impeccable/design.json`.

## Visual Direction

**Precision Modern** convierte la cadena operativa en una interfaz nítida, sobria y orientada a decisiones. La jerarquía nace de prioridad, estado y proximidad temporal. Evitar gradientes decorativos, vidrio, tarjetas anidadas sin función y dashboards donde todos los bloques compiten por atención.

## Tokens

### Brand

| Token | Valor | Uso |
| --- | --- | --- |
| `--bht-navy` | `#102A43` | estructura, encabezados, texto principal |
| `--bht-cobalt` | `#1463FF` | acción primaria, foco y selección |
| `--bht-steel` | `#486581` | texto secundario e información industrial |
| `--bht-sky` | `#D9E8FF` | superficies informativas suaves |
| `--bht-amber` | `#F6A623` | acento logístico dosificado |
| `--bht-ink` | `#0B192C` | texto de máxima legibilidad |
| `--bht-paper` | `#F7F5F0` | fondo editorial y documentos |

La proporción orientativa es 60% superficies, 30% estructura/texto, 8% acciones y 2% acentos. Éxito, advertencia y peligro son tokens semánticos independientes; nunca se sustituyen por colores de marca.

### Surface and text

- Fondo de aplicación: Paper matizado con superficies blancas para áreas de trabajo.
- Texto principal: Ink; títulos estructurales: Horizon Navy.
- Texto secundario: Steel; nunca usar gris claro para información operativa.
- Bordes: mezcla de Navy con 10–16% de opacidad; selección: Cobalt.
- Amber señala logística, plazos o atención moderada; no representa errores.

## Typography

- Familia única: **Plus Jakarta Sans variable**, cargada con `next/font/google`.
- Texto: 400; datos: 500; controles y subtítulos: 600; títulos: 700–800.
- Texto operativo: 14–16 px; metadata: 12–13 px; 10–11 px solo en badges.
- Montos, cantidades y códigos usan números tabulares y espaciado moderado.
- Los títulos describen una tarea o una situación; evitar nombres técnicos como “BI” o “Neon PostgreSQL”.

## Layout and Density

- Móvil operativo: una tarea dominante, acciones al alcance del pulgar y máximo cuatro destinos visibles más “Más”.
- Escritorio supervisor: sidebar compacta persistente, encabezado con búsqueda/sincronización/acciones y área de trabajo de ancho controlado.
- Objetivos táctiles mínimos de 44 px; espaciado base de 4 px con ritmos principales de 8, 12, 16, 24 y 32 px.
- Las tarjetas agrupan una decisión o entidad; no se anidan para ornamentar.
- Tablas aparecen solo donde la comparación entre filas es esencial y siempre tienen alternativa legible en móvil.

## Hierarchy

1. **Siguiente acción:** una cola o tarea dominante en el primer viewport.
2. **Estado operativo:** máximo cuatro indicadores compactos.
3. **Ejecución:** controles y formularios con divulgación progresiva.
4. **Análisis:** detalle, historial y reportes bajo demanda.

## Navigation

- Socios: Hoy, Ventas, Cobranza, Inventario, Finanzas y análisis. Equipo y acceso vive en administración.
- Vendedor móvil: Vender, Ventas, Cobrar, Más.
- Almacén: Por alistar, Listos / En ruta, Entregados.
- Las transiciones entre áreas aparecen solo a roles autorizados.
- Los aliases heredados se canonicalizan sin perder filtros ni romper enlaces guardados.

## Component Language

- Botón primario Cobalt, compacto y directo; una acción primaria por región.
- Estados con icono, etiqueta y color semántico; el color nunca es el único indicador.
- Filtros y pestañas mantienen selección visible y se reflejan en la URL cuando representan contexto durable.
- Empty states explican qué significa la ausencia y cuál es la siguiente acción.
- Errores se asocian al campo o acción concreta, conservan el trabajo y ofrecen recuperación.
- El éxito explica qué se registró, qué estado sigue y cuál es la próxima acción.

## Responsive Patterns

- Validar 360, 390, 412, 768, 1280 y 1440 px sin overflow horizontal no intencional.
- En móvil, las secciones progresivas completadas se colapsan en resúmenes editables.
- En escritorio, paneles secundarios pueden coexistir cuando no compiten con la cola principal.
- Menús, modales y formularios respetan áreas seguras y teclado virtual.

## Motion

- Motion confirma relación y cambio de estado; no decora.
- Usar transiciones breves de opacidad/color y expansión contenida.
- `prefers-reduced-motion` elimina desplazamientos y escalados, pero conserva feedback instantáneo de estado y foco.

## Role Accents

- Socios: Navy/Cobalt para control y decisión.
- Vendedor: Cobalt como acción y Sky como guía de progreso.
- Almacén: Navy con Amber dosificado para logística.
- Estos acentos no crean tres marcas visuales distintas: comparten tipografía, forma, espaciado y estados semánticos.
