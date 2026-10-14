-- Sprint 09: portal de jugadores y socios. Requiere las migraciones 01–08.
-- Esta migración no se aplica automáticamente a Supabase.

create table public.club_person_auth_links (
  club_id uuid not null references public.clubs(id) on delete restrict,
  person_id uuid not null,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  primary key (club_id, person_id),
  unique (club_id, auth_user_id),
  constraint club_person_auth_links_person_belongs_to_club
    foreign key (club_id, person_id) references public.club_people(club_id, id) on delete restrict
);
create index club_person_auth_links_auth_user_idx on public.club_person_auth_links(auth_user_id, club_id);

create table public.player_invitations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  person_id uuid not null,
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete restrict,
  constraint player_invitations_person_belongs_to_club
    foreign key (club_id, person_id) references public.club_people(club_id, id) on delete restrict,
  constraint player_invitations_redemption_consistent check (
    (redeemed_at is null and redeemed_by is null) or (redeemed_at is not null and redeemed_by is not null)
  ),
  constraint player_invitations_revocation_consistent check (
    (revoked_at is null and revoked_by is null) or (revoked_at is not null and revoked_by is not null)
  )
);
create index player_invitations_admin_idx on public.player_invitations(club_id, person_id, created_at desc);

create table public.club_online_booking_settings (
  club_id uuid primary key references public.clubs(id) on delete restrict,
  enabled boolean not null default false,
  opens_at time not null default time '07:00',
  closes_at time not null default time '23:00',
  max_advance_days smallint not null default 7 check (max_advance_days between 0 and 90),
  allowed_durations_minutes smallint[] not null default array[60, 90]::smallint[],
  max_active_reservations smallint not null default 2 check (max_active_reservations between 1 and 20),
  cancellation_lead_minutes smallint not null default 120 check (cancellation_lead_minutes between 0 and 10080),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  check (closes_at > opens_at),
  check (cardinality(allowed_durations_minutes) > 0)
);

create or replace function private.is_active_linked_player(target_club_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog
as $$
  select auth.uid() is not null and exists (
    select 1 from public.club_person_auth_links l
    join public.club_people p on p.club_id = l.club_id and p.id = l.person_id
    where l.club_id = target_club_id and l.auth_user_id = (select auth.uid()) and p.active
  );
$$;

create or replace function private.get_active_linked_person(target_club_id uuid)
returns uuid language sql stable security definer set search_path = pg_catalog
as $$
  select l.person_id from public.club_person_auth_links l
  join public.club_people p on p.club_id = l.club_id and p.id = l.person_id
  where l.club_id = target_club_id and l.auth_user_id = (select auth.uid()) and p.active
  limit 1;
$$;

create or replace function private.assert_portal_access(target_club_id uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog
as $$
declare v_person_id uuid;
begin
  if auth.uid() is null then raise exception 'Necesitás iniciar sesión.' using errcode = '42501'; end if;
  select private.get_active_linked_person(target_club_id) into v_person_id;
  if v_person_id is null then raise exception 'Tu cuenta no está vinculada a una persona activa de este club.' using errcode = '42501'; end if;
  return v_person_id;
end;
$$;

create or replace function public.player_access_context()
returns jsonb language sql stable security definer set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'club_id', l.club_id, 'club_name', c.name, 'timezone', c.timezone,
    'person_id', p.id, 'full_name', p.full_name,
    'membership_status', m.status
  ) order by c.name), '[]'::jsonb)
  from public.club_person_auth_links l
  join public.clubs c on c.id = l.club_id
  join public.club_people p on p.club_id = l.club_id and p.id = l.person_id and p.active
  left join public.club_memberships m on m.club_id = l.club_id and m.person_id = l.person_id
  where l.auth_user_id = (select auth.uid());
$$;

