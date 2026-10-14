import { describe, expect, it } from 'vitest'
import { findConflict } from '../lib/agenda'
import { champion } from '../lib/tournament'
import { buildDues, buildSeed, PEOPLE } from './mock'

describe('datos ficticios coherentes', () => {
  const seed = buildSeed()
  it('la agenda sembrada no tiene solapes en ninguna cancha', () => {
    seed.occupations.forEach((item) => expect(findConflict(seed.occupations, item, item.id)).toBeUndefined())
  })
  it('cada partido programado apunta a una ocupación de tipo torneo', () => {
    const ids = new Set(seed.occupations.filter((item) => item.kind === 'match').map((item) => item.id))
    seed.tournaments.flatMap((t) => t.categories).flatMap((c) => c.matches).filter((m) => m.occupationId).forEach((m) => expect(ids.has(m.occupationId!)).toBe(true))
  })
  it('el torneo finalizado tiene campeones en todas sus categorías', () => {
    const done = seed.tournaments.find((t) => t.status === 'completed')!
    done.categories.forEach((category) => expect(champion(category.matches)).not.toBeNull())
  })
  it('solo los socios activos tienen cuotas', () => {
    const members = new Set(PEOPLE.filter((p) => p.membership === 'active' && p.active).map((p) => p.id))
    buildDues().dues.forEach((due) => expect(members.has(due.personId)).toBe(true))
  })
})
