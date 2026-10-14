-- Sprint 10B.1 / SEC-02: RPC administrativas ejecutables por anon y comprobación de permisos posterior a la lectura.
-- Dependencias: 20261013020000, 20261013030000 (series), 20261013040000 (cuotas), 20261013050000 (escuela),
-- 20261013070000 (cantina) y 20261013080000 (invitaciones). Independiente de las demás migraciones 10B.1.
-- Con los privilegios por defecto de Supabase, "revoke ... from public" no quita el EXECUTE explícito de anon.
-- Todas estas RPC requieren sesión (auth.uid()); anon nunca debe poder invocarlas. authenticated conserva EXECUTE.
-- Las RPC del portal y de torneos ya revocaban a anon (08 y 10A) y no se tocan.

revoke all on function
  public.create_weekly_reservation_series(uuid, uuid, text, text, timestamptz, timestamptz, smallint),
  public.create_weekly_reservation_series(uuid, uuid, text, uuid, text, timestamptz, timestamptz, smallint),
  public.set_club_fee_settings(uuid, bigint, smallint),
  public.generate_membership_dues(uuid, date),
  public.create_individual_membership_due(uuid, uuid, date, bigint),
  public.record_membership_due_payment(uuid, uuid, bigint, date, text, text, text),
  public.void_membership_due_payment(uuid, text),
  public.create_tennis_lesson(uuid, uuid, uuid, timestamptz, timestamptz, text, smallint, uuid[], text),
  public.update_tennis_lesson(uuid, uuid, uuid, timestamptz, timestamptz, text, smallint, uuid[], text),
  public.cancel_tennis_lesson(uuid),
  public.create_weekly_tennis_lesson_series(uuid, uuid, uuid, timestamptz, timestamptz, text, smallint, uuid[], text, smallint),
  public.create_canteen_sale(uuid, jsonb, uuid, text, uuid),
  public.record_canteen_sale_payment(uuid, uuid, bigint, date, text, text, text),
  public.void_canteen_sale(uuid, text)
from public, anon;

grant execute on function
  public.create_weekly_reservation_series(uuid, uuid, text, text, timestamptz, timestamptz, smallint),
  public.create_weekly_reservation_series(uuid, uuid, text, uuid, text, timestamptz, timestamptz, smallint),
  public.set_club_fee_settings(uuid, bigint, smallint),
  public.generate_membership_dues(uuid, date),
  public.create_individual_membership_due(uuid, uuid, date, bigint),
  public.record_membership_due_payment(uuid, uuid, bigint, date, text, text, text),
  public.void_membership_due_payment(uuid, text),
  public.create_tennis_lesson(uuid, uuid, uuid, timestamptz, timestamptz, text, smallint, uuid[], text),
  public.update_tennis_lesson(uuid, uuid, uuid, timestamptz, timestamptz, text, smallint, uuid[], text),
  public.cancel_tennis_lesson(uuid),
  public.create_weekly_tennis_lesson_series(uuid, uuid, uuid, timestamptz, timestamptz, text, smallint, uuid[], text, smallint),
  public.create_canteen_sale(uuid, jsonb, uuid, text, uuid),
  public.record_canteen_sale_payment(uuid, uuid, bigint, date, text, text, text),
  public.void_canteen_sale(uuid, text)
to authenticated;

-- Las funciones nuevas que cree el rol de migraciones en public ya no nacen ejecutables por anon.
-- (No toca el privilegio PUBLIC: cada migración sigue haciendo revoke ... from public explícito.)
alter default privileges in schema public revoke execute on functions from anon;

-- Permisos ANTES de leer/bloquear filas: un usuario sin permiso (o sin sesión) recibe el mismo 42501
-- tanto si el id existe como si no; no se bloquean filas de otros clubes. Cuerpos idénticos salvo el preámbulo.
create or replace function public.void_membership_due_payment(p_payment_id uuid, p_reason text)
returns public.membership_due_payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_payment public.membership_due_payments; v_club_id uuid;
begin
  select club_id into v_club_id from public.membership_due_payments where id = p_payment_id;
  if auth.uid() is null or v_club_id is null or not private.can_manage_finances(v_club_id) then
    raise exception 'No tenés permiso para anular pagos en este club.' using errcode = '42501';
  end if;
  select * into v_payment from public.membership_due_payments where id = p_payment_id for update;
  if not found then raise exception 'El pago no existe.' using errcode = '23503'; end if;
  if v_payment.voided_at is not null then raise exception 'El pago ya fue anulado.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Indicá el motivo de la anulación.' using errcode = '22023'; end if;
  -- Serializa la anulación con cualquier cobro nuevo sobre la misma obligación.
  perform 1 from public.membership_dues where id = v_payment.due_id for update;
  update public.membership_due_payments set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
  where id = v_payment.id returning * into v_payment;
  return v_payment;
end;
$$;

