import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useAuth } from '../../auth/AuthProvider'
import { CourtList, type CourtPatch } from '../courts/CourtList'
import { ReservationCalendar } from '../reservations/ReservationCalendar'
import type { Club, ClubMembership, ClubRole, Court } from '../../types/domain'

type MembershipRow = { club_id: string; role: ClubRole }

export function AdminPanel({ user }: { user: User }) {
  const { client, signOut } = useAuth()
  const [memberships, setMemberships] = useState<ClubMembership[]>([])
  const [clubs, setClubs] = useState<Club[]>([])
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null)
  const [courts, setCourts] = useState<Court[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [section, setSection] = useState<'home' | 'reservations' | 'courts'>('home')

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

  if (status === 'loading') return <div className="screen-message" role="status">Cargando acceso administrativo…</div>
  if (status === 'error') return <div className="screen-message error-message" role="alert">{error}</div>

  return (
    <div className="admin-layout">
      <header className="admin-header">
        <div><p className="eyebrow">Panel administrativo</p><h1>{title}</h1><p className="user-email">{user.email ?? 'Cuenta autenticada'}</p></div>
        <button className="secondary-button" type="button" onClick={() => void closeSession()} disabled={isSigningOut}>{isSigningOut ? 'Cerrando…' : 'Cerrar sesión'}</button>
      </header>
      {error && <p className="form-error" role="alert">{error}</p>}
      {memberships.length === 0 ? <NoClubAccess /> : <>
        {clubs.length > 1 && <label className="club-selector">Club<select value={selectedClubId ?? ''} onChange={(event) => setSelectedClubId(event.target.value)}>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label>}
        {selectedClub && <>
          <section className="stats-grid" aria-label="Resumen de canchas"><div><span>Total de canchas</span><strong>{courts.length}</strong></div><div><span>Canchas activas</span><strong>{activeCourts}</strong></div><div><span>Tu permiso</span><strong>{role === 'owner' ? 'Propietario' : role === 'admin' ? 'Administrador' : 'Lectura'}</strong></div></section>
          <nav className="admin-nav" aria-label="Secciones administrativas">
            <button className={section === 'home' ? 'nav-button active' : 'nav-button'} type="button" onClick={() => setSection('home')}>Inicio</button>
            <button className={section === 'reservations' ? 'nav-button active' : 'nav-button'} type="button" onClick={() => setSection('reservations')}>Reservas</button>
            <button className={section === 'courts' ? 'nav-button active' : 'nav-button'} type="button" onClick={() => setSection('courts')}>Canchas</button>
          </nav>
          {section === 'home' && <section className="home-panel"><p className="eyebrow">Resumen</p><h2>Elegí qué querés gestionar</h2><p>Consultá y cargá turnos desde <strong>Reservas</strong>, o actualizá las canchas del club desde <strong>Canchas</strong>.</p></section>}
          {section === 'reservations' && <ReservationCalendar client={client} club={selectedClub} courts={courts} />}
          {section === 'courts' && <CourtList courts={courts} canManage={canManage} onSave={saveCourt} />}
        </>}
      </>}
    </div>
  )
}

function NoClubAccess() {
  return <section className="configuration-card"><p className="eyebrow">Acceso restringido</p><h2>No tenés acceso administrativo a ningún club.</h2><p className="intro">Pedile a la persona responsable que verifique tu membresía administrativa.</p></section>
}
