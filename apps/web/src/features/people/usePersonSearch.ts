import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club, ClubPerson } from '../../types/domain'

export const PERSON_FIELDS = 'id, club_id, full_name, phone, email, notes, active, created_at, updated_at'

/**
 * Búsqueda de fichas activas del club para los selectores (alumnos, profesores, inscripciones).
 * Misma tabla, filtros y permisos que Jugadores; sin texto muestra las primeras fichas por nombre.
 */
export function usePersonSearch(client: SupabaseClient, club: Club, enabled: boolean) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ClubPerson[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      const term = query.trim().replace(/[%_,()]/g, ' ')
      try {
        const base = client.from('club_people').select(PERSON_FIELDS).eq('club_id', club.id).eq('active', true)
        const { data, error } = await (term ? base.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`) : base).order('full_name').limit(8)
        if (!cancelled) setResults(error ? [] : (data ?? []) as ClubPerson[])
      } catch {
        if (!cancelled) setResults([])
      }
      if (!cancelled) setLoading(false)
    }, query ? 200 : 0)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [client, club.id, enabled, query])

  const reset = useCallback(() => setQuery(''), [])
  return { query, setQuery, results, loading, reset }
}

/** Alta rápida de ficha (solo nombre), igual que en Jugadores: sin cuenta ni membresía. */
export async function createQuickPerson(client: SupabaseClient, club: Club, fullName: string): Promise<{ person?: ClubPerson; error?: string }> {
  const { data, error } = await client.from('club_people').insert({ club_id: club.id, full_name: fullName.trim().replace(/\s+/g, ' '), active: true }).select(PERSON_FIELDS).single()
  if (error || !data) return { error: 'No pudimos crear la ficha. Intentá nuevamente.' }
  return { person: data as ClubPerson }
}
