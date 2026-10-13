-- Sprint 05: cuotas sociales y pagos manuales. Requiere migraciones 01–04.
-- No ejecutar automáticamente en Supabase.

alter table public.club_memberships
  add constraint club_memberships_club_id_id_key unique (club_id, id);

create table public.club_fee_settings (
  club_id uuid primary key references public.clubs(id) on delete restrict,
  monthly_amount_cents bigint not null check (monthly_amount_cents > 0),
  due_day smallint not null check (due_day between 1 and 28),
  currency text not null default 'ARS' check (currency = 'ARS'),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict
);

create table public.membership_dues (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  membership_id uuid not null,
  period date not null check (period = date_trunc('month', period)::date),
  amount_cents bigint not null check (amount_cents > 0),
  due_date date not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  constraint membership_dues_membership_belongs_to_club
    foreign key (club_id, membership_id) references public.club_memberships (club_id, id) on delete restrict,
  unique (club_id, membership_id, period)
);

create index membership_dues_club_period_idx on public.membership_dues (club_id, period, due_date);
create index membership_dues_membership_period_idx on public.membership_dues (membership_id, period desc);

create table public.membership_due_payments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  due_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  payment_date date not null,
  payment_method text not null check (payment_method in ('cash', 'bank_transfer', 'mercado_pago', 'other')),
  reference text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete restrict,
  void_reason text,
  constraint membership_due_payments_due_belongs_to_club
    foreign key (club_id, due_id) references public.membership_dues (club_id, id) on delete restrict,
  constraint membership_due_payments_void_data_consistent check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and char_length(trim(coalesce(void_reason, ''))) > 0)
  )
);

create index membership_due_payments_due_valid_idx on public.membership_due_payments (due_id, payment_date, created_at) where voided_at is null;
create index membership_due_payments_club_idx on public.membership_due_payments (club_id, due_id);

create or replace function private.can_manage_finances(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.club_staff
    where club_id = target_club_id
      and auth_user_id = (select auth.uid())
      and role in ('owner'::public.club_staff_role, 'admin'::public.club_staff_role)
  );
$$;

create or replace function private.set_club_fee_settings_updated_at()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger club_fee_settings_set_updated_at
before update on public.club_fee_settings
for each row execute function private.set_club_fee_settings_updated_at();

create or replace function public.set_club_fee_settings(
  p_club_id uuid,
  p_monthly_amount_cents bigint,
  p_due_day smallint
)
returns public.club_fee_settings
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_result public.club_fee_settings;
begin
  if auth.uid() is null or not private.can_manage_finances(p_club_id) then
    raise exception 'No tenés permiso para configurar cuotas en este club.' using errcode = '42501';
  end if;
  if p_monthly_amount_cents <= 0 or p_due_day not between 1 and 28 then
    raise exception 'La configuración de cuota no es válida.' using errcode = '22023';
  end if;
  insert into public.club_fee_settings (club_id, monthly_amount_cents, due_day, updated_by)
  values (p_club_id, p_monthly_amount_cents, p_due_day, auth.uid())
  on conflict (club_id) do update
  set monthly_amount_cents = excluded.monthly_amount_cents,
      due_day = excluded.due_day
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.generate_membership_dues(
  p_club_id uuid,
  p_period date
)
returns table (created_count integer, existing_count integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_settings public.club_fee_settings;
begin
  if auth.uid() is null or not private.can_manage_finances(p_club_id) then
    raise exception 'No tenés permiso para generar cuotas en este club.' using errcode = '42501';
  end if;
  if p_period <> date_trunc('month', p_period)::date then
    raise exception 'El período debe ser el primer día del mes.' using errcode = '22023';
  end if;
  select * into v_settings from public.club_fee_settings where club_id = p_club_id for share;
  if not found then
    raise exception 'Configurá el importe y vencimiento de la cuota antes de generarla.' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select id from public.club_memberships
    where club_id = p_club_id and status = 'active'
  ), inserted as (
    insert into public.membership_dues (club_id, membership_id, period, amount_cents, due_date, created_by)
    select p_club_id, id, p_period, v_settings.monthly_amount_cents,
      (p_period + (v_settings.due_day - 1) * interval '1 day')::date, auth.uid()
    from candidates
    on conflict (club_id, membership_id, period) do nothing
    returning id
  )
  select (select count(*)::integer from inserted),
    (select count(*)::integer from candidates) - (select count(*)::integer from inserted);
end;
$$;

create or replace function public.create_individual_membership_due(
  p_club_id uuid,
  p_membership_id uuid,
  p_period date,
  p_amount_cents bigint default null
)
returns public.membership_dues
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_settings public.club_fee_settings; v_due public.membership_dues; v_membership public.club_memberships;
begin
  if auth.uid() is null or not private.can_manage_finances(p_club_id) then
    raise exception 'No tenés permiso para emitir cuotas en este club.' using errcode = '42501';
  end if;
  if p_period <> date_trunc('month', p_period)::date or coalesce(p_amount_cents, 1) <= 0 then
    raise exception 'Los datos de la cuota no son válidos.' using errcode = '22023';
  end if;
  select * into v_membership from public.club_memberships where club_id = p_club_id and id = p_membership_id for share;
  if not found or v_membership.status <> 'active' then
    raise exception 'Solo se puede emitir una cuota para un socio activo de este club.' using errcode = '22023';
  end if;
  select * into v_settings from public.club_fee_settings where club_id = p_club_id;
  if not found then raise exception 'Configurá la cuota mensual antes de emitirla.' using errcode = '22023'; end if;
  insert into public.membership_dues (club_id, membership_id, period, amount_cents, due_date, created_by)
  values (p_club_id, p_membership_id, p_period, coalesce(p_amount_cents, v_settings.monthly_amount_cents),
    (p_period + (v_settings.due_day - 1) * interval '1 day')::date, auth.uid())
  returning * into v_due;
  return v_due;
