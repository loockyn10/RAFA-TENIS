-- Verificaciones manuales de RLS para una base de desarrollo.
-- Reemplazar los UUID y repetir CADA bloque de forma independiente en el SQL Editor.
-- Los bloques terminan en ROLLBACK: no persisten cambios.
-- Variables: CLUB_A_ID, CLUB_B_ID, COURT_A_ID, STAFF_A_USER_ID, ADMIN_A_USER_ID,
-- OWNER_A_USER_ID y OTHER_CLUB_USER_ID. Los usuarios deben existir en auth.users.

-- 1. No autenticado: no puede leer ni actualizar.
begin;
set local role anon;
select * from public.clubs; -- Esperado: error de permisos (no hay GRANT para anon).
rollback;

-- Sprint 02: ejecutar después de aplicar 20261013010000_reservations.sql.
-- Sustituir RESERVATION_A_ID, los UUID existentes y las horas de prueba. Cada
-- bloque se revierte para no alterar datos reales. Para probar concurrencia,
-- ejecutar los dos INSERT de la sección 5 en sesiones SQL separadas.

-- 1. Mismo club/cancha: el solape parcial y completo deben devolver 23P01.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ADMIN_A_USER_ID', true);
insert into public.reservations (club_id, court_id, customer_name, starts_at, ends_at)
values ('CLUB_A_ID', 'COURT_A_ID', 'Prueba base', '2026-12-01 18:00-03', '2026-12-01 19:00-03');
insert into public.reservations (club_id, court_id, customer_name, starts_at, ends_at)
values ('CLUB_A_ID', 'COURT_A_ID', 'No permitido', '2026-12-01 18:30-03', '2026-12-01 19:30-03'); -- Esperado: 23P01
rollback;

-- 2. Dos reservas consecutivas se permiten.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ADMIN_A_USER_ID', true);
insert into public.reservations (club_id, court_id, customer_name, starts_at, ends_at)
values ('CLUB_A_ID', 'COURT_A_ID', 'Primera', '2026-12-01 17:00-03', '2026-12-01 18:00-03'),
       ('CLUB_A_ID', 'COURT_A_ID', 'Segunda', '2026-12-01 18:00-03', '2026-12-01 19:00-03'); -- Esperado: INSERT 0 2
rollback;

-- 3. Al cancelar, el horario vuelve a estar disponible.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ADMIN_A_USER_ID', true);
with created_reservation as (
  insert into public.reservations (club_id, court_id, customer_name, starts_at, ends_at)
  values ('CLUB_A_ID', 'COURT_A_ID', 'A cancelar', '2026-12-01 20:00-03', '2026-12-01 21:00-03')
  returning id
)
update public.reservations
set status = 'cancelled'
where id = (select id from created_reservation);
insert into public.reservations (club_id, court_id, customer_name, starts_at, ends_at)
values ('CLUB_A_ID', 'COURT_A_ID', 'Reemplazo', '2026-12-01 20:00-03', '2026-12-01 21:00-03'); -- Esperado: INSERT 0 1
rollback;

-- 4. Miembro de otro club no puede leer ni crear reservas de Club A.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'OTHER_CLUB_USER_ID', true);
select * from public.reservations where club_id = 'CLUB_A_ID'; -- Esperado: 0 filas.
insert into public.reservations (club_id, court_id, customer_name, starts_at, ends_at)
values ('CLUB_A_ID', 'COURT_A_ID', 'No autorizado', '2026-12-02 18:00-03', '2026-12-02 19:00-03'); -- Esperado: error RLS.
rollback;

-- 5. Concurrencia (DOS SESIONES): ambas intentan el mismo intervalo; una sola
-- debe hacer COMMIT y la otra debe fallar por exclusión 23P01.

-- 2. Usuario miembro de otro club: no ve ni modifica Club A.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'OTHER_CLUB_USER_ID', true);
select * from public.courts where club_id = 'CLUB_A_ID'; -- Esperado: 0 filas.
update public.courts set name = 'No debe cambiar' where id = 'COURT_A_ID'; -- Esperado: UPDATE 0.
rollback;

-- 3. Staff de Club A: puede leer, no modificar.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'STAFF_A_USER_ID', true);
select * from public.courts where club_id = 'CLUB_A_ID'; -- Esperado: filas de Club A.
update public.courts set name = 'No debe cambiar' where id = 'COURT_A_ID'; -- Esperado: UPDATE 0.
rollback;

-- 4. Admin de Club A: puede leer y actualizar la cancha de su club.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ADMIN_A_USER_ID', true);
select * from public.courts where club_id = 'CLUB_A_ID'; -- Esperado: filas de Club A.
update public.courts set name = 'Prueba RLS admin' where id = 'COURT_A_ID'; -- Esperado: UPDATE 1.
rollback;

-- 5. Owner de Club A: puede leer y actualizar la cancha de su club.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'OWNER_A_USER_ID', true);
select * from public.courts where club_id = 'CLUB_A_ID'; -- Esperado: filas de Club A.
update public.courts set active = false where id = 'COURT_A_ID'; -- Esperado: UPDATE 1.
rollback;
