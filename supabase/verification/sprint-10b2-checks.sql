-- Sprint 10B.2 — verificaciones de SEC-05 (idempotencia de ventas y pagos) contra PostgreSQL REAL y DESCARTABLE.
-- Requiere sprint-10b2-seed.sql (estado previo) y la migración 20261014060000 ya aplicada. NO es Supabase.
-- Importes en centavos. Cada prueba registra una fila en t2.results; el resumen final marca las que no se cumplen.
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- ---------- ayudantes ----------
create function t2.k(n int) returns uuid language sql immutable as $$ select ('f2000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function t2.club(p text) returns uuid language sql immutable as $$ select (case p when 'A' then 'c0000000-0000-0000-0000-00000000000a' else 'c0000000-0000-0000-0000-00000000000b' end)::uuid $$;
create function t2.put(p_name text, p_val text) returns text language sql as $$
  insert into t2.snap values (p_name, p_val) on conflict (name) do update set val = excluded.val returning val $$;
create function t2.get(p_name text) returns text language sql as $$ select val from t2.snap where name = p_name $$;

-- Venta: devuelve el id de la venta o 'ERR sqlstate mensaje'.
create function t2.sale(p_user text, p_club text, p_items text, p_cust uuid, p_method text, p_key int) returns text language sql as $$
  select t2.vau(p_user, format('select (public.create_canteen_sale(%L, %L::jsonb, %L, %L, %L)).id::text', t2.club(p_club), p_items, p_cust, p_method, t2.k(p_key))) $$;
-- Pago de cuota / de cantina: devuelven el id del pago o 'ERR ...'.
create function t2.dpay(p_user text, p_club text, p_due uuid, p_amount bigint, p_method text, p_ref text, p_notes text, p_key int, p_date date default date '2026-10-05') returns text language sql as $$
  select t2.vau(p_user, format('select (public.record_membership_due_payment(%L, %L, %L, %L, %L, %L, %L, %L)).id::text', t2.club(p_club), p_due, p_amount, p_date, p_method, p_ref, p_notes, t2.k(p_key))) $$;
create function t2.cpay(p_user text, p_club text, p_sale uuid, p_amount bigint, p_method text, p_ref text, p_notes text, p_key int, p_date date default date '2026-10-05') returns text language sql as $$
  select t2.vau(p_user, format('select (public.record_canteen_sale_payment(%L, %L, %L, %L, %L, %L, %L, %L)).id::text', t2.club(p_club), p_sale, p_amount, p_date, p_method, p_ref, p_notes, t2.k(p_key))) $$;

create function t2.dpaid(p_due uuid) returns bigint language sql as $$ select coalesce(sum(amount_cents), 0) from public.membership_due_payments where due_id = p_due and voided_at is null $$;
create function t2.cpaid(p_sale uuid) returns bigint language sql as $$ select coalesce(sum(amount_cents), 0) from public.canteen_sale_payments where sale_id = p_sale $$;

-- Productos (club A): Agua 150000, Alfajor 100000, Pelotas 250000. Club B: Pelotas B 300000.
create function t2.items(variadic p text[]) returns text language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id',
    case split_part(x, ':', 1) when 'agua' then 'b1000000-0000-0000-0000-0000000000a1' when 'alf' then 'b1000000-0000-0000-0000-0000000000a2'
      when 'pel' then 'b1000000-0000-0000-0000-0000000000a3' when 'pelB' then 'b1000000-0000-0000-0000-0000000000b1' end,
    'quantity', split_part(x, ':', 2)::int))::text, '[]') from unnest(p) x $$;

-- UUID de formato válido
\set uuidre '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

-- Cuotas de prueba: Juan (6.000.000), Socia 2 (con histórico), Socio 3 (con histórico), Socio B1 (club B).
select t2.put('D1', t2.due_of('e0000000-0000-0000-0000-000000000001')::text);
select t2.put('D2', t2.due_of('e0000000-0000-0000-0000-000000000002')::text);
select t2.put('D3', t2.due_of('e0000000-0000-0000-0000-000000000003')::text);
select t2.put('DB', t2.due_of('e0000000-0000-0000-0000-0000000000b1')::text);
select t2.put('n_sales_before', (select count(*)::text from public.canteen_sales));

-- =============================== 0. Estructura y privilegios ===============================
select t2.t('0 estructura','las firmas de 7 argumentos de los pagos ya no existen (no hay camino sin clave)','^true$', t2.q($q$select (to_regprocedure('public.record_membership_due_payment(uuid,uuid,bigint,date,text,text,text)') is null and to_regprocedure('public.record_canteen_sale_payment(uuid,uuid,bigint,date,text,text,text)') is null)::text$q$));
select t2.t('0 estructura','las 3 RPC son SECURITY DEFINER con search_path fijo',
  '^3$', t2.q($q$select count(*)::text from pg_proc p where p.oid in ('public.create_canteen_sale(uuid,jsonb,uuid,text,uuid)'::regprocedure,'public.record_membership_due_payment(uuid,uuid,bigint,date,text,text,text,uuid)'::regprocedure,'public.record_canteen_sale_payment(uuid,uuid,bigint,date,text,text,text,uuid)'::regprocedure) and p.prosecdef and p.proconfig @> array['search_path=pg_catalog, public']$q$));
