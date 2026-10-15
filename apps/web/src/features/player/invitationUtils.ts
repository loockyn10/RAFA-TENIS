export type PlayerInvitation = { id: string; person_id: string; person_name: string; expires_at: string; created_at: string; redeemed_at: string | null; revoked_at: string | null }
export type InvitationStatus = 'pending' | 'redeemed' | 'expired' | 'revoked'

/** Estado de presentación: usada y revocada pesan más que vencida (igual que en el servidor, un canje o una revocación son definitivos). */
export function invitationStatus(invitation: Pick<PlayerInvitation, 'expires_at' | 'redeemed_at' | 'revoked_at'>, now = Date.now()): InvitationStatus {
  if (invitation.redeemed_at) return 'redeemed'
  if (invitation.revoked_at) return 'revoked'
  return new Date(invitation.expires_at).getTime() <= now ? 'expired' : 'pending'
}

/** Personas con cuenta vinculada: el único camino para vincular una cuenta es canjear una invitación. */
export function linkedPeople(invitations: PlayerInvitation[]): { id: string; name: string }[] {
  const seen = new Map<string, string>()
  for (const invitation of invitations) if (invitation.redeemed_at && !seen.has(invitation.person_id)) seen.set(invitation.person_id, invitation.person_name)
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export const EXPIRY_OPTIONS = [{ days: 1, label: '24 horas' }, { days: 3, label: '3 días' }, { days: 7, label: '7 días' }, { days: 30, label: '30 días' }] as const

export function expiryFromNow(days: number, now = Date.now()): string {
  return new Date(now + days * 86_400_000).toISOString()
}

export function invitationErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  if (error?.code === '23505') return 'Esta persona ya tiene una cuenta vinculada en el club.'
  if (error?.code === '42501') return 'No tenés permiso para invitar jugadores en este club.'
  if (error?.code === '23503') return 'La persona no existe o está inactiva en este club.'
  if (error?.code === '22023') return 'El vencimiento debe ser una fecha futura.'
  return 'No se creó ningún código. Revisá la conexión e intentá nuevamente.'
}
