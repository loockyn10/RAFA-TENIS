import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Club, Court } from '../../types/domain'
import { AdminHome } from './AdminHome'

const club: Club = { id: 'club-1', name: 'Rafa Tenis', timezone: 'America/Argentina/Buenos_Aires' }
const courts: Court[] = [
  { id: 'c1', club_id: 'club-1', name: 'Cancha 1', surface: 'Polvo', active: true, display_order: 1 },
  { id: 'c2', club_id: 'club-1', name: 'Cancha 2', surface: 'Polvo', active: true, display_order: 2 },
  { id: 'c3', club_id: 'club-1', name: 'Cancha 3', surface: 'Cemento', active: false, display_order: 3 },
]
const occupation = (id: string, court: string, from: string, to: string, extra: Record<string, unknown> = {}) => ({ id, club_id: 'club-1', court_id: court, customer_name: null, person_id: null, starts_at: `2026-10-14T${from}:00-03:00`, ends_at: `2026-10-14T${to}:00-03:00`, status: 'confirmed', occupation_type: 'reservation', block_reason: null, recurrence_series_id: null, notes: null, created_by: 'u', created_at: '', updated_at: '', ...extra })

type Tables = { reservations?: { data: unknown[] | null; error: unknown }; payments?: { data: unknown[] | null; error: unknown }; sales?: { count: number | null; error: unknown } }
function clientFor({ reservations = { data: [], error: null }, payments = { data: [], error: null }, sales = { count: 0, error: null } }: Tables) {
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {}
    for (const name of ['select', 'eq', 'in', 'lt', 'gt', 'gte', 'order']) chain[name] = () => chain
    const result = table === 'reservations' ? reservations : table === 'canteen_sale_payments' ? payments : { data: null, ...sales }
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
    return chain
  })
  return { from } as never
}
const props = () => ({ club, courts, canManage: true, onNavigate: vi.fn(), onNewReservation: vi.fn(), onNewBlock: vi.fn() })

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T21:30:00-03:00')) })
afterEach(() => { vi.useRealTimers() })

describe('AdminHome · datos reales de hoy', () => {
  it('cuenta canchas en juego, muestra quién juega, lo próximo y los cobros de la cantina', async () => {
    const data = [occupation('o1', 'c1', '20:30', '22:00', { customer_name: 'Ana Gómez' }), occupation('o2', 'c2', '22:00', '23:00', { occupation_type: 'lesson', status: 'active' })]
    render(<AdminHome client={clientFor({ reservations: { data, error: null }, payments: { data: [{ amount_cents: 150000 }, { amount_cents: 50000 }], error: null }, sales: { count: 4, error: null } })} {...props()} />)
    expect(await screen.findByRole('heading', { name: /1\s*de 2 canchas\s*en juego/ })).toBeInTheDocument()
    const now = screen.getByRole('region', { name: 'Canchas ahora' })
    expect(within(now).getByText('Ana Gómez')).toBeInTheDocument()
    expect(within(now).getByText('Libre hasta', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Próximos turnos' })).toHaveTextContent('Clase de tenis')
    const canteen = screen.getByRole('region', { name: 'Cantina hoy' })
    expect(canteen).toHaveTextContent('$ 2.000,00')
    expect(canteen).toHaveTextContent('4')
  })

  it('no inventa datos: sin ocupaciones informa turnos libres y canchas activas únicamente', async () => {
    render(<AdminHome client={clientFor({})} {...props()} />)
    expect(await screen.findByText('Sin turnos por delante')).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.queryByText('Cancha 3')).not.toBeInTheDocument()
  })

  it('si la cantina no se puede leer, lo declara «no disponible» en lugar de mostrar cero', async () => {
    render(<AdminHome client={clientFor({ payments: { data: null, error: { message: 'denied' } } })} {...props()} />)
    expect(await screen.findByText('Dato no disponible.')).toBeInTheDocument()
    expect(screen.queryByText('Cobrado')).not.toBeInTheDocument()
  })

  it('error al leer la agenda: estado de error con reintento', async () => {
    render(<AdminHome client={clientFor({ reservations: { data: null, error: { message: 'boom' } } })} {...props()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar el inicio')
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('las acciones llaman a las operaciones reales y Cuotas solo aparece a quien administra', async () => {
    const p = props()
    const { rerender } = render(<AdminHome client={clientFor({})} {...p} />)
    await screen.findByText('Sin turnos por delante')
    fireEvent.click(screen.getAllByRole('button', { name: 'Nueva reserva' })[0])
    expect(p.onNewReservation).toHaveBeenCalledWith({ startsAt: '21:30' })
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear' }))
    expect(p.onNewBlock).toHaveBeenCalledWith({ startsAt: '21:30' })
    fireEvent.click(screen.getByRole('button', { name: 'Venta rápida' }))
    expect(p.onNavigate).toHaveBeenCalledWith('canteen')
    expect(screen.getByRole('button', { name: /Cuotas y pagos/ })).toBeInTheDocument()
    rerender(<AdminHome client={clientFor({})} {...p} canManage={false} />)
    await waitFor(() => expect(screen.queryByRole('button', { name: /Cuotas y pagos/ })).not.toBeInTheDocument())
  })
})
