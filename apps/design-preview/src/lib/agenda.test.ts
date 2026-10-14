import { describe, expect, it } from 'vitest'
import type { Occupation } from '../data/mock'
import { findConflict, nextStartAfter, occupationAt } from './agenda'

const base: Occupation[] = [
  { id: 'a', courtId: 'c1', date: '2026-10-14', start: 600, end: 660, kind: 'reservation', title: 'A' },
  { id: 'b', courtId: 'c1', date: '2026-10-14', start: 720, end: 810, kind: 'block', title: 'Lluvia' },
]

describe('agenda', () => {
  it('detecta conflicto en la misma cancha y fecha', () => {
    expect(findConflict(base, { courtId: 'c1', date: '2026-10-14', start: 630, end: 690 })?.id).toBe('a')
  })
  it('acepta turnos contiguos, otra cancha u otra fecha', () => {
    expect(findConflict(base, { courtId: 'c1', date: '2026-10-14', start: 660, end: 720 })).toBeUndefined()
    expect(findConflict(base, { courtId: 'c2', date: '2026-10-14', start: 600, end: 660 })).toBeUndefined()
    expect(findConflict(base, { courtId: 'c1', date: '2026-10-15', start: 600, end: 660 })).toBeUndefined()
  })
  it('ignora la ocupación que se está editando', () => {
    expect(findConflict(base, { courtId: 'c1', date: '2026-10-14', start: 600, end: 690 }, 'a')).toBeUndefined()
  })
  it('informa qué ocupa la cancha y cuándo empieza lo próximo', () => {
    expect(occupationAt(base, 'c1', '2026-10-14', 630)?.id).toBe('a')
    expect(nextStartAfter(base, 'c1', '2026-10-14', 661)).toBe(720)
  })
})
