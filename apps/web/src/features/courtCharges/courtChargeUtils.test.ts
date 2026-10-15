import { describe, expect, it } from 'vitest'
import type { AccountItem, CourtCharge, CourtChargePayment, CourtRateSettings } from '../../types/domain'
import { accountBreakdown, accountTotal, balanceOnCharge, billableMinutes, chargeAmountCents, chargeStatus, isAccountItemOverdue, isAdjusted, paidOnCharge, quoteCharge, reservationMinutes, suggestedConcepts } from './courtChargeUtils'

// Valores de PRUEBA (no son tarifas del club).
const rates = (patch: Partial<CourtRateSettings> = {}): CourtRateSettings => ({ club_id: 'c', rental_hour_cents: 1000000, lighting_hour_cents: 400000, rental_enabled: true, lighting_enabled: true, billing_mode: 'exact', billing_block_minutes: null, updated_at: '', updated_by: 'u', ...patch })
const charge = (patch: Partial<CourtCharge> = {}): CourtCharge => ({ id: 'ch1', club_id: 'c', reservation_id: 'r', responsible_person_id: 'p', responsible_name_snapshot: 'Ana', member_status: 'non_member', billable_minutes: 60, rental_applied: true, lighting_applied: false, rental_hour_cents_snapshot: 1000000, lighting_hour_cents_snapshot: null, billing_mode_snapshot: 'exact', billing_block_minutes_snapshot: null, calculated_rental_cents: 1000000, calculated_lighting_cents: null, rental_cents: 1000000, lighting_cents: 0, total_cents: 1000000, adjustment_reason: null, notes: null, status: 'confirmed', client_request_id: 'k', created_at: '', created_by: 'u', voided_at: null, voided_by: null, void_reason: null, ...patch })
const payment = (id: string, amount: number, voided = false): CourtChargePayment => ({ id, club_id: 'c', charge_id: 'ch1', amount_cents: amount, payment_date: '2026-10-14', payment_method: 'cash', reference: null, notes: null, client_request_id: id, created_at: '', created_by: 'u', voided_at: voided ? '2026-10-15T00:00:00Z' : null, voided_by: voided ? 'u' : null, void_reason: voided ? 'x' : null })
const item = (patch: Partial<AccountItem>): AccountItem => ({ concept: 'canteen', source_id: 's', occurred_on: '2026-10-14', due_date: null, description: '', original_cents: 100, paid_cents: 0, balance_cents: 100, status: 'pending', reservation_id: null, ...patch })

describe('cálculo de cargos de cancha', () => {
  it('90 minutos exactos NO se cobran como 2 horas', () => {
    expect(chargeAmountCents(1000000, 90, 'exact', null)).toBe(1500000)
    expect(chargeAmountCents(400000, 90, 'exact', null)).toBe(600000)
  })
  it('el precio es por cancha y tiempo: no depende de la cantidad de jugadores', () => {
    expect(chargeAmountCents(1000000, 60, 'exact', null)).toBe(1000000)
  })
  it('redondeo hacia arriba por bloques (opcional y configurable)', () => {
    expect(billableMinutes(100, 'rounded_up', 30)).toBe(120)
    expect(billableMinutes(90, 'rounded_up', 30)).toBe(90)
    expect(billableMinutes(75, 'rounded_up', 60)).toBe(120)
    expect(chargeAmountCents(1200000, 100, 'rounded_up', 30)).toBe(2400000)
  })
  it('redondea al centavo', () => {
    expect(chargeAmountCents(1000001, 20, 'exact', null)).toBe(333334)
  })
  it('quoteCharge usa la tarifa vigente y omite los conceptos inactivos o sin precio', () => {
    expect(quoteCharge(rates(), 60)).toEqual({ rentalCents: 1000000, lightingCents: 400000 })
    expect(quoteCharge(rates({ lighting_enabled: false }), 60)).toEqual({ rentalCents: 1000000, lightingCents: null })
    expect(quoteCharge(rates({ rental_hour_cents: null, rental_enabled: false }), 60).rentalCents).toBeNull()
    expect(quoteCharge(null, 60)).toEqual({ rentalCents: null, lightingCents: null })
    expect(quoteCharge(rates(), 0)).toEqual({ rentalCents: null, lightingCents: null })
  })
  it('duración reservada', () => {
    expect(reservationMinutes('2026-10-20T21:00:00Z', '2026-10-20T22:30:00Z')).toBe(90)
  })
  it('sugerencias: nunca iluminación por defecto; alquiler solo para no socios (editable)', () => {
    expect(suggestedConcepts(true)).toEqual({ rental: false, lighting: false })
    expect(suggestedConcepts(false)).toEqual({ rental: true, lighting: false })
  })
})

describe('saldos y estado del cargo', () => {
  it('los pagos anulados no cuentan', () => {
    const payments = [payment('a', 400000), payment('b', 300000, true)]
    expect(paidOnCharge('ch1', payments)).toBe(400000)
    expect(balanceOnCharge(charge(), payments)).toBe(600000)
    expect(chargeStatus(charge(), payments)).toBe('partial')
  })
  it('pendiente, pagado y anulado', () => {
    expect(chargeStatus(charge(), [])).toBe('pending')
    expect(chargeStatus(charge(), [payment('a', 1000000)])).toBe('paid')
    expect(chargeStatus(charge({ status: 'voided' }), [])).toBe('voided')
    expect(balanceOnCharge(charge({ status: 'voided' }), [])).toBe(0)
  })
  it('detecta ajustes manuales respecto del cálculo', () => {
    expect(isAdjusted(charge())).toBe(false)
    expect(isAdjusted(charge({ rental_cents: 900000, total_cents: 900000 }))).toBe(true)
    expect(isAdjusted(charge({ calculated_rental_cents: null }))).toBe(true)
  })
})

describe('cuenta corriente: totales y desglose', () => {
  const items = [
    item({ concept: 'membership_due', balance_cents: 400000 }),
    item({ concept: 'canteen', balance_cents: 200000 }),
    item({ concept: 'court_lighting', balance_cents: 350000 }),
    item({ concept: 'court_lighting', balance_cents: 300000 }),
    item({ concept: 'court_rental', balance_cents: 0, status: 'paid' }),
    item({ concept: 'canteen', balance_cents: 0, status: 'voided' }),
  ]
  it('el total es la suma de saldos y los saldados/anulados no suman', () => {
    expect(accountTotal(items)).toBe(1250000)
  })
  it('desglose por concepto, solo con saldo, en orden estable', () => {
    expect(accountBreakdown(items).map((row) => [row.concept, row.count, row.balanceCents])).toEqual([['membership_due', 1, 400000], ['canteen', 1, 200000], ['court_lighting', 2, 650000]])
  })
  it('«vencida» es solo presentación de cuotas sin pagos', () => {
    expect(isAccountItemOverdue(item({ concept: 'membership_due', due_date: '2026-10-10' }), '2026-10-14')).toBe(true)
    expect(isAccountItemOverdue(item({ concept: 'membership_due', due_date: '2026-10-10', status: 'partial' }), '2026-10-14')).toBe(false)
    expect(isAccountItemOverdue(item({ concept: 'canteen' }), '2026-10-14')).toBe(false)
  })
})
