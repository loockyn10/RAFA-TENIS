# CURRENT_STATE.md — 2026-10-13 (después de Sprint 3, implementación local)

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
- Migración `supabase/migrations/20261013020000_blocks_and_recurring_reservations.sql`: tipo de ocupación y motivo de bloqueo en `reservations`, referencia a `reservation_series`, exclusión GiST única y función atómica para series semanales de 1–12 ocurrencias.
- Calendario ampliado con creación, edición y cancelación lógica de bloqueos; motivo visible; reserva única o semanal; indicación discreta de ocurrencias; prechequeo explicativo de conflictos. Una edición/cancelación afecta solo la ocurrencia elegida.
- Utilidades y pruebas para intervalos, conversión `America/Argentina/Buenos_Aires`, bloqueos, recurrencias semanales, conflictos y error de solape. Guion remoto: `supabase/verification/sprint-03-blocks-and-series-checks.sql`.

## Verificado localmente
- El usuario informó haber verificado manualmente: inicio de sesión, acceso owner, seis canchas, edición y persistencia tras recargar contra el proyecto Supabase.
- En este Sprint 3 finalizaron correctamente `pnpm typecheck`, `pnpm test` (18 pruebas), `pnpm lint` y `pnpm build`.
- No se ejecutaron pruebas de RLS, exclusión GiST, atomicidad o concurrencia contra PostgreSQL/Supabase durante este sprint.

## Migraciones e infraestructura remota
- Migraciones versionadas en repositorio: **sí**.
- Sprint 1 aplicado y funcionalidad básica: **verificado manualmente por el usuario, no revalidado por este sprint**.
- Migraciones Sprint 2/Sprint 3 aplicadas en remoto: **no confirmadas; requieren aplicación explícita y ordenada**.
- Exclusión temporal entre reservas/bloqueos, RLS, función de series y concurrencia contra Supabase real: **pendientes de verificación**.

## Contradicción detectada
El documento previo indicaba que no se había inicializado ni verificado un repositorio Git/GitHub remoto, pero la inspección de este sprint encontró `main...origin/main`. No se modificó esa configuración ni se hizo commit o push.

## No implementado
No hay edición masiva de series, recurrencias infinitas, jugadores, cuotas, cobros, profesores, clases, torneos, cantina, recuperación de cuentas, invitaciones, despliegue, pruebas RLS remotas ni funcionalidad offline transaccional.

## Próximo trabajo
Confirmar el estado real de la migración Sprint 2, aplicar Sprint 2 y 3 en orden si corresponde, y ejecutar ambos guiones SQL con usuarios de dos clubes. Luego validar bloqueos, conflicto cruzado y serie semanal desde PC y celular.
