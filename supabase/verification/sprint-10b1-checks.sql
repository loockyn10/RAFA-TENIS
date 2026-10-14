-- Sprint 10B.1 — verificaciones de SEC-01…SEC-04 en un PostgreSQL LOCAL DESCARTABLE (no Supabase).
-- Requiere sprint-10b1-seed.sql ya ejecutado y TODAS las migraciones aplicadas (o el estado previo para el control negativo).
-- No falla ante pruebas incumplidas: registra en t10.results y lista las que no cumplen la expectativa segura.
-- Uso: psql -d <base_descartable> -f supabase/verification/sprint-10b1-checks.sql
\set ON_ERROR_STOP off
set client_min_messages = warning;
truncate t10.results;
drop table if exists t10.codes;
create table t10.codes (name text primary key, code text);

-- Genera una invitación como owner/admin y guarda el código en claro (solo existe en esta base descartable).
create or replace function t10.mk_invite(p_name text, p_user text, p_club text, p_person text, p_interval text) returns text language plpgsql as $$
declare v text;
begin
  v := t10.va('authenticated', p_user, format($q$select (public.create_player_invitation('{%s}','{%s}', now() + interval '%s'))->>'code'$q$, p_club, p_person, p_interval));
  insert into t10.codes values (p_name, v) on conflict (name) do update set code = excluded.code;
  return v;
end $$;
create or replace function t10.redeem(p_user text, p_name text) returns text language sql as $$
  select t10.va(case when p_user is null then 'anon' else 'authenticated' end, p_user, format($q$select public.redeem_player_invitation(%L)::text$q$, (select code from t10.codes where name = p_name))) $$;

-- =============================== SEC-01: invitaciones ===============================
select t10.t('SEC-01','generar invitación (owner A, persona A) devuelve código de 64 hex','^[0-9a-f]{64}$', t10.mk_invite('c1','ownerA','clubA','inv1','1 day'));
select t10.t('SEC-01','el código no se guarda en claro (solo SHA-256)','^0$', (select count(*)::text from public.player_invitations where token_hash = (select code from t10.codes where name = 'c1')));
select t10.t('SEC-01','canjear con cuenta Auth sin vínculo funciona (no 42883)','"club_id": "c0000000-0000-0000-0000-00000000000a".*"person_id": "e0000000-0000-0000-0000-0000000000f1"', t10.redeem('r1','c1'));
select t10.t('SEC-01','el canje vincula Auth↔persona en el club de la invitación','^1$', (select count(*)::text from public.club_person_auth_links where club_id = (select val::uuid from t10.tok where name = 'clubA') and person_id = (select val::uuid from t10.tok where name = 'inv1') and auth_user_id = (select val::uuid from t10.tok where name = 'r1')));
select t10.t('SEC-01','la invitación queda marcada como usada por esa cuenta','^(t|true)$', (select (redeemed_at is not null and redeemed_by = (select val::uuid from t10.tok where name = 'r1'))::text from public.player_invitations where person_id = (select val::uuid from t10.tok where name = 'inv1')));
select t10.t('SEC-01','la cuenta canjeada accede al portal (player_access_context)','Invitada 1', t10.va('authenticated','r1',$q$select public.player_access_context()::text$q$));
select t10.t('SEC-01','segundo canje del mismo código (misma cuenta) rechazado con mensaje genérico','^ERR 22023 No pudimos validar', t10.redeem('r1','c1'));
select t10.t('SEC-01','segundo canje del mismo código (otra cuenta) rechazado','^ERR 22023 No pudimos validar', t10.redeem('r2','c1'));
select t10.t('SEC-01','el segundo canje no crea otro vínculo','^1$', (select count(*)::text from public.club_person_auth_links where person_id = (select val::uuid from t10.tok where name = 'inv1')));
select t10.t('SEC-01','código inexistente: mensaje genérico (no revela error interno)','^ERR 22023 No pudimos validar', t10.va('authenticated','r2',$q$select public.redeem_player_invitation(repeat('a', 64))$q$));
select t10.t('SEC-01','código demasiado corto: mensaje genérico','^ERR 22023 No pudimos validar', t10.va('authenticated','r2',$q$select public.redeem_player_invitation('abc')$q$));
select t10.t('SEC-01','anon no puede canjear','^ERR 42501', t10.redeem(null,'c1'));

select t10.t('SEC-01','invitación revocada: se genera','^[0-9a-f]{64}$', t10.mk_invite('c2','ownerA','clubA','inv2','1 day'));
select t10.t('SEC-01','admin revoca la invitación','^OK', t10.sa('authenticated','adminA',format($q$select public.revoke_player_invitation(%L)$q$, (select id from public.player_invitations where person_id = (select val::uuid from t10.tok where name = 'inv2') and revoked_at is null))));
select t10.t('SEC-01','canje de invitación revocada rechazado','^ERR 22023 No pudimos validar', t10.redeem('r3','c2'));
select t10.t('SEC-01','no se vinculó la persona revocada','^0$', (select count(*)::text from public.club_person_auth_links where person_id = (select val::uuid from t10.tok where name = 'inv2')));

