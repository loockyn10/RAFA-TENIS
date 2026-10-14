-- Sprint 10B.1 / SEC-04: el portal contaba pagos anulados como pagados (paid_cents y balance_cents).
-- Dependencias: 20261013080000_player_portal.sql (función original) y las migraciones de cuotas (04). Independiente de las otras 10B.1.
-- Solo cambia el cálculo al leer: sum(...) filter (where voided_at is null). No modifica importes ni registros financieros;
-- los pagos anulados siguen existiendo en membership_due_payments (historial/administración) y el portal solo lista los válidos.
-- Alcance: únicamente cuotas de la persona vinculada del club (assert_portal_access + m.person_id = v_person_id).

create or replace function public.player_membership_dues(p_club_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_person_id uuid;
begin
  v_person_id := private.assert_portal_access(p_club_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'period', d.period, 'due_date', d.due_date, 'amount_cents', d.amount_cents,
      'paid_cents', coalesce(pay.paid_cents, 0),
      'balance_cents', d.amount_cents - coalesce(pay.paid_cents, 0),
      'payments', coalesce(pay.payments, '[]'::jsonb)
    ) order by d.period desc)
    from public.membership_dues d
    join public.club_memberships m on m.id = d.membership_id and m.club_id = d.club_id
    left join lateral (
      select coalesce(sum(p.amount_cents) filter (where p.voided_at is null), 0) as paid_cents,
             jsonb_agg(jsonb_build_object('amount_cents', p.amount_cents, 'payment_date', p.payment_date, 'payment_method', p.payment_method) order by p.payment_date, p.created_at) filter (where p.voided_at is null) as payments
      from public.membership_due_payments p
      where p.club_id = d.club_id and p.due_id = d.id
    ) pay on true
    where d.club_id = p_club_id and m.person_id = v_person_id
  ), '[]'::jsonb);
end;
$$;

-- create or replace conserva los privilegios; se reafirman por claridad (solo authenticated).
revoke all on function public.player_membership_dues(uuid) from public, anon;
grant execute on function public.player_membership_dues(uuid) to authenticated;
