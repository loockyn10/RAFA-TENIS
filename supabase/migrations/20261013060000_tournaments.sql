-- Sprint 07: torneos de eliminación directa. Requiere migraciones 01–06.
-- Esta migración se versiona localmente; no ejecutar automáticamente.

alter table public.reservations
  drop constraint reservations_occupation_type_check,
  add constraint reservations_occupation_type_check check (occupation_type in ('reservation', 'block', 'lesson', 'tournament_match')),
  drop constraint reservations_status_check,
  add constraint reservations_status_check check (
    (occupation_type = 'reservation' and status in ('confirmed', 'cancelled')) or
    (occupation_type = 'block' and status in ('active', 'cancelled')) or
    (occupation_type in ('lesson', 'tournament_match') and status in ('confirmed', 'cancelled'))
  ),
  drop constraint reservations_occupation_details_check,
  add constraint reservations_occupation_details_check check (
    (occupation_type = 'reservation' and char_length(trim(customer_name)) > 0 and block_reason is null) or
    (occupation_type = 'block' and customer_name is null and char_length(trim(block_reason)) > 0) or
    (occupation_type in ('lesson', 'tournament_match') and customer_name is null and block_reason is null)
  );

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'draft' check (status in ('draft', 'registration_open', 'in_progress', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint tournaments_dates_valid check (ends_on >= starts_on),
  unique (club_id, id)
);

create table public.tournament_categories (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  tournament_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 100),
  modality text not null check (modality in ('singles', 'doubles')),
  status text not null default 'open' check (status in ('open', 'fixture_generated', 'completed', 'cancelled')),
  champion_entry_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint tournament_categories_tournament_club_fk foreign key (club_id, tournament_id) references public.tournaments(club_id, id) on delete restrict,
  unique (club_id, id), unique (tournament_id, name)
);

create table public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  category_id uuid not null,
  display_name text not null check (char_length(trim(display_name)) > 0),
  draw_position smallint,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  constraint tournament_entries_category_club_fk foreign key (club_id, category_id) references public.tournament_categories(club_id, id) on delete restrict,
  unique (club_id, id), unique (category_id, draw_position)
);

create table public.tournament_entry_members (
  entry_id uuid not null,
  category_id uuid not null,
  club_id uuid not null references public.clubs(id) on delete restrict,
  person_id uuid not null,
  person_name_snapshot text not null check (char_length(trim(person_name_snapshot)) > 0),
  created_at timestamptz not null default now(),
  primary key (entry_id, person_id),
  constraint tournament_entry_members_entry_club_fk foreign key (club_id, entry_id) references public.tournament_entries(club_id, id) on delete restrict,
  constraint tournament_entry_members_category_club_fk foreign key (club_id, category_id) references public.tournament_categories(club_id, id) on delete restrict,
  constraint tournament_entry_members_person_club_fk foreign key (club_id, person_id) references public.club_people(club_id, id) on delete restrict,
  unique (category_id, person_id)
);

create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  tournament_id uuid not null,
  category_id uuid not null,
  round_number smallint not null check (round_number >= 1),
  position smallint not null check (position >= 1),
  entry_one_id uuid,
  entry_two_id uuid,
  winner_entry_id uuid,
  next_match_id uuid,
  next_slot smallint check (next_slot in (1, 2)),
  reservation_id uuid,
  status text not null default 'pending' check (status in ('pending', 'scheduled', 'completed', 'cancelled')),
  score_text text,
  is_walkover boolean not null default false,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint tournament_matches_tournament_club_fk foreign key (club_id, tournament_id) references public.tournaments(club_id, id) on delete restrict,
  constraint tournament_matches_category_club_fk foreign key (club_id, category_id) references public.tournament_categories(club_id, id) on delete restrict,
  constraint tournament_matches_entry_one_club_fk foreign key (club_id, entry_one_id) references public.tournament_entries(club_id, id) on delete restrict,
  constraint tournament_matches_entry_two_club_fk foreign key (club_id, entry_two_id) references public.tournament_entries(club_id, id) on delete restrict,
  constraint tournament_matches_winner_club_fk foreign key (club_id, winner_entry_id) references public.tournament_entries(club_id, id) on delete restrict,
  constraint tournament_matches_next_club_fk foreign key (club_id, next_match_id) references public.tournament_matches(club_id, id) on delete restrict,
  constraint tournament_matches_reservation_club_fk foreign key (club_id, reservation_id) references public.reservations(club_id, id) on delete restrict,
  constraint tournament_matches_entries_distinct check (entry_one_id is null or entry_two_id is null or entry_one_id <> entry_two_id),
  constraint tournament_matches_next_target check ((next_match_id is null and next_slot is null) or (next_match_id is not null and next_slot is not null)),
  constraint tournament_matches_result_valid check ((status <> 'completed') or (winner_entry_id is not null and finished_at is not null)),
  unique (category_id, round_number, position), unique (reservation_id), unique (club_id, id)
);
alter table public.tournament_categories add constraint tournament_categories_champion_fk foreign key (club_id, champion_entry_id) references public.tournament_entries(club_id, id) on delete restrict;

