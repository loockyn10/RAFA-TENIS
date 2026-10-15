// Edge Function dispatch-push — envía por Web Push los avisos que el servidor ya generó (cola `push_deliveries`).
//
// Qué hace: reclama entregas pendientes con la RPC claim_push_deliveries (SKIP LOCKED: dos ejecuciones nunca toman la misma),
// firma con VAPID y las envía; informa cada resultado con complete_push_delivery (reintentos con espera, baja de dispositivos
// inexistentes 404/410, fallos definitivos).
//
// Seguridad:
//  * La clave privada VAPID y el service_role existen SOLO como secretos de esta función. Nunca viajan al navegador ni a Git.
//  * No recibe destinatarios ni contenido: únicamente despacha lo que ya está en la cola. No hay forma de pedirle «mandá X a Y».
//  * Quien llama debe ser (a) el proceso programado, con la cabecera x-dispatch-secret igual al secreto PUSH_DISPATCH_SECRET, o
//    (b) un usuario autenticado que sea owner/admin de al menos un club; en ese caso solo se despachan entregas de SUS clubes.
//  * Despliegue con verify_jwt activado (valor por defecto): el gateway rechaza llamadas sin JWT válido.
//
// Secretos requeridos (supabase secrets set …): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: o https:), PUSH_DISPATCH_SECRET.
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta la plataforma.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { buildPayload, classifyPushResult, clampLimit, identifyCaller, pushTopic, type ClaimedDelivery, type DeliveryOutcome } from './logic.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const MAX_ROUNDS = 5
const CONCURRENCY = 10

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT')
  if (!supabaseUrl || !serviceKey || !vapidPublic || !vapidPrivate || !vapidSubject) return json(503, { error: 'not_configured' })

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // ── Autorización ──────────────────────────────────────────────
  const caller = identifyCaller(request.headers, Deno.env.get('PUSH_DISPATCH_SECRET'))
  let clubIds: string[] | null = null // null = todos los clubes (solo el proceso programado)
  if (caller.mode === 'none') return json(401, { error: 'unauthorized' })
  if (caller.mode === 'user') {
    const { data: userData, error: userError } = await admin.auth.getUser(caller.token)
    if (userError || !userData.user) return json(401, { error: 'unauthorized' })
    const { data: rows, error: staffError } = await admin.from('club_staff').select('club_id').eq('auth_user_id', userData.user.id).in('role', ['owner', 'admin'])
    if (staffError) return json(500, { error: 'server_error' })
    if (!rows || rows.length === 0) return json(403, { error: 'forbidden' })
    clubIds = rows.map((row: { club_id: string }) => row.club_id)
  }

  let limit = clampLimit(undefined)
  try { limit = clampLimit(((await request.json()) as { limit?: unknown } | null)?.limit) } catch { /* cuerpo vacío: límite por defecto */ }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)

  const totals = { claimed: 0, sent: 0, retry: 0, gone: 0, failed: 0 }
  const sendOne = async (delivery: ClaimedDelivery): Promise<DeliveryOutcome> => {
    try {
      const response = await webpush.sendNotification(
        { endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth } },
        buildPayload(delivery),
        { TTL: 3600, urgency: 'normal', topic: pushTopic(delivery.notification_id) },
      )
      return classifyPushResult(response.statusCode)
    } catch (error) {
      const failure = error as { statusCode?: number; message?: string }
      return classifyPushResult(failure.statusCode, failure.message)
    }
  }

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const { data, error } = await admin.rpc('claim_push_deliveries', { p_limit: limit, p_club_ids: clubIds })
    if (error) return json(500, { error: 'claim_failed', ...totals })
    const batch = (data ?? []) as ClaimedDelivery[]
    if (batch.length === 0) break
    totals.claimed += batch.length
    for (let offset = 0; offset < batch.length; offset += CONCURRENCY) {
      const slice = batch.slice(offset, offset + CONCURRENCY)
      await Promise.all(slice.map(async (delivery) => {
        const result = await sendOne(delivery)
        totals[result.outcome] += 1
        await admin.rpc('complete_push_delivery', { p_delivery_id: delivery.delivery_id, p_outcome: result.outcome, p_http_status: result.status, p_error: result.error })
      }))
    }
    if (batch.length < limit) break
  }
  return json(200, totals)
})
