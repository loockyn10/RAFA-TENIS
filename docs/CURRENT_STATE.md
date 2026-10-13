# CURRENT_STATE.md — 2026-10-13 (después de Sprint 6, implementación local)

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
- Migración `supabase/migrations/20261013040000_membership_dues_and_payments.sql`: configuración ARS por club, cuotas mensuales inmutables por período, pagos manuales auditables y RLS financiero exclusivo owner/admin.
- Sección administrativa **Cuotas**: configuración de importe/vencimiento, emisión mensual idempotente, cuota individual para socio activo, totales reales, búsqueda/filtros, detalle y registro de pagos.
- Ficha de socio: estado de cuenta, saldo calculado, cuotas y pagos históricos; pagos anulables con motivo desde el detalle. Staff no ve datos financieros.
- Migración `supabase/migrations/20261013050000_tennis_school.sql`: perfiles `club_coaches`, clases, alumnos y series de clases; los RPC crean, editan y cancelan clases de manera atómica junto con la ocupación de cancha.
- Sección administrativa **Escuela de tenis**: alta/activación de profesores desde personas existentes, clases individuales/grupales sin alumnos obligatorios, cupo, alta rápida de alumno, edición/cancelación y recurrencia semanal de hasta 12 clases. El calendario distingue clases y permite abrir su detalle; la creación puede iniciarse desde el calendario.

## Verificado localmente
- El usuario informó haber verificado manualmente: inicio de sesión, acceso owner, seis canchas, edición y persistencia tras recargar contra el proyecto Supabase.
- En Sprint 6 finalizaron correctamente `pnpm typecheck`, `pnpm lint`, `pnpm test` (25 pruebas) y `pnpm build`. El build emitió la advertencia de bundle JavaScript superior a 500 kB; no se alteró el alcance para resolverla.
- Las verificaciones locales no equivalen a pruebas remotas de PostgreSQL/RLS.
- No se ejecutaron pruebas de RLS, exclusión GiST, atomicidad o concurrencia contra PostgreSQL/Supabase durante este sprint.

## Migraciones e infraestructura remota
- Migraciones versionadas en repositorio: **sí**.
- Sprint 1 aplicado y funcionalidad básica: **verificado manualmente por el usuario, no revalidado por este sprint**.
- Sprint 2/Sprint 3/Sprint 4/Sprint 5: **el usuario informó que Sprint 5 funciona contra Supabase; por sus dependencias se infiere que fueron aplicadas**. No se revalidaron sus versiones, RLS exhaustivo ni concurrencia en este sprint.
- Sprint 6: **migración versionada localmente, no aplicada remotamente**.
- Exclusión temporal entre reservas/bloqueos/clases, RLS, funciones de series, personas/socios y garantías financieras contra Supabase real: **pendientes de verificación reproducible**.

## Contradicción detectada
La arquitectura previa proyectaba una entidad `players`, pero las migraciones existentes no la creaban. Sprint 4 crea `club_people` como entidad real para evitar confundir una proyección documental con un esquema aplicado. No se hizo commit ni push.

## No implementado
No hay edición masiva de series, recurrencias infinitas, pagos/liquidaciones/comisiones de profesores, mensualidades de alumnos, cobros automáticos/anticipados, Mercado Pago API, facturación fiscal, caja, torneos, cantina, recuperación de cuentas, invitaciones, despliegue, pruebas RLS remotas ni funcionalidad offline transaccional.

## Próximo trabajo
Confirmar en Supabase el historial de Sprint 2–5, aplicar Sprint 6 solo después de esa comprobación, y ejecutar los guiones SQL con usuarios de dos clubes. Luego validar agenda, escuela, cuotas y pagos desde PC y celular.
