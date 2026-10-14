-- Sprint 10B.1 — datos y ayudantes para las verificaciones de SEC-01…SEC-04.
-- SOLO para un PostgreSQL LOCAL DESCARTABLE (no Supabase): crea usuarios/datos de prueba y el esquema t10.
-- Requiere local-supabase-stub.sql y las migraciones aplicadas hasta 20261014010000 (estado previo) o todas.
-- Corre con superusuario; los datos se generan con las RPC reales (como owner/staff) para que existan antes de las
-- migraciones correctivas y se pueda comprobar que no se alteran (t10.snap).
\set ON_ERROR_STOP on
set client_min_messages = warning;
drop schema if exists t10 cascade;
create schema t10;
create table t10.results (n serial primary key, area text, test text, expected text, actual text, ok boolean);

-- Ejecuta una sentencia como <rol>/<uid> y devuelve 'OK rows=N' o 'ERR sqlstate mensaje'.
create function t10.sql_as(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
declare n bigint; res text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin execute p_sql; get diagnostics n = row_count; res := 'OK rows=' || n;
  exception when others then res := 'ERR ' || sqlstate || ' ' || sqlerrm; end;
  reset role;
  return res;
end $$;

-- Igual, pero devuelve el primer valor de la consulta como texto.
create function t10.val_as(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text; res text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin execute p_sql into v; res := coalesce(v, '<null>');
  exception when others then res := 'ERR ' || sqlstate || ' ' || sqlerrm; end;
  reset role;
  return res;
end $$;

-- Registra una prueba: ok = (actual ~ expected).
create function t10.t(p_area text, p_test text, p_expected_regex text, p_actual text) returns void language sql as $$
  insert into t10.results(area, test, expected, actual, ok) values (p_area, p_test, p_expected_regex, left(p_actual, 240), p_actual ~ p_expected_regex);
$$;

-- ===================== Usuarios, clubes, canchas, personas =====================
insert into auth.users(id, email) values
 ('a0000000-0000-0000-0000-000000000001','ownerA@t'), ('a0000000-0000-0000-0000-000000000002','adminA@t'),
 ('a0000000-0000-0000-0000-000000000003','staffA@t'), ('a0000000-0000-0000-0000-000000000004','ownerB@t'),
 ('a0000000-0000-0000-0000-000000000005','playerA1@t'), ('a0000000-0000-0000-0000-000000000006','playerA2@t'),
 ('a0000000-0000-0000-0000-000000000007','playerB1@t'), ('a0000000-0000-0000-0000-000000000008','nolink@t'),
 ('a0000000-0000-0000-0000-00000000000a','adminAB@t'), ('a0000000-0000-0000-0000-00000000000b','playerA3@t'),
 ('a0000000-0000-0000-0000-00000000000c','playerA4@t'),
 ('a1000000-0000-0000-0000-000000000001','redeem1@t'), ('a1000000-0000-0000-0000-000000000002','redeem2@t'),
 ('a1000000-0000-0000-0000-000000000003','redeem3@t'), ('a1000000-0000-0000-0000-000000000004','redeem4@t'),
 ('a1000000-0000-0000-0000-000000000005','redeem5@t'), ('a1000000-0000-0000-0000-000000000006','redeem6@t');
insert into public.clubs(id, name) values ('c0000000-0000-0000-0000-00000000000a','Club A'), ('c0000000-0000-0000-0000-00000000000b','Club B');
insert into public.club_staff(club_id, auth_user_id, role) values
 ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001','owner'),
 ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000002','admin'),
 ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000003','staff'),
 ('c0000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-000000000004','owner'),
 ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a','admin'),
 ('c0000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-00000000000a','admin');
insert into public.courts(id, club_id, name, surface, display_order) values
 ('d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','A1','polvo',1),
 ('d0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000a','A2','polvo',2),
 ('d0000000-0000-0000-0000-0000000000a9','c0000000-0000-0000-0000-00000000000a','A9 sin uso','polvo',9),
 ('d0000000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-00000000000b','B1','polvo',1);
insert into public.club_people(id, club_id, full_name, phone, notes) values
 ('e0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','Jugador A1','111','nota A1'),
 ('e0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000a','Jugador A2','222','nota A2'),
 ('e0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-00000000000a','Jugador A3','333',null),
 ('e0000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-00000000000a','Jugador A4','444',null),
 ('e0000000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-00000000000b','Jugador B1','555','nota B1'),
 ('e0000000-0000-0000-0000-0000000000f1','c0000000-0000-0000-0000-00000000000a','Invitada 1',null,null),
 ('e0000000-0000-0000-0000-0000000000f2','c0000000-0000-0000-0000-00000000000a','Invitada 2 (revocada)',null,null),
 ('e0000000-0000-0000-0000-0000000000f3','c0000000-0000-0000-0000-00000000000a','Invitada 3 (vencida)',null,null),
 ('e0000000-0000-0000-0000-0000000000f4','c0000000-0000-0000-0000-00000000000a','Invitada 4 (cruce)',null,null),
 ('e0000000-0000-0000-0000-0000000000f5','c0000000-0000-0000-0000-00000000000a','Invitada 5 (concurrencia)',null,null),
 ('e0000000-0000-0000-0000-0000000000f6','c0000000-0000-0000-0000-00000000000a','Invitada 6 (inactiva)',null,null),
 ('e0000000-0000-0000-0000-0000000000fb','c0000000-0000-0000-0000-00000000000b','Invitada club B',null,null),
 ('e0000000-0000-0000-0000-0000000000c1','c0000000-0000-0000-0000-00000000000a','Profe A',null,null);
update public.club_people set active = false where id = 'e0000000-0000-0000-0000-0000000000f6';
insert into public.club_memberships(club_id, person_id, status) values
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000001','active'),
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000002','active'),
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000003','active'),
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000004','active'),
 ('c0000000-0000-0000-0000-00000000000b','e0000000-0000-0000-0000-0000000000b1','active');
insert into public.club_person_auth_links(club_id, person_id, auth_user_id) values
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000005'),
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000006'),
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000000b'),
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-00000000000c'),
 ('c0000000-0000-0000-0000-00000000000b','e0000000-0000-0000-0000-0000000000b1','a0000000-0000-0000-0000-000000000007');
insert into public.club_online_booking_settings(club_id, enabled, updated_by, max_active_reservations, max_advance_days)
 values ('c0000000-0000-0000-0000-00000000000a', true, 'a0000000-0000-0000-0000-000000000001', 3, 30);
insert into public.club_coaches(id, club_id, person_id, created_by) values ('f0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-0000000000c1','a0000000-0000-0000-0000-000000000001');

-- ===================== Cuotas y pagos (por RPC, como owner) =====================
select t10.val_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$select monthly_amount_cents::text from public.set_club_fee_settings('c0000000-0000-0000-0000-00000000000a', 500000, 10::smallint)$q$);
select t10.val_as('authenticated','a0000000-0000-0000-0000-000000000004'::uuid, $q$select monthly_amount_cents::text from public.set_club_fee_settings('c0000000-0000-0000-0000-00000000000b', 400000, 10::smallint)$q$);
select t10.val_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$select created_count::text from public.generate_membership_dues('c0000000-0000-0000-0000-00000000000a', date '2026-10-01')$q$);
select t10.val_as('authenticated','a0000000-0000-0000-0000-000000000004'::uuid, $q$select created_count::text from public.generate_membership_dues('c0000000-0000-0000-0000-00000000000b', date '2026-10-01')$q$);
do $$
declare
  a uuid := 'c0000000-0000-0000-0000-00000000000a'; b uuid := 'c0000000-0000-0000-0000-00000000000b';
  d1 uuid; d2 uuid; d3 uuid; d4 uuid; db uuid; pay uuid;
