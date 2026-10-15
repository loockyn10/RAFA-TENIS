import type { Court, OccupationType, Reservation } from '../../types/domain'
import type { Tone } from '../../design/ui'

/** Presentación común de una ocupación de cancha (agenda, inicio). No contiene reglas de negocio. */
export type OccupationKind = 'reservation' | 'lesson' | 'match' | 'block'

export const KIND_LABEL: Record<OccupationKind, string> = { reservation: 'Reserva', lesson: 'Clase', match: 'Partido de torneo', block: 'Bloqueo' }
export const KIND_TONE: Record<OccupationKind, Tone> = { reservation: 'success', lesson: 'accent', match: 'clay', block: 'neutral' }

export function occupationKind(type: OccupationType): OccupationKind {
  return type === 'tournament_match' ? 'match' : type
}

export function occupationTitle(occupation: Pick<Reservation, 'occupation_type' | 'customer_name' | 'block_reason'>) {
  if (occupation.occupation_type === 'block') return occupation.block_reason || 'Bloqueo'
  if (occupation.occupation_type === 'lesson') return 'Clase de tenis'
  if (occupation.occupation_type === 'tournament_match') return 'Partido de torneo'
  return occupation.customer_name || 'Reserva'
}

/** Marca corta de la cancha (número si lo tiene en el nombre). */
export function courtShort(court: Pick<Court, 'name'>) {
  const digits = court.name.match(/\d+/)?.[0]
  if (digits) return digits.slice(0, 2)
  return court.name.trim().slice(0, 2).toUpperCase() || '·'
}
