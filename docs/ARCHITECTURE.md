# ARCHITECTURE.md

## Estado de las decisiones
**Implementado localmente:** monorepo mínimo pnpm `apps/web`; React + Vite + TypeScript strict; responsive PWA; cliente Supabase, Auth por email/contraseña, migraciones de clubes/personal/canchas, reservas, finanzas y escuela de tenis, RLS versionada y tests Vitest. **Reportado como verificado manualmente por el usuario:** proyecto Supabase, acceso owner, seis canchas, edición/persistencia y operación Sprint 5. **Aún no verificado reproduciblemente en remoto:** RLS exhaustivo, exclusión temporal/concurrencia, Sprint 6, Vercel y GitHub privado. Sin Docker ni Tauri.

## División técnica
- **Frontend/PWA:** vistas responsive para operatoria y, después, jugador; estado local solo para UI; errores de red visibles.
- **Supabase Auth:** cuentas digitales administrativas; vínculo Auth ↔ fichas de jugadores opcional/futuro.
- **PostgreSQL:** fuente de verdad de reservas y ocupación; integridad de intervalos por cancha, migraciones versionadas.
- **RLS:** controles por club y rol, con servidor como autoridad; jamás `service_role` en cliente.
- **Vercel:** despliegue futuro; no afirmar producción a partir de un build exitoso.

## Datos: implementado / evolución prevista
- `clubs(id, name, timezone, ...)`
- `club_staff(club_id, auth_user_id, role, ...)`
- `courts(id, club_id, name, surface, active, display_order, ...)`
- `club_people(id, club_id, full_name, phone?, email?, notes?, active, ...)`: ficha privada sin Auth obligatorio ni unicidad artificial de nombre/contacto.
- `club_memberships(id, club_id, person_id, status active|inactive, joined_on?, ...)`: condición de socio, distinta de `club_staff` y de cuotas/deudas.
- `reservations(id, club_id, court_id, occupation_type, customer_name?, person_id?, block_reason?, starts_at, ends_at, status, recurrence_series_id?, notes?, created_by, ...)`: agenda única; `reservation/confirmed` y `block/active` ocupan cancha.
- `reservation_series(id, club_id, court_id, customer_name, person_id?, starts_at, ends_at, occurrence_count<=12, ...)`: origen de las ocurrencias semanales; no habilita edición masiva todavía.

Cada cancha pertenece a un club. La reserva debe relacionarse con una cancha del **mismo club** (integridad de datos, no solo validación de pantalla). Un jugador puede no tener login. Tipos futuros: play, lesson, tournament, maintenance, event; no construir módulos futuros de antemano.

`reservations.person_id` y `reservation_series.person_id` son opcionales y usan FK compuesta `(club_id, person_id)`: impiden enlazar una ficha de otro club sin forzar el alta de visitantes. `customer_name` persiste como snapshot, por lo que un cambio en la ficha nunca reescribe reservas pasadas.

## Integridad temporal — para el sprint de reservas
- `timestamptz` en instantes, timezone `America/Argentina/Buenos_Aires` para visualización.
- `CHECK (ends_at > starts_at)`.
- Restricción a nivel BD, por cancha y rangos `[inicio,fin)`, típicamente `EXCLUDE USING gist (court_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&)` condicionada a estados que ocupan la cancha; evaluar `btree_gist` y el diseño real.
- Permitir 17:00–18:00 y 18:00–19:00 contiguos; cancelación libera ocupación.
- Verificar el mismo criterio de confirmación/bloqueo en toda la app, más pruebas simultáneas con instancia PostgreSQL/Supabase compatible.

## Cuotas sociales — Sprint 5 local
- `club_fee_settings(club_id, monthly_amount_cents, due_day 1..28, currency='ARS')` conserva la configuración vigente; cambiarla no toca cuotas ya emitidas.
- `membership_dues` usa período como primer día del mes, congela `amount_cents` y vencimiento, y es única por `(club_id, membership_id, period)`. No hay baja física ni edición directa.
- `membership_due_payments` registra pagos manuales por cuota; un pago anulado conserva auditoría (`voided_at/by/reason`) y no integra el saldo. El saldo es `amount_cents - sum(pagos válidos)`, no una columna mutable.
- Funciones `SECURITY DEFINER` con `auth.uid()`, rol owner/admin, `search_path` explícito y locks por cuota emiten en lote/individualmente, impiden sobrepagos concurrentes y anulan con motivo. La UI no usa `service_role`.
- RLS solo permite lectura financiera a owner/admin del club. Staff no ve ni muta configuración, cuotas ni pagos.

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

