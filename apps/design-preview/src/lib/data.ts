import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NOW, PLAYER_ID, TODAY, type Court, type Occupation, type Person, type Tournament } from '../data/mock'
import { capitalize, dateShort, hhmm, weekdayShort } from './time'
import { useProto } from './proto'
import { useStore, type Intent } from './store'
import { champion, matchState, roundCount, roundName, type Match } from './tournament'

/** Canchas en el orden configurado. `active` alimenta la agenda y las reservas. */
export function useCourts() {
  const { state } = useStore()
  return useMemo(() => {
    const courts = [...state.courts].sort((a, b) => a.order - b.order)
    const byId = (id: string | null | undefined): Court | undefined => courts.find((court) => court.id === id)
    return { courts, active: courts.filter((court) => court.active), byId, name: (id: string) => byId(id)?.name ?? 'Cancha' }
  }, [state.courts])
}

export function usePeople() {
  const { state } = useStore()
  return useMemo(() => {
    const byId = (id: string | null | undefined): Person | undefined => state.people.find((person) => person.id === id)
    return { people: state.people, active: state.people.filter((person) => person.active), byId }
  }, [state.people])
}

/** Consume un pedido de navegación con contexto (abrir ficha, clase, formulario…) dirigido a esta pantalla. */
export function useIntent<K extends Intent['kind']>(kinds: K[], onIntent: (intent: Extract<Intent, { kind: K }>) => void) {
  const { state, dispatch } = useStore()
  const handler = useRef(onIntent)
  handler.current = onIntent
  const key = kinds.join('|')
  useEffect(() => {
    const intent = state.intent
    if (!intent || !key.split('|').includes(intent.kind)) return
    handler.current(intent as Extract<Intent, { kind: K }>)
    dispatch({ type: 'intent/clear' })
  }, [state.intent, key, dispatch])
}

/** Operación simulada con latencia, error y reintento. Devuelve true si se confirmó. */
export function useAction() {
  const { simulate } = useProto()
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const run = useCallback(async (commit: () => void, ms?: number) => {
    setStatus('saving')
    try {
      await simulate(ms)
    } catch {
      setStatus('error')
      return false
    }
    commit()
    setStatus('idle')
    return true
  }, [simulate])
  const reset = useCallback(() => setStatus('idle'), [])
  return { status, run, reset, saving: status === 'saving', failed: status === 'error' }
}

// ── Torneos derivados ────────────────────────────────────────────────
export type CategoryStatus = 'open' | 'fixture' | 'completed'
export function categoryStatus(matches: Match[]): CategoryStatus {
  if (matches.length === 0) return 'open'
  return champion(matches) ? 'completed' : 'fixture'
}

/** Partido próximo de la jugadora del portal (o el último jugado si ya no tiene). */
export function playerTournamentView(tournaments: Tournament[]) {
  for (const tournament of tournaments.filter((item) => item.status === 'in_progress' || item.status === 'registration')) {
    for (const category of tournament.categories) {
      const entry = category.entries.find((item) => item.personIds.includes(PLAYER_ID))
      if (!entry) continue
      const rounds = category.matches.length ? roundCount(category.matches.filter((match) => match.round === 1).length * 2) : 0
      const mine = category.matches.filter((match) => match.a === entry.id || match.b === entry.id).sort((a, b) => a.round - b.round)
      const next = mine.find((match) => matchState(match) !== 'done' && matchState(match) !== 'bye')
      return { tournament, category, entry, rounds, next, nextRound: next ? roundName(next.round, rounds) : undefined }
    }
  }
  return null
}

/** Cuándo y dónde se juega un partido según su ocupación en la agenda única. */
export function matchWhen(match: Match, ctx: { occupations: Occupation[]; courtName: (id: string) => string }): { text: string; live: boolean } | null {
  const occupation = ctx.occupations.find((item) => item.id === match.occupationId)
  if (!occupation) return null
  const live = occupation.date === TODAY && occupation.start <= NOW && NOW < occupation.end
  const day = occupation.date === TODAY ? 'Hoy' : `${capitalize(weekdayShort(occupation.date))} ${dateShort(occupation.date)}`
  return { text: `${day} · ${hhmm(occupation.start)} · ${occupation.courtId ? ctx.courtName(occupation.courtId) : ''}`, live }
}
