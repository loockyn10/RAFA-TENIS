import { TODAY, type Due, type DuePayment } from '../data/mock'

/** Estado de una cuota calculado desde sus pagos válidos (nunca un saldo guardado). */
export type DueStatus = 'paid' | 'partial' | 'overdue' | 'pending'

export const DUE_STATUS_LABEL: Record<DueStatus, string> = {
  paid: 'Pagada',
  partial: 'Pago parcial',
  overdue: 'Vencida',
  pending: 'Pendiente',
}

export function validPayments(due: Due, payments: DuePayment[]): DuePayment[] {
  return payments.filter((payment) => payment.dueId === due.id && !payment.voided)
}

export function duePaid(due: Due, payments: DuePayment[]): number {
  return validPayments(due, payments).reduce((sum, payment) => sum + payment.amountCents, 0)
}

export function dueBalance(due: Due, payments: DuePayment[]): number {
  return Math.max(0, due.amountCents - duePaid(due, payments))
}

export function dueStatus(due: Due, payments: DuePayment[], today = TODAY): DueStatus {
  const paid = duePaid(due, payments)
  if (paid >= due.amountCents) return 'paid'
  if (paid > 0) return 'partial'
  return due.dueDate < today ? 'overdue' : 'pending'
}

export type PeriodSummary = { issued: number; amountCents: number; collectedCents: number; pendingCents: number; paid: number; partial: number; unpaid: number }

export function periodSummary(dues: Due[], payments: DuePayment[], period: string): PeriodSummary {
  const list = dues.filter((due) => due.period === period)
  return list.reduce<PeriodSummary>((acc, due) => {
    const status = dueStatus(due, payments)
    const paid = duePaid(due, payments)
    return {
      issued: acc.issued + 1,
      amountCents: acc.amountCents + due.amountCents,
      collectedCents: acc.collectedCents + Math.min(paid, due.amountCents),
      pendingCents: acc.pendingCents + dueBalance(due, payments),
      paid: acc.paid + (status === 'paid' ? 1 : 0),
      partial: acc.partial + (status === 'partial' ? 1 : 0),
      unpaid: acc.unpaid + (status === 'pending' || status === 'overdue' ? 1 : 0),
    }
  }, { issued: 0, amountCents: 0, collectedCents: 0, pendingCents: 0, paid: 0, partial: 0, unpaid: 0 })
}

/** Saldo total adeudado por persona, sumando todos los períodos. */
export function personBalance(personId: string, dues: Due[], payments: DuePayment[]): { cents: number; months: number } {
  return dues.filter((due) => due.personId === personId).reduce((acc, due) => {
    const balance = dueBalance(due, payments)
    return balance > 0 ? { cents: acc.cents + balance, months: acc.months + 1 } : acc
  }, { cents: 0, months: 0 })
}

const monthLong = new Intl.DateTimeFormat('es-AR', { month: 'long' })
const monthShort = new Intl.DateTimeFormat('es-AR', { month: 'short' })
const toDate = (period: string) => { const [y, m] = period.split('-').map(Number); return new Date(y, m - 1, 1, 12) }

export function periodLabel(period: string, withYear = true): string {
  const date = toDate(period)
  const month = monthLong.format(date)
  return `${month.charAt(0).toUpperCase()}${month.slice(1)}${withYear ? ` ${date.getFullYear()}` : ''}`
}

export function periodShort(period: string): string {
  const label = monthShort.format(toDate(period)).replace('.', '')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** Monto ingresado como texto «35.000» o «35000,50» → centavos enteros. NaN si no es válido. */
export function parseMoney(text: string): number {
  const clean = text.replace(/\$/g, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  if (clean === '') return Number.NaN
  const value = Number(clean)
  return Number.isFinite(value) ? Math.round(value * 100) : Number.NaN
}

export function moneyInputValue(cents: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(cents / 100)
}
