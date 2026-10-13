# CURRENT_STATE.md — 2026-10-13 (después de Sprint 1)

## Implementado en el repositorio
- Workspace pnpm con React, Vite, TypeScript estricto y PWA responsive en `apps/web`.
- Cliente de Supabase configurado exclusivamente con `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Cuando faltan, la app muestra una pantalla clara de configuración pendiente.
- Inicio/cierre/restauración de sesión por email y contraseña. No hay registro público de administradores.
- Panel administrativo protegido: sin sesión muestra login; una sesión sin membresía muestra “No tenés acceso administrativo a ningún club.”
- Consulta de clubes y canchas aislada por club. Usuarios con varios clubes eligen un contexto explícito.
- Administración responsive de nombre, superficie, estado y orden de canchas para roles `owner` y `admin`; `staff` solo consulta.
- Migración `supabase/migrations/20261013000000_club_access_and_courts.sql` con `clubs`, `club_staff`, `courts`, trigger de actualización, permisos y RLS.
- Bootstrap administrativo idempotente en `supabase/bootstrap/rafa-tenis.sql`, y guion manual de verificaciones RLS en `supabase/verification/rls-checks.sql`.

## Verificado localmente
- `pnpm typecheck` finaliza correctamente.
- `pnpm lint` finaliza correctamente.
- `pnpm test` finaliza correctamente: 7 pruebas. Cubren configuración ausente, sesión ausente, sesión sin membresía, lectura frente a administración, error de persistencia y orden de seis canchas.
- No se ejecutaron pruebas de RLS contra PostgreSQL/Supabase porque no hay un proyecto ni usuarios de prueba configurados.

## Migraciones e infraestructura remota
- Migraciones versionadas en repositorio: **sí**.
- Migraciones aplicadas en remoto: **no verificadas / no aplicadas por este sprint**.
- Bootstrap ejecutado en remoto: **no**.
- Variables `.env.local` configuradas: **no verificadas**.
- Funcionalidad de autenticación, persistencia y edición contra Supabase real: **pendiente de verificación manual**.

## Contradicción detectada
El documento previo indicaba que no se había inicializado ni verificado un repositorio Git/GitHub remoto, pero la inspección de este sprint encontró `main...origin/main`. No se modificó esa configuración ni se hizo commit o push.

## No implementado
Calendario, reservas, jugadores, cuotas, cobros, profesores, clases, torneos, cantina, recuperación de cuentas, invitaciones, despliegue, tests RLS remotos y funcionalidad offline transaccional.

## Próximo trabajo
Configurar y verificar Supabase de forma manual antes de comenzar Sprint 2. Una vez hecho, ejecutar el bootstrap y los controles RLS sin declarar resultados hasta contar con evidencia de esa base.
