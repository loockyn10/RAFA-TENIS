-- Sprint 16 — verificación reproducible del ranking interno contra PostgreSQL REAL.
-- Requiere las migraciones 01–16 aplicadas. SOLO para una base DESCARTABLE (inserta en auth.users, clubes y personas).
-- Todo corre en una transacción que termina en ROLLBACK; cualquier fallo corta el script (ON_ERROR_STOP).
-- Uso recomendado: supabase/verification/run-sprint-16-local.sh. No ejecutar en producción.
\set ON_ERROR_STOP on
begin;

create schema t16;
grant usage on schema t16 to anon, authenticated;
create table t16.ids (name text primary key, id uuid not null);
create table t16.results (msg text);
grant select on t16.ids to anon, authenticated;
grant insert, select on t16.results to anon, authenticated;

-- ---------- Datos de prueba (como superusuario) ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001601', 'owner-a@test'), ('00000000-0000-0000-0000-000000001602', 'staff-a@test'),
  ('00000000-0000-0000-0000-000000001603', 'player-a@test'), ('00000000-0000-0000-0000-000000001604', 'player-inactive@test'),
  ('00000000-0000-0000-0000-000000001605', 'stranger@test'), ('00000000-0000-0000-0000-000000001606', 'owner-b@test'),
  ('00000000-0000-0000-0000-000000001607', 'player-b@test');
insert into public.clubs (id, name) values ('c0000000-0000-0000-0000-00000000160a', 'Club 16-A'), ('c0000000-0000-0000-0000-00000000160b', 'Club 16-B');
insert into public.club_staff (club_id, auth_user_id, role) values
  ('c0000000-0000-0000-0000-00000000160a', '00000000-0000-0000-0000-000000001601', 'owner'),
  ('c0000000-0000-0000-0000-00000000160a', '00000000-0000-0000-0000-000000001602', 'staff'),
  ('c0000000-0000-0000-0000-00000000160b', '00000000-0000-0000-0000-000000001606', 'owner');
insert into public.club_people (club_id, full_name) select 'c0000000-0000-0000-0000-00000000160a', 'A' || lpad(g::text, 3, '0') from generate_series(1, 70) g;
insert into public.club_people (club_id, full_name) select 'c0000000-0000-0000-0000-00000000160b', 'B' || lpad(g::text, 3, '0') from generate_series(1, 8) g;
-- player-a vinculado a A001 (activa); player-inactive vinculado a A002 y luego desactivada; player-b vinculado a B001 (club B).
insert into public.club_person_auth_links (club_id, person_id, auth_user_id)
  select p.club_id, p.id, u.id from public.club_people p join auth.users u on (p.full_name, u.email) in (('A001', 'player-a@test'), ('A002', 'player-inactive@test'), ('B001', 'player-b@test'));
update public.club_people set active = false where full_name = 'A002' and club_id = 'c0000000-0000-0000-0000-00000000160a';
insert into t16.ids (name, id) values
  ('owner_a', '00000000-0000-0000-0000-000000001601'), ('staff_a', '00000000-0000-0000-0000-000000001602'), ('player_a', '00000000-0000-0000-0000-000000001603'),
  ('player_inactive', '00000000-0000-0000-0000-000000001604'), ('stranger', '00000000-0000-0000-0000-000000001605'), ('owner_b', '00000000-0000-0000-0000-000000001606'),
  ('player_b', '00000000-0000-0000-0000-000000001607'), ('club_a', 'c0000000-0000-0000-0000-00000000160a'), ('club_b', 'c0000000-0000-0000-0000-00000000160b');
insert into t16.ids select 'person_a001', id from public.club_people where club_id = 'c0000000-0000-0000-0000-00000000160a' and full_name = 'A001';

-- ---------- Helpers ----------
create function t16.as_user(p_name text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce((select id::text from t16.ids where name = p_name), ''), true); end $$;
create function t16.id(p_name text) returns uuid language sql stable as $$ select id from t16.ids where name = p_name $$;

