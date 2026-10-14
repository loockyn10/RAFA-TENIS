-- Sprint 10B — consultas de SOLO LECTURA para contrastar el proyecto Supabase REAL con lo auditado en el repositorio.
-- Ejecutar en el SQL Editor de Supabase (rol postgres). Son únicamente SELECT sobre el catálogo: no modifican nada.
-- Pegar los resultados en docs/SECURITY_AUDIT.md (sección "Verificación contra Supabase real") antes de corregir.

-- 0) Historial de migraciones realmente aplicado (confirma qué hay en remoto).
select version, name from supabase_migrations.schema_migrations order by version;

-- 1) ¿En qué esquema vive pgcrypto? (SEC-01: redeem_player_invitation usa digest() sin esquema)
select e.extname, n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname in ('pgcrypto', 'btree_gist');
select p.proname, n.nspname as schema from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname in ('digest', 'gen_random_bytes') order by 1, 2;
-- Prueba equivalente a lo que hace la función (debe fallar si digest no está en public/pg_catalog):
-- set search_path = pg_catalog, public; select encode(digest('x', 'sha256'), 'hex');

-- 2) SEC-02: funciones SECURITY DEFINER de public/private que anon o PUBLIC pueden ejecutar (esperado: ninguna fuera de las intencionales).
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
       (select string_agg(c, ' ') from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as search_path
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private') and p.prosecdef
order by anon_exec desc, n.nspname, p.proname;

-- 3) SEC-03: privilegios de tabla de anon/authenticated (esperado: anon ninguno; authenticated solo SELECT y los INSERT/UPDATE por columna previstos).
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee order by table_name, grantee;
-- Privilegios por columna (los INSERT/UPDATE por columna que concede cada migración):
select table_name, grantee, privilege_type, string_agg(column_name, ', ' order by column_name) as columnas
from information_schema.column_privileges
where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE')
group by table_name, grantee, privilege_type order by table_name, grantee, privilege_type;
-- Privilegios por defecto que reciben los objetos nuevos (explica SEC-02/SEC-03):
select pg_get_userbyid(defaclrole) as creador, defaclnamespace::regnamespace as esquema, defaclobjtype as tipo, defaclacl from pg_default_acl;

-- 4) RLS: todas las tablas de public deben tener RLS habilitada; revisar políticas (USING / WITH CHECK).
select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as rls_forzada
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by c.relrowsecurity, c.relname;
select tablename, policyname, cmd, roles, qual as using_expr, with_check from pg_policies where schemaname = 'public' order by tablename, cmd, policyname;

-- 5) Roles administrativos reales (sin datos personales): ¿hay más de un owner? ¿staff inesperado?
select c.name as club, s.role, count(*) as cantidad from public.club_staff s join public.clubs c on c.id = s.club_id group by c.name, s.role order by 1, 2;

-- 6) Invitaciones: ninguna debe guardar el código en claro y no deberían existir vigentes con vencimiento lejano.
select count(*) filter (where redeemed_at is null and revoked_at is null and expires_at > now()) as vigentes,
       max(expires_at) filter (where redeemed_at is null and revoked_at is null) as vencimiento_mas_lejano,
       count(*) filter (where char_length(token_hash) <> 64) as hashes_invalidos
from public.player_invitations;

-- 7) Integridad financiera: no deben existir pagos que superen la cuota ni ventas sobrepagadas (esperado: 0 filas en ambas).
select d.id as due_id, d.amount_cents, sum(p.amount_cents) filter (where p.voided_at is null) as pagado
from public.membership_dues d join public.membership_due_payments p on p.due_id = d.id
group by d.id, d.amount_cents having coalesce(sum(p.amount_cents) filter (where p.voided_at is null), 0) > d.amount_cents;
select s.id as sale_id, s.total_cents, sum(p.amount_cents) as pagado
from public.canteen_sales s join public.canteen_sale_payments p on p.sale_id = s.id
group by s.id, s.total_cents having sum(p.amount_cents) > s.total_cents;
-- Pagos con fechas fuera de lo razonable (SEC-10):
select 'cuotas' as modulo, count(*) from public.membership_due_payments where payment_date > current_date + 1 or payment_date < date '2020-01-01'
union all select 'cantina', count(*) from public.canteen_sale_payments where payment_date > current_date + 1 or payment_date < date '2020-01-01';

-- 8) Reservas: no debe haber solapes entre ocupaciones activas de la misma cancha (esperado: 0 filas) ni ocupaciones de otro club.
select a.id, b.id as choca_con from public.reservations a join public.reservations b
  on a.court_id = b.court_id and a.id < b.id and a.status in ('confirmed', 'active') and b.status in ('confirmed', 'active')
  and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)');
select count(*) as reservas_con_cancha_de_otro_club from public.reservations r join public.courts c on c.id = r.court_id and c.club_id <> r.club_id;
