import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useAuth } from '../../auth/AuthProvider'
import { AuthLayout, AuthNotice } from '../../auth/AuthLayout'
import { Button, ErrorState, SkeletonCards } from '../../design/ui'
import type { OnlineBookingSettings, PlayerClubAccess, PlayerReservation } from '../../types/domain'
import { PlayerShell, type PlayerSection } from './PlayerShell'
import { PlayerBook, PlayerHome, PlayerProfile, PlayerTournaments, PlayerTurns, type PlayerDue, type PlayerProfileData, type Remote } from './PlayerScreens'
import type { PortalTournament } from './portalUtils'

type Core = { settings: OnlineBookingSettings; reservations: PlayerReservation[]; profile: PlayerProfileData }

/**
 * Portal del jugador. Cada consulta es una RPC con alcance limitado: el servidor resuelve la persona y el club a partir
 * de la sesión (Auth → cuenta vinculada → ficha → club), así que aquí solo se muestra lo que esa cuenta puede ver.
 * Al cambiar de club se descarta todo lo cargado para no mezclar datos entre clubes.
 */
export function PlayerPortal({ access, user, onOpenAdmin }: { access: PlayerClubAccess[]; user: User; onOpenAdmin?: () => void }) {
  const { client, signOut } = useAuth()
  const [clubId, setClubId] = useState(access[0]?.club_id ?? '')
  const [section, setSection] = useState<PlayerSection>('home')
  const [core, setCore] = useState<Remote<Core | null>>({ status: 'loading', data: null })
  const [dues, setDues] = useState<Remote<PlayerDue[]>>({ status: 'loading', data: [] })
  const [tournaments, setTournaments] = useState<Remote<PortalTournament[]>>({ status: 'loading', data: [] })
  const [signingOut, setSigningOut] = useState(false)
  const club = access.find((item) => item.club_id === clubId) ?? access[0]
  const activeClubId = club?.club_id
  const clubRef = useRef(activeClubId)
  clubRef.current = activeClubId

  const loadCore = useCallback(async (silent = false) => {
    if (!activeClubId) return
    if (!silent) setCore({ status: 'loading', data: null })
    const [settings, reservations, profile] = await Promise.all([
      client.rpc('get_online_booking_settings', { p_club_id: activeClubId }),
      client.rpc('player_reservations', { p_club_id: activeClubId }),
      client.rpc('player_profile', { p_club_id: activeClubId }),
    ])
    if (clubRef.current !== activeClubId) return
    if (settings.error || reservations.error || profile.error || !profile.data) {
      setCore((current) => (silent && current.data ? current : { status: 'error', data: null }))
      return
    }
    setCore({ status: 'ready', data: { settings: settings.data as OnlineBookingSettings, reservations: (reservations.data ?? []) as PlayerReservation[], profile: profile.data as PlayerProfileData } })
  }, [client, activeClubId])

  const loadDues = useCallback(async () => {
    if (!activeClubId) return
    setDues({ status: 'loading', data: [] })
    const { data, error } = await client.rpc('player_membership_dues', { p_club_id: activeClubId })
    if (clubRef.current !== activeClubId) return
    setDues(error ? { status: 'error', data: [] } : { status: 'ready', data: (data ?? []) as PlayerDue[] })
  }, [client, activeClubId])

  const loadTournaments = useCallback(async () => {
    if (!activeClubId) return
    setTournaments({ status: 'loading', data: [] })
    const { data, error } = await client.rpc('player_tournaments', { p_club_id: activeClubId })
    if (clubRef.current !== activeClubId) return
    setTournaments(error ? { status: 'error', data: [] } : { status: 'ready', data: (data ?? []) as PortalTournament[] })
  }, [client, activeClubId])

  // Cada cambio de club vacía el estado antes de cargar; las respuestas que llegan tarde de otro club se descartan (clubRef).
  useEffect(() => {
    void loadCore(); void loadDues(); void loadTournaments()
  }, [loadCore, loadDues, loadTournaments])

  const navigate = (next: PlayerSection) => {
    setSection(next)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' })
  }
  const selectClub = (nextClubId: string) => { setClubId(nextClubId); setSection('home') }
  const closeSession = async () => { setSigningOut(true); await signOut(); setSigningOut(false) }

  if (!club) {
    return <AuthLayout><AuthNotice kicker="Portal del jugador" title="Tu cuenta no tiene clubes vinculados" action={<Button variant="secondary" icon="logout" onClick={() => void closeSession()}>Cerrar sesión</Button>} /></AuthLayout>
  }

  const ready = core.status === 'ready' ? core.data : null
  return (
    <PlayerShell section={section} onNavigate={navigate} club={club} access={access} onSelectClub={selectClub} userEmail={user.email ?? ''} onOpenAdmin={onOpenAdmin} onSignOut={() => void closeSession()} signingOut={signingOut}>
      {core.status === 'loading' && <div role="status" aria-label="Cargando tu portal"><SkeletonCards count={3} height={120} /></div>}
      {core.status === 'error' && <ErrorState title="No pudimos cargar tu portal" body="Revisá la conexión e intentá de nuevo. No se perdió ningún dato." onRetry={() => void loadCore()} />}
      {ready && section === 'home' && <PlayerHome club={club} profile={ready.profile} reservations={ready.reservations} dues={dues} tournaments={tournaments} onNavigate={navigate} />}
      {ready && section === 'book' && <PlayerBook client={client} club={club} settings={ready.settings} reservations={ready.reservations} onBooked={() => void loadCore(true)} onNavigate={navigate} />}
      {ready && section === 'turns' && <PlayerTurns client={client} club={club} settings={ready.settings} reservations={ready.reservations} onChanged={() => void loadCore(true)} onNavigate={navigate} />}
      {ready && section === 'tournaments' && <PlayerTournaments tournaments={tournaments} profile={ready.profile} onRetry={() => void loadTournaments()} />}
      {ready && section === 'profile' && <PlayerProfile client={client} club={club} profile={ready.profile} dues={dues} onSaved={() => void loadCore(true)} onRetryDues={() => void loadDues()} />}
    </PlayerShell>
  )
}
