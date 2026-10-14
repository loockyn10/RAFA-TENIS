-- Sprint 10B.2 — datos y ayudantes para las verificaciones de SEC-05 (idempotencia financiera).
-- SOLO para un PostgreSQL LOCAL DESCARTABLE (no Supabase). Requiere local-supabase-stub.sql y las migraciones
-- hasta 20261014050000 (estado previo a 10B.2). Corre con superusuario.
-- Genera con las RPC ANTERIORES (firmas de 7 argumentos) los registros "históricos" que la migración 10B.2
-- no debe alterar, y deja evidencia (control negativo) de que SEC-05 existía antes de la migración.
\set ON_ERROR_STOP on
set client_min_messages = warning;
drop schema if exists t2 cascade;
create schema t2;
create table t2.results (n serial primary key, area text, test text, expected text, actual text, ok boolean);
create table t2.snap (name text primary key, val text);

-- Ejecuta una sentencia como <rol>/<uid> y devuelve 'OK rows=N' o 'ERR sqlstate mensaje'.
create function t2.sa(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
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
create function t2.va(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
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
create function t2.t(p_area text, p_test text, p_expected_regex text, p_actual text) returns void language sql as $$
  insert into t2.results(area, test, expected, actual, ok) values (p_area, p_test, p_expected_regex, left(p_actual, 240), p_actual ~ p_expected_regex);
$$;

-- Atajos: usuarios y sesiones.
create function t2.auth(p_name text) returns uuid language sql immutable as $$
  select case p_name
    when 'ownerA' then 'a0000000-0000-0000-0000-000000000001' when 'adminA' then 'a0000000-0000-0000-0000-000000000002'
    when 'staffA' then 'a0000000-0000-0000-0000-000000000003' when 'ownerB' then 'a0000000-0000-0000-0000-000000000004'
    when 'player' then 'a0000000-0000-0000-0000-000000000005' when 'outsider' then 'a0000000-0000-0000-0000-000000000008'
  end::uuid $$;
create function t2.sau(p_user text, p_sql text) returns text language sql as $$ select t2.sa('authenticated', t2.auth(p_user), p_sql) $$;
create function t2.vau(p_user text, p_sql text) returns text language sql as $$ select t2.va('authenticated', t2.auth(p_user), p_sql) $$;
create function t2.q(p_sql text) returns text language plpgsql as $$ declare v text; begin execute p_sql into v; return coalesce(v, '<null>'); end $$;

-- ===================== Usuarios, clubes, personas =====================
insert into auth.users(id, email) values
 ('a0000000-0000-0000-0000-000000000001','ownerA@t'), ('a0000000-0000-0000-0000-000000000002','adminA@t'),
 ('a0000000-0000-0000-0000-000000000003','staffA@t'), ('a0000000-0000-0000-0000-000000000004','ownerB@t'),
 ('a0000000-0000-0000-0000-000000000005','player@t'), ('a0000000-0000-0000-0000-000000000008','outsider@t');
insert into public.clubs(id, name) values ('c0000000-0000-0000-0000-00000000000a','Club A'), ('c0000000-0000-0000-0000-00000000000b','Club B');
insert into public.club_staff(club_id, auth_user_id, role) values
 ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001','owner'),
 ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000002','admin'),
 ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000003','staff'),
 ('c0000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-000000000004','owner');
insert into public.club_people(id, club_id, full_name) values
 ('e0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','Juan (socio)'),
 ('e0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000a','Socia 2'),
 ('e0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-00000000000a','Socio 3'),
 ('e0000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-00000000000a','Cliente sin cuota'),
 ('e0000000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-00000000000b','Socio B1');
insert into public.club_memberships(club_id, person_id, status) values
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000001','active'),
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000002','active'),
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000003','active'),
 ('c0000000-0000-0000-0000-00000000000b','e0000000-0000-0000-0000-0000000000b1','active');

-- ===================== Catálogo de cantina (importes en centavos) =====================
insert into public.canteen_categories(id, club_id, name) values
 ('b0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-00000000000a','Bebidas'),
 ('b0000000-0000-0000-0000-00000000000b','c0000000-0000-0000-0000-00000000000b','Bebidas');
insert into public.canteen_products(id, club_id, category_id, name, sale_price_cents) values
 ('b1000000-0000-0000-0000-0000000000a1','c0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a','Agua', 150000),
 ('b1000000-0000-0000-0000-0000000000a2','c0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a','Alfajor', 100000),
 ('b1000000-0000-0000-0000-0000000000a3','c0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a','Pelotas', 250000),
 ('b1000000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-00000000000b','Pelotas B', 300000);

-- ===================== Cuotas: Juan debe 6.000.000 centavos ($60.000) =====================
select t2.vau('ownerA', $q$select monthly_amount_cents::text from public.set_club_fee_settings('c0000000-0000-0000-0000-00000000000a', 6000000, 10::smallint)$q$);
select t2.vau('ownerB', $q$select monthly_amount_cents::text from public.set_club_fee_settings('c0000000-0000-0000-0000-00000000000b', 4000000, 10::smallint)$q$);
select t2.vau('ownerA', $q$select created_count::text from public.generate_membership_dues('c0000000-0000-0000-0000-00000000000a', date '2026-10-01')$q$);
select t2.vau('ownerB', $q$select created_count::text from public.generate_membership_dues('c0000000-0000-0000-0000-00000000000b', date '2026-10-01')$q$);
create function t2.due_of(p_person uuid) returns uuid language sql as $$
  select d.id from public.membership_dues d join public.club_memberships m on m.id = d.membership_id where m.person_id = p_person $$;

-- ===================== Registros históricos con las RPC anteriores (sin clave en los pagos) =====================
-- L1: venta cobrada en efectivo (Agua x2 = 300000), L2: consumo pendiente de Juan con un pago parcial de 50000.
select t2.vau('staffA', $q$select (public.create_canteen_sale('c0000000-0000-0000-0000-00000000000a','[{"product_id":"b1000000-0000-0000-0000-0000000000a1","quantity":2}]'::jsonb,null,'cash','f1000000-0000-0000-0000-000000000001')).id::text$q$);
select t2.vau('staffA', $q$select (public.create_canteen_sale('c0000000-0000-0000-0000-00000000000a','[{"product_id":"b1000000-0000-0000-0000-0000000000a2","quantity":3}]'::jsonb,'e0000000-0000-0000-0000-000000000001',null,'f1000000-0000-0000-0000-000000000002')).id::text$q$);
select t2.vau('staffA', $q$select (public.record_canteen_sale_payment('c0000000-0000-0000-0000-00000000000a',(select id from public.canteen_sales where client_request_id='f1000000-0000-0000-0000-000000000002'),50000,current_date,'cash')).id::text$q$);
-- L3: cuota de la socia 2: pago válido 1.000.000 + pago de 500.000 anulado.
select t2.vau('ownerA', format($q$select (public.record_membership_due_payment('c0000000-0000-0000-0000-00000000000a','%s',1000000,current_date,'cash')).id::text$q$, t2.due_of('e0000000-0000-0000-0000-000000000002')));
select t2.vau('ownerA', format($q$select (public.void_membership_due_payment((public.record_membership_due_payment('c0000000-0000-0000-0000-00000000000a','%s',500000,current_date,'cash')).id,'error de carga')).id::text$q$, t2.due_of('e0000000-0000-0000-0000-000000000002')));

-- ===================== CONTROL NEGATIVO: SEC-05 reproducido en el estado ANTERIOR =====================
-- (a) misma clave con otro carrito devuelve en silencio la venta vieja.
select t2.t('CONTROL-ANTES','misma clave y OTRA cantidad devuelve OK con la venta vieja (hallazgo SEC-05)','^OK',
  t2.sau('staffA', $q$select public.create_canteen_sale('c0000000-0000-0000-0000-00000000000a','[{"product_id":"b1000000-0000-0000-0000-0000000000a1","quantity":9}]'::jsonb,null,'cash','f1000000-0000-0000-0000-000000000001')$q$));
-- (b) el mismo pago enviado dos veces queda registrado dos veces (no hay clave).
select t2.sau('ownerA', format($q$select public.record_membership_due_payment('c0000000-0000-0000-0000-00000000000a','%s',200000,current_date,'cash')$q$, t2.due_of('e0000000-0000-0000-0000-000000000003')));
select t2.sau('ownerA', format($q$select public.record_membership_due_payment('c0000000-0000-0000-0000-00000000000a','%s',200000,current_date,'cash')$q$, t2.due_of('e0000000-0000-0000-0000-000000000003')));
select t2.t('CONTROL-ANTES','el mismo pago de cuota enviado dos veces se registra DOS veces (hallazgo SEC-05)','^2$',
  t2.q(format($q$select count(*) from public.membership_due_payments where due_id = '%s'$q$, t2.due_of('e0000000-0000-0000-0000-000000000003'))));

-- ===================== Huella de los registros históricos (no deben cambiar) =====================
-- legacy_ids fija QUÉ filas son históricas: las verificaciones recalculan la huella solo sobre ellas.
create table t2.legacy_ids (tbl text not null, id uuid not null, primary key (tbl, id));
insert into t2.legacy_ids select 'sales', id from public.canteen_sales;
insert into t2.legacy_ids select 'items', id from public.canteen_sale_items;
insert into t2.legacy_ids select 'cpay', id from public.canteen_sale_payments;
insert into t2.legacy_ids select 'dpay', id from public.membership_due_payments;
insert into t2.legacy_ids select 'dues', id from public.membership_dues;
-- Las columnas existentes antes de 10B.2 (la huella no debe cambiar al agregar request_hash / client_request_id).
create function t2.fp(p_tbl text) returns text language sql stable as $$
  select case p_tbl
    when 'sales' then (select md5(string_agg(row(id, club_id, customer_person_id, total_cents, status, client_request_id, created_at, created_by, voided_at, voided_by, void_reason)::text, '|' order by id)) from public.canteen_sales where id in (select id from t2.legacy_ids where tbl = 'sales'))
    when 'items' then (select md5(string_agg(row(id, club_id, sale_id, product_id, product_name_snapshot, quantity, unit_price_cents, created_at)::text, '|' order by id)) from public.canteen_sale_items where id in (select id from t2.legacy_ids where tbl = 'items'))
    when 'cpay'  then (select md5(string_agg(row(id, club_id, sale_id, amount_cents, payment_date, payment_method, reference, notes, created_at, created_by)::text, '|' order by id)) from public.canteen_sale_payments where id in (select id from t2.legacy_ids where tbl = 'cpay'))
    when 'dpay'  then (select md5(string_agg(row(id, club_id, due_id, amount_cents, payment_date, payment_method, reference, notes, created_at, created_by, voided_at, voided_by, void_reason)::text, '|' order by id)) from public.membership_due_payments where id in (select id from t2.legacy_ids where tbl = 'dpay'))
    when 'dues'  then (select md5(string_agg(d::text, '|' order by id)) from public.membership_dues d where id in (select id from t2.legacy_ids where tbl = 'dues'))
  end $$;
insert into t2.snap select tbl, t2.fp(tbl) from (values ('sales'), ('items'), ('cpay'), ('dpay'), ('dues')) v(tbl);
