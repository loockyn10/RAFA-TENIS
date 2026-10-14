import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club, MembershipDue, MembershipDuePayment, PaymentMethod } from '../../types/domain'
import { KEY_CONFLICT_MESSAGE, UNCERTAIN_RESULT_MESSAGE, operationFingerprint, runIdempotentOperation } from '../../lib/idempotency'

export type DuePaymentPayload = { amountCents: number; paymentDate: string; paymentMethod: PaymentMethod; reference: string; notes: string }
export type DuePaymentResult = { ok: true; recovered: boolean } | { ok: false; message: string }

const rejectedMessage = 'No pudimos registrar el pago. El saldo puede haber cambiado; recargá e intentá nuevamente.'

// Registra un pago de cuota con identidad estable (SEC-05): reintentar el mismo pago (mismo importe, fecha, método,
// referencia y observaciones sobre la misma cuota) reutiliza la clave y PostgreSQL devuelve el pago original en lugar
// de crear otro. Un pago distinto —aunque tenga el mismo importe— cambia la huella y recibe una clave nueva.
export async function recordDuePayment(client: SupabaseClient, club: Club, due: MembershipDue, payload: DuePaymentPayload): Promise<DuePaymentResult> {
  const reference = payload.reference.trim() || null
  const notes = payload.notes.trim() || null
  const outcome = await runIdempotentOperation<MembershipDuePayment>({
    scope: `due-payment:${club.id}:${due.id}`,
    fingerprint: operationFingerprint({ amount: payload.amountCents, date: payload.paymentDate, method: payload.paymentMethod, reference, notes }),
    call: (key, signal) => client.rpc('record_membership_due_payment', { p_club_id: club.id, p_due_id: due.id, p_amount_cents: payload.amountCents, p_payment_date: payload.paymentDate, p_payment_method: payload.paymentMethod, p_reference: reference, p_notes: notes, p_client_request_id: key }).abortSignal(signal),
    recover: async (key) => {
      const { data, error } = await client.from('membership_due_payments').select('id, club_id, due_id, amount_cents, payment_date, payment_method, reference, notes, created_at, created_by, voided_at, voided_by, void_reason').eq('club_id', club.id).eq('client_request_id', key).maybeSingle()
      if (error) throw error
      return data as MembershipDuePayment | null
    },
  })
  if (outcome.status === 'ok') return { ok: true, recovered: outcome.recovered }
  return { ok: false, message: outcome.status === 'uncertain' ? UNCERTAIN_RESULT_MESSAGE : outcome.status === 'conflict' ? KEY_CONFLICT_MESSAGE : rejectedMessage }
}
