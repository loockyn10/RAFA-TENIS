import { useEffect, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { useAuth } from '../../auth/AuthProvider'
import { AppFrame } from '../../auth/AppFrame'
import { CourtList, type CourtPatch } from '../courts/CourtList'
import { ReservationCalendar, type CalendarFormRequest } from '../reservations/ReservationCalendar'
import { PeoplePanel } from '../people/PeoplePanel'
import { FinancePanel } from '../fees/FinancePanel'
import { SchoolPanel } from '../school/SchoolPanel'
import { TournamentPanel } from '../tournaments/TournamentPanel'
import { CanteenPanel } from '../canteen/CanteenPanel'
import { PlayerAccessPanel } from '../player/PlayerAccessPanel'
import { AdminHome, type HomeSlotRequest } from '../home/AdminHome'
import { AdminShell, type AdminSection } from '../shell/AdminShell'
import { todayInTimezone } from '../reservations/reservationUtils'
import type { Club, ClubMembership, ClubRole, Court } from '../../types/domain'

type MembershipRow = { club_id: string; role: ClubRole }

/** Contenedor transitorio de los módulos que todavía usan su interfaz anterior (ver docs/UI_INTEGRATION_MAP.md). */
function Legacy({ children }: { children: ReactNode }) {
  return <div className="legacy-zone legacy-scope">{children}</div>
}

export function AdminPanel({ user, onOpenPlayerPortal }: { user: User; onOpenPlayerPortal?: () => void }) {
  const { client, signOut } = useAuth()
  const [memberships, setMemberships] = useState<ClubMembership[]>([])
  const [clubs, setClubs] = useState<Club[]>([])
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null)
  const [courts, setCourts] = useState<Court[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [section, setSection] = useState<AdminSection>('home')
  const [requestedLessonId, setRequestedLessonId] = useState<string | null>(null)
  const [lessonCreation, setLessonCreation] = useState<{ courtId: string; date: string; startsAt: string } | null>(null)
  const [requestedTournamentReservationId, setRequestedTournamentReservationId] = useState<string | null>(null)
  const [formRequest, setFormRequest] = useState<CalendarFormRequest | null>(null)
  const [personRequest, setPersonRequest] = useState(0)

  useEffect(() => {
    let cancelled = false
    const loadMemberships = async () => {
      setStatus('loading')
      const { data: staffRows, error: staffError } = await client
        .from('club_staff')
        .select('club_id, role')
        .eq('auth_user_id', user.id)
      if (cancelled) return
      if (staffError) {
        setError('No pudimos verificar tus permisos administrativos. Intentá recargar la página.')
        setStatus('error')
        return
      }
      const nextMemberships = (staffRows ?? []).map((row) => ({ clubId: (row as MembershipRow).club_id, role: (row as MembershipRow).role }))
      setMemberships(nextMemberships)
      if (nextMemberships.length === 0) {
        setClubs([])
        setSelectedClubId(null)
        setStatus('ready')
        return
      }
      const { data: clubRows, error: clubsError } = await client
        .from('clubs')
        .select('id, name, timezone')
        .in('id', nextMemberships.map((membership) => membership.clubId))
      if (cancelled) return
      if (clubsError) {
        setError('No pudimos cargar los clubes autorizados.')
        setStatus('error')
        return
      }
      const nextClubs = (clubRows ?? []) as Club[]
      setClubs(nextClubs)
      setSelectedClubId((current) => current && nextClubs.some((club) => club.id === current) ? current : nextClubs[0]?.id ?? null)
      setStatus('ready')
    }
    void loadMemberships()
    return () => { cancelled = true }
  }, [client, user.id])

  useEffect(() => {
    let cancelled = false
    if (selectedClubId === null) {
      setCourts([])
      return
    }
    const loadCourts = async () => {
      const { data, error: courtsError } = await client
        .from('courts')
        .select('id, club_id, name, surface, active, display_order')
        .eq('club_id', selectedClubId)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true })
      if (cancelled) return
      if (courtsError) {
        setError('No pudimos cargar las canchas de este club.')
        return
      }
      setCourts((data ?? []) as Court[])
    }
    void loadCourts()
    return () => { cancelled = true }
  }, [client, selectedClubId])

  const selectedClub = clubs.find((club) => club.id === selectedClubId) ?? null
  const role = memberships.find((membership) => membership.clubId === selectedClubId)?.role
  const canManage = role === 'owner' || role === 'admin'

  const saveCourt = async (court: Court, patch: CourtPatch) => {
    if (selectedClubId === null || !canManage || court.club_id !== selectedClubId) return { error: 'No tenés permiso para modificar esta cancha.' }
    const { data, error: updateError } = await client
      .from('courts')
      .update(patch)
      .eq('id', court.id)
      .eq('club_id', selectedClubId)
      .select('id, club_id, name, surface, active, display_order')
      .single()
    if (updateError) return { error: 'No se pudieron guardar los cambios. Intentá nuevamente.' }
    setCourts((current) => current.map((item) => item.id === court.id ? data as Court : item))
    return {}
  }

  const closeSession = async () => {
    setIsSigningOut(true)
    const result = await signOut()
    if (result.error) setError('No pudimos cerrar la sesión. Intentá nuevamente.')
    setIsSigningOut(false)
  }

  // Un rol sin permiso no debe quedar parado en una sección restringida (por ejemplo al cambiar de club).
  const effectiveSection: AdminSection = !canManage && (section === 'fees' || section === 'playerAccess') ? 'home' : section

  const changeSection = (nextSection: AdminSection) => {
    setSection(nextSection)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' })
  }
  /** Los formularios de reserva y bloqueo son los reales de la agenda: se abren sobre la sección Reservas. */
  const requestForm = (kind: CalendarFormRequest['kind'], prefill: HomeSlotRequest = {}) => {
    setFormRequest({ id: Date.now(), kind, ...prefill })
    changeSection('reservations')
  }
  const requestLesson = () => {
    const court = courts.find((item) => item.active) ?? courts[0]
    if (!court || !selectedClub) { changeSection('school'); return }
    setLessonCreation({ courtId: court.id, date: todayInTimezone(selectedClub.timezone), startsAt: '07:00' })
    changeSection('school')
  }
  const requestPerson = () => { setPersonRequest((current) => current + 1); changeSection('people') }

  if (status === 'loading') return <AppFrame><div className="screen-message" role="status">Cargando acceso administrativo…</div></AppFrame>
  if (status === 'error') return <AppFrame><div className="screen-message error-message" role="alert">{error}</div></AppFrame>
  if (memberships.length === 0 || !selectedClub) return <AppFrame><NoClubAccess onSignOut={() => void closeSession()} signingOut={isSigningOut} /></AppFrame>

  return (
    <AdminShell
      section={effectiveSection}
      onNavigate={changeSection}
      club={selectedClub}
      clubs={clubs}
      onSelectClub={setSelectedClubId}
      role={role}
      canManage={canManage}
      userEmail={user.email ?? ''}
      onSignOut={() => void closeSession()}
      signingOut={isSigningOut}
      onOpenPlayerPortal={onOpenPlayerPortal}
      onNewReservation={() => requestForm('reservation')}
      onNewBlock={() => requestForm('block')}
      onNewLesson={requestLesson}
      onNewPerson={requestPerson}
    >
      {error && <p className="legacy-scope form-error" role="alert">{error}</p>}
      {effectiveSection === 'home' && <div className="rt"><AdminHome client={client} club={selectedClub} courts={courts} canManage={canManage} onNavigate={changeSection} onNewReservation={(request) => requestForm('reservation', request)} onNewBlock={(request) => requestForm('block', request)} /></div>}
      {effectiveSection === 'reservations' && <div className="rt"><ReservationCalendar client={client} club={selectedClub} courts={courts} formRequest={formRequest} onFormRequestHandled={() => setFormRequest(null)} onOpenLesson={(lessonId) => { setRequestedLessonId(lessonId); changeSection('school') }} onOpenTournamentMatch={(reservationId) => { setRequestedTournamentReservationId(reservationId); changeSection('tournaments') }} onCreateLesson={(request) => { setLessonCreation(request); changeSection('school') }} /></div>}
      {effectiveSection === 'canteen' && <div className="rt"><CanteenPanel client={client} club={selectedClub} canManageCatalog={canManage} /></div>}
      {effectiveSection === 'school' && <Legacy><SchoolPanel client={client} club={selectedClub} courts={courts} canManageCoaches={canManage} requestedLessonId={requestedLessonId} onRequestedLessonHandled={() => setRequestedLessonId(null)} requestedCreation={lessonCreation} onRequestedCreationHandled={() => setLessonCreation(null)} /></Legacy>}
      {effectiveSection === 'tournaments' && <Legacy><TournamentPanel client={client} club={selectedClub} courts={courts} canManage={canManage} requestedReservationId={requestedTournamentReservationId} onRequestedReservationHandled={() => setRequestedTournamentReservationId(null)} /></Legacy>}
      {effectiveSection === 'people' && <Legacy><PeoplePanel client={client} club={selectedClub} canManageMemberships={canManage} createRequest={personRequest} onCreateRequestHandled={() => setPersonRequest(0)} /></Legacy>}
      {effectiveSection === 'fees' && canManage && <Legacy><FinancePanel client={client} club={selectedClub} canManage={canManage} /></Legacy>}
      {effectiveSection === 'playerAccess' && canManage && <Legacy><PlayerAccessPanel client={client} club={selectedClub} /></Legacy>}
      {effectiveSection === 'courts' && <Legacy><CourtList courts={courts} canManage={canManage} onSave={saveCourt} /></Legacy>}
    </AdminShell>
  )
}

function NoClubAccess({ onSignOut, signingOut }: { onSignOut: () => void; signingOut: boolean }) {
  return <section className="configuration-card"><p className="eyebrow">Acceso restringido</p><h2>No tenés acceso administrativo a ningún club.</h2><p className="intro">Pedile a la persona responsable que verifique tu membresía administrativa.</p><button className="secondary-button" type="button" onClick={onSignOut} disabled={signingOut}>{signingOut ? 'Cerrando…' : 'Cerrar sesión'}</button></section>
}
