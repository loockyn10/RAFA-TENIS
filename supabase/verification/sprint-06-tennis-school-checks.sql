-- Sprint 06: ejecutar manualmente SOLO después de aplicar migraciones 01–06.
-- Reemplazar identificadores. Cada bloque es una verificación reproducible contra PostgreSQL/Supabase real.

-- 1. Estructura: la agenda única incluye lesson y las tablas no se escriben directo desde el cliente.
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.reservations'::regclass and conname in ('reservations_occupied_court_no_overlap', 'reservations_occupation_type_check');

-- 2. Owner/Admin A registra una persona ya existente como profesor. Repetir debe fallar por unique(club_id, person_id).
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ADMIN_A_USER_ID', true);
insert into public.club_coaches (club_id, person_id, active)
values ('CLUB_A_ID', 'PERSON_COACH_A_ID', true);
-- Esperado: ERROR 23505 al repetir el insert.
rollback;

-- 3. STAFF A crea clase individual sin alumnos; queda una ocupación lesson confirmada.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'STAFF_A_USER_ID', true);
select public.create_tennis_lesson(
  'CLUB_A_ID', 'COACH_A_ID', 'COURT_A_ID',
  '2026-11-03 18:00 America/Argentina/Buenos_Aires', '2026-11-03 19:00 America/Argentina/Buenos_Aires',
  'individual', 1, '{}'::uuid[], null
);
select l.id, r.occupation_type, r.status, r.starts_at, r.ends_at
from public.tennis_lessons l join public.reservations r on r.id = l.reservation_id
where l.club_id = 'CLUB_A_ID';
rollback;

-- 4. Cupo y alumnos: usar dos UUID distintos para una grupal cupo 2. Repetir alumno o exceder cupo debe devolver 22023.
-- select public.create_tennis_lesson('CLUB_A_ID', 'COACH_A_ID', 'COURT_A_ID', now(), now()+interval '1 hour', 'group', 1, array['PERSON_1'::uuid, 'PERSON_2'::uuid], null);

-- 5. Agenda: una clase 18:00–19:00 debe producir 23P01 al insertar reserva 18:30–19:30, bloqueo superpuesto u otra clase superpuesta.
-- Verificar además que al ejecutar select public.cancel_tennis_lesson('LESSON_ID') se puede insertar luego una ocupación 18:00–19:00.

-- 6. Profesor: crear una clase del mismo profesor en otra cancha 18:30–19:30 debe fallar 23P01; 19:00–20:00 debe permitirse.

-- 7. Serie semanal: la función devuelve 1..12 UUID. Ocupar previamente una ocurrencia intermedia debe fallar y no dejar filas de la serie.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'STAFF_A_USER_ID', true);
select * from public.create_weekly_tennis_lesson_series(
  'CLUB_A_ID', 'COACH_A_ID', 'COURT_A_ID',
  '2026-11-03 18:00 America/Argentina/Buenos_Aires', '2026-11-03 19:00 America/Argentina/Buenos_Aires',
  'group', 4, '{}'::uuid[], 'Serie de prueba', 4
);
rollback;

-- 8. Aislamiento/RLS: con usuario del Club B, SELECT sobre tablas de Club A devuelve 0 filas y RPC sobre datos A falla 42501.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'STAFF_B_USER_ID', true);
select * from public.tennis_lessons where club_id = 'CLUB_A_ID';
-- select public.create_tennis_lesson('CLUB_A_ID', 'COACH_A_ID', 'COURT_A_ID', now(), now()+interval '1 hour', 'individual', 1, '{}'::uuid[], null);
rollback;

-- 9. Roles: STAFF no debe insertar/actualizar club_coaches; owner/admin sí. STAFF sí puede crear/editar/cancelar clases vía RPC.
-- 10. Con dos sesiones de STAFF A, crear clases simultáneas para el mismo profesor y horario. Solo una debe confirmar; la otra debe recibir 23P01.
