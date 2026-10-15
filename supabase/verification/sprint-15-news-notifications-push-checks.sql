-- Sprint 15 — verificaciones de Novedades, notificaciones, push y recordatorios contra PostgreSQL REAL y DESCARTABLE.
-- Requiere local-supabase-stub.sql y las migraciones 01 … 20261015000000 ya aplicadas. NO es Supabase (no prueba PostgREST, JWT reales
-- ni el servicio Storage real: las políticas de storage.objects se prueban sobre una tabla de stub). Corre con superusuario.
\set ON_ERROR_STOP on
set client_min_messages = warning;
drop schema if exists t15 cascade;
create schema t15;
create table t15.results (n serial primary key, area text, test text, expected text, actual text, ok boolean);

create function t15.sa(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
declare n bigint; res text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin execute p_sql; get diagnostics n = row_count; res := 'OK rows=' || n;
  exception when others then res := 'ERR ' || sqlstate || ' ' || sqlerrm; end;
  reset role;
  return res;
end $$;
create function t15.va(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text; res text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin execute p_sql into v; res := coalesce(v, '<null>');
  exception when others then res := 'ERR ' || sqlstate || ' ' || sqlerrm; end;
  reset role;
  return res;
end $$;
create function t15.t(p_area text, p_test text, p_expected_regex text, p_actual text) returns void language sql as $$
  insert into t15.results(area, test, expected, actual, ok) values (p_area, p_test, p_expected_regex, left(p_actual, 240), p_actual ~ p_expected_regex);
$$;
create function t15.auth(p_name text) returns uuid language sql immutable as $$
  select case p_name
    when 'ownerA' then 'a0000000-0000-0000-0000-000000000001' when 'adminA' then 'a0000000-0000-0000-0000-000000000002'
    when 'staffA' then 'a0000000-0000-0000-0000-000000000003' when 'ownerB' then 'a0000000-0000-0000-0000-000000000004'
    when 'pA1' then 'a0000000-0000-0000-0000-000000000005' when 'pA2' then 'a0000000-0000-0000-0000-000000000006'
    when 'pB' then 'a0000000-0000-0000-0000-000000000007' when 'stranger' then 'a0000000-0000-0000-0000-000000000008'
    when 'pInactive' then 'a0000000-0000-0000-0000-000000000009'
  end::uuid $$;
create function t15.vau(p_user text, p_sql text) returns text language sql as $$ select t15.va('authenticated', t15.auth(p_user), p_sql) $$;
create function t15.sau(p_user text, p_sql text) returns text language sql as $$ select t15.sa('authenticated', t15.auth(p_user), p_sql) $$;
create function t15.vsr(p_sql text) returns text language sql as $$ select t15.va('service_role', null, p_sql) $$;
create function t15.q(p_sql text) returns text language plpgsql as $$ declare v text; begin execute p_sql into v; return coalesce(v, '<null>'); end $$;
create table t15.snap (name text primary key, val text);
create function t15.put(p_name text, p_val text) returns text language sql as $$ insert into t15.snap values (p_name, p_val) on conflict (name) do update set val = excluded.val returning val $$;
create function t15.get(p_name text) returns text language sql as $$ select val from t15.snap where name = p_name $$;
create function t15.k(n int) returns uuid language sql immutable as $$ select ('f1500000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function t15.today() returns date language sql stable as $$ select (now() at time zone 'America/Argentina/Buenos_Aires')::date $$;

\set CA '''c0000000-0000-0000-0000-00000000000a'''
\set CB '''c0000000-0000-0000-0000-00000000000b'''

-- ===================== Datos =====================
insert into auth.users(id, email) values
 ('a0000000-0000-0000-0000-000000000001','ownerA@t'), ('a0000000-0000-0000-0000-000000000002','adminA@t'),
 ('a0000000-0000-0000-0000-000000000003','staffA@t'), ('a0000000-0000-0000-0000-000000000004','ownerB@t'),
 ('a0000000-0000-0000-0000-000000000005','pA1@t'), ('a0000000-0000-0000-0000-000000000006','pA2@t'),
 ('a0000000-0000-0000-0000-000000000007','pB@t'), ('a0000000-0000-0000-0000-000000000008','stranger@t'),
 ('a0000000-0000-0000-0000-000000000009','pInactive@t');
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
 ('e0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','Jugador Uno', true),
 ('e0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000a','Jugador Dos', true),
 ('e0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-00000000000a','Sin cuenta Tres', true),
 ('e0000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-00000000000a','Inactivo Cuatro', false),
 ('e0000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-00000000000a','Admin jugador Cinco', true),
 ('e0000000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-00000000000b','Jugador B', true);
insert into public.club_person_auth_links(club_id, person_id, auth_user_id) values
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000005'),
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000006'),
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000009'),
 ('c0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000002'),
 ('c0000000-0000-0000-0000-00000000000b','e0000000-0000-0000-0000-0000000000b1','a0000000-0000-0000-0000-000000000007');
insert into public.tournaments(id, club_id, name, starts_on, ends_on, status, created_by) values
 ('70000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-00000000000a','Torneo A', current_date + 30, current_date + 32, 'registration_open','a0000000-0000-0000-0000-000000000001'),
 ('70000000-0000-0000-0000-00000000000b','c0000000-0000-0000-0000-00000000000b','Torneo B', current_date + 30, current_date + 32, 'registration_open','a0000000-0000-0000-0000-000000000004');

-- crea una publicación como un usuario; devuelve el id o ERR. Parámetros: usuario, club, tipo, título, cuerpo, fecha, hora, lugar, destacada, torneo, imagen, clave
create function t15.mk(p_user text, p_club uuid, p_kind text, p_title text, p_body text, p_date date, p_time time, p_loc text, p_feat boolean, p_tour uuid, p_img text, p_key int) returns text language sql as $$
  select t15.vau(p_user, format('select (public.create_club_post(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)).id::text', p_club, p_kind, p_title, p_body, p_date, p_time, p_loc, p_feat, p_tour, p_img, t15.k(p_key)))
$$;
create function t15.pub(p_user text, p_post text, p_notify boolean) returns text language sql as $$
  select t15.vau(p_user, format('select public.publish_club_post(%L, %L)::text', p_post, p_notify))
$$;
create function t15.notif_count(p_filter text default 'true') returns text language sql as $$ select t15.q('select count(*)::text from public.notifications where ' || p_filter) $$;

-- ===================== 1. Estructura, privilegios y anon =====================
select t15.t('1 permisos','anon no lee publicaciones','^ERR 42501', t15.sa('anon', null, 'select 1 from public.club_posts limit 1'));
select t15.t('1 permisos','anon no lee notificaciones','^ERR 42501', t15.sa('anon', null, 'select 1 from public.notifications limit 1'));
select t15.t('1 permisos','anon no lee suscripciones push','^ERR 42501', t15.sa('anon', null, 'select 1 from public.push_subscriptions limit 1'));
select t15.t('1 permisos','anon no lee la cola de entregas','^ERR 42501', t15.sa('anon', null, 'select 1 from public.push_deliveries limit 1'));
select t15.t('1 permisos','authenticated no lee la cola de entregas','^ERR 42501', t15.sau('pA1', 'select 1 from public.push_deliveries limit 1'));
select t15.t('1 permisos','anon no ejecuta club_posts_feed','^ERR 42501', t15.sa('anon', null, format('select public.club_posts_feed(%L)', 'c0000000-0000-0000-0000-00000000000a')));
select t15.t('1 permisos','anon no ejecuta publish_club_post','^ERR 42501', t15.sa('anon', null, 'select public.publish_club_post(gen_random_uuid(), true)'));
select t15.t('1 permisos','anon no registra suscripciones','^ERR 42501', t15.sa('anon', null, format('select public.register_push_subscription(%L,%L,%L)', 'https://x.test/a', repeat('A',87), repeat('B',22))));
select t15.t('1 permisos','authenticated NO puede reclamar entregas (solo service_role)','^ERR 42501', t15.sau('ownerA', 'select public.claim_push_deliveries(10)'));
select t15.t('1 permisos','authenticated NO puede completar entregas','^ERR 42501', t15.sau('ownerA', format('select public.complete_push_delivery(%L, ''sent'')', gen_random_uuid())));
select t15.t('1 permisos','authenticated NO puede generar recordatorios masivos','^ERR 42501', t15.sau('ownerA', 'select public.generate_reservation_reminders()'));
select t15.t('1 permisos','anon NO puede generar recordatorios','^ERR 42501', t15.sa('anon', null, 'select public.generate_reservation_reminders()'));
select t15.t('1 permisos','service_role SÍ puede reclamar entregas','^\[\]$', t15.vsr('select public.claim_push_deliveries(10)::text'));
select t15.t('1 permisos','insert directo en club_posts denegado a owner (solo RPC)','^ERR 42501', t15.sau('ownerA', format($q$insert into public.club_posts(club_id,kind,title,body,client_request_id,created_by,updated_by) values (%L,'news','Titulo','cuerpo',gen_random_uuid(),%L,%L)$q$, 'c0000000-0000-0000-0000-00000000000a', t15.auth('ownerA'), t15.auth('ownerA'))));
select t15.t('1 permisos','insert directo en notifications denegado a authenticated','^ERR 42501', t15.sau('pA1', format($q$insert into public.notifications(club_id,user_id,kind,title,dedupe_key) values (%L,%L,'news_published','x','k')$q$, 'c0000000-0000-0000-0000-00000000000a', t15.auth('pA1'))));
select t15.t('1 permisos','update directo de notifications denegado (solo mark_* RPC)','^ERR 42501', t15.sau('pA1', 'update public.notifications set read_at = now()'));
select t15.t('1 permisos','las claves de cifrado push no son legibles por el navegador (p256dh)','^ERR 42501', t15.sau('pA1', 'select p256dh from public.push_subscriptions'));
select t15.t('1 permisos','las claves de cifrado push no son legibles por el navegador (auth_secret)','^ERR 42501', t15.sau('pA1', 'select auth_secret from public.push_subscriptions'));
select t15.t('1 permisos','existe el bucket privado con límites de tipo y tamaño','^(f|false)\|2097152\|\{image/jpeg,image/png,image/webp\}$', t15.q($q$select public::text || '|' || file_size_limit || '|' || allowed_mime_types::text from storage.buckets where id = 'club-post-images'$q$));

-- ===================== 2. Publicaciones: creación y validaciones (P0) =====================
select t15.put('N1', t15.mk('ownerA', :CA, 'news', 'Nuevo horario de cantina', 'La cantina abre desde las 8.', null, null, null, false, null, null, 1));
select t15.t('2 crear','owner crea una noticia (borrador)','^[0-9a-f-]{36}$', t15.get('N1'));
select t15.t('2 crear','la noticia queda en borrador sin fecha de publicación','^draft\|<null>$', t15.q(format($q$select status || '|' || coalesce(published_at::text,'<null>') from public.club_posts where id = %L$q$, t15.get('N1'))));
select t15.put('E1', t15.mk('adminA', :CA, 'event', 'Peña de fin de mes', 'Peña con asado para socios.', t15.today() + 10, time '21:00', 'Quincho del club', false, null, null, 2));
select t15.t('2 crear','admin crea un evento con fecha, hora y lugar','^[0-9a-f-]{36}$', t15.get('E1'));
select t15.t('2 crear','staff NO crea publicaciones','^ERR 42501', t15.mk('staffA', :CA, 'news', 'Intento de staff', 'No debería', null, null, null, false, null, null, 3));
select t15.t('2 crear','jugador NO crea publicaciones','^ERR 42501', t15.mk('pA1', :CA, 'news', 'Intento jugador', 'No debería', null, null, null, false, null, null, 4));
select t15.t('2 crear','owner del club B NO crea en el club A','^ERR 42501', t15.mk('ownerB', :CA, 'news', 'Intento cruzado', 'No debería', null, null, null, false, null, null, 5));
select t15.t('2 crear','anon NO crea','^ERR 42501', t15.sa('anon', null, format('select public.create_club_post(%L,''news'',''Titulo'',''Cuerpo'',null,null,null,false,null,null,%L)', 'c0000000-0000-0000-0000-00000000000a', t15.k(6))));
select t15.t('2 validar','título demasiado corto','^ERR 22023 .*título', t15.mk('ownerA', :CA, 'news', 'ab', 'cuerpo', null, null, null, false, null, null, 7));
select t15.t('2 validar','descripción vacía','^ERR 22023 .*descripción', t15.mk('ownerA', :CA, 'news', 'Titulo ok', '   ', null, null, null, false, null, null, 8));
select t15.t('2 validar','HTML en el título rechazado','^ERR 22023 .*HTML', t15.mk('ownerA', :CA, 'news', 'Hola <script>alert(1)</script>', 'cuerpo', null, null, null, false, null, null, 9));
select t15.t('2 validar','HTML en la descripción rechazado','^ERR 22023 .*HTML', t15.mk('ownerA', :CA, 'news', 'Titulo ok', 'texto <img src=x onerror=alert(1)>', null, null, null, false, null, null, 10));
select t15.t('2 validar','HTML en el lugar rechazado','^ERR 22023 .*HTML', t15.mk('ownerA', :CA, 'event', 'Titulo ok', 'cuerpo', t15.today() + 5, null, '<b>Quincho</b>', false, null, null, 11));
select t15.t('2 validar','un comparador de texto («menos de 40 años», «3 < 5») NO es HTML y se acepta','^[0-9a-f-]{36}$', t15.mk('ownerA', :CA, 'news', 'Torneo menores de 40', 'Jugamos si hay 3 < 5 lluvias; categoría <40 no.', null, null, null, false, null, null, 12));
select t15.t('2 validar','un comunicado no admite fecha de evento','^ERR 22023 .*comunicado', t15.mk('ownerA', :CA, 'news', 'Titulo ok', 'cuerpo', t15.today() + 3, null, null, false, null, null, 13));
select t15.t('2 validar','un evento exige fecha','^ERR 22023 .*fecha', t15.mk('ownerA', :CA, 'event', 'Titulo ok', 'cuerpo', null, null, null, false, null, null, 14));
select t15.t('2 validar','un evento no se crea con fecha pasada','^ERR 22023 .*pasado', t15.mk('ownerA', :CA, 'event', 'Titulo ok', 'cuerpo', t15.today() - 1, null, null, false, null, null, 15));
select t15.t('2 validar','un evento no se crea con fecha absurda (año 2200)','^ERR 22023', t15.mk('ownerA', :CA, 'event', 'Titulo ok', 'cuerpo', date '2200-01-01', null, null, false, null, null, 16));
select t15.t('2 validar','un evento puede no tener hora ni lugar (opcionales)','^[0-9a-f-]{36}$', t15.mk('ownerA', :CA, 'event', 'Jornada de tenis', 'Todo el día.', t15.today() + 20, null, null, false, null, null, 17));
select t15.t('2 validar','un torneo de otro club no se puede vincular','^ERR 23503', t15.mk('ownerA', :CA, 'news', 'Titulo ok', 'cuerpo', null, null, null, false, '70000000-0000-0000-0000-00000000000b', null, 18));
select t15.t('2 validar','tipo inválido','^ERR 22023', t15.mk('ownerA', :CA, 'chat', 'Titulo ok', 'cuerpo', null, null, null, false, null, null, 19));
select t15.t('2 validar','imagen de la carpeta de OTRO club rechazada','^ERR 22023 .*imagen', t15.mk('ownerA', :CA, 'news', 'Titulo ok', 'cuerpo', null, null, null, false, null, 'c0000000-0000-0000-0000-00000000000b/11111111-1111-1111-1111-111111111111.png', 20));
select t15.t('2 validar','imagen con extensión no permitida (svg) rechazada','^ERR 22023 .*imagen', t15.mk('ownerA', :CA, 'news', 'Titulo ok', 'cuerpo', null, null, null, false, null, 'c0000000-0000-0000-0000-00000000000a/11111111-1111-1111-1111-111111111111.svg', 21));
select t15.t('2 validar','imagen con ruta traversal rechazada','^ERR 22023 .*imagen', t15.mk('ownerA', :CA, 'news', 'Titulo ok', 'cuerpo', null, null, null, false, null, 'c0000000-0000-0000-0000-00000000000a/../c0000000-0000-0000-0000-00000000000b/x.png', 22));
select t15.t('2 validar','imagen que no existe en storage rechazada','^ERR 22023 .*imagen', t15.mk('ownerA', :CA, 'news', 'Titulo ok', 'cuerpo', null, null, null, false, null, 'c0000000-0000-0000-0000-00000000000a/11111111-1111-1111-1111-111111111111.png', 23));
-- idempotencia de creación
select t15.put('IDEM1', t15.mk('ownerA', :CA, 'news', 'Creada una vez', 'Doble clic.', null, null, null, false, null, null, 30));
select t15.put('IDEM2', t15.mk('ownerA', :CA, 'news', 'Creada una vez', 'Doble clic.', null, null, null, false, null, null, 30));
select t15.t('2 crear','reintentar la misma operación (misma clave) devuelve la misma publicación','^(t|true)$', (t15.get('IDEM1') = t15.get('IDEM2'))::text);
select t15.t('2 crear','…y no crea una segunda fila','^1$', t15.q(format($q$select count(*)::text from public.club_posts where client_request_id = %L$q$, t15.k(30))));

-- ===================== 3. Editar, borradores, publicar, archivar =====================
select t15.t('3 editar','owner edita el borrador (título y descripción)','^Nuevo horario de cantina \(editado\)$',
  t15.vau('ownerA', format($q$select (public.update_club_post(%L,'news','Nuevo horario de cantina (editado)','La cantina abre desde las 8.',null,null,null,false,null,null)).title$q$, t15.get('N1'))));
select t15.t('3 editar','staff NO edita','^ERR 42501', t15.vau('staffA', format($q$select (public.update_club_post(%L,'news','Hackeado','x',null,null,null,false,null,null)).title$q$, t15.get('N1'))));
select t15.t('3 editar','HTML rechazado también al editar','^ERR 22023', t15.vau('ownerA', format($q$select (public.update_club_post(%L,'news','Titulo','<iframe src=x>',null,null,null,false,null,null)).title$q$, t15.get('N1'))));
select t15.t('3 borrador','el borrador es invisible para el jugador (feed)','^0$', t15.vau('pA1', format($q$select jsonb_array_length(public.club_posts_feed(%L))::text$q$, 'c0000000-0000-0000-0000-00000000000a')));
select t15.t('3 borrador','el borrador es invisible para staff (feed)','^0$', t15.vau('staffA', format($q$select jsonb_array_length(public.club_posts_feed(%L))::text$q$, 'c0000000-0000-0000-0000-00000000000a')));
select t15.t('3 borrador','staff no lee la tabla de publicaciones','^0$', t15.vau('staffA', 'select count(*)::text from public.club_posts'));
select t15.t('3 borrador','el jugador no lee la tabla de publicaciones','^0$', t15.vau('pA1', 'select count(*)::text from public.club_posts'));
select t15.t('3 borrador','el owner ve borradores','^[1-9]', t15.vau('ownerA', $q$select count(*)::text from public.club_posts where status = 'draft'$q$));
select t15.t('3 borrador','el owner del club B no ve publicaciones del club A','^0$', t15.vau('ownerB', 'select count(*)::text from public.club_posts'));
select t15.t('3 borrador','guardar borradores NO generó notificaciones','^0$', t15.notif_count());

select t15.t('3 publicar','jugador NO publica','^ERR 42501', t15.pub('pA1', t15.get('N1'), false));
select t15.t('3 publicar','staff NO publica','^ERR 42501', t15.pub('staffA', t15.get('N1'), false));
select t15.t('3 publicar','owner de otro club NO publica','^ERR 42501', t15.pub('ownerB', t15.get('N1'), false));
select t15.t('3 publicar','owner publica la noticia sin avisar','"status": "published".*"notified": false.*"recipients": 0', t15.pub('ownerA', t15.get('N1'), false));
select t15.t('3 publicar','la noticia publicada tiene fecha de publicación','^(t|true)$', t15.q(format($q$select (published_at is not null)::text from public.club_posts where id = %L$q$, t15.get('N1'))));
select t15.t('3 publicar','publicar sin avisar no crea notificaciones','^0$', t15.notif_count());
select t15.t('3 publicar','el jugador ve la noticia publicada (feed)','Nuevo horario de cantina', t15.vau('pA1', format($q$select public.club_posts_feed(%L)::text$q$, 'c0000000-0000-0000-0000-00000000000a')));
select t15.t('3 publicar','staff ve la noticia publicada (feed)','Nuevo horario de cantina', t15.vau('staffA', format($q$select public.club_posts_feed(%L)::text$q$, 'c0000000-0000-0000-0000-00000000000a')));
select t15.t('3 publicar','el feed no devuelve el borrador del evento E1','^(f|false)$', t15.vau('pA1', format($q$select (public.club_posts_feed(%L)::text like '%%Peña de fin de mes%%')::text$q$, 'c0000000-0000-0000-0000-00000000000a')));
-- aislamiento entre clubes
select t15.t('3 aislamiento','el jugador del club B NO puede pedir el feed del club A','^ERR 42501', t15.vau('pB', format($q$select public.club_posts_feed(%L)::text$q$, 'c0000000-0000-0000-0000-00000000000a')));
select t15.t('3 aislamiento','una cuenta sin vínculo NO ve el feed','^ERR 42501', t15.vau('stranger', format($q$select public.club_posts_feed(%L)::text$q$, 'c0000000-0000-0000-0000-00000000000a')));
select t15.t('3 aislamiento','el feed del club B no contiene publicaciones del club A','^0$', t15.vau('pB', format($q$select jsonb_array_length(public.club_posts_feed(%L))::text$q$, 'c0000000-0000-0000-0000-00000000000b')));

-- editar publicada: no cambia estado ni avisa
select t15.t('3 editar','editar una publicada mantiene el estado y no genera avisos','^published$', t15.vau('ownerA', format($q$select (public.update_club_post(%L,'news','Nuevo horario de cantina','Ahora abre a las 7:30.',null,null,null,false,null,null)).status$q$, t15.get('N1'))));
select t15.t('3 editar','cambiar el tipo de una publicada está prohibido','^ERR 22023', t15.vau('ownerA', format($q$select (public.update_club_post(%L,'event','Nuevo horario','x',current_date + 3,null,null,false,null,null)).status$q$, t15.get('N1'))));
select t15.t('3 editar','editar una publicada no genera notificaciones','^0$', t15.notif_count());

-- archivar y consultar anteriores
select t15.t('3 archivar','jugador NO archiva','^ERR 42501', t15.vau('pA1', format('select (public.archive_club_post(%L)).status', t15.get('N1'))));
select t15.t('3 archivar','owner archiva','^archived$', t15.vau('ownerA', format('select (public.archive_club_post(%L)).status', t15.get('N1'))));
select t15.t('3 archivar','archivar dos veces es idempotente','^archived$', t15.vau('ownerA', format('select (public.archive_club_post(%L)).status', t15.get('N1'))));
select t15.t('3 archivar','la archivada ya no se ve en el feed del jugador','^(f|false)$', t15.vau('pA1', format($q$select (public.club_posts_feed(%L)::text like '%%Nuevo horario de cantina%%')::text$q$, 'c0000000-0000-0000-0000-00000000000a')));
select t15.t('3 archivar','el owner puede consultar las anteriores','^archived$', t15.vau('ownerA', format($q$select status from public.club_posts where id = %L$q$, t15.get('N1'))));
select t15.t('3 archivar','se puede republicar una archivada','"status": "published"', t15.pub('ownerA', t15.get('N1'), false));

-- ===================== 4. Próximos eventos ordenados =====================
select t15.put('EV3', t15.mk('ownerA', :CA, 'event', 'Evento tercero', 'Fecha lejana.', t15.today() + 30, time '18:00', 'Club', false, null, null, 40));
select t15.put('EV1', t15.mk('ownerA', :CA, 'event', 'Evento primero', 'Fecha cercana.', t15.today() + 2, time '19:00', 'Club', false, null, null, 41));
select t15.put('EV2', t15.mk('ownerA', :CA, 'event', 'Evento segundo', 'Fecha media.', t15.today() + 15, null, null, false, null, null, 42));
select t15.put('EVPAST', t15.mk('ownerA', :CA, 'event', 'Evento que ya pasó', 'Se creará futuro y se vencerá.', t15.today() + 1, time '10:00', 'Club', false, null, null, 43));
select t15.pub('ownerA', t15.get('EV3'), false); select t15.pub('ownerA', t15.get('EV1'), false); select t15.pub('ownerA', t15.get('EV2'), false); select t15.pub('ownerA', t15.get('EVPAST'), false);
-- simula el paso del tiempo (solo con superusuario): el evento pasa a ser anterior
update public.club_posts set event_date = t15.today() - 3 where id = t15.get('EVPAST')::uuid;
select t15.t('4 orden','próximos eventos ordenados por fecha ascendente (cercano → medio → lejano), primeros en el feed','^Evento primero\|Evento segundo\|Evento tercero$',
  t15.vau('pA1', format($q$select string_agg(e->>'title', '|' order by ord) from jsonb_array_elements(public.club_posts_feed(%L)) with ordinality as t(e, ord) where e->>'title' like 'Evento %%' and (e->>'event_date')::date >= current_date$q$, 'c0000000-0000-0000-0000-00000000000a')));
select t15.t('4 orden','los próximos van antes que el evento pasado y las noticias','^Evento primero$', t15.vau('pA1', format($q$select (public.club_posts_feed(%L)->0)->>'title'$q$, 'c0000000-0000-0000-0000-00000000000a')));
select t15.t('4 orden','el evento pasado sigue visible como «anterior» (publicado)','^(t|true)$', t15.vau('pA1', format($q$select (public.club_posts_feed(%L)::text like '%%Evento que ya pasó%%')::text$q$, 'c0000000-0000-0000-0000-00000000000a')));
update public.club_posts set event_date = t15.today() - 2 where id = t15.get('E1')::uuid;
select t15.t('4 orden','publicar un evento con fecha ya pasada se rechaza','^ERR 22023 .*pasada', t15.pub('adminA', t15.get('E1'), false));
update public.club_posts set event_date = t15.today() + 10 where id = t15.get('E1')::uuid;

-- ===================== 5. Avisos de publicación (P1) =====================
select t15.t('5 avisos','una noticia NO destacada no se puede enviar como aviso','^ERR 22023 .*destacada', t15.pub('ownerA', t15.get('N1'), true));
select t15.put('NF', t15.mk('ownerA', :CA, 'news', 'Cierre por lluvia', 'Hoy no abrimos las canchas.', null, null, null, true, null, null, 50));
select t15.t('5 avisos','owner publica una noticia DESTACADA y avisa: notified=true','"notified": true', t15.pub('ownerA', t15.get('NF'), true));
select t15.t('5 avisos','destinatarios = cuentas vinculadas a personas ACTIVAS del club A (2 jugadores + el admin-jugador = 3); no la persona sin cuenta, ni la inactiva, ni el club B','^3$',
  t15.notif_count($q$kind = 'news_published'$q$));
select t15.t('5 avisos','los destinatarios son exactamente pA1, pA2 y adminA','^a0000000-0000-0000-0000-000000000002,a0000000-0000-0000-0000-000000000005,a0000000-0000-0000-0000-000000000006$',
  t15.q($q$select string_agg(user_id::text, ',' order by user_id) from public.notifications where kind = 'news_published'$q$));
select t15.t('5 avisos','la persona inactiva con cuenta NO recibe aviso','^0$', t15.notif_count(format('user_id = %L', t15.auth('pInactive'))));
select t15.t('5 avisos','el jugador del club B NO recibe aviso del club A','^0$', t15.notif_count(format('user_id = %L', t15.auth('pB'))));
select t15.t('5 avisos','el aviso apunta a la publicación y no contiene correos ni datos privados','^post\|[0-9a-f-]{36}\|Cierre por lluvia$', t15.q($q$select target_type || '|' || target_id::text || '|' || title from public.notifications where user_id = 'a0000000-0000-0000-0000-000000000005' and kind = 'news_published'$q$));
select t15.t('5 avisos','reintentar la publicación ya confirmada NO envía de nuevo (already_notified)','(?=.*"already_notified": true)(?=.*"notified": false)(?=.*"recipients": 0)', t15.pub('ownerA', t15.get('NF'), true));
select t15.t('5 avisos','…y sigue habiendo 3 avisos','^3$', t15.notif_count($q$kind = 'news_published'$q$));
select t15.vau('ownerA', format($q$select (public.update_club_post(%L,'news','Cierre por lluvia hoy','Hoy no abrimos.',null,null,null,true,null,null)).status$q$, t15.get('NF')));
select t15.pub('ownerA', t15.get('NF'), true);
select t15.t('5 avisos','editar y volver a publicar con aviso tampoco duplica','^3$', t15.notif_count($q$kind = 'news_published'$q$));
-- archivar y republicar no vuelve a avisar
select t15.vau('ownerA', format('select (public.archive_club_post(%L)).status', t15.get('NF')));
select t15.pub('ownerA', t15.get('NF'), true);
select t15.t('5 avisos','archivar y republicar no vuelve a avisar','^3$', t15.notif_count($q$kind = 'news_published'$q$));
-- evento con aviso
select t15.t('5 avisos','publicar un evento con aviso: 3 destinatarios (owner no vinculado)','"recipients": 3', t15.pub('ownerA', t15.get('E1'), true));
select t15.t('5 avisos','el aviso del evento muestra fecha, hora y lugar','Quincho del club', t15.q($q$select body from public.notifications where kind = 'event_published' and user_id = 'a0000000-0000-0000-0000-000000000005'$q$));
-- el publicador (admin-jugador) no se avisa a sí mismo
select t15.put('EVA', t15.mk('adminA', :CA, 'event', 'Evento del admin', 'Publicado por el admin vinculado.', t15.today() + 12, time '20:00', null, false, null, null, 51));
select t15.t('5 avisos','quien publica no se auto-notifica: 2 destinatarios (pA1 y pA2)','"recipients": 2', t15.pub('adminA', t15.get('EVA'), true));
select t15.t('5 avisos','no hay aviso para adminA de su propia publicación','^0$', t15.notif_count(format($q$user_id = %L and target_id = %L$q$, t15.auth('adminA'), t15.get('EVA'))));
-- torneo anunciado por dos publicaciones: un solo aviso por jugador
select t15.put('T1', t15.mk('ownerA', :CA, 'event', 'Torneo de Primavera', 'Se abre la inscripción.', t15.today() + 30, time '09:00', 'Club', false, '70000000-0000-0000-0000-00000000000a', null, 52));
select t15.put('T2', t15.mk('ownerA', :CA, 'event', 'Torneo de Primavera — recordatorio', 'Últimos lugares.', t15.today() + 30, time '09:00', 'Club', false, '70000000-0000-0000-0000-00000000000a', null, 53));
select t15.t('5 torneo','primera publicación del torneo avisa a 3','"recipients": 3', t15.pub('ownerA', t15.get('T1'), true));
select t15.t('5 torneo','una segunda publicación del MISMO torneo con aviso no duplica (0 destinatarios nuevos)','"recipients": 0', t15.pub('ownerA', t15.get('T2'), true));
select t15.t('5 torneo','cada jugador tiene un solo aviso del torneo','^3$', t15.notif_count($q$dedupe_key = 'tournament:70000000-0000-0000-0000-00000000000a'$q$));

-- ===================== 6. Centro de notificaciones =====================
select t15.t('6 centro','el jugador pA1 ve solo SUS notificaciones','^(t|true)$', t15.vau('pA1', format($q$select (count(*) > 0 and count(*) = count(*) filter (where user_id = %L))::text from public.notifications$q$, t15.auth('pA1'))));
select t15.t('6 centro','pA2 no ve las de pA1','^(t|true)$', t15.vau('pA2', format($q$select (count(*) > 0 and not exists (select 1 from public.notifications where user_id = %L))::text from public.notifications$q$, t15.auth('pA1'))));
select t15.t('6 centro','staff sin vínculo no ve notificaciones ajenas','^0$', t15.vau('staffA', 'select count(*)::text from public.notifications'));
select t15.t('6 centro','el owner tampoco lee las de los jugadores','^0$', t15.vau('ownerA', 'select count(*)::text from public.notifications'));
select t15.put('NID', t15.q($q$select id::text from public.notifications where user_id = 'a0000000-0000-0000-0000-000000000005' and kind = 'news_published'$q$));
select t15.t('6 centro','no leída al principio','^<null>$', t15.q(format($q$select read_at::text from public.notifications where id = %L$q$, t15.get('NID'))));
select t15.vau('pA2', format('select public.mark_notification_read(%L)::text', t15.get('NID')));
select t15.t('6 centro','otro usuario NO puede marcar como leída la notificación ajena','^<null>$', t15.q(format($q$select read_at::text from public.notifications where id = %L$q$, t15.get('NID'))));
select t15.vau('pA1', format('select public.mark_notification_read(%L)::text', t15.get('NID')));
select t15.t('6 centro','el dueño la marca como leída','^(t|true)$', t15.q(format($q$select (read_at is not null)::text from public.notifications where id = %L$q$, t15.get('NID'))));
select t15.put('R1', t15.q(format($q$select read_at::text from public.notifications where id = %L$q$, t15.get('NID'))));
select t15.vau('pA1', format('select public.mark_notification_read(%L)::text', t15.get('NID')));
select t15.t('6 centro','marcar dos veces es idempotente (no cambia la fecha de lectura)','^(t|true)$', t15.q(format($q$select (read_at::text = %L)::text from public.notifications where id = %L$q$, t15.get('R1'), t15.get('NID'))));
select t15.put('MARKALL', t15.vau('pA1', 'select public.mark_all_notifications_read()::text'));
select t15.t('6 centro','marcar todas como leídas devuelve la cantidad que estaba pendiente (>0)','^[1-9][0-9]*$', t15.get('MARKALL'));
select t15.t('6 centro','…y no quedan no leídas de pA1','^0$', t15.q(format($q$select count(*)::text from public.notifications where user_id = %L and read_at is null$q$, t15.auth('pA1'))));
select t15.t('6 centro','…ni se tocaron las de pA2','^[1-9][0-9]*$', t15.q(format($q$select count(*)::text from public.notifications where user_id = %L and read_at is null$q$, t15.auth('pA2'))));
select t15.t('6 centro','my_notifications: el total de no leídas de pA2 coincide con la tabla y la lista es solo suya','^(t|true)$', t15.vau('pA2', format($q$select ((public.my_notifications(%L)->>'unread')::int = (select count(*) from public.notifications where read_at is null and user_id = %L) and jsonb_array_length(public.my_notifications(%L)->'items') = (select count(*) from public.notifications where user_id = %L and club_id = %L))::text$q$, 'c0000000-0000-0000-0000-00000000000a', t15.auth('pA2'), 'c0000000-0000-0000-0000-00000000000a', t15.auth('pA2'), 'c0000000-0000-0000-0000-00000000000a')));
select t15.t('6 centro','my_notifications: tras marcar todas, pA1 tiene 0 no leídas','^0$', t15.vau('pA1', format($q$select (public.my_notifications(%L)->>'unread')$q$, 'c0000000-0000-0000-0000-00000000000a')));
select t15.t('6 centro','my_notifications: un club distinto no mezcla notificaciones (pB sin nada del club A)','^0$', t15.vau('pB', format($q$select jsonb_array_length(public.my_notifications(%L)->'items')::text$q$, 'c0000000-0000-0000-0000-00000000000a')));
select t15.t('6 centro','my_notifications: anon denegado','^ERR 42501', t15.sa('anon', null, 'select public.my_notifications()'));
select t15.t('6 centro','anon no marca nada','^ERR 42501', t15.sa('anon', null, 'select public.mark_all_notifications_read()'));

-- ===================== 7. Notificaciones de reservas =====================
delete from public.notifications;
create function t15.res_insert(p_user text, p_person text, p_court text, p_start text, p_mins int, p_type text default 'reservation', p_status text default 'confirmed') returns text language sql as $$
  select t15.sau(p_user, format($q$insert into public.reservations(club_id, court_id, customer_name, person_id, starts_at, ends_at, status, occupation_type, block_reason)
    values (%L, %L, 'Cliente', %L, %L::timestamptz, %L::timestamptz + make_interval(mins => %s), %L, %L, %L)$q$,
    'c0000000-0000-0000-0000-00000000000a', p_court, p_person, p_start, p_start, p_mins, p_status, p_type, case when p_type = 'block' then 'Mantenimiento' end))
$$;
\set C1 '''d0000000-0000-0000-0000-000000000001'''
\set C2 '''d0000000-0000-0000-0000-000000000002'''
\set P1 '''e0000000-0000-0000-0000-000000000001'''
\set P3 '''e0000000-0000-0000-0000-000000000003'''
select t15.t('7 reservas','admin crea una reserva futura para la persona CON cuenta (pA1)','^OK rows=1$', t15.res_insert('adminA', 'e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', to_char(now() + interval '40 days', 'YYYY-MM-DD') || ' 18:00-03', 60));
select t15.t('7 reservas','el jugador vinculado recibe «Reserva confirmada» (1)','^1\|Reserva confirmada\|Cancha 1', t15.q($q$select count(*) || '|' || min(title) || '|' || min(body) from public.notifications where user_id = 'a0000000-0000-0000-0000-000000000005' and kind = 'reservation_confirmed'$q$));
select t15.t('7 reservas','el aviso de reserva no contiene importes ni datos financieros','^(t|true)$', t15.q($q$select (body !~* '(\$|pesos|saldo|deuda|precio|cobr)' and title !~* '(\$|pesos|saldo|deuda|precio|cobr)')::text from public.notifications where kind = 'reservation_confirmed'$q$));
select t15.put('RES1', t15.q($q$select target_id::text from public.notifications where kind = 'reservation_confirmed'$q$));
select t15.res_insert('adminA', 'e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001', to_char(now() + interval '41 days', 'YYYY-MM-DD') || ' 18:00-03', 60);
select t15.t('7 reservas','reserva para una persona SIN cuenta: no genera ninguna notificación','^1$', t15.notif_count());
select t15.res_insert('adminA', null, 'd0000000-0000-0000-0000-000000000001', to_char(now() + interval '42 days', 'YYYY-MM-DD') || ' 18:00-03', 60);
select t15.t('7 reservas','reserva sin ficha: tampoco','^1$', t15.notif_count());
select t15.res_insert('adminA', 'e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', to_char(now() + interval '43 days', 'YYYY-MM-DD') || ' 18:00-03', 60, 'block', 'active');
select t15.t('7 reservas','un bloqueo (aunque lleve ficha) no genera notificación','^1$', t15.notif_count());
select t15.res_insert('adminA', 'e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', to_char(now() - interval '3 days', 'YYYY-MM-DD') || ' 18:00-03', 60);
select t15.t('7 reservas','una reserva con horario pasado cargada a posteriori no avisa','^1$', t15.notif_count());
select t15.res_insert('adminA', 'e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', to_char(now() + interval '44 days', 'YYYY-MM-DD') || ' 18:00-03', 60);
select t15.t('7 reservas','persona INACTIVA con cuenta: no se le avisa','^1$', t15.notif_count());
-- cancelación
select t15.t('7 cancelación','admin cancela la reserva: el jugador recibe «Reserva cancelada»','^OK rows=1$', t15.sau('adminA', format($q$update public.reservations set status = 'cancelled' where id = %L$q$, t15.get('RES1'))));
select t15.t('7 cancelación','una notificación de cancelación para pA1','^1$', t15.notif_count($q$kind = 'reservation_cancelled' and user_id = 'a0000000-0000-0000-0000-000000000005'$q$));
select t15.sau('adminA', format($q$update public.reservations set notes = 'cambio 1' where id = %L$q$, t15.get('RES1')));
select t15.sau('adminA', format($q$update public.reservations set notes = 'cambio 2', status = 'cancelled' where id = %L$q$, t15.get('RES1')));
select t15.t('7 cancelación','editar o re-cancelar repetidamente no duplica (sigue 1 cancelación)','^1$', t15.notif_count($q$kind = 'reservation_cancelled'$q$));
select t15.t('7 cancelación','la confirmación original sigue siendo una sola','^1$', t15.notif_count($q$kind = 'reservation_confirmed' and user_id = 'a0000000-0000-0000-0000-000000000005'$q$));
-- el propio jugador actúa desde el portal: no se auto-notifica
select t15.vau('ownerA', format($q$select public.set_online_booking_settings(%L, true, '07:00', '23:00', 90::smallint, array[60]::smallint[], 5::smallint, 120::smallint)::text$q$, 'c0000000-0000-0000-0000-00000000000a'));
select t15.put('PRES', t15.vau('pA2', format($q$select public.create_player_reservation(%L, %L, %L::timestamptz, 60::smallint)::text$q$, 'c0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', to_char(now() + interval '45 days', 'YYYY-MM-DD') || ' 15:00-03')));
select t15.t('7 portal','el jugador reserva por el portal (create_player_reservation)','^[0-9a-f-]{36}$',
  t15.get('PRES'));
select t15.t('7 portal','…y no se auto-notifica la reserva que hizo él mismo','^0$', t15.notif_count($q$user_id = 'a0000000-0000-0000-0000-000000000006'$q$));
select t15.vau('pA2', format('select public.cancel_player_reservation(%L)::text', t15.get('PRES')));
select t15.t('7 portal','el jugador cancela su reserva desde el portal: queda cancelada y no se auto-notifica','^cancelled\|0$', t15.q($q$select (select status from public.reservations where person_id = 'e0000000-0000-0000-0000-000000000002' order by created_at desc limit 1) || '|' || (select count(*) from public.notifications where user_id = 'a0000000-0000-0000-0000-000000000006')$q$));
-- serie semanal: un solo aviso
select t15.t('7 serie','serie semanal de 4 semanas para pA1','^[0-9a-f-]{36}$', t15.vau('adminA', format($q$select (select ((array_agg(x))[1])::text from public.create_weekly_reservation_series(%L, %L, 'Jugador Uno', 'e0000000-0000-0000-0000-000000000001'::uuid, null, %L::timestamptz, %L::timestamptz, 4::smallint) x)$q$,
  'c0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', to_char(now() + interval '50 days', 'YYYY-MM-DD') || ' 19:00-03', to_char(now() + interval '50 days', 'YYYY-MM-DD') || ' 20:00-03')));
select t15.t('7 serie','4 reservas pero UN solo aviso «Reservas semanales confirmadas … 4 semanas»','^1\|Reservas semanales confirmadas\|.*4 semanas$', t15.q($q$select count(*) || '|' || min(title) || '|' || min(body) from public.notifications where title like 'Reservas semanales%'$q$));
-- una notificación que falla NO debe romper la reserva
alter table public.notifications add constraint t15_force_fail check (false) not valid;
select t15.t('7 robustez','si la notificación falla, la reserva IGUAL se crea','^OK rows=1$', t15.res_insert('adminA', 'e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', to_char(now() + interval '60 days', 'YYYY-MM-DD') || ' 18:00-03', 60));
alter table public.notifications drop constraint t15_force_fail;
select t15.t('7 robustez','la reserva quedó guardada y no hay notificación fantasma','^1\|0$', t15.q($q$select (select count(*) from public.reservations where starts_at::date = (now() + interval '60 days')::date)::text || '|' || (select count(*) from public.notifications where created_at > now() - interval '5 seconds' and body like '%' || to_char((now() + interval '60 days'), 'DD/MM') || '%')::text$q$));

-- ===================== 8. Recordatorios programados (P3) =====================
delete from public.notifications; delete from public.reservations where occupation_type = 'reservation' and starts_at > now() - interval '10 days' and club_id = 'c0000000-0000-0000-0000-00000000000a';
delete from public.reservation_series;
create function t15.rem(p_id int, p_court text, p_person text, p_offset interval, p_created interval, p_type text default 'reservation', p_status text default 'confirmed') returns void language plpgsql as $$
begin
  insert into public.reservations(id, club_id, court_id, customer_name, person_id, starts_at, ends_at, status, occupation_type, block_reason, created_by, created_at)
  values (('f5000000-0000-0000-0000-' || lpad(p_id::text, 12, '0'))::uuid, 'c0000000-0000-0000-0000-00000000000a', p_court::uuid, case when p_type = 'block' then null else 'Cliente' end, p_person::uuid,
    now() + p_offset, now() + p_offset + interval '1 hour', p_status, p_type, case when p_type = 'block' then 'Mant' end, 'a0000000-0000-0000-0000-000000000001', now() - p_created);
end $$;
-- limpiar notificaciones que dispararon los triggers al sembrar (el sembrado simula reservas viejas)
select t15.rem(1, 'd0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', interval '20 hours', interval '3 days');       -- SÍ
select t15.rem(2, 'd0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', interval '20 hours', interval '1 hour');        -- creada dentro de la ventana: NO
select t15.rem(3, 'd0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', interval '23 hours', interval '3 days', 'reservation', 'cancelled'); -- cancelada: NO
select t15.rem(4, 'd0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000003', interval '22 hours', interval '3 days');       -- sin cuenta: NO
select t15.rem(5, 'd0000000-0000-0000-0000-000000000002', null, interval '23 hours 30 minutes', interval '3 days');                              -- sin persona: NO
select t15.rem(6, 'd0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', interval '30 hours', interval '3 days');       -- fuera de ventana: NO (hasta p_now+8h)
select t15.rem(7, 'd0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', interval '-5 hours', interval '3 days');       -- pasada: NO
select t15.rem(8, 'd0000000-0000-0000-0000-000000000001', null, interval '22 hours', interval '3 days', 'block', 'active');                      -- bloqueo: NO
select t15.rem(9, 'd0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004', interval '25 hours 30 minutes', interval '3 days'); -- persona inactiva (fuera de ventana)
delete from public.notifications;
select t15.t('8 recordatorios','el proceso solo lo ejecuta service_role: el jugador no puede dispararlo','^ERR 42501', t15.sau('pA1', 'select public.generate_reservation_reminders()'));
select t15.t('8 recordatorios','anticipación fuera de rango rechazada','^ERR 22023', t15.vsr('select public.generate_reservation_reminders(5)::text'));
select t15.t('8 recordatorios','ejecución 1: 1 solo recordatorio (R1) — no canceladas, ni pasadas, ni sin cuenta, ni sin persona, ni bloqueos, ni fuera de ventana, ni creadas hace <24 h','^1$', t15.vsr('select public.generate_reservation_reminders(1440)::text'));
select t15.t('8 recordatorios','dirigido a pA1 con tipo reservation_reminder y destino la reserva','^reservation_reminder\|a0000000-0000-0000-0000-000000000005\|reservation$', t15.q($q$select kind || '|' || user_id || '|' || target_type from public.notifications$q$));
select t15.t('8 recordatorios','el cuerpo menciona cancha y horario local y ningún dato financiero','^(t|true)$', t15.q($q$select (body ~ '^Cancha 1 · .* · [0-9]{2}:[0-9]{2}–[0-9]{2}:[0-9]{2}$')::text from public.notifications$q$));
select t15.t('8 recordatorios','ejecución 2 idéntica: 0 (idempotente)','^0$', t15.vsr('select public.generate_reservation_reminders(1440)::text'));
select t15.t('8 recordatorios','ejecución 3 idéntica: 0','^0$', t15.vsr('select public.generate_reservation_reminders(1440)::text'));
select t15.t('8 recordatorios','con p_now +8 h entra la reserva de 30 h (R6, otro jugador): +1','^1$', t15.vsr(format($q$select public.generate_reservation_reminders(1440, %L::timestamptz)::text$q$, now() + interval '8 hours')));
-- cambio de horario: se mueve R1 30 min
update public.reservations set starts_at = starts_at + interval '30 minutes', ends_at = ends_at + interval '30 minutes' where id = 'f5000000-0000-0000-0000-000000000001';
select t15.t('8 recordatorios','un cambio de horario genera un recordatorio con el nuevo horario (clave por inicio): +1','^1$', t15.vsr('select public.generate_reservation_reminders(1440)::text'));
select t15.t('8 recordatorios','y repetirlo no duplica','^0$', t15.vsr('select public.generate_reservation_reminders(1440)::text'));
update public.reservations set status = 'cancelled' where id = 'f5000000-0000-0000-0000-000000000001';
select t15.t('8 recordatorios','una reserva cancelada deja de recordarse (con p_now adelantado, nada nuevo para R1)','^0$', t15.vsr(format($q$select public.generate_reservation_reminders(1440, %L::timestamptz)::text$q$, now() + interval '8 hours')));
-- anticipación configurable: ventana de 60 min no incluye reservas de ~20 h
select t15.t('8 recordatorios','con anticipación configurable de 60 minutos no se recuerda nada a 20 h','^0$', t15.vsr('select public.generate_reservation_reminders(60)::text'));

-- ===================== 9. Dispositivos push =====================
create function t15.ep(n int) returns text language sql immutable as $$ select 'https://push.example.test/send/' || n $$;
create function t15.reg(p_user text, p_ep text, p_k text default null, p_a text default null) returns text language sql as $$
  select t15.vau(p_user, format('select public.register_push_subscription(%L, %L, %L, %L)::text', p_ep, coalesce(p_k, repeat('A', 87)), coalesce(p_a, repeat('B', 22)), 'TestAgent/1.0'))
$$;
delete from public.notifications;
select t15.t('9 push','pA1 registra su primer dispositivo','^[0-9a-f-]{36}$', t15.reg('pA1', t15.ep(1)));
select t15.t('9 push','endpoint no HTTPS rechazado','^ERR 22023', t15.reg('pA1', 'http://inseguro.test/x'));
select t15.t('9 push','clave p256dh inválida rechazada','^ERR 22023', t15.reg('pA1', t15.ep(2), 'corta'));
select t15.t('9 push','clave auth inválida rechazada','^ERR 22023', t15.reg('pA1', t15.ep(2), null, 'con espacios y símbolos <>'));
select t15.t('9 push','endpoint de más de 2048 caracteres rechazado','^ERR 22023', t15.reg('pA1', 'https://x.test/' || repeat('a', 2100)));
select t15.t('9 push','varios dispositivos por usuario: segundo y tercer dispositivo','^1$', (select (t15.reg('pA1', t15.ep(2)) is not null and t15.reg('pA1', t15.ep(3)) is not null and t15.q(format($q$select count(*)::text from public.push_subscriptions where user_id = %L$q$, t15.auth('pA1'))) = '3')::int::text));
select t15.reg('pA1', t15.ep(1));
select t15.t('9 push','registrar el mismo dispositivo dos veces no duplica (sigue en 3)','^3$', t15.q(format($q$select count(*)::text from public.push_subscriptions where user_id = %L$q$, t15.auth('pA1'))));
select t15.t('9 push','el jugador ve solo sus dispositivos (endpoint visible, claves no)','^3$', t15.vau('pA1', 'select count(*)::text from public.push_subscriptions'));
select t15.t('9 push','pA2 no ve los dispositivos de pA1','^0$', t15.vau('pA2', 'select count(*)::text from public.push_subscriptions'));
select t15.t('9 push','el owner no ve los dispositivos de los jugadores','^0$', t15.vau('ownerA', 'select count(*)::text from public.push_subscriptions'));
select max(t15.reg('pA2', t15.ep(100 + g))) from generate_series(1, 13) g;
select t15.t('9 push','tope de 10 dispositivos por usuario (13 registrados → 10)','^10$', t15.q(format($q$select count(*)::text from public.push_subscriptions where user_id = %L$q$, t15.auth('pA2'))));
-- revocar
select t15.vau('pA2', format('select public.revoke_push_subscription(%L)::text', t15.ep(1)));
select t15.t('9 push','un usuario NO puede revocar el dispositivo de otro','^3$', t15.q(format($q$select count(*)::text from public.push_subscriptions where user_id = %L$q$, t15.auth('pA1'))));
select t15.vau('pA1', format('select public.revoke_push_subscription(%L)::text', t15.ep(3)));
select t15.t('9 push','el dueño revoca su dispositivo (ya no figura)','^2$', t15.q(format($q$select count(*)::text from public.push_subscriptions where user_id = %L$q$, t15.auth('pA1'))));
select t15.t('9 push','revocar dos veces es inocuo','^OK rows=1$', t15.sau('pA1', format('select public.revoke_push_subscription(%L)', t15.ep(3))));

-- ===================== 10. Entregas push (cola, reintentos, suscripciones inválidas) =====================
-- pA1 tiene 2 dispositivos (1 y 2). Una notificación nueva para pA1 crea 2 entregas; para pA2, 10; para alguien sin dispositivos, 0.
create function t15.note(p_user text, p_key text, p_club text default 'c0000000-0000-0000-0000-00000000000a') returns void language sql as $$
  insert into public.notifications(club_id, user_id, kind, title, body, dedupe_key) values (p_club::uuid, t15.auth(p_user), 'news_published', 'Aviso ' || p_key, 'cuerpo', p_key)
$$;
select t15.note('pA1', 'p10-a');
select t15.t('10 entregas','una entrega por dispositivo vigente del destinatario (pA1 → 2)','^2$', t15.q($q$select count(*)::text from public.push_deliveries d join public.notifications n on n.id = d.notification_id where n.dedupe_key = 'p10-a'$q$));
select t15.note('stranger', 'p10-b');
select t15.t('10 entregas','un destinatario sin dispositivos no genera entregas','^0$', t15.q($q$select count(*)::text from public.push_deliveries d join public.notifications n on n.id = d.notification_id where n.dedupe_key = 'p10-b'$q$));
select t15.reg('stranger', t15.ep(500));
select t15.t('10 entregas','registrar un dispositivo DESPUÉS no recibe avisos viejos por push','^0$', t15.q($q$select count(*)::text from public.push_deliveries d join public.push_subscriptions s on s.id = d.subscription_id where s.endpoint = 'https://push.example.test/send/500'$q$));
select t15.t('10 entregas','dispositivo ya revocado: ya no tiene entregas (cascada)','^0$', t15.q($q$select count(*)::text from public.push_deliveries d where d.subscription_id not in (select id from public.push_subscriptions)$q$));
-- reclamar
select t15.put('CL1', t15.vsr('select public.claim_push_deliveries(1)::text'));
select t15.t('10 cola','service_role reclama 1 entrega con endpoint y claves para firmar','(?=.*"endpoint": "https://push.example.test/send/[12]")(?=.*"p256dh": "A+")(?=.*"auth": "B+")(?=.*"attempts": 1)', t15.get('CL1'));
select t15.t('10 cola','la entrega reclamada queda «sending» con bloqueo de 2 minutos','^1$', t15.q($q$select count(*)::text from public.push_deliveries where status = 'sending' and locked_until > now()$q$));
select t15.put('CL2', t15.vsr('select public.claim_push_deliveries(50)::text'));
select t15.t('10 cola','un segundo reclamo no repite la entrega bloqueada (solo trae la otra de pA1; las de pA2 no existen aún)','^1$', t15.q($q$select jsonb_array_length(t15.get('CL2')::jsonb)::text$q$));
select t15.t('10 cola','un tercer reclamo inmediato no trae nada (todo reservado)','^\[\]$', t15.vsr('select public.claim_push_deliveries(50)::text'));
-- completar
select t15.put('D1', t15.q($q$select (t15.get('CL1')::jsonb->0->>'delivery_id')$q$));
select t15.put('D2', t15.q($q$select (t15.get('CL2')::jsonb->0->>'delivery_id')$q$));
select t15.t('10 cola','completar «sent»','^(t|true)$', (select t15.vsr(format($q$select public.complete_push_delivery(%L, 'sent', 201)::text$q$, t15.get('D1'))) is not null and t15.q(format($q$select (status = 'sent' and sent_at is not null and http_status = 201)::text from public.push_deliveries where id = %L$q$, t15.get('D1'))) = 'true')::text);
select t15.vsr(format($q$select public.complete_push_delivery(%L, 'failed', 500, 'tarde')::text$q$, t15.get('D1')));
select t15.t('10 cola','completar dos veces es idempotente: sigue «sent»','^sent$', t15.q(format($q$select status from public.push_deliveries where id = %L$q$, t15.get('D1'))));
select t15.t('10 cola','completar con resultado inválido rechazado','^ERR 22023', t15.vsr(format($q$select public.complete_push_delivery(%L, 'quizas')::text$q$, t15.get('D2'))));
-- reintento con espera creciente
select t15.vsr(format($q$select public.complete_push_delivery(%L, 'retry', 503, 'servicio caído')::text$q$, t15.get('D2')));
select t15.t('10 cola','«retry»: vuelve a pendiente con espera (backoff) y cuenta el fallo del dispositivo','^pending\|true\|1$', t15.q(format($q$select d.status || '|' || (d.next_attempt_at > now())::text || '|' || s.failure_count from public.push_deliveries d join public.push_subscriptions s on s.id = d.subscription_id where d.id = %L$q$, t15.get('D2'))));
select t15.t('10 cola','una entrega con espera pendiente no se reclama antes de tiempo','^\[\]$', t15.vsr('select public.claim_push_deliveries(50)::text'));
update public.push_deliveries set next_attempt_at = now() - interval '1 second' where id = t15.get('D2')::uuid;
select t15.t('10 cola','vencida la espera se reclama otra vez (intento 2)','"attempts": 2', t15.vsr('select public.claim_push_deliveries(50)::text'));
-- agotar reintentos
update public.push_deliveries set attempts = 5 where id = t15.get('D2')::uuid;
select t15.vsr(format($q$select public.complete_push_delivery(%L, 'retry', 503, 'sigue caído')::text$q$, t15.get('D2')));
select t15.t('10 cola','agotados los 5 intentos: queda «failed» (no reintenta indefinidamente)','^(f|false)|2097152ailed$', t15.q(format($q$select status from public.push_deliveries where id = %L$q$, t15.get('D2'))));
-- suscripción inválida (404/410) → se elimina
select t15.note('pA2', 'p10-c');
select t15.put('CL3', t15.vsr('select public.claim_push_deliveries(50)::text'));
select t15.t('10 cola','aviso a pA2 (10 dispositivos) crea 10 entregas reclamables','^10$', t15.q($q$select jsonb_array_length(t15.get('CL3')::jsonb)::text$q$));
select t15.put('D3', t15.q($q$select (t15.get('CL3')::jsonb->0->>'delivery_id')$q$));
select t15.put('S3', t15.q(format($q$select subscription_id::text from public.push_deliveries where id = %L$q$, t15.get('D3'))));
select t15.vsr(format($q$select public.complete_push_delivery(%L, 'gone', 410, 'Gone')::text$q$, t15.get('D3')));
select t15.t('10 inválidas','respuesta 410 «gone»: la suscripción se ELIMINA y con ella sus entregas','^0\|0$', t15.q(format($q$select (select count(*) from public.push_subscriptions where id = %L) || '|' || (select count(*) from public.push_deliveries where subscription_id = %L)$q$, t15.get('S3'), t15.get('S3'))));
-- demasiados fallos acumulados → baja del dispositivo
select t15.put('D4', t15.q($q$select (t15.get('CL3')::jsonb->1->>'delivery_id')$q$));
select t15.put('S4', t15.q(format($q$select subscription_id::text from public.push_deliveries where id = %L$q$, t15.get('D4'))));
update public.push_subscriptions set failure_count = 9 where id = t15.get('S4')::uuid;
select t15.vsr(format($q$select public.complete_push_delivery(%L, 'failed', 500, 'error')::text$q$, t15.get('D4')));
select t15.t('10 inválidas','10 fallos acumulados: el dispositivo se da de baja','^0$', t15.q(format($q$select count(*)::text from public.push_subscriptions where id = %L$q$, t15.get('S4'))));
-- caducidad: leída o vieja
select t15.note('pA1', 'p10-d');
update public.notifications set read_at = now() where dedupe_key = 'p10-d';
select t15.vsr('select public.claim_push_deliveries(50)::text');
select t15.t('10 cola','una notificación ya leída en la app NO se envía por push (la entrega caduca)','^expired$', t15.q($q$select string_agg(distinct d.status, ',') from public.push_deliveries d join public.notifications n on n.id = d.notification_id where n.dedupe_key = 'p10-d'$q$));
select t15.t('10 cola','…y queda «expired»','^expired$', t15.q($q$select distinct d.status from public.push_deliveries d join public.notifications n on n.id = d.notification_id where n.dedupe_key = 'p10-d'$q$));
select t15.note('pA1', 'p10-e');
update public.notifications set created_at = now() - interval '2 days' where dedupe_key = 'p10-e';
select t15.vsr('select public.claim_push_deliveries(50)::text');
select t15.t('10 cola','un aviso de hace más de 24 h no se envía (expired)','^expired$', t15.q($q$select distinct d.status from public.push_deliveries d join public.notifications n on n.id = d.notification_id where n.dedupe_key = 'p10-e'$q$));
-- filtro por club (envío masivo restringido por club)
select t15.note('pB', 'p10-f', 'c0000000-0000-0000-0000-00000000000b');
select t15.reg('pB', t15.ep(700));
select t15.note('pB', 'p10-g', 'c0000000-0000-0000-0000-00000000000b');
select t15.t('10 cola','el reclamo restringido a los clubes del emisor NO trae entregas del otro club','^0$', t15.q(format($q$select jsonb_array_length(public.claim_push_deliveries(50, array[%L]::uuid[]))::text$q$, 'c0000000-0000-0000-0000-00000000000a')));
select t15.t('10 cola','…y sí las del club indicado','^1$', t15.q(format($q$select jsonb_array_length(public.claim_push_deliveries(50, array[%L]::uuid[]))::text$q$, 'c0000000-0000-0000-0000-00000000000b')));
-- cambio de cuenta en el mismo navegador
select t15.reg('stranger', t15.ep(800));
select t15.note('stranger', 'p10-h');
select t15.reg('pA1', t15.ep(800));
select t15.t('10 cuenta','el mismo navegador cambia de cuenta: el aviso pendiente de la cuenta anterior NO se entrega a la nueva','^0$', t15.q($q$select count(*)::text from public.push_deliveries d join public.push_subscriptions s on s.id = d.subscription_id join public.notifications n on n.id = d.notification_id where s.endpoint = 'https://push.example.test/send/800' and n.dedupe_key = 'p10-h' and d.status in ('pending','sending')$q$));
select t15.t('10 cuenta','…y el dispositivo ahora pertenece a la cuenta nueva','^a0000000-0000-0000-0000-000000000005$', t15.q($q$select user_id::text from public.push_subscriptions where endpoint = 'https://push.example.test/send/800'$q$));

-- ===================== 11. Storage (políticas sobre storage.objects del stub) =====================
\set IMGA '''c0000000-0000-0000-0000-00000000000a/11111111-1111-1111-1111-111111111111.png'''
select t15.t('11 storage','owner sube a la carpeta de SU club','^OK rows=1$', t15.sau('ownerA', $q$insert into storage.objects(bucket_id, name) values ('club-post-images', 'c0000000-0000-0000-0000-00000000000a/11111111-1111-1111-1111-111111111111.png')$q$));
select t15.t('11 storage','owner NO sube a la carpeta de OTRO club','^ERR 42501', t15.sau('ownerA', $q$insert into storage.objects(bucket_id, name) values ('club-post-images', 'c0000000-0000-0000-0000-00000000000b/22222222-2222-2222-2222-222222222222.png')$q$));
select t15.t('11 storage','staff NO sube','^ERR 42501', t15.sau('staffA', $q$insert into storage.objects(bucket_id, name) values ('club-post-images', 'c0000000-0000-0000-0000-00000000000a/33333333-3333-3333-3333-333333333333.png')$q$));
select t15.t('11 storage','jugador NO sube','^ERR 42501', t15.sau('pA1', $q$insert into storage.objects(bucket_id, name) values ('club-post-images', 'c0000000-0000-0000-0000-00000000000a/44444444-4444-4444-4444-444444444444.png')$q$));
select t15.t('11 storage','anon NO sube','^ERR 42501', t15.sa('anon', null, $q$insert into storage.objects(bucket_id, name) values ('club-post-images', 'c0000000-0000-0000-0000-00000000000a/55555555-5555-5555-5555-555555555555.png')$q$));
select t15.t('11 storage','ruta sin carpeta de club (raíz) denegada','^ERR 42501', t15.sau('ownerA', $q$insert into storage.objects(bucket_id, name) values ('club-post-images', '66666666-6666-6666-6666-666666666666.png')$q$));
select t15.t('11 storage','OVERWRITE: nadie puede actualizar un archivo existente (no hay política de UPDATE)','^OK rows=0$', t15.sau('ownerA', $q$update storage.objects set name = name where bucket_id = 'club-post-images'$q$));
select t15.put('IMGP', t15.mk('ownerA', :CA, 'news', 'Con portada', 'Tiene imagen.', null, null, null, false, null, 'c0000000-0000-0000-0000-00000000000a/11111111-1111-1111-1111-111111111111.png', 60));
select t15.t('11 storage','crear con una imagen que SÍ está en el bucket del club','^[0-9a-f-]{36}$', t15.get('IMGP'));
select t15.t('11 storage','mientras es borrador el jugador NO ve el archivo','^0$', t15.vau('pA1', 'select count(*)::text from storage.objects'));
select t15.t('11 storage','el owner sí ve el archivo','^1$', t15.vau('ownerA', 'select count(*)::text from storage.objects'));
select t15.t('11 storage','el owner del club B NO ve el archivo del club A','^0$', t15.vau('ownerB', 'select count(*)::text from storage.objects'));
select t15.pub('ownerA', t15.get('IMGP'), false);
select t15.t('11 storage','publicada: el jugador del club A sí lee la imagen','^1$', t15.vau('pA1', 'select count(*)::text from storage.objects'));
select t15.t('11 storage','publicada: el jugador del club B NO la lee','^0$', t15.vau('pB', 'select count(*)::text from storage.objects'));
select t15.t('11 storage','publicada: una cuenta sin vínculo NO la lee','^0$', t15.vau('stranger', 'select count(*)::text from storage.objects'));
select t15.t('11 storage','publicada: staff del club la lee','^1$', t15.vau('staffA', 'select count(*)::text from storage.objects'));
select t15.t('11 storage','anon no lee','^ERR 42501|^0$', t15.sa('anon', null, 'select count(*)::text from storage.objects'));
select t15.vau('ownerA', format('select (public.archive_club_post(%L)).status', t15.get('IMGP')));
select t15.t('11 storage','archivada: el jugador deja de poder leer la imagen','^0$', t15.vau('pA1', 'select count(*)::text from storage.objects'));
select t15.t('11 storage','owner elimina archivos de su club (limpieza al reemplazar)','^OK rows=1$', t15.sau('ownerA', $q$delete from storage.objects where bucket_id = 'club-post-images'$q$));
select t15.t('11 storage','jugador NO elimina','^OK rows=0$|^ERR 42501', t15.sau('pA1', $q$delete from storage.objects where bucket_id = 'club-post-images'$q$));

-- ===================== 12. Integridad =====================
select t15.t('12 integridad','borrar publicaciones está bloqueado por trigger','^ERR 55000', t15.sa('postgres', null, 'delete from public.club_posts'));
select t15.t('12 integridad','club_id de una publicación no se puede reasignar','^ERR 42501', t15.sa('postgres', null, $q$update public.club_posts set club_id = 'c0000000-0000-0000-0000-00000000000b'$q$));
select t15.t('12 integridad','dos notificaciones con la misma clave para el mismo usuario son imposibles (UNIQUE)','^ERR 23505', t15.sa('postgres', null, format($q$insert into public.notifications(club_id,user_id,kind,title,dedupe_key) values (%L,%L,'news_published','x','p10-a')$q$, 'c0000000-0000-0000-0000-00000000000a', t15.auth('pA1'))));
select t15.t('12 integridad','una notificación con destino a medias (tipo sin id) es imposible','^ERR 23514', t15.sa('postgres', null, format($q$insert into public.notifications(club_id,user_id,kind,title,dedupe_key,target_type) values (%L,%L,'news_published','x','zz','post')$q$, 'c0000000-0000-0000-0000-00000000000a', t15.auth('pA1'))));
select t15.t('12 integridad','tipo de notificación inválido es imposible','^ERR 23514', t15.sa('postgres', null, format($q$insert into public.notifications(club_id,user_id,kind,title,dedupe_key) values (%L,%L,'chat','x','zz2')$q$, 'c0000000-0000-0000-0000-00000000000a', t15.auth('pA1'))));

-- =============================== Resumen ===============================
select area, count(*) filter (where ok) as cumple, count(*) filter (where not ok) as no_cumple, count(*) as total from t15.results group by area order by area;
select ' TOTAL' as area, count(*) filter (where ok) as cumple, count(*) filter (where not ok) as no_cumple, count(*) as total from t15.results;
\pset format unaligned
select n || E'	' || area || E'	' || test || E'	expected=' || expected || E'	actual=' || actual from t15.results where not ok order by n;
