-- Sprint 15: Novedades (noticias y eventos), centro de notificaciones, suscripciones Web Push y recordatorios de reservas.
-- Requiere las migraciones 01–14 (clubes, reservas, personas, portal, torneos). NO se aplica automáticamente a Supabase.
--
-- Principios (docs/CURRENT_STATE.md, «Sprint 15»):
--   * Owner/admin administran publicaciones (borrador → publicada → archivada). Staff y jugadores solo leen las publicadas de su club.
--   * Una notificación es una fila PERSISTIDA dirigida a una cuenta de Auth real (club_person_auth_links). Nunca a personas sin cuenta.
--   * Sin duplicados: UNIQUE (user_id, dedupe_key). Editar, reintentar o republicar no genera avisos nuevos.
--   * El push es un canal adicional del centro interno: cada notificación crea una entrega por dispositivo y una Edge Function
--     (supabase/functions/dispatch-push) las despacha con la clave privada VAPID, que vive solo en secretos del servidor.
--   * Las notificaciones de reservas son «mejor esfuerzo»: un fallo al generarlas NUNCA aborta la reserva (WARNING).
--   * Los recordatorios los genera una función idempotente pensada para pg_cron (ver supabase/ops/schedule-notifications.sql; no se programa aquí).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Permiso de administración de publicaciones (owner/admin; staff NO)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.can_manage_club_posts(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.club_staff
    where club_id = target_club_id
      and auth_user_id = (select auth.uid())
      and role in ('owner'::public.club_staff_role, 'admin'::public.club_staff_role)
  );
$$;
revoke all on function private.can_manage_club_posts(uuid) from public, anon;
grant execute on function private.can_manage_club_posts(uuid) to authenticated;
-- Las políticas de storage.objects se evalúan con el rol del usuario: necesita ejecutar este predicado (solo informa sobre SU propia cuenta).
grant execute on function private.is_active_linked_player(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Publicaciones
-- ---------------------------------------------------------------------------------------------------------------
create table public.club_posts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  kind text not null check (kind in ('news', 'event')),
  title text not null check (char_length(trim(title)) between 3 and 140),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  is_featured boolean not null default false,
  event_date date check (event_date is null or event_date between date '2020-01-01' and date '2100-12-31'),
  event_time time,
  location text check (location is null or char_length(trim(location)) between 1 and 140),
  image_path text,
  tournament_id uuid,
  client_request_id uuid not null,
  published_at timestamptz,
  archived_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  constraint club_posts_club_id_id_key unique (club_id, id),
  constraint club_posts_club_request_key unique (club_id, client_request_id),
  constraint club_posts_tournament_belongs_to_club
    foreign key (club_id, tournament_id) references public.tournaments (club_id, id) on delete restrict,
  -- Un comunicado no exige (ni admite) fecha; un evento sí la exige. La hora solo existe junto a una fecha.
  constraint club_posts_news_has_no_date check (kind = 'event' or (event_date is null and event_time is null)),
  constraint club_posts_event_has_date check (kind = 'news' or event_date is not null),
  constraint club_posts_time_needs_date check (event_time is null or event_date is not null),
  constraint club_posts_status_dates check (
    (status <> 'published' or published_at is not null) and (status <> 'archived' or archived_at is not null)
  ),
  -- Solo texto: se rechaza cualquier cosa con forma de etiqueta HTML (<b>, </p>, <!--, <?xml, <script…). Además React nunca interpreta HTML.
  constraint club_posts_plain_text check (
    title !~ '<\s*/?\s*[A-Za-z!?]' and body !~ '<\s*/?\s*[A-Za-z!?]' and (location is null or location !~ '<\s*/?\s*[A-Za-z!?]')
  ),
  -- La imagen vive en el bucket privado `club-post-images`, bajo la carpeta del propio club, con nombre aleatorio y extensión permitida.
  constraint club_posts_image_path_format check (
    image_path is null or (
      image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
      and starts_with(image_path, club_id::text || '/')
    )
  )
);
create index club_posts_club_status_idx on public.club_posts (club_id, status, published_at desc);
create index club_posts_club_event_idx on public.club_posts (club_id, event_date) where kind = 'event' and status = 'published';

create or replace function private.set_club_post_updated_at()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$ begin new.updated_at := now(); return new; end; $$;
create trigger club_posts_set_updated_at before update on public.club_posts for each row execute function private.set_club_post_updated_at();
create trigger club_posts_prevent_club_id_change before update of club_id on public.club_posts for each row execute function private.prevent_club_id_change();