select t2.t('0 estructura','anon y PUBLIC no tienen EXECUTE; authenticated sí (3 RPC)','^0\|3$',
  t2.q($q$select (select count(*) from unnest(array['public.create_canteen_sale(uuid,jsonb,uuid,text,uuid)','public.record_membership_due_payment(uuid,uuid,bigint,date,text,text,text,uuid)','public.record_canteen_sale_payment(uuid,uuid,bigint,date,text,text,text,uuid)']) f where has_function_privilege('anon', f::regprocedure, 'execute') or has_function_privilege(0, f::regprocedure, 'execute'))::text || '|' || (select count(*) from unnest(array['public.create_canteen_sale(uuid,jsonb,uuid,text,uuid)','public.record_membership_due_payment(uuid,uuid,bigint,date,text,text,text,uuid)','public.record_canteen_sale_payment(uuid,uuid,bigint,date,text,text,text,uuid)']) f where has_function_privilege('authenticated', f::regprocedure, 'execute'))::text$q$));
select t2.t('0 estructura','UNIQUE (club_id, client_request_id) en ventas y en ambos pagos','^3$',
  t2.q($q$select count(*)::text from pg_constraint where contype = 'u' and conname in ('canteen_sales_club_id_client_request_id_key','membership_due_payments_club_request_key','canteen_sale_payments_club_request_key')$q$));
select t2.t('0 estructura','la restricción UNIQUE rechaza un duplicado aun saltándose la RPC (superusuario)','^ERR 23505',
  t2.sa('postgres', null, format($q$insert into public.canteen_sale_payments(club_id, sale_id, amount_cents, payment_date, payment_method, created_by, client_request_id) values (%L, (select id from public.canteen_sales limit 1), 1, current_date, 'cash', %L, %L), (%L, (select id from public.canteen_sales limit 1), 1, current_date, 'cash', %L, %L)$q$, t2.club('A'), t2.auth('staffA'), t2.k(900), t2.club('A'), t2.auth('staffA'), t2.k(900))));
select t2.t('0 estructura','request_hash con formato inválido se rechaza','^ERR 23514',
  t2.sa('postgres', null, $q$update public.canteen_sales set request_hash = 'xyz' where id = (select id from public.canteen_sales limit 1)$q$));

-- =============================== 1. Venta normal ===============================
select t2.put('S1', t2.sale('staffA','A', t2.items('agua:2','pel:1'), null, 'cash', 1));
select t2.t('1 venta normal','la venta se registra y devuelve su id',:'uuidre', t2.get('S1'));
select t2.t('1 venta normal','total = 2×150000 + 250000 = 550000, estado confirmed, request_hash sha256','^550000\|confirmed\|true$',
  t2.q(format($q$select total_cents || '|' || status || '|' || (request_hash ~ '^[0-9a-f]{64}$') from public.canteen_sales where id = '%s'$q$, t2.get('S1'))));
select t2.t('1 venta normal','2 ítems con precio histórico y 1 pago en efectivo por el total','^2\|550000\|1$',
  t2.q(format($q$select (select count(*) from public.canteen_sale_items where sale_id = '%1$s') || '|' || (select sum(unit_price_cents * quantity) from public.canteen_sale_items where sale_id = '%1$s') || '|' || (select count(*) from public.canteen_sale_payments where sale_id = '%1$s')$q$, t2.get('S1'))));

-- =============================== 2/3/4. Doble clic, respuesta perdida, reintento ===============================
select t2.put('n1', (select count(*)::text from public.canteen_sales));
select t2.t('2 doble clic','segundo envío con la misma clave y el mismo contenido devuelve la MISMA venta','^true$', (t2.sale('staffA','A', t2.items('agua:2','pel:1'), null, 'cash', 1) = t2.get('S1'))::text);
select t2.t('2 doble clic','tercer envío: sigue siendo una sola venta, un solo pago, un solo juego de ítems','^1\|1\|2$',
  t2.q(format($q$select (select count(*) from public.canteen_sales where client_request_id = %L) || '|' || (select count(*) from public.canteen_sale_payments where sale_id = '%s') || '|' || (select count(*) from public.canteen_sale_items where sale_id = '%s')$q$, t2.k(1), t2.get('S1'), t2.get('S1'))));
-- Respuesta perdida: el servidor confirma (statement aparte) y el cliente nunca recibe el resultado.
select t2.sale('staffA','A', t2.items('alf:3'), 'e0000000-0000-0000-0000-000000000004', null, 2) is not null as respuesta_descartada;
select t2.put('S2', t2.sale('staffA','A', t2.items('alf:3'), 'e0000000-0000-0000-0000-000000000004', null, 2));
select t2.t('3 respuesta perdida','el reintento recupera la venta ya confirmada (id = la fila persistida)','^true$',
  (t2.get('S2') = t2.q(format($q$select id::text from public.canteen_sales where client_request_id = %L$q$, t2.k(2))))::text);
