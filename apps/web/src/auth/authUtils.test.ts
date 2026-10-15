import { describe, expect, it } from 'vitest'
import { groupInvitationCode, isNetworkError, isValidEmail, normalizeInvitationCode } from './authUtils'

describe('código de invitación', () => {
  const code = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
  it('se normaliza quitando espacios y pasando a minúsculas', () => {
    expect(normalizeInvitationCode(` ${groupInvitationCode(code).toUpperCase()}\n`)).toBe(code)
  })
  it('agrupa de a cuatro para leerlo mejor', () => {
    expect(groupInvitationCode('abcdefghij')).toBe('abcd efgh ij')
  })
})

describe('validaciones de acceso', () => {
  it('valida el formato del email', () => {
    expect(isValidEmail('juan@correo.test')).toBe(true)
    expect(isValidEmail('juan@')).toBe(false)
  })
  it('distingue un fallo de red de credenciales rechazadas', () => {
    expect(isNetworkError({ name: 'AuthRetryableFetchError', message: 'x', status: 0 })).toBe(true)
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError({ name: 'AuthApiError', message: 'Invalid login credentials', status: 400 })).toBe(false)
    expect(isNetworkError(null)).toBe(false)
  })
})
