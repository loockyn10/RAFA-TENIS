-- Sprint 04: fichas de personas y condición de socio, separadas de Auth y del personal.
-- Requiere las migraciones 01–03. No ejecutar automáticamente en Supabase.

create table public.club_people (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  full_name text not null check (char_length(trim(full_name)) > 0),
  phone text,
  email text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, id)
);

create index club_people_club_name_idx on public.club_people (club_id, full_name, id);
create index club_people_club_phone_idx on public.club_people (club_id, phone) where phone is not null;

create table public.club_memberships (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  person_id uuid not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  joined_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_memberships_person_belongs_to_club
    foreign key (club_id, person_id) references public.club_people (club_id, id) on delete restrict,
  unique (club_id, person_id)
);

create index club_memberships_club_status_person_idx on public.club_memberships (club_id, status, person_id);

create or replace function private.set_club_people_updated_at()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.can_manage_club_memberships(target_club_id uuid)
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

create trigger club_people_set_updated_at
before update on public.club_people
for each row execute function private.set_club_people_updated_at();

create trigger club_memberships_set_updated_at
before update on public.club_memberships
for each row execute function private.set_club_people_updated_at();

alter table public.reservations add column person_id uuid;
alter table public.reservations
  add constraint reservations_person_belongs_to_club
  foreign key (club_id, person_id) references public.club_people (club_id, id) on delete restrict;
create index reservations_person_starts_at_idx on public.reservations (person_id, starts_at) where person_id is not null;

alter table public.reservation_series add column person_id uuid;
alter table public.reservation_series
  add constraint reservation_series_person_belongs_to_club
  foreign key (club_id, person_id) references public.club_people (club_id, id) on delete restrict;

-- Reemplaza la función del Sprint 03 para propagar el vínculo opcional a cada ocurrencia.
drop function public.create_weekly_reservation_series(uuid, uuid, text, text, timestamptz, timestamptz, smallint);

create function public.create_weekly_reservation_series(
  p_club_id uuid,
  p_court_id uuid,
  p_customer_name text,
  p_person_id uuid,
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

  insert into public.reservation_series (club_id, court_id, customer_name, person_id, starts_at, ends_at, occurrence_count, notes)
  values (p_club_id, p_court_id, trim(p_customer_name), p_person_id, p_starts_at, p_ends_at, p_occurrence_count, nullif(trim(coalesce(p_notes, '')), ''))
  returning id into v_series_id;

  return query
  with occurrences as (
    select
      ((timezone(v_timezone, p_starts_at) + (week_number * interval '1 week')) at time zone v_timezone) as starts_at,
      ((timezone(v_timezone, p_ends_at) + (week_number * interval '1 week')) at time zone v_timezone)
        as ends_at
    from generate_series(0, p_occurrence_count - 1) as week_number
  )
  insert into public.reservations (
    club_id, court_id, customer_name, person_id, starts_at, ends_at, status,
    occupation_type, notes, recurrence_series_id
  )
  select p_club_id, p_court_id, trim(p_customer_name), p_person_id, starts_at, ends_at,
    'confirmed', 'reservation', nullif(trim(coalesce(p_notes, '')), ''), v_series_id
  from occurrences
  returning id;
end;
$$;

-- Mantiene compatible el cliente del Sprint 03 durante un despliegue escalonado:
-- las series creadas por esa versión simplemente no llevan ficha vinculada.
create function public.create_weekly_reservation_series(
  p_club_id uuid,
  p_court_id uuid,
  p_customer_name text,
  p_notes text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_occurrence_count smallint
)
returns setof uuid
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select * from public.create_weekly_reservation_series(
    p_club_id, p_court_id, p_customer_name, null, p_notes,
    p_starts_at, p_ends_at, p_occurrence_count
  );
$$;

revoke all on function private.set_club_people_updated_at() from public;
revoke all on function private.can_manage_club_memberships(uuid) from public;
grant execute on function private.can_manage_club_memberships(uuid) to authenticated;
revoke all on function public.create_weekly_reservation_series(uuid, uuid, text, uuid, text, timestamptz, timestamptz, smallint) from public;
grant execute on function public.create_weekly_reservation_series(uuid, uuid, text, uuid, text, timestamptz, timestamptz, smallint) to authenticated;
revoke all on function public.create_weekly_reservation_series(uuid, uuid, text, text, timestamptz, timestamptz, smallint) from public;
grant execute on function public.create_weekly_reservation_series(uuid, uuid, text, text, timestamptz, timestamptz, smallint) to authenticated;

alter table public.club_people enable row level security;
alter table public.club_memberships enable row level security;

create policy "club members can read people"
on public.club_people for select to authenticated
using (private.is_club_member(club_id));
create policy "club members can create people"
on public.club_people for insert to authenticated
with check (private.is_club_member(club_id));
create policy "club members can update people"
on public.club_people for update to authenticated
using (private.is_club_member(club_id))
with check (private.is_club_member(club_id));

create policy "club members can read memberships"
on public.club_memberships for select to authenticated
using (private.is_club_member(club_id));
create policy "owners and admins can create memberships"
on public.club_memberships for insert to authenticated
with check (private.can_manage_club_memberships(club_id));
create policy "owners and admins can update memberships"
on public.club_memberships for update to authenticated
using (private.can_manage_club_memberships(club_id))
with check (private.can_manage_club_memberships(club_id));

revoke all on table public.club_people from anon;
revoke all on table public.club_memberships from anon;
revoke all on table public.club_people from authenticated;
revoke all on table public.club_memberships from authenticated;
grant select, insert (club_id, full_name, phone, email, notes, active), update (full_name, phone, email, notes, active) on public.club_people to authenticated;
grant select, insert (club_id, person_id, status, joined_on), update (status, joined_on) on public.club_memberships to authenticated;
grant insert (club_id, court_id, customer_name, person_id, starts_at, ends_at, notes, occupation_type, block_reason) on public.reservations to authenticated;
grant update (court_id, customer_name, person_id, starts_at, ends_at, status, block_reason, notes) on public.reservations to authenticated;
