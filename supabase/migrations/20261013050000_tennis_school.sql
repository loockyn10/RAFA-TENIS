-- Sprint 06: profesores, alumnos y clases de tenis.
-- Requiere migraciones 01–05. Versiona el esquema; no ejecutar automáticamente.

-- Las clases ocupan la agenda existente, pero conservan su identidad de negocio.
alter table public.reservations
  drop constraint reservations_occupation_type_check,
  add constraint reservations_occupation_type_check
    check (occupation_type in ('reservation', 'block', 'lesson')),
  drop constraint reservations_status_check,
  add constraint reservations_status_check
    check (
      (occupation_type = 'reservation' and status in ('confirmed', 'cancelled'))
      or (occupation_type = 'block' and status in ('active', 'cancelled'))
      or (occupation_type = 'lesson' and status in ('confirmed', 'cancelled'))
    ),
  drop constraint reservations_occupation_details_check,
  add constraint reservations_occupation_details_check
    check (
      (occupation_type = 'reservation' and char_length(trim(customer_name)) > 0 and block_reason is null)
      or (occupation_type = 'block' and customer_name is null and char_length(trim(block_reason)) > 0)
      or (occupation_type = 'lesson' and customer_name is null and block_reason is null)
    ),
  add constraint reservations_club_id_id_key unique (club_id, id);

create table public.club_coaches (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  person_id uuid not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  constraint club_coaches_person_belongs_to_club
    foreign key (club_id, person_id) references public.club_people (club_id, id) on delete restrict,
  unique (club_id, person_id),
  unique (club_id, id)
);

create table public.tennis_lesson_series (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  coach_id uuid not null,
  court_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  occurrence_count smallint not null check (occurrence_count between 1 and 12),
  lesson_type text not null check (lesson_type in ('individual', 'group')),
  capacity smallint not null check (capacity >= 1),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  constraint tennis_lesson_series_end_after_start check (ends_at > starts_at),
  constraint tennis_lesson_series_coach_belongs_to_club
    foreign key (club_id, coach_id) references public.club_coaches (club_id, id) on delete restrict,
  constraint tennis_lesson_series_court_belongs_to_club
    foreign key (club_id, court_id) references public.courts (club_id, id) on delete restrict,
  constraint tennis_lesson_series_type_capacity check (
    (lesson_type = 'individual' and capacity = 1)
    or lesson_type = 'group'
  ),
  unique (club_id, id)
);

create table public.tennis_lessons (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  coach_id uuid not null,
  reservation_id uuid not null,
  lesson_type text not null check (lesson_type in ('individual', 'group')),
  capacity smallint not null check (capacity >= 1),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  notes text,
  recurrence_series_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint tennis_lessons_coach_belongs_to_club
    foreign key (club_id, coach_id) references public.club_coaches (club_id, id) on delete restrict,
  constraint tennis_lessons_reservation_belongs_to_club
    foreign key (club_id, reservation_id) references public.reservations (club_id, id) on delete restrict,
  constraint tennis_lessons_series_belongs_to_club
    foreign key (club_id, recurrence_series_id) references public.tennis_lesson_series (club_id, id) on delete restrict,
  constraint tennis_lessons_one_per_occupation unique (reservation_id),
  constraint tennis_lessons_type_capacity check (
    (lesson_type = 'individual' and capacity = 1)
    or lesson_type = 'group'
  ),
  unique (club_id, id)
);

create table public.tennis_lesson_students (
  lesson_id uuid not null,
  club_id uuid not null references public.clubs(id) on delete restrict,
  person_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  primary key (lesson_id, person_id),
  constraint tennis_lesson_students_lesson_belongs_to_club
    foreign key (club_id, lesson_id) references public.tennis_lessons (club_id, id) on delete restrict,
  constraint tennis_lesson_students_person_belongs_to_club
    foreign key (club_id, person_id) references public.club_people (club_id, id) on delete restrict
);

create index club_coaches_club_active_idx on public.club_coaches (club_id, active, created_at);
create index tennis_lessons_club_coach_idx on public.tennis_lessons (club_id, coach_id, status);
create index tennis_lessons_reservation_idx on public.tennis_lessons (reservation_id);
create index tennis_lesson_students_person_idx on public.tennis_lesson_students (club_id, person_id);

create or replace function private.set_tennis_school_updated_at()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$ begin new.updated_at := now(); return new; end; $$;

create trigger club_coaches_set_updated_at before update on public.club_coaches
for each row execute function private.set_tennis_school_updated_at();
create trigger tennis_lessons_set_updated_at before update on public.tennis_lessons
for each row execute function private.set_tennis_school_updated_at();

