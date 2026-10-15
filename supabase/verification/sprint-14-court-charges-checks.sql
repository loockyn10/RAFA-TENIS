-- Sprint 14 — verificaciones de cobros de cancha/iluminación y cuenta corriente contra PostgreSQL REAL y DESCARTABLE.
-- Requiere local-supabase-stub.sql y las migraciones 01 … 20261014070000 ya aplicadas. NO es Supabase. Corre con superusuario.
-- Los importes de tarifa son VALORES DE PRUEBA (no tarifas del club). Importes en centavos.
\set ON_ERROR_STOP on
set client_min_messages = warning;
drop schema if exists t14 cascade;
create schema t14;
create table t14.results (n serial primary key, area text, test text, expected text, actual text, ok boolean);

create function t14.sa(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
declare n bigint; res text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin execute p_sql; get diagnostics n = row_count; res := 'OK rows=' || n;
  exception when others then res := 'ERR ' || sqlstate || ' ' || sqlerrm; end;
  reset role;
  return res;
end $$;
create function t14.va(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text; res text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin execute p_sql into v; res := coalesce(v, '<null>');
  exception when others then res := 'ERR ' || sqlstate || ' ' || sqlerrm; end;
  reset role;
  return res;
end $$;
create function t14.t(p_area text, p_test text, p_expected_regex text, p_actual text) returns void language sql as $$
  insert into t14.results(area, test, expected, actual, ok) values (p_area, p_test, p_expected_regex, left(p_actual, 240), p_actual ~ p_expected_regex);
$$;
create function t14.auth(p_name text) returns uuid language sql immutable as $$
  select case p_name
    when 'ownerA' then 'a0000000-0000-0000-0000-000000000001' when 'adminA' then 'a0000000-0000-0000-0000-000000000002'
    when 'staffA' then 'a0000000-0000-0000-0000-000000000003' when 'ownerB' then 'a0000000-0000-0000-0000-000000000004'
    when 'player' then 'a0000000-0000-0000-0000-000000000005'
  end::uuid $$;
create function t14.vau(p_user text, p_sql text) returns text language sql as $$ select t14.va('authenticated', t14.auth(p_user), p_sql) $$;
create function t14.q(p_sql text) returns text language plpgsql as $$ declare v text; begin execute p_sql into v; return coalesce(v, '<null>'); end $$;
create function t14.k(n int) returns uuid language sql immutable as $$ select ('f4000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create table t14.snap (name text primary key, val text);
create function t14.put(p_name text, p_val text) returns text language sql as $$ insert into t14.snap values (p_name, p_val) on conflict (name) do update set val = excluded.val returning val $$;
create function t14.get(p_name text) returns text language sql as $$ select val from t14.snap where name = p_name $$;

\set CA '''c0000000-0000-0000-0000-00000000000a'''
\set CB '''c0000000-0000-0000-0000-00000000000b'''

-- ===================== Datos =====================
insert into auth.users(id, email) values
 ('a0000000-0000-0000-0000-000000000001','ownerA@t'), ('a0000000-0000-0000-0000-000000000002','adminA@t'),
 ('a0000000-0000-0000-0000-000000000003','staffA@t'), ('a0000000-0000-0000-0000-000000000004','ownerB@t'),
 ('a0000000-0000-0000-0000-000000000005','player@t');
insert into public.clubs(id, name) values ('c0000000-0000-0000-0000-00000000000a','Club A'), ('c0000000-0000-0000-0000-00000000000b','Club B');
insert into public.club_staff(club_id, auth_user_id, role) values
 ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001','owner'),
 ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000002','admin'),
 ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000003','staff'),
 ('c0000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-000000000004','owner');
insert into public.courts(id, club_id, name, surface, display_order) values
 ('d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','Cancha 1','polvo',1),
 ('d0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000a','Cancha 2','polvo',2),
 ('d0000000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-00000000000b','B1','polvo',1);
insert into public.club_people(id, club_id, full_name, active) values
 ('e0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','Socio Uno', true),
 ('e0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000a','No Socio Dos', true),
 ('e0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-00000000000a','Dado de baja', false),
 ('e0000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-00000000000a','Socio Cuatro', true),
 ('e0000000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-00000000000b','Persona B', true);
insert into public.club_memberships(club_id, person_id, status) values
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000001','active'),
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000004','active');
-- Reservas: R1..R12 en la cancha 1 (días distintos), duraciones variadas. Hora local -03.
create function t14.res(p_n int, p_start text, p_minutes int, p_type text default 'reservation', p_status text default 'confirmed') returns uuid language plpgsql as $$
declare v_id uuid := ('f5000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid;
begin
  set local session_replication_role = replica;  -- los guard-triggers de clases/torneos no aplican al sembrar datos de prueba
  insert into public.reservations(id, club_id, court_id, customer_name, starts_at, ends_at, status, occupation_type, block_reason, created_by)
  values (v_id, 'c0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001',
    case when p_type = 'reservation' then 'Cliente ' || p_n end, (p_start || ' -03')::timestamptz, (p_start || ' -03')::timestamptz + make_interval(mins => p_minutes),
    p_status, p_type, case when p_type = 'block' then 'Mantenimiento' end, 'a0000000-0000-0000-0000-000000000001');
  set local session_replication_role = origin;
  return v_id;
end $$;
select t14.res(1, '2026-10-20 18:00', 60);
select t14.res(2, '2026-10-21 18:00', 60);
select t14.res(3, '2026-10-22 18:00', 90);
select t14.res(4, '2026-10-23 18:00', 100);
select t14.res(5, '2026-10-24 18:00', 60);
select t14.res(6, '2026-10-25 18:00', 60, 'block', 'active');
select t14.res(7, '2026-10-26 18:00', 60, 'lesson');
select t14.res(8, '2026-10-27 18:00', 60, 'tournament_match');
select t14.res(9, '2026-10-28 18:00', 60, 'reservation', 'cancelled');
select t14.res(10, '2026-10-29 18:00', 60);
select t14.res(11, '2026-10-30 18:00', 45);
select t14.res(12, '2026-10-31 18:00', 60);
select t14.res(13, '2026-11-01 18:00', 60);
select t14.res(14, '2026-11-02 18:00', 60);
select t14.res(15, '2026-11-03 18:00', 60);
select t14.res(16, '2026-11-04 18:00', 60);
select t14.res(17, '2026-11-05 18:00', 60);
select t14.res(18, '2026-11-06 18:00', 60);
-- reserva del club B
insert into public.reservations(id, club_id, court_id, customer_name, starts_at, ends_at, created_by)
values ('f5000000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-00000000000b','d0000000-0000-0000-0000-0000000000b1','Cliente B','2026-10-20 18:00 -03','2026-10-20 19:00 -03','a0000000-0000-0000-0000-000000000004');

create function t14.r(n int) returns uuid language sql immutable as $$ select ('f5000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function t14.P(n int) returns uuid language sql immutable as $$ select ('e0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
-- create_court_charge(user, reservation n, person n, rental, lighting, key, minutes, rental_override, light_override, reason) -> id | ERR
create function t14.charge(p_user text, p_res uuid, p_person uuid, p_rent boolean, p_light boolean, p_key int,
  p_minutes int default null, p_rov bigint default null, p_lov bigint default null, p_reason text default null, p_club text default 'c0000000-0000-0000-0000-00000000000a') returns text language sql as $$
  select t14.vau(p_user, format('select (public.create_court_charge(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L)).id::text', p_club::uuid, p_res, p_person, p_rent, p_light, t14.k(p_key), p_minutes, p_rov, p_lov, p_reason)) $$;
create function t14.pay(p_user text, p_charge uuid, p_amount bigint, p_key int, p_method text default 'cash', p_ref text default null, p_club text default 'c0000000-0000-0000-0000-00000000000a') returns text language sql as $$
  select t14.vau(p_user, format('select (public.record_court_charge_payment(%L, %L, %L, date ''2026-10-20'', %L, %L, %L, null)).id::text', p_club::uuid, p_charge, p_amount, p_method, t14.k(p_key), p_ref)) $$;
create function t14.paid(p_charge uuid) returns bigint language sql security definer as $$ select coalesce(sum(amount_cents),0) from public.court_charge_payments where charge_id = p_charge and voided_at is null $$;
grant usage on schema t14 to authenticated;
grant execute on all functions in schema t14 to authenticated;
\set uuidre '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

-- =============================== 0. Estructura y privilegios ===============================
select t14.t('0 estructura','las 6 RPC existen, son SECURITY DEFINER con search_path fijo','^6$', t14.q($q$select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('set_court_rate_settings','create_court_charge','void_court_charge','record_court_charge_payment','void_court_charge_payment','get_person_account') and p.prosecdef and p.proconfig @> array['search_path=pg_catalog, public']$q$));
select t14.t('0 estructura','anon y PUBLIC sin EXECUTE; authenticated con EXECUTE (6 RPC)','^0\|6$', t14.q($q$select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('set_court_rate_settings','create_court_charge','void_court_charge','record_court_charge_payment','void_court_charge_payment','get_person_account') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege(0, p.oid, 'execute')))::text || '|' || (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('set_court_rate_settings','create_court_charge','void_court_charge','record_court_charge_payment','void_court_charge_payment','get_person_account') and has_function_privilege('authenticated', p.oid, 'execute'))::text$q$));
select t14.t('0 estructura','las 4 tablas nuevas tienen RLS y anon/authenticated solo SELECT','^4\|0\|4$', t14.q($q$select (select count(*) from pg_class where relname in ('club_court_rate_settings','club_court_rate_history','court_charges','court_charge_payments') and relrowsecurity)::text || '|' || (select count(*) from information_schema.role_table_grants where table_name in ('club_court_rate_settings','club_court_rate_history','court_charges','court_charge_payments') and (grantee='anon' or (grantee='authenticated' and privilege_type <> 'SELECT')))::text || '|' || (select count(*) from information_schema.role_table_grants where table_name in ('club_court_rate_settings','club_court_rate_history','court_charges','court_charge_payments') and grantee='authenticated' and privilege_type='SELECT')::text$q$));

-- =============================== 1. Tarifas ===============================
select t14.t('1 tarifas','sin configuración no hay valores por defecto (0 filas)','^0$', t14.q('select count(*)::text from public.club_court_rate_settings'));
select t14.t('1 tarifas','cargo calculado sin tarifa configurada se rechaza (22023) y no inventa precio','^ERR 22023 .*tarifa de alquiler no está activa',
  t14.charge('ownerA', t14.r(1), t14.P(2), true, false, 1));
select t14.t('1 tarifas','staff NO configura tarifas','^ERR 42501', t14.vau('staffA', format('select public.set_court_rate_settings(%L, 1000000, 400000, true, true)', 'c0000000-0000-0000-0000-00000000000a')));
select t14.t('1 tarifas','owner de B no configura tarifas de A','^ERR 42501', t14.vau('ownerB', format('select public.set_court_rate_settings(%L, 1000000, 400000, true, true)', 'c0000000-0000-0000-0000-00000000000a')));
select t14.t('1 tarifas','activar sin precio se rechaza','^ERR 22023', t14.vau('ownerA', format('select public.set_court_rate_settings(%L, null, 400000, true, true)', 'c0000000-0000-0000-0000-00000000000a')));
select t14.t('1 tarifas','precio cero/negativo se rechaza','^ERR 22023', t14.vau('ownerA', format('select public.set_court_rate_settings(%L, 0, 400000, true, true)', 'c0000000-0000-0000-0000-00000000000a')));
select t14.t('1 tarifas','redondeo hacia arriba exige bloque 15/30/60','^ERR 22023', t14.vau('ownerA', format('select public.set_court_rate_settings(%L, 1000000, 400000, true, true, ''rounded_up'', 20::smallint)', 'c0000000-0000-0000-0000-00000000000a')));
-- Tarifa de PRUEBA v1: alquiler 10.000/h, luz 4.000/h, cálculo exacto.
select t14.t('1 tarifas','owner configura tarifa v1 (valores de prueba)','^1000000\|400000\|exact$',
  t14.vau('ownerA', format('select rental_hour_cents || ''|'' || lighting_hour_cents || ''|'' || billing_mode from public.set_court_rate_settings(%L, 1000000, 400000, true, true)', 'c0000000-0000-0000-0000-00000000000a')));
select t14.t('1 tarifas','admin guarda la misma configuración: devuelve la vigente (sin cambios)','^1000000$', t14.vau('adminA', format('select rental_hour_cents::text from public.set_court_rate_settings(%L, 1000000, 400000, true, true)', 'c0000000-0000-0000-0000-00000000000a')));
select t14.t('1 tarifas','historial: 1 fila tras la configuración y el guardado idéntico','^1$', t14.q('select count(*)::text from public.club_court_rate_history'));

-- =============================== 2. Casos de cobro ===============================
-- Antes de cobrar: crear reservas no generó deuda alguna.
select t14.t('2 cargos','crear reservas NO genera cargos automáticos','^0$', t14.q('select count(*)::text from public.court_charges'));
-- 1) Socio sin alquiler (solo luz, 60 min): 4.000 -> 400000
select t14.put('C1', t14.charge('ownerA', t14.r(1), t14.P(1), false, true, 11));
select t14.t('2 cargos','socio con iluminación: se registra y devuelve id',:'uuidre', t14.get('C1'));
select t14.t('2 cargos','socio con iluminación: member, alquiler 0, luz 400000, total 400000, tarifa congelada','^member\|0\|400000\|400000\|400000\|60$',
  t14.q(format($q$select member_status||'|'||rental_cents||'|'||lighting_cents||'|'||total_cents||'|'||lighting_hour_cents_snapshot||'|'||billable_minutes from public.court_charges where id='%s'$q$, t14.get('C1'))));
select t14.t('2 cargos','socio SIN alquiler ni luz: se rechaza (nada que cobrar)','^ERR 22023', t14.charge('ownerA', t14.r(2), t14.P(1), false, false, 12));
-- 3) No socio con alquiler (60 min): 10.000
select t14.put('C2', t14.charge('ownerA', t14.r(2), t14.P(2), true, false, 13));
select t14.t('2 cargos','no socio con alquiler: non_member, 1000000','^non_member\|1000000\|0\|1000000$',
  t14.q(format($q$select member_status||'|'||rental_cents||'|'||lighting_cents||'|'||total_cents from public.court_charges where id='%s'$q$, t14.get('C2'))));
-- 4) No socio con alquiler + luz, duración 90 min exacta: 15.000 + 6.000
select t14.put('C3', t14.charge('adminA', t14.r(3), t14.P(2), true, true, 14));
select t14.t('2 cargos','90 min exactos: alquiler 1500000 + luz 600000 = 2100000 (NO se asumen 2 horas)','^1500000\|600000\|2100000\|90$',
  t14.q(format($q$select rental_cents||'|'||lighting_cents||'|'||total_cents||'|'||billable_minutes from public.court_charges where id='%s'$q$, t14.get('C3'))));
