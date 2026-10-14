import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import type { OnlineBookingSettings, PlayerAvailabilityCourt, PlayerClubAccess, PlayerReservation } from '../../types/domain'

type Profile = { full_name: string; phone: string | null; email: string | null; membership_status: string | null }
type Due = { id: string; period: string; due_date: string; amount_cents: number; paid_cents: number; balance_cents: number; payments: { amount_cents: number; payment_date: string; payment_method: string }[] }
type Tournament = { id: string; name: string; description: string | null; starts_on: string; ends_on: string; status: string; categories: { id: string; name: string; modality: string; status: string; matches: { id: string; round_number: number; position: number; entry_one: string | null; entry_two: string | null; winner: string | null; status: string; score_text: string | null }[] }[] }

function clubDate(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function displayDate(value: string, timezone: string, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: timezone, ...options }).format(new Date(value))
}

function money(value: number) { return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value / 100) }

export function PlayerPortal({ access, onOpenAdmin }: { access: PlayerClubAccess[]; onOpenAdmin?: () => void }) {
  const { client, signOut } = useAuth()
  const [clubId, setClubId] = useState(access[0]?.club_id ?? '')
  const [section, setSection] = useState<'home' | 'book' | 'reservations' | 'profile' | 'dues' | 'tournaments'>('home')
  const [settings, setSettings] = useState<OnlineBookingSettings | null>(null)
  const [reservations, setReservations] = useState<PlayerReservation[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [dues, setDues] = useState<Due[]>([])
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showMobileMore, setShowMobileMore] = useState(false)
  const selectedClub = access.find((item) => item.club_id === clubId) ?? access[0]

  const loadCore = async () => {
    if (!selectedClub) return
    setLoading(true)
    setError(null)
    const [{ data: settingsData, error: settingsError }, { data: reservationsData, error: reservationsError }, { data: profileData, error: profileError }] = await Promise.all([
      client.rpc('get_online_booking_settings', { p_club_id: selectedClub.club_id }),
      client.rpc('player_reservations', { p_club_id: selectedClub.club_id }),
      client.rpc('player_profile', { p_club_id: selectedClub.club_id }),
    ])
    if (settingsError || reservationsError || profileError) setError('No pudimos cargar tu información del club. Intentá nuevamente.')
    else {
      setSettings(settingsData as OnlineBookingSettings)
      setReservations((reservationsData ?? []) as PlayerReservation[])
      setProfile(profileData as Profile)
    }
    setLoading(false)
  }

  useEffect(() => { void loadCore() }, [clubId]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadDues = async () => {
    if (!selectedClub) return
    const { data, error: duesError } = await client.rpc('player_membership_dues', { p_club_id: selectedClub.club_id })
    if (duesError) setError('No pudimos cargar tus cuotas.')
    else setDues((data ?? []) as Due[])
  }
  const loadTournaments = async () => {
    if (!selectedClub) return
    const { data, error: tournamentsError } = await client.rpc('player_tournaments', { p_club_id: selectedClub.club_id })
    if (tournamentsError) setError('No pudimos cargar los torneos.')
    else setTournaments((data ?? []) as Tournament[])
  }
  useEffect(() => { if (section === 'dues') void loadDues(); if (section === 'tournaments') void loadTournaments() }, [section, clubId]) // eslint-disable-line react-hooks/exhaustive-deps

  const upcoming = reservations.find((item) => item.status === 'confirmed' && new Date(item.starts_at) >= new Date())
  const changeSection = (nextSection: typeof section) => { setSection(nextSection); setShowMobileMore(false) }
  if (!selectedClub) return null
  if (loading) return <p className="screen-message" role="status">Cargando tu portal…</p>

  return <div className="player-layout">
    <header className="player-header">
      <div><p className="eyebrow">Portal del jugador</p><h1>{selectedClub.club_name}</h1><p className="user-email">Hola, {selectedClub.full_name}</p></div>
      <div className="header-actions">{onOpenAdmin && <button className="secondary-button" type="button" onClick={onOpenAdmin}>Administración</button>}<button className="secondary-button" type="button" onClick={() => void signOut()}>Cerrar sesión</button></div>
    </header>
    {access.length > 1 && <label className="club-selector">Club<select value={clubId} onChange={(event) => setClubId(event.target.value)}>{access.map((item) => <option key={item.club_id} value={item.club_id}>{item.club_name}</option>)}</select></label>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <nav className="admin-nav player-desktop-nav" aria-label="Navegación del jugador">
      <button className={section === 'home' ? 'nav-button active' : 'nav-button'} onClick={() => changeSection('home')}>Inicio</button>
      <button className={section === 'book' ? 'nav-button active' : 'nav-button'} onClick={() => changeSection('book')}>Reservar cancha</button>
      <button className={section === 'reservations' ? 'nav-button active' : 'nav-button'} onClick={() => changeSection('reservations')}>Mis reservas</button>
      <button className={section === 'profile' ? 'nav-button active' : 'nav-button'} onClick={() => changeSection('profile')}>Mi perfil</button>
      <button className={section === 'dues' ? 'nav-button active' : 'nav-button'} onClick={() => changeSection('dues')}>Mis cuotas</button>
      <button className={section === 'tournaments' ? 'nav-button active' : 'nav-button'} onClick={() => changeSection('tournaments')}>Torneos</button>
    </nav>
    {section === 'home' && <Home membership={selectedClub.membership_status} upcoming={upcoming} timezone={selectedClub.timezone} bookingEnabled={settings?.enabled ?? false} onBook={() => changeSection('book')} />}
    {section === 'book' && <Booking club={selectedClub} settings={settings} onComplete={() => void loadCore()} />}
    {section === 'reservations' && <Reservations club={selectedClub} reservations={reservations} onCancelled={() => void loadCore()} />}
    {section === 'profile' && <ProfilePanel club={selectedClub} profile={profile} onSaved={() => void loadCore()} />}
    {section === 'dues' && <DuesPanel membership={selectedClub.membership_status} dues={dues} />}
    {section === 'tournaments' && <TournamentList tournaments={tournaments} />}
    <nav className="mobile-bottom-nav" aria-label="Accesos principales del jugador">
      <button className={section === 'home' ? 'active' : ''} type="button" onClick={() => changeSection('home')}>Inicio</button>
      <button className={section === 'book' ? 'active' : ''} type="button" onClick={() => changeSection('book')}>Reservar</button>
      <button className={section === 'reservations' ? 'active' : ''} type="button" onClick={() => changeSection('reservations')}>Mis turnos</button>
      <button className={showMobileMore ? 'active' : ''} type="button" aria-expanded={showMobileMore} onClick={() => setShowMobileMore((current) => !current)}>Más</button>
    </nav>
    {showMobileMore && <nav className="mobile-more-menu player-more-menu" aria-label="Más secciones del jugador"><button type="button" onClick={() => changeSection('profile')}>Mi perfil</button><button type="button" onClick={() => changeSection('dues')}>Mis cuotas</button><button type="button" onClick={() => changeSection('tournaments')}>Torneos</button></nav>}
  </div>
}

function Home({ membership, upcoming, timezone, bookingEnabled, onBook }: { membership: string | null; upcoming: PlayerReservation | undefined; timezone: string; bookingEnabled: boolean; onBook: () => void }) {
  return <section className="portal-home">
    <div className="portal-card"><p className="eyebrow">Próxima reserva</p>{upcoming ? <><strong>{upcoming.court_name}</strong><p>{displayDate(upcoming.starts_at, timezone)}</p></> : <p>No tenés reservas próximas.</p>}</div>
    <div className="portal-card"><p className="eyebrow">Membresía</p><strong>{membership === 'active' ? 'Socio activo' : membership === 'inactive' ? 'Membresía inactiva' : 'Sin membresía'}</strong><p>Las reservas no dependen automáticamente de tu condición de socio.</p></div>
    <div className="portal-card"><p className="eyebrow">Cancha</p><p>{bookingEnabled ? 'Consultá horarios disponibles y confirmá tu turno.' : 'Las reservas online no están habilitadas por el club.'}</p><button type="button" onClick={onBook} disabled={!bookingEnabled}>Reservar cancha</button></div>
  </section>
}

function Booking({ club, settings, onComplete }: { club: PlayerClubAccess; settings: OnlineBookingSettings | null; onComplete: () => void }) {
  const { client } = useAuth()
  const [date, setDate] = useState(clubDate(club.timezone))
  const [courts, setCourts] = useState<PlayerAvailabilityCourt[]>([])
  const [courtId, setCourtId] = useState('')
  const [time, setTime] = useState('')
  const [duration, setDuration] = useState(60)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadAvailability = async () => {
    setError(null); setNotice(null)
    const { data, error: availabilityError } = await client.rpc('player_court_availability', { p_club_id: club.club_id, p_date: date })
    if (availabilityError) setError('No pudimos consultar la disponibilidad para esa fecha.')
    else { const next = (data ?? []) as PlayerAvailabilityCourt[]; setCourts(next); setCourtId((current) => next.some((court) => court.id === current) ? current : next[0]?.id ?? '') }
  }
  useEffect(() => { void loadAvailability() }, [date, club.club_id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (settings) setDuration(settings.allowed_durations_minutes[0] ?? 60) }, [settings])
  const chosenCourt = courts.find((court) => court.id === courtId)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(null); setNotice(null); setBusy(true)
    const startsAt = new Date(`${date}T${time}:00-03:00`).toISOString()
    const { error: reservationError } = await client.rpc('create_player_reservation', { p_club_id: club.club_id, p_court_id: courtId, p_starts_at: startsAt, p_duration_minutes: duration })
    if (reservationError) setError('No pudimos confirmar la reserva. El horario puede haberse ocupado o no cumplir las reglas del club.')
    else { setNotice('Reserva confirmada. Ya aparece en Mis reservas.'); onComplete(); void loadAvailability() }
    setBusy(false)
  }
  if (!settings?.enabled) return <section className="portal-panel"><h2>Reservas online no habilitadas</h2><p>Consultá al club para conocer los canales disponibles.</p></section>
  return <section className="portal-panel"><div className="section-heading"><div><p className="eyebrow">Reservar cancha</p><h2>Elegí un horario</h2></div><label>Fecha<input type="date" value={date} min={clubDate(club.timezone)} onChange={(event) => setDate(event.target.value)} /></label></div>
    <p className="subtle-copy">Disponible entre {settings.opens_at.slice(0, 5)} y {settings.closes_at.slice(0, 5)}. Los bloques ocupados no muestran quién los reservó.</p>
    <div className="availability-list">{courts.map((court) => <article className={court.id === courtId ? 'availability-card selected' : 'availability-card'} key={court.id}><button type="button" onClick={() => setCourtId(court.id)}>{court.name}</button><p>{court.occupied.length ? `${court.occupied.length} bloque${court.occupied.length === 1 ? '' : 's'} ocupado${court.occupied.length === 1 ? '' : 's'}` : 'Sin ocupaciones registradas'}</p>{court.occupied.map((occupied, index) => <small key={`${occupied.starts_at}-${index}`}>{displayDate(occupied.starts_at, club.timezone, { timeStyle: 'short' })}–{displayDate(occupied.ends_at, club.timezone, { timeStyle: 'short' })}</small>)}</article>)}</div>
    <form className="portal-form" onSubmit={submit}><label>Cancha<select value={courtId} onChange={(event) => setCourtId(event.target.value)} required>{courts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select></label><label>Horario<input type="time" value={time} min={settings.opens_at.slice(0, 5)} max={settings.closes_at.slice(0, 5)} onChange={(event) => setTime(event.target.value)} required /></label><label>Duración<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{settings.allowed_durations_minutes.map((item) => <option key={item} value={item}>{item} minutos</option>)}</select></label>{chosenCourt && time && <p className="subtle-copy">La confirmación final se valida en el servidor.</p>}{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}<button type="submit" disabled={busy || !courtId}>{busy ? 'Confirmando…' : 'Confirmar reserva'}</button></form>
  </section>
}

function Reservations({ club, reservations, onCancelled }: { club: PlayerClubAccess; reservations: PlayerReservation[]; onCancelled: () => void }) {
  const { client } = useAuth(); const [error, setError] = useState<string | null>(null)
  const groups = useMemo(() => ({ upcoming: reservations.filter((item) => item.status === 'confirmed' && new Date(item.starts_at) >= new Date()), past: reservations.filter((item) => item.status === 'confirmed' && new Date(item.starts_at) < new Date()), cancelled: reservations.filter((item) => item.status === 'cancelled') }), [reservations])
  const cancel = async (id: string) => { setError(null); const { error: cancelError } = await client.rpc('cancel_player_reservation', { p_reservation_id: id }); if (cancelError) setError('No se pudo cancelar esta reserva desde el portal.'); else onCancelled() }
  return <section className="portal-panel"><p className="eyebrow">Mis reservas</p><h2>Turnos vinculados a tu ficha</h2>{error && <p className="form-error" role="alert">{error}</p>}{(['upcoming', 'past', 'cancelled'] as const).map((group) => <div className="reservation-group" key={group}><h3>{group === 'upcoming' ? 'Próximas' : group === 'past' ? 'Anteriores' : 'Canceladas'}</h3>{groups[group].length === 0 ? <p className="subtle-copy">No hay reservas para mostrar.</p> : groups[group].map((item) => <article className="reservation-row" key={item.id}><div><strong>{item.court_name}</strong><span>{displayDate(item.starts_at, club.timezone)} · hasta {displayDate(item.ends_at, club.timezone, { timeStyle: 'short' })}</span></div><div>{item.can_cancel && <button className="secondary-button" type="button" onClick={() => void cancel(item.id)}>Cancelar</button>}<em>{item.status === 'cancelled' ? 'Cancelada' : 'Confirmada'}</em></div></article>)}</div>)}</section>
}

function ProfilePanel({ club, profile, onSaved }: { club: PlayerClubAccess; profile: Profile | null; onSaved: () => void }) {
  const { client } = useAuth(); const [fullName, setFullName] = useState(profile?.full_name ?? ''); const [phone, setPhone] = useState(profile?.phone ?? ''); const [email, setEmail] = useState(profile?.email ?? ''); const [notice, setNotice] = useState<string | null>(null); const [error, setError] = useState<string | null>(null)
  useEffect(() => { setFullName(profile?.full_name ?? ''); setPhone(profile?.phone ?? ''); setEmail(profile?.email ?? '') }, [profile])
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setError(null); const { error: updateError } = await client.rpc('update_player_profile', { p_club_id: club.club_id, p_full_name: fullName, p_phone: phone, p_email: email }); if (updateError) setError('No pudimos guardar tus datos.'); else { setNotice('Datos actualizados.'); onSaved() } }
  return <section className="portal-panel"><p className="eyebrow">Mi perfil</p><h2>Datos de contacto</h2><p className="subtle-copy">El email de contacto no cambia el email con el que iniciás sesión.</p><form className="portal-form" onSubmit={submit}><label>Nombre<input value={fullName} onChange={(event) => setFullName(event.target.value)} required /></label><label>Teléfono<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label><label>Email de contacto<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><p className="subtle-copy">Condición: {profile?.membership_status === 'active' ? 'Socio activo' : profile?.membership_status === 'inactive' ? 'Membresía inactiva' : 'Sin membresía'}</p>{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}<button>Guardar cambios</button></form></section>
}

function DuesPanel({ membership, dues }: { membership: string | null; dues: Due[] }) { return <section className="portal-panel"><p className="eyebrow">Mis cuotas</p><h2>Estado de cuenta</h2>{membership !== 'active' && <p className="subtle-copy">No tenés una membresía social activa. Si existen cuotas históricas, se muestran abajo.</p>}{dues.length === 0 ? <p className="subtle-copy">No hay cuotas asociadas a tu ficha.</p> : <div className="due-list">{dues.map((due) => <article className="due-row" key={due.id}><div><strong>{due.period}</strong><span>Vence {due.due_date}</span>{due.payments.map((payment, index) => <small key={index}>Pago {money(payment.amount_cents)} · {payment.payment_date} · {payment.payment_method}</small>)}</div><div className="due-row-amounts"><strong>{money(due.amount_cents)}</strong><small>Pagado {money(due.paid_cents)} · Saldo {money(due.balance_cents)}</small></div></article>)}</div>}</section> }

function TournamentList({ tournaments }: { tournaments: Tournament[] }) { return <section className="portal-panel"><p className="eyebrow">Torneos</p><h2>Fixtures y resultados</h2>{tournaments.length === 0 ? <p className="subtle-copy">No hay torneos publicados para este club.</p> : tournaments.map((tournament) => <article className="player-tournament" key={tournament.id}><h3>{tournament.name}</h3><p>{tournament.description}</p><small>{tournament.starts_on} a {tournament.ends_on} · {tournament.status}</small>{tournament.categories.map((category) => <div className="player-category" key={category.id}><h4>{category.name} · {category.modality === 'singles' ? 'Singles' : 'Dobles'}</h4>{category.matches.length === 0 ? <p className="subtle-copy">Fixture todavía no disponible.</p> : category.matches.map((match) => <p key={match.id}><strong>{match.entry_one ?? 'A definir'}</strong> vs <strong>{match.entry_two ?? 'A definir'}</strong>{match.score_text ? ` · ${match.score_text}` : ''}{match.winner ? ` · Ganó ${match.winner}` : ''}</p>)}</div>)}</article>)}</section> }