create or replace function public.update_tennis_lesson(
  p_lesson_id uuid, p_coach_id uuid, p_court_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_lesson_type text, p_capacity smallint, p_student_ids uuid[] default '{}'::uuid[], p_notes text default null
) returns public.tennis_lessons
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_lesson public.tennis_lessons; v_club_id uuid;
begin
  select club_id into v_club_id from public.tennis_lessons where id = p_lesson_id;
  if auth.uid() is null or v_club_id is null or not private.is_club_member(v_club_id) then raise exception 'No tenés permiso para modificar esta clase.' using errcode = '42501'; end if;
  select * into v_lesson from public.tennis_lessons where id = p_lesson_id for update;
  if not found then raise exception 'La clase no existe.' using errcode = '23503'; end if;
  if v_lesson.status <> 'scheduled' then raise exception 'No se puede editar una clase cancelada.' using errcode = '22023'; end if;
  if p_ends_at <= p_starts_at or p_lesson_type not in ('individual', 'group') or p_capacity < 1 or (p_lesson_type = 'individual' and p_capacity <> 1) then raise exception 'Los datos de la clase no son válidos.' using errcode = '22023'; end if;
  perform private.validate_tennis_lesson_students(v_lesson.club_id, p_capacity, p_student_ids);
  perform private.assert_coach_available(v_lesson.club_id, p_coach_id, p_starts_at, p_ends_at, v_lesson.id);
  perform set_config('rafa_tenis.lesson_mutation', 'on', true);
  update public.reservations set court_id = p_court_id, starts_at = p_starts_at, ends_at = p_ends_at
  where id = v_lesson.reservation_id and club_id = v_lesson.club_id;
  update public.tennis_lessons set coach_id = p_coach_id, lesson_type = p_lesson_type, capacity = p_capacity,
    notes = nullif(trim(coalesce(p_notes, '')), '') where id = v_lesson.id returning * into v_lesson;
  delete from public.tennis_lesson_students where lesson_id = v_lesson.id;
  insert into public.tennis_lesson_students (lesson_id, club_id, person_id)
  select v_lesson.id, v_lesson.club_id, student_id from unnest(coalesce(p_student_ids, '{}'::uuid[])) as student_id;
  return v_lesson;
end;
$$;

create or replace function public.cancel_tennis_lesson(p_lesson_id uuid)
returns public.tennis_lessons language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_lesson public.tennis_lessons; v_club_id uuid;
begin
  select club_id into v_club_id from public.tennis_lessons where id = p_lesson_id;
  if auth.uid() is null or v_club_id is null or not private.is_club_member(v_club_id) then raise exception 'No tenés permiso para cancelar esta clase.' using errcode = '42501'; end if;
  select * into v_lesson from public.tennis_lessons where id = p_lesson_id for update;
  if not found then raise exception 'La clase no existe.' using errcode = '23503'; end if;
  perform set_config('rafa_tenis.lesson_mutation', 'on', true);
  update public.reservations set status = 'cancelled' where id = v_lesson.reservation_id and club_id = v_lesson.club_id;
  update public.tennis_lessons set status = 'cancelled' where id = v_lesson.id returning * into v_lesson;
  return v_lesson;
end;
$$;

create or replace function public.void_canteen_sale(p_sale_id uuid, p_reason text)
returns public.canteen_sales language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_sale public.canteen_sales; v_club_id uuid;
begin
  select club_id into v_club_id from public.canteen_sales where id = p_sale_id;
  if auth.uid() is null or v_club_id is null or not private.can_manage_canteen_catalog(v_club_id) then raise exception 'No tenés permiso para anular ventas.' using errcode = '42501'; end if;
  select * into v_sale from public.canteen_sales where id = p_sale_id for update;
  if not found then raise exception 'La venta no existe.' using errcode = '23503'; end if;
  if v_sale.status <> 'confirmed' then raise exception 'La venta ya fue anulada.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Indicá el motivo de la anulación.' using errcode = '22023'; end if;
  if exists (select 1 from public.canteen_sale_payments where sale_id = v_sale.id) then raise exception 'No se puede anular una venta que tiene pagos registrados.' using errcode = '22023'; end if;
  update public.canteen_sales set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason) where id = v_sale.id returning * into v_sale;
  return v_sale;
end;
$$;

create or replace function public.revoke_player_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_invitation public.player_invitations; v_club_id uuid;
begin
  select club_id into v_club_id from public.player_invitations where id = p_invitation_id;
  if auth.uid() is null or v_club_id is null or not private.can_manage_club_memberships(v_club_id) then raise exception 'No tenés permiso para revocar esta invitación.' using errcode = '42501'; end if;
  select * into v_invitation from public.player_invitations where id = p_invitation_id for update;
  if not found then raise exception 'La invitación no existe.' using errcode = '23503'; end if;
  if v_invitation.redeemed_at is not null then raise exception 'La invitación ya fue utilizada.' using errcode = '22023'; end if;
  if v_invitation.revoked_at is null then update public.player_invitations set revoked_at = now(), revoked_by = auth.uid() where id = v_invitation.id; end if;
end;
$$;
