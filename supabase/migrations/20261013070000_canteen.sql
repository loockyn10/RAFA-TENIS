-- Sprint 08: cantina, ventas rápidas y consumos pendientes.
-- Requiere las migraciones 01–07. No ejecutar automáticamente en Supabase.

create table public.canteen_categories (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  name text not null check (char_length(trim(name)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, id)
);
create unique index canteen_categories_club_name_key on public.canteen_categories (club_id, lower(name));

create table public.canteen_products (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  category_id uuid not null,
  name text not null check (char_length(trim(name)) > 0),
  sale_price_cents bigint not null check (sale_price_cents > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canteen_products_category_belongs_to_club
    foreign key (club_id, category_id) references public.canteen_categories(club_id, id) on delete restrict,
  unique (club_id, id)
);
create index canteen_products_club_category_name_idx on public.canteen_products(club_id, category_id, name);
create index canteen_products_club_active_name_idx on public.canteen_products(club_id, active, name);

create table public.canteen_sales (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  customer_person_id uuid,
  total_cents bigint not null check (total_cents > 0),
  status text not null default 'confirmed' check (status in ('confirmed', 'voided')),
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete restrict,
  void_reason text,
  constraint canteen_sales_customer_belongs_to_club
    foreign key (club_id, customer_person_id) references public.club_people(club_id, id) on delete restrict,
  constraint canteen_sales_void_data_consistent check (
    (status = 'confirmed' and voided_at is null and voided_by is null and void_reason is null)
    or (status = 'voided' and voided_at is not null and voided_by is not null and char_length(trim(coalesce(void_reason, ''))) > 0)
  ),
  unique (club_id, client_request_id),
  unique (club_id, id)
);
create index canteen_sales_club_created_idx on public.canteen_sales(club_id, created_at desc);
create index canteen_sales_person_pending_idx on public.canteen_sales(club_id, customer_person_id, created_at desc) where status = 'confirmed' and customer_person_id is not null;

create table public.canteen_sale_items (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  sale_id uuid not null,
  product_id uuid not null,
  product_name_snapshot text not null check (char_length(trim(product_name_snapshot)) > 0),
  quantity integer not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents > 0),
  created_at timestamptz not null default now(),
  constraint canteen_sale_items_sale_belongs_to_club
    foreign key (club_id, sale_id) references public.canteen_sales(club_id, id) on delete restrict,
  constraint canteen_sale_items_product_belongs_to_club
    foreign key (club_id, product_id) references public.canteen_products(club_id, id) on delete restrict,
  unique (sale_id, product_id)
);
create index canteen_sale_items_sale_idx on public.canteen_sale_items(sale_id);

create table public.canteen_sale_payments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  sale_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  payment_date date not null,
  payment_method text not null check (payment_method in ('cash', 'bank_transfer', 'mercado_pago', 'other')),
  reference text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  constraint canteen_sale_payments_sale_belongs_to_club
    foreign key (club_id, sale_id) references public.canteen_sales(club_id, id) on delete restrict
);
create index canteen_sale_payments_sale_idx on public.canteen_sale_payments(sale_id, payment_date, created_at);
create index canteen_sale_payments_club_date_idx on public.canteen_sale_payments(club_id, payment_date);

