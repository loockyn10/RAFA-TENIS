-- Sprint 10B.2 / SEC-05: idempotencia real de ventas de cantina y pagos (cuotas y cantina).
-- Requiere 20261013040000 (cuotas) y 20261013070000 (cantina). No ejecutar automáticamente en Supabase.
--
-- Garantía: una operación financiera reintentada con el MISMO client_request_id y el MISMO contenido devuelve el
-- resultado original sin crear otra fila. La misma clave con OTRO contenido (o de otro usuario) se rechaza con 23505.
-- La clave es única por club (unique (club_id, client_request_id)): no se puede recuperar la operación de otro club.
-- Dos operaciones deliberadamente distintas (clave nueva) se registran siempre, aunque coincidan monto/cliente/productos.
--
-- Cambios de contrato (el frontend de este sprint ya los usa):
--   * record_membership_due_payment y record_canteen_sale_payment ganan p_client_request_id (obligatorio: null => 22023).
--     Se ELIMINAN las firmas de 7 argumentos: dejarlas permitiría seguir cobrando sin idempotencia. Aplicar la migración
--     y desplegar el frontend juntos; entre ambos pasos, registrar pagos desde el frontend anterior falla (sin duplicar).
--   * create_canteen_sale conserva su firma; p_client_request_id deja de tener un valor por defecto aleatorio
--     (omitirlo anulaba la idempotencia sin avisar): ahora null => 22023.
-- Los registros existentes no se modifican: las ventas anteriores quedan con request_hash NULL y los pagos anteriores
-- con client_request_id NULL (NULL no choca con la restricción UNIQUE). Reintentar con la clave de una venta anterior a
-- esta migración se rechaza (23505): su contenido no se puede verificar.

alter table public.canteen_sales add column request_hash text;
alter table public.canteen_sales
  add constraint canteen_sales_request_hash_format check (request_hash is null or request_hash ~ '^[0-9a-f]{64}$');

alter table public.membership_due_payments add column client_request_id uuid;
alter table public.membership_due_payments
  add constraint membership_due_payments_club_request_key unique (club_id, client_request_id);

alter table public.canteen_sale_payments add column client_request_id uuid;
alter table public.canteen_sale_payments
  add constraint canteen_sale_payments_club_request_key unique (club_id, client_request_id);

-- ---------------------------------------------------------------------------------------------------------------
-- Venta de cantina. p_items: [{ product_id: uuid, quantity: entero > 0 }]; el cliente nunca envía precios.
-- request_hash = sha256 del contenido normalizado (club, cliente, medio de pago, ítems ordenados por producto).
-- No incluye precios ni fechas: un reintento tras un cambio de precio sigue devolviendo la venta original.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.create_canteen_sale(
  p_club_id uuid,
  p_items jsonb,
  p_customer_person_id uuid default null,
  p_payment_method text default null,
  p_client_request_id uuid default null
) returns public.canteen_sales language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_sale public.canteen_sales; v_total bigint; v_matched integer; v_item jsonb; v_quantity integer; v_product_id uuid;
  v_lines jsonb := '[]'::jsonb; v_seen uuid[] := '{}'; v_sorted jsonb; v_hash text;
