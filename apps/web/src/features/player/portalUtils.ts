import { zonedDateTimeToIso } from '../reservations/reservationUtils'
import { fromMinutes, toMinutes } from '../../design/dates'
import type { OnlineBookingSettings, PlayerAvailabilityCourt, PlayerReservation } from '../../types/domain'

/*
 * Cálculos de presentación del portal. Todo es orientativo: la autoridad final sobre horarios, duraciones,
 * anticipación, límite de turnos y solapes es la función create_player_reservation de PostgreSQL.
 */

export const SLOT_STEP_MINUTES = 30

export type TimeSlot = { time: string; startsAt: string; freeCourtIds: string[] }

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && aEnd > bStart

/**
 * Horarios de inicio posibles para una fecha y una duración, con las canchas libres de cada uno.
 * Un turno que empieza justo cuando termina otro no se considera superpuesto (turnos contiguos).
 */
export function buildTimeSlots({ date, durationMinutes, settings, courts, timezone, now = Date.now() }: {
  date: string
  durationMinutes: number
  settings: Pick<OnlineBookingSettings, 'opens_at' | 'closes_at'>
  courts: PlayerAvailabilityCourt[]
  timezone: string
  now?: number
}): TimeSlot[] {
  const opens = toMinutes(settings.opens_at.slice(0, 5))
  const closes = toMinutes(settings.closes_at.slice(0, 5))
  const slots: TimeSlot[] = []
  for (let start = opens; start + durationMinutes <= closes; start += SLOT_STEP_MINUTES) {
    const time = fromMinutes(start)
    const startsAt = zonedDateTimeToIso(date, time, timezone)
    const startMs = new Date(startsAt).getTime()
    if (startMs <= now) continue
    const endMs = startMs + durationMinutes * 60_000
    const freeCourtIds = courts
      .filter((court) => !court.occupied.some((block) => overlaps(startMs, endMs, new Date(block.starts_at).getTime(), new Date(block.ends_at).getTime())))
      .map((court) => court.id)
    slots.push({ time, startsAt, freeCourtIds })
  }
  return slots
}

export const DAY_PARTS = [
  { label: 'Mañana', from: 0, to: 12 * 60 },
  { label: 'Tarde', from: 12 * 60, to: 18 * 60 },
  { label: 'Noche', from: 18 * 60, to: 24 * 60 },
] as const

export function groupSlotsByDayPart(slots: TimeSlot[]) {
  return DAY_PARTS.map((part) => ({ ...part, slots: slots.filter((slot) => { const minutes = toMinutes(slot.time); return minutes >= part.from && minutes < part.to }) })).filter((part) => part.slots.length > 0)
}

export type ReservationGroups = { upcoming: PlayerReservation[]; past: PlayerReservation[]; cancelled: PlayerReservation[] }

/** Próximas ordenadas de la más cercana a la más lejana; anteriores y canceladas, de la más reciente a la más antigua. */
export function groupReservations(reservations: PlayerReservation[], now = Date.now()): ReservationGroups {
  const time = (item: PlayerReservation) => new Date(item.starts_at).getTime()
  return {
    upcoming: reservations.filter((item) => item.status === 'confirmed' && new Date(item.ends_at).getTime() > now).sort((a, b) => time(a) - time(b)),
    past: reservations.filter((item) => item.status === 'confirmed' && new Date(item.ends_at).getTime() <= now).sort((a, b) => time(b) - time(a)),
    cancelled: reservations.filter((item) => item.status === 'cancelled').sort((a, b) => time(b) - time(a)),
  }
}

/** Turnos confirmados que todavía no empezaron: los que el servidor cuenta contra el máximo de turnos activos. */
export function futureConfirmedCount(reservations: PlayerReservation[], now = Date.now()) {
  return reservations.filter((item) => item.status === 'confirmed' && new Date(item.starts_at).getTime() >= now).length
}

/** Mensaje comprensible para un error de create_player_reservation. Los textos del servidor son propios del negocio, no técnicos. */
export function bookingErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return 'No pudimos confirmar la reserva. Intentá nuevamente.'
  if (error.code === '23P01') return 'Alguien tomó ese horario mientras elegías. Elegí otro horario o cancha.'
  if ((error.code === '22023' || error.code === '42501' || error.code === '23503') && error.message) return error.message
  return 'No pudimos confirmar la reserva. El horario puede haberse ocupado o no cumplir las reglas del club.'
}

