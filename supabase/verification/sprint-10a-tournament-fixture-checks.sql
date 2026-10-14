-- Sprint 10A — verificación reproducible del fixture de torneos contra PostgreSQL REAL.
-- Requiere las migraciones 01–11 aplicadas. SOLO para una base DESCARTABLE (inserta en auth.users, clubes y personas).
-- Todo corre en una transacción que termina en ROLLBACK; cualquier fallo corta el script (ON_ERROR_STOP).
-- Uso recomendado: supabase/verification/run-sprint-10a-local.sh (crea la base, aplica migraciones y ejecuta esto).
-- No ejecutar en producción.
\set ON_ERROR_STOP on
begin;

create schema t10a_verify;
grant usage on schema t10a_verify to anon, authenticated;
create table t10a_verify.ids (name text primary key, id uuid not null);
create table t10a_verify.results (msg text);
grant select on t10a_verify.ids to anon, authenticated;
grant insert, select on t10a_verify.results to anon, authenticated;

-- ---------- Datos de prueba (como superusuario) ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000010a1', 'owner-a@test'), ('00000000-0000-0000-0000-0000000010a2', 'admin-a@test'),
  ('00000000-0000-0000-0000-0000000010a3', 'staff-a@test'), ('00000000-0000-0000-0000-0000000010b1', 'owner-b@test');
insert into public.clubs (id, name) values ('c0000000-0000-0000-0000-0000000010aa', 'Club 10A-A'), ('c0000000-0000-0000-0000-0000000010bb', 'Club 10A-B');
insert into public.club_staff (club_id, auth_user_id, role) values
  ('c0000000-0000-0000-0000-0000000010aa', '00000000-0000-0000-0000-0000000010a1', 'owner'),
  ('c0000000-0000-0000-0000-0000000010aa', '00000000-0000-0000-0000-0000000010a2', 'admin'),
  ('c0000000-0000-0000-0000-0000000010aa', '00000000-0000-0000-0000-0000000010a3', 'staff'),
  ('c0000000-0000-0000-0000-0000000010bb', '00000000-0000-0000-0000-0000000010b1', 'owner');
insert into public.club_people (club_id, full_name) select 'c0000000-0000-0000-0000-0000000010aa', 'A' || lpad(g::text, 3, '0') from generate_series(1, 70) g;
insert into public.club_people (club_id, full_name) select 'c0000000-0000-0000-0000-0000000010bb', 'B' || lpad(g::text, 3, '0') from generate_series(1, 4) g;
insert into public.courts (club_id, name, surface, display_order) values ('c0000000-0000-0000-0000-0000000010aa', 'Cancha 10A', 'Polvo', 1);
insert into t10a_verify.ids (name, id) values
  ('owner_a', '00000000-0000-0000-0000-0000000010a1'), ('admin_a', '00000000-0000-0000-0000-0000000010a2'),
  ('staff_a', '00000000-0000-0000-0000-0000000010a3'), ('owner_b', '00000000-0000-0000-0000-0000000010b1'),
  ('club_a', 'c0000000-0000-0000-0000-0000000010aa'), ('club_b', 'c0000000-0000-0000-0000-0000000010bb');
insert into t10a_verify.ids select 'court_a', id from public.courts where club_id = 'c0000000-0000-0000-0000-0000000010aa';

-- ---------- Helpers ----------
create function t10a_verify.as_user(p_name text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce((select id::text from t10a_verify.ids where name = p_name), ''), true); end $$;

