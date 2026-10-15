import { lazy, Suspense, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useAuth } from '../../auth/AuthProvider'
import { AuthLayout, AuthLoading, AuthNotice, SignOutButton } from '../../auth/AuthLayout'
import { AdminShell, type AdminSection } from '../shell/AdminShell'
import { SkeletonCards } from '../../design/ui'
import { NotificationBell } from '../notifications/NotificationBell'
import type { CourtPatch } from '../courts/CourtList'
import type { CalendarFormRequest } from '../reservations/ReservationCalendar'
import type { HomeSlotRequest } from '../home/AdminHome'
import { todayInTimezone } from '../reservations/reservationUtils'
import type { AppNotification, Club, ClubMembership, ClubRole, Court } from '../../types/domain'

type MembershipRow = { club_id: string; role: ClubRole }

// Cada módulo se descarga cuando se abre por primera vez: el primer pantallazo no carga la cantina, el fixture ni la escuela.
const AdminHome = lazy(() => import('../home/AdminHome').then((module) => ({ default: module.AdminHome })))
const ReservationCalendar = lazy(() => import('../reservations/ReservationCalendar').then((module) => ({ default: module.ReservationCalendar })))
const CanteenPanel = lazy(() => import('../canteen/CanteenPanel').then((module) => ({ default: module.CanteenPanel })))
const SchoolPanel = lazy(() => import('../school/SchoolPanel').then((module) => ({ default: module.SchoolPanel })))
const TournamentPanel = lazy(() => import('../tournaments/TournamentPanel').then((module) => ({ default: module.TournamentPanel })))
const PeoplePanel = lazy(() => import('../people/PeoplePanel').then((module) => ({ default: module.PeoplePanel })))
const FinancePanel = lazy(() => import('../fees/FinancePanel').then((module) => ({ default: module.FinancePanel })))
const SettingsPanel = lazy(() => import('../settings/SettingsPanel').then((module) => ({ default: module.SettingsPanel })))
const PlayerAccessPanel = lazy(() => import('../player/PlayerAccessPanel').then((module) => ({ default: module.PlayerAccessPanel })))
const NewsAdminPanel = lazy(() => import('../news/NewsAdminPanel').then((module) => ({ default: module.NewsAdminPanel })))
const CourtsPanel = lazy(() => import('../courts/CourtList').then((module) => ({ default: module.CourtsPanel })))

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
  const [canteenPendingSearch, setCanteenPendingSearch] = useState<string | undefined>(undefined)

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
    setCourts((current) => current.map((item) => item.id === court.id ? data as Court : item).sort((first, second) => first.display_order - second.display_order || first.name.localeCompare(second.name, 'es')))
    return {}
  }

  const closeSession = async () => {
    setIsSigningOut(true)
    const result = await signOut()
    if (result.error) setError('No pudimos cerrar la sesión. Intentá nuevamente.')
    setIsSigningOut(false)
  }

  // Un rol sin permiso no debe quedar parado en una sección restringida (por ejemplo al cambiar de club).
  const effectiveSection: AdminSection = !canManage && (section === 'fees' || section === 'playerAccess' || section === 'settings') ? 'home' : section

  const changeSection = (nextSection: AdminSection) => {
    if (nextSection !== 'canteen') setCanteenPendingSearch(undefined)
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

  /** Al abrir un aviso se va a la sección donde ocurrió: reservas para turnos, novedades para publicaciones. */
  const openNotification = (notification: AppNotification) => changeSection(notification.target_type === 'reservation' ? 'reservations' : 'news')

  if (status === 'loading') return <AuthLoading message="Cargando acceso administrativo…" />
  if (status === 'error') return <AuthLayout><AuthNotice kicker="Administración" title="No pudimos cargar tu acceso" tone="error" action={<SignOutButton onSignOut={() => void closeSession()} busy={isSigningOut} />}><p>{error}</p></AuthNotice></AuthLayout>
  if (memberships.length === 0 || !selectedClub) return <AuthLayout><AuthNotice kicker="Acceso restringido" title="No tenés acceso administrativo a ningún club." action={<SignOutButton onSignOut={() => void closeSession()} busy={isSigningOut} />}><p>Pedile a la persona responsable que verifique tu membresía administrativa.</p></AuthNotice></AuthLayout>

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
      notifications={<NotificationBell client={client} clubId={selectedClub.id} timezone={selectedClub.timezone} onOpenNotification={openNotification} />}
    >
      {error && <p className="inline-alert inline-alert-danger" role="alert">{error}</p>}
      <Suspense fallback={<div className="rt" role="status" aria-label="Cargando sección"><SkeletonCards count={3} height={96} /></div>}>
      {effectiveSection === 'home' && <div className="rt"><AdminHome client={client} club={selectedClub} courts={courts} canManage={canManage} onNavigate={changeSection} onNewReservation={(request) => requestForm('reservation', request)} onNewBlock={(request) => requestForm('block', request)} /></div>}
      {effectiveSection === 'reservations' && <div className="rt"><ReservationCalendar client={client} club={selectedClub} courts={courts} canManageFinances={canManage} formRequest={formRequest} onFormRequestHandled={() => setFormRequest(null)} onOpenLesson={(lessonId) => { setRequestedLessonId(lessonId); changeSection('school') }} onOpenTournamentMatch={(reservationId) => { setRequestedTournamentReservationId(reservationId); changeSection('tournaments') }} onCreateLesson={(request) => { setLessonCreation(request); changeSection('school') }} /></div>}
      {effectiveSection === 'canteen' && <div className="rt"><CanteenPanel client={client} club={selectedClub} canManageCatalog={canManage} initialPendingSearch={canteenPendingSearch} /></div>}
      {effectiveSection === 'school' && <div className="rt"><SchoolPanel client={client} club={selectedClub} courts={courts} canManageCoaches={canManage} requestedLessonId={requestedLessonId} onRequestedLessonHandled={() => setRequestedLessonId(null)} requestedCreation={lessonCreation} onRequestedCreationHandled={() => setLessonCreation(null)} /></div>}
      {effectiveSection === 'tournaments' && <div className="rt"><TournamentPanel client={client} club={selectedClub} courts={courts} canManage={canManage} requestedReservationId={requestedTournamentReservationId} onRequestedReservationHandled={() => setRequestedTournamentReservationId(null)} /></div>}
      {effectiveSection === 'people' && <div className="rt"><PeoplePanel client={client} club={selectedClub} canManageMemberships={canManage} createRequest={personRequest} onCreateRequestHandled={() => setPersonRequest(0)} onNavigate={changeSection} onOpenCanteenPending={(name) => { setCanteenPendingSearch(name); setSection('canteen'); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' }) }} /></div>}
      {effectiveSection === 'news' && <div className="rt"><NewsAdminPanel client={client} club={selectedClub} canManage={canManage} /></div>}
      {effectiveSection === 'fees' && canManage && <div className="rt"><FinancePanel client={client} club={selectedClub} canManage={canManage} /></div>}
      {effectiveSection === 'settings' && canManage && <div className="rt"><SettingsPanel client={client} club={selectedClub} courts={courts} onNavigate={changeSection} /></div>}
      {effectiveSection === 'playerAccess' && canManage && <div className="rt"><PlayerAccessPanel client={client} club={selectedClub} onOpenSettings={() => changeSection('settings')} /></div>}
      {effectiveSection === 'courts' && <div className="rt"><CourtsPanel client={client} club={selectedClub} courts={courts} canManage={canManage} onSave={saveCourt} onReserve={(courtId) => requestForm('reservation', { courtId })} /></div>}
      </Suspense>
    </AdminShell>
  )
}