select t10.t('SEC-01','invitación vencida: se genera','^[0-9a-f]{64}$', t10.mk_invite('c3','ownerA','clubA','inv3','1 day'));
update public.player_invitations set expires_at = now() - interval '1 minute' where person_id = (select val::uuid from t10.tok where name = 'inv3');
select t10.t('SEC-01','canje de invitación vencida rechazado','^ERR 22023 No pudimos validar', t10.redeem('r3','c3'));
select t10.t('SEC-01','no se vinculó la persona de la invitación vencida','^0$', (select count(*)::text from public.club_person_auth_links where person_id = (select val::uuid from t10.tok where name = 'inv3')));

select t10.t('SEC-01','una invitación nueva revoca la anterior pendiente (comportamiento preservado)','^[0-9a-f]{64}$', t10.mk_invite('c4a','ownerA','clubA','inv4','1 day'));
select t10.t('SEC-01','segunda invitación a la misma persona','^[0-9a-f]{64}$', t10.mk_invite('c4b','ownerA','clubA','inv4','1 day'));
select t10.t('SEC-01','la invitación anterior queda inutilizable','^ERR 22023 No pudimos validar', t10.redeem('r4','c4a'));
select t10.t('SEC-01','cuenta ya vinculada en el club no puede canjear otra persona del mismo club','^ERR 23505', t10.redeem('r1','c4b'));
select t10.t('SEC-01','otra cuenta sí canjea la vigente','person_id', t10.redeem('r4','c4b'));

select t10.t('SEC-01','persona inactiva: invitar rechazado','^ERR 23503', t10.va('authenticated','ownerA',$q$select public.create_player_invitation('{clubA}','{inv6}', now() + interval '1 day')::text$q$));
select t10.t('SEC-01','aislamiento: owner A no puede invitar personas del club B','^ERR 42501', t10.va('authenticated','ownerA',$q$select public.create_player_invitation('{clubB}','{invB}', now() + interval '1 day')::text$q$));
select t10.t('SEC-01','aislamiento: owner A no puede invitar usando club A con persona de B','^ERR 23503', t10.va('authenticated','ownerA',$q$select public.create_player_invitation('{clubA}','{invB}', now() + interval '1 day')::text$q$));
select t10.t('SEC-01','staff (no owner/admin) no puede generar invitaciones','^ERR 42501', t10.va('authenticated','staffA',$q$select public.create_player_invitation('{clubA}','{inv5}', now() + interval '1 day')::text$q$));
select t10.t('SEC-01','jugador no puede generar invitaciones','^ERR 42501', t10.va('authenticated','pA1',$q$select public.create_player_invitation('{clubA}','{inv5}', now() + interval '1 day')::text$q$));
select t10.t('SEC-01','invitación de club B: se genera por owner B','^[0-9a-f]{64}$', t10.mk_invite('cB','ownerB','clubB','invB','1 day'));
select t10.t('SEC-01','owner A no puede revocar invitaciones del club B (mismo error que si no existiera)','^ERR 42501', t10.sa('authenticated','ownerA',format($q$select public.revoke_player_invitation(%L)$q$, (select id from public.player_invitations where person_id = (select val::uuid from t10.tok where name = 'invB') and revoked_at is null))));
select t10.t('SEC-01','owner A no puede listar invitaciones del club B','^ERR 42501', t10.va('authenticated','ownerA',$q$select public.list_player_invitations('{clubB}')::text$q$));
select t10.t('SEC-01','canje de invitación de B por una cuenta sin vínculo funciona','club_id', t10.redeem('r5','cB'));
select t10.t('SEC-01','ese canje vincula solo en club B','^1$', (select count(*)::text from public.club_person_auth_links where person_id = (select val::uuid from t10.tok where name = 'invB') and club_id = (select val::uuid from t10.tok where name = 'clubB')));
select t10.t('SEC-01','ese canje no creó vínculos en club A para esa cuenta','^0$', (select count(*)::text from public.club_person_auth_links where auth_user_id = (select val::uuid from t10.tok where name = 'r5') and club_id = (select val::uuid from t10.tok where name = 'clubA')));

-- =============================== SEC-02: RPC y anon ===============================
create temp table fn14(sig text);
insert into fn14 values
 ('public.create_weekly_reservation_series(uuid, uuid, text, text, timestamptz, timestamptz, smallint)'),
 ('public.create_weekly_reservation_series(uuid, uuid, text, uuid, text, timestamptz, timestamptz, smallint)'),
 ('public.set_club_fee_settings(uuid, bigint, smallint)'), ('public.generate_membership_dues(uuid, date)'),
 ('public.create_individual_membership_due(uuid, uuid, date, bigint)'),
 ('public.record_membership_due_payment(uuid, uuid, bigint, date, text, text, text)'),
 ('public.void_membership_due_payment(uuid, text)'),
 ('public.create_tennis_lesson(uuid, uuid, uuid, timestamptz, timestamptz, text, smallint, uuid[], text)'),
 ('public.update_tennis_lesson(uuid, uuid, uuid, timestamptz, timestamptz, text, smallint, uuid[], text)'),
 ('public.cancel_tennis_lesson(uuid)'),
 ('public.create_weekly_tennis_lesson_series(uuid, uuid, uuid, timestamptz, timestamptz, text, smallint, uuid[], text, smallint)'),
 ('public.create_canteen_sale(uuid, jsonb, uuid, text, uuid)'),
 ('public.record_canteen_sale_payment(uuid, uuid, bigint, date, text, text, text)'),
 ('public.void_canteen_sale(uuid, text)');