select t2.t('3 respuesta perdida','no se creó una segunda venta ni un cobro (consumo pendiente sin pagos)','^1\|0$',
  t2.q(format($q$select (select count(*) from public.canteen_sales where client_request_id = %L) || '|' || (select count(*) from public.canteen_sale_payments where sale_id = '%s')$q$, t2.k(2), t2.get('S2'))));
select t2.t('4 reintento','mismos productos en otro orden y mismo contenido = misma operación','^true$',
  (t2.sale('staffA','A', t2.items('pel:1','agua:2'), null, 'cash', 1) = t2.get('S1'))::text);
select t2.t('4 reintento','la venta total de la tabla creció solo en 1 (la de la clave 2)','^1$', t2.q(format($q$select (count(*) - %s)::text from public.canteen_sales$q$, t2.get('n1'))));

-- =============================== 5. Reintento con contenido diferente ===============================
select t2.t('5 contenido distinto','misma clave con OTRA cantidad se rechaza (antes devolvía la venta vieja)','^ERR 23505', t2.sale('staffA','A', t2.items('agua:9','pel:1'), null, 'cash', 1));
select t2.t('5 contenido distinto','misma clave con un producto de más','^ERR 23505', t2.sale('staffA','A', t2.items('agua:2','pel:1','alf:1'), null, 'cash', 1));
select t2.t('5 contenido distinto','misma clave con otro medio de pago','^ERR 23505', t2.sale('staffA','A', t2.items('agua:2','pel:1'), null, 'bank_transfer', 1));
select t2.t('5 contenido distinto','misma clave convertida en consumo pendiente de una persona','^ERR 23505', t2.sale('staffA','A', t2.items('agua:2','pel:1'), 'e0000000-0000-0000-0000-000000000004', null, 1));
select t2.t('5 contenido distinto','misma clave de consumo pendiente con OTRA persona','^ERR 23505', t2.sale('staffA','A', t2.items('alf:3'), 'e0000000-0000-0000-0000-000000000001', null, 2));
select t2.t('5 contenido distinto','el rechazo no altera la venta original (total 550000, 1 fila)','^550000\|1$',
  t2.q(format($q$select total_cents || '|' || (select count(*) from public.canteen_sales where client_request_id = %L) from public.canteen_sales where id = '%s'$q$, t2.k(1), t2.get('S1'))));

-- =============================== 6. Venta nueva con los mismos productos ===============================
select t2.put('S1b', t2.sale('staffA','A', t2.items('agua:2','pel:1'), null, 'cash', 3));
select t2.t('6 venta nueva','misma lista de productos con una clave nueva crea OTRA venta (no se deduplica por contenido)','^true$', (t2.get('S1b') ~ :'uuidre' and t2.get('S1b') <> t2.get('S1'))::text);
select t2.t('6 venta nueva','las dos ventas existen con el mismo total','^2\|550000$',
  t2.q(format($q$select count(*) || '|' || max(total_cents) from public.canteen_sales where id in ('%s','%s') and total_cents = 550000$q$, t2.get('S1'), t2.get('S1b'))));

-- =============================== 7/8/9. Pagos de cuota ===============================
-- Juan: cuota 6.000.000. Pago de 2.000.000.
select t2.put('P1', t2.dpay('ownerA','A', t2.get('D1')::uuid, 2000000, 'cash', null, null, 10));
select t2.t('7 pago de cuota','pago normal registrado','^true$', (t2.get('P1') ~ :'uuidre' and t2.dpaid(t2.get('D1')::uuid) = 2000000)::text);
select t2.t('8 pago duplicado','reintento con la misma clave devuelve el pago original','^true$', (t2.dpay('ownerA','A', t2.get('D1')::uuid, 2000000, 'cash', null, null, 10) = t2.get('P1'))::text);
select t2.t('8 pago duplicado','no se registraron 4.000.000: un solo pago, pagado = 2.000.000','^1\|2000000$',
  t2.q(format($q$select (select count(*) from public.membership_due_payments where client_request_id = %L) || '|' || t2.dpaid('%s')$q$, t2.k(10), t2.get('D1'))));