create index tournaments_club_status_idx on public.tournaments(club_id, status, starts_on);
create index tournament_categories_tournament_idx on public.tournament_categories(tournament_id, status);
create index tournament_entries_category_idx on public.tournament_entries(category_id, created_at);
create index tournament_entry_members_person_idx on public.tournament_entry_members(club_id, person_id);
create index tournament_matches_category_round_idx on public.tournament_matches(category_id, round_number, position);

create or replace function private.set_tournament_updated_at()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$ begin new.updated_at := now(); return new; end; $$;
create trigger tournaments_set_updated_at before update on public.tournaments for each row execute function private.set_tournament_updated_at();
create trigger tournament_categories_set_updated_at before update on public.tournament_categories for each row execute function private.set_tournament_updated_at();
create trigger tournament_matches_set_updated_at before update on public.tournament_matches for each row execute function private.set_tournament_updated_at();

create or replace function private.guard_tournament_match_occupation()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if (tg_op = 'INSERT' and new.occupation_type = 'tournament_match') or (tg_op = 'UPDATE' and (old.occupation_type = 'tournament_match' or new.occupation_type = 'tournament_match')) then
    if current_setting('rafa_tenis.tournament_mutation', true) is distinct from 'on' then
      raise exception 'Las ocupaciones de partidos se gestionan desde el módulo Torneos.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger reservations_guard_tournament_match_occupation before insert or update on public.reservations for each row execute function private.guard_tournament_match_occupation();

create or replace function private.assert_tournament_manager(p_club_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$ begin
  if auth.uid() is null or not private.can_manage_club_memberships(p_club_id) then raise exception 'Solo owner o admin puede modificar la estructura del torneo.' using errcode = '42501'; end if;
end; $$;

create or replace function public.create_tournament(p_club_id uuid, p_name text, p_description text, p_starts_on date, p_ends_on date)
returns public.tournaments language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v_tournament public.tournaments;
begin
  perform private.assert_tournament_manager(p_club_id);
  insert into public.tournaments (club_id, name, description, starts_on, ends_on) values (p_club_id, trim(p_name), nullif(trim(coalesce(p_description, '')), ''), p_starts_on, p_ends_on) returning * into v_tournament;
  return v_tournament;
end; $$;

create or replace function public.update_tournament(p_tournament_id uuid, p_name text, p_description text, p_starts_on date, p_ends_on date, p_status text)
returns public.tournaments language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v_tournament public.tournaments;
begin
  select * into v_tournament from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'El torneo no existe.' using errcode = '23503'; end if;
  perform private.assert_tournament_manager(v_tournament.club_id);
  if p_status not in ('draft', 'registration_open', 'in_progress', 'completed', 'cancelled') then raise exception 'Estado de torneo inválido.' using errcode = '22023'; end if;
  if (v_tournament.status = 'completed' and p_status <> 'completed') or (v_tournament.status = 'cancelled' and p_status <> 'cancelled')
    or (v_tournament.status = 'draft' and p_status not in ('draft', 'registration_open', 'cancelled'))
    or (v_tournament.status = 'registration_open' and p_status not in ('draft', 'registration_open', 'in_progress', 'cancelled'))
    or (v_tournament.status = 'in_progress' and p_status not in ('in_progress', 'completed', 'cancelled')) then
    raise exception 'La transición de estado no está permitida.' using errcode = '22023';
  end if;
  update public.tournaments set name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''), starts_on = p_starts_on, ends_on = p_ends_on, status = p_status where id = v_tournament.id returning * into v_tournament;
  return v_tournament;
end; $$;

create or replace function public.create_tournament_category(p_tournament_id uuid, p_name text, p_modality text)
returns public.tournament_categories language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v_tournament public.tournaments; v_category public.tournament_categories;
begin
  select * into v_tournament from public.tournaments where id = p_tournament_id;
  if not found then raise exception 'El torneo no existe.' using errcode = '23503'; end if;
  perform private.assert_tournament_manager(v_tournament.club_id);
  if v_tournament.status in ('completed', 'cancelled') then raise exception 'No se pueden crear categorías en un torneo cerrado.' using errcode = '22023'; end if;
  insert into public.tournament_categories (club_id, tournament_id, name, modality) values (v_tournament.club_id, v_tournament.id, trim(p_name), p_modality) returning * into v_category;
  return v_category;
