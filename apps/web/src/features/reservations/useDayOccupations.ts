import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club } from '../../types/domain'
import { shiftCalendarDate, zonedDateTimeToIso } from './reservationUtils'

export type DayOccupation = { id: string; court_id: string; starts_at: string; ends_at: string }

/**
 * Ocupación activa de un día (reservas, clases, partidos y bloqueos) para avisar de choques antes de guardar.
 * Es informativa: la restricción definitiva es la exclusión de PostgreSQL. Devuelve null si no pudo leerse.
 */
export function useDayOccupations(client: SupabaseClient, club: Club, date: string, enabled = true): DayOccupation[] | null {
  const [occupations, setOccupations] = useState<DayOccupation[] | null>(null)
  useEffect(() => {
    if (!enabled || !date) return
    let cancelled = false
    const load = async () => {
      try {
        const dayStart = zonedDateTimeToIso(date, '00:00', club.timezone)
        const dayEnd = zonedDateTimeToIso(shiftCalendarDate(date, 1), '00:00', club.timezone)
        const { data, error } = await client.from('reservations').select('id, court_id, starts_at, ends_at').eq('club_id', club.id).in('status', ['confirmed', 'active']).lt('starts_at', dayEnd).gt('ends_at', dayStart)
        if (!cancelled) setOccupations(error ? null : (data ?? []) as DayOccupation[])
      } catch {
        if (!cancelled) setOccupations(null)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [client, club.id, club.timezone, date, enabled])
  return occupations
}

/** ¿Hay otra ocupación en la cancha y el intervalo? undefined = sin información. */
export function courtBusyIn(occupations: DayOccupation[] | null, courtId: string, startsIso: string, endsIso: string, ignoreId?: string | null): boolean | undefined {
  if (occupations === null || !startsIso || !endsIso || endsIso <= startsIso) return undefined
  const start = new Date(startsIso).getTime()
  const end = new Date(endsIso).getTime()
  return occupations.some((item) => item.court_id === courtId && item.id !== ignoreId && new Date(item.starts_at).getTime() < end && new Date(item.ends_at).getTime() > start)
}
