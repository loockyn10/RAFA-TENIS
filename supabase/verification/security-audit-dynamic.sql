-- Sprint 10B — auditoría de seguridad DINÁMICA.
--
-- SOLO para un PostgreSQL LOCAL DESCARTABLE (no Supabase real, no la base remota).
-- Requisitos: base vacía con `local-supabase-stub.sql` y TODAS las migraciones de supabase/migrations ya aplicadas.
-- Corre con un superusuario y simula usuarios con `set local role` + `request.jwt.claim.sub` (equivale a lo que
-- PostgREST hace con un JWT). Crea el esquema `audit` y datos de prueba; nunca ejecutar contra datos reales.
--
-- Cada prueba registra la expectativa SEGURA (regex sobre el resultado). `secure = f` es un hallazgo o una
-- limitación que debe quedar documentada en docs/SECURITY_AUDIT.md.
-- Uso:  psql -d <base_descartable> -f supabase/verification/security-audit-dynamic.sql

\set ON_ERROR_STOP off
set client_min_messages = warning;

drop schema if exists audit cascade;
create schema audit;
create table audit.results (n serial primary key, area text, test text, expected text, actual text, secure boolean);

-- Ejecuta una sentencia como <rol>/<uid> y devuelve 'OK rows=N' o 'ERR sqlstate mensaje'.
create function audit.sql_as(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
declare n bigint; res text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql; get diagnostics n = row_count; res := 'OK rows=' || n;
  exception when others then res := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  return res;
end $$;

-- Igual, pero devuelve el primer valor de la consulta como texto.
create function audit.val_as(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text; res text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v; res := coalesce(v, '<null>');
  exception when others then res := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  return res;
end $$;

-- Registra una prueba: secure = (actual ~ expected).
create function audit.t(p_area text, p_test text, p_expected_regex text, p_actual text) returns void language sql as $$
  insert into audit.results(area, test, expected, actual, secure) values (p_area, p_test, p_expected_regex, left(p_actual, 220), p_actual ~ p_expected_regex);
$$;

-- ===================== Datos de prueba (como superusuario) =====================
insert into auth.users(id, email) values
 ('a0000000-0000-0000-0000-000000000001','ownerA@t'), ('a0000000-0000-0000-0000-000000000002','adminA@t'),
 ('a0000000-0000-0000-0000-000000000003','staffA@t'), ('a0000000-0000-0000-0000-000000000004','ownerB@t'),
 ('a0000000-0000-0000-0000-000000000005','playerA1@t'), ('a0000000-0000-0000-0000-000000000006','playerA2@t'),
 ('a0000000-0000-0000-0000-000000000007','playerB1@t'), ('a0000000-0000-0000-0000-000000000008','nolink@t'),
 ('a0000000-0000-0000-0000-000000000009','dualA@t'), ('a0000000-0000-0000-0000-00000000000a','adminAB@t');
insert into public.clubs(id, name) values ('c0000000-0000-0000-0000-00000000000a','Club A'), ('c0000000-0000-0000-0000-00000000000b','Club B');
insert into public.club_staff(club_id, auth_user_id, role) values
 ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001','owner'),
 ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000002','admin'),
 ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000003','staff'),
 ('c0000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-000000000004','owner'),
 ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000009','staff'),
 ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a','admin'),
 ('c0000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-00000000000a','admin');
insert into public.courts(id, club_id, name, surface, display_order) values
 ('d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','A1','polvo',1),
 ('d0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000a','A2','polvo',2),
 ('d0000000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-00000000000b','B1','polvo',1),
 ('d0000000-0000-0000-0000-0000000000a9','c0000000-0000-0000-0000-00000000000a','A9 sin uso','polvo',9);
insert into public.club_people(id, club_id, full_name, phone, notes) values
 ('e0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','Jugador A1','111','nota privada A1'),
 ('e0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000a','Jugador A2','222','nota privada A2'),
 ('e0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-00000000000a','Persona sin cuenta','333',null),
 ('e0000000-0000-0000-0000-000000000009','c0000000-0000-0000-0000-00000000000a','Dual A','999',null),
 ('e0000000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-00000000000b','Jugador B1','444','nota privada B1');
insert into public.club_memberships(club_id, person_id, status) values
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000001','active'),
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000002','active'),
 ('c0000000-0000-0000-0000-00000000000b','e0000000-0000-0000-0000-0000000000b1','active');
insert into public.club_person_auth_links(club_id, person_id, auth_user_id) values
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000005'),
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000006'),
 ('c0000000-0000-0000-0000-00000000000b','e0000000-0000-0000-0000-0000000000b1','a0000000-0000-0000-0000-000000000007'),
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000009','a0000000-0000-0000-0000-000000000009');
insert into public.club_online_booking_settings(club_id, enabled, updated_by, max_active_reservations, max_advance_days)
 values ('c0000000-0000-0000-0000-00000000000a', true, 'a0000000-0000-0000-0000-000000000001', 2, 30);

-- Cuotas por RPC como ownerA (A1: un pago válido de 200000 y uno ANULADO de 100000; A2 sin pagos)
select audit.val_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$select monthly_amount_cents::text from public.set_club_fee_settings('c0000000-0000-0000-0000-00000000000a', 500000, 10::smallint)$q$);
select audit.val_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$select created_count::text from public.generate_membership_dues('c0000000-0000-0000-0000-00000000000a', date '2026-10-01')$q$);
do $$ declare v_due uuid; v_pay uuid; begin
  select d.id into v_due from public.membership_dues d join public.club_memberships m on m.id = d.membership_id where m.person_id = 'e0000000-0000-0000-0000-000000000001';
  perform set_config('audit.due_a1', v_due::text, false);
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  perform public.record_membership_due_payment('c0000000-0000-0000-0000-00000000000a', v_due, 200000, current_date, 'cash');
  select id into v_pay from public.record_membership_due_payment('c0000000-0000-0000-0000-00000000000a', v_due, 100000, current_date, 'cash');
  perform public.void_membership_due_payment(v_pay, 'error de carga');
  perform set_config('audit.pay_a1', v_pay::text, false);
  reset role;
