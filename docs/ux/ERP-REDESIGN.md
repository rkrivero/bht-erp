# ERP BHT — Arquitectura de información y wireflows

## Conceptos

- Comparación privada de Magic Patterns: https://www.magicpatterns.com/inspiration/25b157ef-1164-4f40-9efd-8d85fddebff3
- Dirección de implementación: **Exception Queue First**.
- Las alternativas Split Command Center, Financial Daybook y Role Workbench validan composición; no sustituyen la dirección aprobada.
- Todos los valores en los conceptos son demostrativos y no representan la operación real.

## Mapa de navegación

```text
ERP BHT
├── Socios
│   ├── Hoy
│   │   ├── Decisiones pendientes
│   │   ├── Caja del día
│   │   ├── Operación
│   │   └── Riesgos
│   ├── Ventas
│   ├── Cobranza
│   ├── Inventario
│   ├── Finanzas y análisis
│   │   ├── Caja y proveedores
│   │   └── Indicadores y reportes
│   └── Administración
│       └── Equipo y acceso
├── Vendedor
│   ├── Vender
│   ├── Ventas
│   │   ├── Pedidos
│   │   └── Cotizaciones
│   ├── Cobrar
│   └── Más
│       ├── Gastos
│       ├── Sincronización
│       └── Opciones personales
└── Almacén
    ├── Por alistar
    ├── Listos / En ruta
    └── Entregados
```

## Wireflow — Socios

```text
Hoy
  → cola priorizada
      → revisar evidencia
          → ejecutar acción autorizada
              → confirmar qué cambió y qué sigue
  → KPIs compactos
      → abrir área correspondiente
          → filtrar / consultar detalle
```

La prioridad se deriva de datos existentes. Una alerta sin evidencia no se muestra. El historial, la auditoría y las acciones secundarias se abren bajo demanda.

## Wireflow — Vendedor

```text
Vender
  → Cliente
      → Productos
          → Pago
              → Confirmación
                  → éxito: registro + estado siguiente + próxima acción
```

Cada sección completada se colapsa en un resumen editable. La navegación conserva borrador. El cambio de modalidad de pago revela únicamente sus campos relevantes. Crédito ofrece tres plazos frecuentes y “Otra fecha”.

```text
Ventas
  → Pedidos | Cotizaciones
      → filtrar
          → ver detalle / editar cuando corresponda

Cobrar
  → cobrar hoy | promesas vencidas | cartera
      → cliente o pedido
          → abono | reprogramación | línea de tiempo
```

## Wireflow — Almacén

```text
Por alistar
  → cola
      → checklist
          → faltantes / responsable
              → marcar listo

Listos / En ruta
  → asignar o abrir ruta
      → despacho
          → confirmar entrega

Entregados
  → buscar
      → trazabilidad e historial
```

Las rutas no bloquean la cola de alistamiento. “Sin empezar” y “En proceso” son filtros internos, no destinos globales.

## Compatibilidad de URL

| Área     | Alias heredado            | Destino canónico |
| -------- | ------------------------- | ---------------- |
| Vendedor | `nuevo`                   | `sell`           |
| Vendedor | `cotizaciones`, `pedidos` | `sales`          |
| Vendedor | `deudores`                | `collections`    |
| Vendedor | `gastos`                  | `more`           |
| Socios   | `control`                 | `today`          |
| Socios   | `pedidos`                 | `sales`          |
| Socios   | `deudores`                | `collections`    |
| Socios   | `stock`                   | `inventory`      |
| Socios   | `caja`, `kpis`            | `finance`        |

La canonicalización preserva filtros y la subvista que corresponda. Los endpoints y payloads públicos no cambian.

## Checkpoints

1. Fundamentos y AppShell sin cambios comerciales.
2. Socios con Today/Exception Queue First.
3. Vendedor con pedido progresivo y navegación agrupada.
4. Almacén con rutas contextuales.
5. Hardening de errores, offline, accesibilidad, rendimiento y pruebas.
