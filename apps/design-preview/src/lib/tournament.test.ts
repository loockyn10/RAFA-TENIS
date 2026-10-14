import { describe, expect, it } from 'vitest'
import { bracketSize, canRecord, champion, drawSlots, generateFixture, matchState, recordResult, roundCount, roundName, scoreBySide, shuffle } from './tournament'

const ids = (n: number) => Array.from({ length: n }, (_, index) => `e${index + 1}`)

describe('cuadro de eliminación directa', () => {
  it('calcula tamaño y rondas para 2 a 32 inscripciones', () => {
    expect(bracketSize(2)).toBe(2)
    expect(bracketSize(5)).toBe(8)
    expect(bracketSize(17)).toBe(32)
    expect(roundCount(8)).toBe(3)
    expect(roundName(1, 3)).toBe('Cuartos')
    expect(roundName(3, 3)).toBe('Final')
  })

  it('reparte pases libres sin enfrentarlos entre sí', () => {
    for (let n = 2; n <= 32; n += 1) {
      const slots = drawSlots(ids(n))
      expect(slots).toHaveLength(bracketSize(n))
      expect(slots.filter(Boolean)).toHaveLength(n)
      for (let m = 0; m < slots.length; m += 2) expect(slots[m] !== null || slots[m + 1] !== null).toBe(true)
    }
  })

  it('genera n-1 partidos reales y avanza los pases libres', () => {
    const matches = generateFixture(drawSlots(ids(5)), 't')
    expect(matches).toHaveLength(7)
    expect(matches.filter((match) => match.bye)).toHaveLength(3)
    expect(matches.filter((match) => match.round === 2).every((match) => match.a || match.b)).toBe(true)
  })

  it('el ganador avanza al casillero correcto y define al campeón', () => {
    let matches = generateFixture(ids(4), 't')
    matches = recordResult(matches, 't-r1-0', 'b', '6-3 6-4')
    matches = recordResult(matches, 't-r1-1', 'a', '7-5 6-2')
    const final = matches.find((match) => match.id === 't-r2-0')!
    expect([final.a, final.b]).toEqual(['e2', 'e3'])
    expect(matchState(final)).toBe('unscheduled')
    matches = recordResult(matches, 't-r2-0', 'a', undefined, true)
    expect(champion(matches)).toBe('e2')
  })

  it('no permite corregir un partido si el siguiente ya tiene resultado', () => {
    let matches = generateFixture(ids(4), 't')
    matches = recordResult(matches, 't-r1-0', 'a', '6-0 6-0')
    matches = recordResult(matches, 't-r1-1', 'a', '6-0 6-0')
    matches = recordResult(matches, 't-r2-0', 'a', '6-1 6-1')
    const semi = matches.find((match) => match.id === 't-r1-0')!
    expect(canRecord(matches, semi)).toBe(false)
    expect(recordResult(matches, semi.id, 'b', '6-0 6-0')).toBe(matches)
  })

  it('orienta el marcador por lado aunque gane el segundo', () => {
    const [match] = recordResult(generateFixture(ids(2), 't'), 't-r1-0', 'b', '6-4 3-6 10-7')
    expect(scoreBySide(match)).toEqual({ a: ['4', '6', '7'], b: ['6', '3', '10'] })
  })

  it('el sorteo es una permutación reproducible', () => {
    expect(shuffle(ids(8), 42)).toEqual(shuffle(ids(8), 42))
    expect([...shuffle(ids(8), 42)].sort()).toEqual([...ids(8)].sort())
  })
})
