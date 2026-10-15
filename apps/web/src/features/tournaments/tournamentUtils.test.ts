import { describe, expect, it } from 'vitest'
import { bracketSize, buildBracketMatches, firstRoundPlan, matchState, roundsOf } from './tournamentUtils'

describe('fixture de eliminación directa', () => {
  it('arma cuatro inscripciones sin pases libres', () => {
    expect(bracketSize(4)).toBe(4)
    expect(firstRoundPlan(['A', 'B', 'C', 'D'])).toEqual([['A', 'B'], ['C', 'D']])
  })

  it('ubica seis inscripciones en un cuadro de ocho sin partidos vacíos', () => {
    const plan = firstRoundPlan(['A', 'B', 'C', 'D', 'E', 'F'])
    expect(bracketSize(6)).toBe(8)
    expect(plan).toEqual([['A', 'B'], ['C', 'D'], ['E', null], ['F', null]])
    expect(plan.every(([first]) => first !== null)).toBe(true)
  })

  it('arma ocho inscripciones en cuatro partidos iniciales', () => {
    expect(firstRoundPlan(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])).toHaveLength(4)
  })

  it('arma dos inscripciones como una final directa sin ronda siguiente', () => {
    expect(bracketSize(2)).toBe(2)
    expect(firstRoundPlan(['A', 'B'])).toEqual([['A', 'B']])
  })

  it('arma tres inscripciones con un pase libre', () => {
    expect(bracketSize(3)).toBe(4)
    expect(firstRoundPlan(['A', 'B', 'C'])).toEqual([['A', 'B'], ['C', null]])
  })

  it.each(Array.from({ length: 31 }, (_, index) => index + 2))('con %i inscripciones ubica a todos una sola vez y sin partidos vacíos', (count) => {
    const entries = Array.from({ length: count }, (_, index) => `E${index}`)
    const plan = firstRoundPlan(entries)
    const placed = plan.flatMap(([first, second]) => [first, second]).filter((entry): entry is string => entry !== null)
    expect(placed).toEqual(entries)
    expect(plan.every(([first]) => first !== null)).toBe(true)
    // Partidos reales: parejas completas de ronda 1 + (tamaño/2 - 1) de rondas siguientes = inscripciones - 1.
    const fullPairs = plan.filter(([, second]) => second !== null).length
    expect(fullPairs + bracketSize(count) / 2 - 1).toBe(count - 1)
  })

  it('rechaza cantidades fuera del MVP', () => {
    expect(() => bracketSize(1)).toThrow('entre 2 y 32')
    expect(() => bracketSize(33)).toThrow('entre 2 y 32')
  })
})

describe('buildBracketMatches', () => {
  const base = { club_id: 'c', tournament_id: 't', category_id: 'cat', winner_entry_id: null, reservation_id: null, status: 'pending' as const, score_text: null, is_walkover: false, finished_at: null }
  const names: Record<string, string> = { e1: 'Ana', e2: 'Beto', e3: 'Carla' }
  const nameOf = (id: string | null) => (id ? names[id] ?? null : null)

  it('muestra el pase libre de 3 inscripciones como partido de ronda 1 sin crear filas nuevas', () => {
    const matches = [
      { ...base, id: 'm1', round_number: 1, position: 1, entry_one_id: 'e1', entry_two_id: 'e2' },
      { ...base, id: 'm2', round_number: 2, position: 1, entry_one_id: null, entry_two_id: 'e3' },
    ]
    const result = buildBracketMatches(matches, nameOf, () => undefined)
    expect(result.map((item) => [item.round, item.position, item.state])).toEqual([[1, 1, 'unscheduled'], [1, 2, 'bye'], [2, 1, 'waiting']])
    expect(result[1]).toMatchObject({ a: 'Carla', b: null, winner: 'a' })
  })

  it('con 2 inscripciones (una sola ronda) no inventa pases libres', () => {
    const result = buildBracketMatches([{ ...base, id: 'm1', round_number: 1, position: 1, entry_one_id: 'e1', entry_two_id: 'e2' }], nameOf, () => undefined)
    expect(result).toHaveLength(1)
    expect(roundsOf([{ round_number: 1 }])).toBe(1)
  })

  it('estado de partido: finalizado, programado, por programar y esperando rival', () => {
    expect(matchState({ status: 'completed', entry_one_id: 'e1', entry_two_id: 'e2', reservation_id: null })).toBe('done')
    expect(matchState({ status: 'scheduled', entry_one_id: 'e1', entry_two_id: 'e2', reservation_id: 'r' })).toBe('scheduled')
    expect(matchState({ status: 'pending', entry_one_id: 'e1', entry_two_id: 'e2', reservation_id: null })).toBe('unscheduled')
    expect(matchState({ status: 'pending', entry_one_id: 'e1', entry_two_id: null, reservation_id: null })).toBe('waiting')
  })
})
