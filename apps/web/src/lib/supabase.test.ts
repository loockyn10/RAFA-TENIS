import { describe, expect, it } from 'vitest'
import { getSupabaseConfiguration } from './supabase'

describe('getSupabaseConfiguration', () => {
  it('detecta variables públicas ausentes', () => {
    const configuration = getSupabaseConfiguration({})

    expect(configuration.isConfigured).toBe(false)
    expect(configuration.issues).toContain('Falta VITE_SUPABASE_URL.')
    expect(configuration.issues).toContain('Falta VITE_SUPABASE_PUBLISHABLE_KEY.')
  })

  it('acepta URL y clave publicable configuradas', () => {
    const configuration = getSupabaseConfiguration({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
    })

    expect(configuration.isConfigured).toBe(true)
  })
})
