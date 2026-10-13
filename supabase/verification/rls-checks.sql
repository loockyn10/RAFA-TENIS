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
