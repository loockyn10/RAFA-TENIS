import { useState, type CSSProperties, type ReactNode } from 'react'
import { NOW, PLAYER_ID, TODAY, type Occupation } from '../../data/mock'
import { playerTournamentView, useCourts, usePeople } from '../../lib/data'
import { duePaid, periodLabel } from '../../lib/dues'
import { roundName, type Match } from '../../lib/tournament'
import { findConflict } from '../../lib/agenda'
import { formatARS, plural } from '../../lib/format'
import { useProto, useScreenState } from '../../lib/proto'
import type { RoutePath } from '../../lib/router'
import { useStore } from '../../lib/store'
import { addDays, capitalize, dateShort, dayLong, dayNumber, duration, hhmm, range, relativeDay, weekdayShort, type Minutes } from '../../lib/time'
import { Badge, Button, Chip, CourtMark, EmptyState, ErrorState, Field, Icon, Modal, SectionHeader, SegmentedTabs, SkeletonCards, TextInput } from '../../components/ui'

type Go = (path: RoutePath) => void

function useMyTurns() {
  const { state } = useStore()
  const mine = state.occupations
    .filter((item) => item.personId === PLAYER_ID && item.kind === 'reservation')
    .sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1))
  const isUpcoming = (item: Occupation) => item.date > TODAY || (item.date === TODAY && item.end > NOW)
  return { upcoming: mine.filter(isUpcoming), past: mine.filter((item) => !isUpcoming(item)).reverse() }
}

const DAY_PARTS = [
  { label: 'Mañana', from: 0, to: 12 * 60 },
  { label: 'Tarde', from: 12 * 60, to: 18 * 60 },
  { label: 'Noche', from: 18 * 60, to: 24 * 60 },
]
const isLive = (item: Occupation) => item.date === TODAY && item.start <= NOW && NOW < item.end

function useCourtName() {
  return useCourts().name
}

/** Cuotas propias derivadas de los movimientos (las mismas que ve administración). */
function useMyDues() {
  const { state } = useStore()
  return state.dues
    .filter((due) => due.personId === PLAYER_ID)
    .sort((a, b) => (a.period < b.period ? 1 : -1))
    .map((due) => ({ id: due.id, period: periodLabel(due.period, false), amountCents: due.amountCents, paidCents: duePaid(due, state.duePayments), dueDay: `${due.dueDate.slice(8, 10)}/${due.dueDate.slice(5, 7)}`, overdue: due.dueDate < TODAY }))
}

/** Partido del portal: rivales, cuándo y dónde, a partir del fixture y la agenda. */
function useMyMatch() {
  const { state } = useStore()
  const courtName = useCourtName()
  const view = playerTournamentView(state.tournaments)
  if (!view) return null
  const entryName = (id: string | null) => view.category.entries.find((entry) => entry.id === id)?.name ?? null
  const describe = (match: Match) => {
    const occupation = state.occupations.find((item) => item.id === match.occupationId)
    return occupation ? `${capitalize(weekdayShort(occupation.date))} ${dateShort(occupation.date)} · ${hhmm(occupation.start)} · ${courtName(occupation.courtId)}` : undefined
  }
  const rival = view.next ? entryName(view.next.a === view.entry.id ? view.next.b : view.next.a) : null
  return { ...view, entryName, describe, rival, when: view.next ? describe(view.next) : undefined }
}

function Guard({ children }: { children: ReactNode }) {
  const { dataState, retry } = useScreenState()
  if (dataState === 'loading') return <SkeletonCards count={3} height={120} />
  if (dataState === 'error') return <ErrorState title="No pudimos cargar tu portal" onRetry={retry} />
  return <>{children}</>
}