select t2.t('8 pago duplicado','reintento con referencia/observación vacías equivale a null (normalización)','^true$', (t2.dpay('ownerA','A', t2.get('D1')::uuid, 2000000, 'cash', '  ', '', 10) = t2.get('P1'))::text);
select t2.t('8 pago duplicado','misma clave con otro importe se rechaza','^ERR 23505', t2.dpay('ownerA','A', t2.get('D1')::uuid, 2500000, 'cash', null, null, 10));
select t2.t('8 pago duplicado','misma clave con otro medio de pago','^ERR 23505', t2.dpay('ownerA','A', t2.get('D1')::uuid, 2000000, 'bank_transfer', null, null, 10));
select t2.t('8 pago duplicado','misma clave con otra fecha','^ERR 23505', t2.dpay('ownerA','A', t2.get('D1')::uuid, 2000000, 'cash', null, null, 10, date '2026-10-06'));
select t2.t('8 pago duplicado','misma clave con otra referencia','^ERR 23505', t2.dpay('ownerA','A', t2.get('D1')::uuid, 2000000, 'cash', 'REF-1', null, 10));
select t2.t('8 pago duplicado','misma clave aplicada a OTRA cuota','^ERR 23505', t2.dpay('ownerA','A', t2.get('D2')::uuid, 2000000, 'cash', null, null, 10));
select t2.t('8 pago duplicado','tras los rechazos el saldo no cambió','^2000000$', t2.dpaid(t2.get('D1')::uuid)::text);
-- 9. Dos pagos legítimos del mismo importe, con claves distintas.
select t2.put('P2', t2.dpay('ownerA','A', t2.get('D1')::uuid, 2000000, 'cash', null, null, 11));
select t2.t('9 pagos legítimos','otro pago del mismo importe con clave nueva SÍ se registra','^true$', (t2.get('P2') ~ :'uuidre' and t2.get('P2') <> t2.get('P1') and t2.dpaid(t2.get('D1')::uuid) = 4000000)::text);
select t2.put('P3', t2.dpay('ownerA','A', t2.get('D1')::uuid, 2000000, 'cash', null, null, 12));
select t2.t('9 pagos legítimos','tercer pago deja la cuota saldada (6.000.000)','^6000000$', t2.dpaid(t2.get('D1')::uuid)::text);
select t2.t('9 pagos legítimos','reenviar el pago que SALDÓ la cuota devuelve el original (no falla por "supera el saldo")','^true$', (t2.dpay('ownerA','A', t2.get('D1')::uuid, 2000000, 'cash', null, null, 12) = t2.get('P3'))::text);
select t2.t('12 sobrepagos','con la cuota saldada, un pago nuevo (clave nueva) se rechaza por sobrepago','^ERR 22023', t2.dpay('ownerA','A', t2.get('D1')::uuid, 1, 'cash', null, null, 13));
select t2.t('12 sobrepagos','el rechazo por sobrepago no deja fila con esa clave','^0$', t2.q(format($q$select count(*)::text from public.membership_due_payments where client_request_id = %L$q$, t2.k(13))));
select t2.t('17 saldos','cuota de Juan: pagado 6.000.000 = importe; ninguna cuota sobrepagada','^6000000\|0$',
  t2.q(format($q$select t2.dpaid('%s') || '|' || (select count(*) from public.membership_dues d where t2.dpaid(d.id) > d.amount_cents)$q$, t2.get('D1'))));

-- =============================== 10/11/12. Pagos de cantina ===============================
-- Consumo pendiente S2: Alfajor×3 = 300000 de la persona 4.
select t2.put('C1', t2.cpay('staffA','A', t2.get('S2')::uuid, 100000, 'cash', null, null, 20));
select t2.t('10 pago de cantina','pago parcial de un consumo pendiente registrado; saldo 200000','^true$', (t2.get('C1') ~ :'uuidre' and t2.cpaid(t2.get('S2')::uuid) = 100000)::text);
select t2.t('11 reintento de pago','reintento con la misma clave devuelve el pago original','^true$', (t2.cpay('staffA','A', t2.get('S2')::uuid, 100000, 'cash', null, null, 20) = t2.get('C1'))::text);
select t2.t('11 reintento de pago','un solo movimiento y el saldo sigue en 200000','^1\|100000$', t2.q(format($q$select (select count(*) from public.canteen_sale_payments where client_request_id = %L) || '|' || t2.cpaid('%s')$q$, t2.k(20), t2.get('S2'))));
select t2.t('11 reintento de pago','misma clave con otro importe se rechaza','^ERR 23505', t2.cpay('staffA','A', t2.get('S2')::uuid, 150000, 'cash', null, null, 20));
select t2.t('11 reintento de pago','misma clave con otro medio de pago se rechaza','^ERR 23505', t2.cpay('staffA','A', t2.get('S2')::uuid, 100000, 'other', null, null, 20));
select t2.t('11 reintento de pago','misma clave sobre OTRA venta se rechaza','^ERR 23505', t2.cpay('staffA','A', t2.get('S1')::uuid, 100000, 'cash', null, null, 20));
select t2.put('C2', t2.cpay('staffA','A', t2.get('S2')::uuid, 100000, 'cash', null, null, 21));
select t2.t('11 reintento de pago','segundo pago legítimo del mismo importe con clave nueva SÍ se registra','^true$', (t2.get('C2') ~ :'uuidre' and t2.get('C2') <> t2.get('C1') and t2.cpaid(t2.get('S2')::uuid) = 200000)::text);
select t2.t('12 sobrepagos','pago que excede el saldo (100000 restantes; se intenta 100001) se rechaza','^ERR 22023', t2.cpay('staffA','A', t2.get('S2')::uuid, 100001, 'cash', null, null, 22));
select t2.put('C3', t2.cpay('staffA','A', t2.get('S2')::uuid, 100000, 'cash', null, null, 23));
select t2.t('12 sobrepagos','el pago exacto salda el consumo (300000)','^300000$', t2.cpaid(t2.get('S2')::uuid)::text);
select t2.t('12 sobrepagos','reenviar el pago que saldó el consumo devuelve el original','^true$', (t2.cpay('staffA','A', t2.get('S2')::uuid, 100000, 'cash', null, null, 23) = t2.get('C3'))::text);
select t2.t('12 sobrepagos','con el consumo saldado, un pago nuevo se rechaza','^ERR 22023', t2.cpay('staffA','A', t2.get('S2')::uuid, 1, 'cash', null, null, 24));

