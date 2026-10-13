# ARCHITECTURE.md

## Estado de las decisiones
**Implementado localmente:** monorepo mínimo pnpm `apps/web`; React + Vite + TypeScript strict; responsive PWA; cliente Supabase, Auth por email/contraseña, migración de clubes/personal/canchas y RLS versionada; tests Vitest. **No verificado en remoto:** proyecto Supabase, aplicación de migraciones, RLS real, Vercel y GitHub privado. Sin Docker ni Tauri.

## División técnica
- **Frontend/PWA:** vistas responsive para operatoria y, después, jugador; estado local solo para UI; errores de red visibles.
- **Supabase Auth:** cuentas digitales administrativas; vínculo Auth ↔ fichas de jugadores opcional/futuro.
- **PostgreSQL:** fuente de verdad de reservas y ocupación; integridad de intervalos por cancha, migraciones versionadas.
- **RLS:** controles por club y rol, con servidor como autoridad; jamás `service_role` en cliente.
- **Vercel:** despliegue futuro; no afirmar producción a partir de un build exitoso.

## Datos: propuesta conceptual, no tablas existentes
- `clubs(id, name, timezone, ...)`
- `club_staff(club_id, auth_user_id, role, ...)`
- `courts(id, club_id, name, surface, active, display_order, ...)`
- `players(id, club_id, name, optional_contact, optional_auth_user_id, ...)`
- `court_reservations(id, club_id, court_id, player_id?, guest_name?, starts_at, ends_at, type, status, notes?, created_by, ...)`

Cada cancha pertenece a un club. La reserva debe relacionarse con una cancha del **mismo club** (integridad de datos, no solo validación de pantalla). Un jugador puede no tener login. Tipos futuros: play, lesson, tournament, maintenance, event; no construir módulos futuros de antemano.

## Integridad temporal — para el sprint de reservas
- `timestamptz` en instantes, timezone `America/Argentina/Buenos_Aires` para visualización.
- `CHECK (ends_at > starts_at)`.
- Restricción a nivel BD, por cancha y rangos `[inicio,fin)`, típicamente `EXCLUDE USING gist (court_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&)` condicionada a estados que ocupan la cancha; evaluar `btree_gist` y el diseño real.
- Permitir 17:00–18:00 y 18:00–19:00 contiguos; cancelación libera ocupación.
- Verificar el mismo criterio de confirmación/bloqueo en toda la app, más pruebas simultáneas con instancia PostgreSQL/Supabase compatible.

## Modelo económico futuro (NO implementar ahora)
- Membresía distinta de deuda, cuotas por periodo y registros de pago.
- Cargo/saldo separado de reserva/uso. Montos ARS exactos (`numeric` o centavos enteros definidos explícitamente; no `float`).
- Tarifas históricas con vigencias; ajustes manuales auditables.

## Seguridad
- RLS en **todas las tablas privadas**, alcance por `club_id` y `auth.uid()`/membresía administrativa.
- Política de bootstrap de primer admin controlada, sin endpoint público que se conceda rol a sí mismo.
- No filtrar teléfonos, notas, cuotas ni consumos a vistas públicas de torneos.
- Validación frontend mejora UX, **no reemplaza** constraints ni autorización backend.

### Sprint 1 — acceso y canchas
- `clubs`, `club_staff` y `courts` están definidos en una migración versionada. Las membresías se identifican por `(club_id, auth_user_id)` y roles `owner`, `admin`, `staff`.
- RLS permite al usuario autenticado leer solo sus propias membresías, sus clubes y sus canchas. Solo `owner` y `admin` pueden actualizar los campos configurables de una cancha. No hay políticas de inserción, baja ni modificación de membresías desde el cliente.
- Las funciones RLS `SECURITY DEFINER` están en el esquema no expuesto `private`, con `search_path` fijo y permisos de ejecución limitados a `authenticated`.
- Si una persona pertenece a más de un club, el frontend obliga a elegir el contexto y cada consulta de canchas filtra por el club seleccionado. Esto complementa, pero no sustituye, RLS.
- La caché PWA solo precachea los artefactos estáticos del build; no hay reglas de runtime que cacheen respuestas privadas de Supabase.

## Operación e infraestructura
- `.env.example` con nombres de variables públicas sin credenciales reales; `.env.local` ignorado.
- Ninguna migración creada equivale a aplicada; distinguir verificado local/remoto/producción.
- Políticas de respaldo y titularidad/costos de cuentas: pendiente de conversar.
- No prometer offline transaccional; PWA instalable ≠ base offline sincronizada.

## Operación de configuración
Las variables públicas se leen desde `.env.local` en la raíz. La creación del primer usuario Auth y la ejecución de `supabase/bootstrap/rafa-tenis.sql` son operaciones administrativas manuales: no existe autoprovisión de administradores en el frontend. La migración existe en el repositorio, pero no fue aplicada ni verificada contra una base remota durante este sprint.