// ── Inicio ──────────────────────────────────────────────────────────
export function PlayerHome({ go }: { go: Go }) {
  const { dataState } = useScreenState()
  const { upcoming } = useMyTurns()
  const me = usePeople().byId(PLAYER_ID)!
  const next = dataState === 'empty' ? undefined : upcoming[0]
  const due = useMyDues()[0]
  const match = useMyMatch()
  const isMember = me.membership === 'active'
  return (
    <Guard>
      <div className="p-home">
        <section className="p-hello">
          <div>
            <p className="eyebrow">{capitalize(dayLong(TODAY))}</p>
            <h1 className="display">Hola, {me.name.split(' ')[0]}</h1>
          </div>
          {isMember ? <Badge tone="success" icon="check">Socia activa</Badge> : <Badge tone="neutral">Jugadora</Badge>}
        </section>

        {next ? <TurnTicket turn={next} onOpen={() => go('/jugador/turnos')} /> : (
          <div className="card"><EmptyState icon="calendar" title="No tenés turnos próximos" body="Elegí día y horario en segundos." /></div>
        )}

        <Button variant="accent" size="lg" block icon="plus" onClick={() => go('/jugador/reservar')} className="p-cta">Reservar cancha</Button>

        <div className="p-cards">
          {due && (
            <button type="button" className="card p-card" onClick={() => go('/jugador/perfil')}>
              <span className="p-card-icon"><Icon name="wallet" size={22} /></span>
              <span className="p-card-main">
                <span className="eyebrow">Cuota de {due.period}</span>
                <strong className="display num">{formatARS(Math.max(0, due.amountCents - due.paidCents))}</strong>
                <span>{due.paidCents >= due.amountCents ? 'Pagada · gracias' : `${due.overdue ? 'Venció' : 'Vence'} el ${due.dueDay} · pagás en el club`}</span>
              </span>
              {due.paidCents >= due.amountCents ? <Badge tone="success" icon="check">Pagada</Badge> : due.paidCents > 0 ? <Badge tone="warning">Pago parcial</Badge> : <Badge tone="warning">Pendiente</Badge>}
            </button>
          )}
          {match && (
            <button type="button" className="card p-card" onClick={() => go('/jugador/torneos')}>
              <span className="p-card-icon p-card-icon-clay"><Icon name="trophy" size={22} /></span>
              <span className="p-card-main">
                <span className="eyebrow">{match.tournament.name}</span>
                <strong>{match.next ? `${match.nextRound} vs. ${match.rival ?? 'a definir'}` : match.category.name}</strong>
                <span>{match.next ? match.when ?? 'Horario a confirmar' : 'Sin partidos pendientes'}</span>
              </span>
              <Icon name="chevronRight" size={18} className="row-chevron" />
            </button>
          )}
        </div>
      </div>
    </Guard>
  )
}

function TurnTicket({ turn, onOpen }: { turn: Occupation; onOpen: () => void }) {
  const live = isLive(turn)
  const { name: courtName, byId } = useCourts()
  const courtShort = (id: string) => byId(id)?.short ?? ''
  return (
    <article className={`ticket-card ${live ? 'is-live' : ''}`}>
      <div className="ticket-card-court">
        <CourtMark label={courtShort(turn.courtId)} size="lg" />
      </div>
      <div className="ticket-card-main">
        <p className="eyebrow">{live ? 'En juego ahora' : 'Tu próximo turno'}</p>
        <p className="ticket-card-day display">{relativeDay(turn.date, TODAY)}</p>
        <p className="ticket-card-time display num">{range(turn)}</p>
        <p className="ticket-card-meta">{courtName(turn.courtId)} · {duration(turn.end - turn.start)}</p>
      </div>
      <button type="button" className="ticket-card-link" onClick={onOpen}>Mis turnos <Icon name="arrowRight" size={16} /></button>
    </article>
  )
}