-- =============================== 14. Aislamiento entre clubes ===============================
-- La clave 1 ya existe en el club A. El club B puede usarla de forma independiente y NO recibe la venta de A.
select t2.put('SB', t2.sale('ownerB','B', t2.items('pelB:1'), null, 'cash', 1));
select t2.t('14 aislamiento','el club B usa la misma clave y obtiene SU propia venta (no la del club A)','^true$', (t2.get('SB') ~ :'uuidre' and t2.get('SB') <> t2.get('S1') and t2.q(format($q$select club_id::text from public.canteen_sales where id = '%s'$q$, t2.get('SB'))) = t2.club('B')::text)::text);
select t2.t('14 aislamiento','la misma clave existe una vez por club y la venta de A no cambió','^2\|550000$', t2.q(format($q$select (select count(*) from public.canteen_sales where client_request_id = %L) || '|' || (select total_cents from public.canteen_sales where id = '%s')$q$, t2.k(1), t2.get('S1'))));
select t2.t('14 aislamiento','el club B reintenta con la clave de A y SU contenido: devuelve la de B','^true$', (t2.sale('ownerB','B', t2.items('pelB:1'), null, 'cash', 1) = t2.get('SB'))::text);
select t2.t('14 aislamiento','owner B no puede operar en el club A (venta con la clave de A)','^ERR 42501', t2.sale('ownerB','A', t2.items('agua:2','pel:1'), null, 'cash', 1));
select t2.t('14 aislamiento','owner B no recupera un pago de cuota de A por su clave','^ERR 42501', t2.dpay('ownerB','A', t2.get('D1')::uuid, 2000000, 'cash', null, null, 10));
select t2.t('14 aislamiento','owner B con su club y la cuota de A: la cuota no existe en su club','^ERR 23503', t2.dpay('ownerB','B', t2.get('D1')::uuid, 2000000, 'cash', null, null, 10));
select t2.t('14 aislamiento','el club B puede registrar un pago con la clave 10 en SU cuota (clave independiente)','^true$', (t2.dpay('ownerB','B', t2.get('DB')::uuid, 1000000, 'cash', null, null, 10) ~ :'uuidre')::text);
select t2.t('14 aislamiento','tras eso, la clave 10 existe una vez por club y el pago de A no cambió','^2\|2000000$', t2.q(format($q$select (select count(*) from public.membership_due_payments where client_request_id = %L) || '|' || (select amount_cents from public.membership_due_payments where id = '%s')$q$, t2.k(10), t2.get('P1'))));
select t2.t('14 aislamiento','staff de A no paga una venta del club B','^ERR (42501|23503)', t2.cpay('staffA','B', t2.get('SB')::uuid, 100000, 'cash', null, null, 30));
select t2.t('14 aislamiento','venta en club B con un producto del club A se rechaza','^ERR 23503', t2.sale('ownerB','B', t2.items('agua:1'), null, 'cash', 31));
select t2.t('14 aislamiento','RLS: owner B no ve por clave las ventas ni los pagos del club A','^OK rows=0',
  t2.sau('ownerB', format($q$select 1 from public.canteen_sales where club_id = %L and client_request_id = %L$q$, t2.club('A'), t2.k(2))));
select t2.t('14 aislamiento','RLS: staff A recupera su venta por clave (consulta de recuperación del frontend)','^OK rows=1',
  t2.sau('staffA', format($q$select id from public.canteen_sales where club_id = %L and client_request_id = %L$q$, t2.club('A'), t2.k(2))));
select t2.t('14 aislamiento','RLS: owner A recupera su pago de cuota por clave (consulta de recuperación del frontend)','^OK rows=1',
  t2.sau('ownerA', format($q$select id from public.membership_due_payments where club_id = %L and client_request_id = %L$q$, t2.club('A'), t2.k(10))));


