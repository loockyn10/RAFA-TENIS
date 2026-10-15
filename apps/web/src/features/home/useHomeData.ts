import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club, Reservation } from '../../types/domain'
import { OCCUPATION_FIELDS, shiftCalendarDate, sortReservations, todayInTimezone, zonedDateTimeToIso } from '../reservations/reservationUtils'

export type HomeCanteen = { collectedCents: number; salesCount: number }
export type HomeData = {
  status: 'loading' | 'ready' | 'error'
  /** Ocupaciones de hoy (reservas, clases, partidos y bloqueos activos). Solo lectura. */
  occupations: Reservation[]
  /** null = no disponible (sin permiso o error de lectura): la pantalla lo informa, nunca lo inventa. */
  canteen: HomeCanteen | null
  reload: () => void
}

const REFRESH_MS = 120_000

/**
 * Lecturas acotadas para el Inicio: las ocupaciones de un único día y dos consultas livianas de la cantina de hoy.
 * Usa las mismas tablas, filtros y permisos que Reservas y Cantina; no agrega backend.
 */
export function useHomeData(client: SupabaseClient, club: Club): HomeData {
  const [state, setState] = useState<Omit<HomeData, 'reload'>>({ status: 'loading', occupations: [], canteen: null })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    const timer = window.setInterval(reload, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [reload])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const today = todayInTimezone(club.timezone)
      const startsAt = zonedDateTimeToIso(today, '00:00', club.timezone)
      const endsAt = zonedDateTimeToIso(shiftCalendarDate(today, 1), '00:00', club.timezone)
      const [occupationResult, paymentResult, salesResult] = await Promise.all([
        client.from('reservations').select(OCCUPATION_FIELDS).eq('club_id', club.id).in('status', ['confirmed', 'active']).lt('starts_at', endsAt).gt('ends_at', startsAt).order('starts_at', { ascending: true }),
        client.from('canteen_sale_payments').select('amount_cents').eq('club_id', club.id).eq('payment_date', today),
        client.from('canteen_sales').select('id', { count: 'exact', head: true }).eq('club_id', club.id).eq('status', 'confirmed').gte('created_at', startsAt).lt('created_at', endsAt),
      ])
      if (cancelled) return
      if (occupationResult.error) {
        setState((current) => ({ ...current, status: 'error' }))
        return
      }
      const canteen: HomeCanteen | null = paymentResult.error || salesResult.error
        ? null
        : { collectedCents: ((paymentResult.data ?? []) as { amount_cents: number }[]).reduce((sum, row) => sum + row.amount_cents, 0), salesCount: salesResult.count ?? 0 }
      setState({ status: 'ready', occupations: sortReservations((occupationResult.data ?? []) as Reservation[]), canteen })
    }
    void load()
    return () => { cancelled = true }
  }, [client, club.id, club.timezone, tick])

  return { ...state, reload }
}