create function t16.expect(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FALLO: %', p_msg using errcode = 'P0001'; end if;
  insert into t16.results (msg) values (p_msg);
end $$;

create function t16.expect_error(p_sql text, p_sqlstate text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_sqlstate then insert into t16.results (msg) values (p_msg); return; end if;
    raise exception 'FALLO: % (esperaba %, obtuvo % — %)', p_msg, p_sqlstate, sqlstate, sqlerrm using errcode = 'P0001';
  end;
  raise exception 'FALLO: % (no produjo error)', p_msg using errcode = 'P0001';
end $$;

-- Lectura de la función interna (security definer del dueño): permite comprobar una categoría concreta.
create function t16.cat_rows(p_cat uuid) returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('person_id', r.person_id, 'points', r.points, 'result', r.result)), '[]'::jsonb)
  from private.club_ranking_results((select club_id from public.tournament_categories where id = p_cat)) r where r.category_id = p_cat $$;
create function t16.cat_points(p_cat uuid) returns integer language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(sum(points), 0)::integer from private.club_ranking_results((select club_id from public.tournament_categories where id = p_cat)) r where r.category_id = p_cat $$;
grant execute on function t16.cat_rows(uuid), t16.cat_points(uuid) to authenticated;

create function t16.rows(p_club uuid, p_season int, p_modality text) returns jsonb language sql as $$ select (public.club_ranking(p_club, p_season, p_modality))->'rows' $$;
create function t16.pts(p_rows jsonb, p_person uuid) returns integer language sql immutable as $$
  select (e->>'points')::integer from jsonb_array_elements(p_rows) e where e->>'person_id' = p_person::text $$;
create function t16.pos(p_rows jsonb, p_person uuid) returns integer language sql immutable as $$
  select (e->>'position')::integer from jsonb_array_elements(p_rows) e where e->>'person_id' = p_person::text $$;
create function t16.person_of(p_entry uuid) returns uuid language sql stable as $$ select person_id from public.tournament_entry_members where entry_id = p_entry order by person_id limit 1 $$;

-- Torneo (en inscripción abierta, finaliza en p_year) + categoría + N inscripciones del club A. p_start desplaza las personas usadas.
create function t16.mk(p_name text, p_modality text, p_entries int, p_year int, p_tournament uuid default null, p_start int default 0) returns uuid language plpgsql as $$
declare
  v_t uuid := p_tournament; v_cat uuid; v_per int := case when p_modality = 'doubles' then 2 else 1 end;
  v_people uuid[]; v_club uuid := t16.id('club_a');
begin
  if v_t is null then
    select id into v_t from public.create_tournament(v_club, 'Torneo ' || p_name, null, make_date(p_year, 6, 1), make_date(p_year, 6, 15));
    perform public.update_tournament(v_t, 'Torneo ' || p_name, null, make_date(p_year, 6, 1), make_date(p_year, 6, 15), 'registration_open');
  end if;
  select id into v_cat from public.create_tournament_category(v_t, p_name, p_modality);
  select array_agg(id order by full_name) into v_people from public.club_people where club_id = v_club and active;
  for i in 0..p_entries - 1 loop
    perform public.create_tournament_entry(v_cat, v_people[(p_start + i * v_per + 1):(p_start + i * v_per + v_per)]);
  end loop;
  return v_cat;
end $$;

-- Juega la categoría completa. p_wo_every: cada N-ésimo partido es W.O. (0 = ninguno). El ganador alterna entre entry_one y entry_two.
create function t16.play_all(p_cat uuid, p_wo_every int) returns void language plpgsql as $$
declare v_m public.tournament_matches; v_played int := 0; v_winner uuid; v_wo boolean;
begin
  loop
    select * into v_m from public.tournament_matches where category_id = p_cat and status in ('pending', 'scheduled') and entry_one_id is not null and entry_two_id is not null order by round_number, position limit 1;
    exit when not found;
    v_played := v_played + 1;
    v_winner := case when v_played % 2 = 1 then v_m.entry_one_id else v_m.entry_two_id end;
    v_wo := p_wo_every > 0 and v_played % p_wo_every = 0;
    perform public.record_tournament_match_result(v_m.id, v_winner, case when v_wo then null else '6-4 6-3' end, v_wo);
  end loop;
  perform t16.expect((select status from public.tournament_categories where id = p_cat) = 'completed', 'la categoría quedó completada');
end $$;