-- =============================== 15. Permisos ===============================
select t2.t('15 permisos','staff NO registra pagos de cuota (permiso existente)','^ERR 42501', t2.dpay('staffA','A', t2.get('D2')::uuid, 100000, 'cash', null, null, 40));
select t2.t('15 permisos','admin sí registra pagos de cuota','^true$', (t2.dpay('adminA','A', t2.get('D2')::uuid, 100000, 'cash', null, null, 41) ~ :'uuidre')::text);
select t2.t('15 permisos','jugador sin rol: venta rechazada','^ERR 42501', t2.sale('player','A', t2.items('agua:1'), null, 'cash', 42));
select t2.t('15 permisos','jugador sin rol: pago de cuota rechazado','^ERR 42501', t2.dpay('player','A', t2.get('D2')::uuid, 100, 'cash', null, null, 43));
select t2.t('15 permisos','jugador sin rol: pago de cantina rechazado','^ERR 42501', t2.cpay('player','A', t2.get('S2')::uuid, 100, 'cash', null, null, 44));
select t2.t('15 permisos','usuario sin club: venta rechazada','^ERR 42501', t2.sale('outsider','A', t2.items('agua:1'), null, 'cash', 45));
select t2.t('15 permisos','anon: venta rechazada','^ERR 42501', t2.sa('anon', null, format($q$select public.create_canteen_sale(%L, '[]'::jsonb, null, 'cash', %L)$q$, t2.club('A'), t2.k(46))));
select t2.t('15 permisos','anon: pago de cuota rechazado','^ERR 42501', t2.sa('anon', null, format($q$select public.record_membership_due_payment(%L, %L, 1, current_date, 'cash', null, null, %L)$q$, t2.club('A'), t2.get('D2'), t2.k(47))));
select t2.t('15 permisos','anon: pago de cantina rechazado','^ERR 42501', t2.sa('anon', null, format($q$select public.record_canteen_sale_payment(%L, %L, 1, current_date, 'cash', null, null, %L)$q$, t2.club('A'), t2.get('S2'), t2.k(48))));
select t2.t('15 permisos','otro usuario del mismo club NO recupera la venta de staffA con su clave (23505)','^ERR 23505', t2.sale('adminA','A', t2.items('agua:2','pel:1'), null, 'cash', 1));
select t2.t('15 permisos','otro administrador NO recupera el pago de ownerA con su clave (23505)','^ERR 23505', t2.dpay('adminA','A', t2.get('D1')::uuid, 2000000, 'cash', null, null, 10));
select t2.t('15 permisos','la clave de operación es obligatoria: venta sin clave','^ERR 22023',
  t2.sau('staffA', format($q$select public.create_canteen_sale(%L, %L::jsonb, null, 'cash')$q$, t2.club('A'), t2.items('agua:1'))));
select t2.t('15 permisos','la clave de operación es obligatoria: pago de cuota sin clave','^ERR 22023',
  t2.sau('ownerA', format($q$select public.record_membership_due_payment(%L, %L, 100, current_date, 'cash')$q$, t2.club('A'), t2.get('D2'))));
select t2.t('15 permisos','la clave de operación es obligatoria: pago de cantina sin clave','^ERR 22023',
  t2.sau('staffA', format($q$select public.record_canteen_sale_payment(%L, %L, 100, current_date, 'cash')$q$, t2.club('A'), t2.get('S1'))));
select t2.t('15 permisos','validaciones previas intactas: pago de importe 0','^ERR 22023', t2.dpay('ownerA','A', t2.get('D2')::uuid, 0, 'cash', null, null, 50));
select t2.t('15 permisos','validaciones previas intactas: método de pago inválido','^ERR 22023', t2.dpay('ownerA','A', t2.get('D2')::uuid, 100, 'bitcoin', null, null, 51));
select t2.t('15 permisos','validaciones previas intactas: venta sin ítems','^ERR 22023', t2.sale('staffA','A', '[]', null, 'cash', 52));
select t2.t('15 permisos','validaciones previas intactas: producto repetido','^ERR 22023', t2.sale('staffA','A', t2.items('agua:1','agua:2'), null, 'cash', 53));
select t2.t('15 permisos','validaciones previas intactas: cantidad 0','^ERR 22023', t2.sale('staffA','A', t2.items('agua:0'), null, 'cash', 54));
select t2.t('15 permisos','validaciones previas intactas: consumo pendiente sin persona','^ERR 22023', t2.sale('staffA','A', t2.items('agua:1'), null, null, 55));
select t2.t('15 permisos','validaciones previas intactas: persona de otro club','^ERR 23503', t2.sale('staffA','A', t2.items('agua:1'), 'e0000000-0000-0000-0000-0000000000b1', null, 56));
select t2.t('15 permisos','las validaciones fallidas no dejan filas con esas claves','^0$',
  t2.q(format($q$select (select count(*) from public.canteen_sales where client_request_id in (%L,%L,%L,%L,%L,%L)) + (select count(*) from public.membership_due_payments where client_request_id in (%L,%L,%L,%L)) + (select count(*) from public.canteen_sale_payments where client_request_id in (%L,%L))$q$,
    t2.k(42), t2.k(45), t2.k(52), t2.k(53), t2.k(54), t2.k(56), t2.k(40), t2.k(43), t2.k(50), t2.k(51), t2.k(44), t2.k(48))));

