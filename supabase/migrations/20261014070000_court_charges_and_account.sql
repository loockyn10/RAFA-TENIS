-- Sprint 14: cobros de canchas e iluminación + cuenta corriente consolidada por persona.
-- Requiere las migraciones 01–10B.2 (reservas, personas, cuotas, cantina, idempotencia). No ejecutar automáticamente en Supabase.
--
-- Principios (docs/CURRENT_STATE.md, "Sprint 14"):
--   * Reserva, uso y cobro siguen separados: crear una reserva NO genera deuda. El cargo se confirma a mano desde administración.
--   * Un cargo = UN responsable (persona del club) y UN importe por cancha/tiempo (no por cantidad de jugadores).
--   * Solo reservas comunes (occupation_type = 'reservation', confirmadas). Clases, bloqueos y partidos de torneo quedan fuera.
--   * Las tarifas son configuración por club, sin valores por defecto. Cada cargo CONGELA tarifa, criterio y cálculo: cambiar
--     la tarifa después no toca importes históricos. El importe final puede ajustarse a mano (owner/admin, con motivo).
--   * Importes enteros en centavos ARS. Pagos parciales/completos, sobrepago imposible (candado de fila), anulación con motivo
--     (sin borrado), idempotencia por (club_id, client_request_id) con huella de contenido, igual que 10B.2.
--   * La cuenta corriente NO es un libro nuevo: get_person_account() solo LEE cuotas, cantina y cargos de cancha existentes.
--   * Permisos: owner/admin (private.can_manage_finances), como cuotas. Staff no ve ni opera estos cobros.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Tarifas por club (vigentes) e historial append-only de sus cambios
-- ---------------------------------------------------------------------------------------------------------------
create table public.club_court_rate_settings (
  club_id uuid primary key references public.clubs(id) on delete restrict,
  rental_hour_cents bigint check (rental_hour_cents is null or rental_hour_cents > 0),
  lighting_hour_cents bigint check (lighting_hour_cents is null or lighting_hour_cents > 0),
  rental_enabled boolean not null default false,
  lighting_enabled boolean not null default false,
  billing_mode text not null default 'exact' check (billing_mode in ('exact', 'rounded_up')),
  billing_block_minutes smallint check (billing_block_minutes is null or billing_block_minutes in (15, 30, 60)),
  currency text not null default 'ARS' check (currency = 'ARS'),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  constraint court_rates_enabled_need_price check (
    (not rental_enabled or rental_hour_cents is not null) and (not lighting_enabled or lighting_hour_cents is not null)
  ),
  constraint court_rates_block_matches_mode check (
    (billing_mode = 'exact' and billing_block_minutes is null) or (billing_mode = 'rounded_up' and billing_block_minutes is not null)
  )
);