end $$;

-- Torneo en borrador en A
do $$ declare t uuid; begin
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  select id into t from public.create_tournament('c0000000-0000-0000-0000-00000000000a','Torneo borrador A',null,date '2026-11-01',date '2026-11-02');
  perform set_config('audit.tourn_draft', t::text, false);
  reset role;
end $$;

-- ===================== 1. Escalada de privilegios / membresías =====================
select audit.t('1 roles','jugador no puede insertarse en club_staff (otro club)','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$insert into public.club_staff(club_id, auth_user_id, role) values ('c0000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-000000000005','owner')$q$));
select audit.t('1 roles','jugador no puede insertarse en club_staff (su club, como staff)','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$insert into public.club_staff(club_id, auth_user_id, role) values ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000005','staff')$q$));
select audit.t('1 roles','staff no puede subirse a owner','^(OK rows=0|ERR 42501)', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$update public.club_staff set role = 'owner' where auth_user_id = 'a0000000-0000-0000-0000-000000000003'$q$));
select audit.t('1 roles','admin no puede crear otro owner','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000002'::uuid, $q$insert into public.club_staff(club_id, auth_user_id, role) values ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000008','owner')$q$));
select audit.t('1 roles','owner no puede borrar membresías (club_staff)','^(OK rows=0|ERR 42501)', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$delete from public.club_staff where auth_user_id = 'a0000000-0000-0000-0000-000000000003'$q$));
select audit.t('1 roles','jugador no puede escribir club_person_auth_links','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000008'::uuid, $q$insert into public.club_person_auth_links(club_id, person_id, auth_user_id) values ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000008')$q$));
select audit.t('1 roles','usuario sin vínculo ve 0 filas de club_staff','OK rows=0', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000008'::uuid, $q$select * from public.club_staff$q$));
select audit.t('1 roles','staff solo ve SU propia fila de club_staff (no compañeros)','^1$', audit.val_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$select count(*)::text from public.club_staff$q$));

-- ===================== 2. Privilegios de tabla y columna (GRANT por defecto de Supabase simulado) =====================
select audit.t('2 grants','anon no tiene NINGÚN privilegio sobre tablas públicas','^0$', (select count(*)::text from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'));
select audit.t('2 grants','authenticated sin DELETE/TRUNCATE/TRIGGER/REFERENCES a nivel de tabla (nº de grants)','^0$', (select count(*)::text from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('DELETE','TRUNCATE','TRIGGER','REFERENCES')));
select audit.t('2 grants','authenticated sin INSERT/UPDATE a nivel de TABLA completa (nº de grants)','^0$', (select count(*)::text from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT','UPDATE')));
select audit.t('2 grants','tablas con grants de tabla completa para authenticated (informativo)','.*', (select coalesce(string_agg(distinct table_name, ','), '') from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')));
select audit.t('2 grants','courts: authenticated NO puede actualizar club_id','^false$', has_column_privilege('authenticated','public.courts','club_id','UPDATE')::text);
select audit.t('2 grants','clubs: authenticated NO tiene INSERT','^false$', has_table_privilege('authenticated','public.clubs','INSERT')::text);
select audit.t('2 grants','club_staff: authenticated NO tiene INSERT/UPDATE/DELETE','^false$', (has_table_privilege('authenticated','public.club_staff','INSERT') or has_table_privilege('authenticated','public.club_staff','UPDATE') or has_table_privilege('authenticated','public.club_staff','DELETE'))::text);
select audit.t('2 grants','admin de A y B no puede mover una cancha entre clubes (UPDATE club_id)','^ERR', audit.sql_as('authenticated','a0000000-0000-0000-0000-00000000000a'::uuid, $q$update public.courts set club_id = 'c0000000-0000-0000-0000-00000000000b' where id = 'd0000000-0000-0000-0000-0000000000a9'$q$));
select audit.t('2 grants','owner/admin NO puede cambiar courts.created_at','^ERR', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$update public.courts set created_at = now() - interval '5 years' where id = 'd0000000-0000-0000-0000-000000000001'$q$));

-- ===================== 3. Anon =====================
do $$ declare r record; res text; begin
  for r in select tablename from pg_tables where schemaname = 'public' order by 1 loop
    res := audit.sql_as('anon', null, format('select 1 from public.%I limit 1', r.tablename));
    perform audit.t('3 anon', 'anon no lee public.' || r.tablename, '^ERR 42501', res);
  end loop;
end $$;
select audit.t('3 anon','nº de funciones SECURITY DEFINER de public ejecutables por anon (esperado 0)','^0$', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')));
select audit.t('3 anon','funciones ejecutables por anon (informativo)','.*', (select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')));
select audit.t('3 anon','anon no puede usar el esquema private','^false$', has_schema_privilege('anon','private','USAGE')::text);
select audit.t('3 anon','void_membership_due_payment con UUID inexistente: anon NO obtiene "no existe"','^((?!no existe).)*$', audit.sql_as('anon', null, $q$select public.void_membership_due_payment('00000000-0000-0000-0000-00000000dead','x')$q$));
select audit.t('3 anon','create_canteen_sale: anon rechazado','ERR 42501', audit.sql_as('anon', null, $q$select public.create_canteen_sale('c0000000-0000-0000-0000-00000000000a','[]'::jsonb)$q$));
select audit.t('3 anon','generate_membership_dues: anon rechazado','ERR 42501', audit.sql_as('anon', null, $q$select * from public.generate_membership_dues('c0000000-0000-0000-0000-00000000000a', date '2026-11-01')$q$));
select audit.t('3 anon','create_weekly_reservation_series: anon rechazado','ERR 42501', audit.sql_as('anon', null, $q$select * from public.create_weekly_reservation_series('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000001','x',null,now()+interval '60 day', now()+interval '60 day 1 hour', 1::smallint)$q$));
select audit.t('3 anon','redeem_player_invitation: anon rechazado','ERR', audit.sql_as('anon', null, $q$select public.redeem_player_invitation(repeat('a', 64))$q$));

-- ===================== 4. SECURITY DEFINER: search_path =====================
select audit.t('4 definer','toda función SECURITY DEFINER fija search_path (nº sin fijar)','^0$', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')));
select audit.t('4 definer','search_path solo pg_catalog[, public] (nº que incluyen otro esquema)','^0$', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%' and c !~ '^search_path=("?pg_catalog"?)(, ?"?public"?)?$')));
select audit.t('4 definer','nº de funciones SECURITY DEFINER (informativo)','.*', (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosecdef));

-- ===================== 5. Aislamiento entre clubes =====================
select audit.t('5 clubes','owner B no ve reservas de A','^0$', audit.val_as('authenticated','a0000000-0000-0000-0000-000000000004'::uuid, $q$select count(*)::text from public.reservations where club_id = 'c0000000-0000-0000-0000-00000000000a'$q$));
select audit.t('5 clubes','owner B no ve personas/notas de A','^0$', audit.val_as('authenticated','a0000000-0000-0000-0000-000000000004'::uuid, $q$select count(*)::text from public.club_people where club_id = 'c0000000-0000-0000-0000-00000000000a'$q$));
select audit.t('5 clubes','owner B no ve cuotas de A','^0$', audit.val_as('authenticated','a0000000-0000-0000-0000-000000000004'::uuid, $q$select count(*)::text from public.membership_dues$q$));
select audit.t('5 clubes','owner B no puede emitir cuotas en A','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000004'::uuid, $q$select * from public.generate_membership_dues('c0000000-0000-0000-0000-00000000000a', date '2026-11-01')$q$));
select audit.t('5 clubes','owner B no puede pagar cuota de A (club B + cuota A)','ERR 2', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000004'::uuid, format($q$select * from public.record_membership_due_payment('c0000000-0000-0000-0000-00000000000b', %L, 1000, current_date, 'cash')$q$, current_setting('audit.due_a1'))));
select audit.t('5 clubes','owner B no puede pagar cuota de A (club A + cuota A)','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000004'::uuid, format($q$select * from public.record_membership_due_payment('c0000000-0000-0000-0000-00000000000a', %L, 1000, current_date, 'cash')$q$, current_setting('audit.due_a1'))));
select audit.t('5 clubes','owner B no puede anular pago de A','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000004'::uuid, format($q$select * from public.void_membership_due_payment(%L, 'x')$q$, current_setting('audit.pay_a1'))));
select audit.t('5 clubes','owner B no puede modificar torneo de A','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000004'::uuid, format($q$select * from public.update_tournament(%L, 'hack', null, date '2026-11-01', date '2026-11-02', 'cancelled')$q$, current_setting('audit.tourn_draft'))));
select audit.t('5 clubes','owner B no puede crear categoría en torneo de A','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000004'::uuid, format($q$select * from public.create_tournament_category(%L, 'x', 'singles')$q$, current_setting('audit.tourn_draft'))));
select audit.t('5 clubes','staff A no inserta reserva con cancha de B','^ERR 23(503|514)', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$insert into public.reservations(club_id, court_id, customer_name, starts_at, ends_at) values ('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000b1','x', now()+interval '3 day', now()+interval '3 day 1 hour')$q$));
select audit.t('5 clubes','staff A no inserta reserva en club B','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$insert into public.reservations(club_id, court_id, customer_name, starts_at, ends_at) values ('c0000000-0000-0000-0000-00000000000b','d0000000-0000-0000-0000-0000000000b1','x', now()+interval '3 day', now()+interval '3 day 1 hour')$q$));
select audit.t('5 clubes','staff A no vincula reserva a persona de B','ERR 23503', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$insert into public.reservations(club_id, court_id, customer_name, person_id, starts_at, ends_at) values ('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000001','x','e0000000-0000-0000-0000-0000000000b1', now()+interval '3 day', now()+interval '3 day 1 hour')$q$));

-- ===================== 6. Staff vs owner/admin =====================
select audit.t('6 staff','staff no lee membership_dues','^0$', audit.val_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$select count(*)::text from public.membership_dues$q$));
select audit.t('6 staff','staff no lee pagos de cuotas','^0$', audit.val_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$select count(*)::text from public.membership_due_payments$q$));
select audit.t('6 staff','staff no lee configuración de cuotas','^0$', audit.val_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$select count(*)::text from public.club_fee_settings$q$));
select audit.t('6 staff','staff no configura cuotas','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$select * from public.set_club_fee_settings('c0000000-0000-0000-0000-00000000000a', 1, 1::smallint)$q$));
select audit.t('6 staff','staff no registra pago de cuota','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, format($q$select * from public.record_membership_due_payment('c0000000-0000-0000-0000-00000000000a', %L, 1000, current_date, 'cash')$q$, current_setting('audit.due_a1'))));
select audit.t('6 staff','staff no anula pago de cuota','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, format($q$select * from public.void_membership_due_payment(%L, 'x')$q$, current_setting('audit.pay_a1'))));
select audit.t('6 staff','staff no crea membresías','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$insert into public.club_memberships(club_id, person_id) values ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000003')$q$));
select audit.t('6 staff','staff no cambia membresías','^(OK rows=0|ERR 42501)', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$update public.club_memberships set status = 'inactive'$q$));
select audit.t('6 staff','staff no crea profesores','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$insert into public.club_coaches(club_id, person_id) values ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000003')$q$));
select audit.t('6 staff','staff no crea torneos','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$select * from public.create_tournament('c0000000-0000-0000-0000-00000000000a','x',null,date '2026-11-01',date '2026-11-02')$q$));
select audit.t('6 staff','staff no emite invitaciones','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$select public.create_player_invitation('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000003', now()+interval '1 day')$q$));
select audit.t('6 staff','staff no lista invitaciones','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$select public.list_player_invitations('c0000000-0000-0000-0000-00000000000a')$q$));
select audit.t('6 staff','staff no cambia reglas de reservas online','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$select public.set_online_booking_settings('c0000000-0000-0000-0000-00000000000a', true, time '07:00', time '23:00', 7::smallint, array[60]::smallint[], 2::smallint, 120::smallint)$q$));
select audit.t('6 staff','staff no edita productos de cantina','^(OK rows=0|ERR 42501)', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$update public.canteen_products set sale_price_cents = 1$q$));
select audit.t('6 staff','staff no crea categorías de cantina','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$insert into public.canteen_categories(club_id, name) values ('c0000000-0000-0000-0000-00000000000a','x')$q$));
select audit.t('6 staff','staff inserta reserva tipo lesson directo -> bloqueado','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$insert into public.reservations(club_id, court_id, starts_at, ends_at, status, occupation_type) values ('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000001', now()+interval '4 day', now()+interval '4 day 1 hour','confirmed','lesson')$q$));
select audit.t('6 staff','staff inserta reserva tipo tournament_match directo -> bloqueado','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$insert into public.reservations(club_id, court_id, starts_at, ends_at, status, occupation_type) values ('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000001', now()+interval '4 day', now()+interval '4 day 1 hour','confirmed','tournament_match')$q$));
select audit.t('6 staff','staff crea BLOQUEOS (decisión de producto D008; registrar)','^ERR', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$insert into public.reservations(club_id, court_id, starts_at, ends_at, status, occupation_type, block_reason) values ('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000002', now()+interval '40 day', now()+interval '40 day 1 hour','active','block','mantenimiento')$q$));

-- ===================== 7. Jugadores =====================
select audit.t('7 jugador','jugador A1 no lee reservations directo','^0$', audit.val_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select count(*)::text from public.reservations$q$));
select audit.t('7 jugador','jugador A1 no lee club_people directo','^0$', audit.val_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select count(*)::text from public.club_people$q$));
select audit.t('7 jugador','jugador A1 no lee membership_dues directo','^0$', audit.val_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select count(*)::text from public.membership_dues$q$));
select audit.t('7 jugador','jugador A1 no lee canteen_sales directo','^0$', audit.val_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select count(*)::text from public.canteen_sales$q$));
select audit.t('7 jugador','jugador A1 no lee tournaments directo','^0$', audit.val_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select count(*)::text from public.tournaments$q$));
select audit.t('7 jugador','jugador no modifica su membresía','^(OK rows=0|ERR 42501)', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$update public.club_memberships set status = 'active'$q$));
select audit.t('7 jugador','jugador no edita club_people directo (otra persona)','^(OK rows=0|ERR 42501)', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$update public.club_people set full_name = 'hack' where id = 'e0000000-0000-0000-0000-000000000002'$q$));
select audit.t('7 jugador','jugador no inserta bloqueo','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$insert into public.reservations(club_id, court_id, starts_at, ends_at, status, occupation_type, block_reason) values ('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000002', now()+interval '40 day', now()+interval '40 day 1 hour','active','block','x')$q$));
select audit.t('7 jugador','jugador no usa RPC admin: series de reservas','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select * from public.create_weekly_reservation_series('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000001','x',null,now()+interval '50 day', now()+interval '50 day 1 hour', 1::smallint)$q$));
select audit.t('7 jugador','jugador no crea clase','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select * from public.create_tennis_lesson('c0000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'd0000000-0000-0000-0000-000000000001', now()+interval '50 day', now()+interval '50 day 1 hour','individual',1::smallint)$q$));
select audit.t('7 jugador','jugador no crea torneo','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select * from public.create_tournament('c0000000-0000-0000-0000-00000000000a','x',null,date '2026-11-01',date '2026-11-02')$q$));
select audit.t('7 jugador','jugador no registra pago de cuota','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, format($q$select * from public.record_membership_due_payment('c0000000-0000-0000-0000-00000000000a', %L, 1000, current_date, 'cash')$q$, current_setting('audit.due_a1'))));
select audit.t('7 jugador','jugador no anula pagos','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, format($q$select * from public.void_membership_due_payment(%L, 'x')$q$, current_setting('audit.pay_a1'))));
select audit.t('7 jugador','jugador no usa cantina','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select public.create_canteen_sale('c0000000-0000-0000-0000-00000000000a','[]'::jsonb, null, 'cash')$q$));
select audit.t('7 jugador','jugador no emite invitaciones','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select public.create_player_invitation('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000003', now()+interval '1 day')$q$));
select audit.t('7 jugador','jugador no cambia reglas online','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select public.set_online_booking_settings('c0000000-0000-0000-0000-00000000000a', true, time '00:00', time '23:59', 90::smallint, array[1]::smallint[], 20::smallint, 0::smallint)$q$));
select audit.t('7 jugador','jugador A1 solo ve SUS cuotas (1 cuota, no las de A2)','^1$', audit.val_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select jsonb_array_length(public.player_membership_dues('c0000000-0000-0000-0000-00000000000a'))::text$q$));
select audit.t('7 jugador','jugador A1 no consulta cuotas en club B','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select public.player_membership_dues('c0000000-0000-0000-0000-00000000000b')$q$));
select audit.t('7 jugador','jugador A1 no consulta perfil de club B','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select public.player_profile('c0000000-0000-0000-0000-00000000000b')$q$));
select audit.t('7 jugador','jugador A1 no consulta torneos de club B','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select public.player_tournaments('c0000000-0000-0000-0000-00000000000b')$q$));
select audit.t('7 jugador','jugador A1 no consulta reservas de club B','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select public.player_reservations('c0000000-0000-0000-0000-00000000000b')$q$));
select audit.t('7 jugador','jugador A1 no actualiza perfil en club B','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select public.update_player_profile('c0000000-0000-0000-0000-00000000000b','x',null,null)$q$));
select audit.t('7 jugador','paid_cents del portal EXCLUYE pagos anulados (pagado real = 200000)','"paid_cents": 200000', audit.val_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select public.player_membership_dues('c0000000-0000-0000-0000-00000000000a')::text$q$));
select audit.t('7 jugador','portal no expone notas/teléfono de OTRAS personas (perfil+disponibilidad+torneos)','^false$', audit.val_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select ((public.player_profile('c0000000-0000-0000-0000-00000000000a')::text || public.player_court_availability('c0000000-0000-0000-0000-00000000000a', current_date)::text || public.player_tournaments('c0000000-0000-0000-0000-00000000000a')::text) ~ '(nota privada A2|222|Jugador A2)')::text$q$));
select audit.t('7 jugador','player_tournaments NO muestra torneos en borrador','^false$', audit.val_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, $q$select (public.player_tournaments('c0000000-0000-0000-0000-00000000000a')::text like '%Torneo borrador A%')::text$q$));
select audit.t('7 jugador','usuario sin vínculo: player_access_context vacío','^\[\]$', audit.val_as('authenticated','a0000000-0000-0000-0000-000000000008'::uuid, $q$select public.player_access_context()::text$q$));
select audit.t('7 jugador','usuario sin vínculo: no consulta disponibilidad','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000008'::uuid, $q$select public.player_court_availability('c0000000-0000-0000-0000-00000000000a', current_date)$q$));
select audit.t('7 jugador','usuario sin vínculo: no lee ajustes online','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000008'::uuid, $q$select public.get_online_booking_settings('c0000000-0000-0000-0000-00000000000a')$q$));

-- ===================== 8. Reservas online / agenda =====================
select set_config('audit.d1', ((now() at time zone 'America/Argentina/Buenos_Aires')::date + 1)::text, false);
select audit.t('8 reservas','jugador A1 reserva 10:00-11:00 mañana (permitido)','^OK', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, format($q$select public.create_player_reservation('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000001', (%L||' 10:00')::timestamp at time zone 'America/Argentina/Buenos_Aires', 60::smallint)$q$, current_setting('audit.d1'))));
select set_config('audit.res_a1', (select id::text from public.reservations where person_id = 'e0000000-0000-0000-0000-000000000001' and status = 'confirmed' order by created_at limit 1), false);
select audit.t('8 reservas','solape lo rechaza la exclusión GiST (23P01)','ERR 23P01', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000006'::uuid, format($q$select public.create_player_reservation('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000001', (%L||' 10:30')::timestamp at time zone 'America/Argentina/Buenos_Aires', 60::smallint)$q$, current_setting('audit.d1'))));
select audit.t('8 reservas','turnos contiguos permitidos (11:00-12:00 tras 10:00-11:00)','^OK', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000006'::uuid, format($q$select public.create_player_reservation('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000001', (%L||' 11:00')::timestamp at time zone 'America/Argentina/Buenos_Aires', 60::smallint)$q$, current_setting('audit.d1'))));
select audit.t('8 reservas','inicio fuera de grilla (10:07 en otra cancha) se RECHAZA','^ERR', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, format($q$select public.create_player_reservation('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000002', (%L||' 10:07')::timestamp at time zone 'America/Argentina/Buenos_Aires', 60::smallint)$q$, current_setting('audit.d1'))));
select audit.t('8 reservas','límite de reservas activas (max 2) rechaza la tercera','ERR 22023', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, format($q$select public.create_player_reservation('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000002', (%L||' 15:00')::timestamp at time zone 'America/Argentina/Buenos_Aires', 60::smallint)$q$, current_setting('audit.d1'))));
select audit.t('8 reservas','duración no habilitada (45) rechazada','ERR 22023', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000006'::uuid, format($q$select public.create_player_reservation('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000002', (%L||' 16:00')::timestamp at time zone 'America/Argentina/Buenos_Aires', 45::smallint)$q$, current_setting('audit.d1'))));
select audit.t('8 reservas','cancha de otro club rechazada','ERR 23503', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000006'::uuid, format($q$select public.create_player_reservation('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000b1', (%L||' 16:00')::timestamp at time zone 'America/Argentina/Buenos_Aires', 60::smallint)$q$, current_setting('audit.d1'))));
select audit.t('8 reservas','club B (reservas online sin habilitar) rechaza a jugador B1','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000007'::uuid, format($q$select public.create_player_reservation('c0000000-0000-0000-0000-00000000000b','d0000000-0000-0000-0000-0000000000b1', (%L||' 16:00')::timestamp at time zone 'America/Argentina/Buenos_Aires', 60::smallint)$q$, current_setting('audit.d1'))));
select audit.t('8 reservas','A2 no puede cancelar la reserva de A1','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000006'::uuid, format($q$select public.cancel_player_reservation(%L)$q$, current_setting('audit.res_a1'))));
select audit.t('8 reservas','jugador sin vínculo no puede cancelar reservas ajenas','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000008'::uuid, format($q$select public.cancel_player_reservation(%L)$q$, current_setting('audit.res_a1'))));
select audit.t('8 reservas','jugador de B no puede cancelar reserva de A','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000007'::uuid, format($q$select public.cancel_player_reservation(%L)$q$, current_setting('audit.res_a1'))));
-- Reserva de mostrador (sin person_id) creada por el usuario DUAL (staff + jugador vinculado en A)
insert into public.reservations(club_id, court_id, customer_name, starts_at, ends_at, created_by)
  select 'c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000002','Cliente de mostrador', ((current_setting('audit.d1')||' 18:00')::timestamp at time zone 'America/Argentina/Buenos_Aires'), ((current_setting('audit.d1')||' 19:00')::timestamp at time zone 'America/Argentina/Buenos_Aires'), 'a0000000-0000-0000-0000-000000000009';
select audit.t('8 reservas','cancel_player_reservation NO cancela reservas sin person_id aunque created_by coincida (NULL <> uuid)','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000009'::uuid, format($q$select public.cancel_player_reservation(%L)$q$, (select id::text from public.reservations where customer_name = 'Cliente de mostrador'))));
select audit.t('8 reservas','jugador A1 cancela su propia reserva','^OK', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, format($q$select public.cancel_player_reservation(%L)$q$, current_setting('audit.res_a1'))));
select audit.t('8 reservas','cancelar libera el horario (A2 reserva 10:00-11:00 tras la cancelación de A1)','^OK', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000006'::uuid, format($q$select public.create_player_reservation('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000001', (%L||' 10:00')::timestamp at time zone 'America/Argentina/Buenos_Aires', 60::smallint)$q$, current_setting('audit.d1'))));
insert into public.reservations(club_id, court_id, starts_at, ends_at, status, occupation_type, block_reason, created_by)
  values ('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000002', ((current_setting('audit.d1')||' 20:00')::timestamp at time zone 'America/Argentina/Buenos_Aires'), ((current_setting('audit.d1')||' 21:00')::timestamp at time zone 'America/Argentina/Buenos_Aires'), 'active','block','torneo','a0000000-0000-0000-0000-000000000001');
select audit.t('8 reservas','reserva online sobre bloqueo rechazada (GiST)','ERR 23P01', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, format($q$select public.create_player_reservation('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000002', (%L||' 20:00')::timestamp at time zone 'America/Argentina/Buenos_Aires', 60::smallint)$q$, current_setting('audit.d1'))));
select audit.t('8 reservas','el error de solape no incluye identidad de terceros','^((?!Jugador A|Cliente de mostrador|customer).)*$', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000005'::uuid, format($q$select public.create_player_reservation('c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000002', (%L||' 20:00')::timestamp at time zone 'America/Argentina/Buenos_Aires', 60::smallint)$q$, current_setting('audit.d1'))));

-- ===================== 9. Finanzas =====================
select audit.t('9 finanzas','sobrepago de cuota rechazado','ERR 22023', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, format($q$select * from public.record_membership_due_payment('c0000000-0000-0000-0000-00000000000a', %L, 999999999, current_date, 'cash')$q$, current_setting('audit.due_a1'))));
select audit.t('9 finanzas','pago directo en tabla bloqueado para owner','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, format($q$insert into public.membership_due_payments(club_id, due_id, amount_cents, payment_date, payment_method, created_by) values ('c0000000-0000-0000-0000-00000000000a', %L, 1, current_date, 'cash', 'a0000000-0000-0000-0000-000000000001')$q$, current_setting('audit.due_a1'))));
select audit.t('9 finanzas','update directo de importe de cuota bloqueado para owner','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$update public.membership_dues set amount_cents = 1$q$));
select audit.t('9 finanzas','update directo de pago bloqueado para owner','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$update public.membership_due_payments set amount_cents = 1$q$));
select audit.t('9 finanzas','delete directo de pago bloqueado','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$delete from public.membership_due_payments$q$));
select audit.t('9 finanzas','anular dos veces un pago falla','ERR 22023', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, format($q$select * from public.void_membership_due_payment(%L, 'otra vez')$q$, current_setting('audit.pay_a1'))));
select audit.t('9 finanzas','cuota duplicada para el mismo período rechazada','ERR 23505', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$select * from public.create_individual_membership_due('c0000000-0000-0000-0000-00000000000a', (select id from public.club_memberships where person_id = 'e0000000-0000-0000-0000-000000000001'), date '2026-10-01')$q$));
select audit.t('9 finanzas','pago con fecha en el futuro lejano (2099) se rechaza','ERR', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, format($q$select * from public.record_membership_due_payment('c0000000-0000-0000-0000-00000000000a', %L, 1000, date '2099-01-01', 'cash')$q$, current_setting('audit.due_a1'))));
-- Cantina
do $$ begin
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  insert into public.canteen_categories(club_id, name) values ('c0000000-0000-0000-0000-00000000000a','Bebidas');
  insert into public.canteen_products(club_id, category_id, name, sale_price_cents) select club_id, id, 'Agua', 100000 from public.canteen_categories where name = 'Bebidas';
  reset role;
end $$;
insert into public.canteen_categories(club_id, name) values ('c0000000-0000-0000-0000-00000000000b','Bebidas B');
insert into public.canteen_products(club_id, category_id, name, sale_price_cents) select club_id, id, 'Agua B', 5 from public.canteen_categories where name = 'Bebidas B';
select set_config('audit.prod_a', (select id::text from public.canteen_products where name = 'Agua'), false);
select set_config('audit.prod_b', (select id::text from public.canteen_products where name = 'Agua B'), false);
select audit.t('9 cantina','staff vende producto de A (permitido)','^OK', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, format($q$select public.create_canteen_sale('c0000000-0000-0000-0000-00000000000a', jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 2)), null, 'cash', '11111111-1111-1111-1111-111111111111')$q$, current_setting('audit.prod_a'))));
select audit.t('9 cantina','venta con producto de OTRO club rechazada','ERR 23503', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, format($q$select public.create_canteen_sale('c0000000-0000-0000-0000-00000000000a', jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1)), null, 'cash')$q$, current_setting('audit.prod_b'))));
select audit.t('9 cantina','venta pendiente con persona de OTRO club rechazada','ERR 23503', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, format($q$select public.create_canteen_sale('c0000000-0000-0000-0000-00000000000a', jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1)), 'e0000000-0000-0000-0000-0000000000b1')$q$, current_setting('audit.prod_a'))));
select audit.t('9 cantina','owner B no vende en club A','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000004'::uuid, format($q$select public.create_canteen_sale('c0000000-0000-0000-0000-00000000000a', jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1)), null, 'cash')$q$, current_setting('audit.prod_a'))));
select audit.t('9 cantina','reintento idempotente con MISMO payload devuelve la misma venta','^OK', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, format($q$select public.create_canteen_sale('c0000000-0000-0000-0000-00000000000a', jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 2)), null, 'cash', '11111111-1111-1111-1111-111111111111')$q$, current_setting('audit.prod_a'))));
select audit.t('9 cantina','misma client_request_id con OTRO payload NO devuelve en silencio la venta vieja','^ERR', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, format($q$select public.create_canteen_sale('c0000000-0000-0000-0000-00000000000a', jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 9)), null, 'cash', '11111111-1111-1111-1111-111111111111')$q$, current_setting('audit.prod_a'))));
select audit.t('9 cantina','cantidad absurda (2147483647 unidades) rechazada o acotada','^ERR', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, format($q$select public.create_canteen_sale('c0000000-0000-0000-0000-00000000000a', jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 2147483647)), null, 'cash')$q$, current_setting('audit.prod_a'))));
update public.canteen_products set sale_price_cents = 999999 where id = current_setting('audit.prod_a')::uuid;
select audit.t('9 cantina','precio histórico: el ítem vendido conserva 100000 tras subir el precio','^100000$', (select unit_price_cents::text from public.canteen_sale_items i join public.canteen_sales s on s.id = i.sale_id where s.client_request_id = '11111111-1111-1111-1111-111111111111'));
select audit.t('9 cantina','staff no puede anular venta','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$select public.void_canteen_sale((select id from public.canteen_sales limit 1), 'x')$q$));
select audit.t('9 cantina','staff no puede cambiar el precio directo','^(OK rows=0|ERR 42501)', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$update public.canteen_products set sale_price_cents = 1$q$));
select audit.t('9 cantina','owner cambia el precio de un producto de su club (permitido)','^OK rows=1', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, format($q$update public.canteen_products set sale_price_cents = 120000 where id = %L$q$, current_setting('audit.prod_a'))));
select audit.t('9 cantina','owner A no puede cambiar precio de producto de B','^(OK rows=0|ERR 42501)', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, format($q$update public.canteen_products set sale_price_cents = 1 where id = %L$q$, current_setting('audit.prod_b'))));
select audit.t('9 cantina','admin de A y B no mueve producto de A a B (club_id)','^ERR', audit.sql_as('authenticated','a0000000-0000-0000-0000-00000000000a'::uuid, format($q$update public.canteen_products set club_id = 'c0000000-0000-0000-0000-00000000000b' where id = %L$q$, current_setting('audit.prod_a'))));
select audit.t('9 cantina','items de venta inmutables para owner','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$update public.canteen_sale_items set unit_price_cents = 1$q$));
select audit.t('9 cantina','no se puede anular una venta con pagos','ERR 22023', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$select public.void_canteen_sale((select id from public.canteen_sales limit 1), 'x')$q$));