begin
  select d.id into d1 from public.membership_dues d join public.club_memberships m on m.id = d.membership_id where m.person_id = 'e0000000-0000-0000-0000-000000000001';
  select d.id into d2 from public.membership_dues d join public.club_memberships m on m.id = d.membership_id where m.person_id = 'e0000000-0000-0000-0000-000000000002';
  select d.id into d3 from public.membership_dues d join public.club_memberships m on m.id = d.membership_id where m.person_id = 'e0000000-0000-0000-0000-000000000003';
  select d.id into d4 from public.membership_dues d join public.club_memberships m on m.id = d.membership_id where m.person_id = 'e0000000-0000-0000-0000-000000000004';
  select d.id into db from public.membership_dues d join public.club_memberships m on m.id = d.membership_id where m.person_id = 'e0000000-0000-0000-0000-0000000000b1';
  perform set_config('t10.due_a1', d1::text, false); perform set_config('t10.due_a2', d2::text, false);
  perform set_config('t10.due_a3', d3::text, false); perform set_config('t10.due_a4', d4::text, false);
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001', true);
  -- A1: válido 200000 + anulado 100000 -> pagado 200000 / saldo 300000
  perform public.record_membership_due_payment(a, d1, 200000, current_date, 'cash');
  select id into pay from public.record_membership_due_payment(a, d1, 100000, current_date, 'cash');
  perform public.void_membership_due_payment(pay, 'error de carga');
  perform set_config('t10.pay_a1_voided', pay::text, false);
  -- A2: parcial 150000 -> saldo 350000
  perform public.record_membership_due_payment(a, d2, 150000, current_date, 'bank_transfer');
  -- A3: dos pagos válidos que saldan la cuota (300000 + 200000) -> saldo 0
  perform public.record_membership_due_payment(a, d3, 300000, current_date, 'cash');
  perform public.record_membership_due_payment(a, d3, 200000, current_date, 'cash');
  -- A4: solo un pago anulado -> pagado 0
  select id into pay from public.record_membership_due_payment(a, d4, 500000, current_date, 'cash');
  perform public.void_membership_due_payment(pay, 'pago rechazado');
  perform set_config('t10.pay_a4_voided', pay::text, false);
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000004', true);
  perform public.record_membership_due_payment(b, db, 50000, current_date, 'cash');
  reset role;
