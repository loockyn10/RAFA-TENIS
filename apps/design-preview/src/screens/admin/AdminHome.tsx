import { balanceCents, CURRENT_PERIOD, KIND_LABEL, NOW, TODAY, type Court, type Occupation } from '../../data/mock'
import { useCourts } from '../../lib/data'
import { periodLabel, periodSummary } from '../../lib/dues'
import { forDay, nextStartAfter, occupationAt } from '../../lib/agenda'
import { useAdmin } from '../../lib/admin'
import { formatARS, plural } from '../../lib/format'
import { useScreenState } from '../../lib/proto'
import { useStore } from '../../lib/store'
import { DAY_CLOSE, hhmm, range, SLOT } from '../../lib/time'
import type { CSSProperties } from 'react'
import { Badge, Button, CourtMark, EmptyState, ErrorState, Icon, SectionHeader, Skeleton, SkeletonCards, type IconName } from '../../components/ui'
import { KIND_TONE } from '../../lib/occupation'

const nextSlot = Math.ceil(NOW / SLOT) * SLOT

export function AdminHome() {
  const { state } = useStore()
  const { go, openReservation } = useAdmin()
  const { dataState, retry } = useScreenState()
  const { active: courts, name: courtName } = useCourts()

  if (dataState === 'loading') return <HomeSkeleton count={courts.length} />
  if (dataState === 'error') return <ErrorState onRetry={retry} />

  const occupations = dataState === 'empty' ? [] : state.occupations
  const sales = dataState === 'empty' ? [] : state.sales
  const today = forDay(occupations, TODAY)
  const live = courts.map((court) => ({ court, current: occupationAt(occupations, court.id, TODAY, NOW), freeUntil: nextStartAfter(occupations, court.id, TODAY, NOW) }))
  const inPlay = live.filter((item) => item.current && item.current.kind !== 'block').length
  const upcoming = today.filter((item) => item.start >= NOW).slice(0, 6)
  const nextUp = upcoming[0]
  const collectedToday = sales.flatMap((sale) => sale.payments).filter((payment) => payment.date === TODAY).reduce((sum, payment) => sum + payment.amountCents, 0)
  const salesToday = sales.filter((sale) => sale.date === TODAY && !sale.voided).length
  const pendingSales = sales.filter((sale) => balanceCents(sale) > 0)
  const pendingTotal = pendingSales.reduce((sum, sale) => sum + balanceCents(sale), 0)
  const pendingPeople = new Set(pendingSales.map((sale) => sale.personId)).size
  const lessons = today.filter((item) => item.kind === 'lesson')
  const matches = today.filter((item) => item.kind === 'match')
  const dues = periodSummary(state.dues, state.duePayments, CURRENT_PERIOD)
  const duesPending = dues.partial + dues.unpaid

  return (
    <div className="home">
      <section className="home-hero texture-court" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow eyebrow-on-dark">Ahora en el club</p>
          <h2 id="hero-title" className="hero-title display">
            <span className="hero-big num">{inPlay}</span>
            <span>de {courts.length} canchas<br />en juego</span>
          </h2>
          <p className="hero-next">
            {nextUp ? <>Próximo: <b className="num">{hhmm(nextUp.start)}</b> · {courtName(nextUp.courtId)} · {nextUp.title}</> : 'No hay más turnos por hoy.'}
          </p>
        </div>
        <ol className="hero-meter" aria-label="Estado de cada cancha" style={{ '--n': courts.length } as CSSProperties}>
          {live.map(({ court, current }) => (
            <li key={court.id} className={`meter-${current ? current.kind : 'free'}`}>
              <span className="num">{court.short}</span>
              <span className="visually-hidden">{current ? KIND_LABEL[current.kind] : 'Libre'}</span>
            </li>
          ))}
        </ol>
        <div className="hero-actions">
          <Button variant="accent" size="lg" icon="plus" onClick={() => openReservation({ date: TODAY, start: nextSlot })}>Nueva reserva</Button>
          <Button variant="on-dark" icon="cart" onClick={() => go('/admin/cantina')}>Venta rápida</Button>
          <Button variant="on-dark" icon="lock" onClick={() => openReservation({ date: TODAY, mode: 'block', start: nextSlot })}>Bloquear</Button>
        </div>
      </section>

      <section className="home-courts" aria-labelledby="courts-now">
        <SectionHeader id="courts-now" title="Canchas ahora" action={<button type="button" className="link-btn" onClick={() => go('/admin/reservas')}>Ver agenda <Icon name="arrowRight" size={16} /></button>} />
        <div className="court-now-grid">
          {live.map((item) => (
            <CourtNow key={item.court.id} {...item} next={forDay(occupations, TODAY, item.court.id).find((occupation) => occupation.start >= (item.current?.end ?? NOW))} onReserve={() => openReservation({ date: TODAY, courtId: item.court.id, start: nextSlot })} onOpen={() => go('/admin/reservas')} />
          ))}
        </div>
      </section>

      <div className="home-columns">
        <section className="card" aria-labelledby="upcoming">
          <SectionHeader id="upcoming" title="Próximos turnos" eyebrow="Hoy" action={<Badge tone="neutral">{plural(today.filter((item) => item.start >= NOW).length, 'turno', 'turnos')}</Badge>} />
          {upcoming.length === 0 ? (
            <EmptyState icon="calendar" title="Sin turnos por delante" body="La agenda de hoy está libre desde ahora." action={<Button variant="accent" icon="plus" onClick={() => openReservation({ date: TODAY, start: nextSlot })}>Cargar reserva</Button>} />
          ) : (
            <ul className="upcoming-list">
              {upcoming.map((item) => <UpcomingRow key={item.id} occupation={item} courtName={courtName(item.courtId)} onClick={() => go('/admin/reservas')} />)}
            </ul>
          )}
        </section>

        <div className="home-side">
          <section className="card card-cantina" aria-labelledby="cantina-hoy">
            <SectionHeader id="cantina-hoy" title="Cantina hoy" action={<Button variant="secondary" size="sm" iconRight="arrowRight" onClick={() => go('/admin/cantina')}>Abrir</Button>} />
            <div className="kpi-row">
              <div className="kpi">
                <span className="kpi-label">Cobrado</span>
                <strong className="kpi-value num">{formatARS(collectedToday)}</strong>
                <span className="kpi-foot">{plural(salesToday, 'venta', 'ventas')}</span>
              </div>
              <div className="kpi kpi-clay">
                <span className="kpi-label">A cuenta</span>
                <strong className="kpi-value num">{formatARS(pendingTotal)}</strong>
                <span className="kpi-foot">{plural(pendingPeople, 'persona', 'personas')}</span>
              </div>
            </div>
          </section>

          <section className="card" aria-labelledby="pendientes">
            <SectionHeader id="pendientes" title="Para revisar" />
            <ul className="todo-list">
              <TodoRow icon="wallet" label={`Cuotas de ${periodLabel(CURRENT_PERIOD, false)}`} value={dataState === 'empty' || dues.issued === 0 ? 'Sin cuotas emitidas' : duesPending ? `${plural(duesPending, 'socio', 'socios')} con saldo · ${formatARS(dues.pendingCents)}` : 'Todas cobradas'} onClick={() => go('/admin/cuotas')} />
              <TodoRow icon="school" label="Escuela hoy" value={lessons.length ? `${plural(lessons.length, 'clase', 'clases')} · ${lessons.reduce((sum, item) => sum + (item.students ?? 0), 0)} alumnos` : 'Sin clases'} onClick={() => go('/admin/escuela')} />
              <TodoRow icon="trophy" label="Torneo Primavera" value={matches.length ? `${plural(matches.length, 'partido', 'partidos')} hoy` : 'Sin partidos hoy'} onClick={() => go('/admin/torneos')} />
              <TodoRow icon="cart" label="Consumos a cuenta" value={pendingTotal ? formatARS(pendingTotal) : 'Al día'} onClick={() => go('/admin/cantina')} />
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

function CourtNow({ court, current, freeUntil, next, onReserve, onOpen }: { court: Court; current?: Occupation; freeUntil: number; next?: Occupation; onReserve: () => void; onOpen: () => void }) {
  const progress = current ? Math.round(((NOW - current.start) / (current.end - current.start)) * 100) : 0
  const label = !current ? 'Libre' : current.kind === 'reservation' ? 'En juego' : current.kind === 'block' ? 'Bloqueada' : KIND_LABEL[current.kind]
  return (
    <article className={`court-now ${current ? `is-${current.kind}` : 'is-free'}`}>
      <header className="court-now-head">
        <CourtMark label={court.short} size="sm" tone={current && current.kind !== 'block' ? 'clay' : current ? 'muted' : 'green'} />
        <h3>{court.name}</h3>
        <Badge tone={current ? KIND_TONE[current.kind] : 'success'} dot>{label}</Badge>
      </header>
      {current ? (
        <button type="button" className="court-now-body" onClick={onOpen}>
          <strong className="court-now-title">{current.title}</strong>
          <span className="court-now-meta num">{range(current)} · quedan {current.end - NOW} min</span>
          <span className="progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>
          <span className="court-now-next">{next ? <>Después: <b className="num">{hhmm(next.start)}</b> {next.title}</> : 'Después: libre'}</span>
        </button>
      ) : (
        <div className="court-now-body">
          <strong className="court-now-title">{freeUntil >= DAY_CLOSE ? 'Libre el resto del día' : <>Libre hasta <span className="num">{hhmm(freeUntil)}</span></>}</strong>
          <span className="court-now-meta">{freeUntil - NOW >= 60 ? 'Entra un turno completo' : `${freeUntil - NOW} min disponibles`}</span>
          <Button variant="accent" size="sm" icon="plus" onClick={onReserve}>Reservar</Button>
        </div>
      )}
    </article>
  )
}

function UpcomingRow({ occupation, courtName, onClick }: { occupation: Occupation; courtName: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="upcoming-row" onClick={onClick}>
        <span className="upcoming-time display num">{hhmm(occupation.start)}</span>
        <span className={`upcoming-bar occ-edge-${occupation.kind}`} aria-hidden="true" />
        <span className="upcoming-main">
          <strong>{occupation.title}</strong>
          <span>{courtName} · {range(occupation)}{occupation.coach ? ` · ${occupation.coach}` : ''}</span>
        </span>
        <Badge tone={KIND_TONE[occupation.kind]}>{KIND_LABEL[occupation.kind]}</Badge>
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
      <div className="court-now-grid">{Array.from({ length: count }, (_, index) => <Skeleton key={index} height={150} radius={16} />)}</div>
      <SkeletonCards count={3} height={64} />
    </div>
  )
}
