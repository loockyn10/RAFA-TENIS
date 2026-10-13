# CURRENT_STATE.md — 2026-10-13 (después de Sprint 4, implementación local)

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
- Migración `supabase/migrations/20261013030000_club_people_and_memberships.sql`: `club_people`, `club_memberships`, RLS/GRANT por roles, FK compuesta de club y vínculo opcional de fichas a reservas/series.
- Sección administrativa **Jugadores**: alta rápida con nombre, edición, baja lógica, búsqueda por nombre/teléfono, filtros simples y ficha con reservas realmente vinculadas. Owner/admin gestiona membresías; staff las consulta.
- El formulario de reserva conserva nombre libre y permite seleccionar una ficha activa, completando el nombre y persistiendo solo un vínculo opcional con snapshot textual.

## Verificado localmente
- El usuario informó haber verificado manualmente: inicio de sesión, acceso owner, seis canchas, edición y persistencia tras recargar contra el proyecto Supabase.
- En este Sprint 3 finalizaron correctamente `pnpm typecheck`, `pnpm test` (18 pruebas), `pnpm lint` y `pnpm build`.
- Las verificaciones locales del Sprint 4 se registran según la ejecución real de esta entrega; no equivalen a pruebas remotas de PostgreSQL/RLS.
- No se ejecutaron pruebas de RLS, exclusión GiST, atomicidad o concurrencia contra PostgreSQL/Supabase durante este sprint.

## Migraciones e infraestructura remota
- Migraciones versionadas en repositorio: **sí**.
- Sprint 1 aplicado y funcionalidad básica: **verificado manualmente por el usuario, no revalidado por este sprint**.
- Migraciones Sprint 2/Sprint 3/Sprint 4 aplicadas en remoto: **no confirmadas; requieren aplicación explícita y ordenada**.
- Exclusión temporal entre reservas/bloqueos, RLS, función de series, personas/socios y concurrencia contra Supabase real: **pendientes de verificación**.

## Contradicción detectada
La arquitectura previa proyectaba una entidad `players`, pero las migraciones existentes no la creaban. Sprint 4 crea `club_people` como entidad real para evitar confundir una proyección documental con un esquema aplicado. No se modificó Git ni se hizo commit o push.

## No implementado
No hay edición masiva de series, recurrencias infinitas, cuotas, cobros, profesores, clases, torneos, cantina, recuperación de cuentas, invitaciones, despliegue, pruebas RLS remotas ni funcionalidad offline transaccional.

## Próximo trabajo
Confirmar el estado real de las migraciones Sprint 2 y 3, aplicar 2–4 en orden si corresponde, y ejecutar los guiones SQL con usuarios de dos clubes. Luego validar jugadores, membresías y reserva vinculada desde PC y celular.