end $$;

-- ===================== Cantina: catálogo (INSERT directo, como owner) y ventas por RPC =====================
select t10.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$insert into public.canteen_categories(id, club_id, name) values ('b0000000-0000-0000-0000-0000000000a1','c0000000-0000-0000-0000-00000000000a','Bebidas')$q$);
select t10.sql_as('authenticated','a0000000-0000-0000-0000-000000000004'::uuid, $q$insert into public.canteen_categories(id, club_id, name) values ('b0000000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-00000000000b','Bebidas B')$q$);
select t10.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$insert into public.canteen_products(id, club_id, category_id, name, sale_price_cents) values ('b1000000-0000-0000-0000-0000000000a1','c0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-0000000000a1','Agua',120000)$q$);
-- Producto sin ventas (el que SEC-03 podía reasignar de club) y una venta con productos para el resto.
select t10.sql_as('authenticated','a0000000-0000-0000-0000-000000000001'::uuid, $q$insert into public.canteen_products(id, club_id, category_id, name, sale_price_cents) values ('b1000000-0000-0000-0000-0000000000a2','c0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-0000000000a1','Gaseosa sin ventas',150000)$q$);
select t10.val_as('authenticated','a0000000-0000-0000-0000-000000000003'::uuid, $q$select (public.create_canteen_sale('c0000000-0000-0000-0000-00000000000a','[{"product_id":"b1000000-0000-0000-0000-0000000000a1","quantity":2}]'::jsonb,'e0000000-0000-0000-0000-000000000001'))::text$q$);

-- ===================== Foto financiera para comprobar que las migraciones no alteran datos =====================
create table t10.snap as select
  (select md5(coalesce(string_agg(id::text || ':' || amount_cents || ':' || due_date, ',' order by id), '')) from public.membership_dues) as dues,
  (select md5(coalesce(string_agg(id::text || ':' || amount_cents || ':' || coalesce(voided_at::text, '-'), ',' order by id), '')) from public.membership_due_payments) as payments,
  (select md5(coalesce(string_agg(id::text || ':' || total_cents || ':' || status, ',' order by id), '')) from public.canteen_sales) as sales,
  (select count(*) from public.courts) as courts;

