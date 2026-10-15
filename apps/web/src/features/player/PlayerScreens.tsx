import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Badge, Button, Chip, CourtMark, EmptyState, ErrorState, Field, Icon, Modal, SectionHeader, SegmentedTabs, SkeletonCards, TextInput } from '../../design/ui'
import { useAsyncAction } from '../../design/useAsyncAction'
import { durationLabel } from '../../design/dates'
import { plural } from '../../design/format'
import { roundName } from '../../design/bracketUtils'
import { PAYMENT_LABELS } from '../../design/paymentLabels'
import { formatMoney, periodLabel } from '../fees/feeUtils'
import { courtShort } from '../reservations/occupationView'
import { isoToDateAndTime, todayInTimezone } from '../reservations/reservationUtils'
import type { ClubPost, OnlineBookingSettings, PaymentMethod, PlayerAvailabilityCourt, PlayerClubAccess, PlayerReservation } from '../../types/domain'
import { eventTimeLabel, nextEvent, relativeEventLabel } from '../news/newsUtils'
import {
  bookingErrorMessage, buildTimeSlots, cancelErrorMessage, cancellationLabel, dayLongLabel, dayOfMonth, entryIncludesPlayer, findMyTournament,
  futureConfirmedCount, groupReservations, groupSlotsByDayPart, publishedTournaments, relativeDayLabel, shortDateLabel, weekdayShortLabel,
  type PortalCategory, type PortalTournament,
} from './portalUtils'
import type { PlayerSection } from './PlayerShell'

export type PlayerProfileData = { full_name: string; phone: string | null; email: string | null; membership_status: string | null }
export type PlayerDue = { id: string; period: string; due_date: string; amount_cents: number; paid_cents: number; balance_cents: number; payments: { amount_cents: number; payment_date: string; payment_method: string }[] }
export type Remote<T> = { status: 'loading' | 'ready' | 'error'; data: T }

type Go = (section: PlayerSection) => void