create or replace function public.create_player_invitation(p_club_id uuid, p_person_id uuid, p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_token text; v_invitation public.player_invitations;
begin
  if auth.uid() is null or not private.can_manage_club_memberships(p_club_id) then raise exception 'No tenés permiso para invitar jugadores en este club.' using errcode = '42501'; end if;
  if p_expires_at <= now() then raise exception 'La invitación debe vencer en el futuro.' using errcode = '22023'; end if;
  if not exists (select 1 from public.club_people where club_id = p_club_id and id = p_person_id and active) then raise exception 'La persona no existe o está inactiva en este club.' using errcode = '23503'; end if;
  if exists (select 1 from public.club_person_auth_links where club_id = p_club_id and person_id = p_person_id) then raise exception 'Esta persona ya tiene una cuenta vinculada en el club.' using errcode = '23505'; end if;
  update public.player_invitations set revoked_at = now(), revoked_by = auth.uid()
  where club_id = p_club_id and person_id = p_person_id and redeemed_at is null and revoked_at is null;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.player_invitations(club_id, person_id, token_hash, expires_at, created_by)
  values (p_club_id, p_person_id, encode(digest(v_token, 'sha256'), 'hex'), p_expires_at, auth.uid()) returning * into v_invitation;
  return jsonb_build_object('id', v_invitation.id, 'code', v_token, 'expires_at', v_invitation.expires_at);
end;
$$;

create or replace function public.revoke_player_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_invitation public.player_invitations;
begin
  select * into v_invitation from public.player_invitations where id = p_invitation_id for update;
  if not found then raise exception 'La invitación no existe.' using errcode = '23503'; end if;
  if auth.uid() is null or not private.can_manage_club_memberships(v_invitation.club_id) then raise exception 'No tenés permiso para revocar esta invitación.' using errcode = '42501'; end if;
  if v_invitation.redeemed_at is not null then raise exception 'La invitación ya fue utilizada.' using errcode = '22023'; end if;
  if v_invitation.revoked_at is null then update public.player_invitations set revoked_at = now(), revoked_by = auth.uid() where id = v_invitation.id; end if;
end;
$$;

create or replace function public.list_player_invitations(p_club_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not private.can_manage_club_memberships(p_club_id) then raise exception 'No tenés permiso para ver invitaciones.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', i.id, 'person_id', i.person_id, 'person_name', p.full_name, 'expires_at', i.expires_at,
    'created_at', i.created_at, 'redeemed_at', i.redeemed_at, 'revoked_at', i.revoked_at
  ) order by i.created_at desc) from public.player_invitations i join public.club_people p on p.club_id = i.club_id and p.id = i.person_id where i.club_id = p_club_id), '[]'::jsonb);
end;
$$;