-- Las filas lesson de la agenda solo pueden crearse/modificarse dentro de los RPC
-- de este módulo. Esto evita ocupaciones de clase huérfanas desde el cliente.
create or replace function private.guard_tennis_lesson_occupation()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if (tg_op = 'INSERT' and new.occupation_type = 'lesson')
    or (tg_op = 'UPDATE' and (old.occupation_type = 'lesson' or new.occupation_type = 'lesson')) then
    if current_setting('rafa_tenis.lesson_mutation', true) is distinct from 'on' then
      raise exception 'Las ocupaciones de clase se gestionan desde el módulo Escuela de tenis.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger reservations_guard_tennis_lesson_occupation
before insert or update on public.reservations
for each row execute function private.guard_tennis_lesson_occupation();

create or replace function private.validate_tennis_lesson_students(p_club_id uuid, p_capacity smallint, p_students uuid[])
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_count integer;
begin
  select cardinality(coalesce(p_students, '{}'::uuid[])) into v_count;
  if v_count > p_capacity then
    raise exception 'La cantidad de alumnos supera el cupo de la clase.' using errcode = '22023';
  end if;
  if v_count <> (select count(distinct student_id) from unnest(coalesce(p_students, '{}'::uuid[])) as student_id) then
    raise exception 'No se puede asignar el mismo alumno más de una vez.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_students, '{}'::uuid[])) as student_id
    left join public.club_people p on p.id = student_id and p.club_id = p_club_id and p.active
    where p.id is null
  ) then
    raise exception 'Uno de los alumnos no existe, está inactivo o pertenece a otro club.' using errcode = '23503';
  end if;
end;
$$;