const timeFormat = (timezone: string) => new Intl.DateTimeFormat('es-AR', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const timeOf = (value: string, timezone: string) => timeFormat(timezone).format(new Date(value))
const rangeOf = (item: Pick<PlayerReservation, 'starts_at' | 'ends_at'>, timezone: string) => `${timeOf(item.starts_at, timezone)}–${timeOf(item.ends_at, timezone)}`
const minutesBetween = (item: Pick<PlayerReservation, 'starts_at' | 'ends_at'>) => Math.round((new Date(item.ends_at).getTime() - new Date(item.starts_at).getTime()) / 60_000)
const dateOf = (value: string, timezone: string) => isoToDateAndTime(value, timezone).date
const membershipLabel = (status: string | null) => (status === 'active' ? 'Membresía activa' : status === 'inactive' ? 'Membresía inactiva' : 'Sin membresía')
const isLive = (item: PlayerReservation, now = Date.now()) => item.status === 'confirmed' && new Date(item.starts_at).getTime() <= now && now < new Date(item.ends_at).getTime()

function Guard({ remote, onRetry, skeleton = 3, children }: { remote: Remote<unknown> | null; onRetry?: () => void; skeleton?: number; children: ReactNode }) {
  if (remote?.status === 'loading') return <SkeletonCards count={skeleton} height={120} />
  if (remote?.status === 'error') return <ErrorState title="No pudimos cargar tu portal" onRetry={onRetry} />
  return <>{children}</>
}

// ── Inicio ──────────────────────────────────────────────────────────
export function PlayerHome({ club, profile, reservations, dues, tournaments, news, onNavigate }: { club: PlayerClubAccess; profile: PlayerProfileData; reservations: PlayerReservation[]; dues: Remote<PlayerDue[]>; tournaments: Remote<PortalTournament[]>; news: Remote<ClubPost[]>; onNavigate: Go }) {
  const today = todayInTimezone(club.timezone)
  const next = groupReservations(reservations).upcoming[0]
  const due = dues.status === 'ready' ? dues.data[0] : undefined
  const mine = tournaments.status === 'ready' ? findMyTournament(tournaments.data, profile.full_name) : null
  const upcoming = news.status === 'ready' ? nextEvent(news.data, today) : null
  const recentNews = news.status === 'ready' ? news.data.find((post) => post.kind === 'news') : undefined
  const first = profile.full_name.trim().split(/\s+/)[0] ?? ''
  return (
    <div className="p-home">
      <section className="p-hello">
        <div>
          <p className="kicker">{dayLongLabel(today)}</p>
          <h1 className="display">Hola, {first}</h1>
        </div>
        {profile.membership_status === 'active' ? <Badge tone="success" icon="check">{membershipLabel(profile.membership_status)}</Badge> : <Badge tone="neutral">{membershipLabel(profile.membership_status)}</Badge>}
      </section>

      {next ? <TurnTicket turn={next} timezone={club.timezone} today={today} onOpen={() => onNavigate('turns')} /> : (
        <div className="card"><EmptyState icon="calendar" title="No tenés turnos próximos" body="Elegí día y horario en segundos." /></div>
      )}

      <Button variant="accent" size="lg" block icon="plus" onClick={() => onNavigate('book')} className="p-cta">Reservar cancha</Button>

      <div className="p-cards">
        {upcoming?.event_date && (
          <button type="button" className="card p-card" onClick={() => onNavigate('news')}>
            <span className="p-card-icon p-card-icon-ball"><Icon name="calendar" size={22} /></span>
            <span className="p-card-main">
              <span className="kicker">Próximo evento · {relativeEventLabel(upcoming.event_date, today)}</span>
              <strong>{upcoming.title}</strong>
              <span>{shortDateLabel(upcoming.event_date)} · {eventTimeLabel(upcoming.event_time)}{upcoming.location ? ` · ${upcoming.location}` : ''}</span>
            </span>
            <Icon name="chevronRight" size={18} className="row-chevron" />
          </button>
        )}
        {!upcoming && recentNews && (
          <button type="button" className="card p-card" onClick={() => onNavigate('news')}>
            <span className="p-card-icon"><Icon name="news" size={22} /></span>
            <span className="p-card-main">
              <span className="kicker">Novedades del club</span>
              <strong>{recentNews.title}</strong>
              <span>Ver todas las novedades</span>
            </span>
            <Icon name="chevronRight" size={18} className="row-chevron" />
          </button>
        )}
        {due && <DueCard due={due} today={today} onOpen={() => onNavigate('profile')} />}
        {mine && (
          <button type="button" className="card p-card" onClick={() => onNavigate('tournaments')}>
            <span className="p-card-icon p-card-icon-clay"><Icon name="trophy" size={22} /></span>
            <span className="p-card-main">
              <span className="kicker">{mine.tournament.name}</span>
              <strong>{mine.next ? `${roundName(mine.next.round_number, mine.rounds)} vs. ${(entryIncludesPlayer(mine.next.entry_one, profile.full_name) ? mine.next.entry_two : mine.next.entry_one) ?? 'a definir'}` : mine.category.name}</strong>
              <span>{mine.next ? (mine.next.status === 'scheduled' ? 'Programado · consultá día y cancha con el club' : 'Horario a confirmar por el club') : 'Sin partidos pendientes'}</span>
            </span>
            <Icon name="chevronRight" size={18} className="row-chevron" />
          </button>
        )}
      </div>
    </div>
  )
}

function DueCard({ due, today, onOpen }: { due: PlayerDue; today: string; onOpen: () => void }) {
  const paid = due.balance_cents <= 0
  const overdue = !paid && due.due_date < today
  return (
    <button type="button" className="card p-card" onClick={onOpen}>
      <span className="p-card-icon"><Icon name="wallet" size={22} /></span>
      <span className="p-card-main">
        <span className="kicker">Cuota de {periodLabel(due.period, false)}</span>
        <strong className="display num">{formatMoney(Math.max(0, due.balance_cents))}</strong>
        <span>{paid ? 'Pagada · gracias' : `${overdue ? 'Venció' : 'Vence'} el ${due.due_date.slice(8, 10)}/${due.due_date.slice(5, 7)} · pagás en el club`}</span>
      </span>
      {paid ? <Badge tone="success" icon="check">Pagada</Badge> : overdue ? <Badge tone="danger">Vencida</Badge> : due.paid_cents > 0 ? <Badge tone="warning">Pago parcial</Badge> : <Badge tone="warning">Pendiente</Badge>}
    </button>
  )
}

function TurnTicket({ turn, timezone, today, onOpen }: { turn: PlayerReservation; timezone: string; today: string; onOpen: () => void }) {
  const live = isLive(turn)
  return (
    <article className={`ticket-card ${live ? 'is-live' : ''}`}>
      <div className="ticket-card-court"><CourtMark label={courtShort({ name: turn.court_name })} size="lg" /></div>
      <div className="ticket-card-main">
        <p className="kicker">{live ? 'En juego ahora' : 'Tu próximo turno'}</p>
        <p className="ticket-card-day display">{relativeDayLabel(dateOf(turn.starts_at, timezone), today)}</p>
        <p className="ticket-card-time display num">{rangeOf(turn, timezone)}</p>
        <p className="ticket-card-meta">{turn.court_name} · {durationLabel(minutesBetween(turn))}</p>
      </div>
      <button type="button" className="ticket-card-link" onClick={onOpen}>Mis turnos <Icon name="arrowRight" size={16} /></button>
    </article>
  )
}

// ── Reservar ────────────────────────────────────────────────────────
export function PlayerBook({ client, club, settings, reservations, onBooked, onNavigate }: { client: SupabaseClient; club: PlayerClubAccess; settings: OnlineBookingSettings; reservations: PlayerReservation[]; onBooked: () => void; onNavigate: Go }) {
  const today = todayInTimezone(club.timezone)
  const durations = settings.allowed_durations_minutes
  const [date, setDate] = useState(today)
  const [pickedLength, setLength] = useState(durations[0] ?? 60)
  const length = durations.includes(pickedLength) ? pickedLength : durations[0] ?? 60
  const [startsAt, setStartsAt] = useState<string | null>(null)
  const [courtId, setCourtId] = useState<string | null>(null)
  const [availability, setAvailability] = useState<Remote<PlayerAvailabilityCourt[]>>({ status: 'loading', data: [] })
  const [done, setDone] = useState<{ startsAt: string; length: number; court: string } | null>(null)
  const action = useAsyncAction()

  const loadAvailability = async () => {
    const { data, error } = await client.rpc('player_court_availability', { p_club_id: club.club_id, p_date: date })
    return error ? null : ((data ?? []) as PlayerAvailabilityCourt[])
  }
  useEffect(() => {
    let cancelled = false
    setAvailability((current) => ({ status: 'loading', data: current.data }))
    void (async () => {
      const courts = await loadAvailability()
      if (!cancelled) setAvailability(courts ? { status: 'ready', data: courts } : { status: 'error', data: [] })
    })()
    return () => { cancelled = true }
  }, [date, club.club_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => {
    const courts = await loadAvailability()
    setAvailability(courts ? { status: 'ready', data: courts } : { status: 'error', data: [] })
  }

  const days = Array.from({ length: settings.max_advance_days + 1 }, (_, index) => new Date(Date.parse(`${today}T12:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10))
  const courts = availability.data
  const slots = useMemo(() => buildTimeSlots({ date, durationMinutes: length, settings, courts, timezone: club.timezone }), [date, length, settings, courts, club.timezone])
  const selected = slots.find((slot) => slot.startsAt === startsAt)
  const limitReached = futureConfirmedCount(reservations) >= settings.max_active_reservations
  const groups = groupSlotsByDayPart(slots)
  const anyFree = slots.some((slot) => slot.freeCourtIds.length > 0)
  const court = courts.find((item) => item.id === courtId)
  const choose = (patch: { date?: string; length?: number }) => {
    if (patch.date) setDate(patch.date)
    if (patch.length) setLength(patch.length)
    setStartsAt(null); setCourtId(null); action.reset()
  }

  const book = () => {
    if (!selected || !courtId || !settings.enabled || limitReached) return
    void action.run(async () => {
      const { error } = await client.rpc('create_player_reservation', { p_club_id: club.club_id, p_court_id: courtId, p_starts_at: selected.startsAt, p_duration_minutes: length })
      if (error) {
        // Si el horario se ocupó mientras elegía, se muestra la disponibilidad real actualizada.
        if (error.code === '23P01') { setStartsAt(null); setCourtId(null); void refresh() }
        return bookingErrorMessage(error)
      }
      setDone({ startsAt: selected.startsAt, length, court: court?.name ?? '' })
      onBooked()
      void refresh()
      return null
    })
  }

  return (
    <div className="p-book">
      <header className="p-page-head">
        <h1 className="display">Reservar cancha</h1>
        <p className="p-rules"><Icon name="info" size={16} />De {settings.opens_at.slice(0, 5)} a {settings.closes_at.slice(0, 5)} · hasta {plural(settings.max_advance_days, 'día', 'días')} antes · máx. {plural(settings.max_active_reservations, 'turno activo', 'turnos activos')} · cancelás {cancellationLabel(settings.cancellation_lead_minutes)}</p>
      </header>

      {!settings.enabled && (
        <div className="inline-alert inline-alert-info" role="status"><Icon name="info" size={20} /><div><strong>Las reservas online están pausadas</strong><p>Por ahora reservá llamando o pasando por el club.</p></div></div>
      )}

      {limitReached && settings.enabled && !done && (
        <div className="inline-alert inline-alert-warning" role="status"><Icon name="alert" size={20} /><div><strong>Ya tenés {plural(futureConfirmedCount(reservations), 'turno activo', 'turnos activos')}</strong><p>Es el máximo que permite el club. Cancelá uno desde Mis turnos para reservar otro.</p><Button variant="secondary" size="sm" onClick={() => onNavigate('turns')}>Ir a Mis turnos</Button></div></div>
      )}

      <section className="p-step" aria-labelledby="step-day">
        <h2 id="step-day" className="p-step-title"><span className="p-step-n">1</span>Día</h2>
        <div className="date-strip" role="listbox" aria-label="Elegir día">
          {days.map((day) => (
            <button key={day} type="button" role="option" aria-selected={day === date} className={`date-chip ${day === date ? 'is-selected' : ''} ${day === today ? 'is-today' : ''}`} onClick={() => choose({ date: day })}>
              <span className="date-chip-wd">{day === today ? 'Hoy' : weekdayShortLabel(day)}</span>
              <span className="date-chip-n display num">{dayOfMonth(day)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="p-step" aria-labelledby="step-length">
        <h2 id="step-length" className="p-step-title"><span className="p-step-n">2</span>Duración</h2>
        <div className="chip-row">
          {durations.map((minutes) => <Chip key={minutes} selected={length === minutes} onClick={() => choose({ length: minutes })}>{durationLabel(minutes)}</Chip>)}
        </div>
      </section>

      <section className="p-step" aria-labelledby="step-time">
        <h2 id="step-time" className="p-step-title"><span className="p-step-n">3</span>Horario</h2>
        {availability.status === 'loading' ? <SkeletonCards count={2} height={72} />
          : availability.status === 'error' ? <ErrorState title="No pudimos consultar la disponibilidad" body="Revisá la conexión e intentá de nuevo." onRetry={() => { setAvailability({ status: 'loading', data: [] }); void refresh() }} />
            : !anyFree ? <EmptyState icon="clock" title="No quedan horarios este día" body="Probá con otro día o duración." />
              : groups.map((part) => (
                <div key={part.label} className="time-group">
                  <p className="time-group-label">{part.label}<span>{plural(part.slots.filter((slot) => slot.freeCourtIds.length > 0).length, 'horario libre', 'horarios libres')}</span></p>
                  <div className="time-grid" role="listbox" aria-label={`Horarios de la ${part.label.toLowerCase()}`}>
                    {part.slots.map((slot) => (
                      <button key={slot.startsAt} type="button" role="option" aria-selected={slot.startsAt === startsAt} disabled={slot.freeCourtIds.length === 0 || limitReached || !settings.enabled} className={`time-slot ${slot.startsAt === startsAt ? 'is-selected' : ''}`} onClick={() => { setStartsAt(slot.startsAt); setCourtId(slot.freeCourtIds[0] ?? null); action.reset() }}>
                        <span className="display num">{slot.time}</span>
                        <small>{slot.freeCourtIds.length === 0 ? 'Completo' : plural(slot.freeCourtIds.length, 'cancha', 'canchas')}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
      </section>

      {selected && (
        <section className="p-step" aria-labelledby="step-court">
          <h2 id="step-court" className="p-step-title"><span className="p-step-n">4</span>Cancha</h2>
          <div className="court-picker" role="radiogroup" aria-label="Cancha" style={{ '--n': Math.max(courts.length, 1) } as CSSProperties}>
            {courts.map((item) => {
              const free = selected.freeCourtIds.includes(item.id)
              return (
                <button key={item.id} type="button" role="radio" aria-checked={item.id === courtId} disabled={!free} className={`court-option ${item.id === courtId ? 'is-selected' : ''} ${!free ? 'is-busy' : ''}`} onClick={() => setCourtId(item.id)} aria-label={`${item.name}, ${free ? 'libre' : 'ocupada'}`}>
                  <CourtMark label={courtShort(item)} size="sm" tone={item.id === courtId ? 'clay' : 'muted'} />
                  <span className="court-option-state">{free ? 'Libre' : 'Ocupada'}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <div className={`p-summary ${selected && courtId ? 'is-ready' : ''}`}>
        <div>
          <strong>{selected && court ? `${court.name} · ${selected.time}–${timeOf(new Date(new Date(selected.startsAt).getTime() + length * 60_000).toISOString(), club.timezone)}` : 'Elegí un horario'}</strong>
          <span>{relativeDayLabel(date, today)} · {durationLabel(length)}</span>
        </div>
        <Button variant="accent" size="lg" icon={action.failed ? 'refresh' : 'check'} disabled={!selected || !courtId || limitReached || !settings.enabled} loading={action.saving} onClick={book}>
          {action.failed ? 'Reintentar' : 'Reservar'}
        </Button>
      </div>
      {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No pudimos confirmar</strong><p>{action.message}</p></div></div>}
      <p className="detail-footnote"><Icon name="info" size={16} />Los horarios se calculan con la agenda del club; la confirmación final la valida el servidor.</p>

      <Modal open={done !== null} onClose={() => { setDone(null); choose({}) }} size="sm" title="¡Reserva confirmada!">
        {done && (
          <div className="success">
            <span className="success-icon"><Icon name="checkCircle" size={44} /></span>
            <p className="display success-when">{relativeDayLabel(dateOf(done.startsAt, club.timezone), today)} · {timeOf(done.startsAt, club.timezone)}–{timeOf(new Date(new Date(done.startsAt).getTime() + done.length * 60_000).toISOString(), club.timezone)}</p>
            <p>{done.court} · te esperamos en el club.</p>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => { setDone(null); choose({}) }}>Otra reserva</Button>
              <Button variant="accent" iconRight="arrowRight" onClick={() => { setDone(null); onNavigate('turns') }}>Ver mis turnos</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ── Mis turnos ──────────────────────────────────────────────────────
export function PlayerTurns({ client, club, settings, reservations, onChanged, onNavigate }: { client: SupabaseClient; club: PlayerClubAccess; settings: OnlineBookingSettings | null; reservations: PlayerReservation[]; onChanged: () => void; onNavigate: Go }) {
  const today = todayInTimezone(club.timezone)
  const groups = useMemo(() => groupReservations(reservations), [reservations])
  const [tab, setTab] = useState<'upcoming' | 'past' | 'cancelled'>('upcoming')
  const [cancelling, setCancelling] = useState<PlayerReservation | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const action = useAsyncAction()
  const list = groups[tab]

  const cancel = () => {
    if (!cancelling) return
    const target = cancelling
    void action.run(async () => {
      const { error } = await client.rpc('cancel_player_reservation', { p_reservation_id: target.id })
      if (error) return cancelErrorMessage(error)
      setNotice(`Turno cancelado: ${target.court_name} · ${rangeOf(target, club.timezone)}`)
      setCancelling(null)
      onChanged()
      return null
    })
  }

  return (
    <div className="p-turns">
      <header className="p-page-head">
        <h1 className="display">Mis turnos</h1>
        <SegmentedTabs label="Turnos" value={tab} onChange={(next) => { setTab(next); setNotice(null) }} items={[{ id: 'upcoming', label: 'Próximos', count: groups.upcoming.length }, { id: 'past', label: 'Anteriores' }, { id: 'cancelled', label: 'Cancelados' }]} />
      </header>
      {notice && <div className="inline-alert inline-alert-success" role="status"><Icon name="checkCircle" size={20} /><div><strong>{notice}</strong><p>La cancha queda libre para otra persona.</p></div></div>}
      {list.length === 0 ? (
        <EmptyState icon="calendar" title={tab === 'upcoming' ? 'No tenés turnos próximos' : tab === 'past' ? 'Sin turnos anteriores' : 'Sin turnos cancelados'} action={tab === 'upcoming' ? <Button variant="accent" icon="plus" onClick={() => onNavigate('book')}>Reservar cancha</Button> : undefined} />
      ) : (
        <ul className="turn-list">
          {list.map((turn) => {
            const date = dateOf(turn.starts_at, club.timezone)
            return (
              <li key={turn.id} className={`turn ${isLive(turn) ? 'is-live' : ''} ${tab !== 'upcoming' ? 'is-past' : ''}`}>
                <div className="turn-date">
                  <span className="turn-wd">{weekdayShortLabel(date)}</span>
                  <span className="display num">{dayOfMonth(date)}</span>
                </div>
                <div className="turn-main">
                  <strong className="num">{rangeOf(turn, club.timezone)}</strong>
                  <span>{turn.court_name} · {durationLabel(minutesBetween(turn))}{tab !== 'upcoming' || date !== today ? ` · ${shortDateLabel(date)}` : ''}</span>
                </div>
                <div className="turn-side">
                  {tab === 'cancelled' ? <Badge tone="neutral">Cancelado</Badge>
                    : tab === 'past' ? <Badge tone="neutral">Jugado</Badge>
                      : isLive(turn) ? <Badge tone="accent" dot>En juego</Badge>
                        : turn.can_cancel ? <Button variant="ghost" size="sm" onClick={() => { action.reset(); setNotice(null); setCancelling(turn) }}>Cancelar</Button>
                          : <Badge tone="neutral" icon="lock">Sin cancelación</Badge>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {tab === 'upcoming' && settings && <p className="detail-footnote"><Icon name="info" size={16} />{settings.enabled ? `Podés cancelar ${cancellationLabel(settings.cancellation_lead_minutes)}. Pasado ese límite, consultá al club.` : 'Las cancelaciones online están pausadas: consultá al club.'}</p>}
      <Modal
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        busy={action.saving}
        size="sm"
        title="¿Cancelar este turno?"
        footer={(
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setCancelling(null)} disabled={action.saving}>Volver</Button>
            <Button variant="danger" icon={action.failed ? 'refresh' : 'x'} loading={action.saving} onClick={cancel}>{action.failed ? 'Reintentar' : 'Sí, cancelar'}</Button>
          </div>
        )}
      >
        {cancelling && (
          <div className="confirm-body">
            <p><b>{relativeDayLabel(dateOf(cancelling.starts_at, club.timezone), today)}</b> · {cancelling.court_name} · <span className="num">{rangeOf(cancelling, club.timezone)}</span></p>
            <p className="muted">La cancha queda libre para otra persona.</p>
            {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se pudo cancelar</strong><p>{action.message}</p></div></div>}
          </div>
        )}
      </Modal>
    </div>
  )
}

// ── Torneos ─────────────────────────────────────────────────────────
const TOURNAMENT_STATUS: Record<string, string> = { registration_open: 'Inscripción abierta', in_progress: 'En juego', completed: 'Finalizado', cancelled: 'Cancelado' }
const MATCH_STATUS: Record<string, string> = { pending: 'Pendiente', scheduled: 'Programado', completed: 'Finalizado', cancelled: 'Cancelado' }

export function PlayerTournaments({ tournaments, profile, onRetry }: { tournaments: Remote<PortalTournament[]>; profile: PlayerProfileData; onRetry: () => void }) {
  const visible = publishedTournaments(tournaments.data)
  const mine = tournaments.status === 'ready' ? findMyTournament(tournaments.data, profile.full_name) : null
  return (
    <Guard remote={tournaments} onRetry={onRetry}>
      {visible.length === 0 ? (
        <EmptyState icon="trophy" title="No hay torneos publicados" body="Cuando el club publique uno vas a ver acá tu cuadro y tus partidos." />
      ) : (
        <div className="p-tournament">
          <header className="p-page-head"><h1 className="display">Torneos</h1></header>
          {mine && (
            <article className="match-card texture-court">
              <p className="kicker kicker-on-dark">{mine.next ? `Tu próximo partido · ${roundName(mine.next.round_number, mine.rounds)} · ${mine.category.name}` : `${mine.tournament.name} · ${mine.category.name}`}</p>
              <div className="match-versus">
                <strong className="display">{mine.entryName}</strong>
                {mine.next && <><span className="match-vs">vs</span><strong className="display">{(entryIncludesPlayer(mine.next.entry_one, profile.full_name) ? mine.next.entry_two : mine.next.entry_one) ?? 'A definir'}</strong></>}
              </div>
              <p className="match-when"><Icon name="clock" size={16} />{mine.next ? (mine.next.status === 'scheduled' ? 'Partido programado · consultá día y cancha con el club' : 'Horario a confirmar por el club') : 'Sin partidos pendientes'}</p>
            </article>
          )}
          {visible.map((tournament) => (
            <section key={tournament.id} className="stack" aria-labelledby={`t-${tournament.id}`}>
              <SectionHeader id={`t-${tournament.id}`} title={tournament.name} eyebrow={`${shortDateLabel(tournament.starts_on)} – ${shortDateLabel(tournament.ends_on)}`} action={<Badge tone="clay" dot>{TOURNAMENT_STATUS[tournament.status] ?? tournament.status}</Badge>} />
              {tournament.description && <p className="muted">{tournament.description}</p>}
              {tournament.categories.length === 0 ? <p className="muted">Todavía no hay categorías.</p> : tournament.categories.map((category) => <CategoryBracket key={category.id} category={category} playerName={profile.full_name} />)}
            </section>
          ))}
        </div>
      )}
    </Guard>
  )
}

function CategoryBracket({ category, playerName }: { category: PortalCategory; playerName: string }) {
  const rounds = category.matches.length ? Math.max(...category.matches.map((match) => match.round_number)) : 0
  const roundList = Array.from({ length: rounds }, (_, index) => index + 1)
  return (
    <div className="stack">
      <h3 className="display p-category-title">{category.name} · {category.modality === 'singles' ? 'Singles' : 'Dobles'}</h3>
      {rounds === 0 ? <p className="muted">El cuadro todavía no está disponible.</p> : (
        <div className="bracket" tabIndex={0} aria-label={`Cuadro de ${category.name}`}>
          {roundList.map((round) => (
            <div key={round} className="bracket-round">
              <p className="bracket-round-name">{roundName(round, rounds)}</p>
              <ul>
                {category.matches.filter((match) => match.round_number === round).map((match) => {
                  const isMine = entryIncludesPlayer(match.entry_one, playerName) || entryIncludesPlayer(match.entry_two, playerName)
                  return (
                    <li key={match.id} className={`bracket-match ${isMine ? 'is-mine' : ''}`}>
                      <span className={match.winner && match.winner === match.entry_one ? 'is-winner' : ''}>{match.entry_one ?? 'A definir'}</span>
                      <span className={match.winner && match.winner === match.entry_two ? 'is-winner' : ''}>{match.entry_two ?? 'A definir'}</span>
                      <small>{match.score_text ?? MATCH_STATUS[match.status] ?? match.status}</small>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Perfil y cuotas ─────────────────────────────────────────────────
export function PlayerProfile({ client, club, profile, dues, onSaved, onRetryDues }: { client: SupabaseClient; club: PlayerClubAccess; profile: PlayerProfileData; dues: Remote<PlayerDue[]>; onSaved: () => void; onRetryDues: () => void }) {
  const today = todayInTimezone(club.timezone)
  const [fullName, setFullName] = useState(profile.full_name)
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [email, setEmail] = useState(profile.email ?? '')
  const [saved, setSaved] = useState(false)
  const action = useAsyncAction()
  useEffect(() => { setFullName(profile.full_name); setPhone(profile.phone ?? ''); setEmail(profile.email ?? '') }, [profile])
  const dirty = fullName !== profile.full_name || phone !== (profile.phone ?? '') || email !== (profile.email ?? '')

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!dirty || fullName.trim().length === 0) return
    void action.run(async () => {
      const { error } = await client.rpc('update_player_profile', { p_club_id: club.club_id, p_full_name: fullName, p_phone: phone, p_email: email })
      if (error) return 'No pudimos guardar tus datos. Revisá la conexión e intentá de nuevo.'
      setSaved(true)
      onSaved()
      return null
    })
  }

  return (
    <div className="p-profile">
      <header className="p-page-head"><h1 className="display">Mi perfil</h1></header>
      <div className="p-profile-grid">
        <section className="card" aria-labelledby="mis-datos">
          <SectionHeader id="mis-datos" title="Datos de contacto" />
          <form className="stack" onSubmit={save}>
            <Field label="Nombre" hint="Es el nombre de tu ficha en el club.">{(id, describedBy) => <TextInput id={id} value={fullName} aria-describedby={describedBy} required onChange={(event) => { setFullName(event.target.value); setSaved(false) }} />}</Field>
            <Field label="Teléfono" optional>{(id) => <TextInput id={id} type="tel" icon="phone" value={phone} onChange={(event) => { setPhone(event.target.value); setSaved(false) }} />}</Field>
            <Field label="Email de contacto" optional hint="No cambia el email con el que iniciás sesión.">{(id, describedBy) => <TextInput id={id} type="email" icon="mail" value={email} aria-describedby={describedBy} onChange={(event) => { setEmail(event.target.value); setSaved(false) }} />}</Field>
            {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardaron los cambios</strong><p>{action.message}</p></div></div>}
            {saved && !dirty && <div className="inline-alert inline-alert-success" role="status"><Icon name="checkCircle" size={20} /><div><strong>Datos actualizados</strong></div></div>}
            <Button type="submit" variant="primary" icon="check" disabled={!dirty || fullName.trim().length === 0} loading={action.saving}>Guardar cambios</Button>
          </form>
        </section>
        <section className="card" aria-labelledby="mis-cuotas">
          <SectionHeader id="mis-cuotas" title="Mis cuotas" action={profile.membership_status === 'active' ? <Badge tone="success" icon="check">{membershipLabel(profile.membership_status)}</Badge> : <Badge tone="neutral">{membershipLabel(profile.membership_status)}</Badge>} />
          {dues.status === 'loading' ? <SkeletonCards count={2} height={56} />
            : dues.status === 'error' ? <ErrorState title="No pudimos cargar tus cuotas" onRetry={onRetryDues} />
              : dues.data.length === 0 ? <EmptyState icon="wallet" title="Sin cuotas" body={profile.membership_status === 'active' ? 'Las cuotas aparecen acá cuando el club las emite.' : 'No hay cuotas asociadas a tu ficha.'} />
                : (
                  <ul className="due-list">
                    {dues.data.map((due) => <DueRow key={due.id} due={due} today={today} />)}
                  </ul>
                )}
          <p className="detail-footnote"><Icon name="info" size={16} />Las cuotas se pagan en el club. El portal solo las muestra.</p>
        </section>
      </div>
    </div>
  )
}

function DueRow({ due, today }: { due: PlayerDue; today: string }) {
  const paid = due.balance_cents <= 0
  const overdue = !paid && due.due_date < today
  const dueDay = `${due.due_date.slice(8, 10)}/${due.due_date.slice(5, 7)}`
  return (
    <li className="due-row">
      <span className="due-main">
        <strong>{periodLabel(due.period)}</strong>
        <span>{due.paid_cents > 0 && !paid ? `Pagaste ${formatMoney(due.paid_cents)} · resta ${formatMoney(due.balance_cents)}` : paid ? 'Pagada' : `${overdue ? 'Venció' : 'Vence'} el ${dueDay}`}</span>
        {due.payments.map((payment, index) => <span key={index}>Pago {formatMoney(payment.amount_cents)} · {payment.payment_date.slice(8, 10)}/{payment.payment_date.slice(5, 7)} · {PAYMENT_LABELS[payment.payment_method as PaymentMethod] ?? payment.payment_method}</span>)}
      </span>
      <strong className="num">{formatMoney(due.amount_cents)}</strong>
      {paid ? <Badge tone="success" icon="check">Pagada</Badge> : overdue ? <Badge tone="danger">Vencida</Badge> : due.paid_cents > 0 ? <Badge tone="warning">Parcial</Badge> : <Badge tone="warning">Pendiente</Badge>}
    </li>
  )
}
