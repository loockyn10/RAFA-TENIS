import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { disablePush, enablePush, getDeviceState, getPushSupport, triggerPushDispatch, urlBase64ToUint8Array, type PushEnvironment } from './pushClient'

const okEnv: PushEnvironment = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, isIos: false, isStandalone: false, vapidKey: 'BPublicKey' }

describe('getPushSupport', () => {
  it('ok cuando hay Service Worker, Push, Notifications y clave pública', () => {
    expect(getPushSupport(okEnv)).toEqual({ status: 'ok' })
  })
  it('explica por qué no: sin Service Worker / Push / Notifications', () => {
    expect(getPushSupport({ ...okEnv, hasServiceWorker: false })).toEqual({ status: 'unsupported', reason: 'no-service-worker' })
    expect(getPushSupport({ ...okEnv, hasPushManager: false })).toEqual({ status: 'unsupported', reason: 'no-push' })
    expect(getPushSupport({ ...okEnv, hasNotification: false })).toEqual({ status: 'unsupported', reason: 'no-notifications' })
  })
  it('en iPhone/iPad fuera de la app instalada pide instalarla; instalada, funciona', () => {
    expect(getPushSupport({ ...okEnv, isIos: true, hasPushManager: false })).toEqual({ status: 'unsupported', reason: 'ios-needs-install' })
    expect(getPushSupport({ ...okEnv, isIos: true, isStandalone: true })).toEqual({ status: 'ok' })
  })
  it('sin clave pública VAPID se presenta como no configurado (no aparenta funcionar)', () => {
    expect(getPushSupport({ ...okEnv, vapidKey: '' })).toEqual({ status: 'not-configured' })
  })
})

describe('urlBase64ToUint8Array', () => {
  it('decodifica base64url con y sin relleno', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3])
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255])
  })
})

// ── Entorno de navegador simulado ──
type FakeSubscription = { endpoint: string; options: { applicationServerKey: ArrayBuffer | null }; toJSON: () => unknown; unsubscribe: ReturnType<typeof vi.fn> }
function installBrowser({ permission = 'default' as NotificationPermission, answer = 'granted' as NotificationPermission, existing = null as FakeSubscription | null } = {}) {
  const subscription: FakeSubscription = {
    endpoint: 'https://push.example.test/abc',
    options: { applicationServerKey: null },
    toJSON: () => ({ endpoint: 'https://push.example.test/abc', keys: { p256dh: 'p256dh-key', auth: 'auth-key' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  }
  let current: FakeSubscription | null = existing
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => { current = subscription; return subscription }),
  }
  const registration = { pushManager }
  vi.stubGlobal('Notification', { permission, requestPermission: vi.fn(async () => answer) })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(registration) } })
  return { pushManager, subscription, requestPermission: (globalThis.Notification as unknown as { requestPermission: ReturnType<typeof vi.fn> }).requestPermission }
}
const clientWith = (rpc: (name: string, args: Record<string, unknown>) => unknown, from?: unknown) => ({ rpc: vi.fn(async (name: string, args: Record<string, unknown>) => rpc(name, args)), from, functions: { invoke: vi.fn().mockResolvedValue({}) } }) as unknown as SupabaseClient & { rpc: ReturnType<typeof vi.fn>; functions: { invoke: ReturnType<typeof vi.fn> } }