create table public.club_court_rate_history (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  rental_hour_cents bigint,
  lighting_hour_cents bigint,
  rental_enabled boolean not null,
  lighting_enabled boolean not null,
  billing_mode text not null,
  billing_block_minutes smallint,
  changed_at timestamptz not null default now(),
  changed_by uuid not null references auth.users(id) on delete restrict
);
create index club_court_rate_history_club_idx on public.club_court_rate_history (club_id, changed_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Cargos de cancha/iluminación y sus pagos
-- ---------------------------------------------------------------------------------------------------------------
create table public.court_charges (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  reservation_id uuid not null,
  responsible_person_id uuid not null,
  responsible_name_snapshot text not null check (char_length(trim(responsible_name_snapshot)) > 0),
  member_status text not null check (member_status in ('member', 'non_member')),
  billable_minutes integer not null check (billable_minutes between 1 and 1440),
  rental_applied boolean not null,
  lighting_applied boolean not null,
  -- Congelados al registrar el cargo (NULL si ese concepto se cargó solo con importe manual sin tarifa activa).
  rental_hour_cents_snapshot bigint,
  lighting_hour_cents_snapshot bigint,
  billing_mode_snapshot text not null check (billing_mode_snapshot in ('exact', 'rounded_up')),
  billing_block_minutes_snapshot smallint,
  calculated_rental_cents bigint check (calculated_rental_cents is null or calculated_rental_cents >= 0),
  calculated_lighting_cents bigint check (calculated_lighting_cents is null or calculated_lighting_cents >= 0),
  rental_cents bigint not null check (rental_cents >= 0),
  lighting_cents bigint not null check (lighting_cents >= 0),
  total_cents bigint generated always as (rental_cents + lighting_cents) stored,
  adjustment_reason text,
  notes text,
  status text not null default 'confirmed' check (status in ('confirmed', 'voided')),
  client_request_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete restrict,
  void_reason text,
  constraint court_charges_reservation_belongs_to_club
    foreign key (club_id, reservation_id) references public.reservations (club_id, id) on delete restrict,
  constraint court_charges_person_belongs_to_club
    foreign key (club_id, responsible_person_id) references public.club_people (club_id, id) on delete restrict,
  constraint court_charges_has_amount check (rental_cents + lighting_cents > 0),
  constraint court_charges_applied_matches_amount check ((rental_applied = (rental_cents > 0)) and (lighting_applied = (lighting_cents > 0))),
  constraint court_charges_adjustment_needs_reason check (
    not ((rental_applied and rental_cents is distinct from calculated_rental_cents)
      or (lighting_applied and lighting_cents is distinct from calculated_lighting_cents))
    or char_length(trim(coalesce(adjustment_reason, ''))) > 0
  ),
  constraint court_charges_void_data_consistent check (
    (status = 'confirmed' and voided_at is null and voided_by is null and void_reason is null)
    or (status = 'voided' and voided_at is not null and voided_by is not null and char_length(trim(coalesce(void_reason, ''))) > 0)
  ),
  constraint court_charges_club_request_key unique (club_id, client_request_id),
  constraint court_charges_club_id_id_key unique (club_id, id)
);
-- Una reserva tiene como máximo UN cargo vigente: evita deuda duplicada aun si dos pantallas cargan a la vez.
create unique index court_charges_one_active_per_reservation on public.court_charges (reservation_id) where status = 'confirmed';
create index court_charges_person_idx on public.court_charges (club_id, responsible_person_id, created_at desc);
create index court_charges_club_created_idx on public.court_charges (club_id, created_at desc);

create table public.court_charge_payments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  charge_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  payment_date date not null,
  payment_method text not null check (payment_method in ('cash', 'bank_transfer', 'mercado_pago', 'other')),
  reference text,
  notes text,
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete restrict,
  void_reason text,
  constraint court_charge_payments_charge_belongs_to_club
    foreign key (club_id, charge_id) references public.court_charges (club_id, id) on delete restrict,
  constraint court_charge_payments_void_data_consistent check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and char_length(trim(coalesce(void_reason, ''))) > 0)
  ),
  constraint court_charge_payments_club_request_key unique (club_id, client_request_id)
);
create index court_charge_payments_charge_valid_idx on public.court_charge_payments (charge_id, payment_date, created_at) where voided_at is null;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Protección de histórico: nada se borra y solo la anulación puede modificar una fila ya registrada.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.forbid_court_finance_delete()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$ begin raise exception 'Los movimientos financieros no se borran: se anulan con motivo.' using errcode = '55000'; end; $$;

create or replace function private.guard_court_charge_update()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
begin
  -- total_cents (columna generada) aún no está calculada en NEW durante un BEFORE: se excluye de la comparación.
  if old.status = 'voided' or (to_jsonb(new) - array['status', 'voided_at', 'voided_by', 'void_reason', 'total_cents'])
     is distinct from (to_jsonb(old) - array['status', 'voided_at', 'voided_by', 'void_reason', 'total_cents']) then
    raise exception 'Un cargo registrado no se modifica: anulalo con motivo y cargá uno nuevo.' using errcode = '55000';
  end if;
  return new;
end; $$;

