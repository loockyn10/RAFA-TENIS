import { describe, expect, it } from 'vitest'
import { buildPayload, classifyPushResult, clampLimit, identifyCaller, pushTopic, timingSafeEqual } from '../../../../../supabase/functions/dispatch-push/logic'

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null })

describe('dispatch-push · payload', () => {
  const delivery = { notification_id: '3f1c2d4e-0000-4000-8000-000000000001', kind: 'reservation_reminder', title: 'Recordatorio de tu reserva', body: 'Cancha 1 · jue 15/10 · 18:00–19:00' }

  it('lleva solo título, texto corto, tag y el id de la notificación', () => {
    const payload = JSON.parse(buildPayload(delivery))
    expect(payload).toEqual({ title: 'Recordatorio de tu reserva', body: 'Cancha 1 · jue 15/10 · 18:00–19:00', tag: delivery.notification_id, data: { notificationId: delivery.notification_id, kind: 'reservation_reminder' } })
  })
  it('recorta textos largos (pantalla bloqueada) y tolera cuerpo vacío', () => {
    const payload = JSON.parse(buildPayload({ ...delivery, title: 'T'.repeat(300), body: 'B'.repeat(500) }))
    expect(payload.title.length).toBeLessThanOrEqual(120)
    expect(payload.body.length).toBeLessThanOrEqual(200)
    expect(JSON.parse(buildPayload({ ...delivery, body: null })).body).toBe('')
  })
  it('no incorpora campos que no sean del aviso (correos, importes, destinatarios)', () => {
    const payload = JSON.parse(buildPayload({ ...delivery, email: 'x@y.z', amount_cents: 5000 } as typeof delivery))
    expect(Object.keys(payload).sort()).toEqual(['body', 'data', 'tag', 'title'])
    expect(JSON.stringify(payload)).not.toMatch(/@|amount/)
  })
  it('el Topic cumple el límite de 32 caracteres', () => {
    expect(pushTopic(delivery.notification_id)).toHaveLength(32)
    expect(pushTopic(delivery.notification_id)).toMatch(/^[0-9a-f]+$/)
  })
})

describe('dispatch-push · clasificación de respuestas del servicio push', () => {
  it('2xx enviada; 404/410 baja del dispositivo; 429/5xx/red reintento; otros 4xx fallo definitivo', () => {
    expect(classifyPushResult(201).outcome).toBe('sent')
    expect(classifyPushResult(404).outcome).toBe('gone')
    expect(classifyPushResult(410, 'Gone').outcome).toBe('gone')
    expect(classifyPushResult(429).outcome).toBe('retry')
    expect(classifyPushResult(503).outcome).toBe('retry')
    expect(classifyPushResult(undefined, 'ECONNRESET').outcome).toBe('retry')
    expect(classifyPushResult(401).outcome).toBe('failed')
    expect(classifyPushResult(403).outcome).toBe('failed')
    expect(classifyPushResult(413).outcome).toBe('failed')
  })
  it('limita el texto del error que se guarda', () => {
    expect(classifyPushResult(500, 'x'.repeat(1000)).error!.length).toBeLessThanOrEqual(200)
  })
})

describe('dispatch-push · autorización del llamador', () => {
  const secret = 'a-long-random-dispatch-secret-0123456789'

  it('el proceso programado se identifica con el secreto exacto', () => {
    expect(identifyCaller(headers({ 'x-dispatch-secret': secret, authorization: 'Bearer anon' }), secret)).toEqual({ mode: 'secret' })
  })
  it('un secreto incorrecto, vacío o ausente NO concede acceso total: cae al modo usuario o a ninguno', () => {
    expect(identifyCaller(headers({ 'x-dispatch-secret': 'incorrecto', authorization: 'Bearer user-jwt' }), secret)).toEqual({ mode: 'user', token: 'user-jwt' })
    expect(identifyCaller(headers({ 'x-dispatch-secret': 'incorrecto' }), secret)).toEqual({ mode: 'none' })
    expect(identifyCaller(headers({}), secret)).toEqual({ mode: 'none' })
  })
  it('si el secreto del servidor no está configurado (o es corto) la vía programada queda cerrada', () => {
    expect(identifyCaller(headers({ 'x-dispatch-secret': 'x' }), undefined)).toEqual({ mode: 'none' })
    expect(identifyCaller(headers({ 'x-dispatch-secret': 'corto' }), 'corto')).toEqual({ mode: 'none' })
  })
  it('un administrador llega con su JWT; se exige el esquema Bearer', () => {
    expect(identifyCaller(headers({ authorization: 'Bearer abc.def.ghi' }), secret)).toEqual({ mode: 'user', token: 'abc.def.ghi' })
    expect(identifyCaller(headers({ authorization: 'Basic abc' }), secret)).toEqual({ mode: 'none' })
  })
  it('timingSafeEqual', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })
  it('el límite por llamada queda acotado', () => {
    expect(clampLimit(undefined)).toBe(50)
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(10_000)).toBe(100)
    expect(clampLimit('x')).toBe(50)
    expect(clampLimit(7.9)).toBe(7)
  })
})
