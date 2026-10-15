import type { TournamentMatch } from '../../types/domain'
import type { BracketMatch, MatchState } from '../../design/bracketUtils'

export function bracketSize(entryCount: number) {
  if (entryCount < 2 || entryCount > 32) throw new Error('El fixture admite entre 2 y 32 inscripciones.')
  let size = 2
  while (size < entryCount) size *= 2
  return size
}

/** Distribuye los pases libres sin crear un enfrentamiento vacío. La migración aplica este mismo esquema atómicamente. */
export function firstRoundPlan<T>(entries: T[]) {
  const size = bracketSize(entries.length)
  const pairCount = size / 2
  const fullPairCount = entries.length - pairCount
  let cursor = 0
  return Array.from({ length: pairCount }, (_, index) => {
    const first = entries[cursor++]
    const second = index < fullPairCount ? entries[cursor++] : null
    return [first, second] as const
  })
}

// ── Presentación del cuadro ─────────────────────────────────────────

/** Estado visible de un partido real (no decide nada: PostgreSQL valida cada operación). */
export function matchState(match: Pick<TournamentMatch, 'status' | 'entry_one_id' | 'entry_two_id' | 'reservation_id'>): MatchState {
  if (match.status === 'completed') return 'done'
  if (!match.entry_one_id || !match.entry_two_id) return 'waiting'
  return match.reservation_id ? 'scheduled' : 'unscheduled'
}

/**
 * Convierte los partidos reales en los del cuadro. Los pases libres no son filas en la base: el inscripto ya figura
 * en la ronda 2, así que se muestran como un partido «Pase libre» en la posición de ronda 1 que lo alimenta.
 * Solo visual: no se guarda ni se envía nada.
 */
export function buildBracketMatches(matches: TournamentMatch[], nameOf: (entryId: string | null) => string | null, whenOf: (match: TournamentMatch) => BracketMatch['when']): BracketMatch[] {
  const real = matches.map<BracketMatch>((match) => ({
    id: match.id,
    round: match.round_number,
    position: match.position,
    a: nameOf(match.entry_one_id),
    b: nameOf(match.entry_two_id),
    winner: match.winner_entry_id ? (match.winner_entry_id === match.entry_one_id ? 'a' : match.winner_entry_id === match.entry_two_id ? 'b' : null) : null,
    walkover: match.is_walkover,
    score: match.score_text,
    state: matchState(match),
    when: whenOf(match),
  }))
  const firstRound = new Set(matches.filter((match) => match.round_number === 1).map((match) => match.position))
  const byes: BracketMatch[] = []
  matches.filter((match) => match.round_number === 2).forEach((match) => {
    ;([[1, match.entry_one_id], [2, match.entry_two_id]] as const).forEach(([slot, entryId]) => {
      const position = 2 * (match.position - 1) + slot
      if (entryId && !firstRound.has(position)) byes.push({ id: `bye-${match.category_id}-${position}`, round: 1, position, a: nameOf(entryId), b: null, winner: 'a', walkover: false, score: null, state: 'bye' })
    })
  })
  return [...byes, ...real].sort((x, y) => x.round - y.round || x.position - y.position)
}

/** Nombre de la ronda de un partido real, según la cantidad de rondas del cuadro. */
export function roundsOf(matches: Pick<TournamentMatch, 'round_number'>[]): number {
  return matches.length ? Math.max(...matches.map((match) => match.round_number)) : 0
}
