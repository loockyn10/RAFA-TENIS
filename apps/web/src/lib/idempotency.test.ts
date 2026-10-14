import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INTENT_TTL_MS, claimOperationKey, isDefiniteFailure, isKeyConflict, operationFingerprint, releaseOperationKey, runIdempotentOperation } from './idempotency'

const scope = 'test:scope'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

beforeEach(() => { window.sessionStorage.clear(); releaseOperationKey(scope) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('operationFingerprint', () => {
  it('es estable ante el orden de las claves y distinta ante cualquier cambio de contenido', () => {
    expect(operationFingerprint({ a: 1, b: [1, 2] })).toBe(operationFingerprint({ b: [1, 2], a: 1 }))
    expect(operationFingerprint({ amount: 2000000 })).not.toBe(operationFingerprint({ amount: 2000001 }))
    expect(operationFingerprint({ items: [['x', 2]] })).not.toBe(operationFingerprint({ items: [['x', 3]] }))
    expect(operationFingerprint({ customer: null })).not.toBe(operationFingerprint({ customer: 'p1' }))
  })
  it('no contiene el contenido original (solo un hash corto)', () => {
    expect(operationFingerprint({ amount: 2000000, person: 'Juan Pérez' })).toMatch(/^[0-9a-f]{14}$/)
  })
})

describe('claimOperationKey', () => {
  it('conserva la misma clave mientras el contenido no cambie (reintentos, doble clic)', () => {
    const first = claimOperationKey(scope, 'fp-1')
    expect(first).toMatch(uuid)
    expect(claimOperationKey(scope, 'fp-1')).toBe(first)
    expect(claimOperationKey(scope, 'fp-1')).toBe(first)
  })
  it('genera otra clave si cambia el contenido: es otra operación', () => {
    const first = claimOperationKey(scope, 'fp-1')
    const second = claimOperationKey(scope, 'fp-2')
    expect(second).not.toBe(first)
    expect(claimOperationKey(scope, 'fp-2')).toBe(second)
  })
  it('una operación liberada tras el éxito no reutiliza su clave: la venta siguiente es nueva', () => {
    const first = claimOperationKey(scope, 'fp-1')
    releaseOperationKey(scope)
    expect(claimOperationKey(scope, 'fp-1')).not.toBe(first)
  })
  it('las intenciones de alcances distintos no se mezclan', () => {
    const a = claimOperationKey('scope:a', 'fp-1'); const b = claimOperationKey('scope:b', 'fp-1')
    expect(a).not.toBe(b)
    releaseOperationKey('scope:a'); releaseOperationKey('scope:b')
  })
  it('vence a las 24 h: una intención abandonada no se reutiliza', () => {
    const now = 1_700_000_000_000
    const first = claimOperationKey(scope, 'fp-1', now)
    expect(claimOperationKey(scope, 'fp-1', now + INTENT_TTL_MS - 1)).toBe(first)
    expect(claimOperationKey(scope, 'fp-1', now + INTENT_TTL_MS)).not.toBe(first)
  })
  it('sobrevive a una recarga de la página: se recupera de sessionStorage sin guardar datos del contenido', async () => {
    const first = claimOperationKey(scope, 'fp-reload')
    const raw = window.sessionStorage.getItem(`rafa-tenis:op:${scope}`)
    expect(raw).not.toBeNull()
    expect(Object.keys(JSON.parse(raw as string)).sort()).toEqual(['createdAt', 'fingerprint', 'key'])
    vi.resetModules() // simula una página nueva: la memoria del módulo desaparece, sessionStorage queda
    const reloaded = await import('./idempotency')
    expect(reloaded.claimOperationKey(scope, 'fp-reload')).toBe(first)
    expect(reloaded.claimOperationKey(scope, 'fp-otro-carrito')).not.toBe(first)
  })
  it('sigue funcionando (estable dentro de la página) si sessionStorage no está disponible', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('bloqueado') })
    const first = claimOperationKey(scope, 'fp-1')
    expect(claimOperationKey(scope, 'fp-1')).toBe(first)
    expect(() => releaseOperationKey(scope)).not.toThrow()
  })
  it('ignora basura en el almacenamiento', () => {
    window.sessionStorage.setItem(`rafa-tenis:op:${scope}`, '{no es json')
    expect(claimOperationKey(scope, 'fp-1')).toMatch(uuid)
  })
})

