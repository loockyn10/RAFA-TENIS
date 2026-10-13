-- Sprint 05: ejecutar manualmente SOLO después de aplicar migraciones 01–05.
-- Reemplazar los identificadores. Todos los bloques mutantes se revierten.
-- Variables: CLUB_A_ID, CLUB_B_ID, ADMIN_A_USER_ID, STAFF_A_USER_ID,
-- ADMIN_B_USER_ID, MEMBERSHIP_A_ID y MEMBERSHIP_B_ID.

-- 1. Configuración: importes positivos, vencimiento 1–28 y permisos owner/admin.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ADMIN_A_USER_ID', true);
select public.set_club_fee_settings('CLUB_A_ID', 3500000, 10);
-- select public.set_club_fee_settings('CLUB_A_ID', 0, 10); -- Esperado: 22023.
-- select public.set_club_fee_settings('CLUB_A_ID', 3500000, 29); -- Esperado: 22023.
rollback;

-- 2. Generar para el período: una cuota por miembro activo y ningún duplicado.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ADMIN_A_USER_ID', true);
select public.set_club_fee_settings('CLUB_A_ID', 3500000, 10);
select * from public.generate_membership_dues('CLUB_A_ID', date '2026-10-01'); -- created_count = activos.
select * from public.generate_membership_dues('CLUB_A_ID', date '2026-10-01'); -- created_count = 0; existing_count = activos.
select membership_id, period, count(*) from public.membership_dues where club_id = 'CLUB_A_ID' group by membership_id, period having count(*) > 1; -- Esperado: 0 filas.
rollback;

-- 3. El cambio de configuración no reescribe importes ya emitidos.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ADMIN_A_USER_ID', true);
select public.set_club_fee_settings('CLUB_A_ID', 3500000, 10);
select public.create_individual_membership_due('CLUB_A_ID', 'MEMBERSHIP_A_ID', date '2026-10-01');
select public.set_club_fee_settings('CLUB_A_ID', 4200000, 15);
select amount_cents, due_date from public.membership_dues where club_id = 'CLUB_A_ID' and membership_id = 'MEMBERSHIP_A_ID' and period = date '2026-10-01'; -- Esperado: 3500000 / 2026-10-10.
rollback;

-- 4. Pagos parciales, acumulación, sobrepago y anulación auditada.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ADMIN_A_USER_ID', true);
select public.set_club_fee_settings('CLUB_A_ID', 3500000, 10);
select public.create_individual_membership_due('CLUB_A_ID', 'MEMBERSHIP_A_ID', date '2026-10-01') as due_id \gset
select public.record_membership_due_payment('CLUB_A_ID', :'due_id', 2000000, date '2026-10-05', 'cash');
select public.record_membership_due_payment('CLUB_A_ID', :'due_id', 1500000, date '2026-10-06', 'bank_transfer') as payment_id \gset
-- select public.record_membership_due_payment('CLUB_A_ID', :'due_id', 1, date '2026-10-07', 'cash'); -- Esperado: 22023 sobrepago.
select public.void_membership_due_payment(:'payment_id', 'Transferencia duplicada');
select coalesce(sum(amount_cents) filter (where voided_at is null), 0) as cobrado_valido from public.membership_due_payments where due_id = :'due_id'; -- Esperado: 2000000.
select voided_at, voided_by, void_reason from public.membership_due_payments where id = :'payment_id'; -- Esperado: datos presentes.
rollback;

-- 5. Aislamiento y permisos: staff y otro club no acceden ni mutan finanzas.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'STAFF_A_USER_ID', true);
select * from public.club_fee_settings where club_id = 'CLUB_A_ID'; -- Esperado: 0 filas.
select * from public.membership_dues where club_id = 'CLUB_A_ID'; -- Esperado: 0 filas.
-- select public.generate_membership_dues('CLUB_A_ID', date '2026-10-01'); -- Esperado: 42501.
select set_config('request.jwt.claim.sub', 'ADMIN_B_USER_ID', true);
select * from public.membership_due_payments where club_id = 'CLUB_A_ID'; -- Esperado: 0 filas.
-- select public.record_membership_due_payment('CLUB_B_ID', 'DUE_FROM_CLUB_A_ID', 100, date '2026-10-01', 'cash'); -- Esperado: 23503.
rollback;

-- 6. Concurrencia (usar DOS sesiones autenticadas como ADMIN_A_USER_ID).
-- Preparar una cuota de 3.500.000 centavos sin pagos y ejecutar al mismo tiempo:
--   select public.record_membership_due_payment('CLUB_A_ID', 'DUE_ID', 2000000, current_date, 'cash');
-- en ambas sesiones. Esperado: una confirma; la segunda falla 22023 por sobrepago.
