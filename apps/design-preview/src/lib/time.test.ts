import { describe, expect, it } from 'vitest'
import { addDays, duration, hhmm, overlaps, slots } from './time'

describe('time helpers', () => {
  it('formatea minutos como hora local', () => {
    expect(hhmm(7 * 60)).toBe('07:00')
    expect(hhmm(19 * 60 + 30)).toBe('19:30')
  })

  it('permite turnos contiguos y detecta solapes reales', () => {
    expect(overlaps({ start: 600, end: 660 }, { start: 660, end: 720 })).toBe(false)
    expect(overlaps({ start: 600, end: 690 }, { start: 660, end: 720 })).toBe(true)
  })

  it('genera la grilla visual de 07:00 a 23:00 cada 30 minutos', () => {
    const grid = slots()
    expect(grid[0]).toBe(420)
    expect(grid.at(-1)).toBe(22 * 60 + 30)
    expect(grid).toHaveLength(32)
  })

  it('suma días cruzando meses', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
  })

  it('describe duraciones cortas', () => {
    expect(duration(90)).toBe('1 h 30')
    expect(duration(60)).toBe('1 h')
  })
})
