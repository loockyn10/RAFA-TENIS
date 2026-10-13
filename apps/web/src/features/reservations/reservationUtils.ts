import type { BlockDraft, Reservation, ReservationDraft } from '../../types/domain'

export const CLUB_TIMEZONE = 'America/Argentina/Buenos_Aires'
export const CALENDAR_START_HOUR = 7
export const CALENDAR_END_HOUR = 23
export const SLOT_MINUTES = 30
export const SLOT_HEIGHT = 32

function dateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])) as Record<string, string>
}

export function todayInTimezone(timezone = CLUB_TIMEZONE) {
  const parts = dateParts(new Date(), timezone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function formatCalendarDate(value: string, timezone = CLUB_TIMEZONE) {
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone }).format(new Date(Date.UTC(year, month - 1, day, 12)))
}

export function shiftCalendarDate(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  const result = new Date(Date.UTC(year, month - 1, day + days))
  return result.toISOString().slice(0, 10)
}

export function zonedDateTimeToIso(date: string, time: string, timezone = CLUB_TIMEZONE) {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const intendedUtc = Date.UTC(year, month - 1, day, hour, minute)
  let candidate = intendedUtc
  // Recalculate once using the observed local offset. It covers the club timezone
  // and avoids using the device timezone when building the timestamptz instant.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = dateParts(new Date(candidate), timezone)
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
    candidate += intendedUtc - observed
  }
  return new Date(candidate).toISOString()
}

export function isoToDateAndTime(value: string, timezone = CLUB_TIMEZONE) {
  const parts = dateParts(new Date(value), timezone)
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

export function isValidReservationInterval(draft: Pick<ReservationDraft, 'date' | 'startsAt' | 'endsAt'>, timezone = CLUB_TIMEZONE) {
  return zonedDateTimeToIso(draft.date, draft.endsAt, timezone) > zonedDateTimeToIso(draft.date, draft.startsAt, timezone)
}

export function reservationPayload(draft: ReservationDraft, timezone = CLUB_TIMEZONE) {
  return {
    club_id: draft.clubId,
    court_id: draft.courtId,
    customer_name: draft.customerName.trim(),
    starts_at: zonedDateTimeToIso(draft.date, draft.startsAt, timezone),
    ends_at: zonedDateTimeToIso(draft.date, draft.endsAt, timezone),
    notes: draft.notes.trim() || null,
  }
}

export function blockPayload(draft: BlockDraft, timezone = CLUB_TIMEZONE) {
  return {
    club_id: draft.clubId,
    court_id: draft.courtId,
    starts_at: zonedDateTimeToIso(draft.date, draft.startsAt, timezone),
    ends_at: zonedDateTimeToIso(draft.date, draft.endsAt, timezone),
    status: 'active' as const,
    occupation_type: 'block' as const,
    block_reason: draft.reason.trim(),
    notes: draft.notes.trim() || null,
  }
}

export function weeklyOccurrenceDates(startDate: string, untilDate: string) {
  const dates: string[] = []
  for (let current = startDate; current <= untilDate && dates.length <= 12; current = shiftCalendarDate(current, 7)) dates.push(current)
  return dates
}

export function occupationConflicts(candidates: Array<Pick<Reservation, 'court_id' | 'starts_at' | 'ends_at' | 'id'>>, occupations: Reservation[]) {
  return candidates.flatMap((candidate) => occupations.filter((occupation) =>
    occupation.id !== candidate.id
    && occupation.court_id === candidate.court_id
    && occupation.status !== 'cancelled'
    && candidate.starts_at < occupation.ends_at
    && candidate.ends_at > occupation.starts_at,
  ).map((occupation) => ({ candidate, occupation })))
}

export function sortReservations(reservations: Reservation[]) {
  return [...reservations].sort((first, second) => first.starts_at.localeCompare(second.starts_at) || (first.customer_name ?? first.block_reason ?? '').localeCompare(second.customer_name ?? second.block_reason ?? '', 'es'))
}

export function isOverlapError(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === '23P01' || /reservations_(confirmed|active)_court_no_overlap|reservations_occupied_court_no_overlap/i.test(error?.message ?? '')
}

export function reservationPosition(reservation: Reservation, date: string, timezone = CLUB_TIMEZONE) {
  const dayStart = zonedDateTimeToIso(date, `${String(CALENDAR_START_HOUR).padStart(2, '0')}:00`, timezone)
  const dayEnd = zonedDateTimeToIso(date, `${String(CALENDAR_END_HOUR).padStart(2, '0')}:00`, timezone)
  const start = Math.max(new Date(reservation.starts_at).getTime(), new Date(dayStart).getTime())
  const end = Math.min(new Date(reservation.ends_at).getTime(), new Date(dayEnd).getTime())
  const minutesFromStart = (start - new Date(dayStart).getTime()) / 60000
  const duration = (end - start) / 60000
  return { top: (minutesFromStart / SLOT_MINUTES) * SLOT_HEIGHT, height: Math.max((duration / SLOT_MINUTES) * SLOT_HEIGHT, SLOT_HEIGHT) }
}
