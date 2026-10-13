-- Sprint 01: clubes, membresías administrativas y canchas.
-- Esta migración crea estructura y políticas; no crea usuarios de Auth ni datos del club.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;

create type public.club_staff_role as enum ('owner', 'admin', 'staff');

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) > 0),
  timezone text not null default 'America/Argentina/Buenos_Aires' check (char_length(trim(timezone)) > 0),
  created_at timestamptz not null default now()
);

create table public.club_staff (
  club_id uuid not null references public.clubs(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  role public.club_staff_role not null,
  created_at timestamptz not null default now(),
  primary key (club_id, auth_user_id)
);

create table public.courts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  name text not null check (char_length(trim(name)) > 0),
  surface text not null check (char_length(trim(surface)) > 0),
  active boolean not null default true,
  display_order integer not null check (display_order > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, name)
);

create index courts_club_display_order_idx on public.courts (club_id, display_order, name);

create or replace function private.is_club_member(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.club_staff
    where club_id = target_club_id
      and auth_user_id = (select auth.uid())
  );
$$;

create or replace function private.can_manage_courts(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.club_staff
    where club_id = target_club_id
      and auth_user_id = (select auth.uid())
      and role in ('owner'::public.club_staff_role, 'admin'::public.club_staff_role)
  );
$$;

create or replace function private.set_court_updated_at()
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

create trigger courts_set_updated_at
before update on public.courts
for each row execute function private.set_court_updated_at();

revoke all on function private.is_club_member(uuid) from public;
revoke all on function private.can_manage_courts(uuid) from public;
revoke all on function private.set_court_updated_at() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_club_member(uuid) to authenticated;
grant execute on function private.can_manage_courts(uuid) to authenticated;

alter table public.clubs enable row level security;
alter table public.club_staff enable row level security;
alter table public.courts enable row level security;

create policy "members can read their clubs"
on public.clubs for select to authenticated
using (private.is_club_member(id));

create policy "users can read their own memberships"
on public.club_staff for select to authenticated
using ((select auth.uid()) = auth_user_id);

create policy "members can read courts from their clubs"
on public.courts for select to authenticated
using (private.is_club_member(club_id));

create policy "owners and admins can update courts from their clubs"
on public.courts for update to authenticated
using (private.can_manage_courts(club_id))
with check (private.can_manage_courts(club_id));

revoke all on table public.clubs from anon;
revoke all on table public.club_staff from anon;
revoke all on table public.courts from anon;
grant select on table public.clubs to authenticated;
grant select on table public.club_staff to authenticated;
grant select, update (name, surface, active, display_order) on table public.courts to authenticated;
