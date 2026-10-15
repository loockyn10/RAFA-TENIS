import type { AccountConcept, AccountItem, AccountItemStatus, CourtBillingMode, CourtCharge, CourtChargePayment, CourtRateSettings } from '../../types/domain'

// Cálculo de vista previa. La fuente de verdad es `private.court_billable_amount` en PostgreSQL (el servidor recalcula y
// congela el resultado): esta función debe dar exactamente lo mismo para que la previsualización no engañe.

/** Minutos facturables: exactos o redondeados HACIA ARRIBA al bloque configurado (nunca se asume «2 horas» para 90 min). */
export function billableMinutes(minutes: number, mode: CourtBillingMode, blockMinutes: number | null): number {
  if (mode === 'rounded_up' && blockMinutes) return Math.ceil(minutes / blockMinutes) * blockMinutes
  return minutes
}

/** tarifa/hora × minutos / 60, al centavo (mitad hacia arriba). */
export function chargeAmountCents(hourCents: number, minutes: number, mode: CourtBillingMode, blockMinutes: number | null): number {
  return Math.round((hourCents * billableMinutes(minutes, mode, blockMinutes)) / 60)
}

export type RateQuote = { rentalCents: number | null; lightingCents: number | null }

/** Importe calculado con la tarifa VIGENTE; null si ese concepto no tiene tarifa activa (solo podría cargarse a mano). */
export function quoteCharge(settings: CourtRateSettings | null, minutes: number): RateQuote {
  if (!settings || minutes <= 0) return { rentalCents: null, lightingCents: null }
  const price = (enabled: boolean, hourCents: number | null) => (enabled && hourCents ? chargeAmountCents(hourCents, minutes, settings.billing_mode, settings.billing_block_minutes) : null)
  return { rentalCents: price(settings.rental_enabled, settings.rental_hour_cents), lightingCents: price(settings.lighting_enabled, settings.lighting_hour_cents) }
}

/** Duración reservada en minutos (a partir de los ISO de la reserva). */
export function reservationMinutes(startsAt: string, endsAt: string): number {
  return Math.max(0, Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000))
}

/** Valores iniciales sugeridos del formulario. No obliga a nada: Rafa decide qué cobrar (iluminación jamás por defecto). */
export function suggestedConcepts(isMember: boolean): { rental: boolean; lighting: boolean } {
  return { rental: !isMember, lighting: false }
}

export function paidOnCharge(chargeId: string, payments: CourtChargePayment[]): number {
  return payments.filter((payment) => payment.charge_id === chargeId && payment.voided_at === null).reduce((sum, payment) => sum + payment.amount_cents, 0)
}
export function balanceOnCharge(charge: CourtCharge, payments: CourtChargePayment[]): number {
  return charge.status === 'voided' ? 0 : Math.max(0, charge.total_cents - paidOnCharge(charge.id, payments))
}
export type ChargeStatus = 'pending' | 'partial' | 'paid' | 'voided'
export function chargeStatus(charge: CourtCharge, payments: CourtChargePayment[]): ChargeStatus {
  if (charge.status === 'voided') return 'voided'
  const paid = paidOnCharge(charge.id, payments)
  if (paid >= charge.total_cents) return 'paid'
  return paid > 0 ? 'partial' : 'pending'
}
export const CHARGE_STATUS_LABEL: Record<ChargeStatus, string> = { pending: 'Pendiente', partial: 'Pago parcial', paid: 'Pagado', voided: 'Anulado' }

/** Texto de lo cobrado: «Alquiler», «Iluminación» o «Alquiler + iluminación». */
export function chargeConceptLabel(charge: Pick<CourtCharge, 'rental_applied' | 'lighting_applied'>): string {
  return charge.rental_applied && charge.lighting_applied ? 'Alquiler + iluminación' : charge.lighting_applied ? 'Iluminación' : 'Alquiler'
}

/** ¿El importe final difiere de lo calculado con la tarifa (ajuste manual autorizado)? */
export function isAdjusted(charge: CourtCharge): boolean {
  return (charge.rental_applied && charge.rental_cents !== charge.calculated_rental_cents) || (charge.lighting_applied && charge.lighting_cents !== charge.calculated_lighting_cents)
}

// ── Cuenta corriente ──
export const ACCOUNT_CONCEPT_LABEL: Record<AccountConcept, string> = {
  membership_due: 'Cuota', canteen: 'Cantina', court_rental: 'Alquiler de cancha', court_lighting: 'Iluminación', court_rental_lighting: 'Cancha + iluminación',
}
export const ACCOUNT_STATUS_LABEL: Record<AccountItemStatus, string> = { pending: 'Pendiente', partial: 'Pago parcial', paid: 'Pagado', voided: 'Anulado' }
const CONCEPT_ORDER: AccountConcept[] = ['membership_due', 'canteen', 'court_rental', 'court_lighting', 'court_rental_lighting']

export type AccountBreakdown = { concept: AccountConcept; label: string; count: number; balanceCents: number }

/** Total adeudado = suma de saldos pendientes (el servidor ya excluye pagos anulados y deja en 0 lo anulado). */
export function accountTotal(items: AccountItem[]): number {
  return items.reduce((sum, item) => sum + item.balance_cents, 0)
}

/** Desglose por concepto de lo que se debe. Solo aparecen conceptos con saldo. */
export function accountBreakdown(items: AccountItem[]): AccountBreakdown[] {
  const rows = new Map<AccountConcept, AccountBreakdown>()
  for (const item of items) {
    if (item.balance_cents <= 0) continue
    const current = rows.get(item.concept) ?? { concept: item.concept, label: ACCOUNT_CONCEPT_LABEL[item.concept], count: 0, balanceCents: 0 }
    current.count += 1
    current.balanceCents += item.balance_cents
    rows.set(item.concept, current)
  }
  return CONCEPT_ORDER.flatMap((concept) => rows.get(concept) ?? [])
}

/** Presentación: una cuota sin pagos con vencimiento pasado figura «Vencida» (no cambia el saldo). */
export function isAccountItemOverdue(item: AccountItem, today: string): boolean {
  return item.concept === 'membership_due' && item.status === 'pending' && item.due_date !== null && item.due_date < today
}

export function isCourtConcept(concept: AccountConcept): boolean {
  return concept === 'court_rental' || concept === 'court_lighting' || concept === 'court_rental_lighting'
}