create or replace function private.guard_court_payment_update()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if old.voided_at is not null or (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason'])
     is distinct from (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason']) then
    raise exception 'Un pago registrado no se modifica: anulalo con motivo.' using errcode = '55000';
  end if;
  return new;
end; $$;

create or replace function private.forbid_court_rate_history_change()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$ begin raise exception 'El historial de tarifas no se modifica.' using errcode = '55000'; end; $$;

create trigger court_charges_no_delete before delete on public.court_charges for each row execute function private.forbid_court_finance_delete();
create trigger court_charges_guard_update before update on public.court_charges for each row execute function private.guard_court_charge_update();
create trigger court_charge_payments_no_delete before delete on public.court_charge_payments for each row execute function private.forbid_court_finance_delete();
create trigger court_charge_payments_guard_update before update on public.court_charge_payments for each row execute function private.guard_court_payment_update();
create trigger court_rate_history_no_update before update or delete on public.club_court_rate_history for each row execute function private.forbid_court_rate_history_change();

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Cálculo (única fórmula; la UI solo la replica como vista previa informativa)
--    exact: importe = tarifa/hora × minutos / 60.  rounded_up: los minutos se redondean HACIA ARRIBA al bloque configurado.
--    Redondeo al centavo (mitad hacia arriba). 90 min NO se asumen como 2 horas.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.court_billable_amount(p_hour_cents bigint, p_minutes integer, p_mode text, p_block smallint)
returns bigint language sql immutable set search_path = pg_catalog
as $$
  select round(p_hour_cents::numeric
    * (case when p_mode = 'rounded_up' then ceil(p_minutes::numeric / p_block) * p_block else p_minutes::numeric end) / 60)::bigint
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Configuración de tarifas (owner/admin). Sin valores por defecto: el club los define.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.set_court_rate_settings(
  p_club_id uuid,
  p_rental_hour_cents bigint,
  p_lighting_hour_cents bigint,
  p_rental_enabled boolean,
  p_lighting_enabled boolean,
  p_billing_mode text default 'exact',
  p_billing_block_minutes smallint default null
)
returns public.club_court_rate_settings
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_current public.club_court_rate_settings; v_result public.club_court_rate_settings; v_block smallint;
begin
  if auth.uid() is null or not private.can_manage_finances(p_club_id) then
    raise exception 'No tenés permiso para configurar tarifas en este club.' using errcode = '42501';
  end if;
  if p_rental_enabled is null or p_lighting_enabled is null or coalesce(p_billing_mode, '') not in ('exact', 'rounded_up')
     or coalesce(p_rental_hour_cents, 1) <= 0 or coalesce(p_lighting_hour_cents, 1) <= 0 then
    raise exception 'La configuración de tarifas no es válida.' using errcode = '22023';
  end if;
  if (p_rental_enabled and p_rental_hour_cents is null) or (p_lighting_enabled and p_lighting_hour_cents is null) then
    raise exception 'Para activar una tarifa tenés que indicar su precio por hora.' using errcode = '22023';
  end if;
  v_block := case when p_billing_mode = 'rounded_up' then p_billing_block_minutes else null end;
  if p_billing_mode = 'rounded_up' and coalesce(v_block, 0) not in (15, 30, 60) then
    raise exception 'Elegí el bloque de redondeo (15, 30 o 60 minutos).' using errcode = '22023';
  end if;

  select * into v_current from public.club_court_rate_settings where club_id = p_club_id for update;
  if found
     and v_current.rental_hour_cents is not distinct from p_rental_hour_cents
     and v_current.lighting_hour_cents is not distinct from p_lighting_hour_cents
     and v_current.rental_enabled = p_rental_enabled and v_current.lighting_enabled = p_lighting_enabled
     and v_current.billing_mode = p_billing_mode and v_current.billing_block_minutes is not distinct from v_block then
    return v_current;
  end if;

  insert into public.club_court_rate_settings (club_id, rental_hour_cents, lighting_hour_cents, rental_enabled, lighting_enabled, billing_mode, billing_block_minutes, updated_by)
  values (p_club_id, p_rental_hour_cents, p_lighting_hour_cents, p_rental_enabled, p_lighting_enabled, p_billing_mode, v_block, auth.uid())
  on conflict (club_id) do update
  set rental_hour_cents = excluded.rental_hour_cents, lighting_hour_cents = excluded.lighting_hour_cents,
      rental_enabled = excluded.rental_enabled, lighting_enabled = excluded.lighting_enabled,
      billing_mode = excluded.billing_mode, billing_block_minutes = excluded.billing_block_minutes,
      updated_at = now(), updated_by = auth.uid()
  returning * into v_result;
  insert into public.club_court_rate_history (club_id, rental_hour_cents, lighting_hour_cents, rental_enabled, lighting_enabled, billing_mode, billing_block_minutes, changed_by)
  values (p_club_id, v_result.rental_hour_cents, v_result.lighting_hour_cents, v_result.rental_enabled, v_result.lighting_enabled, v_result.billing_mode, v_result.billing_block_minutes, auth.uid());
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Registrar un cargo. Confirmación EXPRESA: nada se carga solo por existir la reserva.
--    p_*_override_cents = importe manual autorizado (reemplaza al calculado; exige p_adjustment_reason).
--    Idempotente: misma clave + mismo contenido + mismo usuario => devuelve el cargo original; otro contenido => 23505.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.create_court_charge(
  p_club_id uuid,
  p_reservation_id uuid,
  p_responsible_person_id uuid,
  p_apply_rental boolean,
  p_apply_lighting boolean,
  p_client_request_id uuid,
  p_billable_minutes integer default null,
  p_rental_override_cents bigint default null,
  p_lighting_override_cents bigint default null,
  p_adjustment_reason text default null,
  p_notes text default null
)
returns public.court_charges
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_charge public.court_charges; v_res public.reservations; v_person public.club_people; v_rates public.club_court_rate_settings;
  v_minutes integer; v_reason text; v_notes text; v_hash text; v_member text;
  v_calc_rental bigint; v_calc_light bigint; v_rental bigint := 0; v_light bigint := 0;
  v_mode text := 'exact'; v_block smallint; v_rental_rate bigint; v_light_rate bigint;
begin
  if auth.uid() is null or not private.can_manage_finances(p_club_id) then
    raise exception 'No tenés permiso para registrar cobros de cancha en este club.' using errcode = '42501';
  end if;
  if p_client_request_id is null then
    raise exception 'El cargo necesita un identificador de operación.' using errcode = '22023';
  end if;
  if p_apply_rental is null or p_apply_lighting is null or not (p_apply_rental or p_apply_lighting) then
    raise exception 'Elegí al menos un concepto a cobrar: alquiler o iluminación.' using errcode = '22023';
  end if;
  if (not p_apply_rental and p_rental_override_cents is not null) or (not p_apply_lighting and p_lighting_override_cents is not null)
     or coalesce(p_rental_override_cents, 1) <= 0 or coalesce(p_lighting_override_cents, 1) <= 0 then
    raise exception 'Los importes manuales no son válidos.' using errcode = '22023';
  end if;
  if p_billable_minutes is not null and p_billable_minutes not between 1 and 1440 then
    raise exception 'La duración a cobrar no es válida.' using errcode = '22023';
  end if;
  v_reason := nullif(trim(coalesce(p_adjustment_reason, '')), '');
  v_notes := nullif(trim(coalesce(p_notes, '')), '');

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'club', p_club_id, 'reservation', p_reservation_id, 'person', p_responsible_person_id, 'rental', p_apply_rental, 'lighting', p_apply_lighting,
    'minutes', p_billable_minutes, 'rental_override', p_rental_override_cents, 'lighting_override', p_lighting_override_cents,
    'reason', v_reason, 'notes', v_notes)::text, 'UTF8')), 'hex');

  -- Serializa los envíos simultáneos con la misma clave: el segundo espera y luego ve la fila del primero.
  perform pg_advisory_xact_lock(hashtextextended('court_charge:' || p_club_id::text || ':' || p_client_request_id::text, 0));
  select * into v_charge from public.court_charges where club_id = p_club_id and client_request_id = p_client_request_id;
  if found then
    if v_charge.request_hash is distinct from v_hash or v_charge.created_by is distinct from auth.uid() then
      raise exception 'Este identificador de operación ya se usó con otros datos. Revisá el historial antes de reintentar.' using errcode = '23505';
    end if;
    return v_charge;
  end if;

  select * into v_res from public.reservations where id = p_reservation_id and club_id = p_club_id for share;
  if not found then raise exception 'La reserva no existe en este club.' using errcode = '23503'; end if;
  if v_res.occupation_type <> 'reservation' then
    raise exception 'Solo las reservas comunes admiten cobro de cancha. Clases, bloqueos y torneos tienen reglas aparte.' using errcode = '22023';
  end if;
  if v_res.status <> 'confirmed' then
    raise exception 'La reserva está cancelada: no se puede cobrar.' using errcode = '22023';
  end if;
  if exists (select 1 from public.court_charges where reservation_id = v_res.id and status = 'confirmed') then
    raise exception 'La reserva ya tiene un cargo vigente. Anulalo antes de registrar otro.' using errcode = '22023';
  end if;
  select * into v_person from public.club_people where id = p_responsible_person_id and club_id = p_club_id for share;
  if not found then raise exception 'La persona responsable no pertenece a este club.' using errcode = '23503'; end if;
  if not v_person.active then raise exception 'La ficha del responsable está dada de baja.' using errcode = '22023'; end if;

  v_minutes := coalesce(p_billable_minutes, ceil(extract(epoch from (v_res.ends_at - v_res.starts_at)) / 60)::integer);
  select * into v_rates from public.club_court_rate_settings where club_id = p_club_id for share;
  if found then
    v_mode := v_rates.billing_mode; v_block := v_rates.billing_block_minutes;
    if v_rates.rental_enabled then
      v_rental_rate := v_rates.rental_hour_cents;
      v_calc_rental := private.court_billable_amount(v_rental_rate, v_minutes, v_mode, v_block);
    end if;
    if v_rates.lighting_enabled then
      v_light_rate := v_rates.lighting_hour_cents;
      v_calc_light := private.court_billable_amount(v_light_rate, v_minutes, v_mode, v_block);
    end if;
  end if;
  if p_apply_rental then
    v_rental := coalesce(p_rental_override_cents, v_calc_rental);
    if v_rental is null then raise exception 'La tarifa de alquiler no está activa: configurala o ingresá un importe manual.' using errcode = '22023'; end if;
  end if;
  if p_apply_lighting then
    v_light := coalesce(p_lighting_override_cents, v_calc_light);
    if v_light is null then raise exception 'La tarifa de iluminación no está activa: configurala o ingresá un importe manual.' using errcode = '22023'; end if;
  end if;
  if v_rental + v_light <= 0 or (p_apply_rental and v_rental <= 0) or (p_apply_lighting and v_light <= 0) then
    raise exception 'El importe a cobrar debe ser mayor a cero.' using errcode = '22023';
  end if;
  if ((p_apply_rental and v_rental is distinct from v_calc_rental) or (p_apply_lighting and v_light is distinct from v_calc_light)) and v_reason is null then
    raise exception 'Indicá el motivo del importe ajustado manualmente.' using errcode = '22023';
  end if;

  v_member := case when exists (select 1 from public.club_memberships where club_id = p_club_id and person_id = v_person.id and status = 'active') then 'member' else 'non_member' end;

  begin
    insert into public.court_charges (
      club_id, reservation_id, responsible_person_id, responsible_name_snapshot, member_status, billable_minutes,
      rental_applied, lighting_applied, rental_hour_cents_snapshot, lighting_hour_cents_snapshot, billing_mode_snapshot, billing_block_minutes_snapshot,
      calculated_rental_cents, calculated_lighting_cents, rental_cents, lighting_cents, adjustment_reason, notes, client_request_id, request_hash, created_by)
    values (
      p_club_id, v_res.id, v_person.id, v_person.full_name, v_member, v_minutes,
      p_apply_rental, p_apply_lighting, v_rental_rate, v_light_rate, v_mode, v_block,
      v_calc_rental, v_calc_light, v_rental, v_light, v_reason, v_notes, p_client_request_id, v_hash, auth.uid())
    returning * into v_charge;
  exception when unique_violation then
    -- Dos cargos distintos simultáneos sobre la misma reserva: gana uno, el otro se rechaza sin registrar nada.
    raise exception 'La reserva ya tiene un cargo vigente. Anulalo antes de registrar otro.' using errcode = '22023';
  end;
  return v_charge;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Anular un cargo (solo si no tiene pagos vigentes; el cargo queda visible como anulado).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.void_court_charge(p_charge_id uuid, p_reason text)