create function t16.generate(p_cat uuid) returns void language plpgsql as $$ begin perform count(*) from public.generate_tournament_fixture(p_cat); end $$;

-- ---------- Rol y usuario de aplicación ----------
set local role authenticated;
select t16.as_user('owner_a');

-- 1. Singles sin W.O. de distintos tamaños (BYE incluido): puntos totales calculados a mano y una fila por inscripción.
--    Totales: n=2:160 · 3:195 · 4:230 · 5:245 · 6:260 · 7:275 · 8:290 · 9:295 · 16:330 · 17:330 · 32:330 (campeón 100, finalista 60, semis 35, cuartos 15, octavos 5, antes 0).
do $$
declare n int; cat uuid; expected jsonb := '{"2":160,"3":195,"4":230,"5":245,"6":260,"7":275,"8":290,"9":295,"16":330,"17":330,"32":330}';
begin
  foreach n in array array[2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 32] loop
    cat := t16.mk('Barrido ' || n, 'singles', n, 2021);
    perform t16.generate(cat);
    perform t16.expect(t16.cat_points(cat) = 0 and jsonb_array_length(t16.cat_rows(cat)) = 0, 'n=' || n || ': con el fixture sin jugar no hay puntos');
    perform t16.play_all(cat, 0);
    perform t16.expect(t16.cat_points(cat) = (expected->>n::text)::int, 'n=' || n || ': puntos totales de la categoría = ' || (expected->>n::text));
    perform t16.expect(jsonb_array_length(t16.cat_rows(cat)) = n, 'n=' || n || ': una fila por inscripción (incluye perdedores de primera ronda con 0)');
    perform t16.expect((select count(*) from jsonb_array_elements(t16.cat_rows(cat)) e where e->>'result' = 'champion' and (e->>'points')::int = 100) = 1, 'n=' || n || ': un único campeón con 100');
    perform t16.expect((select count(*) from jsonb_array_elements(t16.cat_rows(cat)) e where e->>'result' = 'finalist' and (e->>'points')::int = 60) = 1, 'n=' || n || ': un único finalista con 60');
  end loop;
  -- Resultados por instancia en un cuadro de 8: 1×100, 1×60, 2×35, 4×15 (no se acumulan rondas: nadie supera 100).
  cat := t16.mk('Detalle 8', 'singles', 8, 2021);
  perform t16.generate(cat); perform t16.play_all(cat, 0);
  perform t16.expect((select array_agg((e->>'points')::int order by (e->>'points')::int desc) from jsonb_array_elements(t16.cat_rows(cat)) e) = array[100, 60, 35, 35, 15, 15, 15, 15], 'cuadro de 8: 100, 60, 35×2, 15×4 (mejor instancia, sin acumular)');
  raise notice 'OK 1: tamaños 2..32 con BYE puntúan por mejor instancia';
end $$;

-- 2. W.O. y BYE en barrido con W.O. cada 3 partidos: solo puntúa quien jugó al menos un partido disputado; nadie recibe puntos por BYE/W.O.
do $$
declare n int; cat uuid; v_played uuid[]; v_rows uuid[];
begin
  foreach n in array array[2, 3, 4, 5, 6, 8, 11, 16, 24, 32] loop
    cat := t16.mk('W.O. ' || n, 'singles', n, 2020);
    perform t16.generate(cat);
    perform t16.play_all(cat, 3);
    select coalesce(array_agg(distinct t16.person_of(e.id)), '{}') into v_played from public.tournament_entries e
      where e.category_id = cat and exists (select 1 from public.tournament_matches m where m.category_id = cat and m.status = 'completed' and not m.is_walkover and e.id in (m.entry_one_id, m.entry_two_id));
    select coalesce(array_agg((r->>'person_id')::uuid), '{}') into v_rows from jsonb_array_elements(t16.cat_rows(cat)) r;
    if exists (select 1 from public.tournament_matches where category_id = cat and status = 'completed' and not is_walkover) then
      perform t16.expect(v_played @> v_rows and v_rows @> v_played, 'W.O. n=' || n || ': puntúan exactamente quienes jugaron algún partido disputado');
      perform t16.expect(not exists (select 1 from jsonb_array_elements(t16.cat_rows(cat)) r where (r->>'points')::int > 100), 'W.O. n=' || n || ': nadie supera 100 puntos');
    else
      perform t16.expect(jsonb_array_length(t16.cat_rows(cat)) = 0, 'W.O. n=' || n || ': sin partidos disputados no hay puntos');
    end if;
  end loop;
  raise notice 'OK 2: barrido con W.O.';