export function cancelErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  if (error && (error.code === '22023' || error.code === '42501' || error.code === '23503') && error.message) return error.message
  return 'No se pudo cancelar este turno. Tu turno sigue como estaba; probá de nuevo o consultá al club.'
}

export type PortalTournament = {
  id: string
  name: string
  description: string | null
  starts_on: string
  ends_on: string
  status: string
  categories: PortalCategory[]
}
export type PortalMatch = { id: string; round_number: number; position: number; entry_one: string | null; entry_two: string | null; winner: string | null; status: string; score_text: string | null }
export type PortalCategory = { id: string; name: string; modality: string; status: string; matches: PortalMatch[] }

const normalizeName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * ¿La inscripción (singles: nombre; dobles: «A / B») incluye a esta persona? El servidor no expone el vínculo entre la
 * cuenta y la inscripción, así que se compara el nombre de la ficha con el de la inscripción. Es solo una ayuda visual.
 */
export function entryIncludesPlayer(entryName: string | null, playerName: string): boolean {
  if (!entryName) return false
  const target = normalizeName(playerName)
  return target.length > 0 && entryName.split('/').some((part) => normalizeName(part) === target)
}

/** Torneos que el jugador puede ver: el servidor devuelve todos los del club, los borradores no están publicados. */
export function publishedTournaments(tournaments: PortalTournament[]) {
  return tournaments.filter((tournament) => tournament.status !== 'draft')
}

export type MyTournamentView = { tournament: PortalTournament; category: PortalCategory; rounds: number; entryName: string; next: PortalMatch | null }

/** Primera categoría en la que aparece el jugador (prefiere torneos activos) y su próximo partido sin resultado. */
export function findMyTournament(tournaments: PortalTournament[], playerName: string): MyTournamentView | null {
  const rank = (status: string) => (status === 'in_progress' ? 0 : status === 'registration_open' ? 1 : 2)
  const ordered = [...publishedTournaments(tournaments)].sort((a, b) => rank(a.status) - rank(b.status))
  for (const tournament of ordered) {
    for (const category of tournament.categories) {
      const mine = category.matches.filter((match) => entryIncludesPlayer(match.entry_one, playerName) || entryIncludesPlayer(match.entry_two, playerName))
      const entryName = mine.map((match) => (entryIncludesPlayer(match.entry_one, playerName) ? match.entry_one : match.entry_two)).find(Boolean)
      if (!entryName) continue
      const pending = mine.filter((match) => match.status !== 'completed' && match.status !== 'cancelled').sort((a, b) => a.round_number - b.round_number || a.position - b.position)
      return { tournament, category, rounds: Math.max(...category.matches.map((match) => match.round_number)), entryName, next: pending[0] ?? null }
    }
  }
  return null
}

/** «hasta 2 h antes», «hasta el inicio», «hasta 1 día antes». */
export function cancellationLabel(minutes: number): string {
  if (minutes <= 0) return 'hasta el inicio del turno'
  if (minutes < 60) return `hasta ${minutes} min antes`
  if (minutes < 1440) { const hours = minutes / 60; return `hasta ${Number.isInteger(hours) ? hours : hours.toFixed(1)} h antes` }
  const days = minutes / 1440
  return `hasta ${Number.isInteger(days) ? days : days.toFixed(1)} ${days === 1 ? 'día' : 'días'} antes`
}

const dayFormat = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', ...options }).format(new Date(`${date}T12:00:00Z`))
const capitalizeText = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** «Hoy», «Mañana» o «Vie 24/10», comparando fechas de la zona del club. */
export function relativeDayLabel(date: string, today: string): string {
  const diff = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
  if (diff === 0) return 'Hoy'
  if (diff === 1) return 'Mañana'
  return capitalizeText(dayFormat(date, { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', ''))
}

export const dayLongLabel = (date: string) => capitalizeText(dayFormat(date, { weekday: 'long', day: 'numeric', month: 'long' }))
export const weekdayShortLabel = (date: string) => capitalizeText(dayFormat(date, { weekday: 'short' }).replace('.', ''))
export const dayOfMonth = (date: string) => Number(date.slice(8, 10))
export const shortDateLabel = (date: string) => dayFormat(date, { day: 'numeric', month: 'short' }).replace('.', '')