describe('clasificación de errores', () => {
  it('un error con código (SQLSTATE/PostgREST) es definitivo; sin código es incierto', () => {
    expect(isDefiniteFailure({ code: '22023', message: 'x' })).toBe(true)
    expect(isDefiniteFailure({ code: 'PGRST301', message: 'jwt' })).toBe(true)
    expect(isDefiniteFailure({ code: '', message: 'TypeError: Failed to fetch' })).toBe(false)
    expect(isDefiniteFailure({ message: '<html>502 Bad Gateway</html>' })).toBe(false)
    expect(isDefiniteFailure(null)).toBe(false)
  })
  it('23505 es conflicto de clave', () => {
    expect(isKeyConflict({ code: '23505' })).toBe(true)
    expect(isKeyConflict({ code: '22023' })).toBe(false)
  })
})

describe('runIdempotentOperation', () => {
  const rpcError = (code: string, message = 'x') => ({ data: null, error: { code, message } })
  const networkError = { data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }
  const base = (call: (key: string, signal: AbortSignal) => Promise<never>, recover: (key: string) => Promise<unknown> = async () => null) => ({ scope, fingerprint: 'fp', call: call as never, recover: recover as never })

  it('éxito: devuelve el dato y libera la clave (la próxima operación es nueva)', async () => {
    const keys: string[] = []
    const result = await runIdempotentOperation({ ...base(async (key) => { keys.push(key); return { data: { id: 's1' }, error: null } as never }) })
    expect(result).toEqual({ status: 'ok', data: { id: 's1' }, recovered: false })
    const next = await runIdempotentOperation({ ...base(async (key) => { keys.push(key); return { data: { id: 's2' }, error: null } as never }) })
    expect(next.status).toBe('ok')
    expect(keys[1]).not.toBe(keys[0])
  })

  it('respuesta perdida: el reintento usa EXACTAMENTE la misma clave', async () => {
    const keys: string[] = []
    const lost = async (key: string) => { keys.push(key); return networkError as never }
    expect((await runIdempotentOperation(base(lost))).status).toBe('uncertain')
    expect((await runIdempotentOperation(base(lost))).status).toBe('uncertain')
    expect((await runIdempotentOperation(base(async (key) => { keys.push(key); return { data: { id: 's1' }, error: null } as never }))).status).toBe('ok')
    expect(new Set(keys).size).toBe(1)
  })

  it('error incierto pero la consulta de recuperación encuentra la fila: se recupera sin reintentar la escritura', async () => {
    const recover = vi.fn(async () => ({ id: 'ya-registrada' }))
    const result = await runIdempotentOperation(base(async () => networkError as never, recover))
    expect(result).toEqual({ status: 'ok', data: { id: 'ya-registrada' }, recovered: true })
    expect(recover).toHaveBeenCalledTimes(1)
  })

  it('error incierto y la recuperación también falla: sigue incierto y conserva la clave', async () => {
    const keys: string[] = []
    const failing = async (key: string) => { keys.push(key); return networkError as never }
    const result = await runIdempotentOperation(base(failing, async () => { throw new Error('sin red') }))
    expect(result.status).toBe('uncertain')
    await runIdempotentOperation(base(failing))
    expect(keys[1]).toBe(keys[0])
  })

  it('rechazo del servidor (sobrepago, permisos): no se registró nada; conserva la clave para un reintento del mismo contenido', async () => {
    const recover = vi.fn()
    const keys: string[] = []
    const rejected = async (key: string) => { keys.push(key); return rpcError('22023', 'El importe supera el saldo pendiente de la cuota.') as never }
    const result = await runIdempotentOperation(base(rejected, recover))
    expect(result).toEqual({ status: 'rejected', message: 'El importe supera el saldo pendiente de la cuota.' })
    expect(recover).not.toHaveBeenCalled()
    await runIdempotentOperation(base(rejected))
    expect(keys[1]).toBe(keys[0])
  })

  it('conflicto 23505: descarta la clave para que el próximo intento use una nueva', async () => {
    const keys: string[] = []
    const conflict = async (key: string) => { keys.push(key); return rpcError('23505') as never }
    expect((await runIdempotentOperation(base(conflict))).status).toBe('conflict')
    await runIdempotentOperation(base(conflict))
    expect(keys[1]).not.toBe(keys[0])
  })

  it('una excepción de red (fetch rechazado) se trata como resultado incierto', async () => {
    const result = await runIdempotentOperation(base(async () => { throw new TypeError('Failed to fetch') }))
    expect(result.status).toBe('uncertain')
  })

  it('una petición colgada se corta por tiempo y queda como incierta', async () => {
    vi.useFakeTimers()
    const pending = runIdempotentOperation(base((_key, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))) })))
    await vi.advanceTimersByTimeAsync(20_001)
    expect((await pending).status).toBe('uncertain')
  })
})
