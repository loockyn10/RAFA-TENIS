import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type PublicEnvironment = Record<string, string | undefined>

export type SupabaseConfiguration = {
  isConfigured: boolean
  issues: string[]
  url?: string
  publishableKey?: string
}

export function getSupabaseConfiguration(environment: PublicEnvironment): SupabaseConfiguration {
  const url = environment.VITE_SUPABASE_URL?.trim()
  const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  const issues: string[] = []

  if (!url) {
    issues.push('Falta VITE_SUPABASE_URL.')
  } else {
    try {
      const parsedUrl = new URL(url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        issues.push('VITE_SUPABASE_URL debe usar http o https.')
      }
    } catch {
      issues.push('VITE_SUPABASE_URL no es una URL válida.')
    }
  }

  if (!publishableKey) {
    issues.push('Falta VITE_SUPABASE_PUBLISHABLE_KEY.')
  }

  return { isConfigured: issues.length === 0, issues, url, publishableKey }
}

const environment = import.meta.env as PublicEnvironment
export const supabaseConfiguration = getSupabaseConfiguration(environment)

export const supabase: SupabaseClient | null = supabaseConfiguration.isConfigured
  ? createClient(supabaseConfiguration.url!, supabaseConfiguration.publishableKey!)
  : null
