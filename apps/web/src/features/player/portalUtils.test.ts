import { describe, expect, it } from 'vitest'
import { bookingErrorMessage, buildTimeSlots, cancelErrorMessage, cancellationLabel, entryIncludesPlayer, findMyTournament, futureConfirmedCount, groupReservations, groupSlotsByDayPart, publishedTournaments, relativeDayLabel, type PortalMatch, type PortalTournament } from './portalUtils'
import type { PlayerAvailabilityCourt, PlayerReservation } from '../../types/domain'

const TZ = 'America/Argentina/Buenos_Aires'
const rules = { opens_at: '07:00:00', closes_at: '23:00:00' }
const court = (id: string, occupied: { from: string; to: string }[] = []): PlayerAvailabilityCourt => ({ id, name: id, display_order: 1, occupied: occupied.map((block) => ({ starts_at: block.from, ends_at: block.to, kind: 'reservation' })) })
// 2026-10-20 es martes: 09:00 en Buenos Aires = 12:00 UTC.
const base = { date: '2026-10-20', timezone: TZ, settings: rules, now: Date.parse('2026-10-19T12:00:00Z') }

describe('buildTimeSlots', () => {
  it('genera horarios cada 30 min dentro del horario del club respetando la duración', () => {
    const slots = buildTimeSlots({ ...base, durationMinutes: 90, courts: [court('c1')] })
    expect(slots[0].time).toBe('07:00')
    expect(slots.at(-1)!.time).toBe('21:30') // 21:30 + 90 min = 23:00
    expect(slots).toHaveLength(30)
  })

  it('convierte la hora local del club a UTC', () => {
    const slot = buildTimeSlots({ ...base, durationMinutes: 60, courts: [court('c1')] }).find((item) => item.time === '09:00')!
    expect(slot.startsAt).toBe('2026-10-20T12:00:00.000Z')
  })

  it('marca ocupada la cancha que se superpone y respeta los turnos contiguos', () => {
    const busy = court('c1', [{ from: '2026-10-20T12:00:00Z', to: '2026-10-20T13:00:00Z' }])
    const slots = buildTimeSlots({ ...base, durationMinutes: 60, courts: [busy, court('c2')] })
    const at = (time: string) => slots.find((slot) => slot.time === time)!.freeCourtIds
    expect(at('09:00')).toEqual(['c2'])
    expect(at('09:30')).toEqual(['c2'])
    expect(at('08:00')).toEqual(['c1', 'c2']) // termina justo cuando empieza el otro turno
    expect(at('08:30')).toEqual(['c2'])
    expect(at('10:00')).toEqual(['c1', 'c2'])
  })

  it('omite los horarios que ya pasaron', () => {
    const slots = buildTimeSlots({ ...base, now: Date.parse('2026-10-20T12:00:00Z'), durationMinutes: 60, courts: [court('c1')] })
    expect(slots[0].time).toBe('09:30')
  })

  it('agrupa por mañana, tarde y noche', () => {
    const groups = groupSlotsByDayPart(buildTimeSlots({ ...base, durationMinutes: 60, courts: [court('c1')] }))
    expect(groups.map((group) => group.label)).toEqual(['Mañana', 'Tarde', 'Noche'])
    expect(groups[0].slots.at(-1)!.time).toBe('11:30')
  })
})

const reservation = (id: string, startsInHours: number, status: PlayerReservation['status'] = 'confirmed', durationHours = 1): PlayerReservation => ({
  id, court_name: 'Cancha 1', starts_at: new Date(Date.now() + startsInHours * 3_600_000).toISOString(), ends_at: new Date(Date.now() + (startsInHours + durationHours) * 3_600_000).toISOString(), status, can_cancel: true,
})

