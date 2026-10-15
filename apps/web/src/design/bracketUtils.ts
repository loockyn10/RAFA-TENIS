export type MatchState = 'done' | 'scheduled' | 'unscheduled' | 'waiting' | 'bye'

/** Partido listo para mostrar. `a` y `b` son los nombres de los inscriptos (null = todavía sin definir). */
export type BracketMatch = {
  id: string
  round: number
  position: number
  a: string | null
  b: string | null
  winner: 'a' | 'b' | null
  walkover: boolean
  score: string | null
  state: MatchState
  /** Cancha y horario ya formateados, si el partido está programado. */
  when?: { date: string; text: string; live: boolean }
}

export function roundName(round: number, rounds: number): string {
  const remaining = 2 ** (rounds - round + 1)
  return remaining === 2 ? 'Final' : remaining === 4 ? 'Semifinal' : remaining === 8 ? 'Cuartos de final' : remaining === 16 ? 'Octavos de final' : `Ronda ${round}`
}

export function roundShort(round: number, rounds: number): string {
  const remaining = 2 ** (rounds - round + 1)
  return remaining === 2 ? 'Final' : remaining === 4 ? 'Semi' : remaining === 8 ? 'Cuartos' : remaining === 16 ? 'Octavos' : `R${round}`
}

/** Games por set de cada lado, tomando el marcador como lo escribe el ganador primero («6-4 3-6 10-7»). */
export function scoreBySide(match: Pick<BracketMatch, 'score' | 'winner' | 'walkover'>): { a: string[]; b: string[] } {
  if (!match.score || match.walkover || !match.winner) return { a: [], b: [] }
  const sets = [...match.score.matchAll(/(\d{1,2})\s*-\s*(\d{1,2})/g)].map((found) => [found[1], found[2]] as const)
  const winnerGames = sets.map((set) => set[0])
  const loserGames = sets.map((set) => set[1])
  return match.winner === 'a' ? { a: winnerGames, b: loserGames } : { a: loserGames, b: winnerGames }
}
