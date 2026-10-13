import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Club, Court, Reservation, ReservationDraft } from '../../types/domain'
import { ReservationForm } from './ReservationCalendar'

const club: Club = { id: 'club-1', name: 'Rafa Tenis', timezone: 'America/Argentina/Buenos_Aires' }
const courts: Court[] = [{ id: 'court-1', club_id: 'club-1', name: 'Cancha 1', surface: 'Polvo de ladrillo', active: true, display_order: 1 }]
const draft: ReservationDraft = { clubId: 'club-1', courtId: 'court-1', date: '2026-10-13', startsAt: '18:00', endsAt: '19:00', customerName: 'Ana', notes: '' }
const reservation: Reservation = { id: 'reservation-1', club_id: 'club-1', court_id: 'court-1', customer_name: 'Ana', starts_at: '2026-10-13T21:00:00.000Z', ends_at: '2026-10-13T22:00:00.000Z', status: 'confirmed', notes: null, created_by: 'user-1', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' }

describe('ReservationForm', () => {
  afterEach(() => vi.restoreAllMocks())

  it('crea una reserva con los datos editados', async () => {
    const onSave = vi.fn().mockResolvedValue(null)
    render(<ReservationForm club={club} courts={courts} initial={draft} onClose={vi.fn()} onSave={onSave} onCancel={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Nombre de quien reserva'), { target: { value: 'Bruno' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear reserva' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ customerName: 'Bruno', courtId: 'court-1', startsAt: '18:00' }), undefined))
  })

  it('conserva los datos y explica el conflicto si la base rechaza un solape', async () => {
    const onSave = vi.fn().mockResolvedValue('Ese horario ya está ocupado en esta cancha. Elegí otro horario.')
    render(<ReservationForm club={club} courts={courts} initial={draft} onClose={vi.fn()} onSave={onSave} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Crear reserva' }))

    expect(await screen.findByText('Ese horario ya está ocupado en esta cancha. Elegí otro horario.')).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre de quien reserva')).toHaveValue('Ana')
  })

  it('solicita confirmación y cambia el estado mediante la cancelación lógica', async () => {
    const onCancel = vi.fn().mockResolvedValue(null)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ReservationForm club={club} courts={courts} initial={draft} reservation={reservation} onClose={vi.fn()} onSave={vi.fn()} onCancel={onCancel} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }))

    await waitFor(() => expect(onCancel).toHaveBeenCalledWith(reservation))
  })
})
