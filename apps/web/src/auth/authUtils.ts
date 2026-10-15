export const isValidEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value.trim())

/** Error de red (sin respuesta del servidor), a diferencia de credenciales o datos rechazados. */
export function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { name, status, message } = error as { name?: string; status?: number; message?: string }
  return name === 'AuthRetryableFetchError' || status === 0 || /failed to fetch|networkerror|load failed/i.test(message ?? '')
}

/**
 * El código de invitación es hexadecimal en minúsculas (el servidor guarda el hash de lo que se canjea tal cual).
 * Se quitan espacios y separadores y se pasa a minúsculas: el alfabeto no distingue mayúsculas, así que no hay colisiones.
 */
export function normalizeInvitationCode(value: string): string {
  return value.replace(/[^0-9a-zA-Z]/g, '').toLowerCase()
}

/** Agrupa de a cuatro caracteres para leerlo y pegarlo cómodamente. */
export function groupInvitationCode(code: string): string {
  return code.replace(/(.{4})/g, '$1 ').trim()
}

/** Longitud mínima que acepta el servidor; el código emitido tiene 64 caracteres. */
export const INVITATION_CODE_MIN = 32
export const INVITATION_CODE_LENGTH = 64