describe('reservas del jugador', () => {
  it('agrupa próximas (la más cercana primero), anteriores y canceladas', () => {
    const groups = groupReservations([reservation('later', 48), reservation('soon', 24), reservation('old', -48), reservation('gone', 10, 'cancelled'), reservation('live', -0.5)])
    expect(groups.upcoming.map((item) => item.id)).toEqual(['live', 'soon', 'later'])
    expect(groups.past.map((item) => item.id)).toEqual(['old'])
    expect(groups.cancelled.map((item) => item.id)).toEqual(['gone'])
  })

  it('cuenta solo turnos confirmados que todavía no empezaron', () => {
    expect(futureConfirmedCount([reservation('a', 2), reservation('b', 5, 'cancelled'), reservation('c', -1), reservation('d', 30)])).toBe(2)
  })
})

describe('mensajes de error', () => {
  it('traduce el solape y conserva los avisos propios del negocio', () => {
    expect(bookingErrorMessage({ code: '23P01', message: 'conflicting key value violates exclusion constraint "x"' })).toMatch(/Alguien tomó ese horario/)
    expect(bookingErrorMessage({ code: '22023', message: 'La duración elegida no está habilitada.' })).toBe('La duración elegida no está habilitada.')
  })
  it('no filtra detalles técnicos desconocidos', () => {
    expect(bookingErrorMessage({ code: 'XX000', message: 'relation "reservations" does not exist' })).not.toMatch(/relation/)
    expect(cancelErrorMessage({ code: 'XX000', message: 'boom' })).not.toMatch(/boom/)
  })
})

describe('etiquetas', () => {
  it('describe el límite de cancelación', () => {
    expect(cancellationLabel(0)).toBe('hasta el inicio del turno')
    expect(cancellationLabel(30)).toBe('hasta 30 min antes')
    expect(cancellationLabel(120)).toBe('hasta 2 h antes')
    expect(cancellationLabel(1440)).toBe('hasta 1 día antes')
  })
  it('usa Hoy y Mañana según la fecha del club', () => {
    expect(relativeDayLabel('2026-10-20', '2026-10-20')).toBe('Hoy')
    expect(relativeDayLabel('2026-10-21', '2026-10-20')).toBe('Mañana')
    expect(relativeDayLabel('2026-10-24', '2026-10-20')).toMatch(/^Sáb/)
  })
})

const match = (id: string, round: number, one: string | null, two: string | null, status = 'pending', winner: string | null = null): PortalMatch => ({ id, round_number: round, position: 1, entry_one: one, entry_two: two, winner, status, score_text: null })
const tournament = (status: string, matches: PortalMatch[]): PortalTournament => ({ id: `t-${status}`, name: `Torneo ${status}`, description: null, starts_on: '2026-10-01', ends_on: '2026-10-30', status, categories: [{ id: 'c1', name: 'Libre', modality: 'singles', status: 'fixture_generated', matches }] })

describe('torneos del jugador', () => {
  it('reconoce al jugador en singles y dobles ignorando tildes y mayúsculas', () => {
    expect(entryIncludesPlayer('Juan Pérez', 'juan perez')).toBe(true)
    expect(entryIncludesPlayer('Ana Gómez / Juan Pérez', 'Juan Pérez')).toBe(true)
    expect(entryIncludesPlayer('Juan Pérez Jr.', 'Juan Pérez')).toBe(false)
    expect(entryIncludesPlayer(null, 'Juan Pérez')).toBe(false)
  })
  it('no muestra torneos en borrador', () => {
    expect(publishedTournaments([tournament('draft', []), tournament('in_progress', [])]).map((item) => item.status)).toEqual(['in_progress'])
  })
  it('encuentra el próximo partido sin resultado del jugador', () => {
    const view = findMyTournament([tournament('in_progress', [match('m1', 1, 'Juan Pérez', 'Ana Gómez', 'completed', 'Juan Pérez'), match('m2', 2, 'Juan Pérez', null)])], 'Juan Pérez')!
    expect(view.entryName).toBe('Juan Pérez')
    expect(view.rounds).toBe(2)
    expect(view.next?.id).toBe('m2')
  })
  it('devuelve null si el jugador no está inscripto', () => {
    expect(findMyTournament([tournament('in_progress', [match('m1', 1, 'Otra Persona', 'Ana Gómez')])], 'Juan Pérez')).toBeNull()
  })
})
