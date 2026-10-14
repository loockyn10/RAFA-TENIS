-- Sprint 10A — comprueba que la migración preservó los fixtures existentes y que siguen siendo jugables. Solo base descartable.
\set ON_ERROR_STOP on
do $$
declare bad int;
begin
  select count(*) into bad from public.legacy_snapshot s
  join (select c.name, md5(string_agg(concat_ws('|', m.id, m.round_number, m.position, m.entry_one_id, m.entry_two_id, m.winner_entry_id, m.next_match_id, m.next_slot, m.status, m.score_text), ';' order by m.round_number, m.position)) fp
        from public.tournament_categories c join public.tournament_matches m on m.category_id = c.id group by c.name) now_ on now_.name = s.category_name
  where now_.fp <> s.fingerprint;
  if bad <> 0 then raise exception 'FALLO: la migración alteró % fixtures existentes', bad; end if;
  raise notice 'OK: los fixtures existentes quedaron intactos (huella idéntica)';
end $$;

-- Los fixtures existentes siguen siendo jugables con las funciones nuevas (incluido L6, cuya ronda 2 se jugó antes que la ronda 1).
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000010d1', false);
do $$
declare cat record; m public.tournament_matches; played int;
begin
  for cat in select id, name from public.tournament_categories where name in ('L3', 'L4', 'L6') order by name loop
    played := 0;
    loop
      select * into m from public.tournament_matches where category_id = cat.id and status = 'pending' and entry_one_id is not null and entry_two_id is not null order by round_number, position limit 1;
      exit when not found;
      perform public.record_tournament_match_result(m.id, m.entry_two_id, '6-4 6-4', false); played := played + 1;
    end loop;
    if (select status from public.tournament_categories where id = cat.id) <> 'completed' or (select champion_entry_id from public.tournament_categories where id = cat.id) is null then
      raise exception 'FALLO: la categoría legada % no pudo completarse (% partidos jugados)', cat.name, played;
    end if;
  end loop;
  raise notice 'OK: los fixtures legados L3, L4 y L6 se completaron con campeón tras la migración';
end $$;
reset role;