create or replace function public.redeem_player_invitation(p_code text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_invitation public.player_invitations; v_person public.club_people;
begin
  if auth.uid() is null or char_length(trim(coalesce(p_code, ''))) < 32 then raise exception 'No pudimos validar el código de invitación.' using errcode = '22023'; end if;
  select * into v_invitation from public.player_invitations
  where token_hash = encode(digest(trim(p_code), 'sha256'), 'hex') for update;
  if not found or v_invitation.expires_at <= now() or v_invitation.redeemed_at is not null or v_invitation.revoked_at is not null then raise exception 'No pudimos validar el código de invitación.' using errcode = '22023'; end if;
  select * into v_person from public.club_people where club_id = v_invitation.club_id and id = v_invitation.person_id for key share;
  if not found or not v_person.active then raise exception 'No pudimos validar el código de invitación.' using errcode = '22023'; end if;
  if exists (select 1 from public.club_person_auth_links where club_id = v_invitation.club_id and (person_id = v_invitation.person_id or auth_user_id = auth.uid())) then raise exception 'Esta cuenta o persona ya tiene una vinculación en el club.' using errcode = '23505'; end if;
  insert into public.club_person_auth_links(club_id, person_id, auth_user_id, created_by) values (v_invitation.club_id, v_invitation.person_id, auth.uid(), v_invitation.created_by);
  update public.player_invitations set redeemed_at = now(), redeemed_by = auth.uid() where id = v_invitation.id;
  return jsonb_build_object('club_id', v_invitation.club_id, 'person_id', v_invitation.person_id);
end;
$$;

create or replace function public.get_online_booking_settings(p_club_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_settings public.club_online_booking_settings;
begin
  if auth.uid() is null or (not private.can_manage_club_memberships(p_club_id) and not private.is_active_linked_player(p_club_id)) then raise exception 'No tenés permiso para consultar esta configuración.' using errcode = '42501'; end if;
  select * into v_settings from public.club_online_booking_settings where club_id = p_club_id;
  if not found then return jsonb_build_object('enabled', false, 'opens_at', '07:00', 'closes_at', '23:00', 'max_advance_days', 7, 'allowed_durations_minutes', jsonb_build_array(60, 90), 'max_active_reservations', 2, 'cancellation_lead_minutes', 120, 'configured', false); end if;
  return jsonb_build_object('enabled', v_settings.enabled, 'opens_at', v_settings.opens_at, 'closes_at', v_settings.closes_at, 'max_advance_days', v_settings.max_advance_days, 'allowed_durations_minutes', to_jsonb(v_settings.allowed_durations_minutes), 'max_active_reservations', v_settings.max_active_reservations, 'cancellation_lead_minutes', v_settings.cancellation_lead_minutes, 'configured', true);
end;
$$;

create or replace function public.set_online_booking_settings(p_club_id uuid, p_enabled boolean, p_opens_at time, p_closes_at time, p_max_advance_days smallint, p_allowed_durations_minutes smallint[], p_max_active_reservations smallint, p_cancellation_lead_minutes smallint)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not private.can_manage_club_memberships(p_club_id) then raise exception 'No tenés permiso para configurar reservas online.' using errcode = '42501'; end if;
  if p_opens_at is null or p_closes_at is null or p_closes_at <= p_opens_at or p_max_advance_days not between 0 and 90 or p_max_active_reservations not between 1 and 20 or p_cancellation_lead_minutes not between 0 and 10080 or p_allowed_durations_minutes is null or cardinality(p_allowed_durations_minutes) = 0 or exists (select 1 from unnest(p_allowed_durations_minutes) duration where duration <= 0 or duration > 480) then raise exception 'La configuración de reservas online no es válida.' using errcode = '22023'; end if;
  insert into public.club_online_booking_settings(club_id, enabled, opens_at, closes_at, max_advance_days, allowed_durations_minutes, max_active_reservations, cancellation_lead_minutes, updated_by)
  values (p_club_id, p_enabled, p_opens_at, p_closes_at, p_max_advance_days, p_allowed_durations_minutes, p_max_active_reservations, p_cancellation_lead_minutes, auth.uid())
  on conflict (club_id) do update set enabled = excluded.enabled, opens_at = excluded.opens_at, closes_at = excluded.closes_at, max_advance_days = excluded.max_advance_days, allowed_durations_minutes = excluded.allowed_durations_minutes, max_active_reservations = excluded.max_active_reservations, cancellation_lead_minutes = excluded.cancellation_lead_minutes, updated_at = now(), updated_by = auth.uid();
end;
$$;

create or replace function public.player_court_availability(p_club_id uuid, p_date date)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_person_id uuid; v_timezone text; v_start timestamptz; v_end timestamptz;
begin
  v_person_id := private.assert_portal_access(p_club_id);
  select timezone into v_timezone from public.clubs where id = p_club_id;
  v_start := p_date::timestamp at time zone v_timezone; v_end := (p_date + 1)::timestamp at time zone v_timezone;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'display_order', c.display_order, 'occupied', coalesce((select jsonb_agg(jsonb_build_object('starts_at', r.starts_at, 'ends_at', r.ends_at, 'kind', r.occupation_type) order by r.starts_at) from public.reservations r where r.club_id = p_club_id and r.court_id = c.id and r.status in ('confirmed', 'active') and r.starts_at < v_end and r.ends_at > v_start), '[]'::jsonb)) order by c.display_order, c.name) from public.courts c where c.club_id = p_club_id and c.active), '[]'::jsonb);
end;
$$;