create or replace function private.assert_coach_available(p_club_id uuid, p_coach_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_exclude_lesson_id uuid default null)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_coach_id::text, 0));
  if not exists (select 1 from public.club_coaches where id = p_coach_id and club_id = p_club_id and active) then
    raise exception 'El profesor no existe, está inactivo o no pertenece al club.' using errcode = '23503';
  end if;
  if exists (
    select 1 from public.tennis_lessons l
    join public.reservations r on r.id = l.reservation_id and r.club_id = l.club_id
    where l.club_id = p_club_id and l.coach_id = p_coach_id and l.status = 'scheduled'
      and r.status = 'confirmed' and (p_exclude_lesson_id is null or l.id <> p_exclude_lesson_id)
      and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    raise exception 'El profesor ya tiene una clase en ese horario.' using errcode = '23P01';
  end if;
end;
$$;

create or replace function public.create_tennis_lesson(
  p_club_id uuid, p_coach_id uuid, p_court_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_lesson_type text, p_capacity smallint, p_student_ids uuid[] default '{}'::uuid[], p_notes text default null
) returns public.tennis_lessons
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_reservation public.reservations; v_lesson public.tennis_lessons;
begin
  if auth.uid() is null or not private.is_club_member(p_club_id) then raise exception 'No tenés permiso para crear clases en este club.' using errcode = '42501'; end if;
  if p_ends_at <= p_starts_at or p_lesson_type not in ('individual', 'group') or p_capacity < 1 or (p_lesson_type = 'individual' and p_capacity <> 1) then raise exception 'Los datos de la clase no son válidos.' using errcode = '22023'; end if;
  perform private.validate_tennis_lesson_students(p_club_id, p_capacity, p_student_ids);
  perform private.assert_coach_available(p_club_id, p_coach_id, p_starts_at, p_ends_at);
  perform set_config('rafa_tenis.lesson_mutation', 'on', true);
  insert into public.reservations (club_id, court_id, customer_name, starts_at, ends_at, status, occupation_type, notes)
  values (p_club_id, p_court_id, null, p_starts_at, p_ends_at, 'confirmed', 'lesson', null)
  returning * into v_reservation;
  insert into public.tennis_lessons (club_id, coach_id, reservation_id, lesson_type, capacity, notes)
  values (p_club_id, p_coach_id, v_reservation.id, p_lesson_type, p_capacity, nullif(trim(coalesce(p_notes, '')), '')) returning * into v_lesson;
  insert into public.tennis_lesson_students (lesson_id, club_id, person_id)
  select v_lesson.id, p_club_id, student_id from unnest(coalesce(p_student_ids, '{}'::uuid[])) as student_id;
  return v_lesson;
end;
$$;

create or replace function public.update_tennis_lesson(
  p_lesson_id uuid, p_coach_id uuid, p_court_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_lesson_type text, p_capacity smallint, p_student_ids uuid[] default '{}'::uuid[], p_notes text default null
) returns public.tennis_lessons
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_lesson public.tennis_lessons;
begin
  select * into v_lesson from public.tennis_lessons where id = p_lesson_id for update;
  if not found then raise exception 'La clase no existe.' using errcode = '23503'; end if;
  if auth.uid() is null or not private.is_club_member(v_lesson.club_id) then raise exception 'No tenés permiso para modificar esta clase.' using errcode = '42501'; end if;
  if v_lesson.status <> 'scheduled' then raise exception 'No se puede editar una clase cancelada.' using errcode = '22023'; end if;
  if p_ends_at <= p_starts_at or p_lesson_type not in ('individual', 'group') or p_capacity < 1 or (p_lesson_type = 'individual' and p_capacity <> 1) then raise exception 'Los datos de la clase no son válidos.' using errcode = '22023'; end if;
  perform private.validate_tennis_lesson_students(v_lesson.club_id, p_capacity, p_student_ids);
  perform private.assert_coach_available(v_lesson.club_id, p_coach_id, p_starts_at, p_ends_at, v_lesson.id);
  perform set_config('rafa_tenis.lesson_mutation', 'on', true);
  update public.reservations set court_id = p_court_id, starts_at = p_starts_at, ends_at = p_ends_at
  where id = v_lesson.reservation_id and club_id = v_lesson.club_id;
  update public.tennis_lessons set coach_id = p_coach_id, lesson_type = p_lesson_type, capacity = p_capacity,
    notes = nullif(trim(coalesce(p_notes, '')), '') where id = v_lesson.id returning * into v_lesson;
  delete from public.tennis_lesson_students where lesson_id = v_lesson.id;
  insert into public.tennis_lesson_students (lesson_id, club_id, person_id)
  select v_lesson.id, v_lesson.club_id, student_id from unnest(coalesce(p_student_ids, '{}'::uuid[])) as student_id;
  return v_lesson;
end;
$$;

create or replace function public.cancel_tennis_lesson(p_lesson_id uuid)
returns public.tennis_lessons language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_lesson public.tennis_lessons;
begin
  select * into v_lesson from public.tennis_lessons where id = p_lesson_id for update;
  if not found then raise exception 'La clase no existe.' using errcode = '23503'; end if;
  if auth.uid() is null or not private.is_club_member(v_lesson.club_id) then raise exception 'No tenés permiso para cancelar esta clase.' using errcode = '42501'; end if;
  perform set_config('rafa_tenis.lesson_mutation', 'on', true);
  update public.reservations set status = 'cancelled' where id = v_lesson.reservation_id and club_id = v_lesson.club_id;
  update public.tennis_lessons set status = 'cancelled' where id = v_lesson.id returning * into v_lesson;
  return v_lesson;
end;
$$;

create or replace function public.create_weekly_tennis_lesson_series(
  p_club_id uuid, p_coach_id uuid, p_court_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_lesson_type text, p_capacity smallint, p_student_ids uuid[] default '{}'::uuid[], p_notes text default null, p_occurrence_count smallint default 1
) returns setof uuid
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_timezone text; v_series_id uuid; v_reservation_id uuid; v_lesson_id uuid; v_index integer; v_starts_at timestamptz; v_ends_at timestamptz;
begin
  if auth.uid() is null or not private.is_club_member(p_club_id) then raise exception 'No tenés permiso para crear clases en este club.' using errcode = '42501'; end if;
  if p_occurrence_count not between 1 and 12 or p_ends_at <= p_starts_at or p_lesson_type not in ('individual', 'group') or p_capacity < 1 or (p_lesson_type = 'individual' and p_capacity <> 1) then raise exception 'Los datos de la serie no son válidos.' using errcode = '22023'; end if;
  perform private.validate_tennis_lesson_students(p_club_id, p_capacity, p_student_ids);
  select timezone into v_timezone from public.clubs where id = p_club_id;
  if v_timezone is null then raise exception 'El club no existe.' using errcode = '23503'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_coach_id::text, 0));
  if not exists (select 1 from public.club_coaches where id = p_coach_id and club_id = p_club_id and active) then raise exception 'El profesor no existe, está inactivo o no pertenece al club.' using errcode = '23503'; end if;
  for v_index in 0..p_occurrence_count - 1 loop
    v_starts_at := (timezone(v_timezone, p_starts_at) + (v_index * interval '1 week')) at time zone v_timezone;
    v_ends_at := (timezone(v_timezone, p_ends_at) + (v_index * interval '1 week')) at time zone v_timezone;
    perform private.assert_coach_available(p_club_id, p_coach_id, v_starts_at, v_ends_at);
  end loop;
  insert into public.tennis_lesson_series (club_id, coach_id, court_id, starts_at, ends_at, occurrence_count, lesson_type, capacity, notes)
  values (p_club_id, p_coach_id, p_court_id, p_starts_at, p_ends_at, p_occurrence_count, p_lesson_type, p_capacity, nullif(trim(coalesce(p_notes, '')), '')) returning id into v_series_id;
  perform set_config('rafa_tenis.lesson_mutation', 'on', true);
  for v_index in 0..p_occurrence_count - 1 loop
    v_starts_at := (timezone(v_timezone, p_starts_at) + (v_index * interval '1 week')) at time zone v_timezone;
    v_ends_at := (timezone(v_timezone, p_ends_at) + (v_index * interval '1 week')) at time zone v_timezone;
    -- También compara contra las ocurrencias ya insertadas en esta misma serie.
    perform private.assert_coach_available(p_club_id, p_coach_id, v_starts_at, v_ends_at);
    insert into public.reservations (club_id, court_id, starts_at, ends_at, status, occupation_type)
    values (p_club_id, p_court_id, v_starts_at, v_ends_at, 'confirmed', 'lesson') returning id into v_reservation_id;
    insert into public.tennis_lessons (club_id, coach_id, reservation_id, lesson_type, capacity, notes, recurrence_series_id)
    values (p_club_id, p_coach_id, v_reservation_id, p_lesson_type, p_capacity, nullif(trim(coalesce(p_notes, '')), ''), v_series_id) returning id into v_lesson_id;
    insert into public.tennis_lesson_students (lesson_id, club_id, person_id)
    select v_lesson_id, p_club_id, student_id from unnest(coalesce(p_student_ids, '{}'::uuid[])) as student_id;
    return next v_lesson_id;
  end loop;
