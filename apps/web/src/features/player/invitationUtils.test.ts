import { describe, expect, it } from 'vitest'
import { expiryFromNow, invitationErrorMessage, invitationStatus, linkedPeople, type PlayerInvitation } from './invitationUtils'

const now = Date.parse('2026-10-14T12:00:00Z')
const invitation = (patch: Partial<PlayerInvitation> = {}): PlayerInvitation => ({ id: 'i', person_id: 'p', person_name: 'Ana', expires_at: '2026-10-20T12:00:00Z', created_at: '2026-10-13T12:00:00Z', redeemed_at: null, revoked_at: null, ...patch })

describe('invitationStatus', () => {
  it('distingue pendiente, usada, revocada y vencida', () => {
    expect(invitationStatus(invitation(), now)).toBe('pending')
    expect(invitationStatus(invitation({ expires_at: '2026-10-14T11:59:59Z' }), now)).toBe('expired')
    expect(invitationStatus(invitation({ redeemed_at: '2026-10-14T10:00:00Z' }), now)).toBe('redeemed')
    expect(invitationStatus(invitation({ revoked_at: '2026-10-14T10:00:00Z' }), now)).toBe('revoked')
  })
  it('una invitación usada sigue siendo usada aunque haya vencido después', () => {
    expect(invitationStatus(invitation({ redeemed_at: '2026-10-14T10:00:00Z', expires_at: '2026-10-14T11:00:00Z' }), now)).toBe('redeemed')
  })
})

describe('linkedPeople', () => {
  it('lista una sola vez a cada persona con invitación canjeada, ordenada por nombre', () => {
    const list = linkedPeople([
      invitation({ id: '1', person_id: 'b', person_name: 'Beto', redeemed_at: '2026-10-14T10:00:00Z' }),
      invitation({ id: '2', person_id: 'a', person_name: 'Ana', redeemed_at: '2026-10-14T10:00:00Z' }),
      invitation({ id: '3', person_id: 'a', person_name: 'Ana', redeemed_at: '2026-10-14T11:00:00Z' }),
      invitation({ id: '4', person_id: 'c', person_name: 'Caro' }),
    ])
    expect(list).toEqual([{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Beto' }])
  })
})

describe('invitaciones', () => {
  it('calcula el vencimiento a partir de ahora', () => {
    expect(expiryFromNow(7, now)).toBe('2026-10-21T12:00:00.000Z')
  })
  it('explica los errores sin mostrar detalles técnicos', () => {
    expect(invitationErrorMessage({ code: '23505' })).toMatch(/ya tiene una cuenta/)
    expect(invitationErrorMessage({ code: 'XX000', message: 'function digest(text) does not exist' })).not.toMatch(/digest/)
  })
})
