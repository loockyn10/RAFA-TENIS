-- Sprint 10A: estabilización de torneos (fixture de eliminación directa).
-- Requiere migraciones 01–10. Esta migración se versiona localmente; no ejecutar automáticamente.
-- No modifica ni regenera fixtures existentes: solo reemplaza dos funciones y agrega garantías para escrituras futuras.
--
-- Causas corregidas:
--  1) generate_tournament_fixture: con exactamente 2 inscripciones el cuadro tiene una sola ronda (la final).
--     La función buscaba igualmente un partido de ronda 2, obtenía NULL e insertaba next_match_id = NULL con
--     next_slot = 1, lo que viola tournament_matches_next_target (23514). La constraint es correcta y se conserva.
--  2) record_tournament_match_result validaba el ganador con "NOT IN (entry_one, entry_two)". Con un participante
--     NULL la expresión da NULL (no TRUE) y no rechazaba nada: se podía cerrar un partido sin rival y con una
--     inscripción de otra categoría (la FK compuesta solo exige mismo club).
--  3) La misma función rechazaba cualquier resultado si existía un partido finalizado en una ronda posterior de la
--     categoría. En cuadros con BYE (p. ej. 6 inscripciones) un partido de ronda 2 entre dos pases libres puede
--     jugarse antes y dejaba imposible cargar los partidos de ronda 1.

create or replace function public.generate_tournament_fixture(p_category_id uuid)
returns setof public.tournament_matches language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_category public.tournament_categories; v_tournament public.tournaments; v_entries uuid[]; v_count integer;
  v_size integer := 2; v_rounds integer := 1; v_round integer; v_position integer; v_match_id uuid; v_next_id uuid;
  v_first_round_pairs integer; v_full_pairs integer; v_cursor integer := 1; v_one uuid; v_two uuid; v_created integer;
begin
  -- El bloqueo de la fila de la categoría serializa generaciones concurrentes: la segunda espera, ve
  -- status = 'fixture_generated' y es rechazada. Cualquier error revierte la función completa.
  select * into v_category from public.tournament_categories where id = p_category_id for update;
  if not found then raise exception 'La categoría no existe.' using errcode = '23503'; end if;
  perform private.assert_tournament_manager(v_category.club_id);
  select * into v_tournament from public.tournaments where id = v_category.tournament_id for update;
  if v_category.status <> 'open' or v_tournament.status not in ('registration_open', 'in_progress') then raise exception 'Abrí inscripciones y verificá que la categoría no tenga fixture antes de generarlo.' using errcode = '22023'; end if;
  if exists (select 1 from public.tournament_matches where category_id = v_category.id) then raise exception 'La categoría ya tiene partidos generados.' using errcode = '22023'; end if;
  select array_agg(id order by random()) into v_entries from public.tournament_entries where category_id = v_category.id;
  v_count := cardinality(coalesce(v_entries, '{}'::uuid[]));
  if v_count not between 2 and 32 then raise exception 'La categoría debe tener entre 2 y 32 inscripciones.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_category.id::text, 0));
  while v_size < v_count loop v_size := v_size * 2; v_rounds := v_rounds + 1; end loop;

  -- Rondas futuras (de la final a la ronda 2). Cada partido nace con su destino ya definido; la final no tiene
  -- destino (next_match_id y next_slot ambos NULL).
  if v_rounds >= 2 then
    for v_round in reverse v_rounds..2 loop
      for v_position in 1..(v_size / (1 << v_round)) loop
        v_next_id := null;
        if v_round < v_rounds then
          select id into v_next_id from public.tournament_matches where category_id = v_category.id and round_number = v_round + 1 and position = (v_position + 1) / 2;
        end if;
        insert into public.tournament_matches (club_id, tournament_id, category_id, round_number, position, next_match_id, next_slot)
        values (v_category.club_id, v_category.tournament_id, v_category.id, v_round, v_position, v_next_id, case when v_next_id is null then null else 2 - (v_position % 2) end);
      end loop;
    end loop;
  end if;

  -- Primera ronda. Los pases libres no crean partido: la inscripción avanza directo a su casillero de ronda 2.
  -- Con 2 inscripciones la primera ronda es la final y no tiene destino.
  v_first_round_pairs := v_size / 2; v_full_pairs := v_count - v_first_round_pairs;
  for v_position in 1..v_first_round_pairs loop
    v_one := v_entries[v_cursor]; v_cursor := v_cursor + 1;
    v_next_id := null;
    if v_rounds >= 2 then
      select id into v_next_id from public.tournament_matches where category_id = v_category.id and round_number = 2 and position = (v_position + 1) / 2;
    end if;
    if v_position <= v_full_pairs then
      v_two := v_entries[v_cursor]; v_cursor := v_cursor + 1;
      insert into public.tournament_matches (club_id, tournament_id, category_id, round_number, position, entry_one_id, entry_two_id, next_match_id, next_slot)
      values (v_category.club_id, v_category.tournament_id, v_category.id, 1, v_position, v_one, v_two, v_next_id, case when v_next_id is null then null else 2 - (v_position % 2) end);
    else
      update public.tournament_matches set entry_one_id = case when v_position % 2 = 1 then v_one else entry_one_id end, entry_two_id = case when v_position % 2 = 0 then v_one else entry_two_id end
      where id = v_next_id returning id into v_match_id;
      if v_match_id is null then raise exception 'No se pudo ubicar un pase libre en el cuadro.' using errcode = 'XX000'; end if;
    end if;
  end loop;

  -- Red de seguridad: en eliminación directa se juegan exactamente (inscripciones - 1) partidos.
  select count(*) into v_created from public.tournament_matches where category_id = v_category.id;
  if v_created <> v_count - 1 then raise exception 'El cuadro generado es inconsistente (% partidos para % inscripciones).', v_created, v_count using errcode = 'XX000'; end if;

  update public.tournament_categories set status = 'fixture_generated' where id = v_category.id;
  update public.tournaments set status = 'in_progress' where id = v_tournament.id and status = 'registration_open';
  return query select * from public.tournament_matches where category_id = v_category.id order by round_number, position;