create or replace function private.forbid_club_post_delete()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$ begin raise exception 'Las publicaciones no se borran: se archivan.' using errcode = '55000'; end; $$;
create trigger club_posts_forbid_delete before delete on public.club_posts for each row execute function private.forbid_club_post_delete();
revoke all on function private.set_club_post_updated_at(), private.forbid_club_post_delete() from public, anon, authenticated;

alter table public.club_posts enable row level security;
revoke all on table public.club_posts from anon, authenticated;
grant select on table public.club_posts to authenticated;
-- Solo owner/admin leen la tabla completa (incluye borradores). Staff y jugadores leen únicamente por club_posts_feed().
create policy "owners and admins read posts of their clubs" on public.club_posts for select to authenticated
using (private.can_manage_club_posts(club_id));

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Notificaciones internas (persistidas, una fila por destinatario)
-- ---------------------------------------------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('news_published', 'event_published', 'reservation_confirmed', 'reservation_cancelled', 'reservation_reminder')),
  title text not null check (char_length(title) between 1 and 140),
  body text check (body is null or char_length(body) <= 240),
  -- Destino lógico dentro de la app (sin URL libre). No es FK: la notificación debe sobrevivir a su objetivo.
  target_type text check (target_type in ('post', 'reservation')),
  target_id uuid,
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_user_dedupe_key unique (user_id, dedupe_key),
  constraint notifications_target_pair check ((target_type is null) = (target_id is null))
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_user_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
revoke all on table public.notifications from anon, authenticated;
grant select on table public.notifications to authenticated;
create policy "users read their own notifications" on public.notifications for select to authenticated
using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Dispositivos Web Push y entregas
-- ---------------------------------------------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 2048),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{40,140}$'),
  auth_secret text not null check (auth_secret ~ '^[A-Za-z0-9_-]{12,60}$'),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  failure_count smallint not null default 0,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
-- Las claves de cifrado (p256dh/auth_secret) no se exponen al navegador: solo se otorga lectura de columnas no sensibles.
revoke all on table public.push_subscriptions from anon, authenticated;
grant select (id, user_id, endpoint, user_agent, created_at, last_seen_at) on table public.push_subscriptions to authenticated;
create policy "users read their own push subscriptions" on public.push_subscriptions for select to authenticated
using (user_id = (select auth.uid()));

create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'expired')),
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  http_status integer,
  last_error text check (last_error is null or char_length(last_error) <= 200),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint push_deliveries_once_per_device unique (notification_id, subscription_id)
);
create index push_deliveries_queue_idx on public.push_deliveries (next_attempt_at) where status in ('pending', 'sending');
create index push_deliveries_subscription_idx on public.push_deliveries (subscription_id);

-- Solo la Edge Function (service_role, que omite RLS) opera esta tabla vía las RPC claim/complete. Sin políticas ni grants.
alter table public.push_deliveries enable row level security;
revoke all on table public.push_deliveries from anon, authenticated;

-- Cada notificación nueva genera una entrega por cada dispositivo vigente de su destinatario. Quien se suscribe después
-- no recibe avisos viejos por push (los ve en el centro interno).
create or replace function private.enqueue_push_deliveries()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
begin
  insert into public.push_deliveries (notification_id, subscription_id)
  select new.id, s.id from public.push_subscriptions s where s.user_id = new.user_id
  on conflict do nothing;
  return null;
end;
$$;
create trigger notifications_enqueue_push after insert on public.notifications for each row execute function private.enqueue_push_deliveries();
revoke all on function private.enqueue_push_deliveries() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Helpers internos
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.format_local_slot(p_starts timestamptz, p_ends timestamptz, p_timezone text)
returns text language sql stable set search_path = pg_catalog
as $$
  select (array['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'])[extract(dow from timezone(p_timezone, p_starts))::int + 1]
    || ' ' || to_char(timezone(p_timezone, p_starts), 'DD/MM')
    || ' · ' || to_char(timezone(p_timezone, p_starts), 'HH24:MI') || '–' || to_char(timezone(p_timezone, p_ends), 'HH24:MI');
$$;
revoke all on function private.format_local_slot(timestamptz, timestamptz, text) from public, anon, authenticated;

create or replace function private.notify_user(
  p_club_id uuid, p_user_id uuid, p_kind text, p_title text, p_body text, p_target_type text, p_target_id uuid, p_dedupe_key text
)
returns boolean language plpgsql security definer set search_path = pg_catalog
as $$
declare v_inserted integer;
begin
  insert into public.notifications (club_id, user_id, kind, title, body, target_type, target_id, dedupe_key)
  values (p_club_id, p_user_id, p_kind, left(p_title, 140), left(p_body, 240), p_target_type, p_target_id, p_dedupe_key)
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;
revoke all on function private.notify_user(uuid, uuid, text, text, text, text, uuid, text) from public, anon, authenticated;