end $$;

-- 3. Escenarios exactos con W.O. (4 inscripciones, año 2023): semi 1 jugada, semi 2 por W.O., final jugada.
do $$
declare
  cat uuid; s1 public.tournament_matches; s2 public.tournament_matches; fin public.tournament_matches; rows jsonb;
  s1w uuid; s1l uuid; s2w uuid; s2l uuid;
begin
  cat := t16.mk('Singles WO', 'singles', 4, 2023);
  perform t16.generate(cat);
  select * into s1 from public.tournament_matches where category_id = cat and round_number = 1 and position = 1;
  select * into s2 from public.tournament_matches where category_id = cat and round_number = 1 and position = 2;
  s1w := t16.person_of(s1.entry_one_id); s1l := t16.person_of(s1.entry_two_id); s2w := t16.person_of(s2.entry_one_id); s2l := t16.person_of(s2.entry_two_id);
  perform public.record_tournament_match_result(s1.id, s1.entry_one_id, '6-1 6-2', false);
  perform public.record_tournament_match_result(s2.id, s2.entry_one_id, null, true);
  select * into fin from public.tournament_matches where category_id = cat and round_number = 2;
  perform public.record_tournament_match_result(fin.id, fin.entry_one_id, '7-5 6-4', false);
  rows := t16.rows(t16.id('club_a'), 2023, 'singles');
  perform t16.expect(jsonb_array_length(rows) = 3, 'W.O.: tres filas (el ausente que no jugó ningún partido no puntúa ni figura)');
  perform t16.expect(t16.pts(rows, s1w) = 100, 'campeón (jugó semifinal y final) = 100');
  perform t16.expect(t16.pts(rows, s2w) = 60, 'ganador por W.O. que luego jugó la final = finalista 60');
  perform t16.expect(t16.pts(rows, s1l) = 35, 'perdedor de semifinal disputada = 35');
  perform t16.expect(t16.pts(rows, s2l) is null, 'quien perdió por W.O. sin jugar ningún partido no recibe puntos ni figura');
  raise notice 'OK 3: W.O. en semifinal';
end $$;

-- 4. BYE campeón por W.O. y final sin partidos disputados (no hay puntos ficticios).
do $$
declare cat uuid; m1 public.tournament_matches; fin public.tournament_matches; rows jsonb; bye_entry uuid; r1w uuid; r1l uuid;
begin
  -- 3 inscripciones: una primera ronda jugada, el BYE espera en la final y gana por W.O.
  cat := t16.mk('Tres con BYE', 'singles', 3, 2024);
  perform t16.generate(cat);
  select * into m1 from public.tournament_matches where category_id = cat and round_number = 1;
  r1w := t16.person_of(m1.entry_one_id); r1l := t16.person_of(m1.entry_two_id);
  perform public.record_tournament_match_result(m1.id, m1.entry_one_id, '6-3 6-3', false);
  select * into fin from public.tournament_matches where category_id = cat and round_number = 2;
  bye_entry := case when fin.entry_one_id = m1.entry_one_id then fin.entry_two_id else fin.entry_one_id end;
  perform public.record_tournament_match_result(fin.id, bye_entry, null, true);
  rows := t16.rows(t16.id('club_a'), 2024, 'singles');
  perform t16.expect(jsonb_array_length(rows) = 2, 'BYE que gana la final por W.O. sin jugar nunca no puntúa ni figura');
  perform t16.expect(t16.pts(rows, r1w) = 60 and t16.pts(rows, r1l) = 35, 'quien sí jugó: finalista 60 y semifinalista 35 (el pase libre no suma por sí mismo)');
  -- 2 inscripciones: la única final se define por W.O.: no se disputó ningún partido, la categoría no puntúa.
  cat := t16.mk('Final por WO', 'singles', 2, 2019);
  perform t16.generate(cat);
  select * into fin from public.tournament_matches where category_id = cat;
  perform public.record_tournament_match_result(fin.id, fin.entry_one_id, null, true);
  perform t16.expect((select status from public.tournament_categories where id = cat) = 'completed', 'la categoría se completó por W.O.');
  perform t16.expect(jsonb_array_length(t16.rows(t16.id('club_a'), 2019, 'singles')) = 0 and not (2019 = any (array(select jsonb_array_elements_text((public.club_ranking(t16.id('club_a'), null, 'singles'))->'seasons')::int))), 'una categoría sin partidos disputados no puntúa ni crea temporada');
  raise notice 'OK 4: BYE y W.O. sin puntos ficticios';