select t10.t('SEC-02','las 14 RPC existen','^14$', (select count(*)::text from fn14 where to_regprocedure(sig) is not null));
select t10.t('SEC-02','ninguna de las 14 es ejecutable por anon (ni vía PUBLIC)','^0$', (select count(*)::text from fn14 where has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE')));
select t10.t('SEC-02','las 14 siguen ejecutables por authenticated','^14$', (select count(*)::text from fn14 where has_function_privilege('authenticated', to_regprocedure(sig), 'EXECUTE')));
select t10.t('SEC-02','funciones SECURITY DEFINER de public ejecutables por anon (esperado 0)','^0$', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')));
select t10.t('SEC-02','funciones propias de public (no de extensiones) ejecutables por anon (esperado 0)','^0$', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')));
select t10.t('SEC-02','funciones de private ejecutables por anon (esperado 0)','^0$', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and has_function_privilege('anon', p.oid, 'EXECUTE')));
select t10.t('SEC-02','las RPC del portal y de torneos siguen sin anon','^0$', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'player\_%' or p.proname like '%tournament%' or p.proname like '%player_invitation%') and has_function_privilege('anon', p.oid, 'EXECUTE')));
select t10.t('SEC-02','las RPC del portal siguen ejecutables por authenticated','^(t|true)$', (select bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('player_access_context','player_court_availability','create_player_reservation','player_reservations','cancel_player_reservation','player_profile','update_player_profile','player_membership_dues','player_tournaments','redeem_player_invitation')));
-- Función nueva creada por el rol de migraciones: no debe nacer con EXECUTE directo para anon (default privileges).
create function public.t10_tmp_default_acl() returns int language sql as 'select 1';
select t10.t('SEC-02','privilegios por defecto: función nueva sin EXECUTE directo para anon','^(f|false)$', (select exists (select 1 from aclexplode(p.proacl) a where a.grantee = (select oid from pg_roles where rolname = 'anon') and a.privilege_type = 'EXECUTE')::text from pg_proc p where p.proname = 't10_tmp_default_acl'));
drop function public.t10_tmp_default_acl();

select t10.t('SEC-02','anon: create_canteen_sale rechazado','^ERR 42501', t10.sa('anon',null,$q$select public.create_canteen_sale('{clubA}','[]'::jsonb)$q$));
select t10.t('SEC-02','anon: generate_membership_dues rechazado','^ERR 42501', t10.sa('anon',null,$q$select * from public.generate_membership_dues('{clubA}', date '2026-11-01')$q$));
select t10.t('SEC-02','anon: set_club_fee_settings rechazado','^ERR 42501', t10.sa('anon',null,$q$select * from public.set_club_fee_settings('{clubA}', 1, 1::smallint)$q$));
select t10.t('SEC-02','anon: record_membership_due_payment rechazado','^ERR 42501', t10.sa('anon',null,$q$select * from public.record_membership_due_payment('{clubA}','{dueA2}', 1, current_date, 'cash')$q$));
select t10.t('SEC-02','anon: create_weekly_reservation_series (8 args) rechazado','^ERR 42501', t10.sa('anon',null,$q$select * from public.create_weekly_reservation_series('{clubA}','{courtA1}','x',null,null,now()+interval '60 day', now()+interval '60 day 1 hour', 1::smallint)$q$));
select t10.t('SEC-02','anon: create_weekly_reservation_series (7 args) rechazado','^ERR 42501', t10.sa('anon',null,$q$select * from public.create_weekly_reservation_series('{clubA}','{courtA1}','x',null,now()+interval '60 day', now()+interval '60 day 1 hour', 1::smallint)$q$));
select t10.t('SEC-02','anon: create_tennis_lesson rechazado','^ERR 42501', t10.sa('anon',null,$q$select * from public.create_tennis_lesson('{clubA}','{coachA}','{courtA1}', now()+interval '40 day', now()+interval '40 day 1 hour','individual',1::smallint,'{}'::uuid[],null)$q$));
select t10.t('SEC-02','anon: void_membership_due_payment (UUID real) no revela existencia','^ERR 42501', t10.sa('anon',null,$q$select public.void_membership_due_payment('{payA1v}','x')$q$));
select t10.t('SEC-02','anon: void_membership_due_payment (UUID inexistente) mismo error','^ERR 42501', t10.sa('anon',null,$q$select public.void_membership_due_payment('00000000-0000-0000-0000-00000000dead','x')$q$));

-- Permisos antes de leer: el mensaje es idéntico exista o no el UUID (authenticated sin permiso en ese club).
create temp table lesson as select t10.va('authenticated','staffA',$q$select (public.create_tennis_lesson('{clubA}','{coachA}','{courtA2}', now() + interval '12 day', now() + interval '12 day 1 hour','individual',1::smallint,'{}'::uuid[],null)).id::text$q$) as id;
select t10.t('SEC-02','preparación: staff A crea una clase','^[0-9a-f-]{36}$', (select id from lesson));
select t10.t('SEC-02','void_membership_due_payment: owner B ante pago de A (real) = 42501 genérico','^ERR 42501 No tenés permiso para anular pagos', t10.sa('authenticated','ownerB',$q$select public.void_membership_due_payment('{payA1v}','x')$q$));
select t10.t('SEC-02','void_membership_due_payment: owner B ante UUID inexistente = mismo error','^ERR 42501 No tenés permiso para anular pagos', t10.sa('authenticated','ownerB',$q$select public.void_membership_due_payment('00000000-0000-0000-0000-00000000dead','x')$q$));
select t10.t('SEC-02','void_membership_due_payment: staff A (sin permiso financiero) = 42501','^ERR 42501', t10.sa('authenticated','staffA',$q$select public.void_membership_due_payment('{payA1v}','x')$q$));
select t10.t('SEC-02','void_membership_due_payment: owner A sobre pago ya anulado = 22023 (comportamiento preservado)','^ERR 22023 El pago ya fue anulado', t10.sa('authenticated','ownerA',$q$select public.void_membership_due_payment('{payA1v}','x')$q$));
select t10.t('SEC-02','cancel_tennis_lesson: owner B sobre clase de A = 42501','^ERR 42501 No tenés permiso para cancelar', t10.sa('authenticated','ownerB',format($q$select public.cancel_tennis_lesson(%L)$q$, (select id from lesson))));
select t10.t('SEC-02','cancel_tennis_lesson: UUID inexistente = mismo error','^ERR 42501 No tenés permiso para cancelar', t10.sa('authenticated','ownerB',$q$select public.cancel_tennis_lesson('00000000-0000-0000-0000-00000000dead')$q$));
select t10.t('SEC-02','cancel_tennis_lesson: anon = 42501','^ERR 42501', t10.sa('anon',null,format($q$select public.cancel_tennis_lesson(%L)$q$, (select id from lesson))));
select t10.t('SEC-02','update_tennis_lesson: owner B sobre clase de A = 42501','^ERR 42501 No tenés permiso para modificar', t10.sa('authenticated','ownerB',format($q$select public.update_tennis_lesson(%L,'{coachA}','{courtA2}', now() + interval '12 day', now() + interval '12 day 1 hour','individual',1::smallint,'{}'::uuid[],null)$q$, (select id from lesson))));
select t10.t('SEC-02','update_tennis_lesson: UUID inexistente = mismo error','^ERR 42501 No tenés permiso para modificar', t10.sa('authenticated','ownerB',$q$select public.update_tennis_lesson('00000000-0000-0000-0000-00000000dead','{coachA}','{courtA2}', now() + interval '12 day', now() + interval '12 day 1 hour','individual',1::smallint,'{}'::uuid[],null)$q$));
select t10.t('SEC-02','update_tennis_lesson: staff A edita su club (legítimo)','^OK', t10.sa('authenticated','staffA',format($q$select public.update_tennis_lesson(%L,'{coachA}','{courtA2}', now() + interval '13 day', now() + interval '13 day 1 hour','individual',1::smallint,'{}'::uuid[],'editada')$q$, (select id from lesson))));
select t10.t('SEC-02','cancel_tennis_lesson: staff A cancela su club (legítimo)','^OK', t10.sa('authenticated','staffA',format($q$select public.cancel_tennis_lesson(%L)$q$, (select id from lesson))));
select t10.t('SEC-02','void_canteen_sale: owner B sobre venta de A = 42501','^ERR 42501 No tenés permiso para anular ventas', t10.sa('authenticated','ownerB',$q$select public.void_canteen_sale('{saleA1}','x')$q$));
select t10.t('SEC-02','void_canteen_sale: UUID inexistente = mismo error','^ERR 42501 No tenés permiso para anular ventas', t10.sa('authenticated','ownerB',$q$select public.void_canteen_sale('00000000-0000-0000-0000-00000000dead','x')$q$));
select t10.t('SEC-02','void_canteen_sale: anon = 42501','^ERR 42501', t10.sa('anon',null,$q$select public.void_canteen_sale('{saleA1}','x')$q$));
select t10.t('SEC-02','void_canteen_sale: staff A (no owner/admin) = 42501','^ERR 42501', t10.sa('authenticated','staffA',$q$select public.void_canteen_sale('{saleA1}','x')$q$));
select t10.t('SEC-02','revoke_player_invitation: UUID inexistente = 42501 (no revela existencia)','^ERR 42501', t10.sa('authenticated','ownerB',$q$select public.revoke_player_invitation('00000000-0000-0000-0000-00000000dead')$q$));
select t10.t('SEC-02','revoke_player_invitation: anon = 42501','^ERR 42501', t10.sa('anon',null,$q$select public.revoke_player_invitation('00000000-0000-0000-0000-00000000dead')$q$));
-- Operaciones administrativas legítimas siguen funcionando (authenticated con rol adecuado).
select t10.t('SEC-02','owner A registra un pago de cuota (legítimo)','^OK', t10.sa('authenticated','ownerA',$q$select public.record_membership_due_payment('{clubA}','{dueA2}', 10000, current_date, 'cash')$q$));
create temp table lastpay as select id::text from public.membership_due_payments where due_id = (select val::uuid from t10.tok where name = 'dueA2') order by created_at desc limit 1;
select t10.t('SEC-02','owner A anula ese pago (legítimo)','^OK', t10.sa('authenticated','ownerA',format($q$select public.void_membership_due_payment(%L, 'prueba')$q$, (select id from lastpay))));
select t10.t('SEC-02','admin A crea una venta de cantina con cobro (legítimo)','^OK', t10.sa('authenticated','adminA',$q$select public.create_canteen_sale('{clubA}','[{"product_id":"{prodA1}","quantity":1}]'::jsonb, null, 'cash')$q$));
select t10.t('SEC-02','owner A anula una venta de cantina sin pagos (legítimo)','^OK', t10.sa('authenticated','ownerA',$q$select public.void_canteen_sale((select id from public.canteen_sales where id = '{saleA1}' and status='confirmed'),'prueba')$q$));
select t10.t('SEC-02','portal: jugador A1 consulta disponibilidad','^OK', t10.sa('authenticated','pA1',$q$select public.player_court_availability('{clubA}', current_date + 3)$q$));
select t10.t('SEC-02','portal: jugador A1 ve su perfil','Jugador A1', t10.va('authenticated','pA1',$q$select public.player_profile('{clubA}')::text$q$));
select t10.t('SEC-02','portal: jugador A1 crea una reserva online','^[0-9a-f-]{36}$', t10.va('authenticated','pA1',$q$select public.create_player_reservation('{clubA}','{courtA1}', (date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') + interval '4 day 16 hour') at time zone 'America/Argentina/Buenos_Aires', 60::smallint)::text$q$));
select t10.t('SEC-02','portal: jugador A1 cancela su reserva online','^OK', t10.sa('authenticated','pA1',format($q$select public.cancel_player_reservation(%L)$q$, (select id from public.reservations where person_id = (select val::uuid from t10.tok where name = 'personA1') and status = 'confirmed' and occupation_type = 'reservation' order by created_at desc limit 1))));
select t10.t('SEC-02','portal: jugador de A no puede usar RPC administrativas (set_club_fee_settings)','^ERR 42501', t10.sa('authenticated','pA1',$q$select * from public.set_club_fee_settings('{clubA}', 1, 1::smallint)$q$));
select t10.t('SEC-02','portal: jugador de A no consulta el club B','^ERR 42501', t10.va('authenticated','pA1',$q$select public.player_profile('{clubB}')::text$q$));

-- =============================== SEC-03: privilegios de tabla ===============================
select t10.t('SEC-03','anon sin ningún privilegio sobre tablas públicas','^0$', (select count(*)::text from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'));
select t10.t('SEC-03','authenticated sin DELETE/TRUNCATE/TRIGGER/REFERENCES en ninguna tabla pública','^0$', (select count(*)::text from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('DELETE','TRUNCATE','TRIGGER','REFERENCES')));
select t10.t('SEC-03','authenticated sin INSERT/UPDATE de tabla completa en ninguna tabla pública','^0$', (select count(*)::text from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT','UPDATE')));
select t10.t('SEC-03','clubs/club_staff/courts: authenticated solo SELECT a nivel de tabla','^SELECT$', (select string_agg(distinct privilege_type, ',') from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and table_name in ('clubs','club_staff','courts','canteen_categories','canteen_products')));
select t10.t('SEC-03','courts: UPDATE por columna solo name, surface, active, display_order','^active,display_order,name,surface$', (select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges where grantee = 'authenticated' and table_name = 'courts' and privilege_type = 'UPDATE'));
select t10.t('SEC-03','courts: sin INSERT por columna','^$', (select coalesce(string_agg(column_name, ','), '') from information_schema.column_privileges where grantee = 'authenticated' and table_name = 'courts' and privilege_type = 'INSERT'));
select t10.t('SEC-03','courts: club_id y created_at no actualizables','^false$', (has_column_privilege('authenticated','public.courts','club_id','UPDATE') or has_column_privilege('authenticated','public.courts','created_at','UPDATE'))::text);
select t10.t('SEC-03','catálogo: UPDATE por columna sin club_id/id/created_at','^(f|false)$', (select exists (select 1 from information_schema.column_privileges where grantee = 'authenticated' and table_name in ('canteen_categories','canteen_products') and privilege_type = 'UPDATE' and column_name in ('club_id','id','created_at'))::text));
select t10.t('SEC-03','admin de A y B NO puede mover una cancha de club (UPDATE club_id)','^ERR 42501', t10.sa('authenticated','adminAB',$q$update public.courts set club_id = '{clubB}' where id = '{courtA9}'$q$));
select t10.t('SEC-03','admin de A y B NO puede reescribir courts.created_at','^ERR 42501', t10.sa('authenticated','adminAB',$q$update public.courts set created_at = now() - interval '5 years' where id = '{courtA9}'$q$));
select t10.t('SEC-03','la cancha sigue en su club tras los intentos','^c0000000-0000-0000-0000-00000000000a$', (select club_id::text from public.courts where id = (select val::uuid from t10.tok where name = 'courtA9')));
select t10.t('SEC-03','INSERT de cancha como owner (aunque el club coincida) rechazado','^ERR 42501', t10.sa('authenticated','ownerA',$q$insert into public.courts(club_id, name, surface, display_order) values ('{clubA}','X','polvo',50)$q$));
select t10.t('SEC-03','INSERT de cancha en otro club rechazado','^ERR 42501', t10.sa('authenticated','adminAB',$q$insert into public.courts(club_id, name, surface, display_order) values ('{clubB}','Y','polvo',50)$q$));
select t10.t('SEC-03','DELETE de cancha rechazado','^ERR 42501', t10.sa('authenticated','ownerA',$q$delete from public.courts where id = '{courtA9}'$q$));
select t10.t('SEC-03','edición legítima: admin A cambia nombre/superficie/estado/orden','^OK rows=1', t10.sa('authenticated','adminA',$q$update public.courts set name = 'A9 renombrada', surface = 'cemento', active = false, display_order = 10 where id = '{courtA9}'$q$));
select t10.t('SEC-03','edición legítima: owner A reactiva la cancha','^OK rows=1', t10.sa('authenticated','ownerA',$q$update public.courts set active = true where id = '{courtA9}'$q$));
select t10.t('SEC-03','staff A no edita canchas (RLS: 0 filas)','^(OK rows=0|ERR 42501)', t10.sa('authenticated','staffA',$q$update public.courts set name = 'hack' where id = '{courtA9}'$q$));
select t10.t('SEC-03','owner B no edita canchas de A (0 filas)','^OK rows=0', t10.sa('authenticated','ownerB',$q$update public.courts set name = 'hack' where id = '{courtA9}'$q$));
select t10.t('SEC-03','jugador no edita canchas','^(OK rows=0|ERR 42501)', t10.sa('authenticated','pA1',$q$update public.courts set name = 'hack' where id = '{courtA9}'$q$));
select t10.t('SEC-03','staff A ve las canchas de su club (SELECT)','^3$', (t10.va('authenticated','staffA',$q$select count(*)::text from public.courts$q$)));
select t10.t('SEC-03','segunda barrera (trigger): ni un superusuario reasigna courts.club_id','^(f|false)$', (select (t10.sa('postgres', null, $q$update public.courts set club_id = '{clubB}' where id = '{courtA9}'$q$) like 'OK%')::text));
select t10.t('SEC-03','clubs: INSERT/UPDATE/DELETE rechazados','^ERR 42501', t10.sa('authenticated','ownerA',$q$update public.clubs set name = 'Otro' where id = '{clubA}'$q$));
select t10.t('SEC-03','clubs: INSERT rechazado','^ERR 42501', t10.sa('authenticated','ownerA',$q$insert into public.clubs(name) values ('Club C')$q$));
select t10.t('SEC-03','club_staff: owner no puede autoasignarse/ascender (INSERT)','^ERR 42501', t10.sa('authenticated','ownerA',$q$insert into public.club_staff(club_id, auth_user_id, role) values ('{clubA}','{nolink}','owner')$q$));
select t10.t('SEC-03','club_staff: UPDATE rechazado','^ERR 42501', t10.sa('authenticated','staffA',$q$update public.club_staff set role = 'owner' where auth_user_id = '{staffA}'$q$));
select t10.t('SEC-03','club_staff: DELETE rechazado','^ERR 42501', t10.sa('authenticated','ownerA',$q$delete from public.club_staff where auth_user_id = '{staffA}'$q$));
select t10.t('SEC-03','club_staff: sigue leyendo su propia membresía','^1$', t10.va('authenticated','staffA',$q$select count(*)::text from public.club_staff$q$));
select t10.t('SEC-03','clubs: lectura de su club sigue funcionando','^1$', t10.va('authenticated','staffA',$q$select count(*)::text from public.clubs$q$));
-- Cantina: catálogo
select t10.t('SEC-03','cantina: owner A crea categoría (legítimo)','^OK rows=1', t10.sa('authenticated','ownerA',$q$insert into public.canteen_categories(club_id, name) values ('{clubA}','Snacks')$q$));
select t10.t('SEC-03','cantina: admin A crea producto (legítimo)','^OK rows=1', t10.sa('authenticated','adminA',$q$insert into public.canteen_products(club_id, category_id, name, sale_price_cents, active) values ('{clubA}','{catA}','Papas',90000,true)$q$));
select t10.t('SEC-03','cantina: admin A edita nombre/precio/estado/categoría (legítimo)','^OK rows=1', t10.sa('authenticated','adminA',$q$update public.canteen_products set name = 'Gaseosa', sale_price_cents = 160000, active = true, category_id = '{catA}' where id = '{prodA2}'$q$));
select t10.t('SEC-03','cantina: admin A edita categoría (legítimo)','^OK rows=1', t10.sa('authenticated','adminA',$q$update public.canteen_categories set name = 'Bebidas frías', active = true where id = '{catA}'$q$));
select t10.t('SEC-03','cantina: UPDATE de club_id de un producto SIN ventas rechazado (admin de A y B)','^ERR 42501', t10.sa('authenticated','adminAB',$q$update public.canteen_products set club_id = '{clubB}' where id = '{prodA2}'$q$));
select t10.t('SEC-03','cantina: UPDATE de club_id de una categoría rechazado','^ERR 42501', t10.sa('authenticated','adminAB',$q$update public.canteen_categories set club_id = '{clubB}' where id = '{catA}'$q$));
select t10.t('SEC-03','cantina: producto no cambia a categoría de otro club (FK compuesta)','^ERR 23503', t10.sa('authenticated','adminAB',$q$update public.canteen_products set category_id = '{catB}' where id = '{prodA2}'$q$));
select t10.t('SEC-03','cantina: INSERT de producto en club ajeno rechazado (RLS)','^ERR 42501', t10.sa('authenticated','ownerA',$q$insert into public.canteen_products(club_id, category_id, name, sale_price_cents) values ('{clubB}','{catB}','Intruso',1000)$q$));
select t10.t('SEC-03','cantina: INSERT de producto con category_id de otro club rechazado','^ERR (23503|42501)', t10.sa('authenticated','adminAB',$q$insert into public.canteen_products(club_id, category_id, name, sale_price_cents) values ('{clubA}','{catB}','Cruce',1000)$q$));
select t10.t('SEC-03','cantina: staff A no escribe catálogo (INSERT)','^ERR 42501', t10.sa('authenticated','staffA',$q$insert into public.canteen_products(club_id, category_id, name, sale_price_cents) values ('{clubA}','{catA}','Staff',1000)$q$));
select t10.t('SEC-03','cantina: staff A no escribe catálogo (UPDATE: 0 filas)','^OK rows=0', t10.sa('authenticated','staffA',$q$update public.canteen_products set sale_price_cents = 1 where id = '{prodA1}'$q$));
select t10.t('SEC-03','cantina: DELETE de producto rechazado','^ERR 42501', t10.sa('authenticated','ownerA',$q$delete from public.canteen_products where id = '{prodA2}'$q$));
select t10.t('SEC-03','cantina: no se puede escribir id/created_at del producto','^ERR 42501', t10.sa('authenticated','ownerA',$q$update public.canteen_products set created_at = now() - interval '9 years' where id = '{prodA1}'$q$));
select t10.t('SEC-03','cantina: escritura directa de ventas sigue prohibida','^ERR 42501', t10.sa('authenticated','ownerA',$q$update public.canteen_sales set total_cents = 1$q$));
select t10.t('SEC-03','cantina: staff A lee catálogo (SELECT)','^[3-9]$', t10.va('authenticated','staffA',$q$select count(*)::text from public.canteen_products$q$));
select t10.t('SEC-03','cantina: staff A registra una venta por RPC según su rol','^OK', t10.sa('authenticated','staffA',$q$select public.create_canteen_sale('{clubA}','[{"product_id":"{prodA2}","quantity":1}]'::jsonb, null, 'cash')$q$));
select t10.t('SEC-03','segunda barrera (trigger): club_id de producto inmutable incluso para superusuario','^(f|false)$', (t10.sa('postgres', null, $q$update public.canteen_products set club_id = '{clubB}' where id = '{prodA2}'$q$) like 'OK%')::text);
select t10.t('SEC-03','segunda barrera (trigger): club_id de categoría inmutable incluso para superusuario','^(f|false)$', (t10.sa('postgres', null, $q$update public.canteen_categories set club_id = '{clubB}' where id = '{catA}'$q$) like 'OK%')::text);
select t10.t('SEC-03','otras escrituras con grants por columna intactas (club_people)','^OK rows=1', t10.sa('authenticated','adminA',$q$update public.club_people set notes = 'ok' where id = '{personA1}'$q$));
select t10.t('SEC-03','otras escrituras con grants por columna intactas (reservations)','^OK rows=1', t10.sa('authenticated','staffA',$q$insert into public.reservations(club_id, court_id, customer_name, starts_at, ends_at) values ('{clubA}','{courtA1}','Walk-in', now() + interval '20 day', now() + interval '20 day 1 hour')$q$));

-- =============================== SEC-04: saldos del portal ===============================
create or replace function t10.portal_due(p_user text, p_due text, p_field text) returns text language sql as $$
  select t10.va('authenticated', p_user, format($q$select (e->>%L) from jsonb_array_elements(public.player_membership_dues('{clubA}')) e where e->>'id' = %L$q$, p_field, (select val from t10.tok where name = p_due))) $$;
select t10.t('SEC-04','A1 (válido 200000 + anulado 100000): paid_cents = 200000','^200000$', t10.portal_due('pA1','dueA1','paid_cents'));
select t10.t('SEC-04','A1: balance_cents = 300000','^300000$', t10.portal_due('pA1','dueA1','balance_cents'));
select t10.t('SEC-04','A1: el portal lista solo el pago válido','^1$', t10.va('authenticated','pA1',$q$select jsonb_array_length(e->'payments')::text from jsonb_array_elements(public.player_membership_dues('{clubA}')) e where e->>'id' = '{dueA1}'$q$));
select t10.t('SEC-04','A1: el pago anulado sigue en el historial de la base (2 pagos, 1 anulado)','^2/1$', (select count(*) || '/' || count(*) filter (where voided_at is not null) from public.membership_due_payments where due_id = (select val::uuid from t10.tok where name = 'dueA1')));
select t10.t('SEC-04','A2 (pago parcial 150000): paid_cents = 150000','^150000$', t10.portal_due('pA2','dueA2','paid_cents'));
select t10.t('SEC-04','A2: balance_cents = 350000','^350000$', t10.portal_due('pA2','dueA2','balance_cents'));
select t10.t('SEC-04','A2: el pago registrado y anulado en SEC-02 no cambia el saldo','^350000$', t10.portal_due('pA2','dueA2','balance_cents'));
select t10.t('SEC-04','A3 (dos pagos válidos que saldan la cuota): balance 0','^0$', t10.portal_due('pA3','dueA3','balance_cents'));
select t10.t('SEC-04','A3: paid_cents = importe (500000)','^500000$', t10.portal_due('pA3','dueA3','paid_cents'));
select t10.t('SEC-04','A4 (solo un pago anulado): paid_cents = 0','^0$', t10.portal_due('pA4','dueA4','paid_cents'));
select t10.t('SEC-04','A4: balance = importe completo (500000)','^500000$', t10.portal_due('pA4','dueA4','balance_cents'));
select t10.t('SEC-04','A4: lista de pagos vacía','^0$', t10.va('authenticated','pA4',$q$select jsonb_array_length(e->'payments')::text from jsonb_array_elements(public.player_membership_dues('{clubA}')) e where e->>'id' = '{dueA4}'$q$));
-- Paridad con el cálculo administrativo (importe − suma de pagos NO anulados), por cuota y para todos los jugadores.
select t10.t('SEC-04','paridad admin/portal: ninguna cuota difiere en paid_cents ni balance_cents','^0$', (
  select count(*)::text from (values ('pA1','dueA1'),('pA2','dueA2'),('pA3','dueA3'),('pA4','dueA4')) u(usr, due)
  join t10.tok tk on tk.name = u.due join public.membership_dues d on d.id = tk.val::uuid
  where d.amount_cents - coalesce((select sum(p.amount_cents) from public.membership_due_payments p where p.due_id = d.id and p.voided_at is null), 0) is distinct from t10.portal_due(u.usr, u.due, 'balance_cents')::bigint
     or coalesce((select sum(p.amount_cents) from public.membership_due_payments p where p.due_id = d.id and p.voided_at is null), 0) is distinct from t10.portal_due(u.usr, u.due, 'paid_cents')::bigint));
select t10.t('SEC-04','privacidad: A1 ve solo sus cuotas (1 cuota, la propia)','^1/(t|true)$', t10.va('authenticated','pA1',$q$select jsonb_array_length(public.player_membership_dues('{clubA}'))::text || '/' || (select bool_and(e->>'id' = '{dueA1}')::text from jsonb_array_elements(public.player_membership_dues('{clubA}')) e)$q$));
select t10.t('SEC-04','privacidad: A2 no ve la cuota de A1','^0$', t10.va('authenticated','pA2',$q$select count(*)::text from jsonb_array_elements(public.player_membership_dues('{clubA}')) e where e->>'id' = '{dueA1}'$q$));
select t10.t('SEC-04','privacidad: jugador de B no consulta cuotas del club A','^ERR 42501', t10.va('authenticated','pB1',$q$select public.player_membership_dues('{clubA}')::text$q$));
select t10.t('SEC-04','privacidad: usuario sin vínculo rechazado','^ERR 42501', t10.va('authenticated','nolink',$q$select public.player_membership_dues('{clubA}')::text$q$));
select t10.t('SEC-04','privacidad: anon rechazado','^ERR 42501', t10.va('anon',null,$q$select public.player_membership_dues('{clubA}')::text$q$));
select t10.t('SEC-04','privacidad: el portal no expone notas ni teléfonos de terceros','^(f|false)$', t10.va('authenticated','pA1',$q$select (public.player_membership_dues('{clubA}')::text ~ '(nota A2|222|Jugador A2)')::text$q$));
select t10.t('SEC-04','no se alteraron importes ni registros financieros históricos (huella)','^(t|true)$', (select ((select md5(coalesce(string_agg(id::text || ':' || amount_cents || ':' || due_date, ',' order by id), '')) from public.membership_dues) = s.dues)::text from t10.snap s));
select t10.t('SEC-04','cuotas del club B intactas','^1$', (select count(*)::text from public.membership_dues where club_id = (select val::uuid from t10.tok where name = 'clubB')));

-- ===================== Resumen =====================
\echo
\echo '======== RESUMEN SPRINT 10B.1 ========'
select area, count(*) filter (where ok) as ok, count(*) filter (where not ok) as no_cumple from t10.results group by area order by area;
\echo '======== PRUEBAS QUE NO CUMPLEN ========'
select n, area, test, actual from t10.results where not ok order by n;
select 'TOTAL ok=' || count(*) filter (where ok) || ' no_cumple=' || count(*) filter (where not ok) as total from t10.results;
