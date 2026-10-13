# CURRENT_STATE.md — 2026-10-13 (después de Sprint 2, implementación local)

## Implementado en el repositorio
- Workspace pnpm con React, Vite, TypeScript estricto y PWA responsive en `apps/web`.
- Cliente de Supabase configurado exclusivamente con `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Cuando faltan, la app muestra una pantalla clara de configuración pendiente.
- Inicio/cierre/restauración de sesión por email y contraseña. No hay registro público de administradores.
- Panel administrativo protegido: sin sesión muestra login; una sesión sin membresía muestra “No tenés acceso administrativo a ningún club.”
- Consulta de clubes y canchas aislada por club. Usuarios con varios clubes eligen un contexto explícito.
- Administración responsive de nombre, superficie, estado y orden de canchas para roles `owner` y `admin`; `staff` solo consulta.
- Migración `supabase/migrations/20261013000000_club_access_and_courts.sql` con `clubs`, `club_staff`, `courts`, trigger de actualización, permisos y RLS.
- Bootstrap administrativo idempotente en `supabase/bootstrap/rafa-tenis.sql`, y guion manual de verificaciones RLS en `supabase/verification/rls-checks.sql`.
- Migración `supabase/migrations/20261013010000_reservations.sql`: reservas, FK cancha/club, índice, exclusión GiST de solapes, trigger de cancha activa, permisos restringidos y RLS por membresía.
- Sección administrativa **Reservas**: agenda diaria, navegación por fecha, selección de fecha, seis columnas en escritorio y selector de cancha en celular; alta, edición y cancelación lógica de reservas.
- Utilidades y pruebas para intervalos, conversión `America/Argentina/Buenos_Aires`, orden, bloques visuales y error de solape de PostgreSQL.

## Verificado localmente
- El usuario informó haber verificado manualmente: inicio de sesión, acceso owner, seis canchas, edición y persistencia tras recargar contra el proyecto Supabase.
- En este Sprint 2 finalizaron correctamente `pnpm typecheck`, `pnpm lint`, `pnpm test` (14 pruebas) y `pnpm build`.
- No se ejecutaron pruebas de RLS, exclusión GiST o concurrencia contra PostgreSQL/Supabase durante este sprint.

## Migraciones e infraestructura remota
- Migraciones versionadas en repositorio: **sí**.
- Sprint 1 aplicado y funcionalidad básica: **verificado manualmente por el usuario, no revalidado por este sprint**.
- Migración de reservas Sprint 2 aplicada en remoto: **no; pendiente de aplicación explícita**.
- Exclusión temporal, RLS de reservas y concurrencia contra Supabase real: **pendientes de verificación**.

## Contradicción detectada
El documento previo indicaba que no se había inicializado ni verificado un repositorio Git/GitHub remoto, pero la inspección de este sprint encontró `main...origin/main`. No se modificó esa configuración ni se hizo commit o push.

## No implementado
Jugadores, cuotas, cobros, profesores, clases, torneos, cantina, recuperación de cuentas, invitaciones, despliegue, pruebas RLS remotas y funcionalidad offline transaccional. Los bloqueos operativos (mantenimiento, lluvia, etc.) no forman parte de esta primera entidad de reservas.

## Próximo trabajo
Aplicar la migración Sprint 2 en Supabase y ejecutar los controles SQL de reservas con usuarios de dos clubes. Luego validar manualmente creación, edición, cancelación y conflicto de solape desde PC y celular.
