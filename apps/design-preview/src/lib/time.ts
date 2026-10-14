/** Minutos desde la medianoche, hora local del club (America/Argentina/Buenos_Aires en la app real). */
export type Minutes = number
export type Interval = { start: Minutes; end: Minutes }

export const DAY_OPEN: Minutes = 7 * 60
export const DAY_CLOSE: Minutes = 23 * 60
export const SLOT: Minutes = 30

export function hhmm(min: Minutes): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function range(interval: Interval): string {
  return `${hhmm(interval.start)}–${hhmm(interval.end)}`
}

export function duration(min: Minutes): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m}`
}

export function slots(open: Minutes = DAY_OPEN, close: Minutes = DAY_CLOSE, step: Minutes = SLOT): Minutes[] {
  const out: Minutes[] = []
  for (let t = open; t < close; t += step) out.push(t)
  return out
}

/** Turnos contiguos no se superponen (igual que la exclusión GiST con rango [inicio, fin) ). */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

// ── Fechas como ISO yyyy-mm-dd (sin zona) ─────────────────────────
export function toISO(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

export function addDays(iso: string, days: number): string {
  const date = fromISO(iso)
  date.setDate(date.getDate() + days)
  return toISO(date)
}

const longDay = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
const shortWeekday = new Intl.DateTimeFormat('es-AR', { weekday: 'short' })
const shortDate = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit' })

export function dayLong(iso: string): string {
  return longDay.format(fromISO(iso))
}
export function weekdayShort(iso: string): string {
  return shortWeekday.format(fromISO(iso)).replace('.', '')
}
export function dayNumber(iso: string): number {
  return fromISO(iso).getDate()
}
export function dateShort(iso: string): string {
  return shortDate.format(fromISO(iso))
}

export function relativeDay(iso: string, today: string): string {
  if (iso === today) return 'Hoy'
  if (iso === addDays(today, 1)) return 'Mañana'
  if (iso === addDays(today, -1)) return 'Ayer'
  const label = dayLong(iso)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
