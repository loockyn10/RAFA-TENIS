import { render, screen } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../../auth/AuthProvider'
import { PlayerPortal } from './PlayerPortal'

describe('PlayerPortal', () => {
  it('muestra el acceso de jugador sin habilitar reservas cuando el club no las activó', async () => {
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
      rpc: vi.fn((name: string) => {
        if (name === 'get_online_booking_settings') return Promise.resolve({ data: { enabled: false, opens_at: '07:00', closes_at: '23:00', max_advance_days: 7, allowed_durations_minutes: [60, 90], max_active_reservations: 2, cancellation_lead_minutes: 120, configured: false }, error: null })
        if (name === 'player_reservations') return Promise.resolve({ data: [], error: null })
        if (name === 'player_profile') return Promise.resolve({ data: { full_name: 'Juan Pérez', phone: null, email: null, membership_status: null }, error: null })
        return Promise.resolve({ data: [], error: null })
      }),
    } as unknown as SupabaseClient

    render(<AuthProvider client={client}><PlayerPortal access={[{ club_id: 'club-a', club_name: 'Rafa Tenis', timezone: 'America/Argentina/Buenos_Aires', person_id: 'person-a', full_name: 'Juan Pérez', membership_status: null }]} /></AuthProvider>)

    expect(await screen.findByText('Hola, Juan Pérez')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Reservar cancha' }).find((button) => button.hasAttribute('disabled'))).toBeDisabled()
    expect(screen.getByText('Sin membresía')).toBeInTheDocument()
  })
})
