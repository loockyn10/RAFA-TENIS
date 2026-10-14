-- Sprint 10A — datos confirmados (COMMIT) para la prueba de concurrencia del runner. Solo base descartable.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000010c1', 'owner-c@test');
insert into public.clubs (id, name) values ('c0000000-0000-0000-0000-0000000010cc', 'Club 10A-C');
insert into public.club_staff (club_id, auth_user_id, role) values ('c0000000-0000-0000-0000-0000000010cc', '00000000-0000-0000-0000-0000000010c1', 'owner');
insert into public.club_people (club_id, full_name) select 'c0000000-0000-0000-0000-0000000010cc', 'C' || lpad(g::text, 3, '0') from generate_series(1, 8) g;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000010c1', false);
do $$
declare t uuid; cat uuid; p uuid;
begin
  select id into t from public.create_tournament('c0000000-0000-0000-0000-0000000010cc', 'Torneo concurrencia', null, current_date, current_date + 1);
  perform public.update_tournament(t, 'Torneo concurrencia', null, current_date, current_date + 1, 'registration_open');
  select id into cat from public.create_tournament_category(t, 'Concurrencia', 'singles');
  for p in select id from public.club_people where club_id = 'c0000000-0000-0000-0000-0000000010cc' loop
    perform public.create_tournament_entry(cat, array[p]);
  end loop;
end $$;