end; $$;

create or replace function public.create_tournament_entry(p_category_id uuid, p_person_ids uuid[])
returns public.tournament_entries language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v_category public.tournament_categories; v_count integer; v_entry public.tournament_entries; v_names text;
begin
  select * into v_category from public.tournament_categories where id = p_category_id for update;
  if not found then raise exception 'La categoría no existe.' using errcode = '23503'; end if;
  perform private.assert_tournament_manager(v_category.club_id);
  if v_category.status <> 'open' then raise exception 'No se pueden modificar inscripciones después de generar el fixture.' using errcode = '22023'; end if;
  select cardinality(coalesce(p_person_ids, '{}'::uuid[])) into v_count;
  if (v_category.modality = 'singles' and v_count <> 1) or (v_category.modality = 'doubles' and v_count <> 2) or v_count <> (select count(distinct person_id) from unnest(coalesce(p_person_ids, '{}'::uuid[])) as person_id) then raise exception 'La cantidad de participantes no coincide con la modalidad.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(p_person_ids) as person_id left join public.club_people p on p.id = person_id and p.club_id = v_category.club_id and p.active where p.id is null) then raise exception 'Una persona no existe, está inactiva o pertenece a otro club.' using errcode = '23503'; end if;
  if exists (select 1 from public.tournament_entry_members m where m.category_id = v_category.id and m.person_id = any(p_person_ids)) then raise exception 'Una persona ya está inscripta en esta categoría.' using errcode = '23505'; end if;
  select string_agg(full_name, ' / ' order by array_position(p_person_ids, id)) into v_names from public.club_people where club_id = v_category.club_id and id = any(p_person_ids);
  insert into public.tournament_entries (club_id, category_id, display_name) values (v_category.club_id, v_category.id, v_names) returning * into v_entry;
  insert into public.tournament_entry_members (entry_id, category_id, club_id, person_id, person_name_snapshot) select v_entry.id, v_category.id, v_category.club_id, p.id, p.full_name from public.club_people p where p.id = any(p_person_ids);
  return v_entry;
end; $$;

