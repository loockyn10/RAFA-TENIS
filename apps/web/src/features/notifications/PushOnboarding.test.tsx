import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PushOnboarding } from './PushOnboarding'
import { hasSeenOnboarding, markOnboardingSeen, resolveOnboarding } from './onboardingState'
import type { PushEnvironment } from './pushClient'

const env: PushEnvironment = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, isIos: false, isStandalone: true, vapidKey: 'AQID' }

function install({ permission = 'default' as NotificationPermission, answer = 'granted' as NotificationPermission, subscribed = false, rowFound = true } = {}) {
  const subscription = { endpoint: 'https://push.example.test/x', options: { applicationServerKey: null }, toJSON: () => ({ endpoint: 'https://push.example.test/x', keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: vi.fn() }
  const pushManager = { getSubscription: vi.fn(async () => (subscribed ? subscription : null)), subscribe: vi.fn(async () => subscription) }
  const requestPermission = vi.fn(async () => answer)
  vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission, requestPermission }))
  vi.stubGlobal('PushManager', function PushManager() {})
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager }) } })
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'AQID')
  const rpc = vi.fn(async () => ({ data: null, error: null }))
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: rowFound ? { id: '1' } : null, error: null }) }) }) }))
  return { client: { rpc, from } as unknown as SupabaseClient, rpc, requestPermission, pushManager }
}

beforeEach(() => {
  const data = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), clear: () => data.clear() } })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); Reflect.deleteProperty(navigator, 'serviceWorker') })

describe('resolveOnboarding', () => {
  it('muestra la bienvenida en la PWA instalada con permiso pendiente y sin suscripción', async () => {
    const { client } = install()
    expect(await resolveOnboarding(client, 'u1', env)).toBe('activate')
  })
  it('no la muestra si ya la vio, si ya está activado, si se bloqueó el permiso o si el navegador no soporta push', async () => {
    const { client } = install()
    markOnboardingSeen('u1', 'activate', 'later')
    expect(await resolveOnboarding(client, 'u1', env)).toBeNull()
    expect(await resolveOnboarding(client, 'u2', { ...env, hasPushManager: false })).toBeNull()
    install({ permission: 'denied' })
    expect(await resolveOnboarding(client, 'u2', env)).toBeNull()
    const on = install({ subscribed: true })
    expect(await resolveOnboarding(on.client, 'u2', env)).toBeNull()
  })
  it('no la muestra fuera de la PWA instalada (Android en pestaña)', async () => {
    const { client } = install()
    expect(await resolveOnboarding(client, 'u1', { ...env, isStandalone: false })).toBeNull()
  })
  it('en iPhone sin instalar muestra instrucciones, una vez por usuario', async () => {
    const { client } = install()
    const ios = { ...env, isIos: true, isStandalone: false }
    expect(await resolveOnboarding(client, 'u1', ios)).toBe('install-ios')
    markOnboardingSeen('u1', 'install-ios')
    expect(await resolveOnboarding(client, 'u1', ios)).toBeNull()
    expect(await resolveOnboarding(client, 'u2', ios)).toBe('install-ios')
  })
})

describe('PushOnboarding', () => {
  it('«Ahora no» cierra y no vuelve a aparecer; no pide permiso', async () => {
    const { client, requestPermission } = install()
    const view = render(<PushOnboarding client={client} userId="u1" environment={env} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ahora no' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(requestPermission).not.toHaveBeenCalled()
    expect(hasSeenOnboarding('u1', 'activate')).toBe(true)
    view.unmount()
    render(<PushOnboarding client={client} userId="u1" environment={env} />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('«Activar notificaciones» pide permiso desde el clic y registra la suscripción', async () => {
    const { client, requestPermission, rpc } = install()
    render(<PushOnboarding client={client} userId="u1" environment={env} />)
    expect(await screen.findByRole('dialog', { name: '¡Mantenete al día con Rafa Tenis!' })).toBeInTheDocument()
    expect(requestPermission).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Activar notificaciones' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('register_push_subscription', expect.objectContaining({ p_endpoint: 'https://push.example.test/x' })))
    expect(requestPermission).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
  it('si el sistema rechaza el permiso cierra sin registrar nada', async () => {
    const { client, rpc } = install({ answer: 'denied' })
    render(<PushOnboarding client={client} userId="u1" environment={env} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Activar notificaciones' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(rpc).not.toHaveBeenCalled()
  })
  it('si cierra el pedido de permiso, se queda y permite reintentar', async () => {
    const { client } = install({ answer: 'default' })
    render(<PushOnboarding client={client} userId="u1" environment={env} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Activar notificaciones' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('cerraste el pedido de permiso')
  })
})
