import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { PlayerAccessPanel } from './PlayerAccessPanel'
import type { Club } from '../../types/domain'

const club: Club = { id: 'club-1', name: 'Rafa Tenis', timezone: 'America/Argentina/Buenos_Aires' }
const hours = (offset: number) => new Date(Date.now() + offset * 3_600_000).toISOString()
const person = (id: string, name: string) => ({ id, club_id: 'club-1', full_name: name, phone: null, email: null, notes: null, active: true, created_at: '', updated_at: '' })
const CODE = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

function makeClient(invitations: unknown[], create?: () => unknown) {
  const rpc = vi.fn((name: string) => {
    if (name === 'list_player_invitations') return Promise.resolve({ data: invitations, error: null })
    if (name === 'get_online_booking_settings') return Promise.resolve({ data: { enabled: true, opens_at: '07:00:00', closes_at: '23:00:00', max_advance_days: 7, allowed_durations_minutes: [60], max_active_reservations: 2, cancellation_lead_minutes: 120, configured: true }, error: null })
    if (name === 'create_player_invitation') return Promise.resolve(create ? create() : { data: { id: 'new', code: CODE, expires_at: hours(24 * 7) }, error: null })
    return Promise.resolve({ data: null, error: null })
  })
  const people = [person('p-ana', 'Ana Gómez'), person('p-beto', 'Beto Ruiz')]
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {}
    for (const name of ['select', 'eq', 'or', 'order', 'limit']) chain[name] = () => chain
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: people, error: null }).then(resolve)
    return chain
  })
  return { client: { rpc, from } as unknown as SupabaseClient, rpc }
}

const row = (patch: Record<string, unknown>) => ({ id: 'i-1', person_id: 'p-ana', person_name: 'Ana Gómez', expires_at: hours(48), created_at: hours(-1), redeemed_at: null, revoked_at: null, ...patch })

describe('PlayerAccessPanel · invitaciones', () => {
  it('lista las invitaciones por estado y las cuentas vinculadas', async () => {
    const { client } = makeClient([row({}), row({ id: 'i-2', person_id: 'p-beto', person_name: 'Beto Ruiz', redeemed_at: hours(-2) })])
    render(<PlayerAccessPanel client={client} club={club} />)
    expect(await screen.findByText(/Vence en/)).toBeInTheDocument()
    expect(screen.getByText('1 cuenta vinculada · reservas online habilitadas')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Usadas/ }))
    expect(await screen.findByText(/Usada el/)).toBeInTheDocument()
  })

  it('genera un código de un solo uso, lo muestra una vez y no lo guarda al cerrar', async () => {
    const { client, rpc } = makeClient([])
    render(<PlayerAccessPanel client={client} club={club} />)
    await screen.findByText('Todavía no emitiste invitaciones')
    fireEvent.click(screen.getAllByRole('button', { name: 'Generar invitación' })[0])
    fireEvent.click(await screen.findByRole('button', { name: /Ana Gómez/ }))
    fireEvent.click(await screen.findByRole('button', { name: '7 días' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generar código' }))

    expect(await screen.findByText(/0123 4567 89ab cdef/)).toBeInTheDocument()
    const call = rpc.mock.calls.find(([name]) => name === 'create_player_invitation')!
    expect(call[1]).toEqual({ p_club_id: 'club-1', p_person_id: 'p-ana', p_expires_at: expect.any(String) })
    expect(screen.getByText(/no se vuelve a mostrar/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Listo' }))
    await waitFor(() => expect(screen.queryByText(/0123 4567/)).not.toBeInTheDocument())
  })

  it('no deja invitar a una persona que ya tiene cuenta vinculada', async () => {
    const { client } = makeClient([row({ redeemed_at: hours(-3) })])
    render(<PlayerAccessPanel client={client} club={club} />)
    await screen.findByText('1 cuenta vinculada · reservas online habilitadas')
    fireEvent.click(screen.getAllByRole('button', { name: 'Generar invitación' })[0])
    const pick = await screen.findByRole('button', { name: /Ana Gómez/ })
    expect(pick).toBeDisabled()
    expect(within(pick).getByText('Ya usa el portal')).toBeInTheDocument()
  })

  it('muestra el error sin código si el servidor rechaza la invitación', async () => {
    const { client } = makeClient([], () => ({ data: null, error: { code: '23505', message: 'Esta persona ya tiene una cuenta vinculada en el club.' } }))
    render(<PlayerAccessPanel client={client} club={club} />)
    await screen.findByText('Todavía no emitiste invitaciones')
    fireEvent.click(screen.getAllByRole('button', { name: 'Generar invitación' })[0])
    fireEvent.click(await screen.findByRole('button', { name: /Beto Ruiz/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Generar código' }))
    expect(await screen.findByText('Esta persona ya tiene una cuenta vinculada en el club.')).toBeInTheDocument()
    expect(screen.queryByText(/0123 4567/)).not.toBeInTheDocument()
  })

  it('revoca una invitación pendiente después de confirmar', async () => {
    const { client, rpc } = makeClient([row({})])
    render(<PlayerAccessPanel client={client} club={club} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Revocar' }))
    expect(rpc).not.toHaveBeenCalledWith('revoke_player_invitation', expect.anything())
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revocar' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('revoke_player_invitation', { p_invitation_id: 'i-1' }))
  })
})
