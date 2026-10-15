import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/*
 * push-sw.js se carga con importScripts dentro del Service Worker de la PWA. Acá se ejecuta en un «self» simulado para comprobar
 * qué muestra y qué hace al tocar el aviso. NO sustituye una prueba con un servicio push real.
 */
const source = readFileSync(resolve(__dirname, '../../../public/push-sw.js'), 'utf8')

type Handler = (event: unknown) => void
function loadWorker() {
  const handlers: Record<string, Handler> = {}
  const showNotification = vi.fn().mockResolvedValue(undefined)
  const openWindow = vi.fn().mockResolvedValue(undefined)
  const matchAll = vi.fn().mockResolvedValue([])
  const scope = { addEventListener: (name: string, handler: Handler) => { handlers[name] = handler }, registration: { showNotification }, clients: { matchAll, openWindow } }
  new Function('self', source)(scope)
  return { handlers, showNotification, openWindow, matchAll }
}
const pushEvent = (payload: unknown, raw?: string) => {
  const waits: Promise<unknown>[] = []
  return { event: { data: { json: () => { if (raw !== undefined) throw new Error('no json'); return payload }, text: () => raw ?? '' }, waitUntil: (promise: Promise<unknown>) => waits.push(promise) }, waits }
}

describe('push-sw.js', () => {
  it('muestra siempre una notificación con título y texto cortos, tag y el id para abrir la app', async () => {
    const { handlers, showNotification } = loadWorker()
    const { event, waits } = pushEvent({ title: 'Reserva confirmada', body: 'Cancha 1 · jue 15/10 · 18:00–19:00', tag: 'n-1', data: { notificationId: 'n-1', kind: 'reservation_confirmed' } })
    handlers.push(event)
    await Promise.all(waits)
    expect(showNotification).toHaveBeenCalledWith('Reserva confirmada', expect.objectContaining({ body: 'Cancha 1 · jue 15/10 · 18:00–19:00', tag: 'n-1', data: { notificationId: 'n-1' } }))
  })

  it('un push sin JSON válido igual muestra un aviso genérico (userVisibleOnly) y recorta textos largos', async () => {
    const { handlers, showNotification } = loadWorker()
    const broken = pushEvent(null, 'texto plano')
    handlers.push(broken.event)
    await Promise.all(broken.waits)
    expect(showNotification).toHaveBeenCalledWith('Rafa Tenis', expect.objectContaining({ body: 'texto plano' }))
    const long = pushEvent({ title: 'T'.repeat(500), body: 'B'.repeat(900) })
    handlers.push(long.event)
    await Promise.all(long.waits)
    const [title, options] = showNotification.mock.calls[1]
    expect(title.length).toBeLessThanOrEqual(120)
    expect(options.body.length).toBeLessThanOrEqual(200)
  })

  it('no muestra ningún campo ajeno al aviso (p. ej. importes) aunque lleguen en el payload', async () => {
    const { handlers, showNotification } = loadWorker()
    const { event, waits } = pushEvent({ title: 'Aviso', body: 'Texto', amount_cents: 500000, email: 'x@y.z', data: { notificationId: 'n', saldo: 1 } })
    handlers.push(event)
    await Promise.all(waits)
    const options = showNotification.mock.calls[0][1]
    expect(JSON.stringify(options)).not.toMatch(/amount|saldo|x@y\.z/)
  })

  it('al tocar el aviso enfoca la ventana abierta y le pide mostrar el centro de notificaciones', async () => {
    const { handlers, matchAll, openWindow } = loadWorker()
    const client = { focus: vi.fn().mockResolvedValue(undefined), postMessage: vi.fn() }
    matchAll.mockResolvedValue([client])
    const waits: Promise<unknown>[] = []
    const close = vi.fn()
    handlers.notificationclick({ notification: { close, data: { notificationId: 'n-7' } }, waitUntil: (promise: Promise<unknown>) => waits.push(promise) })
    await Promise.all(waits)
    expect(close).toHaveBeenCalled()
    expect(client.focus).toHaveBeenCalled()
    expect(client.postMessage).toHaveBeenCalledWith({ type: 'rafa:open-notifications', id: 'n-7' })
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('sin ventanas abiertas abre la app con ?notif=<id> (no una URL arbitraria)', async () => {
    const { handlers, openWindow } = loadWorker()
    const waits: Promise<unknown>[] = []
    handlers.notificationclick({ notification: { close: vi.fn(), data: { notificationId: 'a b/c' } }, waitUntil: (promise: Promise<unknown>) => waits.push(promise) })
    await Promise.all(waits)
    expect(openWindow).toHaveBeenCalledWith('/?notif=a%20b%2Fc')
  })
})
