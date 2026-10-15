import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Club, Court, Reservation, ReservationDraft } from '../../types/domain'
import { BlockForm, ReservationCalendar, ReservationForm } from './ReservationCalendar'

const club: Club = { id: 'club-1', name: 'Rafa Tenis', timezone: 'America/Argentina/Buenos_Aires' }
const courts: Court[] = [{ id: 'court-1', club_id: 'club-1', name: 'Cancha 1', surface: 'Polvo de ladrillo', active: true, display_order: 1 }]
const draft: ReservationDraft = { clubId: 'club-1', courtId: 'court-1', date: '2026-10-13', startsAt: '18:00', endsAt: '19:00', customerName: 'Ana', personId: null, notes: '', recurrence: 'single', recurrenceUntil: '2026-10-13' }
const reservation: Reservation = { id: 'reservation-1', club_id: 'club-1', court_id: 'court-1', customer_name: 'Ana', person_id: null, starts_at: '2026-10-13T21:00:00.000Z', ends_at: '2026-10-13T22:00:00.000Z', status: 'confirmed', occupation_type: 'reservation', block_reason: null, recurrence_series_id: 'series-1', notes: null, created_by: 'user-1', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' }
const client = { from: vi.fn() } as never

describe('ReservationForm', () => {
  afterEach(() => vi.restoreAllMocks())

  it('crea una reserva con los datos editados', async () => {
    const onSave = vi.fn().mockResolvedValue(null)
    render(<ReservationForm client={client} club={club} courts={courts} initial={draft} onClose={vi.fn()} onSave={onSave} onCancel={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Nombre de quien reserva'), { target: { value: 'Bruno' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear reserva' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ customerName: 'Bruno', courtId: 'court-1', startsAt: '18:00' }), undefined))
  })

  it('conserva los datos y explica el conflicto si la base rechaza un solape', async () => {
    const onSave = vi.fn().mockResolvedValue('Ese horario ya está ocupado en esta cancha. Elegí otro horario.')
    render(<ReservationForm client={client} club={club} courts={courts} initial={draft} onClose={vi.fn()} onSave={onSave} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Crear reserva' }))

    expect(await screen.findByText('Ese horario ya está ocupado en esta cancha. Elegí otro horario.')).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre de quien reserva')).toHaveValue('Ana')
  })

  it('solicita confirmación dentro de la app y cambia el estado mediante la cancelación lógica', async () => {
    const onCancel = vi.fn().mockResolvedValue(null)
    render(<ReservationForm client={client} club={club} courts={courts} initial={draft} reservation={reservation} onClose={vi.fn()} onSave={vi.fn()} onCancel={onCancel} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }))
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, cancelar reserva' }))

    await waitFor(() => expect(onCancel).toHaveBeenCalledWith(reservation))
  })

  it('envía una serie semanal limitada por la fecha final', async () => {
    const onSave = vi.fn().mockResolvedValue(null)
    render(<ReservationForm client={client} club={club} courts={courts} initial={draft} onClose={vi.fn()} onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('switch', { name: /Repetir cada semana/ }))
    fireEvent.change(screen.getByLabelText('Última fecha de la serie'), { target: { value: '2026-11-03' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revisar y crear serie' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ recurrence: 'weekly', recurrenceUntil: '2026-11-03' }), undefined))
  })

  it('crea y cancela un bloqueo individual', async () => {
    const onSave = vi.fn().mockResolvedValue(null)
    const onCancel = vi.fn().mockResolvedValue(null)
    const block = { ...reservation, id: 'block-1', customer_name: null, status: 'active' as const, occupation_type: 'block' as const, block_reason: 'Lluvia', recurrence_series_id: null }
    render(<BlockForm club={club} courts={courts} initial={{ clubId: 'club-1', courtId: 'court-1', date: '2026-10-13', startsAt: '18:00', endsAt: '19:00', reason: 'Lluvia', notes: '' }} block={block} onClose={vi.fn()} onSave={onSave} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar bloqueo' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, cancelar bloqueo' }))
    await waitFor(() => expect(onCancel).toHaveBeenCalledWith(block))
  })
})

describe('ReservationForm · prechequeo informativo', () => {
  const busy: Reservation = { ...reservation, id: 'busy-1', customer_name: 'Otra persona', recurrence_series_id: null }
  const twoCourts: Court[] = [...courts, { id: 'court-2', club_id: 'club-1', name: 'Cancha 2', surface: 'Cemento', active: true, display_order: 2 }]

  it('avisa que la cancha figura ocupada y sugiere una libre, sin impedir que el servidor decida al guardar', async () => {
    const onSave = vi.fn().mockResolvedValue('Ese horario ya está ocupado en esta cancha. Elegí otro horario.')
    render(<ReservationForm client={client} club={club} courts={twoCourts} initial={draft} occupations={[busy]} occupationsDate="2026-10-13" onClose={vi.fn()} onSave={onSave} onCancel={vi.fn()} />)
    expect(screen.getByText(/Cancha 1 figura ocupada en ese horario/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancha 2 libre' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Crear reserva' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(await screen.findByRole('alert')).toHaveTextContent('Ese horario ya está ocupado en esta cancha.')
  })

  it('no muestra estado de ocupación para una fecha que la agenda no cargó', () => {
    render(<ReservationForm client={client} club={club} courts={twoCourts} initial={draft} occupations={[busy]} occupationsDate="2026-10-14" onClose={vi.fn()} onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText(/figura ocupada/)).not.toBeInTheDocument()
  })
})

describe('ReservationCalendar · pedidos de formulario', () => {
  const rows = (table: string) => (table === 'reservations' ? [] : [])
  const calendarClient = { from: (table: string) => { const chain: Record<string, unknown> = {}; for (const name of ['select', 'eq', 'in', 'lt', 'gt', 'order']) chain[name] = () => chain; chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows(table), error: null }).then(resolve); return chain } } as never

  it('abre el formulario real de reserva cuando otra sección lo pide y consume el pedido', async () => {
    const handled = vi.fn()
    render(<ReservationCalendar client={calendarClient} club={club} courts={courts} formRequest={{ id: 1, kind: 'reservation', startsAt: '19:30' }} onFormRequestHandled={handled} />)
    expect(await screen.findByRole('dialog', { name: 'Registrar turno' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Desde' })).toHaveValue('19:30')
    expect(handled).toHaveBeenCalledTimes(1)
  })

  it('abre el formulario de bloqueo y permite pasar a reserva sin perder cancha ni horario', async () => {
    render(<ReservationCalendar client={calendarClient} club={club} courts={courts} formRequest={{ id: 2, kind: 'block', startsAt: '08:00' }} />)
    expect(await screen.findByRole('dialog', { name: 'Bloquear cancha' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Reserva' }))
    expect(await screen.findByRole('dialog', { name: 'Registrar turno' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Desde' })).toHaveValue('08:00')
  })
})