begin
  if auth.uid() is null or not private.is_club_member(p_club_id) then
    raise exception 'No tenés permiso para registrar ventas en este club.' using errcode = '42501';
  end if;
  if p_client_request_id is null then
    raise exception 'La venta necesita un identificador de operación.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
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

  -- Normaliza y valida los ítems (en memoria; sin tabla temporal).
  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      if jsonb_typeof(v_item) <> 'object' then raise exception 'invalid'; end if;
      v_quantity := (v_item->>'quantity')::integer;
      v_product_id := (v_item->>'product_id')::uuid;
    exception when others then
      raise exception 'La cantidad de un producto no es válida.' using errcode = '22023';
    end;
    if v_quantity is null or v_quantity <= 0 or v_product_id is null then
      raise exception 'La cantidad de un producto no es válida.' using errcode = '22023';
    end if;
    if v_product_id = any(v_seen) then raise exception 'Un producto fue repetido en la venta.' using errcode = '22023'; end if;
    v_seen := v_seen || v_product_id;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('product_id', v_product_id, 'quantity', v_quantity));
  end loop;
  select jsonb_agg(line order by line->>'product_id') into v_sorted from jsonb_array_elements(v_lines) as line;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'club', p_club_id, 'customer', p_customer_person_id, 'method', p_payment_method, 'items', v_sorted)::text, 'UTF8')), 'hex');

  -- Serializa los envíos simultáneos con la misma clave: el segundo espera y luego ve la fila del primero.
  perform pg_advisory_xact_lock(hashtextextended('canteen_sale:' || p_club_id::text || ':' || p_client_request_id::text, 0));
  select * into v_sale from public.canteen_sales where club_id = p_club_id and client_request_id = p_client_request_id;
  if found then
    if v_sale.request_hash is distinct from v_hash or v_sale.created_by is distinct from auth.uid() then
      raise exception 'Este identificador de operación ya se usó con otros datos. Revisá el historial antes de reintentar.' using errcode = '23505';
    end if;
    return v_sale;
  end if;

  -- Evita que un cambio de precio ocurra entre calcular el total y congelar los precios de los ítems.
  perform 1 from public.canteen_products p join jsonb_to_recordset(v_lines) as d(product_id uuid, quantity integer) on d.product_id = p.id
  where p.club_id = p_club_id and p.active for share of p;
  select coalesce(sum(p.sale_price_cents * d.quantity), 0), count(*) into v_total, v_matched
  from jsonb_to_recordset(v_lines) as d(product_id uuid, quantity integer)
  join public.canteen_products p on p.id = d.product_id and p.club_id = p_club_id and p.active;
  if v_total <= 0 or v_matched <> jsonb_array_length(v_lines) then
    raise exception 'Uno de los productos no está disponible en este club.' using errcode = '23503';
  end if;
  insert into public.canteen_sales(club_id, customer_person_id, total_cents, client_request_id, request_hash, created_by)
  values (p_club_id, p_customer_person_id, v_total, p_client_request_id, v_hash, auth.uid()) returning * into v_sale;
  insert into public.canteen_sale_items(club_id, sale_id, product_id, product_name_snapshot, quantity, unit_price_cents)
  select p_club_id, v_sale.id, p.id, p.name, d.quantity, p.sale_price_cents
  from jsonb_to_recordset(v_lines) as d(product_id uuid, quantity integer) join public.canteen_products p on p.id = d.product_id and p.club_id = p_club_id;
  if p_payment_method is not null then
    insert into public.canteen_sale_payments(club_id, sale_id, amount_cents, payment_date, payment_method, created_by)
    values (p_club_id, v_sale.id, v_total, (now() at time zone 'America/Argentina/Buenos_Aires')::date, p_payment_method, auth.uid());
  end if;
  return v_sale;
end; $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Pago de cuota. El reintento se resuelve ANTES de validar el saldo: reenviar el último pago de una cuota ya
-- saldada devuelve el pago original en lugar de fallar por "supera el saldo".
-- ---------------------------------------------------------------------------------------------------------------
drop function if exists public.record_membership_due_payment(uuid, uuid, bigint, date, text, text, text);
create function public.record_membership_due_payment(
  p_club_id uuid,
  p_due_id uuid,
  p_amount_cents bigint,
  p_payment_date date,
  p_payment_method text,
  p_reference text default null,
  p_notes text default null,
  p_client_request_id uuid default null
)
returns public.membership_due_payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_due public.membership_dues; v_paid bigint; v_payment public.membership_due_payments; v_reference text; v_notes text;
begin
  if auth.uid() is null or not private.can_manage_finances(p_club_id) then
    raise exception 'No tenés permiso para registrar pagos en este club.' using errcode = '42501';
  end if;
  if p_client_request_id is null then
    raise exception 'El pago necesita un identificador de operación.' using errcode = '22023';
  end if;
  if p_amount_cents <= 0 or p_payment_date is null or p_payment_method not in ('cash', 'bank_transfer', 'mercado_pago', 'other') then
    raise exception 'El pago no tiene datos válidos.' using errcode = '22023';
  end if;
  v_reference := nullif(trim(coalesce(p_reference, '')), '');
  v_notes := nullif(trim(coalesce(p_notes, '')), '');
  perform pg_advisory_xact_lock(hashtextextended('due_payment:' || p_club_id::text || ':' || p_client_request_id::text, 0));
  select * into v_due from public.membership_dues where id = p_due_id and club_id = p_club_id for update;
  if not found then raise exception 'La cuota no existe en este club.' using errcode = '23503'; end if;
  select * into v_payment from public.membership_due_payments where club_id = p_club_id and client_request_id = p_client_request_id;
  if found then
    if v_payment.due_id is distinct from v_due.id or v_payment.amount_cents is distinct from p_amount_cents
       or v_payment.payment_date is distinct from p_payment_date or v_payment.payment_method is distinct from p_payment_method
       or v_payment.reference is distinct from v_reference or v_payment.notes is distinct from v_notes
       or v_payment.created_by is distinct from auth.uid() then
      raise exception 'Este identificador de operación ya se usó con otros datos. Revisá el historial antes de reintentar.' using errcode = '23505';
    end if;
    return v_payment;
  end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.membership_due_payments where due_id = v_due.id and voided_at is null;
  if p_amount_cents > v_due.amount_cents - v_paid then
    raise exception 'El importe supera el saldo pendiente de la cuota.' using errcode = '22023';
  end if;
  insert into public.membership_due_payments (club_id, due_id, amount_cents, payment_date, payment_method, reference, notes, created_by, client_request_id)
  values (p_club_id, v_due.id, p_amount_cents, p_payment_date, p_payment_method, v_reference, v_notes, auth.uid(), p_client_request_id)
  returning * into v_payment;
  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Pago de una venta pendiente de cantina (misma regla).
