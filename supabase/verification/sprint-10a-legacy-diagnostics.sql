-- Sprint 10A — DIAGNÓSTICO de solo lectura (apto para correr en producción con rol de lectura/SQL editor).
-- Lista filas de tournament_matches / tournament_categories que violan las garantías nuevas de la migración
-- 20261014010000_fix_tournament_fixture.sql. Sin resultados = nada que corregir. No modifica datos.
-- Si aparecen filas (posible solo si se cerró un partido con las funciones anteriores usando un ganador ajeno o sin rival),
-- corregirlas manualmente con criterio del club ANTES de ejecutar VALIDATE CONSTRAINT.
select m.category_id, m.id as match_id, m.round_number, m.position, p.problem
from public.tournament_matches m
cross join lateral (
  select 'ganador no participa en el partido' as problem
    where m.winner_entry_id is not null and m.winner_entry_id is distinct from m.entry_one_id and m.winner_entry_id is distinct from m.entry_two_id
  union all select 'partido finalizado sin ambos participantes'
    where m.status = 'completed' and (m.entry_one_id is null or m.entry_two_id is null)
  union all select 'participante o ganador de otra categoría'
    where exists (select 1 from unnest(array[m.entry_one_id, m.entry_two_id, m.winner_entry_id]) e(id) join public.tournament_entries te on te.id = e.id where te.category_id <> m.category_id)
  union all select 'partido siguiente inconsistente (otra categoría o ronda no inmediata)'
    where m.next_match_id is not null and not exists (select 1 from public.tournament_matches x where x.id = m.next_match_id and x.category_id = m.category_id and x.round_number = m.round_number + 1)
  union all select 'casillero del partido siguiente alimentado por más de un partido'
    where m.next_match_id is not null and (select count(*) from public.tournament_matches y where y.next_match_id = m.next_match_id and y.next_slot = m.next_slot) > 1
) p
union all
select c.id, null, null, null, 'campeón distinto del ganador de la final'
from public.tournament_categories c
where c.status = 'completed' and c.champion_entry_id is distinct from (select f.winner_entry_id from public.tournament_matches f where f.category_id = c.id and f.next_match_id is null)
order by 1, 3, 4;
