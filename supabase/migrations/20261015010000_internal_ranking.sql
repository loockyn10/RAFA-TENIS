-- Sprint 16: ranking interno del club (Singles / Dobles, por temporada anual).
-- Requiere las migraciones 01–15. Esta migración se versiona localmente; no ejecutar automáticamente.
--
-- Diseño: NO hay tablas ni puntos almacenados. El ranking es una lectura calculada en cada consulta a partir de los
-- resultados persistidos del módulo de torneos (tournament_categories / tournament_matches / tournament_entries /
-- tournament_entry_members). Por eso:
--   * no existen puntos duplicados (cada categoría finalizada aporta exactamente una fila por inscripción);
--   * una corrección autorizada de un resultado o de las fechas del torneo se refleja en la siguiente consulta;
--   * nada puede modificarse desde el frontend (solo hay funciones de lectura);
--   * no hay nada que migrar ni que reconstruir: los torneos ya finalizados puntúan retroactivamente.
--
-- Reglas de puntuación (ver docs/DECISIONS.md, decisión del Sprint 16):
--   * Puntúa una categoría con status 'completed', campeón definido, torneo no cancelado y al menos un partido
--     efectivamente disputado (no W.O.). Categorías en curso, abiertas o canceladas no puntúan.
--   * Cada inscripción puntúa UNA vez, por la mejor instancia alcanzada (no se acumulan rondas):
--       campeón 100 · finalista 60 · semifinalista 35 · cuartofinalista 15 · octavos 5 · antes de octavos 0.
--     La instancia se mide desde la final hacia atrás: es independiente del tamaño del cuadro.
--   * Una inscripción solo puntúa (y cuenta como torneo disputado) si jugó al menos un partido efectivamente
--     disputado en la categoría. El pase libre (BYE) no es un partido: no suma ni cuenta por sí mismo. Quien pierde
--     por W.O. sin haber jugado ningún otro partido no recibe puntos. El ganador por W.O. avanza de ronda
--     (es un resultado real del cuadro) pero un W.O. no cuenta como partido disputado.
--   * Dobles: cada integrante de la pareja recibe los puntos completos de la inscripción, individualmente.
--   * Temporada = año de tournaments.ends_on.
--   * Se identifica a las personas por club_people (no por cuenta Auth): sirve para quienes aún no tienen portal.

create or replace function private.assert_ranking_access(p_club_id uuid)
returns void language plpgsql stable security definer set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not (private.is_club_member(p_club_id) or private.is_active_linked_player(p_club_id)) then
    raise exception 'No tenés permiso para ver el ranking de este club.' using errcode = '42501';
  end if;
end;
$$;

-- Una fila por (persona, categoría finalizada que puntúa). Función interna: la consumen las RPC públicas de abajo.
create or replace function private.club_ranking_results(p_club_id uuid)
returns table (
  season integer, modality text, person_id uuid, person_name text, tournament_id uuid, tournament_name text,
  category_id uuid, category_name text, entry_name text, ends_on date, result text, points integer
)
language sql stable set search_path = pg_catalog, public
as $$
  with cats as (
    select c.id as category_id, c.name as category_name, c.modality, c.champion_entry_id, t.id as tournament_id, t.name as tournament_name, t.ends_on,
           (select max(m.round_number) from public.tournament_matches m where m.category_id = c.id) as rounds
    from public.tournament_categories c
    join public.tournaments t on t.club_id = c.club_id and t.id = c.tournament_id
    where c.club_id = p_club_id and c.status = 'completed' and c.champion_entry_id is not null and t.status <> 'cancelled'
      and exists (select 1 from public.tournament_matches m where m.category_id = c.id and m.status = 'completed' and not m.is_walkover)
  ),
  results as (
    select cats.*, e.id as entry_id, e.display_name as entry_name,
      exists (
        select 1 from public.tournament_matches m
        where m.category_id = cats.category_id and m.status = 'completed' and not m.is_walkover and e.id in (m.entry_one_id, m.entry_two_id)
      ) as played,
      (
        select m.round_number from public.tournament_matches m
        where m.category_id = cats.category_id and m.status = 'completed' and m.winner_entry_id <> e.id and e.id in (m.entry_one_id, m.entry_two_id)
        limit 1
      ) as lost_round
    from cats
    join public.tournament_entries e on e.club_id = p_club_id and e.category_id = cats.category_id
  ),
  scored as (
    select r.*,
      case
        when r.entry_id = r.champion_entry_id then 'champion'
        when r.lost_round is null then null
        else case r.rounds - r.lost_round when 0 then 'finalist' when 1 then 'semifinal' when 2 then 'quarterfinal' when 3 then 'round_of_16' else 'participant' end
      end as result
    from results r
    where r.played
  )
  select extract(year from s.ends_on)::integer, s.modality, p.id, p.full_name, s.tournament_id, s.tournament_name,
         s.category_id, s.category_name, s.entry_name, s.ends_on, s.result,
         case s.result when 'champion' then 100 when 'finalist' then 60 when 'semifinal' then 35 when 'quarterfinal' then 15 when 'round_of_16' then 5 else 0 end
  from scored s
  join public.tournament_entry_members mem on mem.club_id = p_club_id and mem.entry_id = s.entry_id
  join public.club_people p on p.club_id = p_club_id and p.id = mem.person_id
  where s.result is not null;
