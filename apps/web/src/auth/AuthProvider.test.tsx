import { render, screen } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { AppContent } from '../App'
import { AuthProvider } from './AuthProvider'

describe('AuthProvider', () => {
  it('no muestra el panel administrativo sin sesión', async () => {
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
    } as unknown as SupabaseClient

    render(<AuthProvider client={client}><AppContent /></AuthProvider>)

    expect(await screen.findByRole('button', { name: 'Ingresar' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Canchas' })).not.toBeInTheDocument()
  })

  it('pide canjear una invitación cuando la sesión no tiene accesos', async () => {
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-without-club', email: 'sinclub@rafa.test' } } }, error: null }),
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
        signOut: vi.fn(),
      },
      from: vi.fn().mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as unknown as SupabaseClient

    render(<AuthProvider client={client}><AppContent /></AuthProvider>)

    expect(await screen.findByRole('heading', { name: 'Canjeá tu invitación' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Canchas' })).not.toBeInTheDocument()
  })
})
