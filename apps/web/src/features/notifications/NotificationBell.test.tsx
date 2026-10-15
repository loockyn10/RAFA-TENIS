import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppNotification } from '../../types/domain'
import { NotificationBell } from './NotificationBell'
import { badgeCount, relativeTime, targetOf } from './notificationUtils'
import { PushSettings } from './PushSettings'

const TZ = 'America/Argentina/Buenos_Aires'
const note = (id: string, patch: Partial<AppNotification> = {}): AppNotification => ({
  id, club_id: 'club-1', kind: 'news_published', title: `Aviso ${id}`, body: `Cuerpo ${id}`, target_type: 'post', target_id: `post-${id}`, created_at: new Date(Date.now() - 5 * 60_000).toISOString(), read_at: null, ...patch,
})

function makeClient(items: AppNotification[]) {
  let state = items.map((item) => ({ ...item }))
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'my_notifications') return { data: { unread: state.filter((item) => !item.read_at).length, items: state }, error: null }
    if (name === 'mark_notification_read') { state = state.map((item) => item.id === args.p_notification_id ? { ...item, read_at: item.read_at ?? new Date().toISOString() } : item); return { data: null, error: null } }
    if (name === 'mark_all_notifications_read') { state = state.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })); return { data: 2, error: null } }
    return { data: null, error: null }
  })
  return { client: { rpc, from: vi.fn() } as unknown as SupabaseClient, rpc }
}
const renderBell = (client: SupabaseClient, onOpen = vi.fn()) => ({ onOpen, ...render(<NotificationBell client={client} clubId="club-1" timezone={TZ} onOpenNotification={onOpen} />) })

afterEach(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'serviceWorker') })

describe('NotificationBell — centro de notificaciones', () => {
  it('muestra la cantidad de no leídas en la campanita y pide solo las del club activo', async () => {
    const { client, rpc } = makeClient([note('a'), note('b'), note('c', { read_at: '2026-10-10T10:00:00Z' })])
    renderBell(client)
    expect(await screen.findByRole('button', { name: 'Avisos, 2 sin leer' })).toBeInTheDocument()
    expect(rpc).toHaveBeenCalledWith('my_notifications', { p_club_id: 'club-1', p_limit: 50 })
  })

  it('lista las notificaciones con no leídas destacadas', async () => {
    const { client } = makeClient([note('a'), note('c', { read_at: '2026-10-10T10:00:00Z' })])
    renderBell(client)
    fireEvent.click(await screen.findByRole('button', { name: /^Avisos/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Avisos' })
    const items = await within(dialog).findAllByRole('button', { name: /Aviso [ac]/ })
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveClass('is-unread')
    expect(items[1]).not.toHaveClass('is-unread')
    expect(within(dialog).getAllByText('hace 5 min')).toHaveLength(2)
  })

  it('al abrir una notificación la marca como leída y navega a su destino', async () => {
    const { client, rpc } = makeClient([note('a', { target_type: 'reservation', target_id: 'res-1', kind: 'reservation_confirmed' })])
    const { onOpen } = renderBell(client)
    fireEvent.click(await screen.findByRole('button', { name: /^Avisos/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Aviso a/ }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', target_type: 'reservation', target_id: 'res-1' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('mark_notification_read', { p_notification_id: 'a' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Avisos' })).toBeInTheDocument())
  })

  it('«Marcar todas como leídas» las limpia y deshabilita el botón', async () => {
    const { client, rpc } = makeClient([note('a'), note('b')])
    renderBell(client)
    fireEvent.click(await screen.findByRole('button', { name: /^Avisos/ }))
    const markAll = await screen.findByRole('button', { name: 'Marcar todas como leídas' })
    fireEvent.click(markAll)
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('mark_all_notifications_read', { p_club_id: 'club-1' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Marcar todas como leídas' })).toBeDisabled())
    expect(screen.getByText('Estás al día')).toBeInTheDocument()
  })

  it('estado vacío cuando no hay avisos', async () => {
    const { client } = makeClient([])
    renderBell(client)
    fireEvent.click(await screen.findByRole('button', { name: 'Avisos' }))
    expect(await screen.findByText('No tenés avisos')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marcar todas como leídas' })).not.toBeInTheDocument()
  })

  it('si la carga falla lo dice y permite reintentar', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'x' } })
    renderBell({ rpc } as unknown as SupabaseClient)
    fireEvent.click(await screen.findByRole('button', { name: 'Avisos' }))
    expect(await screen.findByText('No pudimos cargar tus avisos')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(rpc.mock.calls.length).toBeGreaterThan(2))
  })

  it('sin soporte push explica por qué y mantiene el centro interno; NO pide permiso al abrir', async () => {
    const requestPermission = vi.fn()
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    const { client } = makeClient([note('a')])
    renderBell(client)
    fireEvent.click(await screen.findByRole('button', { name: /^Avisos/ }))
    expect(await screen.findByText(/Aviso a/)).toBeInTheDocument()
    expect(screen.getByText(/Avisos en este dispositivo/)).toBeInTheDocument()
    // En el entorno de pruebas no hay Service Worker ni clave VAPID: se explica y no se solicita nada.
    expect(screen.getByText(/todavía no están habilitados|no permite|no admite|requieren instalar/)).toBeInTheDocument()
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('un push recibido con la app abierta (mensaje del Service Worker) abre el panel', async () => {
    let listener: ((event: MessageEvent) => void) | null = null
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { addEventListener: (_: string, fn: (event: MessageEvent) => void) => { listener = fn }, removeEventListener: vi.fn(), ready: new Promise(() => undefined) } })
    const { client } = makeClient([note('a')])
    renderBell(client)
    await screen.findByRole('button', { name: /^Avisos/ })
    listener!(new MessageEvent('message', { data: { type: 'rafa:open-notifications', id: 'a' } }))
    expect(await screen.findByRole('dialog', { name: 'Avisos' })).toBeInTheDocument()
  })
})

