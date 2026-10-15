import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthProvider'
import { AccessRouter } from './AccessRouter'
import { LoginScreen } from './LoginScreen'

vi.mock('../features/admin/AdminPanel', () => ({ AdminPanel: ({ onOpenPlayerPortal }: { onOpenPlayerPortal?: () => void }) => <div><h1>Panel administrativo</h1>{onOpenPlayerPortal && <button onClick={onOpenPlayerPortal}>Mi portal de jugador</button>}</div> }))

const user = { id: 'auth-1', email: 'juan@correo.test' } as User
const access = { club_id: 'club-a', club_name: 'Rafa Tenis', timezone: 'America/Argentina/Buenos_Aires', person_id: 'person-a', full_name: 'Juan Pérez', membership_status: null }

type Overrides = { staff?: { club_id: string }[]; playerAccess?: unknown[]; redeem?: () => unknown; signIn?: () => unknown; signUp?: () => unknown }
function makeClient({ staff = [], playerAccess = [], redeem, signIn, signUp }: Overrides = {}) {
  const rpc = vi.fn((name: string) => {
    if (name === 'player_access_context') return Promise.resolve({ data: playerAccess, error: null })
    if (name === 'redeem_player_invitation') return Promise.resolve(redeem ? redeem() : { data: { club_id: 'club-a', person_id: 'person-a' }, error: null })
    return Promise.resolve({ data: name === 'get_online_booking_settings' ? { enabled: false, opens_at: '07:00', closes_at: '23:00', max_advance_days: 7, allowed_durations_minutes: [60], max_active_reservations: 2, cancellation_lead_minutes: 120, configured: false } : name === 'player_profile' ? { full_name: 'Juan Pérez', phone: null, email: null, membership_status: null } : [], error: null })
  })
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi.fn(() => Promise.resolve(signIn ? signIn() : { data: {}, error: null })),
      signUp: vi.fn(() => Promise.resolve(signUp ? signUp() : { data: { session: null }, error: null })),
    },
    from: vi.fn(() => ({ select: () => ({ eq: () => Promise.resolve({ data: staff, error: null }) }) })),
    rpc,
  } as unknown as SupabaseClient
  return { client, rpc }
}

const field = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement
beforeAll(() => { window.scrollTo = vi.fn() })
beforeEach(() => { window.sessionStorage.clear() })