$$;

-- Clasificación de una temporada y modalidad. p_season NULL = la temporada más reciente con resultados
-- (o el año actual del club si todavía no hay ninguna).
create or replace function public.club_ranking(p_club_id uuid, p_season integer default null, p_modality text default 'singles')
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public
as $$
declare v_timezone text; v_seasons integer[]; v_season integer; v_rows jsonb;
begin
  perform private.assert_ranking_access(p_club_id);
  if p_modality is null or p_modality not in ('singles', 'doubles') then raise exception 'Modalidad inválida.' using errcode = '22023'; end if;
  select timezone into v_timezone from public.clubs where id = p_club_id;
  select coalesce(array_agg(distinct r.season order by r.season desc), '{}'::integer[]) into v_seasons from private.club_ranking_results(p_club_id) r where r.modality = p_modality;
  v_season := coalesce(p_season, v_seasons[1], extract(year from now() at time zone coalesce(v_timezone, 'America/Argentina/Buenos_Aires'))::integer);
  select coalesce(jsonb_agg(jsonb_build_object(
    'position', ranked.pos, 'person_id', ranked.person_id, 'name', ranked.person_name, 'points', ranked.points,
    'tournaments', ranked.tournaments, 'titles', ranked.titles, 'runner_ups', ranked.runner_ups
  ) order by ranked.pos, ranked.person_name, ranked.person_id), '[]'::jsonb) into v_rows
  from (
    select agg.*, rank() over (order by agg.points desc, agg.titles desc, agg.runner_ups desc) as pos
    from (
      select r.person_id, max(r.person_name) as person_name, sum(r.points)::integer as points, count(*)::integer as tournaments,
             (count(*) filter (where r.result = 'champion'))::integer as titles, (count(*) filter (where r.result = 'finalist'))::integer as runner_ups
      from private.club_ranking_results(p_club_id) r
      where r.season = v_season and r.modality = p_modality
      group by r.person_id
    ) agg
  ) ranked;
  return jsonb_build_object('season', v_season, 'seasons', to_jsonb(v_seasons), 'modality', p_modality, 'my_person_id', private.get_active_linked_person(p_club_id), 'rows', v_rows);
end;
$$;

-- Torneos que aportaron puntos a una persona en una temporada y modalidad.
create or replace function public.club_ranking_player_detail(p_club_id uuid, p_season integer, p_modality text, p_person_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public
as $$
begin
  perform private.assert_ranking_access(p_club_id);
  if p_modality is null or p_modality not in ('singles', 'doubles') then raise exception 'Modalidad inválida.' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'tournament_id', r.tournament_id, 'tournament_name', r.tournament_name, 'category_id', r.category_id, 'category_name', r.category_name,
      'entry_name', r.entry_name, 'ends_on', r.ends_on, 'result', r.result, 'points', r.points
    ) order by r.ends_on desc, r.tournament_name, r.category_name)
    from private.club_ranking_results(p_club_id) r
    where r.season = p_season and r.modality = p_modality and r.person_id = p_person_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function private.assert_ranking_access(uuid), private.club_ranking_results(uuid) from public, anon, authenticated;
revoke all on function public.club_ranking(uuid, integer, text), public.club_ranking_player_detail(uuid, integer, text, uuid) from public, anon;
grant execute on function public.club_ranking(uuid, integer, text), public.club_ranking_player_detail(uuid, integer, text, uuid) to authenticated;
