-- Sprint 03: ejecutar manualmente SOLO después de aplicar las migraciones 01 y 02.
-- Sustituir los identificadores y ejecutar cada bloque dentro de una transacción de prueba.
-- No son pruebas ejecutadas por este repositorio ni sustituyen una concurrencia con dos sesiones.

-- 1. Inspección de la única exclusión de ocupación y de la función protegida.
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.reservations'::regclass
  and conname in ('reservations_occupied_court_no_overlap', 'reservations_occupation_details_check');

select routine_name, security_type
from information_schema.routines
where routine_schema = 'public' and routine_name = 'create_weekly_reservation_series';

-- 2. Como miembro autorizado del Club A: un bloqueo activo impide una reserva.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'STAFF_A_USER_ID', true);
insert into public.reservations (club_id, court_id, starts_at, ends_at, status, occupation_type, block_reason)
values ('CLUB_A_ID', 'COURT_A_ID', '2026-11-03 19:00 America/Argentina/Buenos_Aires', '2026-11-03 20:00 America/Argentina/Buenos_Aires', 'active', 'block', 'Mantenimiento');
-- Esperado: ERROR 23P01 al intentar solapar una reserva:
-- insert into public.reservations (club_id, court_id, customer_name, starts_at, ends_at)
-- values ('CLUB_A_ID', 'COURT_A_ID', 'Ana', '2026-11-03 19:30 America/Argentina/Buenos_Aires', '2026-11-03 20:30 America/Argentina/Buenos_Aires');
rollback;

-- 3. La reserva también impide un bloqueo; una cancelación libera el horario.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'STAFF_A_USER_ID', true);
insert into public.reservations (club_id, court_id, customer_name, starts_at, ends_at)
values ('CLUB_A_ID', 'COURT_A_ID', 'Bruno', '2026-11-04 19:00 America/Argentina/Buenos_Aires', '2026-11-04 20:00 America/Argentina/Buenos_Aires');
-- Esperado: ERROR 23P01 si se inserta bloqueo 19:30–20:30 en esa cancha.
-- Actualizar el id devuelto a mano, cancelarlo, y repetir el bloqueo: debe permitirlo.
rollback;

-- 4. Serie atómica y timezone. Debe devolver cuatro UUID y conservar martes 19:00 local.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'STAFF_A_USER_ID', true);
select * from public.create_weekly_reservation_series(
  'CLUB_A_ID', 'COURT_A_ID', 'Juan', null,
  '2026-11-03 19:00 America/Argentina/Buenos_Aires',
  '2026-11-03 20:00 America/Argentina/Buenos_Aires', 4
);
select recurrence_series_id, count(*), min(starts_at at time zone 'America/Argentina/Buenos_Aires'), max(starts_at at time zone 'America/Argentina/Buenos_Aires')
from public.reservations
where club_id = 'CLUB_A_ID' and customer_name = 'Juan'
group by recurrence_series_id;
rollback;

-- 5. Atomicidad: ocupar una fecha intermedia antes de llamar a la función.
-- Esperado: ERROR 23P01 y cero filas con la serie que se intentó crear.
-- Repetir el bloque anterior tras insertar una reserva 2026-11-17 19:00–20:00.

-- 6. RLS / aislamiento. Con usuario del Club B no debe leer ni crear en Club A.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'STAFF_B_USER_ID', true);
select * from public.reservations where club_id = 'CLUB_A_ID'; -- Esperado: 0 filas.
-- Esperado: ERROR 42501 por RLS o permiso:
-- select * from public.create_weekly_reservation_series('CLUB_A_ID', 'COURT_A_ID', 'Intruso', null, now(), now() + interval '1 hour', 1);
rollback;

-- 7. Con dos sesiones autenticadas del mismo club, intentar simultáneamente reservar
-- el mismo intervalo (o bloqueo vs reserva). Debe confirmar solo una; la otra recibe 23P01.
