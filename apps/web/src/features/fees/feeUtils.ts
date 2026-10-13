import type { MembershipDue, MembershipDuePayment } from '../../types/domain'

export type DueStatus = 'pending' | 'partial' | 'paid'

export function parseArsToCents(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const [whole, decimals = ''] = normalized.split('.')
  const cents = Number(whole) * 100 + Number((decimals + '00').slice(0, 2))
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}

export function formatArs(cents: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)
}

export function validPaymentsForDue(dueId: string, payments: MembershipDuePayment[]) {
  return payments.filter((payment) => payment.due_id === dueId && payment.voided_at === null)
}

export function paidCents(dueId: string, payments: MembershipDuePayment[]) {
  return validPaymentsForDue(dueId, payments).reduce((sum, payment) => sum + payment.amount_cents, 0)
}

export function balanceCents(due: MembershipDue, payments: MembershipDuePayment[]) {
  return Math.max(0, due.amount_cents - paidCents(due.id, payments))
}

export function dueStatus(due: MembershipDue, payments: MembershipDuePayment[]): DueStatus {
  const balance = balanceCents(due, payments)
  if (balance === 0) return 'paid'
  return paidCents(due.id, payments) > 0 ? 'partial' : 'pending'
}

export function isOverdue(due: MembershipDue, payments: MembershipDuePayment[], today: string) {
  return balanceCents(due, payments) > 0 && due.due_date < today
}

export function firstDayOfMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : null
}

export function monthLabel(period: string, timezone = 'America/Argentina/Buenos_Aires') {
  const [year, month] = period.split('-').map(Number)
  return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: timezone }).format(new Date(Date.UTC(year, month - 1, 1, 12)))
}

export function todayInClubTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