create or replace function public.create_player_reservation(p_club_id uuid, p_court_id uuid, p_starts_at timestamptz, p_duration_minutes smallint)
returns uuid language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_person_id uuid; v_settings public.club_online_booking_settings; v_person public.club_people; v_timezone text; v_end timestamptz; v_reservation_id uuid; v_local_start timestamp; v_local_end timestamp; v_active_count integer;
begin
  v_person_id := private.assert_portal_access(p_club_id);
  perform pg_advisory_xact_lock(hashtextextended(p_club_id::text || ':' || v_person_id::text, 0));
  select * into v_settings from public.club_online_booking_settings where club_id = p_club_id for share;
  if not found or not v_settings.enabled then raise exception 'Las reservas online no están habilitadas para este club.' using errcode = '42501'; end if;
  if p_duration_minutes is null or not p_duration_minutes = any(v_settings.allowed_durations_minutes) then raise exception 'La duración elegida no está habilitada.' using errcode = '22023'; end if;
  select timezone into v_timezone from public.clubs where id = p_club_id;
  v_end := p_starts_at + make_interval(mins => p_duration_minutes); v_local_start := timezone(v_timezone, p_starts_at); v_local_end := timezone(v_timezone, v_end);
  if p_starts_at < now() or v_local_start::date > (now() at time zone v_timezone)::date + v_settings.max_advance_days or v_local_start::date < (now() at time zone v_timezone)::date or v_local_start::time < v_settings.opens_at or v_local_end::date <> v_local_start::date or v_local_end::time > v_settings.closes_at then raise exception 'El horario elegido está fuera de la disponibilidad online.' using errcode = '22023'; end if;
  if not exists (select 1 from public.courts where id = p_court_id and club_id = p_club_id and active) then raise exception 'La cancha elegida no está disponible.' using errcode = '23503'; end if;
  select count(*) into v_active_count from public.reservations where club_id = p_club_id and person_id = v_person_id and occupation_type = 'reservation' and status = 'confirmed' and starts_at >= now();
  if v_active_count >= v_settings.max_active_reservations then raise exception 'Alcanzaste el máximo de reservas futuras permitido.' using errcode = '22023'; end if;
  select * into v_person from public.club_people where club_id = p_club_id and id = v_person_id;
  insert into public.reservations(club_id, court_id, customer_name, person_id, starts_at, ends_at, status, occupation_type, created_by)
  values (p_club_id, p_court_id, v_person.full_name, v_person_id, p_starts_at, v_end, 'confirmed', 'reservation', auth.uid()) returning id into v_reservation_id;
  return v_reservation_id;
end;
$$;

create or replace function public.player_reservations(p_club_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_person_id uuid; v_settings public.club_online_booking_settings;
begin
  v_person_id := private.assert_portal_access(p_club_id);
  select * into v_settings from public.club_online_booking_settings where club_id = p_club_id;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'court_name', c.name, 'starts_at', r.starts_at, 'ends_at', r.ends_at, 'status', r.status, 'can_cancel', r.occupation_type = 'reservation' and r.created_by = auth.uid() and r.status = 'confirmed' and v_settings.enabled and r.starts_at - now() >= make_interval(mins => v_settings.cancellation_lead_minutes)) order by r.starts_at desc) from public.reservations r join public.courts c on c.id = r.court_id and c.club_id = r.club_id where r.club_id = p_club_id and r.person_id = v_person_id and r.occupation_type = 'reservation'), '[]'::jsonb);
end;
$$;

create or replace function public.cancel_player_reservation(p_reservation_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_reservation public.reservations; v_person_id uuid; v_settings public.club_online_booking_settings;
begin
  select * into v_reservation from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'La reserva no está disponible para cancelar.' using errcode = '23503'; end if;
  v_person_id := private.assert_portal_access(v_reservation.club_id);
  select * into v_settings from public.club_online_booking_settings where club_id = v_reservation.club_id;
  if v_reservation.person_id <> v_person_id or v_reservation.created_by <> auth.uid() or v_reservation.occupation_type <> 'reservation' or v_reservation.status <> 'confirmed' or not coalesce(v_settings.enabled, false) or v_reservation.starts_at - now() < make_interval(mins => v_settings.cancellation_lead_minutes) then raise exception 'Esta reserva no puede cancelarse desde el portal.' using errcode = '42501'; end if;
  update public.reservations set status = 'cancelled' where id = v_reservation.id;
end;
$$;

create or replace function public.player_profile(p_club_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_person_id uuid;
begin
  v_person_id := private.assert_portal_access(p_club_id);
  return (select jsonb_build_object('full_name', p.full_name, 'phone', p.phone, 'email', p.email, 'membership_status', m.status) from public.club_people p left join public.club_memberships m on m.club_id = p.club_id and m.person_id = p.id where p.club_id = p_club_id and p.id = v_person_id);
end;
$$;

create or replace function public.update_player_profile(p_club_id uuid, p_full_name text, p_phone text, p_email text)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_person_id uuid;
begin
  v_person_id := private.assert_portal_access(p_club_id);
  if char_length(trim(coalesce(p_full_name, ''))) = 0 then raise exception 'El nombre es obligatorio.' using errcode = '22023'; end if;
  update public.club_people set full_name = trim(p_full_name), phone = nullif(trim(coalesce(p_phone, '')), ''), email = nullif(trim(coalesce(p_email, '')), '') where club_id = p_club_id and id = v_person_id;
end;
$$;

create or replace function public.player_membership_dues(p_club_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_person_id uuid;
begin
  v_person_id := private.assert_portal_access(p_club_id);
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'period', d.period, 'due_date', d.due_date, 'amount_cents', d.amount_cents, 'paid_cents', coalesce(pay.paid_cents, 0), 'balance_cents', d.amount_cents - coalesce(pay.paid_cents, 0), 'payments', coalesce(pay.payments, '[]'::jsonb)) order by d.period desc) from public.membership_dues d join public.club_memberships m on m.id = d.membership_id and m.club_id = d.club_id left join lateral (select coalesce(sum(p.amount_cents), 0) as paid_cents, jsonb_agg(jsonb_build_object('amount_cents', p.amount_cents, 'payment_date', p.payment_date, 'payment_method', p.payment_method) order by p.payment_date, p.created_at) filter (where p.voided_at is null) as payments from public.membership_due_payments p where p.club_id = d.club_id and p.due_id = d.id) pay on true where d.club_id = p_club_id and m.person_id = v_person_id), '[]'::jsonb);
end;
$$;