-- Un importe por cancha/tiempo, no por jugadores: no existe parámetro de cantidad de jugadores
select t14.t('2 cargos','el importe no depende de cantidad de jugadores (sin columna ni parámetro)','^0$', t14.q($q$select count(*)::text from information_schema.columns where table_name='court_charges' and column_name ilike '%player%'$q$));
-- 5) Duración variable: minutos a cobrar distintos de la reserva (R4 dura 100; se cobran 75): 12.500
select t14.put('C4', t14.charge('ownerA', t14.r(4), t14.P(2), true, false, 15, 75));
select t14.t('2 cargos','duración a cobrar distinta de la reservada (75 de 100): 1250000','^1250000\|75$',
  t14.q(format($q$select rental_cents||'|'||billable_minutes from public.court_charges where id='%s'$q$, t14.get('C4'))));
-- 6) Ajuste manual autorizado
select t14.t('2 cargos','importe manual SIN motivo se rechaza','^ERR 22023 .*motivo', t14.charge('ownerA', t14.r(5), t14.P(2), true, false, 16, null, 900000));
select t14.put('C5', t14.charge('ownerA', t14.r(5), t14.P(2), true, false, 17, null, 900000, null, 'Acordado con Rafa: mismo precio que el mes pasado'));
select t14.t('2 cargos','ajuste manual: guarda calculado (1000000), final (900000) y motivo','^1000000\|900000\|Acordado',
  t14.q(format($q$select calculated_rental_cents||'|'||rental_cents||'|'||adjustment_reason from public.court_charges where id='%s'$q$, t14.get('C5'))));
