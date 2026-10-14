import type { Occupation } from '../data/mock'
import type { Tone } from '../components/ui'

/** Tono de badge por tipo de ocupación (coincide con los tintes de la agenda). */
export const KIND_TONE: Record<Occupation['kind'], Tone> = { reservation: 'success', lesson: 'accent', match: 'clay', block: 'neutral' }
