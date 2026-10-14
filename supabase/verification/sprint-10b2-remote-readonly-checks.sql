-- Sprint 10B.2 — comprobaciones de SOLO LECTURA (SELECT) de SEC-05. Aptas para el SQL Editor de Supabase (no modifican nada).
-- Antes de aplicar 20261014060000: las filas de estructura dan `f`. Después: todas deben dar `t`.
-- Las filas informativas (`info_*`) no son pass/fail: muestran cuántos registros anteriores a 10B.2 existen (sin clave).
-- No sustituyen la prueba manual con la aplicación y usuarios reales de dos clubes (ver docs/SECURITY_AUDIT.md §10.7).
select 'columna canteen_sales.request_hash' as comprobacion,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'canteen_sales' and column_name = 'request_hash') as ok
union all select 'columna membership_due_payments.client_request_id',
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'membership_due_payments' and column_name = 'client_request_id')
union all select 'columna canteen_sale_payments.client_request_id',
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'canteen_sale_payments' and column_name = 'client_request_id')
union all select 'UNIQUE (club_id, client_request_id) en ventas, pagos de cuota y pagos de cantina',
  (select count(*) = 3 from pg_constraint where contype = 'u' and conname in ('canteen_sales_club_id_client_request_id_key', 'membership_due_payments_club_request_key', 'canteen_sale_payments_club_request_key'))
union all select 'las 3 RPC existen con la firma nueva',
  to_regprocedure('public.create_canteen_sale(uuid,jsonb,uuid,text,uuid)') is not null
  and to_regprocedure('public.record_membership_due_payment(uuid,uuid,bigint,date,text,text,text,uuid)') is not null
  and to_regprocedure('public.record_canteen_sale_payment(uuid,uuid,bigint,date,text,text,text,uuid)') is not null
union all select 'las firmas anteriores de pagos (7 argumentos, sin clave) ya no existen',
  to_regprocedure('public.record_membership_due_payment(uuid,uuid,bigint,date,text,text,text)') is null
  and to_regprocedure('public.record_canteen_sale_payment(uuid,uuid,bigint,date,text,text,text)') is null
union all select 'create_canteen_sale ya no genera una clave aleatoria por defecto',
  coalesce((select pg_get_function_arguments(to_regprocedure('public.create_canteen_sale(uuid,jsonb,uuid,text,uuid)')::oid) not like '%gen_random_uuid%'), false)
union all select 'las 3 RPC son SECURITY DEFINER con search_path fijo',
  (select count(*) = 3 from pg_proc p where p.prosecdef and p.proconfig @> array['search_path=pg_catalog, public']
     and p.oid in (to_regprocedure('public.create_canteen_sale(uuid,jsonb,uuid,text,uuid)'), to_regprocedure('public.record_membership_due_payment(uuid,uuid,bigint,date,text,text,text,uuid)'), to_regprocedure('public.record_canteen_sale_payment(uuid,uuid,bigint,date,text,text,text,uuid)')))
union all select 'anon y PUBLIC sin EXECUTE; authenticated con EXECUTE (3 RPC)',
  coalesce((select bool_and(not has_function_privilege('anon', f, 'execute') and not has_function_privilege(0, f, 'execute') and has_function_privilege('authenticated', f, 'execute'))
     from unnest(array[to_regprocedure('public.create_canteen_sale(uuid,jsonb,uuid,text,uuid)'), to_regprocedure('public.record_membership_due_payment(uuid,uuid,bigint,date,text,text,text,uuid)'), to_regprocedure('public.record_canteen_sale_payment(uuid,uuid,bigint,date,text,text,text,uuid)')]) f where f is not null), false)
-- Integridad (válidas antes y después de la migración): no debe existir ninguna clave repetida ni saldo excedido.
union all select 'ninguna cuota con pagos válidos mayores al importe',
  not exists (select 1 from public.membership_dues d where coalesce((select sum(p.amount_cents) from public.membership_due_payments p where p.due_id = d.id and p.voided_at is null), 0) > d.amount_cents)
union all select 'ninguna venta de cantina con pagos mayores al total',
  not exists (select 1 from public.canteen_sales s where coalesce((select sum(p.amount_cents) from public.canteen_sale_payments p where p.sale_id = s.id), 0) > s.total_cents)
union all select 'ninguna clave de venta repetida dentro de un club',
  not exists (select 1 from public.canteen_sales group by club_id, client_request_id having count(*) > 1);

-- Informativo (requiere la migración aplicada): registros históricos que quedaron sin clave/hash, por diseño.
select 'info_ventas_anteriores_sin_request_hash' as dato, count(*) as cantidad from public.canteen_sales where request_hash is null
union all select 'info_ventas_con_request_hash', count(*) from public.canteen_sales where request_hash is not null
union all select 'info_pagos_de_cuota_sin_clave', count(*) from public.membership_due_payments where client_request_id is null
union all select 'info_pagos_de_cantina_sin_clave', count(*) from public.canteen_sale_payments where client_request_id is null;