create or replace function public.player_tournaments(p_club_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_person_id uuid;
begin
  v_person_id := private.assert_portal_access(p_club_id);

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'name', t.name,
          'description', t.description,
          'starts_on', t.starts_on,
          'ends_on', t.ends_on,
          'status', t.status,
          'categories',
          coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'id', c.id,
                  'name', c.name,
                  'modality', c.modality,
                  'status', c.status,
                  'matches',
                  coalesce(
                    (
                      select jsonb_agg(
                        jsonb_build_object(
                          'id', tm.id,
                          'round_number', tm.round_number,
                          'position', tm.position,
                          'entry_one', e1.display_name,
                          'entry_two', e2.display_name,
                          'winner', ew.display_name,
                          'status', tm.status,
                          'score_text', tm.score_text
                        )
                        order by tm.round_number, tm.position
                      )
                      from public.tournament_matches tm
                      left join public.tournament_entries e1
                        on e1.id = tm.entry_one_id
                      left join public.tournament_entries e2
                        on e2.id = tm.entry_two_id
                      left join public.tournament_entries ew
                        on ew.id = tm.winner_entry_id
                      where tm.category_id = c.id
                    ),
                    '[]'::jsonb
                  )
                )
                order by c.name
              )
              from public.tournament_categories c
              where c.tournament_id = t.id
            ),
            '[]'::jsonb
          )
        )
        order by t.starts_on desc
      )
      from public.tournaments t
      where t.club_id = p_club_id
    ),
    '[]'::jsonb
  );
end;
$$;

alter table public.club_person_auth_links enable row level security;
alter table public.player_invitations enable row level security;
alter table public.club_online_booking_settings enable row level security;
revoke all on table public.club_person_auth_links, public.player_invitations, public.club_online_booking_settings from anon, authenticated;
revoke all on function private.is_active_linked_player(uuid), private.get_active_linked_person(uuid), private.assert_portal_access(uuid) from public;
revoke all on function public.player_access_context(), public.create_player_invitation(uuid, uuid, timestamptz), public.revoke_player_invitation(uuid), public.list_player_invitations(uuid), public.redeem_player_invitation(text), public.get_online_booking_settings(uuid), public.set_online_booking_settings(uuid, boolean, time, time, smallint, smallint[], smallint, smallint), public.player_court_availability(uuid, date), public.create_player_reservation(uuid, uuid, timestamptz, smallint), public.player_reservations(uuid), public.cancel_player_reservation(uuid), public.player_profile(uuid), public.update_player_profile(uuid, text, text, text), public.player_membership_dues(uuid), public.player_tournaments(uuid) from public, anon;
grant execute on function public.player_access_context(), public.create_player_invitation(uuid, uuid, timestamptz), public.revoke_player_invitation(uuid), public.list_player_invitations(uuid), public.redeem_player_invitation(text), public.get_online_booking_settings(uuid), public.set_online_booking_settings(uuid, boolean, time, time, smallint, smallint[], smallint, smallint), public.player_court_availability(uuid, date), public.create_player_reservation(uuid, uuid, timestamptz, smallint), public.player_reservations(uuid), public.cancel_player_reservation(uuid), public.player_profile(uuid), public.update_player_profile(uuid, text, text, text), public.player_membership_dues(uuid), public.player_tournaments(uuid) to authenticated;