describe('Acceso con Supabase Auth', () => {
  it('inicia sesión con el email y la contraseña, sin cuentas de demostración', async () => {
    const { client } = makeClient()
    render(<AuthProvider client={client}><LoginScreen /></AuthProvider>)
    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/prototipo/i)).not.toBeInTheDocument()

    fireEvent.change(field('Email'), { target: { value: ' Juan@Correo.test ' } })
    fireEvent.change(field('Contraseña'), { target: { value: 'secreta1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }))
    await waitFor(() => expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'Juan@Correo.test', password: 'secreta1' }))
  })

  it('muestra un error claro si las credenciales no son válidas', async () => {
    const { client } = makeClient({ signIn: () => ({ data: {}, error: { name: 'AuthApiError', message: 'Invalid login credentials', status: 400 } }) })
    render(<AuthProvider client={client}><LoginScreen /></AuthProvider>)
    fireEvent.change(field('Email'), { target: { value: 'juan@correo.test' } })
    fireEvent.change(field('Contraseña'), { target: { value: 'incorrecta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }))
    expect(await screen.findByText('No pudimos ingresar')).toBeInTheDocument()
    expect(screen.queryByText(/Invalid login/)).not.toBeInTheDocument()
  })

  it('distingue la falta de conexión y permite reintentar', async () => {
    const { client } = makeClient({ signIn: () => ({ data: {}, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 } }) })
    render(<AuthProvider client={client}><LoginScreen /></AuthProvider>)
    fireEvent.change(field('Email'), { target: { value: 'juan@correo.test' } })
    fireEvent.change(field('Contraseña'), { target: { value: 'secreta1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }))
    expect(await screen.findByText('Sin conexión con el club')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('no envía el registro si las contraseñas no coinciden', () => {
    const { client } = makeClient()
    render(<AuthProvider client={client}><LoginScreen /></AuthProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Registrate' }))
    fireEvent.change(field('Email'), { target: { value: 'nuevo@correo.test' } })
    fireEvent.change(field('Contraseña'), { target: { value: 'secreta1' } })
    fireEvent.change(field('Repetí la contraseña'), { target: { value: 'otra-cosa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }))
    expect(screen.getByText('Las contraseñas no coinciden.')).toBeInTheDocument()
    expect(client.auth.signUp).not.toHaveBeenCalled()
  })

  it('al registrarse sin sesión pide confirmar el email y no da acceso', async () => {
    const { client } = makeClient()
    render(<AuthProvider client={client}><LoginScreen /></AuthProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Registrate' }))
    fireEvent.change(field('Email'), { target: { value: 'nuevo@correo.test' } })
    fireEvent.change(field('Contraseña'), { target: { value: 'secreta1' } })
    fireEvent.change(field('Repetí la contraseña'), { target: { value: 'secreta1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }))
    expect(await screen.findByRole('heading', { name: 'Revisá tu email' })).toBeInTheDocument()
    expect(client.auth.signUp).toHaveBeenCalledWith({ email: 'nuevo@correo.test', password: 'secreta1' })
  })
})

describe('AccessRouter', () => {
  it('canjea la invitación con el código normalizado y saluda con los datos que devuelve el servidor', async () => {
    let linked = false
    const { client, rpc } = makeClient()
    const defaults = rpc.getMockImplementation()!
    rpc.mockImplementation((name: string) => {
      if (name === 'player_access_context') return Promise.resolve({ data: linked ? [access] : [], error: null })
      if (name === 'redeem_player_invitation') { linked = true; return Promise.resolve({ data: { club_id: 'club-a', person_id: 'person-a' }, error: null }) }
      return defaults(name)
    })
    render(<AuthProvider client={client}><AccessRouter user={user} /></AuthProvider>)

    const code = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
    fireEvent.change(await screen.findByLabelText('Código de invitación'), { target: { value: `  ${code.toUpperCase().replace(/(.{4})/g, '$1 ')}` } })
    fireEvent.click(screen.getByRole('button', { name: 'Canjear invitación' }))

    expect(await screen.findByRole('heading', { name: '¡Listo, Juan!' })).toBeInTheDocument()
    expect(rpc).toHaveBeenCalledWith('redeem_player_invitation', { p_code: code })
    expect(screen.getByText('Rafa Tenis', { selector: 'b' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ir a mi portal' }))
    expect(await screen.findByRole('heading', { name: 'Hola, Juan' })).toBeInTheDocument()
  })

  it('un código inválido no vincula nada y muestra un error genérico', async () => {
    const { client, rpc } = makeClient({ redeem: () => ({ data: null, error: { code: '22023', message: 'No pudimos validar el código de invitación.' } }) })
    render(<AuthProvider client={client}><AccessRouter user={user} /></AuthProvider>)
    fireEvent.change(await screen.findByLabelText('Código de invitación'), { target: { value: 'x'.repeat(40) } })
    fireEvent.click(screen.getByRole('button', { name: 'Canjear invitación' }))
    expect(await screen.findByText('No pudimos validar esa invitación')).toBeInTheDocument()
    expect(rpc.mock.calls.filter(([name]) => name === 'player_access_context')).toHaveLength(1)
  })

  it('no manda al servidor un código demasiado corto', async () => {
    const { client, rpc } = makeClient()
    render(<AuthProvider client={client}><AccessRouter user={user} /></AuthProvider>)
    fireEvent.change(await screen.findByLabelText('Código de invitación'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Canjear invitación' }))
    expect(await screen.findByText('No pudimos validar esa invitación')).toBeInTheDocument()
    expect(rpc).not.toHaveBeenCalledWith('redeem_player_invitation', expect.anything())
  })

  it('una cuenta con ambos accesos elige la experiencia y puede cambiar', async () => {
    const { client } = makeClient({ staff: [{ club_id: 'club-a' }], playerAccess: [access] })
    render(<AuthProvider client={client}><AccessRouter user={user} /></AuthProvider>)
    expect(await screen.findByRole('heading', { name: '¿Cómo querés entrar?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Administración/ }))
    expect(await screen.findByRole('heading', { name: 'Panel administrativo' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mi portal de jugador' }))
    expect(await screen.findByRole('heading', { name: 'Hola, Juan' })).toBeInTheDocument()
  })

  it('una cuenta solo administrativa entra directo y no puede forzar la experiencia de jugador', async () => {
    window.sessionStorage.setItem('rafa:experience:auth-1', 'player')
    const { client } = makeClient({ staff: [{ club_id: 'club-a' }] })
    render(<AuthProvider client={client}><AccessRouter user={user} /></AuthProvider>)
    expect(await screen.findByRole('heading', { name: 'Panel administrativo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mi portal de jugador' })).not.toBeInTheDocument()
  })

  it('una cuenta solo de jugador no puede forzar la experiencia administrativa', async () => {
    window.sessionStorage.setItem('rafa:experience:auth-1', 'admin')
    const { client } = makeClient({ playerAccess: [access] })
    render(<AuthProvider client={client}><AccessRouter user={user} /></AuthProvider>)
    expect(await screen.findByRole('heading', { name: 'Hola, Juan' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Panel administrativo' })).not.toBeInTheDocument()
  })
})
