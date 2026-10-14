import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useAuth } from '../../auth/AuthProvider'
import { CourtList, type CourtPatch } from '../courts/CourtList'
import { ReservationCalendar } from '../reservations/ReservationCalendar'
import { PeoplePanel } from '../people/PeoplePanel'
import { FinancePanel } from '../fees/FinancePanel'
import { SchoolPanel } from '../school/SchoolPanel'
import { TournamentPanel } from '../tournaments/TournamentPanel'
import { CanteenPanel } from '../canteen/CanteenPanel'
import { PlayerAccessPanel } from '../player/PlayerAccessPanel'
import type { Club, ClubMembership, ClubRole, Court } from '../../types/domain'

type MembershipRow = { club_id: string; role: ClubRole }

export function AdminPanel({ user, onOpenPlayerPortal }: { user: User; onOpenPlayerPortal?: () => void }) {
  const { client, signOut } = useAuth()
  const [memberships, setMemberships] = useState<ClubMembership[]>([])
  const [clubs, setClubs] = useState<Club[]>([])
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null)
  const [courts, setCourts] = useState<Court[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [section, setSection] = useState<'home' | 'reservations' | 'school' | 'tournaments' | 'people' | 'fees' | 'canteen' | 'courts' | 'playerAccess'>('home')
  const [requestedLessonId, setRequestedLessonId] = useState<string | null>(null)
  const [lessonCreation, setLessonCreation] = useState<{ courtId: string; date: string; startsAt: string } | null>(null)
  const [requestedTournamentReservationId, setRequestedTournamentReservationId] = useState<string | null>(null)
  const [createReservationRequest, setCreateReservationRequest] = useState(0)
  const [showMobileMore, setShowMobileMore] = useState(false)
  const [showAccount, setShowAccount] = useState(false)

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
  const activeCourts = courts.filter((court) => court.active).length
  const title = useMemo(() => selectedClub?.name ?? 'Administración', [selectedClub])

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

  const changeSection = (nextSection: typeof section) => {
    setSection(nextSection)
    setShowMobileMore(false)
    setShowAccount(false)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' })
  }

  if (status === 'loading') return <div className="screen-message" role="status">Cargando acceso administrativo…</div>
  if (status === 'error') return <div className="screen-message error-message" role="alert">{error}</div>

  return (
    <div className="admin-layout">
      <header className="admin-header">
        <a className="brand" href="#inicio" aria-label="Rafa Tenis, inicio"><img className="brand-mark" src="/branding/logoRafa.png" alt="" /><span>Rafa Tenis</span></a>
        <h1 className="visually-hidden">{section === 'home' ? title : `Administración · ${section === 'reservations' ? 'Reservas' : section === 'canteen' ? 'Cantina' : 'Club'}`}</h1>
        <div className="admin-context"><span>{section === 'home' ? title : section === 'reservations' ? 'Reservas' : section === 'canteen' ? 'Cantina' : 'Administración'}</span><button className="account-trigger" type="button" aria-expanded={showAccount} aria-controls="admin-account-menu" onClick={() => setShowAccount((current) => !current)}>Cuenta</button></div>
      </header>
      {error && <p className="form-error" role="alert">{error}</p>}
      {memberships.length === 0 ? <NoClubAccess /> : <>
        {showAccount && <section className="account-menu" id="admin-account-menu" aria-label="Cuenta y configuración"><p className="eyebrow">Cuenta</p><strong>{user.email ?? 'Cuenta autenticada'}</strong><span>{role === 'owner' ? 'Propietario' : role === 'admin' ? 'Administrador' : 'Personal operativo'}</span>{clubs.length > 1 && <label>Club<select value={selectedClubId ?? ''} onChange={(event) => setSelectedClubId(event.target.value)}>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label>}<div className="account-actions">{onOpenPlayerPortal && <button className="secondary-button" type="button" onClick={onOpenPlayerPortal}>Mi portal</button>}<button className="secondary-button" type="button" onClick={() => void closeSession()} disabled={isSigningOut}>{isSigningOut ? 'Cerrando…' : 'Cerrar sesión'}</button></div></section>}
        {selectedClub && <>
          <div className="admin-workspace">
            <nav className="admin-nav admin-sidebar" aria-label="Secciones administrativas">
              <p className="nav-group-label">Operación</p>
              <button className={section === 'home' ? 'nav-button active' : 'nav-button'} type="button" onClick={() => changeSection('home')}><NavIcon name="home" />Inicio</button>
              <button className={section === 'reservations' ? 'nav-button active' : 'nav-button'} type="button" onClick={() => changeSection('reservations')}><NavIcon name="calendar" />Reservas</button>
              <button className={section === 'canteen' ? 'nav-button active' : 'nav-button'} type="button" onClick={() => changeSection('canteen')}><NavIcon name="canteen" />Cantina</button>
              <p className="nav-group-label">Club</p>
              <button className={section === 'people' ? 'nav-button active' : 'nav-button'} type="button" onClick={() => changeSection('people')}><NavIcon name="people" />Jugadores</button>
              {canManage && <button className={section === 'fees' ? 'nav-button active' : 'nav-button'} type="button" onClick={() => changeSection('fees')}><NavIcon name="fees" />Cuotas</button>}
              <button className={section === 'school' ? 'nav-button active' : 'nav-button'} type="button" onClick={() => changeSection('school')}><NavIcon name="school" />Escuela de tenis</button>
              <button className={section === 'tournaments' ? 'nav-button active' : 'nav-button'} type="button" onClick={() => changeSection('tournaments')}><NavIcon name="trophy" />Torneos</button>
              <button className={section === 'courts' ? 'nav-button active' : 'nav-button'} type="button" onClick={() => changeSection('courts')}><NavIcon name="court" />Canchas</button>
              {canManage && <button className={section === 'playerAccess' ? 'nav-button active' : 'nav-button'} type="button" onClick={() => changeSection('playerAccess')}><NavIcon name="portal" />Portal de jugadores</button>}
            </nav>
            <div className="admin-content">
              {section === 'home' && <><section className="home-panel operational-home"><p className="eyebrow">Operación del día</p><h1>¿Qué necesitás hacer?</h1><p>Accedé directo a las tareas de atención. La agenda es el punto de partida del club.</p><div className="quick-actions"><button type="button" onClick={() => { setCreateReservationRequest((current) => current + 1); changeSection('reservations') }}><NavIcon name="calendar" />Nueva reserva</button><button className="secondary-button" type="button" onClick={() => changeSection('reservations')}><NavIcon name="calendar" />Ver agenda</button><button className="secondary-button" type="button" onClick={() => changeSection('canteen')}><NavIcon name="canteen" />Abrir cantina</button><button className="secondary-button" type="button" onClick={() => changeSection('people')}><NavIcon name="people" />Jugadores</button></div></section><details className="home-secondary"><summary>Información del club</summary><section className="stats-grid" aria-label="Resumen de canchas"><div><span>Canchas</span><strong>{courts.length}</strong></div><div><span>Activas</span><strong>{activeCourts}</strong></div><div><span>Tu permiso</span><strong>{role === 'owner' ? 'Propietario' : role === 'admin' ? 'Administrador' : 'Personal operativo'}</strong></div></section></details></>}
              {section === 'reservations' && <ReservationCalendar client={client} club={selectedClub} courts={courts} createReservationRequest={createReservationRequest} onCreateReservationHandled={() => setCreateReservationRequest(0)} onOpenLesson={(lessonId) => { setRequestedLessonId(lessonId); changeSection('school') }} onOpenTournamentMatch={(reservationId) => { setRequestedTournamentReservationId(reservationId); changeSection('tournaments') }} onCreateLesson={(request) => { setLessonCreation(request); changeSection('school') }} />}
              {section === 'school' && <SchoolPanel client={client} club={selectedClub} courts={courts} canManageCoaches={canManage} requestedLessonId={requestedLessonId} onRequestedLessonHandled={() => setRequestedLessonId(null)} requestedCreation={lessonCreation} onRequestedCreationHandled={() => setLessonCreation(null)} />}
              {section === 'tournaments' && <TournamentPanel client={client} club={selectedClub} courts={courts} canManage={canManage} requestedReservationId={requestedTournamentReservationId} onRequestedReservationHandled={() => setRequestedTournamentReservationId(null)} />}
              {section === 'people' && <PeoplePanel client={client} club={selectedClub} canManageMemberships={canManage} />}
              {section === 'fees' && <FinancePanel client={client} club={selectedClub} canManage={canManage} />}
              {section === 'playerAccess' && canManage && <PlayerAccessPanel client={client} club={selectedClub} />}
              {section === 'canteen' && <CanteenPanel client={client} club={selectedClub} canManageCatalog={canManage} />}
              {section === 'courts' && <CourtList courts={courts} canManage={canManage} onSave={saveCourt} />}
            </div>
          </div>
          <nav className="mobile-bottom-nav" aria-label="Accesos principales">
            <button className={section === 'home' ? 'active' : ''} type="button" onClick={() => changeSection('home')}><NavIcon name="home" />Inicio</button>
            <button className={section === 'reservations' ? 'active' : ''} type="button" onClick={() => changeSection('reservations')}><NavIcon name="calendar" />Reservas</button>
            <button className={section === 'canteen' ? 'active' : ''} type="button" onClick={() => changeSection('canteen')}><NavIcon name="canteen" />Cantina</button>
            <button className={showMobileMore ? 'active' : ''} type="button" aria-expanded={showMobileMore} onClick={() => setShowMobileMore((current) => !current)}><NavIcon name="more" />Más</button>
          </nav>
          {showMobileMore && <nav className="mobile-more-menu" aria-label="Más secciones administrativas"><button type="button" onClick={() => changeSection('people')}>Jugadores</button>{canManage && <button type="button" onClick={() => changeSection('fees')}>Cuotas</button>}<button type="button" onClick={() => changeSection('school')}>Escuela de tenis</button><button type="button" onClick={() => changeSection('tournaments')}>Torneos</button><button type="button" onClick={() => changeSection('courts')}>Canchas</button>{canManage && <button type="button" onClick={() => changeSection('playerAccess')}>Portal de jugadores</button>}</nav>}
        </>}
      </>}
    </div>
  )
}