select t14.t('2 cargos','importe manual sin tarifa activa también requiere motivo y queda sin cálculo','^ERR 22023',
  t14.charge('ownerA', t14.r(10), t14.P(2), true, false, 18, null, 500000));
-- Reglas de elegibilidad
select t14.t('2 cargos','bloqueo: no se cobra','^ERR 22023 .*Solo las reservas comunes', t14.charge('ownerA', t14.r(6), t14.P(2), true, false, 19));
select t14.t('2 cargos','clase: no se cobra','^ERR 22023 .*Solo las reservas comunes', t14.charge('ownerA', t14.r(7), t14.P(2), true, false, 20));
select t14.t('2 cargos','partido de torneo: no se cobra','^ERR 22023 .*Solo las reservas comunes', t14.charge('ownerA', t14.r(8), t14.P(2), true, false, 21));
select t14.t('2 cargos','reserva cancelada: no se cobra','^ERR 22023 .*cancelada', t14.charge('ownerA', t14.r(9), t14.P(2), true, false, 22));
select t14.t('2 cargos','responsable dado de baja: se rechaza','^ERR 22023 .*baja', t14.charge('ownerA', t14.r(10), t14.P(3), true, false, 23));
select t14.t('2 cargos','segundo cargo vigente sobre la misma reserva (otra clave): se rechaza','^ERR 22023 .*ya tiene un cargo vigente', t14.charge('ownerA', t14.r(1), t14.P(2), true, false, 24));
select t14.t('2 cargos','el responsable puede ser distinto de quien reservó (Cliente 11 → Socio Cuatro)','^'||'[0-9a-f]{8}-', t14.charge('ownerA', t14.r(11), t14.P(4), true, false, 25));
select t14.t('2 cargos','45 min exactos: 750000 (alquiler)','^750000$', t14.q($q$select rental_cents::text from public.court_charges where reservation_id = 'f5000000-0000-0000-0000-000000000011'$q$));