-- Difusión de una publicación: solo cuentas vinculadas a una persona ACTIVA del club (nunca a fichas sin cuenta) y distintas de quien publica.
create or replace function private.broadcast_club_post(p_post public.club_posts, p_actor uuid)
returns integer language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_timezone text;
  v_title text;
  v_body text;
  v_kind text;
  v_key text;
  v_count integer;
begin
  select timezone into v_timezone from public.clubs where id = p_post.club_id;
  if p_post.kind = 'event' then
    v_kind := 'event_published';
    v_title := p_post.title;
    v_body := (array['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'])[extract(dow from p_post.event_date)::int + 1]
      || ' ' || to_char(p_post.event_date, 'DD/MM')
      || coalesce(' · ' || to_char(p_post.event_time, 'HH24:MI'), '')
      || coalesce(' · ' || p_post.location, '');
  else
    v_kind := 'news_published';
    v_title := p_post.title;
    v_body := left(regexp_replace(p_post.body, '\s+', ' ', 'g'), 140);
  end if;
  -- Un torneo anunciado por varias publicaciones avisa una sola vez por jugador.
  v_key := case when p_post.tournament_id is not null then 'tournament:' || p_post.tournament_id::text else 'post:' || p_post.id::text end;

  insert into public.notifications (club_id, user_id, kind, title, body, target_type, target_id, dedupe_key)
  select p_post.club_id, l.auth_user_id, v_kind, left(v_title, 140), left(v_body, 240), 'post', p_post.id, v_key
  from public.club_person_auth_links l
  join public.club_people p on p.club_id = l.club_id and p.id = l.person_id and p.active
  where l.club_id = p_post.club_id
    and l.auth_user_id is distinct from p_actor
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.broadcast_club_post(public.club_posts, uuid) from public, anon, authenticated;

create or replace function private.club_id_from_post_image_path(p_name text)
returns uuid language sql immutable set search_path = pg_catalog
as $$
  select case when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then substring(p_name from 1 for 36)::uuid end;
$$;
revoke all on function private.club_id_from_post_image_path(text) from public, anon;
grant execute on function private.club_id_from_post_image_path(text) to authenticated;

-- Validación común de create/update. Lanza 22023 con mensajes en español para mostrar tal cual.
create or replace function private.validate_club_post(
  p_club_id uuid, p_kind text, p_title text, p_body text, p_event_date date, p_event_time time, p_location text,
  p_image_path text, p_tournament_id uuid, p_check_date_not_past boolean
)
returns void language plpgsql security definer set search_path = pg_catalog
as $$
declare v_timezone text;
begin
  if p_kind not in ('news', 'event') then raise exception 'El tipo de publicación no es válido.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_title, ''))) < 3 or char_length(trim(p_title)) > 140 then raise exception 'El título debe tener entre 3 y 140 caracteres.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 or char_length(trim(p_body)) > 4000 then raise exception 'La descripción es obligatoria y puede tener hasta 4000 caracteres.' using errcode = '22023'; end if;
  if p_location is not null and (char_length(trim(p_location)) = 0 or char_length(trim(p_location)) > 140) then raise exception 'El lugar puede tener hasta 140 caracteres.' using errcode = '22023'; end if;
  if p_title ~ '<\s*/?\s*[A-Za-z!?]' or p_body ~ '<\s*/?\s*[A-Za-z!?]' or coalesce(p_location, '') ~ '<\s*/?\s*[A-Za-z!?]' then
    raise exception 'El texto no puede contener código HTML. Escribí solo texto plano.' using errcode = '22023';
  end if;
  if p_kind = 'news' and (p_event_date is not null or p_event_time is not null) then raise exception 'Un comunicado no lleva fecha ni hora de evento.' using errcode = '22023'; end if;
  if p_kind = 'event' then
    if p_event_date is null then raise exception 'Indicá la fecha del evento.' using errcode = '22023'; end if;
    if p_event_date < date '2020-01-01' or p_event_date > date '2100-12-31' then raise exception 'La fecha del evento no es válida.' using errcode = '22023'; end if;
    if p_check_date_not_past then
      select timezone into v_timezone from public.clubs where id = p_club_id;
      if p_event_date < (now() at time zone v_timezone)::date then raise exception 'La fecha del evento no puede estar en el pasado.' using errcode = '22023'; end if;
    end if;
  end if;
  if p_tournament_id is not null and not exists (select 1 from public.tournaments where club_id = p_club_id and id = p_tournament_id) then
    raise exception 'El torneo elegido no pertenece a este club.' using errcode = '23503';
  end if;
  if p_image_path is not null then
    if p_image_path !~ ('^' || p_club_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$') then
      raise exception 'La imagen no es válida para este club.' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'club-post-images' and name = p_image_path) then
      raise exception 'La imagen no se subió correctamente. Intentá de nuevo.' using errcode = '22023';
    end if;
  end if;
