-- Sprint 04: ejecutar manualmente SOLO después de aplicar las migraciones 01–04.
-- Reemplazar CLUB_A_ID, CLUB_B_ID, STAFF_A_USER_ID, ADMIN_A_USER_ID,
-- OTHER_CLUB_USER_ID y PERSON_A_ID. Cada bloque se revierte.

-- 1. Integridad: el mismo jugador no puede tener dos membresías en un club.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ADMIN_A_USER_ID', true);
insert into public.club_memberships (club_id, person_id, status) values ('CLUB_A_ID', 'PERSON_A_ID', 'active');
insert into public.club_memberships (club_id, person_id, status) values ('CLUB_A_ID', 'PERSON_A_ID', 'inactive'); -- Esperado: 23505.
rollback;

-- 1b. Owner/admin puede activar y desactivar una membresía existente sin borrarla.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ADMIN_A_USER_ID', true);
update public.club_memberships set status = 'inactive' where club_id = 'CLUB_A_ID' and person_id = 'PERSON_A_ID'; -- Esperado: UPDATE 1.
update public.club_memberships set status = 'active' where club_id = 'CLUB_A_ID' and person_id = 'PERSON_A_ID'; -- Esperado: UPDATE 1.
rollback;

-- 2. Una reserva no puede vincular una persona de otro club (FK compuesta).
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ADMIN_A_USER_ID', true);
-- insert into public.reservations (club_id, court_id, customer_name, person_id, starts_at, ends_at)
-- values ('CLUB_A_ID', 'COURT_A_ID', 'Nombre histórico', 'PERSON_B_ID', now(), now() + interval '1 hour');
-- Esperado: 23503, si PERSON_B_ID pertenece a CLUB_B_ID.
rollback;

-- 3. Staff del Club A puede crear, modificar y desactivar personas, pero no membresías.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'STAFF_A_USER_ID', true);
insert into public.club_people (club_id, full_name) values ('CLUB_A_ID', 'Prueba staff') returning id;
update public.club_people set active = false where club_id = 'CLUB_A_ID' and full_name = 'Prueba staff'; -- Esperado: UPDATE 1.
-- insert into public.club_memberships (club_id, person_id, status) values ('CLUB_A_ID', 'PERSON_A_ID', 'active');
-- Esperado: error de RLS.
rollback;

-- 4. Otro club no ve ni modifica fichas/membresías del Club A.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'OTHER_CLUB_USER_ID', true);
select * from public.club_people where club_id = 'CLUB_A_ID'; -- Esperado: 0 filas.
update public.club_people set full_name = 'No autorizado' where id = 'PERSON_A_ID'; -- Esperado: UPDATE 0.
select * from public.club_memberships where club_id = 'CLUB_A_ID'; -- Esperado: 0 filas.
rollback;

-- 5. Snapshot: editar club_people.full_name no debe alterar reservations.customer_name.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ADMIN_A_USER_ID', true);
-- Crear una reserva con person_id, editar luego full_name y verificar que customer_name no cambió.
rollback;