describe('enablePush', () => {
  beforeEach(() => vi.useRealTimers())
  afterEach(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'serviceWorker') })

  it('pide el permiso, se suscribe con la clave pública y registra el dispositivo con sus claves', async () => {
    const browser = installBrowser()
    const client = clientWith(() => ({ data: 'sub-id', error: null }))
    const result = await enablePush(client, 'AQID')
    expect(result).toEqual({ ok: true })
    expect(browser.requestPermission).toHaveBeenCalledTimes(1)
    expect(browser.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) })
    expect(client.rpc).toHaveBeenCalledWith('register_push_subscription', { p_endpoint: 'https://push.example.test/abc', p_p256dh: 'p256dh-key', p_auth: 'auth-key', p_user_agent: expect.any(String) })
  })

  it('si el permiso ya fue denegado no vuelve a pedirlo ni se suscribe', async () => {
    const browser = installBrowser({ permission: 'denied' })
    expect(await enablePush(clientWith(() => ({})), 'AQID')).toEqual({ ok: false, reason: 'denied' })
    expect(browser.requestPermission).not.toHaveBeenCalled()
    expect(browser.pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('si el usuario rechaza o cierra el pedido, no se registra nada', async () => {
    const denied = installBrowser({ answer: 'denied' })
    const client = clientWith(() => ({}))
    expect(await enablePush(client, 'AQID')).toEqual({ ok: false, reason: 'denied' })
    expect(client.rpc).not.toHaveBeenCalled()
    expect(denied.pushManager.subscribe).not.toHaveBeenCalled()
    installBrowser({ answer: 'default' })
    expect(await enablePush(client, 'AQID')).toEqual({ ok: false, reason: 'dismissed' })
  })

  it('si el servidor rechaza el registro, deshace la suscripción del navegador (sin dispositivos huérfanos)', async () => {
    const browser = installBrowser()
    const client = clientWith(() => ({ data: null, error: { message: 'x' } }))
    expect(await enablePush(client, 'AQID')).toEqual({ ok: false, reason: 'failed' })
    expect(browser.subscription.unsubscribe).toHaveBeenCalled()
  })

  it('con otra clave VAPID previa descarta la suscripción vieja y crea una nueva', async () => {
    const old: FakeSubscription = { endpoint: 'https://old', options: { applicationServerKey: new Uint8Array([9, 9, 9]).buffer }, toJSON: () => ({}), unsubscribe: vi.fn().mockResolvedValue(true) }
    const browser = installBrowser({ permission: 'granted', existing: old })
    expect(await enablePush(clientWith(() => ({ data: 'id', error: null })), 'AQID')).toEqual({ ok: true })
    expect(old.unsubscribe).toHaveBeenCalled()
    expect(browser.pushManager.subscribe).toHaveBeenCalled()
  })
})

describe('disablePush / getDeviceState', () => {
  afterEach(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'serviceWorker') })

  it('revoca primero en el servidor y después en el navegador', async () => {
    const existing: FakeSubscription = { endpoint: 'https://push.example.test/abc', options: { applicationServerKey: null }, toJSON: () => ({}), unsubscribe: vi.fn().mockResolvedValue(true) }
    installBrowser({ permission: 'granted', existing })
    const order: string[] = []
    existing.unsubscribe.mockImplementation(async () => { order.push('navegador'); return true })
    const client = clientWith((name) => { order.push(name); return { error: null } })
    expect(await disablePush(client)).toBe(true)
    expect(order).toEqual(['revoke_push_subscription', 'navegador'])
    expect(client.rpc).toHaveBeenCalledWith('revoke_push_subscription', { p_endpoint: 'https://push.example.test/abc' })
  })

  it('si el servidor falla no da por desactivado el dispositivo', async () => {
    const existing: FakeSubscription = { endpoint: 'https://e', options: { applicationServerKey: null }, toJSON: () => ({}), unsubscribe: vi.fn() }
    installBrowser({ permission: 'granted', existing })
    expect(await disablePush(clientWith(() => ({ error: { message: 'x' } })))).toBe(false)
    expect(existing.unsubscribe).not.toHaveBeenCalled()
  })

  it('estado del dispositivo: sin suscripción → off; propia → on; de otra cuenta → other-account', async () => {
    installBrowser({ permission: 'granted' })
    expect(await getDeviceState(clientWith(() => ({})))).toBe('off')
    const existing: FakeSubscription = { endpoint: 'https://e', options: { applicationServerKey: null }, toJSON: () => ({}), unsubscribe: vi.fn() }
    installBrowser({ permission: 'granted', existing })
    const select = (row: unknown) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) })
    expect(await getDeviceState(clientWith(() => ({}), () => select({ id: 'x' })))).toBe('on')
    expect(await getDeviceState(clientWith(() => ({}), () => select(null)))).toBe('other-account')
  })
})

describe('triggerPushDispatch', () => {
  it('no hace nada sin clave VAPID y no propaga errores si la función no está desplegada', async () => {
    const client = clientWith(() => ({}))
    await triggerPushDispatch(client, '')
    expect(client.functions.invoke).not.toHaveBeenCalled()
    client.functions.invoke.mockRejectedValue(new Error('404'))
    await expect(triggerPushDispatch(client, 'BKey')).resolves.toBeUndefined()
    expect(client.functions.invoke).toHaveBeenCalledWith('dispatch-push', { body: {} })
  })
})