create function t10a_verify.expect(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FALLO: %', p_msg using errcode = 'P0001'; end if;
  insert into t10a_verify.results (msg) values (p_msg);
end $$;

create function t10a_verify.expect_error(p_sql text, p_sqlstate text, p_msg text, p_contains text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_sqlstate and (p_contains is null or sqlerrm like '%' || p_contains || '%') then insert into t10a_verify.results (msg) values (p_msg); return; end if;
    raise exception 'FALLO: % (esperaba %, obtuvo % — %)', p_msg, p_sqlstate, sqlstate, sqlerrm using errcode = 'P0001';
  end;
  raise exception 'FALLO: % (no produjo error)', p_msg using errcode = 'P0001';
end $$;

-- Crea torneo (en inscripción abierta) + categoría + N inscripciones. Ejecutar como owner_a/admin_a.
create function t10a_verify.make_category(p_name text, p_modality text, p_entries int, p_tournament uuid default null) returns uuid language plpgsql as $$
declare
  v_t uuid := p_tournament; v_cat uuid; v_per int := case when p_modality = 'doubles' then 2 else 1 end;
  v_people uuid[]; v_club uuid := (select id from t10a_verify.ids where name = 'club_a');
begin
  if v_t is null then
    select id into v_t from public.create_tournament(v_club, 'Torneo ' || p_name, null, current_date, current_date + 7);
    perform public.update_tournament(v_t, 'Torneo ' || p_name, null, current_date, current_date + 7, 'registration_open');
  end if;
  select id into v_cat from public.create_tournament_category(v_t, p_name, p_modality);
  select array_agg(id order by full_name) into v_people from public.club_people where club_id = v_club;
  for i in 0..p_entries - 1 loop
    perform public.create_tournament_entry(v_cat, v_people[(i * v_per + 1):(i * v_per + v_per)]);
  end loop;
  return v_cat;
end $$;

-- Estructura del cuadro recién generado (antes de jugar).
create function t10a_verify.validate_bracket(p_cat uuid, p_n int) returns void language plpgsql as $$
declare v_size int := 2; v_rounds int := 1; v_bad int; v_label text := 'n=' || p_n || ': ';
begin
  while v_size < p_n loop v_size := v_size * 2; v_rounds := v_rounds + 1; end loop;
  perform t10a_verify.expect((select count(*) from public.tournament_matches where category_id = p_cat) = p_n - 1, v_label || 'se crean n-1 partidos');
  perform t10a_verify.expect((select max(round_number) from public.tournament_matches where category_id = p_cat) = v_rounds, v_label || 'cantidad de rondas');
  perform t10a_verify.expect((select count(*) from public.tournament_matches where category_id = p_cat and next_match_id is null) = 1
    and (select round_number from public.tournament_matches where category_id = p_cat and next_match_id is null) = v_rounds, v_label || 'una única final sin destino');
  select count(*) into v_bad from public.tournament_matches m left join public.tournament_matches x on x.id = m.next_match_id
    where m.category_id = p_cat and m.next_match_id is not null
      and (x.category_id <> m.category_id or x.round_number <> m.round_number + 1 or x.position <> (m.position + 1) / 2 or m.next_slot is distinct from 2 - (m.position % 2));
  perform t10a_verify.expect(v_bad = 0, v_label || 'cada partido apunta a la ronda siguiente, posición y casillero correctos');
  perform t10a_verify.expect((select count(*) from public.tournament_matches where category_id = p_cat and (next_match_id is null) <> (next_slot is null)) = 0, v_label || 'next_match_id y next_slot van juntos');
  select count(*) into v_bad from public.tournament_matches m where m.category_id = p_cat
    and (m.entry_one_id is not null)::int + (m.entry_two_id is not null)::int + (select count(*) from public.tournament_matches f where f.next_match_id = m.id) <> 2;
  perform t10a_verify.expect(v_bad = 0, v_label || 'cada partido tiene exactamente dos orígenes (inscripción directa o ganador previo)');
  select count(*) into v_bad from public.tournament_matches m where m.category_id = p_cat and m.round_number >= 2
    and ((m.entry_one_id is not null) = exists (select 1 from public.tournament_matches f where f.next_match_id = m.id and f.next_slot = 1)
      or (m.entry_two_id is not null) = exists (select 1 from public.tournament_matches f where f.next_match_id = m.id and f.next_slot = 2));
  perform t10a_verify.expect(v_bad = 0, v_label || 'un pase libre nunca ocupa el casillero de un ganador previo');
  perform t10a_verify.expect((select count(*) from public.tournament_matches where category_id = p_cat and round_number = 1 and (entry_one_id is null or entry_two_id is null)) = 0, v_label || 'ningún partido de ronda 1 queda con un participante vacío');
  perform t10a_verify.expect((select count(*) from public.tournament_matches where category_id = p_cat and round_number >= 2 and entry_one_id is not null) +
    (select count(*) from public.tournament_matches where category_id = p_cat and round_number >= 2 and entry_two_id is not null) = v_size - p_n, v_label || 'cantidad de pases libres = tamaño del cuadro - inscripciones');
  perform t10a_verify.expect((select count(*) from (select entry_one_id e from public.tournament_matches where category_id = p_cat union all select entry_two_id from public.tournament_matches where category_id = p_cat) s where e is not null) = p_n
    and (select count(distinct e) from (select entry_one_id e from public.tournament_matches where category_id = p_cat union all select entry_two_id from public.tournament_matches where category_id = p_cat) s where e is not null) = p_n, v_label || 'cada inscripción aparece una sola vez');
  perform t10a_verify.expect((select count(*) from public.tournament_entries where category_id = p_cat) = p_n, v_label || 'las inscripciones no se alteran');
  perform t10a_verify.expect((select status from public.tournament_categories where id = p_cat) = 'fixture_generated', v_label || 'categoría queda fixture_generated');
end $$;

-- Juega la categoría completa. p_wo_every: cada N-ésimo partido es W.O. (0 = ninguno). p_desc: juega primero las rondas más avanzadas disponibles.
create function t10a_verify.play_all(p_cat uuid, p_wo_every int, p_desc boolean) returns int language plpgsql as $$
declare
  v_m public.tournament_matches; v_res public.tournament_matches; v_next public.tournament_matches; v_final public.tournament_matches; v_cat public.tournament_categories;
  v_played int := 0; v_winner uuid; v_wo boolean; v_total int;
begin
  loop
    select * into v_m from public.tournament_matches
      where category_id = p_cat and status in ('pending', 'scheduled') and entry_one_id is not null and entry_two_id is not null
      order by case when p_desc then -round_number else round_number end, position limit 1;
    exit when not found;
    v_played := v_played + 1;
    v_winner := case when v_played % 2 = 1 then v_m.entry_one_id else v_m.entry_two_id end;
    v_wo := p_wo_every > 0 and v_played % p_wo_every = 0;
    select * into v_res from public.record_tournament_match_result(v_m.id, v_winner, case when v_wo then null else '6-4 6-3' end, v_wo);
    perform t10a_verify.expect(v_res.status = 'completed' and v_res.winner_entry_id = v_winner and v_res.is_walkover = v_wo and v_res.finished_at is not null, 'resultado registrado (W.O. ' || v_wo || ')');
    if v_m.next_match_id is not null then
      select * into v_next from public.tournament_matches where id = v_m.next_match_id;
      perform t10a_verify.expect(case when v_m.next_slot = 1 then v_next.entry_one_id else v_next.entry_two_id end = v_winner, 'el ganador avanzó al casillero correcto');
    end if;
  end loop;
  select count(*) into v_total from public.tournament_matches where category_id = p_cat;
  perform t10a_verify.expect((select count(*) from public.tournament_matches where category_id = p_cat and status = 'completed') = v_total, 'los ' || v_total || ' partidos del cuadro quedaron finalizados');
  select * into v_final from public.tournament_matches where category_id = p_cat and next_match_id is null;
  select * into v_cat from public.tournament_categories where id = p_cat;
  perform t10a_verify.expect(v_cat.status = 'completed' and v_cat.champion_entry_id is not null and v_cat.champion_entry_id = v_final.winner_entry_id, 'el campeón es el ganador de la final');
  perform t10a_verify.expect(not exists (select 1 from public.tournament_matches where category_id = p_cat and status <> 'completed'), 'no quedan partidos sin finalizar');
  return v_played;
end $$;

-- ---------- Rol y usuario de aplicación ----------
set local role authenticated;
select t10a_verify.as_user('owner_a');

-- 1–6 y 16 inscripciones y todos los tamaños 2..32 (Singles): estructura, juego completo, campeón, W.O. alternado.
do $$
declare n int; cat uuid;
begin
  for n in 2..32 loop
    cat := t10a_verify.make_category('Singles ' || n, 'singles', n);
    perform t10a_verify.expect((select count(*) from public.generate_tournament_fixture(cat)) = n - 1, 'n=' || n || ': generate devuelve los partidos');
    perform t10a_verify.validate_bracket(cat, n);
    perform t10a_verify.play_all(cat, 3, n % 2 = 0);
    perform t10a_verify.expect((select status from public.tournaments where id = (select tournament_id from public.tournament_categories where id = cat)) = 'completed', 'n=' || n || ': el torneo de una sola categoría se completa');
  end loop;
  raise notice 'OK 1-6: cuadros de 2..32 inscripciones (incluye 2, 3, 4, 6 con BYE, 8, 16 y 32) generan, avanzan y proclaman campeón';
end $$;

-- 7. Dobles
do $$
declare n int; cat uuid;
begin
  foreach n in array array[2, 3, 7, 8, 16, 32] loop
    cat := t10a_verify.make_category('Dobles ' || n, 'doubles', n);
    perform t10a_verify.expect((select count(*) from public.tournament_entry_members where category_id = cat) = n * 2, 'dobles n=' || n || ': cada inscripción tiene dos integrantes');
    perform t10a_verify.expect((select count(*) from public.generate_tournament_fixture(cat)) = n - 1, 'dobles n=' || n || ': generate');
    perform t10a_verify.validate_bracket(cat, n);
    perform t10a_verify.play_all(cat, 0, false);
  end loop;
  raise notice 'OK 7: categorías de dobles';
end $$;

-- 8. Generación duplicada / inscripciones congeladas
do $$
declare cat uuid; entry uuid; empty_cat uuid;
begin
  cat := t10a_verify.make_category('Duplicado', 'singles', 6);
  perform public.generate_tournament_fixture(cat);
  perform t10a_verify.expect_error(format('select public.generate_tournament_fixture(%L)', cat), '22023', 'una segunda generación es rechazada');
  perform t10a_verify.expect((select count(*) from public.tournament_matches where category_id = cat) = 5, 'la segunda generación no agrega ni cambia partidos');
  select id into entry from public.tournament_entries where category_id = cat limit 1;
  perform t10a_verify.expect_error(format('select public.delete_tournament_entry(%L)', entry), '22023', 'no se pueden quitar inscripciones con fixture');
  perform t10a_verify.expect_error(format('select public.create_tournament_entry(%L, array[(select id from public.club_people where full_name = ''A070'')])', cat), '22023', 'no se pueden agregar inscripciones con fixture');
  select id into empty_cat from public.create_tournament_category((select tournament_id from public.tournament_categories where id = cat), 'Vacía', 'singles');
  perform t10a_verify.expect_error(format('select public.generate_tournament_fixture(%L)', empty_cat), '22023', 'categoría sin inscripciones no genera');
  select id into empty_cat from public.create_tournament_category((select tournament_id from public.tournament_categories where id = cat), 'Una sola', 'singles');
  perform public.create_tournament_entry(empty_cat, array[(select id from public.club_people where full_name = 'A070')]);
  perform t10a_verify.expect_error(format('select public.generate_tournament_fixture(%L)', empty_cat), '22023', 'una sola inscripción no genera');
  raise notice 'OK 8: generación duplicada';
end $$;

-- 9–13. Ganadores inválidos, partidos sin rival, BYE jugado primero, resultados ya cargados
do $$
declare cat uuid; other uuid; m public.tournament_matches; fin public.tournament_matches; foreign_entry uuid; same_club_other_cat uuid; r public.tournament_matches;
begin
  cat := t10a_verify.make_category('Invalidos', 'singles', 3);
  other := t10a_verify.make_category('Otra categoria', 'singles', 2);
  perform public.generate_tournament_fixture(cat);
  select id into foreign_entry from public.tournament_entries where category_id = other limit 1;
  select * into fin from public.tournament_matches where category_id = cat and round_number = 2;
  select * into m from public.tournament_matches where category_id = cat and round_number = 1;
  -- La final espera a un finalista: no admite resultado ni con el único participante conocido, ni con ajenos, ni con NULL.
  perform t10a_verify.expect_error(format('select public.record_tournament_match_result(%L, %L)', fin.id, coalesce(fin.entry_one_id, fin.entry_two_id)), '22023', 'no se resuelve un partido con un solo participante');
  perform t10a_verify.expect_error(format('select public.record_tournament_match_result(%L, %L)', fin.id, foreign_entry), '22023', 'ganador de otra categoría en partido sin rival');
  perform t10a_verify.expect_error(format('select public.record_tournament_match_result(%L, null)', fin.id), '22023', 'ganador NULL en partido sin rival');
  perform t10a_verify.expect_error(format('select public.record_tournament_match_result(%L, %L)', m.id, foreign_entry), '22023', 'ganador de otra categoría en partido listo');
  perform t10a_verify.expect_error(format('select public.record_tournament_match_result(%L, %L)', m.id, gen_random_uuid()), '22023', 'ganador inexistente');
  perform t10a_verify.expect_error(format('select public.record_tournament_match_result(%L, null)', m.id), '22023', 'ganador NULL en partido listo');
  perform t10a_verify.expect_error(format('select public.record_tournament_match_result(%L, %L)', gen_random_uuid(), m.entry_one_id), '23503', 'partido inexistente');
  perform t10a_verify.expect((select count(*) from public.tournament_matches where category_id = cat and status <> 'pending') = 0
    and (select champion_entry_id from public.tournament_categories where id = cat) is null, 'los intentos inválidos no modificaron nada');
  -- Resultado válido, y no se puede repetir
  select * into r from public.record_tournament_match_result(m.id, m.entry_two_id, '7-5 6-4', false);
  perform t10a_verify.expect(r.status = 'completed' and r.winner_entry_id = m.entry_two_id, 'resultado válido');
  perform t10a_verify.expect_error(format('select public.record_tournament_match_result(%L, %L)', m.id, m.entry_one_id), '22023', 'un partido finalizado no se puede resolver de nuevo');
  perform t10a_verify.expect((select count(*) from public.tournament_matches where category_id = cat and entry_one_id is not null and entry_two_id is not null and round_number = 2) = 1, 'la final recibió al ganador');
  -- El rol authenticated no puede escribir tablas directamente: solo vía RPC
  perform t10a_verify.expect_error(format('update public.tournament_matches set next_slot = 1 where id = %L', m.id), '42501', 'authenticated no puede escribir tournament_matches directamente');
  raise notice 'OK 9-12: ganadores inválidos, partido sin rival, repetición';
end $$;

do $$
declare cat uuid; m22 public.tournament_matches; m public.tournament_matches; r public.tournament_matches;
begin
  -- 13. Con 6 inscripciones, un partido de ronda 2 (entre dos pases libres) puede jugarse antes que la ronda 1.
  cat := t10a_verify.make_category('BYE primero', 'singles', 6);
  perform public.generate_tournament_fixture(cat);
  select * into m22 from public.tournament_matches where category_id = cat and round_number = 2 and entry_one_id is not null and entry_two_id is not null;
  perform t10a_verify.expect(m22.id is not null, 'con 6 inscripciones hay un partido de ronda 2 ya listo');
  perform public.record_tournament_match_result(m22.id, m22.entry_one_id, '6-0 6-0', false);
  for m in select * from public.tournament_matches where category_id = cat and round_number = 1 order by position loop
    select * into r from public.record_tournament_match_result(m.id, m.entry_one_id, null, true);
    perform t10a_verify.expect(r.status = 'completed' and r.is_walkover, 'ronda 1 se puede cargar tras un resultado posterior de ronda 2 (W.O.)');
  end loop;
  perform t10a_verify.play_all(cat, 0, false);
  raise notice 'OK 13: resultados de rondas posteriores no bloquean la ronda 1';
end $$;

-- 14. Torneo con varias categorías: se completa recién cuando terminan todas
do $$
declare t uuid; a uuid; b uuid;
begin
  a := t10a_verify.make_category('Multi A', 'singles', 2);
  t := (select tournament_id from public.tournament_categories where id = a);
  b := t10a_verify.make_category('Multi B', 'singles', 2, t);
  perform public.generate_tournament_fixture(a); perform public.generate_tournament_fixture(b);
  perform t10a_verify.play_all(a, 0, false);
  perform t10a_verify.expect((select status from public.tournaments where id = t) = 'in_progress', 'el torneo sigue en curso mientras queda una categoría');
  perform t10a_verify.play_all(b, 0, false);
  perform t10a_verify.expect((select status from public.tournaments where id = t) = 'completed', 'el torneo se completa al terminar todas las categorías');
  raise notice 'OK 14: torneo multi-categoría';
end $$;

-- 15. Restricciones PostgreSQL (como superusuario, sin RLS): la estructura se defiende sola
reset role;
do $$
declare cat uuid; other uuid; three uuid; fin3 public.tournament_matches; m1 public.tournament_matches; m2 public.tournament_matches; fin public.tournament_matches; om public.tournament_matches; foreign_entry uuid; own_entry uuid; club uuid;
begin
  perform t10a_verify.as_user('owner_a');
  set local role authenticated;
  cat := t10a_verify.make_category('Constraints', 'singles', 4); other := t10a_verify.make_category('Constraints otra', 'singles', 4);
  three := t10a_verify.make_category('Constraints tres', 'singles', 3);
  perform public.generate_tournament_fixture(cat); perform public.generate_tournament_fixture(other); perform public.generate_tournament_fixture(three);
  reset role;
  select * into fin3 from public.tournament_matches where category_id = three and round_number = 2;
  select club_id into club from public.tournament_categories where id = cat;
  select * into m1 from public.tournament_matches where category_id = cat and round_number = 1 and position = 1;
  select * into m2 from public.tournament_matches where category_id = cat and round_number = 1 and position = 2;
  select * into fin from public.tournament_matches where category_id = cat and round_number = 2;
  select * into om from public.tournament_matches where category_id = other and round_number = 1 and position = 1;
  select id into foreign_entry from public.tournament_entries where category_id = other limit 1;
  select id into own_entry from public.tournament_entries where category_id = cat and id not in (m1.entry_one_id, m1.entry_two_id) limit 1;
  perform t10a_verify.expect_error(format('insert into public.tournament_matches (club_id, tournament_id, category_id, round_number, position, next_slot) values (%L, %L, %L, 9, 1, 1)', club, fin.tournament_id, cat), '23514', 'next_slot sin next_match_id viola tournament_matches_next_target', 'tournament_matches_next_target');
  perform t10a_verify.expect_error(format('insert into public.tournament_matches (club_id, tournament_id, category_id, round_number, position, next_match_id) values (%L, %L, %L, 1, 9, %L)', club, fin.tournament_id, cat, fin.id), '23514', 'next_match_id sin next_slot viola tournament_matches_next_target', 'tournament_matches_next_target');
  perform t10a_verify.expect_error(format('update public.tournament_matches set winner_entry_id = %L where id = %L', own_entry, m1.id), '23514', 'el ganador debe ser uno de los participantes', 'tournament_matches_winner_is_participant');
  perform t10a_verify.expect_error(format('update public.tournament_matches set winner_entry_id = %L, status = ''completed'', finished_at = now() where id = %L', coalesce(fin3.entry_one_id, fin3.entry_two_id), fin3.id), '23514', 'un partido finalizado necesita ambos participantes', 'tournament_matches_completed_has_entries');
  perform t10a_verify.expect_error(format('update public.tournament_matches set next_match_id = %L, next_slot = %s where id = %L', m1.next_match_id, m1.next_slot, m2.id), '23505', 'dos partidos no pueden alimentar el mismo casillero');
  perform t10a_verify.expect_error(format('update public.tournament_matches set next_match_id = (select id from public.tournament_matches where category_id = %L and round_number = 2), next_slot = 1 where id = %L', other, m1.id), '23514', 'el partido siguiente debe ser de la misma categoría');
  perform t10a_verify.expect_error(format('update public.tournament_matches set next_match_id = %L, next_slot = 1 where id = %L', fin.id, fin.id), '23514', 'el partido siguiente debe estar en la ronda inmediata');
  perform t10a_verify.expect_error(format('update public.tournament_matches set entry_one_id = %L where id = %L', foreign_entry, m1.id), '23514', 'los participantes deben pertenecer a la categoría del partido');
  perform t10a_verify.expect_error(format('insert into public.tournament_matches (club_id, tournament_id, category_id, round_number, position) values (%L, %L, %L, 1, 1)', club, m1.tournament_id, cat), '23505', 'no se repite (categoría, ronda, posición)');
  perform t10a_verify.expect_error(format('update public.tournament_matches set entry_two_id = entry_one_id where id = %L', m1.id), '23514', 'un participante no juega contra sí mismo');
  perform t10a_verify.expect_error(format('delete from public.tournament_entries where id = %L', m1.entry_one_id), '23503', 'una inscripción con partidos no se puede borrar');
  perform t10a_verify.expect((select convalidated from pg_constraint where conname = 'tournament_matches_next_target') is true, 'tournament_matches_next_target se conserva y está validada');
  raise notice 'OK 15: restricciones PostgreSQL';
end $$;

-- 16. Permisos y aislamiento por club
set local role authenticated;
do $$
declare cat uuid; cat_b uuid; m public.tournament_matches; b_club uuid := (select id from t10a_verify.ids where name = 'club_b'); a_club uuid := (select id from t10a_verify.ids where name = 'club_a'); t_b uuid; r public.tournament_matches; a_person uuid;
begin
  perform t10a_verify.as_user('owner_a');
  select id into a_person from public.club_people where club_id = a_club limit 1;
  cat := t10a_verify.make_category('Permisos', 'singles', 4);
  -- staff: no administra la estructura ni genera el fixture
  perform t10a_verify.as_user('staff_a');
  perform t10a_verify.expect_error(format('select public.create_tournament(%L, ''X'', null, current_date, current_date)', a_club), '42501', 'staff no crea torneos');
  perform t10a_verify.expect_error(format('select public.generate_tournament_fixture(%L)', cat), '42501', 'staff no genera fixtures');
  perform t10a_verify.expect_error(format('select public.create_tournament_entry(%L, array[(select id from public.club_people where full_name = ''A070'')])', cat), '42501', 'staff no inscribe');
  -- otro club: no ve ni opera
  perform t10a_verify.as_user('owner_b');
  perform t10a_verify.expect_error(format('select public.generate_tournament_fixture(%L)', cat), '42501', 'otro club no genera fixtures ajenos');
  perform t10a_verify.expect_error(format('select public.create_tournament_entry(%L, array[(select id from public.club_people where full_name = ''A070'')])', cat), '42501', 'otro club no inscribe en categorías ajenas');
  perform t10a_verify.expect((select count(*) from public.tournaments where club_id = a_club) = 0 and (select count(*) from public.tournament_categories where club_id = a_club) = 0 and (select count(*) from public.tournament_entries where club_id = a_club) = 0, 'otro club no lee torneos, categorías ni inscripciones ajenas');
  -- admin genera; staff y otro club frente al fixture existente
  perform t10a_verify.as_user('admin_a');
  perform public.generate_tournament_fixture(cat);
  select * into m from public.tournament_matches where category_id = cat and round_number = 1 and position = 1;
  perform t10a_verify.as_user('owner_b');
  perform t10a_verify.expect((select count(*) from public.tournament_matches where club_id = a_club) = 0, 'otro club no lee partidos ajenos (RLS)');
  perform t10a_verify.expect_error(format('select public.record_tournament_match_result(%L, %L)', m.id, m.entry_one_id), '42501', 'otro club no registra resultados ajenos');
  perform t10a_verify.expect_error(format('select public.schedule_tournament_match(%L, %L, now() + interval ''1 day'', now() + interval ''1 day 90 minutes'')', m.id, (select id from t10a_verify.ids where name = 'court_a')), '42501', 'otro club no programa partidos ajenos');
  perform t10a_verify.expect_error(format('select public.cancel_tournament_match_schedule(%L)', m.id), '42501', 'otro club no cancela programaciones ajenas');
  -- aislamiento propio del club B (no mezcla personas del club A)
  select id into t_b from public.create_tournament(b_club, 'Copa B', null, current_date, current_date + 1);
  perform public.update_tournament(t_b, 'Copa B', null, current_date, current_date + 1, 'registration_open');
  select id into cat_b from public.create_tournament_category(t_b, 'Singles B', 'singles');
  perform t10a_verify.expect_error(format('select public.create_tournament_entry(%L, array[%L::uuid])', cat_b, a_person), '23503', 'no se inscriben personas de otro club');
  -- staff: carga resultados y programa partidos; sin sesión no puede nada
  perform t10a_verify.as_user('staff_a');
  select * into r from public.record_tournament_match_result(m.id, m.entry_one_id, '6-3 6-3', false);
  perform t10a_verify.expect(r.status = 'completed', 'staff registra resultados');
  select * into m from public.tournament_matches where category_id = cat and round_number = 1 and position = 2;
  select * into r from public.schedule_tournament_match(m.id, (select id from t10a_verify.ids where name = 'court_a'), date_trunc('hour', now()) + interval '2 days', date_trunc('hour', now()) + interval '2 days 90 minutes');
  perform t10a_verify.expect(r.status = 'scheduled' and r.reservation_id is not null, 'staff programa partidos');
  perform t10a_verify.expect((select occupation_type from public.reservations where id = r.reservation_id) = 'tournament_match', 'la programación ocupa la cancha como tournament_match');
  select * into m from public.tournament_matches where category_id = cat and round_number = 2;
  perform t10a_verify.expect_error(format('select public.schedule_tournament_match(%L, %L, now() + interval ''1 day'', now() + interval ''1 day 90 minutes'')', m.id, (select id from t10a_verify.ids where name = 'court_a')), '22023', 'no se programa un partido sin ambos participantes');
  perform t10a_verify.expect_error(format('select public.record_tournament_match_result(%L, %L)', m.id, m.entry_one_id), '22023', 'la final sin rival no admite resultado (staff)');
  -- El flag de mutación vive por transacción (en producción, una por RPC); este script usa una sola, así que se reinicia.
  perform set_config('rafa_tenis.tournament_mutation', '', true);
  perform t10a_verify.expect_error(format('insert into public.reservations (club_id, court_id, starts_at, ends_at, status, occupation_type) values (%L, %L, now() + interval ''5 days'', now() + interval ''5 days 1 hour'', ''confirmed'', ''tournament_match'')', a_club, (select id from t10a_verify.ids where name = 'court_a')), '42501', 'no se crean ocupaciones de torneo fuera del módulo');
  perform t10a_verify.as_user('');
  perform t10a_verify.expect_error(format('select public.generate_tournament_fixture(%L)', cat), '42501', 'sin sesión no se genera fixture');
  perform t10a_verify.expect_error(format('select public.record_tournament_match_result(%L, %L)', m.id, m.entry_one_id), '42501', 'sin sesión no se registran resultados');
  raise notice 'OK 16: permisos y aislamiento por club';
end $$;

-- Rol anon: sin acceso alguno
reset role;
set local role anon;
do $$
begin
  perform t10a_verify.expect_error(format('select public.generate_tournament_fixture(%L)', gen_random_uuid()), '42501', 'anon no ejecuta generate_tournament_fixture');
  perform t10a_verify.expect_error('select count(*) from public.tournament_matches', '42501', 'anon no lee tournament_matches');
  raise notice 'OK 16b: anon sin acceso';
end $$;
reset role;

select count(*) as verificaciones_ok from t10a_verify.results;
rollback;
