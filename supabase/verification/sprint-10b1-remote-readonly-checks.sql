-- Sprint 10B.1 — verificación de SOLO LECTURA contra Supabase real (SQL Editor, rol postgres). Solo SELECT de catálogo/datos:
-- no modifica nada y es seguro en producción. Ejecutar ANTES de aplicar las migraciones (esperado: ok = false donde hay hallazgo)
-- y DESPUÉS (esperado: todas ok = true). Pegar la salida en docs/SECURITY_AUDIT.md.
-- OJO: demuestra el ESTADO del catálogo (definiciones, privilegios, triggers, datos). El comportamiento (canje real, JWT/PostgREST)
-- solo se prueba con usuarios reales en un proyecto Supabase DESCARTABLE; ver la lista manual al final.

select * from (
  -- Historial: las migraciones 10B.1 deben figurar tras aplicarlas (por nombre, no por cantidad).
  select 'M0' as id, 'historial: migraciones 10B.1 registradas (4)' as verificacion,
         ((select count(*) from supabase_migrations.schema_migrations where version in ('20261014020000','20261014030000','20261014040000','20261014050000')) = 4) as ok,
         (select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations where version >= '20261014') as detalle
  union all
  -- SEC-01
  select 'S01a', 'pgcrypto: extensions.digest(text,text) existe', to_regprocedure('extensions.digest(text,text)') is not null, (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pgcrypto')
  union all
  select 'S01b', 'redeem_player_invitation usa extensions.digest',
         coalesce((select prosrc like '%extensions.digest(%' and prosrc !~ '[^.]digest\(' from pg_proc where oid = to_regprocedure('public.redeem_player_invitation(text)')), false), null
  union all
  select 'S01c', 'create_player_invitation usa extensions.digest y gen_random_bytes',
         coalesce((select prosrc ilike '%extensions.digest(%' and prosrc ilike '%extensions.gen_random_bytes(%' from pg_proc where oid = to_regprocedure('public.create_player_invitation(uuid,uuid,timestamptz)')), false), null
  union all
  select 'S01d', 'redeem_player_invitation: solo authenticated (no anon, no PUBLIC)',
         has_function_privilege('authenticated', to_regprocedure('public.redeem_player_invitation(text)'), 'EXECUTE') and not has_function_privilege('anon', to_regprocedure('public.redeem_player_invitation(text)'), 'EXECUTE'), null
  union all
  -- SEC-02
  select 'S02a', 'ninguna función SECURITY DEFINER de public/private ejecutable por anon',
         (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')),
         (select string_agg(n.nspname || '.' || p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE'))
  union all
  select 'S02b', 'ninguna función propia de public (no extensiones) ejecutable por anon',
         (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')),
         (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'))
  union all
  select 'S02c', 'las 14 RPC administrativas conservan EXECUTE para authenticated',
         (select count(*) = 14 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('create_weekly_reservation_series','set_club_fee_settings','generate_membership_dues','create_individual_membership_due','record_membership_due_payment','void_membership_due_payment','create_tennis_lesson','update_tennis_lesson','cancel_tennis_lesson','create_weekly_tennis_lesson_series','create_canteen_sale','record_canteen_sale_payment','void_canteen_sale') and has_function_privilege('authenticated', p.oid, 'EXECUTE')), null
  union all
  select 'S02d', 'void_membership_due_payment valida permisos antes de leer (prosrc: can_manage_finances antes de for update)',
         coalesce((select position('can_manage_finances' in prosrc) between 1 and position('for update' in prosrc) - 1 from pg_proc where oid = to_regprocedure('public.void_membership_due_payment(uuid,text)')), false), null
  union all
  select 'S02e', 'void_canteen_sale / update / cancel_tennis_lesson / revoke_player_invitation consultan solo club_id antes de validar permisos',
         coalesce((select bool_and(prosrc like '%v_club_id%') from pg_proc where oid in (to_regprocedure('public.void_canteen_sale(uuid,text)'), to_regprocedure('public.cancel_tennis_lesson(uuid)'), to_regprocedure('public.revoke_player_invitation(uuid)'), to_regprocedure('public.update_tennis_lesson(uuid,uuid,uuid,timestamptz,timestamptz,text,smallint,uuid[],text)'))), false), null
  union all
  select 'S02f', 'privilegios por defecto: public/funciones sin entrada para anon (objetos nuevos)',
         not exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a where d.defaclobjtype = 'f' and d.defaclnamespace = 'public'::regnamespace and a.grantee = (select oid from pg_roles where rolname = 'anon')),
         (select string_agg(pg_get_userbyid(defaclrole) || ':' || defaclacl::text, ' | ') from pg_default_acl where defaclobjtype = 'f')
  union all
  -- SEC-03
  select 'S03a', 'anon sin privilegios sobre tablas públicas', (select count(*) = 0 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'), null
  union all
  select 'S03b', 'authenticated: solo SELECT a nivel de tabla en clubs, club_staff, courts, canteen_categories, canteen_products',
         (select coalesce(string_agg(distinct privilege_type, ','), '') = 'SELECT' from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and table_name in ('clubs','club_staff','courts','canteen_categories','canteen_products')),
         (select string_agg(table_name || ':' || privilege_type, ', ' order by table_name) from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and table_name in ('clubs','club_staff','courts','canteen_categories','canteen_products') and privilege_type <> 'SELECT')
  union all
  select 'S03c', 'authenticated sin DELETE/TRUNCATE/TRIGGER/REFERENCES ni INSERT/UPDATE de tabla completa en ninguna tabla pública',
         (select count(*) = 0 from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('DELETE','TRUNCATE','TRIGGER','REFERENCES','INSERT','UPDATE')),
         (select string_agg(distinct table_name, ', ') from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('DELETE','TRUNCATE','TRIGGER','REFERENCES','INSERT','UPDATE'))
  union all
  select 'S03d', 'courts: club_id y created_at no actualizables por authenticated',
         not (has_column_privilege('authenticated','public.courts','club_id','UPDATE') or has_column_privilege('authenticated','public.courts','created_at','UPDATE')), null
  union all
  select 'S03e', 'canteen_*: club_id no actualizable por authenticated',
         not (has_column_privilege('authenticated','public.canteen_products','club_id','UPDATE') or has_column_privilege('authenticated','public.canteen_categories','club_id','UPDATE')), null
  union all
  select 'S03f', 'courts: se puede editar name/surface/active/display_order',
         has_column_privilege('authenticated','public.courts','name','UPDATE') and has_column_privilege('authenticated','public.courts','surface','UPDATE') and has_column_privilege('authenticated','public.courts','active','UPDATE') and has_column_privilege('authenticated','public.courts','display_order','UPDATE'), null
  union all
  select 'S03g', 'triggers de club_id inmutable en courts, canteen_categories y canteen_products',
         (select count(*) = 3 from pg_trigger t where not t.tgisinternal and t.tgname in ('courts_prevent_club_id_change','canteen_categories_prevent_club_id_change','canteen_products_prevent_club_id_change')), null
  union all
  select 'S03h', 'RLS habilitada en todas las tablas de public', (select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), null
  union all
  -- SEC-04
  select 'S04a', 'player_membership_dues excluye pagos anulados del total pagado',
         coalesce((select prosrc ~ 'sum\(p\.amount_cents\)\s+filter\s+\(where p\.voided_at is null\)' from pg_proc where oid = to_regprocedure('public.player_membership_dues(uuid)')), false), null
  union all
  select 'S04b', 'player_membership_dues: solo authenticated',
         has_function_privilege('authenticated', to_regprocedure('public.player_membership_dues(uuid)'), 'EXECUTE') and not has_function_privilege('anon', to_regprocedure('public.player_membership_dues(uuid)'), 'EXECUTE'), null
  union all
  -- Datos: no deben existir anomalías previas (no se modifica nada; solo informan)
  select 'D01', 'datos: cuotas sobrepagadas (esperado 0)', (select count(*) = 0 from (select d.id from public.membership_dues d join public.membership_due_payments p on p.due_id = d.id group by d.id, d.amount_cents having coalesce(sum(p.amount_cents) filter (where p.voided_at is null), 0) > d.amount_cents) x), null
  union all
  select 'D02', 'datos: reservas con cancha de otro club (esperado 0)', (select count(*) = 0 from public.reservations r join public.courts c on c.id = r.court_id and c.club_id <> r.club_id), null
  union all
  select 'D03', 'datos: productos/categorías de cantina con club distinto al de su categoría/ventas (esperado 0)', (select count(*) = 0 from public.canteen_products p join public.canteen_categories c on c.id = p.category_id and c.club_id <> p.club_id), null
  union all
  select 'D04', 'informativo: cuotas cuyo saldo mostrado por el portal estaba mal (con algún pago anulado)',
         true, (select count(distinct p.due_id)::text from public.membership_due_payments p where p.voided_at is not null)
) v order by id;

-- Lista MANUAL (proyecto Supabase DESCARTABLE, no producción), con usuarios Auth reales y supabase-js/PostgREST:
--  1. Owner genera invitación (create_player_invitation) → copiar código. Usuario nuevo sin vínculo ejecuta
--     rpc('redeem_player_invitation', {p_code}) → debe devolver {club_id, person_id}. Repetir → "No pudimos validar el código".
--  2. Revocar otra invitación (revoke_player_invitation) y vencer otra (UPDATE expires_at en SQL Editor) → ambos canjes rechazados.
--  3. Con la anon key (sin sesión) llamar rpc('generate_membership_dues', …) y rpc('void_canteen_sale', …) → 401/403 (permission denied).
--  4. Con un admin de dos clubes: update en /rest/v1/courts?id=eq.<id> con {"club_id":"<otro club>"} → 403/permission denied;
--     con {"name":"nuevo"} → 200. Panel: editar una cancha y un producto/categoría de cantina desde la app → debe seguir funcionando.
--  5. Jugador con una cuota con un pago anulado: el saldo del portal debe coincidir con el panel administrativo (Cuotas).
