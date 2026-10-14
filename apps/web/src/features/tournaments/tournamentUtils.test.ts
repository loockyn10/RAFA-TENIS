import { describe, expect, it } from 'vitest'
import { bracketSize, firstRoundPlan } from './tournamentUtils'

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