-- ---------------------------------------------------------------------------------------------------------------
drop function if exists public.record_canteen_sale_payment(uuid, uuid, bigint, date, text, text, text);
create function public.record_canteen_sale_payment(
  p_club_id uuid,
  p_sale_id uuid,
  p_amount_cents bigint,
  p_payment_date date,
  p_payment_method text,
  p_reference text default null,
  p_notes text default null,
  p_client_request_id uuid default null
) returns public.canteen_sale_payments language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_sale public.canteen_sales; v_paid bigint; v_payment public.canteen_sale_payments; v_reference text; v_notes text;
begin
  if auth.uid() is null or not private.is_club_member(p_club_id) then raise exception 'No tenés permiso para registrar pagos de cantina en este club.' using errcode = '42501'; end if;
  if p_client_request_id is null then raise exception 'El pago necesita un identificador de operación.' using errcode = '22023'; end if;
  if p_amount_cents <= 0 or p_payment_date is null or p_payment_method not in ('cash', 'bank_transfer', 'mercado_pago', 'other') then raise exception 'El pago no tiene datos válidos.' using errcode = '22023'; end if;
  v_reference := nullif(trim(coalesce(p_reference, '')), '');
  v_notes := nullif(trim(coalesce(p_notes, '')), '');
  perform pg_advisory_xact_lock(hashtextextended('canteen_payment:' || p_club_id::text || ':' || p_client_request_id::text, 0));
  select * into v_sale from public.canteen_sales where id = p_sale_id and club_id = p_club_id for update;
  if not found then raise exception 'La venta no está disponible para cobrar.' using errcode = '23503'; end if;
  select * into v_payment from public.canteen_sale_payments where club_id = p_club_id and client_request_id = p_client_request_id;
  if found then
    if v_payment.sale_id is distinct from v_sale.id or v_payment.amount_cents is distinct from p_amount_cents
       or v_payment.payment_date is distinct from p_payment_date or v_payment.payment_method is distinct from p_payment_method
       or v_payment.reference is distinct from v_reference or v_payment.notes is distinct from v_notes
       or v_payment.created_by is distinct from auth.uid() then
      raise exception 'Este identificador de operación ya se usó con otros datos. Revisá el historial antes de reintentar.' using errcode = '23505';
    end if;
    return v_payment;
  end if;
  if v_sale.status <> 'confirmed' then raise exception 'La venta no está disponible para cobrar.' using errcode = '23503'; end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.canteen_sale_payments where sale_id = v_sale.id;
  if p_amount_cents > v_sale.total_cents - v_paid then raise exception 'El importe supera el saldo pendiente de la venta.' using errcode = '22023'; end if;
  insert into public.canteen_sale_payments(club_id, sale_id, amount_cents, payment_date, payment_method, reference, notes, created_by, client_request_id)
  values (p_club_id, v_sale.id, p_amount_cents, p_payment_date, p_payment_method, v_reference, v_notes, auth.uid(), p_client_request_id) returning * into v_payment;
  return v_payment;
end; $$;

-- Privilegios: solo authenticated (SEC-02). Las funciones recreadas nacen sin EXECUTE para PUBLIC/anon.
revoke all on function
  public.create_canteen_sale(uuid, jsonb, uuid, text, uuid),
  public.record_membership_due_payment(uuid, uuid, bigint, date, text, text, text, uuid),
  public.record_canteen_sale_payment(uuid, uuid, bigint, date, text, text, text, uuid)
from public, anon;
grant execute on function
  public.create_canteen_sale(uuid, jsonb, uuid, text, uuid),
  public.record_membership_due_payment(uuid, uuid, bigint, date, text, text, text, uuid),
  public.record_canteen_sale_payment(uuid, uuid, bigint, date, text, text, text, uuid)
to authenticated;