exception when unique_violation then
  raise exception 'Ya existe una cuota para este socio y período.' using errcode = '23505';
end;
$$;

create or replace function public.record_membership_due_payment(
  p_club_id uuid,
  p_due_id uuid,
  p_amount_cents bigint,
  p_payment_date date,
  p_payment_method text,
  p_reference text default null,
  p_notes text default null
)
returns public.membership_due_payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_due public.membership_dues; v_paid bigint; v_payment public.membership_due_payments;
begin
  if auth.uid() is null or not private.can_manage_finances(p_club_id) then
    raise exception 'No tenés permiso para registrar pagos en este club.' using errcode = '42501';
  end if;
  if p_amount_cents <= 0 or p_payment_date is null or p_payment_method not in ('cash', 'bank_transfer', 'mercado_pago', 'other') then
    raise exception 'El pago no tiene datos válidos.' using errcode = '22023';
  end if;
  select * into v_due from public.membership_dues where id = p_due_id and club_id = p_club_id for update;
  if not found then raise exception 'La cuota no existe en este club.' using errcode = '23503'; end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.membership_due_payments where due_id = v_due.id and voided_at is null;
  if p_amount_cents > v_due.amount_cents - v_paid then
    raise exception 'El importe supera el saldo pendiente de la cuota.' using errcode = '22023';
  end if;
  insert into public.membership_due_payments (club_id, due_id, amount_cents, payment_date, payment_method, reference, notes, created_by)
  values (p_club_id, v_due.id, p_amount_cents, p_payment_date, p_payment_method,
    nullif(trim(coalesce(p_reference, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning * into v_payment;
  return v_payment;
end;
$$;

create or replace function public.void_membership_due_payment(p_payment_id uuid, p_reason text)
returns public.membership_due_payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_payment public.membership_due_payments;
begin
  select * into v_payment from public.membership_due_payments where id = p_payment_id for update;
  if not found then raise exception 'El pago no existe.' using errcode = '23503'; end if;
  if auth.uid() is null or not private.can_manage_finances(v_payment.club_id) then
    raise exception 'No tenés permiso para anular pagos en este club.' using errcode = '42501';
  end if;
  if v_payment.voided_at is not null then raise exception 'El pago ya fue anulado.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Indicá el motivo de la anulación.' using errcode = '22023'; end if;
  -- Serializa la anulación con cualquier cobro nuevo sobre la misma obligación.
  perform 1 from public.membership_dues where id = v_payment.due_id for update;
  update public.membership_due_payments set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
  where id = v_payment.id returning * into v_payment;
  return v_payment;
end;
$$;

revoke all on function private.can_manage_finances(uuid) from public;
revoke all on function private.set_club_fee_settings_updated_at() from public;
grant execute on function private.can_manage_finances(uuid) to authenticated;
revoke all on function public.set_club_fee_settings(uuid, bigint, smallint) from public;
revoke all on function public.generate_membership_dues(uuid, date) from public;
revoke all on function public.create_individual_membership_due(uuid, uuid, date, bigint) from public;
revoke all on function public.record_membership_due_payment(uuid, uuid, bigint, date, text, text, text) from public;
revoke all on function public.void_membership_due_payment(uuid, text) from public;
grant execute on function public.set_club_fee_settings(uuid, bigint, smallint) to authenticated;
grant execute on function public.generate_membership_dues(uuid, date) to authenticated;
grant execute on function public.create_individual_membership_due(uuid, uuid, date, bigint) to authenticated;
grant execute on function public.record_membership_due_payment(uuid, uuid, bigint, date, text, text, text) to authenticated;
grant execute on function public.void_membership_due_payment(uuid, text) to authenticated;

alter table public.club_fee_settings enable row level security;
alter table public.membership_dues enable row level security;
alter table public.membership_due_payments enable row level security;
create policy "owners and admins can read fee settings" on public.club_fee_settings for select to authenticated using (private.can_manage_finances(club_id));
create policy "owners and admins can read membership dues" on public.membership_dues for select to authenticated using (private.can_manage_finances(club_id));
create policy "owners and admins can read membership due payments" on public.membership_due_payments for select to authenticated using (private.can_manage_finances(club_id));
revoke all on table public.club_fee_settings, public.membership_dues, public.membership_due_payments from anon;
revoke all on table public.club_fee_settings, public.membership_dues, public.membership_due_payments from authenticated;
grant select on table public.club_fee_settings, public.membership_dues, public.membership_due_payments to authenticated;
