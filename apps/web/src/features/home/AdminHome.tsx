import { useEffect, useState, type CSSProperties } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Badge, Button, CourtMark, EmptyState, ErrorState, Icon, SectionHeader, Skeleton, SkeletonCards, type IconName } from '../../design/ui'
import { plural } from '../../design/format'
import type { Club, Court, Reservation } from '../../types/domain'
import { formatArs } from '../fees/feeUtils'
import { KIND_LABEL, KIND_TONE, courtShort, occupationKind, occupationTitle, type OccupationKind } from '../reservations/occupationView'
import { isoToDateAndTime } from '../reservations/reservationUtils'
import type { AdminSection } from '../shell/AdminShell'
import { useHomeData } from './useHomeData'

export type HomeSlotRequest = { courtId?: string; startsAt?: string }

type Props = {
  client: SupabaseClient
  club: Club
  courts: Court[]
  canManage: boolean
  onNavigate: (section: AdminSection) => void
  onNewReservation: (request?: HomeSlotRequest) => void
  onNewBlock: (request?: HomeSlotRequest) => void
}

const minutes = (time: string) => { const [hour, minute] = time.split(':').map(Number); return hour * 60 + minute }
const rangeLabel = (occupation: Reservation, timezone: string) => `${isoToDateAndTime(occupation.starts_at, timezone).time}–${isoToDateAndTime(occupation.ends_at, timezone).time}`
/** Próximo horario de 30 min a partir de ahora, dentro de la franja de la agenda (07:00–22:30). */
function nextSlotLabel(now: Date, timezone: string) {
  const current = minutes(isoToDateAndTime(now.toISOString(), timezone).time)
  const next = Math.min(Math.max(Math.ceil(current / 30) * 30, 7 * 60), 22 * 60 + 30)
  return `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`
}

