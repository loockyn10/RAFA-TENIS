-- Sprint 10B.1 / SEC-02 — diagnóstico de SOLO LECTURA: ¿qué funciones puede ejecutar `anon` en el proyecto Supabase real?
-- Ejecutar en el SQL Editor (rol postgres). Solo SELECT sobre el catálogo: no modifica nada.
-- Contexto: en Supabase real `rpc_accesibles_anon = 1` (SECURITY DEFINER en public/private); en el PostgreSQL local con los
-- privilegios por defecto emulados había 13. No se asume que ambos entornos tengan los mismos privilegios: esta consulta
-- identifica la función y la causa (EXECUTE directo a anon, vía PUBLIC, o por privilegios por defecto).

-- 1) Funciones SECURITY DEFINER de public/private que anon puede ejecutar, con la causa del privilegio.
select n.nspname as esquema,
       p.proname as funcion,
       pg_get_function_identity_arguments(p.oid) as argumentos,
       pg_get_userbyid(p.proowner) as propietario,
       p.prosecdef as security_definer,
       (select string_agg(c, ' ') from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as search_path,
       p.proacl::text as acl,
       exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where a.grantee = (select oid from pg_roles where rolname = 'anon') and a.privilege_type = 'EXECUTE') as anon_directo,
       exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where a.grantee = 0 and a.privilege_type = 'EXECUTE') as via_public,
       exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e') as de_extension,
       p.proname = any (array[
         'create_weekly_reservation_series','set_club_fee_settings','generate_membership_dues','create_individual_membership_due',
         'record_membership_due_payment','void_membership_due_payment','create_tennis_lesson','update_tennis_lesson','cancel_tennis_lesson',
         'create_weekly_tennis_lesson_series','create_canteen_sale','record_canteen_sale_payment','void_canteen_sale',
         'player_access_context','create_player_invitation','revoke_player_invitation','list_player_invitations','redeem_player_invitation',
         'get_online_booking_settings','set_online_booking_settings','player_court_availability','create_player_reservation','player_reservations',
         'cancel_player_reservation','player_profile','update_player_profile','player_membership_dues','player_tournaments',
         'create_tournament','update_tournament','create_tournament_category','create_tournament_entry','delete_tournament_entry',
         'generate_tournament_fixture','schedule_tournament_match','cancel_tournament_match_schedule','record_tournament_match_result'
       ]) as funcion_del_repositorio
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private') and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')
order by funcion_del_repositorio, n.nspname, p.proname;
-- Lectura: funcion_del_repositorio = false → no la crea este repositorio (p. ej. una función de la plataforma o creada a mano
-- desde el panel): revisarla manualmente (qué hace, quién la llama, si anon la necesita) ANTES de revocar nada.
-- funcion_del_repositorio = true → la corrige la migración 20261014030000 (revoke ... from public, anon).

-- 2) Todas las funciones de public que anon puede ejecutar, SIN las de extensiones (btree_gist/pgcrypto instalan funciones
--    sin SECURITY DEFINER que son operadores internos y no son un riesgo): esperado 0 tras la migración.
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as argumentos, p.prosecdef
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
  and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
order by 1, 2;

-- 3) Origen de las diferencias entre entornos: privilegios por defecto de los objetos nuevos y roles que los crean.
select pg_get_userbyid(defaclrole) as rol_creador, defaclnamespace::regnamespace as esquema, defaclobjtype as tipo, defaclacl::text as acl
from pg_default_acl order by 1, 2, 3;
-- defaclobjtype 'f' = funciones. Si no hay entrada con anon para 'f' en public, las funciones nuevas NO nacen ejecutables por anon
-- (entonces el 1 remoto vendría de un EXECUTE vía PUBLIC o de una función de la plataforma, no de los privilegios por defecto).
select current_user as rol_actual, session_user;
select rolname, rolsuper from pg_roles where rolname in ('postgres', 'supabase_admin', 'anon', 'authenticated', 'service_role') order by 1;