// ── Reservar ────────────────────────────────────────────────────────
export function PlayerBook({ go }: { go: Go }) {
  const { state, dispatch } = useStore()
  const { simulate } = useProto()
  const { dataState } = useScreenState()
  const { upcoming } = useMyTurns()
  const { active: courts, name: courtName } = useCourts()
  const BOOKING_RULES = state.bookingRules
  const me = usePeople().byId(PLAYER_ID)!
  const [date, setDate] = useState(TODAY)
  const [pickedLength, setLength] = useState(BOOKING_RULES.durations[0] ?? 60)
  const length = BOOKING_RULES.durations.includes(pickedLength) ? pickedLength : BOOKING_RULES.durations[0] ?? 60
  const [start, setStart] = useState<Minutes | null>(null)
  const [courtId, setCourtId] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error' | 'done'>('idle')
  const occupations = dataState === 'empty' ? [] : state.occupations
  const limitReached = upcoming.length >= BOOKING_RULES.maxActive

  const days = Array.from({ length: BOOKING_RULES.maxAdvanceDays + 1 }, (_, index) => addDays(TODAY, index))
  const times: { start: Minutes; free: string[] }[] = []
  for (let time = BOOKING_RULES.opensAt; time + length <= BOOKING_RULES.closesAt; time += 30) {
    if (date === TODAY && time <= NOW) continue
    times.push({ start: time, free: courts.filter((court) => !findConflict(occupations, { courtId: court.id, date, start: time, end: time + length })).map((court) => court.id) })
  }
  const selected = times.find((item) => item.start === start)

  const reset = (next: Partial<{ date: string; length: number }>) => {
    if (next.date) setDate(next.date)
    if (next.length) setLength(next.length)
    setStart(null)
    setCourtId(null)
  }

  const book = async () => {
    if (start === null || !courtId) return
    setStatus('saving')
    try { await simulate(900) } catch { setStatus('error'); return }
    dispatch({ type: 'occ/add', occupation: { id: `new-p-${Date.now()}`, courtId, date, start, end: start + length, kind: 'reservation', title: me.name, personId: PLAYER_ID } })
    setStatus('done')
  }

  return (
    <Guard>
      <div className="p-book">
        <header className="p-page-head">
          <h1 className="display">Reservar cancha</h1>
          <p className="p-rules"><Icon name="info" size={16} />Hasta {BOOKING_RULES.maxAdvanceDays} días antes · máx. {BOOKING_RULES.maxActive} turnos activos · cancelás hasta {BOOKING_RULES.cancelLeadHours} h antes</p>
        </header>

        {!BOOKING_RULES.enabled && (
          <div className="inline-alert inline-alert-info" role="status"><Icon name="info" size={20} /><div><strong>Las reservas online están pausadas</strong><p>Por ahora reservá llamando o pasando por el club.</p></div></div>
        )}

        {limitReached && status !== 'done' && (
          <div className="inline-alert inline-alert-warning" role="status"><Icon name="alert" size={20} /><div><strong>Ya tenés {upcoming.length} turnos activos</strong><p>Cancelá uno desde Mis turnos para reservar otro.</p><Button variant="secondary" size="sm" onClick={() => go('/jugador/turnos')}>Ir a Mis turnos</Button></div></div>
        )}

        <section className="p-step" aria-labelledby="step-day">
          <h2 id="step-day" className="p-step-title"><span className="p-step-n">1</span>Día</h2>
          <div className="date-strip" role="listbox" aria-label="Elegir día">
            {days.map((day) => (
              <button key={day} type="button" role="option" aria-selected={day === date} className={`date-chip ${day === date ? 'is-selected' : ''} ${day === TODAY ? 'is-today' : ''}`} onClick={() => reset({ date: day })}>
                <span className="date-chip-wd">{day === TODAY ? 'Hoy' : weekdayShort(day)}</span>
                <span className="date-chip-n display num">{dayNumber(day)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="p-step" aria-labelledby="step-length">
          <h2 id="step-length" className="p-step-title"><span className="p-step-n">2</span>Duración</h2>
          <div className="chip-row">
            {BOOKING_RULES.durations.map((minutes) => <Chip key={minutes} selected={length === minutes} onClick={() => reset({ length: minutes })}>{duration(minutes)}</Chip>)}
          </div>
        </section>

        <section className="p-step" aria-labelledby="step-time">
          <h2 id="step-time" className="p-step-title"><span className="p-step-n">3</span>Horario</h2>
          {times.length === 0 || times.every((item) => item.free.length === 0) ? (
            <EmptyState icon="clock" title="No quedan horarios este día" body="Probá con otro día o duración." />
          ) : (
            DAY_PARTS.map((part) => {
              const group = times.filter((item) => item.start >= part.from && item.start < part.to)
              if (group.length === 0) return null
              return (
                <div key={part.label} className="time-group">
                  <p className="time-group-label">{part.label}<span>{plural(group.filter((item) => item.free.length > 0).length, 'horario libre', 'horarios libres')}</span></p>
                  <div className="time-grid" role="listbox" aria-label={`Horarios de la ${part.label.toLowerCase()}`}>
                    {group.map((item) => (
                      <button key={item.start} type="button" role="option" aria-selected={item.start === start} disabled={item.free.length === 0 || limitReached || !BOOKING_RULES.enabled} className={`time-slot ${item.start === start ? 'is-selected' : ''}`} onClick={() => { setStart(item.start); setCourtId(item.free[0]) }}>
                        <span className="display num">{hhmm(item.start)}</span>
                        <small>{item.free.length === 0 ? 'Completo' : plural(item.free.length, 'cancha', 'canchas')}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </section>

        {selected && (
          <section className="p-step" aria-labelledby="step-court">
            <h2 id="step-court" className="p-step-title"><span className="p-step-n">4</span>Cancha</h2>
            <div className="court-picker" role="radiogroup" aria-label="Cancha" style={{ '--n': courts.length } as CSSProperties}>
              {courts.map((court) => {
                const free = selected.free.includes(court.id)
                return (
                  <button key={court.id} type="button" role="radio" aria-checked={court.id === courtId} disabled={!free} className={`court-option ${court.id === courtId ? 'is-selected' : ''} ${!free ? 'is-busy' : ''}`} onClick={() => setCourtId(court.id)}>
                    <CourtMark label={court.short} size="sm" tone={court.id === courtId ? 'clay' : 'muted'} />
                    <span className="court-option-state">{free ? 'Libre' : 'Ocupada'}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        <div className={`p-summary ${selected && courtId ? 'is-ready' : ''}`}>
          <div>
            <strong>{selected && courtId ? `${courtName(courtId)} · ${range({ start: selected.start, end: selected.start + length })}` : 'Elegí un horario'}</strong>
            <span>{capitalize(weekdayShort(date))} {dateShort(date)} · {duration(length)}</span>
          </div>
          <Button variant="accent" size="lg" icon={status === 'error' ? 'refresh' : 'check'} disabled={!selected || !courtId || limitReached || !BOOKING_RULES.enabled} loading={status === 'saving'} onClick={() => void book()}>
            {status === 'error' ? 'Reintentar' : 'Reservar'}
          </Button>
        </div>
        {status === 'error' && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No pudimos confirmar</strong><p>Puede que alguien haya tomado el horario o falló la conexión. Reintentá o elegí otro.</p></div></div>}

        <Modal open={status === 'done'} onClose={() => { setStatus('idle'); reset({}) }} size="sm" title="¡Reserva confirmada!">
          <div className="success">
            <span className="success-icon"><Icon name="checkCircle" size={44} /></span>
            <p className="display success-when">{relativeDay(date, TODAY)} · {start !== null && range({ start, end: start + length })}</p>
            <p>{courtId && courtName(courtId)} · te esperamos en el club.</p>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => { setStatus('idle'); reset({}) }}>Otra reserva</Button>
              <Button variant="accent" iconRight="arrowRight" onClick={() => go('/jugador/turnos')}>Ver mis turnos</Button>
            </div>
          </div>
        </Modal>
      </div>
    </Guard>
  )
}

// ── Mis turnos ──────────────────────────────────────────────────────
export function PlayerTurns({ go }: { go: Go }) {
  const { dispatch } = useStore()
  const { simulate, notify } = useProto()
  const { dataState } = useScreenState()
  const turns = useMyTurns()
  const { state } = useStore()
  const courtName = useCourtName()
  const canCancel = (item: Occupation) => item.date > TODAY || (item.date === TODAY && item.start - NOW >= state.bookingRules.cancelLeadHours * 60)
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')
  const [cancelling, setCancelling] = useState<Occupation | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const list = dataState === 'empty' ? [] : tab === 'upcoming' ? turns.upcoming : turns.past

  const cancel = async () => {
    if (!cancelling) return
    setStatus('saving')
    try { await simulate() } catch { setStatus('error'); return }
    dispatch({ type: 'occ/cancel', id: cancelling.id })
    notify({ tone: 'success', title: 'Turno cancelado', body: `${courtName(cancelling.courtId)} · ${range(cancelling)}` })
    setStatus('idle')
    setCancelling(null)
  }

  return (
    <Guard>
      <div className="p-turns">
        <header className="p-page-head">
          <h1 className="display">Mis turnos</h1>
          <SegmentedTabs label="Turnos" value={tab} onChange={setTab} items={[{ id: 'upcoming', label: 'Próximos', count: turns.upcoming.length }, { id: 'past', label: 'Anteriores' }]} />
        </header>
        {list.length === 0 ? (
          <EmptyState icon="calendar" title={tab === 'upcoming' ? 'No tenés turnos próximos' : 'Sin turnos anteriores'} action={tab === 'upcoming' ? <Button variant="accent" icon="plus" onClick={() => go('/jugador/reservar')}>Reservar cancha</Button> : undefined} />
        ) : (
          <ul className="turn-list">
            {list.map((turn) => (
              <li key={turn.id} className={`turn ${isLive(turn) ? 'is-live' : ''} ${tab === 'past' ? 'is-past' : ''}`}>
                <div className="turn-date">
                  <span className="turn-wd">{weekdayShort(turn.date)}</span>
                  <span className="display num">{dayNumber(turn.date)}</span>
                </div>
                <div className="turn-main">
                  <strong className="num">{range(turn)}</strong>
                  <span>{courtName(turn.courtId)} · {duration(turn.end - turn.start)}</span>
                </div>
                <div className="turn-side">
                  {tab === 'past' ? <Badge tone="neutral">Jugado</Badge>
                    : isLive(turn) ? <Badge tone="accent" dot>En juego</Badge>
                      : canCancel(turn) ? <Button variant="ghost" size="sm" onClick={() => { setStatus('idle'); setCancelling(turn) }}>Cancelar</Button>
                        : <Badge tone="neutral" icon="lock">Sin cancelación</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Modal
          open={cancelling !== null}
          onClose={() => setCancelling(null)}
          busy={status === 'saving'}
          size="sm"
          title="¿Cancelar este turno?"
          footer={
            <div className="form-actions">
              <Button variant="ghost" onClick={() => setCancelling(null)} disabled={status === 'saving'}>Volver</Button>
              <Button variant="danger" icon={status === 'error' ? 'refresh' : 'x'} loading={status === 'saving'} onClick={() => void cancel()}>{status === 'error' ? 'Reintentar' : 'Sí, cancelar'}</Button>
            </div>
          }
        >
          {cancelling && (
            <div className="confirm-body">
              <p><b>{relativeDay(cancelling.date, TODAY)}</b> · {courtName(cancelling.courtId)} · <span className="num">{range(cancelling)}</span></p>
              <p className="muted">La cancha queda libre para otra persona.</p>
              {status === 'error' && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se pudo cancelar</strong><p>Tu turno sigue confirmado. Probá de nuevo.</p></div></div>}
            </div>
          )}
        </Modal>
      </div>
    </Guard>
  )
}

// ── Torneos ─────────────────────────────────────────────────────────
export function PlayerTournaments() {
  const { dataState } = useScreenState()
  const view = useMyMatch()
  if (dataState === 'empty' || !view) return <Guard><EmptyState icon="trophy" title="No hay torneos publicados" body="Cuando el club publique uno vas a ver acá tu cuadro y tus partidos." /></Guard>
  const { tournament, category, rounds, next, rival, when, entryName } = view
  const roundsList = Array.from({ length: rounds }, (_, index) => index + 1)
  return (
    <Guard>
      <div className="p-tournament">
        <header className="p-page-head">
          <p className="eyebrow">{category.name}</p>
          <h1 className="display">{tournament.name}</h1>
          <Badge tone="clay" dot>{tournament.status === 'registration' ? 'Inscripción abierta' : 'En juego'}</Badge>
        </header>
        <article className="match-card texture-court">
          <p className="eyebrow eyebrow-on-dark">{next ? `Tu próximo partido · ${view.nextRound}` : category.matches.length ? 'Sin partidos pendientes' : 'Cuadro en preparación'}</p>
          <div className="match-versus">
            <strong className="display">{view.entry.name}</strong>
            {next && <><span className="match-vs">vs</span><strong className="display">{rival ?? 'A definir'}</strong></>}
          </div>
          {next && <p className="match-when"><Icon name="clock" size={16} />{when ?? 'Horario a confirmar por el club'}</p>}
        </article>
        {rounds > 0 && (
          <>
            <SectionHeader title="Cuadro" />
            <div className="bracket" tabIndex={0} aria-label="Cuadro del torneo">
              {roundsList.map((round) => (
                <div key={round} className="bracket-round">
                  <p className="bracket-round-name">{roundName(round, rounds)}</p>
                  <ul>
                    {category.matches.filter((match) => match.round === round).map((match) => {
                      const mine = match.a === view.entry.id || match.b === view.entry.id
                      return (
                        <li key={match.id} className={`bracket-match ${mine ? 'is-mine' : ''}`}>
                          <span className={match.winner === 'a' ? 'is-winner' : ''}>{entryName(match.a) ?? (match.bye ? 'Pase libre' : 'A definir')}</span>
                          <span className={match.winner === 'b' ? 'is-winner' : ''}>{entryName(match.b) ?? (match.bye ? 'Pase libre' : 'A definir')}</span>
                          <small>{match.walkover ? 'W.O.' : match.score ?? (match.bye ? 'Pase libre' : view.describe(match) ?? 'Pendiente')}</small>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Guard>
  )
}

// ── Perfil ──────────────────────────────────────────────────────────
export function PlayerProfile() {
  const { state, dispatch } = useStore()
  const { simulate, notify } = useProto()
  const me = usePeople().byId(PLAYER_ID)!
  const dues = useMyDues()
  const [phone, setPhone] = useState(state.contact.phone)
  const [email, setEmail] = useState(state.contact.email)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const dirty = phone !== state.contact.phone || email !== state.contact.email

  const save = async () => {
    setStatus('saving')
    try { await simulate() } catch { setStatus('error'); return }
    dispatch({ type: 'contact/save', phone, email })
    notify({ tone: 'success', title: 'Datos actualizados' })
    setStatus('idle')
  }

  return (
    <Guard>
      <div className="p-profile">
        <header className="p-page-head"><h1 className="display">Mi perfil</h1></header>
        <div className="p-profile-grid">
          <section className="card" aria-labelledby="mis-datos">
            <SectionHeader id="mis-datos" title="Datos de contacto" />
            <form className="stack" onSubmit={(event) => { event.preventDefault(); void save() }}>
              <Field label="Nombre" hint="Lo administra el club.">{(id, describedBy) => <TextInput id={id} value={me.name} readOnly aria-describedby={describedBy} />}</Field>
              <Field label="Teléfono">{(id) => <TextInput id={id} type="tel" icon="phone" value={phone} onChange={(event) => setPhone(event.target.value)} />}</Field>
              <Field label="Email de contacto" hint="No cambia el email con el que iniciás sesión.">{(id, describedBy) => <TextInput id={id} type="email" icon="mail" value={email} aria-describedby={describedBy} onChange={(event) => setEmail(event.target.value)} />}</Field>
              {status === 'error' && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardaron los cambios</strong><p>Revisá la conexión y reintentá.</p></div></div>}
              <Button type="submit" variant="primary" icon="check" disabled={!dirty} loading={status === 'saving'}>Guardar cambios</Button>
            </form>
          </section>
          <section className="card" aria-labelledby="mis-cuotas">
            <SectionHeader id="mis-cuotas" title="Mis cuotas" action={me.membership === 'active' ? <Badge tone="success" icon="check">Socia activa</Badge> : undefined} />
            {dues.length === 0 ? <EmptyState icon="wallet" title="Sin cuotas" body="Las cuotas aparecen acá cuando el club las emite." /> : (
              <ul className="due-list">
                {dues.map((due) => {
                  const pending = due.amountCents - due.paidCents
                  return (
                    <li key={due.id} className="due-row">
                      <span className="due-main"><strong>{due.period}</strong><span>{pending > 0 && due.paidCents > 0 ? `Pagaste ${formatARS(due.paidCents)} · resta ${formatARS(pending)}` : `Vence ${due.dueDay}`}</span></span>
                      <strong className="num">{formatARS(due.amountCents)}</strong>
                      {pending <= 0 ? <Badge tone="success" icon="check">Pagada</Badge> : due.paidCents > 0 ? <Badge tone="warning">Parcial</Badge> : <Badge tone="warning">Pendiente</Badge>}
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="detail-footnote"><Icon name="info" size={16} />Las cuotas se pagan en el club. El portal solo las muestra.</p>
          </section>
        </div>
      </div>
    </Guard>
  )
}