-- Redondeo hacia arriba (bloque 30): 100 min -> 120 min; 75 -> 90.
select t14.t('2 cargos','configura redondeo hacia arriba (bloque 30) — tarifa v2: alquiler 12.000, luz 5.000','^1200000\|rounded_up\|30$',
  t14.vau('ownerA', format('select rental_hour_cents||''|''||billing_mode||''|''||billing_block_minutes from public.set_court_rate_settings(%L, 1200000, 500000, true, true, ''rounded_up'', 30::smallint)', 'c0000000-0000-0000-0000-00000000000a')));
select t14.t('3 historial','historial: 2 filas (v1 y v2)','^2$', t14.q('select count(*)::text from public.club_court_rate_history'));
select t14.put('C6', t14.charge('ownerA', t14.r(12), t14.P(2), true, true, 30, 100));
select t14.t('2 cargos','100 min con bloque 30 => 120 min facturables: alquiler 2400000, luz 1000000','^2400000\|1000000\|rounded_up\|30\|1200000$',
  t14.q(format($q$select rental_cents||'|'||lighting_cents||'|'||billing_mode_snapshot||'|'||billing_block_minutes_snapshot||'|'||rental_hour_cents_snapshot from public.court_charges where id='%s'$q$, t14.get('C6'))));
select t14.t('3 historial','los cargos anteriores NO cambiaron con la tarifa nueva (C1 sigue 400000, C3 sigue 2100000)','^400000\|2100000$',
  t14.q(format($q$select (select total_cents from public.court_charges where id='%s')||'|'||(select total_cents from public.court_charges where id='%s')$q$, t14.get('C1'), t14.get('C3'))));
select t14.t('3 historial','el historial de tarifas es inmodificable (UPDATE)','^55000|ERR 55000', t14.sa('postgres', null, 'update public.club_court_rate_history set rental_hour_cents = 1'));
select t14.t('3 historial','el historial de tarifas es inmodificable (DELETE)','ERR 55000', t14.sa('postgres', null, 'delete from public.club_court_rate_history'));
-- Tarifa desactivada: sin importe manual se rechaza.
select t14.t('1 tarifas','desactivar luz conserva el precio','^500000\|false$', t14.vau('ownerA', format('select lighting_hour_cents||''|''||lighting_enabled from public.set_court_rate_settings(%L, 1200000, 500000, true, false, ''rounded_up'', 30::smallint)', 'c0000000-0000-0000-0000-00000000000a')));
select t14.t('1 tarifas','luz desactivada sin importe manual: se rechaza','^ERR 22023 .*iluminación no está activa', t14.charge('ownerA', t14.r(13), t14.P(1), false, true, 31));
select t14.t('1 tarifas','luz desactivada con importe manual y motivo: se acepta (autorizado)','^[0-9a-f]{8}-', t14.charge('ownerA', t14.r(13), t14.P(1), false, true, 32, null, null, 300000, 'Luz acordada a mano'));
select t14.t('1 tarifas','reactivar luz','^true$', t14.vau('ownerA', format('select lighting_enabled::text from public.set_court_rate_settings(%L, 1200000, 500000, true, true, ''rounded_up'', 30::smallint)', 'c0000000-0000-0000-0000-00000000000a')));

