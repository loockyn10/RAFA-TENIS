import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountItem, Club, CourtBillingMode, CourtCharge, CourtChargePayment, CourtRateHistoryEntry, CourtRateSettings, PaymentMethod } from '../../types/domain'
import { KEY_CONFLICT_MESSAGE, UNCERTAIN_RESULT_MESSAGE, operationFingerprint, runIdempotentOperation } from '../../lib/idempotency'

export const chargeFields = 'id, club_id, reservation_id, responsible_person_id, responsible_name_snapshot, member_status, billable_minutes, rental_applied, lighting_applied, rental_hour_cents_snapshot, lighting_hour_cents_snapshot, billing_mode_snapshot, billing_block_minutes_snapshot, calculated_rental_cents, calculated_lighting_cents, rental_cents, lighting_cents, total_cents, adjustment_reason, notes, status, client_request_id, created_at, created_by, voided_at, voided_by, void_reason'
export const chargePaymentFields = 'id, club_id, charge_id, amount_cents, payment_date, payment_method, reference, notes, client_request_id, created_at, created_by, voided_at, voided_by, void_reason'
const rateFields = 'club_id, rental_hour_cents, lighting_hour_cents, rental_enabled, lighting_enabled, billing_mode, billing_block_minutes, updated_at, updated_by'

export type OperationResult<T = void> = { ok: true; data: T | null; recovered: boolean } | { ok: false; message: string }

// Los mensajes de negocio del servidor (22023/23503/42501) están en español y se muestran tal cual; cualquier otro error se
// reemplaza por un texto genérico. Un resultado incierto conserva la clave para reintentar sin duplicar (10B.2).
const GENERIC_REJECTION = 'No pudimos completar la operación. Recargá e intentá nuevamente.'
function toResult<T>(outcome: Awaited<ReturnType<typeof runIdempotentOperation<T>>>): OperationResult<T> {
  if (outcome.status === 'ok') return { ok: true, data: outcome.data, recovered: outcome.recovered }
  if (outcome.status === 'uncertain') return { ok: false, message: UNCERTAIN_RESULT_MESSAGE }
  if (outcome.status === 'conflict') return { ok: false, message: KEY_CONFLICT_MESSAGE }
  return { ok: false, message: outcome.message && !/^(\w+: |ERROR)/.test(outcome.message) && outcome.message.length < 200 ? outcome.message : GENERIC_REJECTION }
}

export type ChargeInput = {
  reservationId: string
  responsiblePersonId: string
  applyRental: boolean
  applyLighting: boolean
  billableMinutes: number
  rentalOverrideCents: number | null
  lightingOverrideCents: number | null
  adjustmentReason: string
  notes: string
}

/** Registra un cargo con identidad estable: reintentar el MISMO cargo reutiliza la clave y el servidor devuelve el original. */
export async function createCourtCharge(client: SupabaseClient, club: Club, input: ChargeInput): Promise<OperationResult<CourtCharge>> {
  const reason = input.adjustmentReason.trim() || null
  const notes = input.notes.trim() || null
  return toResult(await runIdempotentOperation<CourtCharge>({
    scope: `court-charge:${club.id}:${input.reservationId}`,
    fingerprint: operationFingerprint({ person: input.responsiblePersonId, rental: input.applyRental, lighting: input.applyLighting, minutes: input.billableMinutes, rov: input.rentalOverrideCents, lov: input.lightingOverrideCents, reason, notes }),
    call: (key, signal) => client.rpc('create_court_charge', {
      p_club_id: club.id, p_reservation_id: input.reservationId, p_responsible_person_id: input.responsiblePersonId,
      p_apply_rental: input.applyRental, p_apply_lighting: input.applyLighting, p_client_request_id: key, p_billable_minutes: input.billableMinutes,
      p_rental_override_cents: input.rentalOverrideCents, p_lighting_override_cents: input.lightingOverrideCents, p_adjustment_reason: reason, p_notes: notes,
    }).abortSignal(signal),
    recover: async (key) => {
      const { data, error } = await client.from('court_charges').select(chargeFields).eq('club_id', club.id).eq('client_request_id', key).maybeSingle()
      if (error) throw error
      return data as CourtCharge | null
    },
  }))
}

export type ChargePaymentInput = { amountCents: number; paymentDate: string; paymentMethod: PaymentMethod; reference: string; notes: string }

export async function recordCourtChargePayment(client: SupabaseClient, club: Club, chargeId: string, payload: ChargePaymentInput): Promise<OperationResult<CourtChargePayment>> {
  const reference = payload.reference.trim() || null
  const notes = payload.notes.trim() || null
  return toResult(await runIdempotentOperation<CourtChargePayment>({
    scope: `court-payment:${club.id}:${chargeId}`,
    fingerprint: operationFingerprint({ amount: payload.amountCents, date: payload.paymentDate, method: payload.paymentMethod, reference, notes }),
    call: (key, signal) => client.rpc('record_court_charge_payment', {
      p_club_id: club.id, p_charge_id: chargeId, p_amount_cents: payload.amountCents, p_payment_date: payload.paymentDate,
      p_payment_method: payload.paymentMethod, p_client_request_id: key, p_reference: reference, p_notes: notes,
    }).abortSignal(signal),
    recover: async (key) => {
      const { data, error } = await client.from('court_charge_payments').select(chargePaymentFields).eq('club_id', club.id).eq('client_request_id', key).maybeSingle()
      if (error) throw error
      return data as CourtChargePayment | null
    },
  }))
}