returns public.court_charges
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_charge public.court_charges;
begin
  select * into v_charge from public.court_charges where id = p_charge_id for update;
  -- «No existe» y «no es de tu club» responden igual: no revela si un cargo ajeno existe.
  if not found or auth.uid() is null or not private.can_manage_finances(v_charge.club_id) then
    raise exception 'No tenés permiso para anular este cargo.' using errcode = '42501';
  end if;
  if v_charge.status <> 'confirmed' then raise exception 'El cargo ya fue anulado.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Indicá el motivo de la anulación.' using errcode = '22023'; end if;
  if exists (select 1 from public.court_charge_payments where charge_id = v_charge.id and voided_at is null) then
    raise exception 'El cargo tiene pagos vigentes. Anulá primero los pagos.' using errcode = '22023';
  end if;
  update public.court_charges set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
  where id = v_charge.id returning * into v_charge;
  return v_charge;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. Pago de un cargo (total o parcial). El reintento se resuelve ANTES de validar el saldo (igual que 10B.2).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.record_court_charge_payment(
  p_club_id uuid,
  p_charge_id uuid,
  p_amount_cents bigint,
  p_payment_date date,
  p_payment_method text,
  p_client_request_id uuid,
  p_reference text default null,
  p_notes text default null
)
returns public.court_charge_payments
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_charge public.court_charges; v_paid bigint; v_payment public.court_charge_payments; v_reference text; v_notes text;
begin
  if auth.uid() is null or not private.can_manage_finances(p_club_id) then
    raise exception 'No tenés permiso para registrar pagos en este club.' using errcode = '42501';
  end if;
  if p_client_request_id is null then
    raise exception 'El pago necesita un identificador de operación.' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_payment_date is null or p_payment_method is null
     or p_payment_method not in ('cash', 'bank_transfer', 'mercado_pago', 'other') then
    raise exception 'El pago no tiene datos válidos.' using errcode = '22023';
  end if;
  v_reference := nullif(trim(coalesce(p_reference, '')), '');
  v_notes := nullif(trim(coalesce(p_notes, '')), '');
  perform pg_advisory_xact_lock(hashtextextended('court_payment:' || p_club_id::text || ':' || p_client_request_id::text, 0));
  select * into v_charge from public.court_charges where id = p_charge_id and club_id = p_club_id for update;
  if not found then raise exception 'El cargo no existe en este club.' using errcode = '23503'; end if;
  select * into v_payment from public.court_charge_payments where club_id = p_club_id and client_request_id = p_client_request_id;
  if found then
    if v_payment.charge_id is distinct from v_charge.id or v_payment.amount_cents is distinct from p_amount_cents
       or v_payment.payment_date is distinct from p_payment_date or v_payment.payment_method is distinct from p_payment_method
       or v_payment.reference is distinct from v_reference or v_payment.notes is distinct from v_notes
       or v_payment.created_by is distinct from auth.uid() then
      raise exception 'Este identificador de operación ya se usó con otros datos. Revisá el historial antes de reintentar.' using errcode = '23505';
    end if;
    return v_payment;
  end if;
  if v_charge.status <> 'confirmed' then raise exception 'El cargo está anulado: no admite pagos.' using errcode = '23503'; end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.court_charge_payments where charge_id = v_charge.id and voided_at is null;
  if p_amount_cents > v_charge.total_cents - v_paid then
    raise exception 'El importe supera el saldo pendiente del cargo.' using errcode = '22023';
  end if;
  insert into public.court_charge_payments (club_id, charge_id, amount_cents, payment_date, payment_method, reference, notes, client_request_id, created_by)
  values (p_club_id, v_charge.id, p_amount_cents, p_payment_date, p_payment_method, v_reference, v_notes, p_client_request_id, auth.uid())
  returning * into v_payment;
  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 9. Anular un pago (auditado: quién, cuándo y por qué; el saldo del cargo se recalcula sin pagos anulados).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.void_court_charge_payment(p_payment_id uuid, p_reason text)
