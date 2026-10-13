-- Ejecutar solo desde una sesión administrativa de Supabase, después de aplicar la migración.
-- Reemplazar exactamente el UUID siguiente por el ID real creado en Authentication > Users.
-- No ejecutar desde el navegador ni exponer este UUID como un secreto de aplicación.

begin;

do $$
declare
  v_owner_user_id uuid := 'REPLACE_WITH_AUTH_USER_UUID';
  v_club_id uuid;
  v_existing_court_count integer;
begin
  if not exists (select 1 from auth.users where id = v_owner_user_id) then
    raise exception 'El usuario de Auth indicado no existe.';
  end if;

  insert into public.clubs (name, timezone)
  values ('Rafa Tenis', 'America/Argentina/Buenos_Aires')
  on conflict (name) do update set timezone = excluded.timezone
  returning id into v_club_id;

  insert into public.club_staff (club_id, auth_user_id, role)
  values (v_club_id, v_owner_user_id, 'owner')
  on conflict (club_id, auth_user_id) do update set role = excluded.role;

  select count(*) into v_existing_court_count
  from public.courts
  where club_id = v_club_id;

  if v_existing_court_count = 0 then
    insert into public.courts (club_id, name, surface, active, display_order)
    values
      (v_club_id, 'Cancha 1', 'Polvo de ladrillo', true, 1),
      (v_club_id, 'Cancha 2', 'Polvo de ladrillo', true, 2),
      (v_club_id, 'Cancha 3', 'Polvo de ladrillo', true, 3),
      (v_club_id, 'Cancha 4', 'Polvo de ladrillo', true, 4),
      (v_club_id, 'Cancha 5', 'Polvo de ladrillo', true, 5),
      (v_club_id, 'Cancha 6', 'Polvo de ladrillo', true, 6);
  elsif v_existing_court_count <> 6 then
    raise exception 'El club ya tiene % canchas. No se modifica para evitar duplicar o pisar datos.', v_existing_court_count;
  end if;
end;
$$;

commit;

-- Verificación posterior esperada: un club, seis canchas y una membresía owner.
select c.name, c.timezone, count(ct.id) as courts
from public.clubs c
left join public.courts ct on ct.club_id = c.id
where c.name = 'Rafa Tenis'
group by c.id, c.name, c.timezone;
