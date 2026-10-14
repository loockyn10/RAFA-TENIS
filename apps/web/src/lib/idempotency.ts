// Identidad estable de las operaciones financieras (SEC-05).
// Una operación = una intención del usuario (un carrito, un pago). Su clave se genera UNA vez, se conserva mientras la
// intención no cambie (reintentos tras un error de red, doble clic, recarga de la página) y se descarta solo cuando
// hay confirmación de que la operación quedó registrada. La garantía definitiva vive en PostgreSQL (clave única por
// club + comparación del contenido); este módulo evita generar claves nuevas "por accidente".
//
// Persistencia: solo { clave, huella del contenido, hora } en sessionStorage (por pestaña, se borra al cerrarla).
// La huella es un hash corto no reversible: no se guardan importes, nombres ni productos.

type StoredIntent = { key: string; fingerprint: string; createdAt: number }

const STORAGE_PREFIX = 'rafa-tenis:op:'
// Pasado este plazo la intención se considera abandonada y la próxima operación idéntica usa una clave nueva.
export const INTENT_TTL_MS = 24 * 60 * 60 * 1000
// Una petición colgada se corta: el resultado queda "incierto" y se puede reintentar con la misma clave.
export const OPERATION_TIMEOUT_MS = 20_000

const memory = new Map<string, StoredIntent>()

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

// cyrb53: hash de 53 bits, determinista y sin dependencias. No es criptográfico: una colisión solo reutilizaría una
// clave con otro contenido y PostgreSQL la rechazaría (23505) sin registrar nada.
export function operationFingerprint(parts: unknown): string {
  const text = stableStringify(parts)
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

function readStored(scope: string): StoredIntent | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + scope)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredIntent>
    return typeof parsed.key === 'string' && typeof parsed.fingerprint === 'string' && typeof parsed.createdAt === 'number' ? { key: parsed.key, fingerprint: parsed.fingerprint, createdAt: parsed.createdAt } : null
  } catch { return null }
}
function writeStored(scope: string, intent: StoredIntent) {
  try { window.sessionStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify(intent)) } catch { /* sin almacenamiento: queda la memoria de la página */ }
}
function removeStored(scope: string) {
  try { window.sessionStorage.removeItem(STORAGE_PREFIX + scope) } catch { /* nada que limpiar */ }
}

// Devuelve la clave de la intención en curso para este alcance (p. ej. `canteen-sale:<club>`), o crea una nueva.
// Se reutiliza SOLO si el contenido (huella) es el mismo y la intención no venció: si el usuario cambió el carrito o
// el importe, es otra operación y recibe otra clave.
export function claimOperationKey(scope: string, fingerprint: string, now: number = Date.now()): string {
  const current = memory.get(scope) ?? readStored(scope)
  if (current && current.fingerprint === fingerprint && now - current.createdAt < INTENT_TTL_MS) {
    memory.set(scope, current)
    return current.key
  }
  const intent: StoredIntent = { key: crypto.randomUUID(), fingerprint, createdAt: now }
  memory.set(scope, intent)
  writeStored(scope, intent)
  return intent.key
}

// Olvida la intención: la operación quedó registrada (o el usuario la abandonó). La próxima será una operación nueva.
export function releaseOperationKey(scope: string) {
  memory.delete(scope)
  removeStored(scope)
}

type RpcError = { code?: string | null; message?: string | null } | null | undefined

// Un error con SQLSTATE/código PostgREST lo decidió el servidor: la transacción se revirtió y NO quedó nada
// registrado. Sin código (fallo de red, corte, timeout, respuesta ilegible del gateway) el resultado es INCIERTO.
export function isDefiniteFailure(error: RpcError): boolean {
  return typeof error?.code === 'string' && error.code.length > 0
}

// 23505 = la clave ya se usó con otro contenido u otro usuario: esa clave nunca podrá tener éxito.
export function isKeyConflict(error: RpcError): boolean {
  return error?.code === '23505'
}

export const UNCERTAIN_RESULT_MESSAGE = 'No pudimos confirmar si la operación se registró (problema de conexión). No se perdió nada: reintentá y se usará la misma operación, sin duplicarla.'
export const KEY_CONFLICT_MESSAGE = 'Esta operación ya había sido registrada con otros datos. Revisá el historial y volvé a cargarla si hace falta.'

export type OperationOutcome<T> =
  | { status: 'ok'; data: T | null; recovered: boolean }
  | { status: 'rejected'; message: string }
  | { status: 'conflict' }
  | { status: 'uncertain' }

type RpcResult<T> = { data: T | null; error: { code?: string | null; message?: string | null } | null }

// Ejecuta UNA operación financiera con identidad estable:
//  - ok: el servidor confirmó (o, tras un error incierto, la consulta de recuperación encontró la fila ya registrada).
//  - rejected: el servidor la rechazó (permisos, sobrepago…); no se registró nada y la clave se conserva.
//  - conflict: la clave quedó atada a otro contenido; se descarta para que el próximo intento use una nueva.
//  - uncertain: no se sabe si se registró (red, timeout). La clave y el contenido se conservan para reintentar.
export async function runIdempotentOperation<T>(options: {
  scope: string
  fingerprint: string
  call: (key: string, signal: AbortSignal) => PromiseLike<RpcResult<T>>
  recover: (key: string) => Promise<T | null>
}): Promise<OperationOutcome<T>> {
  const key = claimOperationKey(options.scope, options.fingerprint)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OPERATION_TIMEOUT_MS)
  let result: RpcResult<T>
  try { result = await options.call(key, controller.signal) } catch (thrown) { result = { data: null, error: { message: thrown instanceof Error ? thrown.message : 'Error de conexión' } } } finally { clearTimeout(timer) }
  if (!result.error) { releaseOperationKey(options.scope); return { status: 'ok', data: result.data, recovered: false } }
  if (isKeyConflict(result.error)) { releaseOperationKey(options.scope); return { status: 'conflict' } }
  if (isDefiniteFailure(result.error)) return { status: 'rejected', message: result.error.message ?? '' }
  try {
    const found = await options.recover(key)
    if (found) { releaseOperationKey(options.scope); return { status: 'ok', data: found, recovered: true } }
  } catch { /* la recuperación también falló: el resultado sigue incierto */ }
  return { status: 'uncertain' }
}