-- ===================== 10. Invitaciones =====================
select set_config('audit.inv', (audit.val_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$select (public.create_player_invitation('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000003', now()+interval '2 day'))->>'code'$q$)), false);
select audit.t('10 invit','owner emite invitación (código de 64 hex)','^[0-9a-f]{64}$', current_setting('audit.inv'));
select audit.t('10 invit','la tabla guarda solo el hash (nº de filas con token_hash = código)','^0$', (select count(*)::text from public.player_invitations where token_hash = current_setting('audit.inv')));
select audit.t('10 invit','redeem_player_invitation FUNCIONA (usa digest sin esquema)','^OK', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000008'::uuid, format($q$select public.redeem_player_invitation(%L)$q$, current_setting('audit.inv'))));
select audit.t('10 invit','redeem: código inválido da mensaje genérico','No pudimos validar', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000008'::uuid, $q$select public.redeem_player_invitation(repeat('a', 64))$q$));
select audit.t('10 invit','staff no revoca invitaciones','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$select public.revoke_player_invitation((select id from public.player_invitations limit 1))$q$));
select audit.t('10 invit','owner B no revoca invitaciones de A','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000004'::uuid, $q$select public.revoke_player_invitation((select id from public.player_invitations limit 1))$q$));
select audit.t('10 invit','owner B no emite invitación para persona de A','ERR 42501', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000004'::uuid, $q$select public.create_player_invitation('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000003', now()+interval '1 day')$q$));
select audit.t('10 invit','owner A no emite invitación con persona de B','ERR 23503', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$select public.create_player_invitation('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-0000000000b1', now()+interval '1 day')$q$));
select audit.t('10 invit','vencimiento sin tope (100 años) se RECHAZA','^ERR', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$select public.create_player_invitation('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000009', now()+interval '100 years')$q$));

-- ===================== 11. Torneos =====================
select audit.t('11 torneos','anon no ejecuta RPC de torneos (revocado en 10A)','^false$', has_function_privilege('anon','public.generate_tournament_fixture(uuid)','EXECUTE')::text);
select audit.t('11 torneos','owner A no inscribe persona de B','^ERR', audit.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, format($q$select * from public.create_tournament_entry((select id from public.create_tournament_category(%L,'Cat','singles')), array['e0000000-0000-0000-0000-0000000000b1']::uuid[])$q$, current_setting('audit.tourn_draft'))));

-- ===================== Resultado =====================
\echo
\echo '======== RESUMEN POR ÁREA (ok = expectativa segura cumplida; hallazgos = no cumplida) ========'
select area, count(*) filter (where secure) as ok, count(*) filter (where not secure) as hallazgos from audit.results group by area order by area;
\echo
\echo '======== PRUEBAS QUE NO CUMPLEN LA EXPECTATIVA SEGURA ========'
select n, area, test, left(actual, 170) as actual from audit.results where not secure order by n;