/** Inicio administrativo: «qué pasa ahora» con datos reales de hoy. Nada de lo que muestra es inventado. */
export function AdminHome({ client, club, courts, canManage, onNavigate, onNewReservation, onNewBlock }: Props) {
  const data = useHomeData(client, club)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const activeCourts = courts.filter((court) => court.active)
  if (data.status === 'loading') return <HomeSkeleton count={activeCourts.length} />
  if (data.status === 'error') return <ErrorState title="No pudimos cargar el inicio" onRetry={data.reload} />

  const nowMs = now.getTime()
  const slot = nextSlotLabel(now, club.timezone)
  const startOf = (occupation: Reservation) => new Date(occupation.starts_at).getTime()
  const endOf = (occupation: Reservation) => new Date(occupation.ends_at).getTime()
  const occupations = data.occupations
  const live = activeCourts.map((court) => {
    const own = occupations.filter((occupation) => occupation.court_id === court.id)
    const current = own.find((occupation) => startOf(occupation) <= nowMs && nowMs < endOf(occupation))
    const after = own.find((occupation) => startOf(occupation) >= (current ? endOf(current) : nowMs))
    return { court, current, next: after, freeUntil: after ? startOf(after) : null }
  })
  const inPlay = live.filter((item) => item.current && item.current.occupation_type !== 'block').length
  const upcomingAll = occupations.filter((occupation) => startOf(occupation) >= nowMs)
  const upcoming = upcomingAll.slice(0, 6)
  const nextUp = upcoming[0]
  const courtName = (id: string) => courts.find((court) => court.id === id)?.name ?? 'Cancha'
  const lessons = occupations.filter((occupation) => occupation.occupation_type === 'lesson').length
  const matches = occupations.filter((occupation) => occupation.occupation_type === 'tournament_match').length

  return (
    <div className="home">
      <section className="home-hero texture-court" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="kicker kicker-on-dark">Ahora en el club</p>
          <h2 id="hero-title" className="hero-title display">
            <span className="hero-big num">{inPlay}</span>
            <span>de {activeCourts.length} {activeCourts.length === 1 ? 'cancha' : 'canchas'}<br />en juego</span>
          </h2>
          <p className="hero-next">
            {nextUp ? <>Próximo: <b className="num">{isoToDateAndTime(nextUp.starts_at, club.timezone).time}</b> · {courtName(nextUp.court_id)} · {occupationTitle(nextUp)}</> : 'No hay más turnos por hoy.'}
          </p>
        </div>
        <ol className="hero-meter" aria-label="Estado de cada cancha" style={{ '--n': Math.max(activeCourts.length, 1) } as CSSProperties}>
          {live.map(({ court, current }) => {
            const kind: OccupationKind | 'free' = current ? occupationKind(current.occupation_type) : 'free'
            return (
              <li key={court.id} className={`meter-${kind}`}>
                <span className="num">{courtShort(court)}</span>
                <span className="visually-hidden">{court.name}: {kind === 'free' ? 'Libre' : KIND_LABEL[kind]}</span>
              </li>
            )
          })}
        </ol>
        <div className="hero-actions">
          <Button variant="accent" size="lg" icon="plus" onClick={() => onNewReservation({ startsAt: slot })}>Nueva reserva</Button>
          <Button variant="on-dark" icon="cart" onClick={() => onNavigate('canteen')}>Venta rápida</Button>
          <Button variant="on-dark" icon="lock" onClick={() => onNewBlock({ startsAt: slot })}>Bloquear</Button>
        </div>
      </section>

      <section className="home-courts" aria-labelledby="courts-now">
        <SectionHeader id="courts-now" title="Canchas ahora" action={<button type="button" className="link-btn" onClick={() => onNavigate('reservations')}>Ver agenda <Icon name="arrowRight" size={16} /></button>} />
        {activeCourts.length === 0 ? (
          <EmptyState icon="court" title="No hay canchas activas" body="Activá una cancha desde la sección Canchas para ver su estado acá." action={<Button variant="secondary" onClick={() => onNavigate('courts')}>Ir a Canchas</Button>} />
        ) : (
          <div className="court-now-grid">
            {live.map((item) => (
              <CourtNow key={item.court.id} {...item} club={club} nowMs={nowMs} onReserve={() => onNewReservation({ courtId: item.court.id, startsAt: slot })} onOpen={() => onNavigate('reservations')} />
            ))}
          </div>
        )}
      </section>

      <div className="home-columns">
        <section className="card" aria-labelledby="upcoming">
          <SectionHeader id="upcoming" title="Próximos turnos" eyebrow="Hoy" action={<Badge tone="neutral">{plural(upcomingAll.length, 'turno', 'turnos')}</Badge>} />
          {upcoming.length === 0 ? (
            <EmptyState icon="calendar" title="Sin turnos por delante" body="La agenda de hoy está libre desde ahora." action={<Button variant="accent" icon="plus" onClick={() => onNewReservation({ startsAt: slot })}>Cargar reserva</Button>} />
          ) : (
            <ul className="upcoming-list">
              {upcoming.map((occupation) => <UpcomingRow key={occupation.id} occupation={occupation} club={club} courtName={courtName(occupation.court_id)} onClick={() => onNavigate('reservations')} />)}
            </ul>
          )}
        </section>

        <div className="home-side">
          <section className="card card-cantina" aria-labelledby="cantina-hoy">
            <SectionHeader id="cantina-hoy" title="Cantina hoy" action={<Button variant="secondary" size="sm" iconRight="arrowRight" onClick={() => onNavigate('canteen')}>Abrir</Button>} />
            {data.canteen ? (
              <div className="kpi-row">
                <div className="kpi">
                  <span className="kpi-label">Cobrado</span>
                  <strong className="kpi-value num">{formatArs(data.canteen.collectedCents)}</strong>
                  <span className="kpi-foot">cobros registrados hoy</span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">Ventas</span>
                  <strong className="kpi-value num">{data.canteen.salesCount}</strong>
                  <span className="kpi-foot">{data.canteen.salesCount === 1 ? 'venta confirmada' : 'ventas confirmadas'}</span>
                </div>
              </div>
            ) : (
              <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span><b>Dato no disponible.</b> No pudimos leer la cantina de hoy. Abrí Cantina para ver el detalle.</span></p>
            )}
          </section>

          <section className="card" aria-labelledby="pendientes">
            <SectionHeader id="pendientes" title="Para revisar" />
            <ul className="todo-list">
              {canManage && <TodoRow icon="wallet" label="Cuotas y pagos" value="Revisá cuotas emitidas y saldos" onClick={() => onNavigate('fees')} />}
              <TodoRow icon="school" label="Escuela hoy" value={lessons ? plural(lessons, 'clase', 'clases') : 'Sin clases'} onClick={() => onNavigate('school')} />
              <TodoRow icon="trophy" label="Torneos" value={matches ? `${plural(matches, 'partido', 'partidos')} hoy` : 'Sin partidos hoy'} onClick={() => onNavigate('tournaments')} />
              <TodoRow icon="cart" label="Consumos a cuenta" value="Ver consumos pendientes de cobro" onClick={() => onNavigate('canteen')} />
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

type Live = { court: Court; current?: Reservation; next?: Reservation; freeUntil: number | null }

function CourtNow({ court, current, next, freeUntil, club, nowMs, onReserve, onOpen }: Live & { club: Club; nowMs: number; onReserve: () => void; onOpen: () => void }) {
  const kind: OccupationKind | null = current ? occupationKind(current.occupation_type) : null
  const start = current ? new Date(current.starts_at).getTime() : 0
  const end = current ? new Date(current.ends_at).getTime() : 0
  const progress = current ? Math.max(0, Math.min(100, Math.round(((nowMs - start) / (end - start)) * 100))) : 0
  const label = !kind ? 'Libre' : kind === 'reservation' ? 'En juego' : kind === 'block' ? 'Bloqueada' : KIND_LABEL[kind]
  const freeMinutes = freeUntil === null ? null : Math.max(0, Math.round((freeUntil - nowMs) / 60000))
  return (
    <article className={`court-now ${kind ? `is-${kind}` : 'is-free'}`}>
      <header className="court-now-head">
        <CourtMark label={courtShort(court)} size="sm" tone={kind && kind !== 'block' ? 'clay' : kind ? 'muted' : 'green'} />
        <h3>{court.name}</h3>
        <Badge tone={kind ? KIND_TONE[kind] : 'success'} dot>{label}</Badge>
      </header>
      {current && kind ? (
        <button type="button" className="court-now-body" onClick={onOpen}>
          <strong className="court-now-title">{occupationTitle(current)}</strong>
          <span className="court-now-meta num">{rangeLabel(current, club.timezone)} · quedan {Math.max(0, Math.round((end - nowMs) / 60000))} min</span>
          <span className="progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>
          <span className="court-now-next">{next ? <>Después: <b className="num">{isoToDateAndTime(next.starts_at, club.timezone).time}</b> {occupationTitle(next)}</> : 'Después: libre'}</span>
        </button>
      ) : (
        <div className="court-now-body">
          <strong className="court-now-title">{freeUntil === null ? 'Libre el resto del día' : <>Libre hasta <span className="num">{isoToDateAndTime(new Date(freeUntil).toISOString(), club.timezone).time}</span></>}</strong>
          <span className="court-now-meta">{freeMinutes === null ? 'Sin turnos posteriores cargados' : freeMinutes >= 60 ? 'Entra un turno completo' : `${freeMinutes} min disponibles`}</span>
          <Button variant="accent" size="sm" icon="plus" onClick={onReserve}>Reservar</Button>
        </div>
      )}
    </article>
  )
}

function UpcomingRow({ occupation, club, courtName, onClick }: { occupation: Reservation; club: Club; courtName: string; onClick: () => void }) {
  const kind = occupationKind(occupation.occupation_type)
  return (
    <li>
      <button type="button" className="upcoming-row" onClick={onClick}>
        <span className="upcoming-time display num">{isoToDateAndTime(occupation.starts_at, club.timezone).time}</span>
        <span className={`upcoming-bar occ-edge-${kind}`} aria-hidden="true" />
        <span className="upcoming-main">
          <strong>{occupationTitle(occupation)}</strong>
          <span>{courtName} · {rangeLabel(occupation, club.timezone)}</span>
        </span>
        <Badge tone={KIND_TONE[kind]}>{KIND_LABEL[kind]}</Badge>
        <Icon name="chevronRight" size={18} className="row-chevron" />
      </button>
    </li>
  )
}

function TodoRow({ icon, label, value, onClick }: { icon: IconName; label: string; value: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="todo-row" onClick={onClick}>
        <span className="todo-icon"><Icon name={icon} size={20} /></span>
        <span className="todo-text"><strong>{label}</strong><span>{value}</span></span>
        <Icon name="chevronRight" size={18} className="row-chevron" />
      </button>
    </li>
  )
}

function HomeSkeleton({ count }: { count: number }) {
  return (
    <div className="home" role="status" aria-label="Cargando inicio">
      <Skeleton height={220} radius={24} />
      <div className="court-now-grid">{Array.from({ length: Math.max(count, 2) }, (_, index) => <Skeleton key={index} height={150} radius={16} />)}</div>
      <SkeletonCards count={3} height={64} />
    </div>
  )
}