-- =============================== 4. Idempotencia del cargo ===============================
select t14.t('4 idempotencia','reintento del cargo (misma clave y contenido) devuelve el MISMO id','^(t|true)$',
  t14.q(format($q$select (%L = %L)::text$q$, t14.charge('ownerA', t14.r(1), t14.P(1), false, true, 11), t14.get('C1'))));
select t14.t('4 idempotencia','tras el reintento sigue habiendo un solo cargo para esa clave','^1$', t14.q(format($q$select count(*)::text from public.court_charges where client_request_id='%s'$q$, t14.k(11))));
select t14.t('4 idempotencia','misma clave con OTRO contenido (otra persona) se rechaza 23505','^ERR 23505', t14.charge('ownerA', t14.r(1), t14.P(2), false, true, 11));
select t14.t('4 idempotencia','misma clave con otro usuario (admin) se rechaza 23505','^ERR 23505', t14.charge('adminA', t14.r(1), t14.P(1), false, true, 11));
select t14.t('4 idempotencia','clave nueva con el mismo contenido sobre reserva ya cobrada NO duplica (rechazo de negocio)','^ERR 22023', t14.charge('ownerA', t14.r(1), t14.P(1), false, true, 99));
select t14.t('4 idempotencia','sin clave: 22023','^ERR 22023', t14.vau('ownerA', format('select public.create_court_charge(%L, %L, %L, true, false, null)', 'c0000000-0000-0000-0000-00000000000a', t14.r(14), t14.P(2))));

-- =============================== 5. Pagos ===============================
select t14.t('5 pagos','cargo nuevo: pagado 0, saldo = total (cargo pendiente)','^0$', t14.q(format('select t14.paid(%L)::text', t14.get('C3'))::text));
select t14.put('PAY1', t14.pay('ownerA', t14.get('C3')::uuid, 500000, 40));
select t14.t('5 pagos','pago parcial de 500000 sobre 2100000',:'uuidre', t14.get('PAY1'));
select t14.t('5 pagos','saldo tras el parcial = 1600000','^1600000$', t14.q(format($q$select (total_cents - t14.paid(id))::text from public.court_charges where id='%s'$q$, t14.get('C3'))));
select t14.t('5 pagos','sobrepago rechazado (saldo 1600000, intento 1600001)','^ERR 22023 .*supera el saldo', t14.pay('ownerA', t14.get('C3')::uuid, 1600001, 41));
select t14.t('5 pagos','pago de 0 / negativo rechazado','^ERR 22023', t14.pay('ownerA', t14.get('C3')::uuid, 0, 42));
select t14.t('5 pagos','medio de pago inválido rechazado','^ERR 22023', t14.pay('ownerA', t14.get('C3')::uuid, 100, 43, 'bitcoin'));
select t14.put('PAY2', t14.pay('adminA', t14.get('C3')::uuid, 1600000, 44, 'bank_transfer', 'TRF-1'));
select t14.t('5 pagos','pago completo: saldo 0','^0$', t14.q(format($q$select (total_cents - t14.paid(id))::text from public.court_charges where id='%s'$q$, t14.get('C3'))));
select t14.t('5 pagos','cargo saldado: otro pago se rechaza (sobrepago)','^ERR 22023', t14.pay('ownerA', t14.get('C3')::uuid, 1, 45));
select t14.t('5 pagos','pago completo de una vez (C2: 1000000)','^[0-9a-f]{8}-', t14.pay('ownerA', t14.get('C2')::uuid, 1000000, 46));
-- Reintento del pago
select t14.t('4 idempotencia','reintento del pago (misma clave y contenido) devuelve el MISMO id','^(t|true)$', t14.q(format($q$select (%L = %L)::text$q$, t14.pay('ownerA', t14.get('C3')::uuid, 500000, 40), t14.get('PAY1'))));
select t14.t('4 idempotencia','el reintento no duplicó (sigue habiendo 1 pago con esa clave; total pagado C3 = 2100000)','^1\|2100000$',
  t14.q(format($q$select (select count(*) from public.court_charge_payments where client_request_id='%s')||'|'||t14.paid('%s')$q$, t14.k(40), t14.get('C3'))));