function NoClubAccess() {
  return <section className="configuration-card"><p className="eyebrow">Acceso restringido</p><h2>No tenés acceso administrativo a ningún club.</h2><p className="intro">Pedile a la persona responsable que verifique tu membresía administrativa.</p></section>
}

type NavIconName = 'home' | 'calendar' | 'canteen' | 'people' | 'fees' | 'school' | 'trophy' | 'court' | 'portal' | 'more'

function NavIcon({ name }: { name: NavIconName }) {
  const paths: Record<NavIconName, string> = {
    home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3v-10.5Z',
    calendar: 'M7 3v3m10-3v3M4.5 9h15M6 5h12a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5v-12A1.5 1.5 0 0 1 6 5Z',
    canteen: 'M4 5h2l1.2 8h9.6L19 7H8M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm7 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
    people: 'M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20m6-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6-4a3 3 0 0 1 0 6m2 7v-1.5a3.5 3.5 0 0 0-2-3.15',
    fees: 'M12 3v18m4-14h-6a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H8',
    school: 'M3 7.5 12 3l9 4.5-9 4.5-9-4.5Zm3 3v4.25c0 1.8 2.7 3.25 6 3.25s6-1.45 6-3.25V10.5',
    trophy: 'M8 4h8v4a4 4 0 0 1-8 0V4Zm0 1H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 1v4m-3 4h6m-7 0h8',
    court: 'M4 4h16v16H4V4Zm8 0v16M4 12h8a4 4 0 0 1 4 4v4',
    portal: 'M4 4h16v16H4V4Zm4 12 8-8m-1 0h1v1m-7 7H8v-1',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
  }
  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>
}