end $$;

-- 5. Dobles (año 2022): puntos individuales para cada integrante, posiciones empatadas, modalidades separadas.
do $$
declare cat uuid; rows jsonb; fin public.tournament_matches; champ uuid; finalist uuid;
begin
  cat := t16.mk('Dobles A', 'doubles', 4, 2022);
  perform t16.generate(cat); perform t16.play_all(cat, 0);
  rows := t16.rows(t16.id('club_a'), 2022, 'doubles');
  perform t16.expect(jsonb_array_length(rows) = 8, 'dobles: 4 parejas = 8 personas en el ranking');
  perform t16.expect((select array_agg((e->>'points')::int order by (e->>'points')::int desc, e->>'name') from jsonb_array_elements(rows) e) = array[100, 100, 60, 60, 35, 35, 35, 35], 'dobles: cada integrante recibe los puntos completos (100×2, 60×2, 35×4)');
  perform t16.expect((select array_agg((e->>'position')::int order by (e->>'position')::int, e->>'name') from jsonb_array_elements(rows) e) = array[1, 1, 3, 3, 5, 5, 5, 5], 'dobles: los empates comparten posición (1,1,3,3,5,5,5,5)');
  perform t16.expect(jsonb_array_length(t16.rows(t16.id('club_a'), 2022, 'singles')) = 0, 'el ranking Singles no incluye resultados de dobles');
  perform t16.expect((select count(*) from jsonb_array_elements(rows) e where (e->>'titles')::int = 1) = 2, 'dobles: ambos integrantes de la pareja campeona cuentan 1 título');
  raise notice 'OK 5: dobles individual';
end $$;