select t14.t('4 idempotencia','reintento de un pago de cargo ya saldado NO falla por sobrepago (devuelve el original)','^(t|true)$', t14.q(format($q$select (%L = %L)::text$q$, t14.pay('adminA', t14.get('C3')::uuid, 1600000, 44, 'bank_transfer', 'TRF-1'), t14.get('PAY2'))));
select t14.t('4 idempotencia','misma clave de pago con OTRO importe: 23505','^ERR 23505', t14.pay('ownerA', t14.get('C3')::uuid, 400000, 40));
select t14.t('4 idempotencia','misma clave de pago sobre OTRO cargo: 23505','^ERR 23505', t14.pay('ownerA', t14.get('C2')::uuid, 500000, 40));
-- Anulación de pagos
select t14.t('6 anulación','anular pago sin motivo: 22023','^ERR 22023', t14.vau('ownerA', format('select public.void_court_charge_payment(%L, '''')', t14.get('PAY2'))));
select t14.t('6 anulación','anular pago PAY2 con motivo','^OK', t14.sa('authenticated', t14.auth('ownerA'), format('select public.void_court_charge_payment(%L, ''cargado dos veces'')', t14.get('PAY2'))));
select t14.t('6 anulación','el saldo se recalcula SIN el pago anulado (1600000)','^1600000$', t14.q(format($q$select (total_cents - t14.paid(id))::text from public.court_charges where id='%s'$q$, t14.get('C3'))));
select t14.t('6 anulación','el pago anulado queda con auditoría (quién, cuándo, motivo) y NO se borra','^(t|true)\|(t|true)\|cargado dos veces$', t14.q(format($q$select (voided_by is not null)||'|'||(voided_at is not null)||'|'||void_reason from public.court_charge_payments where id='%s'$q$, t14.get('PAY2'))));
select t14.t('6 anulación','anular dos veces: 22023','^ERR 22023', t14.vau('ownerA', format('select public.void_court_charge_payment(%L, ''otra vez'')', t14.get('PAY2'))));
select t14.t('6 anulación','staff NO anula pagos','^ERR 42501', t14.vau('staffA', format('select public.void_court_charge_payment(%L, ''x'')', t14.get('PAY1'))));
select t14.t('6 anulación','owner de B no anula pagos de A (sin revelar existencia)','^ERR 42501', t14.vau('ownerB', format('select public.void_court_charge_payment(%L, ''x'')', t14.get('PAY1'))));
select t14.t('6 anulación','tras anular se puede volver a pagar el saldo (nueva clave)','^[0-9a-f]{8}-', t14.pay('ownerA', t14.get('C3')::uuid, 1600000, 47));
select t14.t('6 anulación','pago anulado es inmodificable (UPDATE de importe)','ERR 55000', t14.sa('postgres', null, format('update public.court_charge_payments set amount_cents = 1 where id=%L', t14.get('PAY2'))));
select t14.t('6 anulación','los pagos no se borran (DELETE)','ERR 55000', t14.sa('postgres', null, 'delete from public.court_charge_payments'));
select t14.t('6 anulación','los cargos no se borran (DELETE)','ERR 55000', t14.sa('postgres', null, 'delete from public.court_charges'));
select t14.t('6 anulación','un cargo es inmodificable (UPDATE de importe)','ERR 55000', t14.sa('postgres', null, format('update public.court_charges set rental_cents = 1 where id=%L', t14.get('C1'))));
-- Anulación de cargos
select t14.t('6 anulación','anular cargo con pagos vigentes: se rechaza','^ERR 22023 .*pagos vigentes', t14.vau('ownerA', format('select public.void_court_charge(%L, ''error'')', t14.get('C3'))));
select t14.t('6 anulación','anular cargo sin pagos (C4) con motivo','^OK', t14.sa('authenticated', t14.auth('ownerA'), format('select public.void_court_charge(%L, ''cargado a la reserva equivocada'')', t14.get('C4'))));
select t14.t('6 anulación','cargo anulado: no admite pagos','^ERR 23503', t14.pay('ownerA', t14.get('C4')::uuid, 100, 48));
select t14.t('6 anulación','cargo anulado: no se anula dos veces','^ERR 22023', t14.vau('ownerA', format('select public.void_court_charge(%L, ''de nuevo'')', t14.get('C4'))));
select t14.t('6 anulación','tras anular el cargo se puede cargar otro en la misma reserva','^[0-9a-f]{8}-', t14.charge('ownerA', t14.r(4), t14.P(2), true, false, 49, 100));
select t14.t('6 anulación','staff NO anula cargos','^ERR 42501', t14.vau('staffA', format('select public.void_court_charge(%L, ''x'')', t14.get('C1'))));

-- =============================== 7. Roles y aislamiento por club ===============================
select t14.t('7 roles','staff NO crea cargos','^ERR 42501', t14.charge('staffA', t14.r(14), t14.P(2), true, false, 60));
select t14.t('7 roles','staff NO registra pagos','^ERR 42501', t14.pay('staffA', t14.get('C1')::uuid, 100, 61));
select t14.t('7 roles','jugador/usuario sin rol NO crea cargos','^ERR 42501', t14.charge('player', t14.r(14), t14.P(2), true, false, 62));
select t14.t('7 roles','staff NO lee cargos (RLS)','^0$', t14.vau('staffA', 'select count(*)::text from public.court_charges'));
select t14.t('7 roles','staff NO lee pagos, tarifas ni historial','^0\|0\|0$', t14.vau('staffA', 'select (select count(*) from public.court_charge_payments)||''|''||(select count(*) from public.club_court_rate_settings)||''|''||(select count(*) from public.club_court_rate_history)'));
select t14.t('7 roles','owner y admin SÍ leen los cargos de su club','^[1-9]', t14.vau('adminA', 'select count(*)::text from public.court_charges'));
select t14.t('7 roles','owner de B NO lee cargos de A (RLS)','^0$', t14.vau('ownerB', 'select count(*)::text from public.court_charges'));
select t14.t('7 roles','anon no ejecuta las RPC','^ERR 42501', t14.sa('anon', null, format('select public.create_court_charge(%L, %L, %L, true, false, %L)', 'c0000000-0000-0000-0000-00000000000a', t14.r(14), t14.P(2), t14.k(63))));
select t14.t('7 roles','authenticated no inserta directo en court_charges','^ERR 42501', t14.sa('authenticated', t14.auth('ownerA'), format($q$insert into public.court_charges(club_id, reservation_id, responsible_person_id, responsible_name_snapshot, member_status, billable_minutes, rental_applied, lighting_applied, billing_mode_snapshot, rental_cents, lighting_cents, client_request_id, request_hash, created_by) values (%L, %L, %L, 'x', 'member', 60, true, false, 'exact', 1, 0, %L, repeat('a',64), %L)$q$, 'c0000000-0000-0000-0000-00000000000a', t14.r(15), t14.P(1), t14.k(64), t14.auth('ownerA'))));
select t14.t('7 roles','authenticated no inserta pagos ni tarifas directo','^ERR 42501.*\|ERR 42501', (select t14.sa('authenticated', t14.auth('ownerA'), $q$insert into public.club_court_rate_settings(club_id, updated_by) values ('c0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-000000000001')$q$) || '|' || t14.sa('authenticated', t14.auth('ownerA'), $q$delete from public.court_charge_payments$q$)));
-- Aislamiento por club
select t14.t('8 aislamiento','owner de B no crea cargo sobre reserva de A','^ERR 42501', t14.charge('ownerB', t14.r(14), t14.P(2), true, false, 70, null, null, null, null, 'c0000000-0000-0000-0000-00000000000a'));
select t14.t('8 aislamiento','owner de A no crea cargo en club B','^ERR 42501', t14.charge('ownerA', 'f5000000-0000-0000-0000-0000000000b1'::uuid, 'e0000000-0000-0000-0000-0000000000b1'::uuid, true, false, 71, null, null, null, null, 'c0000000-0000-0000-0000-00000000000b'));
select t14.t('8 aislamiento','reserva de B con club A como contexto: no existe en este club (23503)','^ERR 23503', t14.charge('ownerA', 'f5000000-0000-0000-0000-0000000000b1'::uuid, t14.P(2), true, false, 72));
select t14.t('8 aislamiento','persona de B como responsable de reserva de A: 23503','^ERR 23503', t14.charge('ownerA', t14.r(14), 'e0000000-0000-0000-0000-0000000000b1'::uuid, true, false, 73));
select t14.t('8 aislamiento','owner de B no paga cargos de A (no revela si existen)','^ERR (42501|23503)', t14.pay('ownerB', t14.get('C1')::uuid, 100, 74, 'cash', null, 'c0000000-0000-0000-0000-00000000000b'));
select t14.t('8 aislamiento','owner de A con contexto A no paga un cargo inexistente en su club','^ERR 23503', t14.pay('ownerA', gen_random_uuid(), 100, 75));
select t14.t('8 aislamiento','la cuenta corriente de una persona de B no se consulta desde A','^ERR 42501', t14.vau('ownerA', format('select count(*) from public.get_person_account(%L, %L)', 'c0000000-0000-0000-0000-00000000000b', t14.P(2))));
select t14.t('8 aislamiento','persona de B con contexto de A: 23503','^ERR 23503', t14.vau('ownerA', format('select count(*) from public.get_person_account(%L, %L)', 'c0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-0000000000b1'::uuid)));
select t14.t('8 aislamiento','owner de B configura SUS tarifas sin tocar las de A','^1\|1$', (select t14.vau('ownerB', format('select public.set_court_rate_settings(%L, 700000, null, true, false)::text', 'c0000000-0000-0000-0000-00000000000b')) is not null)::int::text || '|' || (select count(*) from public.club_court_rate_settings where club_id = 'c0000000-0000-0000-0000-00000000000a')::text);

-- =============================== 9. Cuenta corriente consolidada ===============================
-- Persona 2 (No Socio Dos): cargos C2 (pagado), C3 (pagado), C5 (pendiente 900000), C6 (pendiente 3400000), el nuevo de R4 (pendiente)
-- Persona 1 (Socio Uno): cuota, cantina y luz.
insert into public.club_fee_settings(club_id, monthly_amount_cents, due_day, updated_by) values ('c0000000-0000-0000-0000-00000000000a', 600000, 10, 'a0000000-0000-0000-0000-000000000001');
select t14.vau('ownerA', $q$select created_count::text from public.generate_membership_dues('c0000000-0000-0000-0000-00000000000a', date '2026-10-01')$q$);
insert into public.canteen_categories(id, club_id, name) values ('b0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-00000000000a','Bebidas');
insert into public.canteen_products(id, club_id, category_id, name, sale_price_cents) values ('b1000000-0000-0000-0000-0000000000a1','c0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a','Agua', 150000);
select t14.vau('staffA', $q$select (public.create_canteen_sale('c0000000-0000-0000-0000-00000000000a','[{"product_id":"b1000000-0000-0000-0000-0000000000a1","quantity":2}]'::jsonb,'e0000000-0000-0000-0000-000000000001',null,'f4000000-0000-0000-0000-000000000901')).id::text$q$);
select t14.vau('staffA', $q$select (public.create_canteen_sale('c0000000-0000-0000-0000-00000000000a','[{"product_id":"b1000000-0000-0000-0000-0000000000a1","quantity":1}]'::jsonb,'e0000000-0000-0000-0000-000000000001',null,'f4000000-0000-0000-0000-000000000902')).id::text$q$);
-- La segunda venta se anula (consumo pendiente anulado = no es deuda)
select t14.vau('ownerA', $q$select (public.void_canteen_sale((select id from public.canteen_sales where client_request_id='f4000000-0000-0000-0000-000000000902'), 'cargada por error')).id::text$q$);
-- Pago parcial de la cantina y de la cuota; un pago de cuota anulado no debe contar
select t14.vau('staffA', $q$select (public.record_canteen_sale_payment('c0000000-0000-0000-0000-00000000000a',(select id from public.canteen_sales where client_request_id='f4000000-0000-0000-0000-000000000901'),100000,current_date,'cash',null,null,'f4000000-0000-0000-0000-000000000903')).id::text$q$);
select t14.vau('ownerA', $q$select (public.record_membership_due_payment('c0000000-0000-0000-0000-00000000000a',(select d.id from public.membership_dues d join public.club_memberships m on m.id=d.membership_id where m.person_id='e0000000-0000-0000-0000-000000000001'),200000,current_date,'cash',null,null,'f4000000-0000-0000-0000-000000000904')).id::text$q$);
select t14.vau('ownerA', $q$select (public.void_membership_due_payment((public.record_membership_due_payment('c0000000-0000-0000-0000-00000000000a',(select d.id from public.membership_dues d join public.club_memberships m on m.id=d.membership_id where m.person_id='e0000000-0000-0000-0000-000000000001'),100000,current_date,'cash',null,null,'f4000000-0000-0000-0000-000000000905')).id,'error')).id::text$q$);
select t14.charge('ownerA', t14.r(16), t14.P(1), false, true, 80, 60);  -- luz de Socio Uno, pendiente (la tarifa v2 vigente: 500000)
select t14.put('C7', t14.q($q$select id::text from public.court_charges where reservation_id = 'f5000000-0000-0000-0000-000000000016'$q$));
select t14.vau('ownerA', format('select (public.record_court_charge_payment(%L, %L, 150000, date ''2026-11-06'', ''cash'', %L, null, null)).id::text', 'c0000000-0000-0000-0000-00000000000a', t14.get('C7'), t14.k(81)));
-- Pago de cancha anulado: no debe contar en la cuenta
select t14.vau('ownerA', format('select (public.void_court_charge_payment((public.record_court_charge_payment(%L, %L, 50000, date ''2026-11-06'', ''cash'', %L, null, null)).id, ''error'')).id::text', 'c0000000-0000-0000-0000-00000000000a', t14.get('C7'), t14.k(82)));

create function t14.acct(p_person int, p_all boolean default false) returns text language sql as $$
  select t14.vau('ownerA', format($f$select coalesce(string_agg(concept||':'||original_cents||':'||paid_cents||':'||balance_cents||':'||status, ',' order by concept, original_cents), '<vacio>') from public.get_person_account('c0000000-0000-0000-0000-00000000000a', %L, %L)$f$, t14.P(p_person), p_all)) $$;
select t14.t('9 cuenta','Socio Uno (solo pendientes): cuota 600000 pagó 200000; cantina 300000 pagó 100000 (la venta anulada y el pago de cuota anulado no cuentan); 3 cargos de luz',
  '^canteen:300000:100000:200000:partial,court_lighting:300000:0:300000:pending,court_lighting:400000:0:400000:pending,court_lighting:500000:150000:350000:partial,membership_due:600000:200000:400000:partial$', t14.acct(1));
select t14.t('9 cuenta','el pago anulado de cuota NO suma y la venta anulada NO es deuda (con histórico aparece como voided saldo 0)','voided',
  t14.acct(1, true));
select t14.t('9 cuenta','sin duplicaciones: el total adeudado de Socio Uno = 400000 cuota + 200000 cantina + 1050000 luz = 1650000','^1650000$', t14.vau('ownerA', format($f$select sum(balance_cents)::text from public.get_person_account('c0000000-0000-0000-0000-00000000000a', %L)$f$, t14.P(1))));
select t14.t('9 cuenta','sin duplicaciones: 5 filas (1 cuota, 1 consumo, 3 cargos de luz), una por documento de origen','^5$', t14.vau('ownerA', format($f$select count(*)::text from public.get_person_account('c0000000-0000-0000-0000-00000000000a', %L)$f$, t14.P(1))));
select t14.t('9 cuenta','No Socio Dos: C2 y C3 saldados no figuran; pendientes: C5 (900000), C6 (3400000) y el cargo nuevo de R4 (1200000 × 100/60 → bloque 30 = 120 min)','^court_rental:900000:0:900000:pending,court_rental:2400000:0:2400000:pending,court_rental_lighting:3400000:0:3400000:pending$',
  t14.acct(2));
select t14.t('9 cuenta','el total de cuenta coincide con los saldos del módulo de origen (no hay libro paralelo): cargos = suma(total - pagos vigentes)','^(t|true)$',
  t14.vau('ownerA', $q$select ((select sum(c.total_cents - t14.paid(c.id)) from public.court_charges c where c.responsible_person_id = 'e0000000-0000-0000-0000-000000000002' and c.status='confirmed') = (select sum(balance_cents) from public.get_person_account('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000002')))::text$q$));
select t14.t('9 cuenta','staff NO consulta cuentas','^ERR 42501', t14.vau('staffA', format('select count(*) from public.get_person_account(%L, %L)', 'c0000000-0000-0000-0000-00000000000a', t14.P(1))));
select t14.t('9 cuenta','anular el cargo pendiente C7 lo saca de la cuenta (tiene un pago vigente: primero se anula el pago)','^ERR 22023', t14.vau('ownerA', format('select public.void_court_charge(%L, ''x'')', t14.get('C7'))));
select t14.t('9 cuenta','cargo anulado (C4 original) aparece solo con histórico y con saldo 0','^(t|true)$', t14.vau('ownerA', format($q$select exists(select 1 from public.get_person_account('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000002', true) where source_id = '%s' and status='voided' and balance_cents=0)::text$q$, t14.get('C4'))));

-- =============================== Resumen ===============================
select area, count(*) filter (where ok) as cumple, count(*) filter (where not ok) as no_cumple, count(*) as total from t14.results group by area order by area;
select ' TOTAL' as area, count(*) filter (where ok) as cumple, count(*) filter (where not ok) as no_cumple, count(*) as total from t14.results;
\pset format unaligned
select n || E'	' || area || E'	' || test || E'	' || actual from t14.results where not ok order by n;
