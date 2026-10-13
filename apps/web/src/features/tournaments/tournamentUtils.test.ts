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

  it('rechaza cantidades fuera del MVP', () => {
    expect(() => bracketSize(1)).toThrow('entre 2 y 32')
    expect(() => bracketSize(33)).toThrow('entre 2 y 32')
  })
})