type SimpleResult = { ok: true } | { ok: false; message: string }
const businessMessage = (error: { code?: string | null; message?: string | null }) => (['22023', '23503', '42501'].includes(error.code ?? '') && error.message ? error.message : GENERIC_REJECTION)

export async function voidCourtCharge(client: SupabaseClient, chargeId: string, reason: string): Promise<SimpleResult> {
  const { error } = await client.rpc('void_court_charge', { p_charge_id: chargeId, p_reason: reason.trim() })
  return error ? { ok: false, message: businessMessage(error) } : { ok: true }
}
export async function voidCourtChargePayment(client: SupabaseClient, paymentId: string, reason: string): Promise<SimpleResult> {
  const { error } = await client.rpc('void_court_charge_payment', { p_payment_id: paymentId, p_reason: reason.trim() })
  return error ? { ok: false, message: businessMessage(error) } : { ok: true }
}

export type RatesInput = { rentalHourCents: number | null; lightingHourCents: number | null; rentalEnabled: boolean; lightingEnabled: boolean; billingMode: CourtBillingMode; billingBlockMinutes: number | null }
export async function saveCourtRates(client: SupabaseClient, club: Club, input: RatesInput): Promise<SimpleResult> {
  const { error } = await client.rpc('set_court_rate_settings', {
    p_club_id: club.id, p_rental_hour_cents: input.rentalHourCents, p_lighting_hour_cents: input.lightingHourCents, p_rental_enabled: input.rentalEnabled,
    p_lighting_enabled: input.lightingEnabled, p_billing_mode: input.billingMode, p_billing_block_minutes: input.billingMode === 'rounded_up' ? input.billingBlockMinutes : null,
  })
  return error ? { ok: false, message: businessMessage(error) } : { ok: true }
}

export async function fetchCourtRates(client: SupabaseClient, club: Club): Promise<CourtRateSettings | null> {
  const { data, error } = await client.from('club_court_rate_settings').select(rateFields).eq('club_id', club.id).maybeSingle()
  if (error) throw error
  return data as CourtRateSettings | null
}
export async function fetchCourtRateHistory(client: SupabaseClient, club: Club): Promise<CourtRateHistoryEntry[]> {
  const { data, error } = await client.from('club_court_rate_history').select('id, club_id, rental_hour_cents, lighting_hour_cents, rental_enabled, lighting_enabled, billing_mode, billing_block_minutes, changed_at, changed_by').eq('club_id', club.id).order('changed_at', { ascending: false }).limit(20)
  if (error) throw error
  return (data ?? []) as CourtRateHistoryEntry[]
}

/** Cargo VIGENTE de una reserva (más sus anulados anteriores para el historial) y todos sus pagos. */
export async function fetchReservationCharges(client: SupabaseClient, club: Club, reservationId: string): Promise<{ charges: CourtCharge[]; payments: CourtChargePayment[] }> {
  const { data, error } = await client.from('court_charges').select(chargeFields).eq('club_id', club.id).eq('reservation_id', reservationId).order('created_at', { ascending: false })
  if (error) throw error
  const charges = (data ?? []) as CourtCharge[]
  return { charges, payments: await fetchChargePayments(client, club, charges.map((charge) => charge.id)) }
}
export async function fetchChargePayments(client: SupabaseClient, club: Club, chargeIds: string[]): Promise<CourtChargePayment[]> {
  if (chargeIds.length === 0) return []
  const { data, error } = await client.from('court_charge_payments').select(chargePaymentFields).eq('club_id', club.id).in('charge_id', chargeIds).order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as CourtChargePayment[]
}
export async function fetchCharge(client: SupabaseClient, club: Club, chargeId: string): Promise<{ charge: CourtCharge; payments: CourtChargePayment[] } | null> {
  const { data, error } = await client.from('court_charges').select(chargeFields).eq('club_id', club.id).eq('id', chargeId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return { charge: data as CourtCharge, payments: await fetchChargePayments(client, club, [chargeId]) }
}

/** Cuenta corriente consolidada (solo lectura sobre cuotas, cantina y cargos de cancha). */
export async function fetchPersonAccount(client: SupabaseClient, club: Club, personId: string, includeSettled: boolean): Promise<AccountItem[]> {
  const { data, error } = await client.rpc('get_person_account', { p_club_id: club.id, p_person_id: personId, p_include_settled: includeSettled })
  if (error) throw error
  return ((data ?? []) as AccountItem[]).map((item) => ({ ...item, original_cents: Number(item.original_cents), paid_cents: Number(item.paid_cents), balance_cents: Number(item.balance_cents) }))
}