end; $$;

create or replace function public.record_tournament_match_result(p_match_id uuid, p_winner_entry_id uuid, p_score_text text default null, p_is_walkover boolean default false)
returns public.tournament_matches language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v_match public.tournament_matches; v_next public.tournament_matches; v_category public.tournament_categories;
begin
  select * into v_match from public.tournament_matches where id = p_match_id for update;
  if not found then raise exception 'El partido no existe.' using errcode = '23503'; end if;
  if auth.uid() is null or not private.is_club_member(v_match.club_id) then raise exception 'No tenés permiso para registrar resultados.' using errcode = '42501'; end if;
  if v_match.status in ('completed', 'cancelled') then raise exception 'El partido ya fue finalizado o cancelado.' using errcode = '22023'; end if;
  if v_match.entry_one_id is null or v_match.entry_two_id is null then raise exception 'El partido todavía no tiene a ambos participantes definidos.' using errcode = '22023'; end if;
  -- Comparaciones explícitas: "x NOT IN (a, NULL)" no es verdadero y dejaría pasar ganadores inválidos.
  if p_winner_entry_id is null or (p_winner_entry_id <> v_match.entry_one_id and p_winner_entry_id <> v_match.entry_two_id) then raise exception 'El ganador debe ser uno de los participantes del partido.' using errcode = '22023'; end if;
  select * into v_category from public.tournament_categories where id = v_match.category_id for update;
  if v_category.status <> 'fixture_generated' then raise exception 'La categoría no admite resultados en su estado actual.' using errcode = '22023'; end if;
  if v_match.next_match_id is not null then
    -- Bloquea el destino antes de modificar: un resultado ya cargado aguas abajo o un casillero ocupado impiden avanzar.
    select * into v_next from public.tournament_matches where id = v_match.next_match_id for update;
    if v_next.status = 'completed' or (v_match.next_slot = 1 and v_next.entry_one_id is not null) or (v_match.next_slot = 2 and v_next.entry_two_id is not null) then raise exception 'El ganador ya fue avanzado al siguiente enfrentamiento.' using errcode = '23505'; end if;
  end if;
  update public.tournament_matches set winner_entry_id = p_winner_entry_id, score_text = nullif(trim(coalesce(p_score_text, '')), ''), is_walkover = coalesce(p_is_walkover, false), status = 'completed', finished_at = now() where id = v_match.id returning * into v_match;
  if v_match.next_match_id is null then
    update public.tournament_categories set status = 'completed', champion_entry_id = p_winner_entry_id where id = v_match.category_id;
    if not exists (select 1 from public.tournament_categories where tournament_id = v_match.tournament_id and status not in ('completed', 'cancelled')) then update public.tournaments set status = 'completed' where id = v_match.tournament_id; end if;
  else
    update public.tournament_matches set entry_one_id = case when v_match.next_slot = 1 then p_winner_entry_id else entry_one_id end, entry_two_id = case when v_match.next_slot = 2 then p_winner_entry_id else entry_two_id end where id = v_match.next_match_id;
  end if;
  return v_match;
