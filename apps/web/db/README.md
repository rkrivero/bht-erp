# Base de datos

`bht_neon` no contiene ni ejecuta migraciones. La única fuente de verdad del
esquema, los procesos ETL y su historial de checksums es el repositorio hermano
`../bht_data`.

Versión mínima requerida por esta aplicación:

```text
030_harden_analytics_views_settings_and_closure_defaults
```

Flujo de despliegue:

1. En `dev`, ejecutar `bht-etl migrate --branch dev` desde `bht_data`.
2. Validar aplicación, pruebas y aceptación por rol en preview.
3. En producción, aplicar la migración en `main` (`--branch main --confirm-main`) solo con aprobación explícita.

Las migraciones deben ser compatibles hacia atrás durante cada entrega para
permitir rollback de la aplicación.

## Variables por entorno

- Desarrollo local y Vercel Preview usan `BHT_DB_BRANCH=dev` y `DEV_DATABASE_URL`
  (o `NEON_DATABASE_URL_DEV`).
- Vercel Production usa `BHT_DB_BRANCH=main` y `DATABASE_URL`
  (o `NEON_DATABASE_URL_MAIN`).
- `NEON_AUTH_BASE_URL` y `NEON_AUTH_COOKIE_SECRET` (mínimo 32 caracteres aleatorios,
  distintos entre Preview y Production) son obligatorios para autenticación.
- El build de Vercel se detiene si falta la rama, la URL correspondiente o el
  secreto requerido. No expongas URLs ni secretos con prefijo `NEXT_PUBLIC_`.
