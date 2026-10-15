import type { SupabaseClient } from '@supabase/supabase-js'

/*
 * Web Push del lado del navegador. Reglas:
 *  - El permiso se pide ÚNICAMENTE desde `enablePush`, que solo se invoca tras un clic explícito del usuario.
 *  - Se reutiliza el Service Worker de la PWA (vite-plugin-pwa + push-sw.js); acá nunca se registra otro.
 *  - Solo existe la clave PÚBLICA VAPID. La privada vive como secreto de la Edge Function `dispatch-push`.
 *  - El navegador entrega endpoint + claves; el servidor las guarda con la RPC `register_push_subscription` (una fila por dispositivo).
 */

export const VAPID_PUBLIC_KEY: string = (import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '').trim()

export type UnsupportedReason = 'no-service-worker' | 'no-push' | 'no-notifications' | 'ios-needs-install'
export type PushSupport = { status: 'ok' } | { status: 'unsupported'; reason: UnsupportedReason } | { status: 'not-configured' }

export type PushEnvironment = {
  hasServiceWorker: boolean
  hasPushManager: boolean
  hasNotification: boolean
  isIos: boolean
  isStandalone: boolean
  vapidKey: string
}

export function readEnvironment(): PushEnvironment {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const win = typeof window === 'undefined' ? undefined : window
  const standalone = Boolean((nav as (Navigator & { standalone?: boolean }) | undefined)?.standalone) || Boolean(win?.matchMedia?.('(display-mode: standalone)').matches)
  return {
    hasServiceWorker: Boolean(nav && 'serviceWorker' in nav),
    hasPushManager: Boolean(win && 'PushManager' in win),
    hasNotification: Boolean(win && 'Notification' in win),
    isIos: Boolean(nav && (/iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1))),
    isStandalone: standalone,
    vapidKey: VAPID_PUBLIC_KEY,
  }
}

/** Decide si este navegador puede recibir push y por qué no (para explicarlo; el centro interno sigue disponible siempre). */
export function getPushSupport(env: PushEnvironment = readEnvironment()): PushSupport {
  if (env.isIos && !env.isStandalone) return { status: 'unsupported', reason: 'ios-needs-install' }
  if (!env.hasServiceWorker) return { status: 'unsupported', reason: 'no-service-worker' }
  if (!env.hasPushManager) return { status: 'unsupported', reason: 'no-push' }
  if (!env.hasNotification) return { status: 'unsupported', reason: 'no-notifications' }
  if (!env.vapidKey) return { status: 'not-configured' }
  return { status: 'ok' }
}

export const UNSUPPORTED_TEXT: Record<UnsupportedReason, string> = {
  'ios-needs-install': 'En iPhone y iPad los avisos requieren instalar la app: tocá Compartir → «Agregar a pantalla de inicio» y abrila desde ahí.',
  'no-service-worker': 'Este navegador no permite instalar avisos en segundo plano.',
  'no-push': 'Este navegador no admite notificaciones push.',
  'no-notifications': 'Este navegador no admite notificaciones del sistema.',
}

export const permissionState = (): NotificationPermission | 'unsupported' => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)

/** Convierte la clave pública VAPID (base64url) al formato que pide pushManager.subscribe. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return bytes
}

/** El SW de la PWA queda listo tras el primer registro; si nunca se registró (p. ej. servidor de desarrollo) se corta a los 4 s. */
export async function getRegistration(timeoutMs = 4000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
  return Promise.race([navigator.serviceWorker.ready, timeout])
}

export type DeviceState = 'unknown' | 'off' | 'on' | 'other-account'

/** ¿Este navegador está suscrito y la suscripción pertenece a la cuenta actual? (RLS solo deja ver las filas propias.) */
export async function getDeviceState(client: SupabaseClient): Promise<DeviceState> {
  try {
    const registration = await getRegistration()
    if (!registration) return 'unknown'
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return 'off'
    const { data, error } = await client.from('push_subscriptions').select('id').eq('endpoint', subscription.endpoint).maybeSingle()
    if (error) return 'unknown'
    return data ? 'on' : 'other-account'
  } catch { return 'unknown' }
}

export type EnableResult = { ok: true } | { ok: false; reason: 'denied' | 'dismissed' | 'no-service-worker' | 'failed' }

/** Activa los avisos en ESTE dispositivo. Debe llamarse desde un clic: es lo único que pide el permiso del navegador. */
export async function enablePush(client: SupabaseClient, vapidKey: string = VAPID_PUBLIC_KEY): Promise<EnableResult> {
  try {
    if (Notification.permission === 'denied') return { ok: false, reason: 'denied' }
    if (Notification.permission === 'default') {
      const answer = await Notification.requestPermission()
      if (answer === 'denied') return { ok: false, reason: 'denied' }
      if (answer !== 'granted') return { ok: false, reason: 'dismissed' }
    }
    const registration = await getRegistration()
    if (!registration) return { ok: false, reason: 'no-service-worker' }
    const key = urlBase64ToUint8Array(vapidKey)
    let subscription = await registration.pushManager.getSubscription()
    if (subscription) {
      const current = subscription.options.applicationServerKey
      const same = current && current.byteLength === key.byteLength && new Uint8Array(current).every((byte, index) => byte === key[index])
      if (!same) { await subscription.unsubscribe(); subscription = null }
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    const json = subscription.toJSON()
    const p256dh = json.keys?.p256dh
    const auth = json.keys?.auth
    if (!json.endpoint || !p256dh || !auth) { await subscription.unsubscribe(); return { ok: false, reason: 'failed' } }
    const { error } = await client.rpc('register_push_subscription', { p_endpoint: json.endpoint, p_p256dh: p256dh, p_auth: auth, p_user_agent: navigator.userAgent.slice(0, 300) })
    if (error) { await subscription.unsubscribe(); return { ok: false, reason: 'failed' } }
    return { ok: true }
  } catch { return { ok: false, reason: 'failed' } }
}

/** Desactiva los avisos en este dispositivo: revoca en el servidor primero y después en el navegador. */
export async function disablePush(client: SupabaseClient): Promise<boolean> {
  try {
    const registration = await getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) return true
    const { error } = await client.rpc('revoke_push_subscription', { p_endpoint: subscription.endpoint })
    if (error) return false
    await subscription.unsubscribe()
    return true
  } catch { return false }
}

/**
 * Pide a la Edge Function que despache los avisos recién creados. Es solo un acelerador: aunque no se llame (o la función no esté
 * desplegada) el proceso programado los envía. La función no recibe destinatarios: reclama de la cola lo que el servidor ya generó
 * y verifica en el servidor que quien llama administra el club.
 */
export async function triggerPushDispatch(client: SupabaseClient, vapidKey: string = VAPID_PUBLIC_KEY): Promise<void> {
  if (!vapidKey) return
  try { await client.functions.invoke('dispatch-push', { body: {} }) } catch { /* el proceso programado lo retomará */ }
}