-- ===================== Tokens {nombre} para escribir las pruebas con menos ruido =====================
create table t10.tok (name text primary key, val text not null);
insert into t10.tok values
 ('ownerA','a0000000-0000-0000-0000-000000000001'),('adminA','a0000000-0000-0000-0000-000000000002'),('staffA','a0000000-0000-0000-0000-000000000003'),
 ('ownerB','a0000000-0000-0000-0000-000000000004'),('pA1','a0000000-0000-0000-0000-000000000005'),('pA2','a0000000-0000-0000-0000-000000000006'),
 ('pB1','a0000000-0000-0000-0000-000000000007'),('nolink','a0000000-0000-0000-0000-000000000008'),('adminAB','a0000000-0000-0000-0000-00000000000a'),
 ('pA3','a0000000-0000-0000-0000-00000000000b'),('pA4','a0000000-0000-0000-0000-00000000000c'),
 ('r1','a1000000-0000-0000-0000-000000000001'),('r2','a1000000-0000-0000-0000-000000000002'),('r3','a1000000-0000-0000-0000-000000000003'),
 ('r4','a1000000-0000-0000-0000-000000000004'),('r5','a1000000-0000-0000-0000-000000000005'),('r6','a1000000-0000-0000-0000-000000000006'),
 ('clubA','c0000000-0000-0000-0000-00000000000a'),('clubB','c0000000-0000-0000-0000-00000000000b'),
 ('courtA1','d0000000-0000-0000-0000-000000000001'),('courtA2','d0000000-0000-0000-0000-000000000002'),('courtA9','d0000000-0000-0000-0000-0000000000a9'),('courtB1','d0000000-0000-0000-0000-0000000000b1'),
 ('personA1','e0000000-0000-0000-0000-000000000001'),('personA2','e0000000-0000-0000-0000-000000000002'),('personA3','e0000000-0000-0000-0000-000000000003'),('personA4','e0000000-0000-0000-0000-000000000004'),
 ('personB1','e0000000-0000-0000-0000-0000000000b1'),
 ('inv1','e0000000-0000-0000-0000-0000000000f1'),('inv2','e0000000-0000-0000-0000-0000000000f2'),('inv3','e0000000-0000-0000-0000-0000000000f3'),
 ('inv4','e0000000-0000-0000-0000-0000000000f4'),('inv5','e0000000-0000-0000-0000-0000000000f5'),('inv6','e0000000-0000-0000-0000-0000000000f6'),('invB','e0000000-0000-0000-0000-0000000000fb'),
 ('coachA','f0000000-0000-0000-0000-000000000001'),
 ('catA','b0000000-0000-0000-0000-0000000000a1'),('catB','b0000000-0000-0000-0000-0000000000b1'),
 ('prodA1','b1000000-0000-0000-0000-0000000000a1'),('prodA2','b1000000-0000-0000-0000-0000000000a2'),
 ('dueA1', current_setting('t10.due_a1')),('dueA2', current_setting('t10.due_a2')),('dueA3', current_setting('t10.due_a3')),('dueA4', current_setting('t10.due_a4')),
 ('payA1v', current_setting('t10.pay_a1_voided')),('payA4v', current_setting('t10.pay_a4_voided'));
insert into t10.tok select 'saleA1', id::text from public.canteen_sales where club_id = 'c0000000-0000-0000-0000-00000000000a' order by created_at limit 1;

create function t10.k(p_sql text) returns text language plpgsql as $$
declare r record; s text := p_sql;
begin for r in select name, val from t10.tok order by length(name) desc loop s := replace(s, '{' || r.name || '}', r.val); end loop; return s; end $$;
-- sa/va: igual que sql_as/val_as pero con tokens; el usuario se indica por token (o 'anon' sin sesión).
create function t10.sa(p_role text, p_user text, p_sql text) returns text language sql as $$
  select t10.sql_as(p_role, case when p_user is null then null else (select val::uuid from t10.tok where name = p_user) end, t10.k(p_sql)) $$;
create function t10.va(p_role text, p_user text, p_sql text) returns text language sql as $$
  select t10.val_as(p_role, case when p_user is null then null else (select val::uuid from t10.tok where name = p_user) end, t10.k(p_sql)) $$;