describe('PushSettings', () => {
  it('con soporte completo ofrece «Activar avisos» y solo pide permiso al tocarlo', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied')
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null } }) } })
    render(<PushSettings client={{ rpc: vi.fn() } as unknown as SupabaseClient} support={{ status: 'ok' }} />)
    const activate = await screen.findByRole('button', { name: /Activar avisos/ })
    expect(requestPermission).not.toHaveBeenCalled()
    fireEvent.click(activate)
    expect(await screen.findByText(/El navegador bloqueó las notificaciones/)).toBeInTheDocument()
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  it('con permiso bloqueado explica cómo habilitarlo y no ofrece activar', async () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null } }) } })
    render(<PushSettings client={{ rpc: vi.fn() } as unknown as SupabaseClient} support={{ status: 'ok' }} />)
    expect(await screen.findByText(/están bloqueadas para este sitio/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Activar avisos/ })).not.toBeInTheDocument()
  })

  it('iPhone sin instalar y navegadores sin push: mensajes claros', () => {
    const client = { rpc: vi.fn() } as unknown as SupabaseClient
    const { rerender } = render(<PushSettings client={client} support={{ status: 'unsupported', reason: 'ios-needs-install' }} />)
    expect(screen.getByText(/Agregar a pantalla de inicio/)).toBeInTheDocument()
    rerender(<PushSettings client={client} support={{ status: 'unsupported', reason: 'no-push' }} />)
    expect(screen.getByText(/no admite notificaciones push/)).toBeInTheDocument()
    rerender(<PushSettings client={client} support={{ status: 'not-configured' }} />)
    expect(screen.getByText(/todavía no están habilitados/)).toBeInTheDocument()
  })
})

describe('notificationUtils', () => {
  const now = Date.parse('2026-10-15T15:00:00Z')
  it('tiempos relativos', () => {
    expect(relativeTime('2026-10-15T14:59:40Z', TZ, now)).toBe('ahora')
    expect(relativeTime('2026-10-15T14:30:00Z', TZ, now)).toBe('hace 30 min')
    expect(relativeTime('2026-10-15T12:00:00Z', TZ, now)).toBe('hace 3 h')
    expect(relativeTime('2026-10-14T12:00:00Z', TZ, now)).toBe('ayer')
    expect(relativeTime('2026-10-12T12:00:00Z', TZ, now)).toBe('hace 3 días')
    expect(relativeTime('2026-09-01T12:00:00Z', TZ, now)).toMatch(/1 sept|1 de sept/)
  })
  it('insignia y destino', () => {
    expect(badgeCount(5)).toBe('5')
    expect(badgeCount(150)).toBe('99+')
    expect(targetOf({ target_type: 'post', target_id: 'x' })).toEqual({ type: 'post', id: 'x' })
    expect(targetOf({ target_type: null, target_id: null })).toBeNull()
  })
})