-- =============================== 16. Compatibilidad con anulaciones ===============================
select t2.put('D2_before', t2.dpaid(t2.get('D2')::uuid)::text);
select t2.put('PV', t2.dpay('ownerA','A', t2.get('D2')::uuid, 1000000, 'cash', null, null, 60));
select t2.t('16 anulaciones','pago de cuota nuevo registrado','^true$', (t2.get('PV') ~ :'uuidre' and t2.dpaid(t2.get('D2')::uuid) = t2.get('D2_before')::bigint + 1000000)::text);
select t2.t('16 anulaciones','el pago se anula con la RPC existente','^OK', t2.sau('ownerA', format($q$select public.void_membership_due_payment('%s', 'carga duplicada')$q$, t2.get('PV'))));
select t2.t('16 anulaciones','el saldo se libera tras anular','^true$', (t2.dpaid(t2.get('D2')::uuid) = t2.get('D2_before')::bigint)::text);
select t2.t('16 anulaciones','reintentar la clave del pago ANULADO devuelve el original (anulado), sin crear otro pago','^true$',
  (t2.dpay('ownerA','A', t2.get('D2')::uuid, 1000000, 'cash', null, null, 60) = t2.get('PV')
   and t2.q(format($q$select count(*)::text from public.membership_due_payments where client_request_id = %L and voided_at is not null$q$, t2.k(60))) = '1'
   and t2.dpaid(t2.get('D2')::uuid) = t2.get('D2_before')::bigint)::text);
select t2.t('16 anulaciones','un cobro nuevo con clave nueva funciona tras la anulación','^true$', (t2.dpay('ownerA','A', t2.get('D2')::uuid, 1000000, 'cash', null, null, 61) ~ :'uuidre')::text);
select t2.t('16 anulaciones','un pago ya anulado no se anula dos veces (comportamiento existente)','^ERR 22023', t2.sau('ownerA', format($q$select public.void_membership_due_payment('%s', 'otra vez')$q$, t2.get('PV'))));
select t2.put('SV', t2.sale('staffA','A', t2.items('alf:1'), 'e0000000-0000-0000-0000-000000000004', null, 62));
select t2.t('16 anulaciones','venta pendiente sin pagos se anula con la RPC existente','^OK', t2.sau('ownerA', format($q$select public.void_canteen_sale('%s', 'error de carga')$q$, t2.get('SV'))));
select t2.t('16 anulaciones','reintentar la clave de la venta ANULADA devuelve esa venta (voided), sin crear otra','^true\|voided\|1$',
  ((t2.sale('staffA','A', t2.items('alf:1'), 'e0000000-0000-0000-0000-000000000004', null, 62) = t2.get('SV'))::text || '|' ||
   t2.q(format($q$select status from public.canteen_sales where id = '%s'$q$, t2.get('SV'))) || '|' ||
   t2.q(format($q$select count(*)::text from public.canteen_sales where client_request_id = %L$q$, t2.k(62)))));
select t2.t('16 anulaciones','una venta con pagos de cantina sigue sin poder anularse (S2 saldada)','^ERR 22023', t2.sau('ownerA', format($q$select public.void_canteen_sale('%s', 'x')$q$, t2.get('S2'))));
select t2.t('16 anulaciones','una venta cobrada en el acto sigue sin poder anularse (S1)','^ERR 22023', t2.sau('ownerA', format($q$select public.void_canteen_sale('%s', 'x')$q$, t2.get('S1'))));

-- =============================== 17. Preservación de datos históricos y saldos ===============================
select t2.t('17 histórico','ventas históricas idénticas (huella md5)','^true$', (t2.fp('sales') = (select val from t2.snap where name = 'sales'))::text);
select t2.t('17 histórico','ítems históricos idénticos','^true$', (t2.fp('items') = (select val from t2.snap where name = 'items'))::text);
select t2.t('17 histórico','pagos de cantina históricos idénticos','^true$', (t2.fp('cpay') = (select val from t2.snap where name = 'cpay'))::text);
select t2.t('17 histórico','pagos de cuota históricos idénticos (incluye el anulado)','^true$', (t2.fp('dpay') = (select val from t2.snap where name = 'dpay'))::text);
select t2.t('17 histórico','cuotas idénticas','^true$', (t2.fp('dues') = (select val from t2.snap where name = 'dues'))::text);
select t2.t('17 histórico','las 2 ventas históricas quedaron con request_hash NULL','^2$',
  t2.q($q$select count(*)::text from public.canteen_sales s join t2.legacy_ids l on l.tbl = 'sales' and l.id = s.id where s.request_hash is null$q$));
select t2.t('17 histórico','los pagos históricos (cuota y cantina) quedaron con client_request_id NULL','^0$',
  t2.q($q$select ((select count(*) from public.canteen_sale_payments p join t2.legacy_ids l on l.tbl = 'cpay' and l.id = p.id where p.client_request_id is not null) + (select count(*) from public.membership_due_payments p join t2.legacy_ids l on l.tbl = 'dpay' and l.id = p.id where p.client_request_id is not null))::text$q$));
-- Reintento con la clave de una venta histórica (f1…01, Agua×2 en efectivo): contenido no verificable => se rechaza.
select t2.t('17 histórico','reintentar la clave de una venta anterior a 10B.2 se rechaza (no se devuelve a ciegas)','^ERR 23505',
  t2.sau('staffA', $q$select public.create_canteen_sale('c0000000-0000-0000-0000-00000000000a','[{"product_id":"b1000000-0000-0000-0000-0000000000a1","quantity":2}]'::jsonb,null,'cash','f1000000-0000-0000-0000-000000000001')$q$));