-- 6. Acumulación entre torneos, temporadas, correcciones y ausencia de duplicados (año 2025, mismas 8 personas en dos torneos).
do $$
declare c1 uuid; c2 uuid; t1 uuid; rows jsonb; r jsonb; final1 public.tournament_matches; person_champ uuid; person_final uuid; detail jsonb; seasons jsonb;
begin
  c1 := t16.mk('Apertura', 'singles', 8, 2025); perform t16.generate(c1); perform t16.play_all(c1, 0);
  c2 := t16.mk('Clausura', 'singles', 8, 2025); perform t16.generate(c2); perform t16.play_all(c2, 0);
  select tournament_id into t1 from public.tournament_categories where id = c1;
  rows := t16.rows(t16.id('club_a'), 2025, 'singles');
  perform t16.expect((select sum((e->>'points')::int) from jsonb_array_elements(rows) e) = 580, 'dos torneos de 8: total 2×290 (sin puntos duplicados)');
  perform t16.expect((select sum((e->>'tournaments')::int) from jsonb_array_elements(rows) e) = 16 and (select sum((e->>'titles')::int) from jsonb_array_elements(rows) e) = 2, 'se cuentan 16 participaciones y 2 títulos');
  perform t16.expect(rows = t16.rows(t16.id('club_a'), 2025, 'singles'), 'consultar de nuevo devuelve exactamente lo mismo (el cálculo no acumula nada)');
  -- el detalle de cada persona suma lo mismo que su fila, sin categorías repetidas
  for r in select e from jsonb_array_elements(rows) e loop
    detail := public.club_ranking_player_detail(t16.id('club_a'), 2025, 'singles', (r->>'person_id')::uuid);
    perform t16.expect((select coalesce(sum((d->>'points')::int), 0) from jsonb_array_elements(detail) d) = (r->>'points')::int, 'el detalle suma los puntos del ranking');
    perform t16.expect((select count(distinct d->>'category_id') from jsonb_array_elements(detail) d) = jsonb_array_length(detail) and jsonb_array_length(detail) = (r->>'tournaments')::int, 'el detalle no repite categorías y coincide con la cantidad de torneos');
  end loop;
  -- Corrección autorizada del resultado de la final del primer torneo: el ranking la refleja en la siguiente consulta.
  select * into final1 from public.tournament_matches where category_id = c1 and next_match_id is null;
  person_champ := t16.person_of(final1.winner_entry_id);
  person_final := t16.person_of(case when final1.winner_entry_id = final1.entry_one_id then final1.entry_two_id else final1.entry_one_id end);
  reset role;
  update public.tournament_matches set winner_entry_id = case when winner_entry_id = entry_one_id then entry_two_id else entry_one_id end where id = final1.id;
  update public.tournament_categories set champion_entry_id = (select winner_entry_id from public.tournament_matches where id = final1.id) where id = c1;
  set local role authenticated; perform t16.as_user('owner_a');
  detail := public.club_ranking_player_detail(t16.id('club_a'), 2025, 'singles', person_final);
  perform t16.expect((select (d->>'points')::int from jsonb_array_elements(detail) d where d->>'category_id' = c1::text) = 100, 'corrección: el nuevo campeón pasa a 100 en ese torneo');
  detail := public.club_ranking_player_detail(t16.id('club_a'), 2025, 'singles', person_champ);
  perform t16.expect((select (d->>'points')::int from jsonb_array_elements(detail) d where d->>'category_id' = c1::text) = 60, 'corrección: el campeón anterior pasa a 60 en ese torneo');
  perform t16.expect((select sum((e->>'points')::int) from jsonb_array_elements(t16.rows(t16.id('club_a'), 2025, 'singles')) e) = 580, 'corrección: el total del ranking no cambia ni se duplica');
  -- Corrección de la fecha del torneo (autorizada): cambia de temporada y deja de contar en 2025.
  perform public.update_tournament(t1, 'Torneo Apertura', null, '2027-03-01', '2027-03-05', 'completed');
  perform t16.expect((select sum((e->>'points')::int) from jsonb_array_elements(t16.rows(t16.id('club_a'), 2025, 'singles')) e) = 290, 'al mover el torneo a 2027 la temporada 2025 conserva solo el otro torneo');
  perform t16.expect((select sum((e->>'points')::int) from jsonb_array_elements(t16.rows(t16.id('club_a'), 2027, 'singles')) e) = 290, 'la temporada 2027 recibe los puntos del torneo movido');
  seasons := (public.club_ranking(t16.id('club_a'), null, 'singles'))->'seasons';
  perform t16.expect(seasons = '[2027, 2025, 2024, 2023, 2021, 2020]'::jsonb, 'temporadas con datos, de la más reciente a la más antigua (2022 es solo dobles: aparece en dobles) -> ' || seasons::text);
  perform t16.expect((public.club_ranking(t16.id('club_a'), null, 'singles'))->>'season' = '2027', 'sin temporada indicada se elige la más reciente con resultados');
  perform t16.expect((public.club_ranking(t16.id('club_a'), 2025, 'singles'))->>'season' = '2025', 'una temporada anterior sigue consultable');
  perform public.update_tournament(t1, 'Torneo Apertura', null, '2025-06-01', '2025-06-15', 'completed');
  perform t16.expect((select sum((e->>'points')::int) from jsonb_array_elements(t16.rows(t16.id('club_a'), 2025, 'singles')) e) = 580, 'al restituir la fecha el total vuelve a 580');
  raise notice 'OK 6: acumulación, detalle, correcciones y temporadas';
end $$;

