-- Sprint 03: una única agenda de ocupación para reservas, bloqueos y series semanales.
-- Requiere que 20261013010000_reservations.sql ya esté aplicada. No ejecutar automáticamente.

alter table public.reservations
  add column occupation_type text not null default 'reservation',
  add column block_reason text,
  add column recurrence_series_id uuid;

alter table public.reservations
  add constraint reservations_occupation_type_check
    check (occupation_type in ('reservation', 'block'));

alter table public.reservations
  drop constraint reservations_status_check,
  add constraint reservations_status_check
    check (
      (occupation_type = 'reservation' and status in ('confirmed', 'cancelled'))
      or (occupation_type = 'block' and status in ('active', 'cancelled'))
    ),
  alter column customer_name drop not null,
  add constraint reservations_occupation_details_check
    check (
      (occupation_type = 'reservation' and char_length(trim(customer_name)) > 0 and block_reason is null)
      or (occupation_type = 'block' and customer_name is null and char_length(trim(block_reason)) > 0)
    );

create table public.reservation_series (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  court_id uuid not null,
  customer_name text not null check (char_length(trim(customer_name)) > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  occurrence_count smallint not null check (occurrence_count between 1 and 12),
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint reservation_series_end_after_start check (ends_at > starts_at),
  constraint reservation_series_court_belongs_to_club
    foreign key (club_id, court_id) references public.courts (club_id, id) on delete restrict
);

alter table public.reservations
  add constraint reservations_recurrence_series_id_fkey
  foreign key (recurrence_series_id) references public.reservation_series(id) on delete restrict;

create index reservations_recurrence_series_id_idx on public.reservations (recurrence_series_id)
  where recurrence_series_id is not null;

-- Reemplaza la exclusión de Sprint 02 con la misma agenda única: una reserva
-- confirmada y un bloqueo activo se excluyen mutuamente; las cancelaciones liberan.
alter table public.reservations
  drop constraint reservations_confirmed_court_no_overlap,
  add constraint reservations_occupied_court_no_overlap
  exclude using gist (
    court_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('confirmed', 'active'));

create or replace function private.validate_reservation_court()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  -- Al crear, reactivar o mover una ocupación activa, la cancha debe estar activa.
  if new.status in ('confirmed', 'active')
    and (tg_op = 'INSERT' or old.status = 'cancelled' or new.court_id <> old.court_id) then
    if not exists (
      select 1 from public.courts
      where id = new.court_id and club_id = new.club_id and active
    ) then
      raise exception 'La cancha elegida no existe, no pertenece al club o está inactiva.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.create_weekly_reservation_series(
  p_club_id uuid,
  p_court_id uuid,
  p_customer_name text,
  p_notes text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_occurrence_count smallint
)
returns setof uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_timezone text;
  v_series_id uuid;
begin
  if auth.uid() is null or not private.is_club_member(p_club_id) then
    raise exception 'No tenés permiso para crear reservas en este club.' using errcode = '42501';
  end if;
  if p_occurrence_count not between 1 and 12 then
    raise exception 'Una serie semanal debe tener entre 1 y 12 ocurrencias.' using errcode = '22023';
  end if;
  if p_ends_at <= p_starts_at or char_length(trim(coalesce(p_customer_name, ''))) = 0 then
    raise exception 'La serie tiene datos inválidos.' using errcode = '22023';
  end if;

  select timezone into v_timezone from public.clubs where id = p_club_id;
  if v_timezone is null then
    raise exception 'El club no existe.' using errcode = '23503';
  end if;

  insert into public.reservation_series (club_id, court_id, customer_name, starts_at, ends_at, occurrence_count, notes)
  values (p_club_id, p_court_id, trim(p_customer_name), p_starts_at, p_ends_at, p_occurrence_count, nullif(trim(coalesce(p_notes, '')), ''))
  returning id into v_series_id;

  -- La suma se realiza como hora local del club y luego se vuelve a timestamptz.
  -- Así conserva día y horario semanal incluso en clubes con cambios de DST.
  return query
  with occurrences as (
    select
      ((timezone(v_timezone, p_starts_at) + (week_number * interval '1 week')) at time zone v_timezone) as starts_at,
      ((timezone(v_timezone, p_ends_at) + (week_number * interval '1 week')) at time zone v_timezone) as ends_at
    from generate_series(0, p_occurrence_count - 1) as week_number
  )
  insert into public.reservations (
    club_id, court_id, customer_name, starts_at, ends_at, status,
    occupation_type, notes, recurrence_series_id
  )
  select p_club_id, p_court_id, trim(p_customer_name), starts_at, ends_at,
    'confirmed', 'reservation', nullif(trim(coalesce(p_notes, '')), ''), v_series_id
  from occurrences
  returning id;
end;
$$;

revoke all on function public.create_weekly_reservation_series(uuid, uuid, text, text, timestamptz, timestamptz, smallint) from public;
grant execute on function public.create_weekly_reservation_series(uuid, uuid, text, text, timestamptz, timestamptz, smallint) to authenticated;

alter table public.reservation_series enable row level security;
create policy "club members can read reservation series"
on public.reservation_series for select to authenticated
using (private.is_club_member(club_id));

revoke all on table public.reservation_series from anon;
revoke all on table public.reservation_series from authenticated;
grant select on table public.reservation_series to authenticated;

grant insert (club_id, court_id, starts_at, ends_at, status, occupation_type, block_reason, notes) on table public.reservations to authenticated;
grant update (court_id, customer_name, starts_at, ends_at, status, block_reason, notes) on table public.reservations to authenticated;
