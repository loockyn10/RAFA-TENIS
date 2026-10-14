import { describe, expect, it } from 'vitest'
import type { Due, DuePayment } from '../data/mock'
import { dueBalance, dueStatus, parseMoney, periodSummary, personBalance } from './dues'

const due = (id: string, personId: string, period = '2026-10'): Due => ({ id, personId, period, amountCents: 3500000, dueDate: `${period}-10` })
const pay = (dueId: string, amountCents: number, voided = false): DuePayment => ({ id: `${dueId}-${amountCents}-${voided}`, dueId, amountCents, date: '2026-10-05', method: 'cash', voided: voided ? { reason: 'x', date: '2026-10-06' } : undefined })

describe('cuotas', () => {
  it('calcula saldo y estado solo con pagos válidos', () => {
    const d = due('d1', 'p1')
    expect(dueStatus(d, [], '2026-10-01')).toBe('pending')
    expect(dueStatus(d, [], '2026-10-11')).toBe('overdue')
    expect(dueStatus(d, [pay('d1', 1000000)])).toBe('partial')
    expect(dueBalance(d, [pay('d1', 1000000), pay('d1', 2500000, true)])).toBe(2500000)
    expect(dueStatus(d, [pay('d1', 3500000)])).toBe('paid')
  })

  it('resume el período y el saldo por persona', () => {
    const dues = [due('a', 'p1'), due('b', 'p2'), due('c', 'p1', '2026-09')]
    const payments = [pay('a', 3500000), pay('b', 500000)]
    const summary = periodSummary(dues, payments, '2026-10')
    expect(summary).toMatchObject({ issued: 2, paid: 1, partial: 1, unpaid: 0, pendingCents: 3000000 })
    expect(personBalance('p1', dues, payments)).toEqual({ cents: 3500000, months: 1 })
  })

  it('interpreta importes escritos en formato argentino', () => {
    expect(parseMoney('35.000')).toBe(3500000)
    expect(parseMoney('$ 1.234,50')).toBe(123450)
    expect(Number.isNaN(parseMoney('abc'))).toBe(true)
  })
})