-- 7. Torneos incompletos y cancelados no puntúan (año actual).
do $$
declare cat_open uuid; cat_prog uuid; cat_done uuid; cat_wait uuid; t uuid; m public.tournament_matches; yr int := extract(year from current_date)::int; rows jsonb; cur_seasons jsonb;
begin
  cat_open := t16.mk('Solo inscripciones', 'singles', 6, yr);
  cat_prog := t16.mk('En juego', 'singles', 8, yr);
  perform t16.generate(cat_prog);
  select * into m from public.tournament_matches where category_id = cat_prog and round_number = 1 order by position limit 1;
  perform public.record_tournament_match_result(m.id, m.entry_one_id, '6-0 6-0', false);
  perform t16.expect(jsonb_array_length(t16.rows(t16.id('club_a'), yr, 'singles')) = 0, 'inscripciones abiertas y fixtures en curso no otorgan puntos');
  perform t16.expect(not (yr = any (array(select jsonb_array_elements_text((public.club_ranking(t16.id('club_a'), null, 'singles'))->'seasons')::int))), 'la temporada en curso sin torneos finalizados no figura entre las que tienen datos');
  -- Torneo con dos categorías: la primera finalizada puntúa; si se cancela el torneo, deja de puntuar.
  select id into t from public.create_tournament(t16.id('club_a'), 'Torneo mixto', null, make_date(yr, 1, 10), make_date(yr, 12, 20));
  perform public.update_tournament(t, 'Torneo mixto', null, make_date(yr, 1, 10), make_date(yr, 12, 20), 'registration_open');
  cat_done := t16.mk('Cat terminada', 'singles', 4, yr, t); cat_wait := t16.mk('Cat pendiente', 'singles', 4, yr, t);
  perform t16.generate(cat_done); perform t16.play_all(cat_done, 0);
  perform t16.expect((select status from public.tournaments where id = t) = 'in_progress', 'el torneo sigue en curso con una categoría pendiente');
  perform t16.expect((select sum((e->>'points')::int) from jsonb_array_elements(t16.rows(t16.id('club_a'), yr, 'singles')) e) = 230, 'la categoría finalizada puntúa aunque otra categoría del torneo siga pendiente');
  perform public.update_tournament(t, 'Torneo mixto', null, make_date(yr, 1, 10), make_date(yr, 12, 20), 'cancelled');
  perform t16.expect(jsonb_array_length(t16.rows(t16.id('club_a'), yr, 'singles')) = 0, 'un torneo cancelado no puntúa');
  raise notice 'OK 7: incompletos y cancelados';
end $$;