returns public.court_charge_payments
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_payment public.court_charge_payments;
begin
  select * into v_payment from public.court_charge_payments where id = p_payment_id;
  if not found or auth.uid() is null or not private.can_manage_finances(v_payment.club_id) then
    raise exception 'No tenés permiso para anular este pago.' using errcode = '42501';
  end if;
  -- Mismo orden de candados que el cobro (cargo primero, luego el pago): sin deadlock con un pago simultáneo.
  perform 1 from public.court_charges where id = v_payment.charge_id for update;
  select * into v_payment from public.court_charge_payments where id = p_payment_id for update;
  if v_payment.voided_at is not null then raise exception 'El pago ya fue anulado.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Indicá el motivo de la anulación.' using errcode = '22023'; end if;
  update public.court_charge_payments set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
  where id = v_payment.id returning * into v_payment;
  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 10. Cuenta corriente: LECTURA consolidada de lo ya registrado (cuotas + cantina + cargos de cancha). No guarda nada.
--     Los pagos anulados no suman; cargos/consumos anulados figuran con saldo 0 (solo con p_include_settled).
--     concept: membership_due | canteen | court_rental | court_lighting | court_rental_lighting
--     status:  pending | partial | paid | voided   (el «vencida» de cuotas lo calcula la UI con due_date)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.get_person_account(p_club_id uuid, p_person_id uuid, p_include_settled boolean default false)
returns table (
  concept text, source_id uuid, occurred_on date, due_date date, description text,
  original_cents bigint, paid_cents bigint, balance_cents bigint, status text, reservation_id uuid
)
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
declare v_tz text;
begin
  if auth.uid() is null or not private.can_manage_finances(p_club_id) then
    raise exception 'No tenés permiso para ver cuentas en este club.' using errcode = '42501';
  end if;
  select c.timezone into v_tz from public.clubs c where c.id = p_club_id;
  if v_tz is null or not exists (select 1 from public.club_people where club_id = p_club_id and id = p_person_id) then
    raise exception 'La persona no pertenece a este club.' using errcode = '23503';
  end if;

  return query
  with items as (
    select 'membership_due'::text as concept, d.id as source_id, d.period as occurred_on, d.due_date as due_date,
      'Cuota mensual'::text as description, d.amount_cents as original_cents,
      coalesce(p.paid, 0)::bigint as paid_cents,
      greatest(d.amount_cents - coalesce(p.paid, 0), 0)::bigint as balance_cents,
      case when d.amount_cents - coalesce(p.paid, 0) <= 0 then 'paid' when coalesce(p.paid, 0) > 0 then 'partial' else 'pending' end as status,
      null::uuid as reservation_id
    from public.membership_dues d
    join public.club_memberships m on m.club_id = d.club_id and m.id = d.membership_id
    left join lateral (select sum(x.amount_cents) as paid from public.membership_due_payments x where x.due_id = d.id and x.voided_at is null) p on true
    where d.club_id = p_club_id and m.person_id = p_person_id

    union all
    select 'canteen', s.id, (s.created_at at time zone v_tz)::date, null::date,
      left('Cantina: ' || coalesce((select string_agg(i.quantity || '× ' || i.product_name_snapshot, ', ' order by i.product_name_snapshot)
        from public.canteen_sale_items i where i.sale_id = s.id), 'consumo'), 140),
      s.total_cents, coalesce(p.paid, 0)::bigint,
      case when s.status = 'voided' then 0 else greatest(s.total_cents - coalesce(p.paid, 0), 0) end::bigint,
      case when s.status = 'voided' then 'voided' when s.total_cents - coalesce(p.paid, 0) <= 0 then 'paid' when coalesce(p.paid, 0) > 0 then 'partial' else 'pending' end,
      null::uuid
    from public.canteen_sales s
    left join lateral (select sum(x.amount_cents) as paid from public.canteen_sale_payments x where x.sale_id = s.id) p on true
    where s.club_id = p_club_id and s.customer_person_id = p_person_id

    union all
    select case when c.rental_applied and c.lighting_applied then 'court_rental_lighting' when c.lighting_applied then 'court_lighting' else 'court_rental' end,
      c.id, (r.starts_at at time zone v_tz)::date, null::date,
      (coalesce(ct.name, 'Cancha') || ' · ' || to_char(r.starts_at at time zone v_tz, 'HH24:MI') || '–' || to_char(r.ends_at at time zone v_tz, 'HH24:MI')
        || ' · ' || case when c.rental_applied and c.lighting_applied then 'Alquiler + iluminación' when c.lighting_applied then 'Iluminación' else 'Alquiler' end)::text,
      c.total_cents, coalesce(p.paid, 0)::bigint,
      case when c.status = 'voided' then 0 else greatest(c.total_cents - coalesce(p.paid, 0), 0) end::bigint,
      case when c.status = 'voided' then 'voided' when c.total_cents - coalesce(p.paid, 0) <= 0 then 'paid' when coalesce(p.paid, 0) > 0 then 'partial' else 'pending' end,
      c.reservation_id
    from public.court_charges c
    join public.reservations r on r.club_id = c.club_id and r.id = c.reservation_id
    left join public.courts ct on ct.club_id = r.club_id and ct.id = r.court_id
    left join lateral (select sum(x.amount_cents) as paid from public.court_charge_payments x where x.charge_id = c.id and x.voided_at is null) p on true
    where c.club_id = p_club_id and c.responsible_person_id = p_person_id
  )
  select i.concept, i.source_id, i.occurred_on, i.due_date, i.description, i.original_cents, i.paid_cents, i.balance_cents, i.status, i.reservation_id
  from items i
  where p_include_settled or i.balance_cents > 0
  order by i.occurred_on desc, i.source_id
  limit (case when p_include_settled then 300 else null end);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 11. Privilegios y RLS (lectura owner/admin; toda escritura pasa por las RPC)
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function private.court_billable_amount(bigint, integer, text, smallint) from public;
revoke all on function private.forbid_court_finance_delete(), private.guard_court_charge_update(), private.guard_court_payment_update(), private.forbid_court_rate_history_change() from public;

