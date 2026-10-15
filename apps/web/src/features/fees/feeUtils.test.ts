import { describe, expect, it } from 'vitest'
import type { MembershipDue, MembershipDuePayment } from '../../types/domain'
import { balanceCents, displayDueStatus, dueStatus, firstDayOfMonth, formatArs, isOverdue, parseArsToCents, periodLabel, periodShort, shiftPeriod } from './feeUtils'

const due: MembershipDue = { id: 'due-1', club_id: 'club-1', membership_id: 'member-1', period: '2026-10-01', amount_cents: 3500000, due_date: '2026-10-10', created_at: '', created_by: '' }
const payment = (amount_cents: number, voided_at: string | null = null): MembershipDuePayment => ({ id: crypto.randomUUID(), club_id: 'club-1', due_id: 'due-1', amount_cents, payment_date: '2026-10-05', payment_method: 'cash', reference: null, notes: null, created_at: '', created_by: '', voided_at, voided_by: null, void_reason: null })

describe('fee utilities', () => {
  it('convierte ARS a centavos sin flotantes', () => {
    expect(parseArsToCents('35.000')).toBe(3500000)
    expect(parseArsToCents('35.000,50')).toBe(3500050)
    expect(parseArsToCents('0')).toBeNull()
    expect(parseArsToCents('-10')).toBeNull()
    expect(formatArs(3500000)).toContain('35.000')
  })
  it('calcula pagos parciales, acumulados y excluye anulados', () => {
    const payments = [payment(2000000), payment(1500000), payment(1000000, '2026-10-06T00:00:00Z')]
    expect(balanceCents(due, payments)).toBe(0)
    expect(dueStatus(due, payments)).toBe('paid')
    expect(balanceCents(due, [payment(2000000)])).toBe(1500000)
    expect(dueStatus(due, [payment(2000000)])).toBe('partial')
    expect(isOverdue(due, [payment(2000000)], '2026-10-11')).toBe(true)
    expect(dueStatus(due, [])).toBe('pending')
  })
  it('normaliza meses válidos para emitir una cuota', () => {
    expect(firstDayOfMonth('2026-10')).toBe('2026-10-01')
    expect(firstDayOfMonth('2026-10-01')).toBeNull()
  })
})

describe('estado visible de cuotas', () => {
  const due = { id: 'd', club_id: 'c', membership_id: 'm', period: '2026-10-01', amount_cents: 100000, due_date: '2026-10-10', created_at: '', created_by: 'u' }
  const payment = (cents: number, voided = false) => ({ id: `p${cents}`, club_id: 'c', due_id: 'd', amount_cents: cents, payment_date: '2026-10-05', payment_method: 'cash' as const, reference: null, notes: null, created_at: '', created_by: 'u', voided_at: voided ? 'x' : null, voided_by: null, void_reason: null })

  it('una cuota sin pagos vencida figura como Vencida; con pago parcial sigue Parcial', () => {
    expect(displayDueStatus(due, [], '2026-10-11')).toBe('overdue')
    expect(displayDueStatus(due, [], '2026-10-09')).toBe('pending')
    expect(displayDueStatus(due, [payment(40000)], '2026-10-11')).toBe('partial')
    expect(displayDueStatus(due, [payment(100000)], '2026-10-11')).toBe('paid')
  })

  it('los pagos anulados no cuentan para el saldo', () => {
    expect(displayDueStatus(due, [payment(100000, true)], '2026-10-09')).toBe('pending')
  })

  it('períodos: etiqueta y desplazamiento de meses', () => {
    expect(periodLabel('2026-10')).toBe('Octubre 2026')
    expect(periodShort('2026-10-01')).toBe('Oct')
    expect(shiftPeriod('2026-11', 2)).toBe('2027-01')
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12')
  })
})