create or replace function public.delete_tournament_entry(p_entry_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v_entry public.tournament_entries; v_category public.tournament_categories;
begin
  select * into v_entry from public.tournament_entries where id = p_entry_id for update;
  if not found then raise exception 'La inscripción no existe.' using errcode = '23503'; end if;
  select * into v_category from public.tournament_categories where id = v_entry.category_id;
  perform private.assert_tournament_manager(v_entry.club_id);
  if v_category.status <> 'open' then raise exception 'No se puede quitar una inscripción con fixture generado.' using errcode = '22023'; end if;
  delete from public.tournament_entries where id = v_entry.id;
end; $$;

create or replace function public.generate_tournament_fixture(p_category_id uuid)
returns setof public.tournament_matches language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_category public.tournament_categories; v_tournament public.tournaments; v_entries uuid[]; v_count integer; v_size integer := 2; v_rounds integer := 1; v_round integer; v_position integer; v_match public.tournament_matches; v_next_id uuid; v_first_round_pairs integer; v_full_pairs integer; v_cursor integer := 1; v_one uuid; v_two uuid;
begin
  select * into v_category from public.tournament_categories where id = p_category_id for update;
  if not found then raise exception 'La categoría no existe.' using errcode = '23503'; end if;
  perform private.assert_tournament_manager(v_category.club_id);
  select * into v_tournament from public.tournaments where id = v_category.tournament_id for update;
  if v_category.status <> 'open' or v_tournament.status not in ('registration_open', 'in_progress') then raise exception 'Abrí inscripciones y verificá que la categoría no tenga fixture antes de generarlo.' using errcode = '22023'; end if;
  select array_agg(id order by random()) into v_entries from public.tournament_entries where category_id = v_category.id;
  v_count := cardinality(coalesce(v_entries, '{}'::uuid[]));
  if v_count not between 2 and 32 then raise exception 'La categoría debe tener entre 2 y 32 inscripciones.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_category.id::text, 0));
  while v_size < v_count loop v_size := v_size * 2; v_rounds := v_rounds + 1; end loop;
  -- Se crean primero las rondas futuras. Los pases libres no crean partidos de primera ronda: avanzan automáticamente.
  for v_round in reverse v_rounds..2 loop
    for v_position in 1..(v_size / power(2, v_round))::integer loop
      insert into public.tournament_matches (club_id, tournament_id, category_id, round_number, position)
      values (v_category.club_id, v_category.tournament_id, v_category.id, v_round, v_position) returning * into v_match;
      if v_round < v_rounds then
        select id into v_next_id from public.tournament_matches where category_id = v_category.id and round_number = v_round + 1 and position = ceil(v_position::numeric / 2)::integer;
        update public.tournament_matches set next_match_id = v_next_id, next_slot = case when v_position % 2 = 1 then 1 else 2 end where id = v_match.id;
      end if;
    end loop;
  end loop;
  v_first_round_pairs := v_size / 2; v_full_pairs := v_count - v_first_round_pairs;
  for v_position in 1..v_first_round_pairs loop
    v_one := v_entries[v_cursor]; v_cursor := v_cursor + 1;
    if v_position <= v_full_pairs then
      v_two := v_entries[v_cursor]; v_cursor := v_cursor + 1;
      select id into v_next_id from public.tournament_matches where category_id = v_category.id and round_number = 2 and position = ceil(v_position::numeric / 2)::integer;
      insert into public.tournament_matches (club_id, tournament_id, category_id, round_number, position, entry_one_id, entry_two_id, next_match_id, next_slot)
      values (v_category.club_id, v_category.tournament_id, v_category.id, 1, v_position, v_one, v_two, v_next_id, case when v_position % 2 = 1 then 1 else 2 end);
    else
      update public.tournament_matches set entry_one_id = case when v_position % 2 = 1 then v_one else entry_one_id end, entry_two_id = case when v_position % 2 = 0 then v_one else entry_two_id end
      where category_id = v_category.id and round_number = 2 and position = ceil(v_position::numeric / 2)::integer;
    end if;
  end loop;
  update public.tournament_categories set status = 'fixture_generated' where id = v_category.id;
  update public.tournaments set status = 'in_progress' where id = v_tournament.id and status = 'registration_open';
  return query select * from public.tournament_matches where category_id = v_category.id order by round_number, position;
end; $$;

create or replace function public.schedule_tournament_match(p_match_id uuid, p_court_id uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns public.tournament_matches language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v_match public.tournament_matches; v_reservation public.reservations;
begin
  select * into v_match from public.tournament_matches where id = p_match_id for update;
  if not found then raise exception 'El partido no existe.' using errcode = '23503'; end if;
  if auth.uid() is null or not private.is_club_member(v_match.club_id) then raise exception 'No tenés permiso para programar este partido.' using errcode = '42501'; end if;
  if v_match.status in ('completed', 'cancelled') or v_match.entry_one_id is null or v_match.entry_two_id is null or p_ends_at <= p_starts_at then raise exception 'El partido no está listo para ser programado.' using errcode = '22023'; end if;
  perform set_config('rafa_tenis.tournament_mutation', 'on', true);
  if v_match.reservation_id is null then
    insert into public.reservations (club_id, court_id, starts_at, ends_at, status, occupation_type) values (v_match.club_id, p_court_id, p_starts_at, p_ends_at, 'confirmed', 'tournament_match') returning * into v_reservation;
    update public.tournament_matches set reservation_id = v_reservation.id, status = 'scheduled' where id = v_match.id returning * into v_match;
  else
    update public.reservations set court_id = p_court_id, starts_at = p_starts_at, ends_at = p_ends_at, status = 'confirmed' where id = v_match.reservation_id;
    update public.tournament_matches set status = 'scheduled' where id = v_match.id returning * into v_match;
  end if;
  return v_match;
end; $$;

create or replace function public.cancel_tournament_match_schedule(p_match_id uuid)
returns public.tournament_matches language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v_match public.tournament_matches;
begin
  select * into v_match from public.tournament_matches where id = p_match_id for update;
  if not found then raise exception 'El partido no existe.' using errcode = '23503'; end if;
  if auth.uid() is null or not private.is_club_member(v_match.club_id) then raise exception 'No tenés permiso para cancelar esta programación.' using errcode = '42501'; end if;
  if v_match.status = 'completed' then raise exception 'No se puede cancelar la programación de un partido finalizado.' using errcode = '22023'; end if;
  if v_match.reservation_id is not null then perform set_config('rafa_tenis.tournament_mutation', 'on', true); update public.reservations set status = 'cancelled' where id = v_match.reservation_id; end if;
  update public.tournament_matches set status = 'pending' where id = v_match.id returning * into v_match; return v_match;
end; $$;

create or replace function public.record_tournament_match_result(p_match_id uuid, p_winner_entry_id uuid, p_score_text text default null, p_is_walkover boolean default false)
returns public.tournament_matches language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v_match public.tournament_matches; v_next public.tournament_matches; v_category public.tournament_categories;
begin
  select * into v_match from public.tournament_matches where id = p_match_id for update;
  if not found then raise exception 'El partido no existe.' using errcode = '23503'; end if;
  if auth.uid() is null or not private.is_club_member(v_match.club_id) then raise exception 'No tenés permiso para registrar resultados.' using errcode = '42501'; end if;
  if v_match.status in ('completed', 'cancelled') or p_winner_entry_id not in (v_match.entry_one_id, v_match.entry_two_id) then raise exception 'El ganador debe ser uno de los participantes de un partido pendiente.' using errcode = '22023'; end if;
  if exists (select 1 from public.tournament_matches where category_id = v_match.category_id and round_number > v_match.round_number and status = 'completed') then raise exception 'No se puede corregir un resultado cuando ya hay rondas posteriores finalizadas.' using errcode = '22023'; end if;
  update public.tournament_matches set winner_entry_id = p_winner_entry_id, score_text = nullif(trim(coalesce(p_score_text, '')), ''), is_walkover = p_is_walkover, status = 'completed', finished_at = now() where id = v_match.id returning * into v_match;
  if v_match.next_match_id is null then
    update public.tournament_categories set status = 'completed', champion_entry_id = p_winner_entry_id where id = v_match.category_id returning * into v_category;
    if not exists (select 1 from public.tournament_categories where tournament_id = v_match.tournament_id and status not in ('completed', 'cancelled')) then update public.tournaments set status = 'completed' where id = v_match.tournament_id; end if;
  else
    select * into v_next from public.tournament_matches where id = v_match.next_match_id for update;
    if (v_match.next_slot = 1 and v_next.entry_one_id is not null) or (v_match.next_slot = 2 and v_next.entry_two_id is not null) then raise exception 'El ganador ya fue avanzado al siguiente enfrentamiento.' using errcode = '23505'; end if;
    update public.tournament_matches set entry_one_id = case when v_match.next_slot = 1 then p_winner_entry_id else entry_one_id end, entry_two_id = case when v_match.next_slot = 2 then p_winner_entry_id else entry_two_id end where id = v_match.next_match_id;
  end if;
  return v_match;
end; $$;

alter table public.tournaments enable row level security;
alter table public.tournament_categories enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_entry_members enable row level security;
alter table public.tournament_matches enable row level security;
create policy "club members can read tournaments" on public.tournaments for select to authenticated using (private.is_club_member(club_id));
create policy "club members can read tournament categories" on public.tournament_categories for select to authenticated using (private.is_club_member(club_id));
create policy "club members can read tournament entries" on public.tournament_entries for select to authenticated using (private.is_club_member(club_id));
create policy "club members can read tournament entry members" on public.tournament_entry_members for select to authenticated using (private.is_club_member(club_id));
create policy "club members can read tournament matches" on public.tournament_matches for select to authenticated using (private.is_club_member(club_id));
revoke all on table public.tournaments, public.tournament_categories, public.tournament_entries, public.tournament_entry_members, public.tournament_matches from anon, authenticated;
grant select on table public.tournaments, public.tournament_categories, public.tournament_entries, public.tournament_entry_members, public.tournament_matches to authenticated;
revoke all on function private.set_tournament_updated_at(), private.guard_tournament_match_occupation(), private.assert_tournament_manager(uuid) from public;
revoke all on function public.create_tournament(uuid, text, text, date, date), public.update_tournament(uuid, text, text, date, date, text), public.create_tournament_category(uuid, text, text), public.create_tournament_entry(uuid, uuid[]), public.delete_tournament_entry(uuid), public.generate_tournament_fixture(uuid), public.schedule_tournament_match(uuid, uuid, timestamptz, timestamptz), public.cancel_tournament_match_schedule(uuid), public.record_tournament_match_result(uuid, uuid, text, boolean) from public;
grant execute on function public.create_tournament(uuid, text, text, date, date), public.update_tournament(uuid, text, text, date, date, text), public.create_tournament_category(uuid, text, text), public.create_tournament_entry(uuid, uuid[]), public.delete_tournament_entry(uuid), public.generate_tournament_fixture(uuid) to authenticated;
grant execute on function public.schedule_tournament_match(uuid, uuid, timestamptz, timestamptz), public.cancel_tournament_match_schedule(uuid), public.record_tournament_match_result(uuid, uuid, text, boolean) to authenticated;
