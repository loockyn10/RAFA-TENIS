/*
 * Cuadro de eliminación directa (2–32 inscripciones) con pases libres.
 * Réplica visual simplificada de la RPC real (D013 / D017): en producción la generación y el avance
 * de ganadores ocurren en PostgreSQL. Acá solo alimentan el prototipo.
 */

export type Side = 'a' | 'b'
export type Entry = { id: string; name: string; personIds: string[] }
export type Match = {
  id: string
  round: number
  position: number
  a: string | null
  b: string | null
  winner?: Side
  score?: string
  walkover?: boolean
  /** Primera ronda con un solo participante: avanza solo. */
  bye?: boolean
  /** Ocupación de la agenda única cuando el partido está programado. */
  occupationId?: string
}

export const MIN_ENTRIES = 2
export const MAX_ENTRIES = 32

export function bracketSize(entries: number): number {
  let size = 2
  while (size < entries) size *= 2
  return size
}

export function roundCount(size: number): number {
  return Math.round(Math.log2(size))
}

/** Final, Semifinal, Cuartos, Octavos, 16avos según la distancia a la final. */
export function roundName(round: number, rounds: number): string {
  const fromEnd = rounds - round
  return ['Final', 'Semifinal', 'Cuartos', 'Octavos', '16avos'][fromEnd] ?? `Ronda ${round}`
}

export function roundShort(round: number, rounds: number): string {
  const fromEnd = rounds - round
  return ['Final', 'Semis', 'Cuartos', 'Octavos', '16avos'][fromEnd] ?? `R${round}`
}

/** Mezcla determinística (sorteo reproducible a partir de una semilla). */
export function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items]
  let state = Math.abs(Math.floor(seed)) % 2147483647 || 1
  const random = () => { state = (state * 48271) % 2147483647; return state / 2147483647 }
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Ubica inscripciones en los casilleros de la primera ronda.
 * Los pases libres se reparten entre las dos mitades del cuadro y nunca se enfrentan entre sí.
 */
export function drawSlots(entryIds: string[]): (string | null)[] {
  const size = bracketSize(entryIds.length)
  const matches = size / 2
  const byes = size - entryIds.length
  const byeMatches = new Set(Array.from({ length: byes }, (_, k) => Math.floor((k * matches) / byes)))
  const slots: (string | null)[] = []
  let cursor = 0
  for (let m = 0; m < matches; m += 1) {
    slots.push(entryIds[cursor++] ?? null)
    slots.push(byeMatches.has(m) ? null : entryIds[cursor++] ?? null)
  }
  return slots
}

/** Genera todas las rondas desde los casilleros de la primera; los pases libres avanzan automáticamente. */
export function generateFixture(slots: (string | null)[], idPrefix: string): Match[] {
  const size = slots.length
  const rounds = roundCount(size)
  let matches: Match[] = []
  for (let round = 1; round <= rounds; round += 1) {
    const count = size / 2 ** round
    for (let position = 0; position < count; position += 1) {
      const a = round === 1 ? slots[position * 2] : null
      const b = round === 1 ? slots[position * 2 + 1] : null
      matches.push({ id: `${idPrefix}-r${round}-${position}`, round, position, a, b })
    }
  }
  matches.filter((match) => match.round === 1 && (match.a === null) !== (match.b === null)).forEach((match) => {
    matches = advance(matches.map((item) => (item.id === match.id ? { ...item, bye: true } : item)), match.id, match.a ? 'a' : 'b')
  })
  return matches
}

function advance(matches: Match[], matchId: string, winner: Side, score?: string, walkover?: boolean): Match[] {
  const match = matches.find((item) => item.id === matchId)
  if (!match) return matches
  const winnerId = match[winner]
  const rounds = Math.max(...matches.map((item) => item.round))
  return matches.map((item) => {
    if (item.id === matchId) return { ...item, winner, score, walkover }
    if (match.round < rounds && item.round === match.round + 1 && item.position === Math.floor(match.position / 2)) {
      return match.position % 2 === 0 ? { ...item, a: winnerId } : { ...item, b: winnerId }
    }
    return item
  })
}

export function nextMatch(matches: Match[], match: Match): Match | undefined {
  return matches.find((item) => item.round === match.round + 1 && item.position === Math.floor(match.position / 2))
}

/** Un resultado se puede cargar o corregir mientras el partido siguiente no tenga ganador. */
export function canRecord(matches: Match[], match: Match): boolean {
  if (match.bye || !match.a || !match.b) return false
  const next = nextMatch(matches, match)
  return !next?.winner
}

export function recordResult(matches: Match[], matchId: string, winner: Side, score: string | undefined, walkover = false): Match[] {
  const match = matches.find((item) => item.id === matchId)
  if (!match || !canRecord(matches, match)) return matches
  return advance(matches, matchId, winner, walkover ? undefined : score, walkover)
}

export function champion(matches: Match[]): string | null {
  if (matches.length === 0) return null
  const rounds = Math.max(...matches.map((item) => item.round))
  const final = matches.find((item) => item.round === rounds)
  return final?.winner ? final[final.winner] : null
}

export type MatchState = 'bye' | 'waiting' | 'unscheduled' | 'scheduled' | 'done'

export function matchState(match: Match): MatchState {
  if (match.bye) return 'bye'
  if (match.winner) return 'done'
  if (!match.a || !match.b) return 'waiting'
  return match.occupationId ? 'scheduled' : 'unscheduled'
}

/** «6-3 6-4» → [[6,3],[6,4]] para mostrar sets en columnas. */
export function parseScore(score: string | undefined): [string, string][] {
  if (!score) return []
  return score.trim().split(/\s+/).map((set) => {
    const [x, y] = set.split('-')
    return [x ?? '', y ?? '']
  })
}

/** Sets del ganador primero → orientados como lado a / lado b. */
export function scoreBySide(match: Match): { a: string[]; b: string[] } {
  const sets = parseScore(match.score)
  if (match.winner === 'b') return { a: sets.map((set) => set[1]), b: sets.map((set) => set[0]) }
  return { a: sets.map((set) => set[0]), b: sets.map((set) => set[1]) }
}

export function entryLabel(entries: Entry[], id: string | null): string | null {
  return entries.find((entry) => entry.id === id)?.name ?? null
}
