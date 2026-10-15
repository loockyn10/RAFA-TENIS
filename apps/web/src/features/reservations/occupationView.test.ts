import { describe, expect, it } from 'vitest'
import { courtShort, occupationKind, occupationTitle } from './occupationView'

describe('occupationView', () => {
  it('traduce el tipo de ocupación real al tipo visual', () => {
    expect(occupationKind('tournament_match')).toBe('match')
    expect(occupationKind('lesson')).toBe('lesson')
    expect(occupationKind('block')).toBe('block')
  })
  it('titula cada ocupación sin inventar datos', () => {
    expect(occupationTitle({ occupation_type: 'reservation', customer_name: 'Ana', block_reason: null })).toBe('Ana')
    expect(occupationTitle({ occupation_type: 'reservation', customer_name: null, block_reason: null })).toBe('Reserva')
    expect(occupationTitle({ occupation_type: 'block', customer_name: null, block_reason: 'Lluvia' })).toBe('Lluvia')
    expect(occupationTitle({ occupation_type: 'lesson', customer_name: null, block_reason: null })).toBe('Clase de tenis')
    expect(occupationTitle({ occupation_type: 'tournament_match', customer_name: null, block_reason: null })).toBe('Partido de torneo')
  })
  it('marca corta de cancha: número si existe, iniciales si no', () => {
    expect(courtShort({ name: 'Cancha 4' })).toBe('4')
    expect(courtShort({ name: 'Central' })).toBe('CE')
  })
})