revoke all on function
  public.set_court_rate_settings(uuid, bigint, bigint, boolean, boolean, text, smallint),
  public.create_court_charge(uuid, uuid, uuid, boolean, boolean, uuid, integer, bigint, bigint, text, text),
  public.void_court_charge(uuid, text),
  public.record_court_charge_payment(uuid, uuid, bigint, date, text, uuid, text, text),
  public.void_court_charge_payment(uuid, text),
  public.get_person_account(uuid, uuid, boolean)
from public, anon;
grant execute on function
  public.set_court_rate_settings(uuid, bigint, bigint, boolean, boolean, text, smallint),
  public.create_court_charge(uuid, uuid, uuid, boolean, boolean, uuid, integer, bigint, bigint, text, text),
  public.void_court_charge(uuid, text),
  public.record_court_charge_payment(uuid, uuid, bigint, date, text, uuid, text, text),
  public.void_court_charge_payment(uuid, text),
  public.get_person_account(uuid, uuid, boolean)
to authenticated;

alter table public.club_court_rate_settings enable row level security;
alter table public.club_court_rate_history enable row level security;
alter table public.court_charges enable row level security;
alter table public.court_charge_payments enable row level security;
create policy "owners and admins read court rate settings" on public.club_court_rate_settings for select to authenticated using (private.can_manage_finances(club_id));
create policy "owners and admins read court rate history" on public.club_court_rate_history for select to authenticated using (private.can_manage_finances(club_id));
create policy "owners and admins read court charges" on public.court_charges for select to authenticated using (private.can_manage_finances(club_id));
create policy "owners and admins read court charge payments" on public.court_charge_payments for select to authenticated using (private.can_manage_finances(club_id));
revoke all on table public.club_court_rate_settings, public.club_court_rate_history, public.court_charges, public.court_charge_payments from anon, authenticated;
grant select on table public.club_court_rate_settings, public.club_court_rate_history, public.court_charges, public.court_charge_payments to authenticated;