end;
$$;
revoke all on function private.validate_club_post(uuid, text, text, text, date, time, text, text, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. RPC de publicaciones (owner/admin)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.create_club_post(
  p_club_id uuid, p_kind text, p_title text, p_body text, p_event_date date, p_event_time time, p_location text,
  p_is_featured boolean, p_tournament_id uuid, p_image_path text, p_client_request_id uuid
)
returns public.club_posts language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_post public.club_posts;
begin
  if auth.uid() is null or not private.can_manage_club_posts(p_club_id) then raise exception 'No tenés permiso para crear publicaciones en este club.' using errcode = '42501'; end if;
  if p_client_request_id is null then raise exception 'Falta la clave de la operación.' using errcode = '22023'; end if;
  -- Reintento de la misma operación (doble clic, red caída): devuelve la publicación original.
  select * into v_post from public.club_posts where club_id = p_club_id and client_request_id = p_client_request_id;
  if found then return v_post; end if;
  perform private.validate_club_post(p_club_id, p_kind, p_title, p_body, p_event_date, p_event_time, nullif(trim(coalesce(p_location, '')), ''), p_image_path, p_tournament_id, true);
  insert into public.club_posts (club_id, kind, title, body, is_featured, event_date, event_time, location, image_path, tournament_id, client_request_id, created_by, updated_by)
  values (p_club_id, p_kind, trim(p_title), trim(p_body), coalesce(p_is_featured, false), p_event_date, p_event_time, nullif(trim(coalesce(p_location, '')), ''), p_image_path, p_tournament_id, p_client_request_id, auth.uid(), auth.uid())
  returning * into v_post;
  return v_post;
exception when unique_violation then
  -- Carrera con otro reintento idéntico: la fila ya existe.
  select * into v_post from public.club_posts where club_id = p_club_id and client_request_id = p_client_request_id;
  if found then return v_post; end if;
  raise;
end;
$$;

create or replace function public.update_club_post(
  p_post_id uuid, p_kind text, p_title text, p_body text, p_event_date date, p_event_time time, p_location text,
  p_is_featured boolean, p_tournament_id uuid, p_image_path text
)
returns public.club_posts language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_club_id uuid; v_post public.club_posts; v_date_changed boolean;
begin
  select club_id into v_club_id from public.club_posts where id = p_post_id;
  if auth.uid() is null or v_club_id is null or not private.can_manage_club_posts(v_club_id) then raise exception 'No tenés permiso para editar esta publicación.' using errcode = '42501'; end if;
  select * into v_post from public.club_posts where id = p_post_id for update;
  if v_post.status <> 'draft' and p_kind is distinct from v_post.kind then raise exception 'El tipo solo se puede cambiar mientras es borrador.' using errcode = '22023'; end if;
  -- La fecha se controla contra «hoy» solo si cambió o si aún es borrador: corregir el texto de un evento ya pasado no debe fallar.
  v_date_changed := v_post.status = 'draft' or p_event_date is distinct from v_post.event_date;
  perform private.validate_club_post(v_club_id, p_kind, p_title, p_body, p_event_date, p_event_time, nullif(trim(coalesce(p_location, '')), ''), p_image_path, p_tournament_id, v_date_changed);
  update public.club_posts set
    kind = p_kind, title = trim(p_title), body = trim(p_body), is_featured = coalesce(p_is_featured, false),
    event_date = p_event_date, event_time = p_event_time, location = nullif(trim(coalesce(p_location, '')), ''),
    image_path = p_image_path, tournament_id = p_tournament_id, updated_by = auth.uid()
  where id = p_post_id returning * into v_post;
  return v_post;
end;
$$;

-- Publica (o republica desde archivada) y, si se pide, avisa UNA sola vez a los jugadores. Reintentar no repite el aviso.
create or replace function public.publish_club_post(p_post_id uuid, p_notify boolean default false)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_club_id uuid;
  v_post public.club_posts;
  v_timezone text;
  v_recipients integer := 0;
  v_notified boolean := false;
  v_already boolean := false;
begin
  select club_id into v_club_id from public.club_posts where id = p_post_id;
  if auth.uid() is null or v_club_id is null or not private.can_manage_club_posts(v_club_id) then raise exception 'No tenés permiso para publicar en este club.' using errcode = '42501'; end if;
  -- El candado de fila serializa dos publicaciones simultáneas: la segunda ve notified_at ya fijado.
  select * into v_post from public.club_posts where id = p_post_id for update;
  if v_post.status <> 'published' then
    select timezone into v_timezone from public.clubs where id = v_club_id;
    if v_post.kind = 'event' and v_post.event_date < (now() at time zone v_timezone)::date then raise exception 'No se puede publicar un evento con fecha pasada. Editá la fecha primero.' using errcode = '22023'; end if;
    update public.club_posts set status = 'published', published_at = coalesce(published_at, now()), archived_at = null, updated_by = auth.uid() where id = p_post_id returning * into v_post;
  end if;
  if coalesce(p_notify, false) then
    if v_post.kind = 'news' and not v_post.is_featured then raise exception 'Solo las noticias destacadas pueden enviarse como aviso. Marcala como destacada.' using errcode = '22023'; end if;
    if v_post.notified_at is not null then
      v_already := true;
    else
      v_recipients := private.broadcast_club_post(v_post, auth.uid());
      update public.club_posts set notified_at = now() where id = p_post_id returning * into v_post;
      v_notified := true;
    end if;
  end if;
  return jsonb_build_object('id', v_post.id, 'status', v_post.status, 'published_at', v_post.published_at, 'notified', v_notified, 'already_notified', v_already, 'recipients', v_recipients);
end;
$$;

create or replace function public.archive_club_post(p_post_id uuid)
returns public.club_posts language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_club_id uuid; v_post public.club_posts;
begin
  select club_id into v_club_id from public.club_posts where id = p_post_id;
  if auth.uid() is null or v_club_id is null or not private.can_manage_club_posts(v_club_id) then raise exception 'No tenés permiso para archivar esta publicación.' using errcode = '42501'; end if;
  select * into v_post from public.club_posts where id = p_post_id for update;
  if v_post.status <> 'archived' then
    update public.club_posts set status = 'archived', archived_at = now(), updated_by = auth.uid() where id = p_post_id returning * into v_post;
  end if;
  return v_post;
end;
$$;

-- Lectura para staff y jugadores vinculados: solo publicadas del club. Eventos próximos primero; luego lo más reciente.
create or replace function public.club_posts_feed(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public
as $$
declare v_timezone text; v_today date;
begin
  if auth.uid() is null or (not private.is_club_member(p_club_id) and not private.is_active_linked_player(p_club_id)) then raise exception 'No tenés permiso para ver las novedades de este club.' using errcode = '42501'; end if;
  select timezone into v_timezone from public.clubs where id = p_club_id;
  v_today := (now() at time zone v_timezone)::date;
  return coalesce((
    select jsonb_agg((to_jsonb(x) - 'sort_group' - 'sort_date') order by x.sort_group, x.sort_date, x.published_at desc)
    from (
      select * from (
        select p.id, p.kind, p.title, p.body, p.is_featured, p.event_date, p.event_time, p.location, p.image_path, p.tournament_id, p.published_at,
               0 as sort_group, (p.event_date - date '2020-01-01') as sort_date
        from public.club_posts p
        where p.club_id = p_club_id and p.status = 'published' and p.kind = 'event' and p.event_date >= v_today
        order by p.event_date, p.event_time nulls last limit 100
      ) upcoming
      union all
      select * from (
        select p.id, p.kind, p.title, p.body, p.is_featured, p.event_date, p.event_time, p.location, p.image_path, p.tournament_id, p.published_at,
               1 as sort_group, (date '2100-12-31' - coalesce(p.event_date, (p.published_at at time zone v_timezone)::date)) as sort_date
        from public.club_posts p
        where p.club_id = p_club_id and p.status = 'published' and not (p.kind = 'event' and p.event_date >= v_today)
        order by coalesce(p.event_date, (p.published_at at time zone v_timezone)::date) desc, p.published_at desc limit 60
      ) others
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. RPC del centro de notificaciones (solo filas propias)
-- ---------------------------------------------------------------------------------------------------------------
-- Lista propia (más recientes primero) + total de no leídas, opcionalmente de un solo club. Nunca devuelve filas ajenas.
create or replace function public.my_notifications(p_club_id uuid default null, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'Necesitás iniciar sesión.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'unread', (select count(*) from public.notifications n where n.user_id = auth.uid() and n.read_at is null and (p_club_id is null or n.club_id = p_club_id)),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'club_id', x.club_id, 'kind', x.kind, 'title', x.title, 'body', x.body,
        'target_type', x.target_type, 'target_id', x.target_id, 'created_at', x.created_at, 'read_at', x.read_at) order by x.created_at desc)
      from (
        select n.* from public.notifications n
        where n.user_id = auth.uid() and (p_club_id is null or n.club_id = p_club_id)
        order by n.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100)
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'Necesitás iniciar sesión.' using errcode = '42501'; end if;
  update public.notifications set read_at = now() where id = p_notification_id and user_id = auth.uid() and read_at is null;
end;
$$;

create or replace function public.mark_all_notifications_read(p_club_id uuid default null)
returns integer language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'Necesitás iniciar sesión.' using errcode = '42501'; end if;
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null and (p_club_id is null or club_id = p_club_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. RPC de dispositivos push (cada usuario gestiona solo los suyos)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_id uuid; v_previous_owner uuid;
begin
  if auth.uid() is null then raise exception 'Necesitás iniciar sesión.' using errcode = '42501'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 2048
     or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{40,140}$' or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{12,60}$' then
    raise exception 'La suscripción del dispositivo no es válida.' using errcode = '22023';
  end if;
  loop
    select id, user_id into v_id, v_previous_owner from public.push_subscriptions where endpoint = p_endpoint for update;
    if found then
      -- El mismo navegador cambió de cuenta: sus avisos pendientes pertenecían a la cuenta anterior y NO deben llegar a la nueva.
      if v_previous_owner <> auth.uid() then delete from public.push_deliveries where subscription_id = v_id and status in ('pending', 'sending'); end if;
      update public.push_subscriptions set user_id = auth.uid(), p256dh = p_p256dh, auth_secret = p_auth, user_agent = left(p_user_agent, 300), failure_count = 0, last_seen_at = now() where id = v_id;
      exit;
    end if;
    begin
      insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_secret, user_agent) values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300)) returning id into v_id;
      exit;
    exception when unique_violation then
      -- Otra sesión registró el mismo dispositivo a la vez: se reintenta como actualización.
      null;
    end;
  end loop;
  -- Varios dispositivos por usuario, con tope: se descartan los más antiguos.
  delete from public.push_subscriptions where user_id = auth.uid() and id in (
    select id from public.push_subscriptions where user_id = auth.uid() order by last_seen_at desc offset 10
  );
  return v_id;
end;
$$;

create or replace function public.revoke_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'Necesitás iniciar sesión.' using errcode = '42501'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 9. Cola de entregas para la Edge Function (service_role únicamente)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.claim_push_deliveries(p_limit integer default 50, p_club_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_result jsonb;
begin
  -- Caducan las entregas de avisos viejos (>24 h) o que el usuario ya leyó en la app.
  update public.push_deliveries d set status = 'expired', locked_until = null
  from public.notifications n
  where n.id = d.notification_id and d.status in ('pending', 'sending') and (n.created_at < now() - interval '24 hours' or n.read_at is not null);

  with picked as (
    select d.id from public.push_deliveries d join public.notifications n on n.id = d.notification_id
    where ((d.status = 'pending' and d.next_attempt_at <= now()) or (d.status = 'sending' and d.locked_until < now()))
      and (p_club_ids is null or n.club_id = any (p_club_ids))
    order by d.next_attempt_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    for update of d skip locked
  ), claimed as (
    update public.push_deliveries d set status = 'sending', attempts = d.attempts + 1, locked_until = now() + interval '2 minutes'
    from picked where d.id = picked.id returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'delivery_id', c.id, 'attempts', c.attempts, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth_secret,
    'notification_id', n.id, 'club_id', n.club_id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'target_type', n.target_type, 'target_id', n.target_id
  )), '[]'::jsonb) into v_result
  from claimed c join public.notifications n on n.id = c.notification_id join public.push_subscriptions s on s.id = c.subscription_id;
  return v_result;
end;
$$;

create or replace function public.complete_push_delivery(p_delivery_id uuid, p_outcome text, p_http_status integer default null, p_error text default null)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_delivery public.push_deliveries;
begin
  if p_outcome not in ('sent', 'retry', 'gone', 'failed') then raise exception 'Resultado de entrega no válido.' using errcode = '22023'; end if;
  select * into v_delivery from public.push_deliveries where id = p_delivery_id for update;
  -- Idempotente: solo se completa una entrega que sigue reservada («sending»).
  if not found or v_delivery.status <> 'sending' then return; end if;
  if p_outcome = 'sent' then
    update public.push_deliveries set status = 'sent', sent_at = now(), locked_until = null, http_status = p_http_status, last_error = null where id = v_delivery.id;
    update public.push_subscriptions set failure_count = 0, last_seen_at = now() where id = v_delivery.subscription_id;
  elsif p_outcome = 'gone' then
    -- 404/410 del servicio push: la suscripción ya no existe. Se elimina (sus entregas caen en cascada).
    delete from public.push_subscriptions where id = v_delivery.subscription_id;
  elsif p_outcome = 'retry' and v_delivery.attempts < 5 then
    update public.push_deliveries set status = 'pending', locked_until = null, http_status = p_http_status, last_error = left(p_error, 200),
      next_attempt_at = now() + (v_delivery.attempts * v_delivery.attempts) * interval '1 minute' where id = v_delivery.id;
    update public.push_subscriptions set failure_count = least(failure_count + 1, 32000) where id = v_delivery.subscription_id;
  else
    update public.push_deliveries set status = 'failed', locked_until = null, http_status = p_http_status, last_error = left(p_error, 200) where id = v_delivery.id;
    update public.push_subscriptions set failure_count = least(failure_count + 1, 32000) where id = v_delivery.subscription_id;
  end if;
  -- Un dispositivo que falla repetidamente deja de recibir envíos.
  delete from public.push_subscriptions where id = v_delivery.subscription_id and failure_count >= 10;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 10. Notificaciones de reservas (confirmada / cancelada) — disparadores de mejor esfuerzo
-- ---------------------------------------------------------------------------------------------------------------
-- Destinatario: SOLO la cuenta vinculada legítimamente a la ficha de la reserva. Una reserva cargada por Rafa para una persona
-- sin cuenta no genera nada. Si quien actúa es el propio destinatario (reserva/cancelación desde el portal) tampoco se le avisa.
create or replace function private.notify_reservation_change()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_user uuid;
  v_timezone text;
  v_court text;
  v_slot text;
  v_series_count smallint;
begin
  begin
    if new.occupation_type <> 'reservation' or new.person_id is null or new.starts_at <= now() then return null; end if;
    if tg_op = 'INSERT' then
      if new.status <> 'confirmed' then return null; end if;
    elsif not (old.status = 'confirmed' and new.status = 'cancelled') then
      return null;
    end if;

    select l.auth_user_id into v_user
    from public.club_person_auth_links l
    join public.club_people p on p.club_id = l.club_id and p.id = l.person_id and p.active
    where l.club_id = new.club_id and l.person_id = new.person_id;
    if v_user is null or v_user = auth.uid() then return null; end if;

    select timezone into v_timezone from public.clubs where id = new.club_id;
    select name into v_court from public.courts where id = new.court_id;
    v_slot := private.format_local_slot(new.starts_at, new.ends_at, v_timezone);

    if tg_op = 'INSERT' then
      if new.recurrence_series_id is not null then
        -- Una serie semanal inserta varias filas: se avisa una sola vez (por la primera) y se dice cuántas son.
        select occurrence_count into v_series_count from public.reservation_series where id = new.recurrence_series_id;
        perform private.notify_user(new.club_id, v_user, 'reservation_confirmed', 'Reservas semanales confirmadas',
          v_court || ' · ' || v_slot || coalesce(' · ' || v_series_count::text || ' semanas', ''), 'reservation', new.id, 'reservation_series_confirmed:' || new.recurrence_series_id::text);
      else
        perform private.notify_user(new.club_id, v_user, 'reservation_confirmed', 'Reserva confirmada', v_court || ' · ' || v_slot, 'reservation', new.id, 'reservation_confirmed:' || new.id::text);
      end if;
    else
      perform private.notify_user(new.club_id, v_user, 'reservation_cancelled', 'Reserva cancelada', v_court || ' · ' || v_slot, 'reservation', new.id, 'reservation_cancelled:' || new.id::text);
    end if;
  exception when others then
    -- Una notificación nunca puede impedir ni deshacer una reserva.
    raise warning 'No se pudo generar la notificación de la reserva %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function private.notify_reservation_change() from public, anon, authenticated;
create trigger reservations_notify_insert after insert on public.reservations for each row execute function private.notify_reservation_change();
create trigger reservations_notify_cancel after update of status on public.reservations for each row when (old.status is distinct from new.status) execute function private.notify_reservation_change();

-- ---------------------------------------------------------------------------------------------------------------
-- 11. Recordatorios de reservas (para pg_cron; idempotente)
-- ---------------------------------------------------------------------------------------------------------------
-- Genera el recordatorio de las reservas confirmadas que empiezan dentro de p_lead_minutes (por defecto 24 h).
--   * Solo reservas comunes, con persona vinculada a una cuenta real, futuras y no canceladas.
--   * No recuerda reservas creadas dentro de esa misma ventana (ya recibieron su confirmación).
--   * Clave por reserva + instante de inicio: ejecutarla N veces no duplica; si la reserva se MUEVE de horario, el nuevo horario puede
--     generar un nuevo recordatorio; si se cancela, deja de recordarse.
create or replace function public.generate_reservation_reminders(p_lead_minutes integer default 1440, p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_count integer;
begin
  if p_lead_minutes is null or p_lead_minutes not between 60 and 10080 then raise exception 'La anticipación del recordatorio debe estar entre 60 y 10080 minutos.' using errcode = '22023'; end if;
  insert into public.notifications (club_id, user_id, kind, title, body, target_type, target_id, dedupe_key)
  select r.club_id, l.auth_user_id, 'reservation_reminder', 'Recordatorio de tu reserva',
         left(ct.name || ' · ' || private.format_local_slot(r.starts_at, r.ends_at, c.timezone), 240), 'reservation', r.id,
         'reservation_reminder:' || r.id::text || ':' || extract(epoch from r.starts_at)::bigint::text
  from public.reservations r
  join public.club_person_auth_links l on l.club_id = r.club_id and l.person_id = r.person_id
  join public.club_people p on p.club_id = l.club_id and p.id = l.person_id and p.active
  join public.clubs c on c.id = r.club_id
  join public.courts ct on ct.id = r.court_id and ct.club_id = r.club_id
  where r.occupation_type = 'reservation' and r.status = 'confirmed' and r.person_id is not null
    and r.starts_at > p_now and r.starts_at <= p_now + make_interval(mins => p_lead_minutes)
    and r.starts_at - r.created_at > make_interval(mins => p_lead_minutes)
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 12. Imágenes de portada: bucket PRIVADO con límites de tipo/tamaño y políticas por club
-- ---------------------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-post-images', 'club-post-images', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Sin política de UPDATE: nadie puede sobrescribir un archivo existente (el cliente sube con nombre aleatorio y upsert=false).
create policy "club post images: managers upload to their club folder" on storage.objects for insert to authenticated
with check (bucket_id = 'club-post-images' and private.can_manage_club_posts(private.club_id_from_post_image_path(name)));
create policy "club post images: managers delete from their club folder" on storage.objects for delete to authenticated
using (bucket_id = 'club-post-images' and private.can_manage_club_posts(private.club_id_from_post_image_path(name)));
-- Lectura: administradores del club, o miembros/jugadores vinculados únicamente si la imagen pertenece a una publicación PUBLICADA de su club.
-- La consulta a club_posts va en una función SECURITY DEFINER: la política de esa tabla (solo owner/admin) ocultaría la publicación a un jugador.
create or replace function private.can_read_club_post_image(p_name text)
returns boolean language sql stable security definer set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.club_posts p
    where p.image_path = p_name and p.status = 'published'
      and (private.is_club_member(p.club_id) or private.is_active_linked_player(p.club_id))
  );
$$;
revoke all on function private.can_read_club_post_image(text) from public, anon;
grant execute on function private.can_read_club_post_image(text) to authenticated;

create policy "club post images: read published or manage" on storage.objects for select to authenticated
using (
  bucket_id = 'club-post-images' and (
    private.can_manage_club_posts(private.club_id_from_post_image_path(name))
    or private.can_read_club_post_image(name)
  )
);

-- ---------------------------------------------------------------------------------------------------------------
-- 13. Permisos de ejecución
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function
  public.create_club_post(uuid, text, text, text, date, time, text, boolean, uuid, text, uuid),
  public.update_club_post(uuid, text, text, text, date, time, text, boolean, uuid, text),
  public.publish_club_post(uuid, boolean), public.archive_club_post(uuid), public.club_posts_feed(uuid),
  public.my_notifications(uuid, integer), public.mark_notification_read(uuid), public.mark_all_notifications_read(uuid),
  public.register_push_subscription(text, text, text, text), public.revoke_push_subscription(text),
  public.claim_push_deliveries(integer, uuid[]), public.complete_push_delivery(uuid, text, integer, text),
  public.generate_reservation_reminders(integer, timestamptz)
from public, anon, authenticated;

grant execute on function
  public.create_club_post(uuid, text, text, text, date, time, text, boolean, uuid, text, uuid),
  public.update_club_post(uuid, text, text, text, date, time, text, boolean, uuid, text),
  public.publish_club_post(uuid, boolean), public.archive_club_post(uuid), public.club_posts_feed(uuid),
  public.my_notifications(uuid, integer), public.mark_notification_read(uuid), public.mark_all_notifications_read(uuid),
  public.register_push_subscription(text, text, text, text), public.revoke_push_subscription(text)
to authenticated;

-- Operación del servidor: solo service_role (Edge Function / pg_cron). Ni anon ni authenticated.
grant execute on function
  public.claim_push_deliveries(integer, uuid[]), public.complete_push_delivery(uuid, text, integer, text),
  public.generate_reservation_reminders(integer, timestamptz)
to service_role;
