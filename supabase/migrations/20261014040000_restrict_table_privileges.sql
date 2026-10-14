-- Sprint 10B.1 / SEC-03: mínimo privilegio de tabla para authenticated en clubs, club_staff, courts y catálogo de cantina.
-- Dependencias: 20261013000000 (clubs, club_staff, courts) y 20261013070000 (catálogo de cantina). Independiente de las demás 10B.1.
-- Antes, authenticated conservaba INSERT/UPDATE/DELETE/TRUNCATE por defecto de Supabase y UPDATE de todas las columnas
-- (courts.club_id, created_at; club_id de categorías/productos). RLS seguía limitando por club, pero un admin de dos
-- clubes podía reasignar canchas/productos entre clubes.
-- Frontend: CanteenPanel.tsx deja de enviar club_id en los UPDATE (cambio compatible con los grants viejos y nuevos:
-- desplegar el frontend ANTES o junto con esta migración).
-- No cambia RLS ni datos. El bootstrap (rol postgres) y service_role no se ven afectados.

revoke all on table public.clubs, public.club_staff, public.courts, public.canteen_categories, public.canteen_products from anon, authenticated;

grant select on table public.clubs, public.club_staff, public.courts, public.canteen_categories, public.canteen_products to authenticated;
-- Canchas: se editan solo los campos configurables; no hay alta/baja desde la app.
grant update (name, surface, active, display_order) on table public.courts to authenticated;
-- Catálogo: alta y edición por columna; club_id solo se fija al insertar y nunca se actualiza.
grant insert (club_id, name, active), update (name, active) on table public.canteen_categories to authenticated;
grant insert (club_id, category_id, name, sale_price_cents, active), update (category_id, name, sale_price_cents, active) on table public.canteen_products to authenticated;

-- Segunda barrera independiente de GRANT/RLS: club_id es inmutable aunque se vuelva a conceder UPDATE.
create or replace function private.prevent_club_id_change()
returns trigger language plpgsql set search_path = pg_catalog
as $$
begin
  if new.club_id is distinct from old.club_id then
    raise exception 'No se puede reasignar un registro a otro club.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_club_id_change() from public, anon;

create trigger courts_prevent_club_id_change before update of club_id on public.courts for each row execute function private.prevent_club_id_change();
create trigger canteen_categories_prevent_club_id_change before update of club_id on public.canteen_categories for each row execute function private.prevent_club_id_change();
create trigger canteen_products_prevent_club_id_change before update of club_id on public.canteen_products for each row execute function private.prevent_club_id_change();
