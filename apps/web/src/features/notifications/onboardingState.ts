import type { SupabaseClient } from '@supabase/supabase-js'
import { getDeviceState, getPushSupport, permissionState, readEnvironment, type PushEnvironment } from './pushClient'

/*
 * Onboarding de avisos push: decide si corresponde mostrar la bienvenida. La marca «ya se mostró» vive en localStorage del
 * dispositivo, por usuario (una vez por usuario y dispositivo). No pide permiso: eso lo hace `enablePush` desde un clic.
 */

export type OnboardingKind = 'activate' | 'install-ios'

const key = (userId: string, kind: OnboardingKind) => `rafa:push-onboarding:${kind}:${userId}`

export function hasSeenOnboarding(userId: string, kind: OnboardingKind): boolean {
  try { return window.localStorage.getItem(key(userId, kind)) !== null } catch { return false }
}

export function markOnboardingSeen(userId: string, kind: OnboardingKind, choice: 'shown' | 'later' | 'activated' = 'shown'): void {
  try { window.localStorage.setItem(key(userId, kind), choice) } catch { /* sin almacenamiento: se vuelve a mostrar, sin romper nada */ }
}

/** Qué ventana mostrar (si corresponde alguna). Solo lectura: no pide permiso ni toca el servidor más que para consultar la suscripción. */
export async function resolveOnboarding(client: SupabaseClient, userId: string, env: PushEnvironment = readEnvironment()): Promise<OnboardingKind | null> {
  const support = getPushSupport(env)
  if (support.status === 'unsupported' && support.reason === 'ios-needs-install') {
    return hasSeenOnboarding(userId, 'install-ios') ? null : 'install-ios'
  }
  if (support.status !== 'ok') return null
  if (!env.isStandalone) return null
  if (hasSeenOnboarding(userId, 'activate')) return null
  if (permissionState() !== 'default') return null // ya concedido o bloqueado desde el sistema
  const device = await getDeviceState(client)
  return device === 'off' || device === 'other-account' ? 'activate' : null
}
