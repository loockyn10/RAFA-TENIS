// Lógica pura de dispatch-push (sin Deno, sin red): armado del payload, clasificación de errores del servicio push y autorización.
// Se prueba con Vitest desde apps/web (src/features/notifications/dispatchLogic.test.ts).

export type ClaimedDelivery = {
  delivery_id: string
  attempts: number
  endpoint: string
  p256dh: string
  auth: string
  notification_id: string
  club_id: string
  kind: string
  title: string
  body: string | null
  target_type: string | null
  target_id: string | null
}

export type DeliveryOutcome = { outcome: 'sent' | 'retry' | 'gone' | 'failed'; status: number | null; error: string | null }

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`)

/**
 * Contenido que viaja cifrado al dispositivo y se muestra en la pantalla bloqueada. Solo título y texto cortos que el servidor
 * ya generó (novedades, reservas): sin importes, saldos, deudas ni correos. `tag` evita que un reenvío apile avisos duplicados.
 */
export function buildPayload(delivery: Pick<ClaimedDelivery, 'notification_id' | 'kind' | 'title' | 'body'>): string {
  return JSON.stringify({
    title: clip(delivery.title, 120),
    body: clip(delivery.body ?? '', 200),
    tag: delivery.notification_id,
    data: { notificationId: delivery.notification_id, kind: delivery.kind },
  })
}

/** Cabecera `Topic` del push: 32 caracteres URL-safe como máximo; permite que el servicio push reemplace un mensaje pendiente repetido. */
export const pushTopic = (notificationId: string) => notificationId.replace(/-/g, '').slice(0, 32)

/**
 * Qué hacer según la respuesta del servicio push (RFC 8030/8292):
 *  - 2xx → enviada.   - 404/410 → la suscripción ya no existe: se elimina.
 *  - 429, 5xx, sin respuesta (red) → reintento con espera creciente.
 *  - 400/401/403/413 y otros 4xx → fallo definitivo para esta entrega (VAPID inválido, payload rechazado…): no se insiste.
 */
export function classifyPushResult(statusCode: number | undefined, message?: string): DeliveryOutcome {
  const error = message ? clip(message, 200) : null
  if (statusCode === undefined) return { outcome: 'retry', status: null, error: error ?? 'sin respuesta del servicio push' }
  if (statusCode >= 200 && statusCode < 300) return { outcome: 'sent', status: statusCode, error: null }
  if (statusCode === 404 || statusCode === 410) return { outcome: 'gone', status: statusCode, error }
  if (statusCode === 429 || statusCode >= 500) return { outcome: 'retry', status: statusCode, error }
  return { outcome: 'failed', status: statusCode, error }
}

/** Comparación de secretos en tiempo constante respecto del contenido (longitudes distintas devuelven false sin revelar dónde difieren). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return diff === 0
}

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 100
export function clampLimit(value: unknown): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : DEFAULT_LIMIT
  return Math.min(Math.max(number, 1), MAX_LIMIT)
}

export type CallerMode = { mode: 'secret' } | { mode: 'user'; token: string } | { mode: 'none' }

/**
 * ¿Cómo se identifica quien llama? (1) proceso programado: cabecera x-dispatch-secret idéntica al secreto del servidor;
 * (2) administrador: JWT de usuario en Authorization (se verifica luego contra Auth y club_staff); (3) nadie → 401.
 * La función NUNCA acepta destinatarios en el cuerpo: solo despacha lo que ya está en la cola generada por el servidor.
 */
export function identifyCaller(headers: { get(name: string): string | null }, secret: string | undefined): CallerMode {
  const provided = headers.get('x-dispatch-secret')
  if (secret && secret.length >= 16 && provided && timingSafeEqual(provided, secret)) return { mode: 'secret' }
  const authorization = headers.get('authorization') ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(authorization)
  return match ? { mode: 'user', token: match[1] } : { mode: 'none' }
}
