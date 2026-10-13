import { describe, expect, it } from 'vitest'
import type { Reservation } from '../../types/domain'
import { blockPayload, isOverlapError, isValidReservationInterval, occupationConflicts, reservationPayload, reservationPosition, sortReservations, weeklyOccurrenceDates, zonedDateTimeToIso } from './reservationUtils'

const baseReservation: Reservation = {
  id: 'reservation-1', club_id: 'club-1', court_id: 'court-1', customer_name: 'Ana', person_id: null,
  starts_at: '2026-10-13T10:00:00.000Z', ends_at: '2026-10-13T11:00:00.000Z', status: 'confirmed', occupation_type: 'reservation', block_reason: null, recurrence_series_id: null, notes: null,
  created_by: 'user-1', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
}

describe('reservation utilities', () => {
  it('convierte la hora local del club a un instante UTC sin usar la zona del dispositivo', () => {
    expect(zonedDateTimeToIso('2026-10-13', '07:00', 'America/Argentina/Buenos_Aires')).toBe('2026-10-13T10:00:00.000Z')
  })

  it('valida intervalos y prepara el payload de creación o edición', () => {
    const draft = { clubId: 'club-1', courtId: 'court-1', date: '2026-10-13', startsAt: '18:00', endsAt: '19:30', customerName: ' Ana ', personId: 'person-1', notes: '  Primer turno ', recurrence: 'single' as const, recurrenceUntil: '2026-10-13' }
    expect(isValidReservationInterval(draft)).toBe(true)
    expect(isValidReservationInterval({ ...draft, endsAt: '18:00' })).toBe(false)
    expect(reservationPayload(draft)).toMatchObject({ customer_name: 'Ana', person_id: 'person-1', notes: 'Primer turno', starts_at: '2026-10-13T21:00:00.000Z', ends_at: '2026-10-13T22:30:00.000Z' })
  })

  it('prepara un bloqueo activo con el motivo y sin atribuirlo a un jugador', () => {
    expect(blockPayload({ clubId: 'club-1', courtId: 'court-1', date: '2026-10-13', startsAt: '18:00', endsAt: '19:00', reason: 'Lluvia', notes: ' Canchas anegadas ' })).toMatchObject({ occupation_type: 'block', status: 'active', block_reason: 'Lluvia', notes: 'Canchas anegadas' })
  })

  it('calcula las semanas con fecha local, límite de 12 y detecta reservas o bloqueos en conflicto', () => {
    expect(weeklyOccurrenceDates('2026-10-13', '2026-11-03')).toEqual(['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03'])
    expect(weeklyOccurrenceDates('2026-10-13', '2027-01-12')).toHaveLength(13)
    const activeBlock = { ...baseReservation, id: 'block-1', occupation_type: 'block' as const, status: 'active' as const, customer_name: null, block_reason: 'Mantenimiento', starts_at: '2026-10-13T11:00:00.000Z', ends_at: '2026-10-13T12:00:00.000Z' }
    expect(occupationConflicts([{ id: 'new-1', court_id: 'court-1', starts_at: '2026-10-13T11:30:00.000Z', ends_at: '2026-10-13T12:30:00.000Z' }], [activeBlock])).toHaveLength(1)
    expect(occupationConflicts([{ id: 'new-2', court_id: 'court-1', starts_at: '2026-10-13T12:00:00.000Z', ends_at: '2026-10-13T13:00:00.000Z' }], [activeBlock])).toHaveLength(0)
  })

  it('ordena reservas y calcula bloques proporcionales a su duración', () => {
    const later = { ...baseReservation, id: 'reservation-2', customer_name: 'Bruno', starts_at: '2026-10-13T12:00:00.000Z' }
    expect(sortReservations([later, baseReservation]).map((reservation) => reservation.id)).toEqual(['reservation-1', 'reservation-2'])
    expect(reservationPosition(baseReservation, '2026-10-13')).toEqual({ top: 0, height: 64 })
  })

  it('reconoce el error de exclusión para conservar el formulario y explicarle el conflicto al operador', () => {
    expect(isOverlapError({ code: '23P01' })).toBe(true)
    expect(isOverlapError({ message: 'reservations_confirmed_court_no_overlap' })).toBe(true)
    expect(isOverlapError({ message: 'reservations_occupied_court_no_overlap' })).toBe(true)
    expect(isOverlapError({ code: '42501' })).toBe(false)
  })
})