select t2.t('17 histórico','sigue habiendo una sola venta con esa clave histórica','^1$', t2.q($q$select count(*)::text from public.canteen_sales where client_request_id = 'f1000000-0000-0000-0000-000000000001'$q$));
-- Saldos con registros históricos y nuevos juntos.
-- Socia 2 (D2): histórico válido 1.000.000 (+500.000 anulado) + admin 100.000 + 1.000.000 (anulado luego repetido) = ver abajo.
select t2.t('17 saldos','cuota de la socia 2: pagos válidos = histórico 1.000.000 + 100.000 (admin) + 1.000.000 (clave 61)','^2100000$', t2.dpaid(t2.get('D2')::uuid)::text);
select t2.t('17 saldos','sobrepago sobre cuota con histórico: 3.900.001 de saldo 3.900.000 se rechaza','^ERR 22023', t2.dpay('ownerA','A', t2.get('D2')::uuid, 3900001, 'cash', null, null, 70));
select t2.t('17 saldos','el saldo exacto (3.900.000) se acepta y salda la cuota','^true$', (t2.dpay('ownerA','A', t2.get('D2')::uuid, 3900000, 'cash', null, null, 71) ~ :'uuidre' and t2.dpaid(t2.get('D2')::uuid) = 6000000)::text);
-- Venta histórica L2: Alfajor×3 = 300000, pagado 50000 (pago histórico sin clave). Saldo 250000.
select t2.put('L2', t2.q($q$select id::text from public.canteen_sales where client_request_id = 'f1000000-0000-0000-0000-000000000002'$q$));
select t2.t('17 saldos','consumo histórico con pago histórico sin clave: pagado 50000','^50000$', t2.cpaid(t2.get('L2')::uuid)::text);
select t2.t('17 saldos','sobrepago del consumo histórico (250001 sobre saldo 250000) se rechaza','^ERR 22023', t2.cpay('staffA','A', t2.get('L2')::uuid, 250001, 'cash', null, null, 72));
select t2.t('17 saldos','pago exacto del saldo del consumo histórico se acepta con clave y reintento idempotente','^true$',
  (t2.cpay('staffA','A', t2.get('L2')::uuid, 250000, 'cash', null, null, 73) ~ :'uuidre' and t2.cpay('staffA','A', t2.get('L2')::uuid, 250000, 'cash', null, null, 73) ~ :'uuidre' and t2.cpaid(t2.get('L2')::uuid) = 300000
   and t2.q(format($q$select count(*)::text from public.canteen_sale_payments where client_request_id = %L$q$, t2.k(73))) = '1')::text);
select t2.t('17 saldos','invariante global: ninguna cuota con pagos válidos > importe y ninguna venta pagada de más','^0\|0$',
  t2.q($q$select (select count(*) from public.membership_dues d where t2.dpaid(d.id) > d.amount_cents) || '|' || (select count(*) from public.canteen_sales s where t2.cpaid(s.id) > s.total_cents)$q$));
select t2.t('17 saldos','invariante: cada venta confirmada con cobro inmediato tiene exactamente el pago por su total','^0$',
  t2.q($q$select count(*)::text from public.canteen_sales s where s.status = 'confirmed' and s.customer_person_id is null and t2.cpaid(s.id) <> s.total_cents$q$));
select t2.t('17 saldos','invariante: ninguna clave repetida dentro de un club (ventas, pagos de cuota, pagos de cantina)','^0\|0\|0$',
  t2.q($q$select (select count(*) from (select 1 from public.canteen_sales group by club_id, client_request_id having count(*) > 1) a) || '|' || (select count(*) from (select 1 from public.membership_due_payments where client_request_id is not null group by club_id, client_request_id having count(*) > 1) b) || '|' || (select count(*) from (select 1 from public.canteen_sale_payments where client_request_id is not null group by club_id, client_request_id having count(*) > 1) c)$q$));

-- =============================== Resumen ===============================
\echo
\echo '=== CONTROL NEGATIVO (estado ANTERIOR a la migración: el hallazgo SEC-05 existía) ==='
select ok as "hallazgo_reproducido", test from t2.results where area = 'CONTROL-ANTES' order by n;
\echo
\echo '=== RESUMEN SPRINT 10B.2 (estado POSTERIOR a la migración) ==='
select area, count(*) as total, count(*) filter (where ok) as cumple, count(*) filter (where not ok) as no_cumple
from t2.results where area <> 'CONTROL-ANTES' group by area order by area;
select 'TOTAL' as area, count(*) as total, count(*) filter (where ok) as cumple, count(*) filter (where not ok) as no_cumple from t2.results where area <> 'CONTROL-ANTES';
\echo '=== PRUEBAS QUE NO CUMPLEN ==='
select n, area, test, expected, actual from t2.results where not ok and area <> 'CONTROL-ANTES' order by n;
