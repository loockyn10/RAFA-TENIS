-- Sprint 10A — datos "existentes" generados con las funciones ANTERIORES a la migración (COMMIT). Solo base descartable.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000010d1', 'owner-d@test');
insert into public.clubs (id, name) values ('c0000000-0000-0000-0000-0000000010dd', 'Club 10A-D (legado)');
insert into public.club_staff (club_id, auth_user_id, role) values ('c0000000-0000-0000-0000-0000000010dd', '00000000-0000-0000-0000-0000000010d1', 'owner');
insert into public.club_people (club_id, full_name) select 'c0000000-0000-0000-0000-0000000010dd', 'D' || lpad(g::text, 3, '0') from generate_series(1, 30) g;
create table public.legacy_snapshot (category_name text primary key, fingerprint text not null);
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000010d1', false);
do $$
declare
  t uuid; cat uuid; n int; i int; names text[] := array['L3', 'L4', 'L6', 'L3 corrupto']; counts int[] := array[3, 4, 6, 3]; k int; m public.tournament_matches; people uuid[];
begin
  select array_agg(id order by full_name) into people from public.club_people where club_id = 'c0000000-0000-0000-0000-0000000010dd';
  select id into t from public.create_tournament('c0000000-0000-0000-0000-0000000010dd', 'Torneo legado', null, current_date, current_date + 7);
  perform public.update_tournament(t, 'Torneo legado', null, current_date, current_date + 7, 'registration_open');
  for k in 1..4 loop
    select id into cat from public.create_tournament_category(t, names[k], 'singles');
    for i in 1..counts[k] loop perform public.create_tournament_entry(cat, array[people[i]]); end loop;
    perform public.generate_tournament_fixture(cat);
  end loop;
  -- L4: se juega un partido de ronda 1
  select * into m from public.tournament_matches where category_id = (select id from public.tournament_categories where name = 'L4') and round_number = 1 and position = 1;
  perform public.record_tournament_match_result(m.id, m.entry_one_id, '6-2 6-2', false);
  -- L6: se juega primero el partido de ronda 2 entre pases libres (válido con las funciones anteriores)
  select * into m from public.tournament_matches where category_id = (select id from public.tournament_categories where name = 'L6') and round_number = 2 and entry_one_id is not null and entry_two_id is not null;
  perform public.record_tournament_match_result(m.id, m.entry_one_id, '6-0 6-0', false);
  -- L3 corrupto: reproduce el defecto histórico (final cerrada con una inscripción ajena y sin rival)
  select * into m from public.tournament_matches where category_id = (select id from public.tournament_categories where name = 'L3 corrupto') and round_number = 2;
  perform public.record_tournament_match_result(m.id, (select id from public.tournament_entries where category_id = (select id from public.tournament_categories where name = 'L3') limit 1), 'corrupto', false);
end $$;
reset role;
insert into public.legacy_snapshot
select c.name, md5(string_agg(concat_ws('|', m.id, m.round_number, m.position, m.entry_one_id, m.entry_two_id, m.winner_entry_id, m.next_match_id, m.next_slot, m.status, m.score_text), ';' order by m.round_number, m.position))
from public.tournament_categories c join public.tournament_matches m on m.category_id = c.id
where c.club_id = 'c0000000-0000-0000-0000-0000000010dd' group by c.name;