create or replace function private.can_manage_canteen_catalog(target_club_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog
as $$
  select exists (select 1 from public.club_staff
    where club_id = target_club_id and auth_user_id = (select auth.uid())
      and role in ('owner'::public.club_staff_role, 'admin'::public.club_staff_role));
$$;

create or replace function private.set_canteen_updated_at()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$ begin new.updated_at := now(); return new; end; $$;

create trigger canteen_categories_set_updated_at before update on public.canteen_categories for each row execute function private.set_canteen_updated_at();
create trigger canteen_products_set_updated_at before update on public.canteen_products for each row execute function private.set_canteen_updated_at();

-- p_items is an array of { product_id: uuid, quantity: positive integer }. The client never supplies prices.
create or replace function public.create_canteen_sale(
  p_club_id uuid,
  p_items jsonb,
  p_customer_person_id uuid default null,
  p_payment_method text default null,
  p_client_request_id uuid default gen_random_uuid()
) returns public.canteen_sales language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_sale public.canteen_sales; v_total bigint; v_item jsonb; v_product public.canteen_products; v_quantity integer;
begin
  if auth.uid() is null or not private.is_club_member(p_club_id) then
    raise exception 'No tenés permiso para registrar ventas en este club.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe incluir al menos un producto.' using errcode = '22023';
  end if;
  if p_payment_method is not null and p_payment_method not in ('cash', 'bank_transfer', 'mercado_pago', 'other') then
    raise exception 'El medio de pago no es válido.' using errcode = '22023';
  end if;
  if p_payment_method is null and p_customer_person_id is null then
    raise exception 'Seleccioná una persona para dejar un consumo pendiente.' using errcode = '22023';
  end if;
  if p_customer_person_id is not null and not exists (select 1 from public.club_people where club_id = p_club_id and id = p_customer_person_id) then
    raise exception 'La persona no pertenece a este club.' using errcode = '23503';
  end if;
  -- The unique key makes a retry of the same request idempotent.
  select * into v_sale from public.canteen_sales where club_id = p_club_id and client_request_id = p_client_request_id;
  if found then return v_sale; end if;
  create temporary table canteen_sale_draft(product_id uuid primary key, quantity integer not null) on commit drop;
  for v_item in select value from jsonb_array_elements(p_items) loop
    begin v_quantity := (v_item->>'quantity')::integer; exception when others then raise exception 'La cantidad de un producto no es válida.' using errcode = '22023'; end;
    if v_quantity <= 0 or nullif(v_item->>'product_id', '') is null then raise exception 'La cantidad de un producto no es válida.' using errcode = '22023'; end if;
    begin insert into canteen_sale_draft(product_id, quantity) values ((v_item->>'product_id')::uuid, v_quantity); exception when unique_violation then raise exception 'Un producto fue repetido en la venta.' using errcode = '22023'; end;
  end loop;
  -- Prevent a catalog price change between calculating the total and snapshotting item prices.
  perform 1 from public.canteen_products p join canteen_sale_draft d on d.product_id = p.id
  where p.club_id = p_club_id and p.active for share;
  select coalesce(sum(p.sale_price_cents * d.quantity), 0) into v_total
  from canteen_sale_draft d join public.canteen_products p on p.id = d.product_id and p.club_id = p_club_id and p.active;
  if v_total <= 0 or (select count(*) from canteen_sale_draft) <> (select count(*) from canteen_sale_draft d join public.canteen_products p on p.id = d.product_id and p.club_id = p_club_id and p.active) then
    raise exception 'Uno de los productos no está disponible en este club.' using errcode = '23503';
  end if;
  insert into public.canteen_sales(club_id, customer_person_id, total_cents, client_request_id, created_by)
  values (p_club_id, p_customer_person_id, v_total, p_client_request_id, auth.uid()) returning * into v_sale;
  insert into public.canteen_sale_items(club_id, sale_id, product_id, product_name_snapshot, quantity, unit_price_cents)
  select p_club_id, v_sale.id, p.id, p.name, d.quantity, p.sale_price_cents
  from canteen_sale_draft d join public.canteen_products p on p.id = d.product_id and p.club_id = p_club_id;
  if p_payment_method is not null then
    insert into public.canteen_sale_payments(club_id, sale_id, amount_cents, payment_date, payment_method, created_by)
    values (p_club_id, v_sale.id, v_total, (now() at time zone 'America/Argentina/Buenos_Aires')::date, p_payment_method, auth.uid());
  end if;
  return v_sale;
exception when unique_violation then
  -- A concurrent retry may hit the idempotency key after the first transaction commits.
  select * into v_sale from public.canteen_sales where club_id = p_club_id and client_request_id = p_client_request_id;
  if found then return v_sale; end if;
  raise;
end; $$;

create or replace function public.record_canteen_sale_payment(
  p_club_id uuid, p_sale_id uuid, p_amount_cents bigint, p_payment_date date, p_payment_method text, p_reference text default null, p_notes text default null
) returns public.canteen_sale_payments language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_sale public.canteen_sales; v_paid bigint; v_payment public.canteen_sale_payments;
begin
  if auth.uid() is null or not private.is_club_member(p_club_id) then raise exception 'No tenés permiso para registrar pagos de cantina en este club.' using errcode = '42501'; end if;
  if p_amount_cents <= 0 or p_payment_date is null or p_payment_method not in ('cash', 'bank_transfer', 'mercado_pago', 'other') then raise exception 'El pago no tiene datos válidos.' using errcode = '22023'; end if;
  select * into v_sale from public.canteen_sales where id = p_sale_id and club_id = p_club_id for update;
  if not found or v_sale.status <> 'confirmed' then raise exception 'La venta no está disponible para cobrar.' using errcode = '23503'; end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.canteen_sale_payments where sale_id = v_sale.id;
  if p_amount_cents > v_sale.total_cents - v_paid then raise exception 'El importe supera el saldo pendiente de la venta.' using errcode = '22023'; end if;
  insert into public.canteen_sale_payments(club_id, sale_id, amount_cents, payment_date, payment_method, reference, notes, created_by)
  values (p_club_id, v_sale.id, p_amount_cents, p_payment_date, p_payment_method, nullif(trim(coalesce(p_reference, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), auth.uid()) returning * into v_payment;
  return v_payment;
end; $$;

create or replace function public.void_canteen_sale(p_sale_id uuid, p_reason text)
returns public.canteen_sales language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_sale public.canteen_sales;
begin
  select * into v_sale from public.canteen_sales where id = p_sale_id for update;
  if not found then raise exception 'La venta no existe.' using errcode = '23503'; end if;
  if auth.uid() is null or not private.can_manage_canteen_catalog(v_sale.club_id) then raise exception 'No tenés permiso para anular ventas.' using errcode = '42501'; end if;
  if v_sale.status <> 'confirmed' then raise exception 'La venta ya fue anulada.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Indicá el motivo de la anulación.' using errcode = '22023'; end if;
  if exists (select 1 from public.canteen_sale_payments where sale_id = v_sale.id) then raise exception 'No se puede anular una venta que tiene pagos registrados.' using errcode = '22023'; end if;
  update public.canteen_sales set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason) where id = v_sale.id returning * into v_sale;
  return v_sale;
end; $$;

alter table public.canteen_categories enable row level security;
alter table public.canteen_products enable row level security;
alter table public.canteen_sales enable row level security;
alter table public.canteen_sale_items enable row level security;
alter table public.canteen_sale_payments enable row level security;
create policy "club members read canteen categories" on public.canteen_categories for select to authenticated using (private.is_club_member(club_id));
create policy "managers write canteen categories" on public.canteen_categories for all to authenticated using (private.can_manage_canteen_catalog(club_id)) with check (private.can_manage_canteen_catalog(club_id));
create policy "club members read canteen products" on public.canteen_products for select to authenticated using (private.is_club_member(club_id));
create policy "managers write canteen products" on public.canteen_products for all to authenticated using (private.can_manage_canteen_catalog(club_id)) with check (private.can_manage_canteen_catalog(club_id));
create policy "club members read canteen sales" on public.canteen_sales for select to authenticated using (private.is_club_member(club_id));
create policy "club members read canteen sale items" on public.canteen_sale_items for select to authenticated using (private.is_club_member(club_id));
create policy "club members read canteen payments" on public.canteen_sale_payments for select to authenticated using (private.is_club_member(club_id));
revoke all on table public.canteen_categories, public.canteen_products, public.canteen_sales, public.canteen_sale_items, public.canteen_sale_payments from anon, authenticated;
grant select, insert, update on public.canteen_categories, public.canteen_products to authenticated;
grant select on public.canteen_sales, public.canteen_sale_items, public.canteen_sale_payments to authenticated;
revoke all on function private.can_manage_canteen_catalog(uuid), private.set_canteen_updated_at() from public;
grant execute on function private.can_manage_canteen_catalog(uuid) to authenticated;
revoke all on function public.create_canteen_sale(uuid, jsonb, uuid, text, uuid), public.record_canteen_sale_payment(uuid, uuid, bigint, date, text, text, text), public.void_canteen_sale(uuid, text) from public;
grant execute on function public.create_canteen_sale(uuid, jsonb, uuid, text, uuid), public.record_canteen_sale_payment(uuid, uuid, bigint, date, text, text, text), public.void_canteen_sale(uuid, text) to authenticated;
