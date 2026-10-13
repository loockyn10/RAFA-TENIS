-- Sprint 02: agenda diaria y reservas manuales.
-- Esta migración solo versiona el esquema. Debe aplicarse explícitamente a Supabase.

create extension if not exists btree_gist;

-- La clave compuesta permite que la referencia de una reserva compruebe también
-- que su cancha pertenece al mismo club.
alter table public.courts
  add constraint courts_club_id_id_key unique (club_id, id);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  court_id uuid not null,
  customer_name text not null check (char_length(trim(customer_name)) > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservations_end_after_start check (ends_at > starts_at),
  constraint reservations_court_belongs_to_club
    foreign key (club_id, court_id) references public.courts (club_id, id) on delete restrict
);

create index reservations_club_starts_at_idx on public.reservations (club_id, starts_at);
create index reservations_court_starts_at_idx on public.reservations (court_id, starts_at);

-- [) permite 17:00–18:00 seguido de 18:00–19:00, pero no intervalos que se cruzan.
alter table public.reservations
  add constraint reservations_confirmed_court_no_overlap
  exclude using gist (
    court_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'confirmed');

create or replace function private.validate_reservation_court()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  -- Al crear, reactivar o mover una reserva confirmada, la cancha debe seguir activa.
  if new.status = 'confirmed'
    and (tg_op = 'INSERT' or old.status = 'cancelled' or new.court_id <> old.court_id) then
    if not exists (
      select 1
      from public.courts
      where id = new.court_id
        and club_id = new.club_id
        and active
    ) then
      raise exception 'La cancha elegida no existe, no pertenece al club o está inactiva.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.set_reservation_updated_at()
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

create trigger reservations_validate_court
before insert or update on public.reservations
for each row execute function private.validate_reservation_court();

create trigger reservations_set_updated_at
before update on public.reservations
for each row execute function private.set_reservation_updated_at();

revoke all on function private.validate_reservation_court() from public;
revoke all on function private.set_reservation_updated_at() from public;

alter table public.reservations enable row level security;

create policy "club members can read reservations"
on public.reservations for select to authenticated
using (private.is_club_member(club_id));

create policy "club members can create reservations"
on public.reservations for insert to authenticated
with check (private.is_club_member(club_id));

create policy "club members can update reservations"
on public.reservations for update to authenticated
using (private.is_club_member(club_id))
with check (private.is_club_member(club_id));

revoke all on table public.reservations from anon;
revoke all on table public.reservations from authenticated;
grant select on table public.reservations to authenticated;
grant insert (club_id, court_id, customer_name, starts_at, ends_at, notes) on table public.reservations to authenticated;
grant update (court_id, customer_name, starts_at, ends_at, status, notes) on table public.reservations to authenticated;
