import { describe, expect, it } from 'vitest'
import type { Reservation } from '../../types/domain'
import { isOverlapError, isValidReservationInterval, reservationPayload, reservationPosition, sortReservations, zonedDateTimeToIso } from './reservationUtils'

const baseReservation: Reservation = {
  id: 'reservation-1', club_id: 'club-1', court_id: 'court-1', customer_name: 'Ana',
  starts_at: '2026-10-13T10:00:00.000Z', ends_at: '2026-10-13T11:00:00.000Z', status: 'confirmed', notes: null,
  created_by: 'user-1', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
}

describe('reservation utilities', () => {
  it('convierte la hora local del club a un instante UTC sin usar la zona del dispositivo', () => {
    expect(zonedDateTimeToIso('2026-10-13', '07:00', 'America/Argentina/Buenos_Aires')).toBe('2026-10-13T10:00:00.000Z')
  })

  it('valida intervalos y prepara el payload de creación o edición', () => {
    const draft = { clubId: 'club-1', courtId: 'court-1', date: '2026-10-13', startsAt: '18:00', endsAt: '19:30', customerName: ' Ana ', notes: '  Primer turno ' }
    expect(isValidReservationInterval(draft)).toBe(true)
    expect(isValidReservationInterval({ ...draft, endsAt: '18:00' })).toBe(false)
    expect(reservationPayload(draft)).toMatchObject({ customer_name: 'Ana', notes: 'Primer turno', starts_at: '2026-10-13T21:00:00.000Z', ends_at: '2026-10-13T22:30:00.000Z' })
  })

  it('ordena reservas y calcula bloques proporcionales a su duración', () => {
    const later = { ...baseReservation, id: 'reservation-2', customer_name: 'Bruno', starts_at: '2026-10-13T12:00:00.000Z' }
    expect(sortReservations([later, baseReservation]).map((reservation) => reservation.id)).toEqual(['reservation-1', 'reservation-2'])
    expect(reservationPosition(baseReservation, '2026-10-13')).toEqual({ top: 0, height: 64 })
  })

  it('reconoce el error de exclusión para conservar el formulario y explicarle el conflicto al operador', () => {
    expect(isOverlapError({ code: '23P01' })).toBe(true)
    expect(isOverlapError({ message: 'reservations_confirmed_court_no_overlap' })).toBe(true)
    expect(isOverlapError({ code: '42501' })).toBe(false)
  })
})