end; $$;

-- Garantías a nivel de tabla para escrituras futuras (en un CHECK, un resultado NULL cuenta como cumplido; por eso
-- se usa IS NOT DISTINCT FROM). Las constraints de datos se agregan NOT VALID para no
-- bloquear instalaciones que ya tengan filas generadas con las funciones anteriores (ver consulta de diagnóstico en
-- supabase/verification/sprint-10a-tournament-fixture-checks.sql; luego pueden validarse con VALIDATE CONSTRAINT).
alter table public.tournament_matches
  add constraint tournament_matches_winner_is_participant check (winner_entry_id is null or winner_entry_id is not distinct from entry_one_id or winner_entry_id is not distinct from entry_two_id) not valid,
  add constraint tournament_matches_completed_has_entries check (status <> 'completed' or (entry_one_id is not null and entry_two_id is not null)) not valid;

-- Cada casillero de un partido siguiente puede ser alimentado por un único partido.
create unique index tournament_matches_next_slot_unique on public.tournament_matches(next_match_id, next_slot) where next_match_id is not null;

-- Coherencia entre filas que un CHECK no puede expresar: destino de la misma categoría y ronda siguiente;
-- participantes y ganador pertenecientes a la categoría del partido.
create or replace function private.guard_tournament_match_integrity()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare v_next public.tournament_matches;
begin
  if new.next_match_id is not null then
    select * into v_next from public.tournament_matches where id = new.next_match_id;
    if not found or v_next.category_id <> new.category_id or v_next.round_number <> new.round_number + 1 then
      raise exception 'El partido siguiente debe pertenecer a la misma categoría y a la ronda inmediata.' using errcode = '23514';
    end if;
  end if;
  if exists (
    select 1 from unnest(array[new.entry_one_id, new.entry_two_id, new.winner_entry_id]) as e(id)
    where e.id is not null and not exists (select 1 from public.tournament_entries te where te.id = e.id and te.category_id = new.category_id)
  ) then
    raise exception 'Los participantes del partido deben pertenecer a su categoría.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger tournament_matches_guard_integrity before insert or update on public.tournament_matches for each row execute function private.guard_tournament_match_integrity();
revoke all on function private.guard_tournament_match_integrity() from public;

-- Con los privilegios por defecto de Supabase, "revoke ... from public" no quita EXECUTE a anon. Ninguna RPC de torneos
-- tiene uso anónimo (todas exigen sesión); se revoca explícitamente para que anon ni siquiera llegue a ejecutarlas.
revoke all on function public.create_tournament(uuid, text, text, date, date), public.update_tournament(uuid, text, text, date, date, text), public.create_tournament_category(uuid, text, text), public.create_tournament_entry(uuid, uuid[]), public.delete_tournament_entry(uuid), public.generate_tournament_fixture(uuid), public.schedule_tournament_match(uuid, uuid, timestamptz, timestamptz), public.cancel_tournament_match_schedule(uuid), public.record_tournament_match_result(uuid, uuid, text, boolean) from anon;