-- 8. Aislamiento entre clubes, permisos y modalidad inválida.
do $$
declare t public.tournaments; cat public.tournament_categories; people uuid[]; clubb uuid := t16.id('club_b'); rows jsonb; i int;
begin
  perform t16.as_user('owner_b');
  -- Club vacío: sin resultados.
  rows := public.club_ranking(clubb, null, 'singles');
  perform t16.expect(rows->'rows' = '[]'::jsonb and rows->'seasons' = '[]'::jsonb, 'club sin torneos: ranking vacío, sin temporadas');
  perform t16.expect((rows->>'season')::int = extract(year from now() at time zone 'America/Argentina/Buenos_Aires')::int, 'club sin torneos: temporada por defecto = año actual');
  select * into t from public.create_tournament(clubb, 'Torneo club B', null, '2025-05-01', '2025-05-02');
  perform public.update_tournament(t.id, t.name, null, t.starts_on, t.ends_on, 'registration_open');
  select * into cat from public.create_tournament_category(t.id, 'Cat B', 'singles');
  select array_agg(id order by full_name) into people from public.club_people where club_id = clubb;
  for i in 1..4 loop perform public.create_tournament_entry(cat.id, array[people[i]]); end loop;
  perform t16.generate(cat.id); perform t16.play_all(cat.id, 0);
  rows := public.club_ranking(clubb, 2025, 'singles');
  perform t16.expect(jsonb_array_length(rows->'rows') = 4 and not exists (select 1 from jsonb_array_elements(rows->'rows') e where e->>'name' not like 'B%'), 'el club B ve solo a sus propias personas');
  perform t16.expect_error(format('select public.club_ranking(%L, 2025, ''singles'')', t16.id('club_a')), '42501', 'owner de B no consulta el ranking del club A');
  perform t16.expect_error(format('select public.club_ranking_player_detail(%L, 2025, ''singles'', %L)', t16.id('club_a'), people[1]), '42501', 'owner de B no consulta detalle del club A');

  -- Club A: el ranking no incluye personas ni puntos del club B.
  perform t16.as_user('owner_a');
  rows := public.club_ranking(t16.id('club_a'), 2025, 'singles');
  perform t16.expect(not exists (select 1 from jsonb_array_elements(rows->'rows') e where e->>'name' like 'B%') and (select sum((e->>'points')::int) from jsonb_array_elements(rows->'rows') e) = 580, 'el club A no ve personas ni puntos del club B (2025 sigue en 580)');
  perform t16.expect_error(format('select public.club_ranking(%L, 2025, ''singles'')', clubb), '42501', 'owner de A no consulta el ranking del club B');
  perform t16.expect_error(format('select public.club_ranking(%L, 2025, ''padel'')', t16.id('club_a')), '22023', 'modalidad inválida rechazada');
  perform t16.expect(jsonb_array_length(t16.rows(t16.id('club_a'), 1999, 'singles')) = 0 and (public.club_ranking(t16.id('club_a'), 1999, 'singles'))->>'season' = '1999', 'una temporada sin datos devuelve lista vacía');
  perform t16.expect((public.club_ranking(t16.id('club_a'), null, 'doubles'))->'seasons' = '[2022]'::jsonb, 'las temporadas ofrecidas dependen de la modalidad (dobles: solo 2022)');

  -- Roles con acceso de lectura.
  perform t16.as_user('staff_a');
  perform t16.expect(jsonb_array_length(t16.rows(t16.id('club_a'), 2025, 'singles')) > 0, 'staff del club puede leer el ranking');
  perform t16.as_user('player_a');
  rows := public.club_ranking(t16.id('club_a'), 2025, 'singles');
  perform t16.expect(jsonb_array_length(rows->'rows') > 0 and rows->>'my_person_id' = t16.id('person_a001')::text, 'jugador vinculado lee el ranking y recibe su propia persona para destacarla');
  perform t16.expect_error(format('select public.club_ranking(%L, 2025, ''singles'')', clubb), '42501', 'jugador de A no lee el club B');
  perform t16.as_user('player_b');
  perform t16.expect(jsonb_array_length(t16.rows(clubb, 2025, 'singles')) = 4, 'jugador del club B lee su ranking');
  perform t16.expect_error(format('select public.club_ranking(%L, 2025, ''singles'')', t16.id('club_a')), '42501', 'jugador de B no lee el club A');

  -- Sin acceso.
  perform t16.as_user('player_inactive');
  perform t16.expect_error(format('select public.club_ranking(%L, 2025, ''singles'')', t16.id('club_a')), '42501', 'persona vinculada pero inactiva no lee el ranking');
  perform t16.as_user('stranger');
  perform t16.expect_error(format('select public.club_ranking(%L, 2025, ''singles'')', t16.id('club_a')), '42501', 'cuenta sin vínculo ni staff no lee el ranking');
  perform t16.as_user('');
  perform t16.expect_error(format('select public.club_ranking(%L, 2025, ''singles'')', t16.id('club_a')), '42501', 'sin sesión no lee el ranking');
  perform t16.expect_error(format('select public.club_ranking_player_detail(%L, 2025, ''singles'', gen_random_uuid())', t16.id('club_a')), '42501', 'sin sesión no lee el detalle');
  perform t16.as_user('owner_a');
  perform t16.expect_error('select count(*) from private.club_ranking_results(gen_random_uuid())', '42501', 'el cálculo interno no es invocable por la aplicación');
  perform t16.expect((select bool_and(provolatile = 's') from pg_proc where oid in ('public.club_ranking(uuid,integer,text)'::regprocedure, 'public.club_ranking_player_detail(uuid,integer,text,uuid)'::regprocedure)), 'las RPC del ranking son de solo lectura (STABLE): no hay forma de modificar puntos');
  raise notice 'OK 8: aislamiento y permisos';
end $$;

-- Rol anon: sin acceso alguno
reset role;
set local role anon;
do $$
begin
  perform t16.expect_error(format('select public.club_ranking(%L, 2025, ''singles'')', t16.id('club_a')), '42501', 'anon no ejecuta club_ranking');
  perform t16.expect_error(format('select public.club_ranking_player_detail(%L, 2025, ''singles'', gen_random_uuid())', t16.id('club_a')), '42501', 'anon no ejecuta club_ranking_player_detail');
  raise notice 'OK 8b: anon sin acceso';
end $$;
reset role;

select count(*) as verificaciones_ok from t16.results;
rollback;