end;
$$;

alter table public.club_coaches enable row level security;
alter table public.tennis_lesson_series enable row level security;
alter table public.tennis_lessons enable row level security;
alter table public.tennis_lesson_students enable row level security;
create policy "club members can read coaches" on public.club_coaches for select to authenticated using (private.is_club_member(club_id));
create policy "club members can read lesson series" on public.tennis_lesson_series for select to authenticated using (private.is_club_member(club_id));
create policy "club members can read lessons" on public.tennis_lessons for select to authenticated using (private.is_club_member(club_id));
create policy "club members can read lesson students" on public.tennis_lesson_students for select to authenticated using (private.is_club_member(club_id));
create policy "owners and admins can create coaches" on public.club_coaches for insert to authenticated with check (private.can_manage_club_memberships(club_id));
create policy "owners and admins can update coaches" on public.club_coaches for update to authenticated using (private.can_manage_club_memberships(club_id)) with check (private.can_manage_club_memberships(club_id));

revoke all on table public.club_coaches, public.tennis_lesson_series, public.tennis_lessons, public.tennis_lesson_students from anon, authenticated;
grant select on table public.club_coaches, public.tennis_lesson_series, public.tennis_lessons, public.tennis_lesson_students to authenticated;
grant insert (club_id, person_id, active, notes), update (active, notes) on table public.club_coaches to authenticated;
revoke all on function private.set_tennis_school_updated_at(), private.guard_tennis_lesson_occupation(), private.validate_tennis_lesson_students(uuid, smallint, uuid[]), private.assert_coach_available(uuid, uuid, timestamptz, timestamptz, uuid) from public;
revoke all on function public.create_tennis_lesson(uuid, uuid, uuid, timestamptz, timestamptz, text, smallint, uuid[], text), public.update_tennis_lesson(uuid, uuid, uuid, timestamptz, timestamptz, text, smallint, uuid[], text), public.cancel_tennis_lesson(uuid), public.create_weekly_tennis_lesson_series(uuid, uuid, uuid, timestamptz, timestamptz, text, smallint, uuid[], text, smallint) from public;
grant execute on function public.create_tennis_lesson(uuid, uuid, uuid, timestamptz, timestamptz, text, smallint, uuid[], text), public.update_tennis_lesson(uuid, uuid, uuid, timestamptz, timestamptz, text, smallint, uuid[], text), public.cancel_tennis_lesson(uuid), public.create_weekly_tennis_lesson_series(uuid, uuid, uuid, timestamptz, timestamptz, text, smallint, uuid[], text, smallint) to authenticated;