### Sprint 2 — reservas
- `reservations` referencia a `clubs` y a la clave compuesta `(club_id, court_id)` de `courts`, de modo que la correspondencia cancha/club se valida en PostgreSQL.
- Un trigger permite crear o reactivar una ocupación que reserva cancha solo si esta sigue activa. La edición de una ocupación existente y la cancelación no requieren reactivar una cancha deshabilitada después.
- El rango `tstzrange(starts_at, ends_at, '[)')` y una exclusión GiST condicionada a `status in ('confirmed', 'active')` impiden solapes entre reservas y bloqueos, incluso concurrentes, y permiten turnos contiguos. Requiere `btree_gist`.
- `public.create_weekly_reservation_series(...)` es `SECURITY DEFINER` con `search_path` fijo, verifica `auth.uid()` y membresía antes de insertar la cabecera y todas las ocurrencias en una única transacción. Calcula semanas en la zona de `clubs` y se concede solo a `authenticated`.
- RLS y privilegios de columna permiten a cualquier miembro `owner`, `admin` o `staff` consultar, crear y actualizar reservas de su club, pero no borrar físicamente ni alterar su club, autor o metadatos de auditoría.
- La aplicación convierte la fecha/hora de la agenda desde `clubs.timezone` (inicialmente `America/Argentina/Buenos_Aires`) a instantes `timestamptz`; no utiliza la zona horaria del dispositivo para persistir.

### Sprint 4 — jugadores y socios
- `club_people` y `club_memberships` están versionadas localmente con RLS por club. Todo personal administrativo puede leer/crear/editar/desactivar fichas; solamente owner/admin crea o cambia membresías. No hay bajas físicas desde cliente.
- Las FKs compuestas preservan aislamiento entre clubes para membresías y vínculos de reservas. La tabla de membresías impide duplicados por `(club_id, person_id)`.
- La interfaz carga resultados acotados, busca por nombre o teléfono, y muestra únicamente reservas enlazadas por `person_id` en la ficha.

### Sprint 5 — cuotas y pagos
- La configuración, emisión mensual, emisión individual, pagos y anulación se resuelven mediante RPC; las tablas no conceden insert/update/delete directos al cliente autenticado.
- La interfaz usa ARS en centavos, conversión decimal validada y fecha local del club para mostrar condición vencida. “Vencida” es temporal y se muestra junto al estado parcial o pendiente cuando corresponde.

### Sprint 6 — escuela de tenis
- `club_coaches` complementa `club_people` por club; no equivale a `club_staff` y conserva perfiles inactivos e historial.
- `tennis_lessons` conserva tipo, cupo, estado, profesor, alumnos y una FK compuesta hacia una fila `reservations` de tipo `lesson`. La fila de agenda contiene cancha e instantes, evitando una segunda agenda incompatible; solo los RPC del módulo pueden modificar una ocupación de clase.
- La exclusión GiST existente incorpora `lesson`, por lo que reserva, bloqueo y clase compiten por la misma cancha. Un lock asesorado por profesor, más la comprobación en función SQL, evita clases superpuestas del mismo profesor incluso con solicitudes concurrentes.
- `create_tennis_lesson`, `update_tennis_lesson`, `cancel_tennis_lesson` y `create_weekly_tennis_lesson_series` son `SECURITY DEFINER`, validan `auth.uid()`, pertenencia al club, profesor activo, alumnos del club, cupo y horario. La serie se inserta en una sola transacción y se limita a 12 ocurrencias.
- Owner/admin gestionan perfiles de profesor; owner/admin/staff consultan la escuela y operan clases/alumnos. Las tablas de clases no conceden escritura directa al cliente; no se expone `service_role`.

### Sprint 7 — torneos
- `tournaments`, `tournament_categories`, `tournament_entries`, `tournament_entry_members` y `tournament_matches` conservan torneo, modalidad, snapshots históricos de participantes, cuadro y resultado. FKs compuestas por club y RLS aíslan todas las relaciones.
- Las operaciones estructurales son RPC `SECURITY DEFINER` para owner/admin: crear torneo/categoría/inscripción y generar fixture. El sorteo persiste dentro de una transacción, se bloquea por categoría y no permite un segundo fixture. La modalidad y la unicidad `(category_id, person_id)` impiden pares incompatibles o duplicados.
- El fixture es eliminación directa 2–32; los BYE avanzan al siguiente partido sin crear un partido ficticio de primera ronda. Registrar resultado valida que el ganador participe, bloquea correcciones cuando existen rondas posteriores finalizadas y avanza una única vez.
- Un partido programado crea/edita una `reservations` `occupation_type='tournament_match'` exclusivamente por RPC, cubierta por la exclusión GiST existente. Staff puede programar, cancelar programación y cargar resultados; no crea ni modifica estructura. No hay `service_role` en React.

## Operación e infraestructura
- `.env.example` con nombres de variables públicas sin credenciales reales; `.env.local` ignorado.
- Ninguna migración creada equivale a aplicada; distinguir verificado local/remoto/producción.
- Políticas de respaldo y titularidad/costos de cuentas: pendiente de conversar.
- No prometer offline transaccional; PWA instalable ≠ base offline sincronizada.

## Operación de configuración
Las variables públicas se leen desde `.env.local` en la raíz. La creación del primer usuario Auth y la ejecución de `supabase/bootstrap/rafa-tenis.sql` son operaciones administrativas manuales: no existe autoprovisión de administradores en el frontend. El usuario informó haber verificado esa configuración base y la operación de Sprint 5; sus verificaciones exhaustivas de RLS y concurrencia continúan pendientes.
