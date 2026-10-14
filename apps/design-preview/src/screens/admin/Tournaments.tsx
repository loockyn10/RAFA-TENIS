import { useState } from 'react'
import { entryFor, NOW, TODAY, TOURNAMENT_STATUS_LABEL, type Occupation, type TCategory, type Tournament, type TournamentStatus } from '../../data/mock'
import { Bracket, MatchCard, type BracketContext } from '../../components/bracket'
import { CourtPicker, PersonPicker } from '../../components/domain'
import { Badge, Button, Chip, ConfirmDialog, EmptyState, ErrorState, Field, Icon, IconButton, Modal, PageHead, SegmentedTabs, SelectInput, SkeletonCards, Switch, TextArea, TextInput, type Tone } from '../../components/ui'
import { useAdmin } from '../../lib/admin'
import { findConflict } from '../../lib/agenda'
import { categoryStatus, matchWhen, useAction, useCourts, useIntent, usePeople } from '../../lib/data'
import { plural } from '../../lib/format'
import { useProto, useScreenState } from '../../lib/proto'
import { useStore } from '../../lib/store'
import { addDays, capitalize, dateShort, DAY_CLOSE, dayLong, duration, hhmm, range, relativeDay, slots, type Minutes } from '../../lib/time'
import { bracketSize, canRecord, champion, entryLabel, drawSlots, generateFixture, matchState, MAX_ENTRIES, MIN_ENTRIES, nextMatch, recordResult, roundCount, roundName, shuffle, scoreBySide, type Entry, type Match, type Side } from '../../lib/tournament'

const STATUS_TONE: Record<TournamentStatus, Tone> = { draft: 'neutral', registration: 'info', in_progress: 'clay', completed: 'success' }
const rangeLabel = (t: Tournament) => `${dateShort(t.startsOn)} al ${dateShort(t.endsOn)}`
const roundsOf = (matches: Match[]) => (matches.length ? roundCount(matches.filter((match) => match.round === 1).length * 2) : 0)

/** El torneo pasa a «En juego» con el primer cuadro y a «Finalizado» cuando todas sus categorías con cuadro tienen campeón. */
function withStatus(tournament: Tournament): Tournament {
  const drawn = tournament.categories.filter((category) => category.matches.length > 0)
  if (drawn.length > 0 && drawn.length === tournament.categories.length && drawn.every((category) => champion(category.matches))) return { ...tournament, status: 'completed' }
  if (drawn.length > 0 && (tournament.status === 'draft' || tournament.status === 'registration')) return { ...tournament, status: 'in_progress' }
  return tournament
}

export function Tournaments() {
  const { state } = useStore()
  const { dataState, retry } = useScreenState()
  const [openId, setOpenId] = useState<string | null>(null)
  const [focus, setFocus] = useState<{ categoryId: string; matchId: string } | null>(null)
  const [filter, setFilter] = useState<TournamentStatus | 'all'>('all')
  const [creating, setCreating] = useState(false)

  useIntent(['match'], (intent) => { setOpenId(intent.tournamentId); setFocus({ categoryId: intent.categoryId, matchId: intent.matchId }) })

  const tournaments = dataState === 'empty' ? [] : state.tournaments
  const open = tournaments.find((item) => item.id === openId)
  if (open) return <TournamentDetail key={open.id} tournament={open} focus={focus} onFocusDone={() => setFocus(null)} onBack={() => setOpenId(null)} />

  const live = tournaments.filter((item) => item.status === 'in_progress')
  const rest = tournaments.filter((item) => item.status !== 'in_progress' && (filter === 'all' || item.status === filter))
  const count = (status: TournamentStatus) => tournaments.filter((item) => item.status === status).length

  return (
    <div className="module">
      <PageHead eyebrow="Club" title="Torneos" meta={`${plural(tournaments.length, 'torneo', 'torneos')} · ${plural(live.length, 'en juego', 'en juego')}`} actions={<Button variant="accent" icon="plus" onClick={() => setCreating(true)}>Nuevo torneo</Button>} />
      {dataState === 'error' ? <ErrorState title="No pudimos cargar los torneos" onRetry={retry} />
        : dataState === 'loading' ? <SkeletonCards count={3} height={150} />
          : tournaments.length === 0 ? (
            <div className="card"><EmptyState icon="trophy" title="Todavía no hay torneos" body="Creá uno, sumá categorías e inscriptos y generá el cuadro cuando cierre la inscripción." action={<Button variant="accent" icon="plus" onClick={() => setCreating(true)}>Nuevo torneo</Button>} /></div>
          ) : (
            <>
              {live.map((item) => <LiveTournament key={item.id} tournament={item} onOpen={() => setOpenId(item.id)} />)}
              <div className="chip-row chip-row-scroll" role="group" aria-label="Filtrar torneos">
                <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>Todos</Chip>
                {(['registration', 'draft', 'completed'] as const).map((status) => count(status) > 0 && <Chip key={status} selected={filter === status} count={count(status)} onClick={() => setFilter(status)}>{TOURNAMENT_STATUS_LABEL[status]}</Chip>)}
              </div>
              <ul className="tour-grid">
                {rest.map((item) => <li key={item.id}><TournamentCard tournament={item} onOpen={() => setOpenId(item.id)} /></li>)}
              </ul>
            </>
          )}
      <TournamentForm open={creating} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); setOpenId(id) }} />
    </div>
  )
}

function useTournamentCtx(entries: Entry[]): BracketContext {
  const { state } = useStore()
  const { name } = useCourts()
  return { entries, occupations: state.occupations, courtName: name }
}

function LiveTournament({ tournament, onOpen }: { tournament: Tournament; onOpen: () => void }) {
  const { state } = useStore()
  const { name: courtName } = useCourts()
  const today = tournament.categories.flatMap((category) => category.matches.filter((match) => state.occupations.some((item) => item.id === match.occupationId && item.date === TODAY)).map((match) => ({ match, category })))
  const entries = tournament.categories.reduce((sum, category) => sum + category.entries.length, 0)
  const played = tournament.categories.reduce((sum, category) => sum + category.matches.filter((match) => match.winner && !match.bye).length, 0)
  const total = tournament.categories.reduce((sum, category) => sum + category.matches.filter((match) => !match.bye).length, 0)
  return (
    <article className="tour-live texture-court">
      <div className="tour-live-head">
        <div>
          <p className="eyebrow eyebrow-on-dark">En juego · {rangeLabel(tournament)}</p>
          <h3 className="display">{tournament.name}</h3>
        </div>
        <Button variant="on-dark" iconRight="arrowRight" onClick={onOpen}>Abrir torneo</Button>
      </div>
      <dl className="tour-live-stats">
        <div><dt>Categorías</dt><dd className="display num">{tournament.categories.length}</dd></div>
        <div><dt>Inscriptos</dt><dd className="display num">{entries}</dd></div>
        <div><dt>Partidos</dt><dd className="display num">{played}<small>/{total}</small></dd></div>
      </dl>
      {today.length > 0 && (
        <ul className="tour-live-today" aria-label="Partidos de hoy">
          {today.map(({ match, category }) => {
            const when = matchWhen(match, { occupations: state.occupations, courtName })
            return (
              <li key={match.id}>
                <button type="button" onClick={onOpen}>
                  {when?.live && !match.winner ? <span className="live-dot" aria-label="En juego" /> : <Icon name="clock" size={16} />}
                  <span className="tour-live-match"><b>{entryLabel(category.entries, match.a)} vs. {entryLabel(category.entries, match.b)}</b><small>{category.name} · {roundName(match.round, roundsOf(category.matches))}</small></span>
                  <span className="num">{when?.text.split(' · ').slice(1).join(' · ')}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </article>
  )
}

function TournamentCard({ tournament, onOpen }: { tournament: Tournament; onOpen: () => void }) {
  const entries = tournament.categories.reduce((sum, category) => sum + category.entries.length, 0)
  const champions = tournament.categories.map((category) => ({ category, id: champion(category.matches) })).filter((item) => item.id)
  return (
    <button type="button" className={`tour-card is-${tournament.status}`} onClick={onOpen}>
      <span className="tour-card-head">
        <Badge tone={STATUS_TONE[tournament.status]} dot>{TOURNAMENT_STATUS_LABEL[tournament.status]}</Badge>
        <span className="muted num">{rangeLabel(tournament)}</span>
      </span>
      <strong className="tour-card-title display">{tournament.name}</strong>
      {tournament.status === 'completed' && champions.length > 0 ? (
        <ul className="champ-list">
          {champions.map(({ category, id }) => <li key={category.id}><Icon name="crown" size={16} /><b>{entryLabel(category.entries, id)}</b><span>{category.name}</span></li>)}
        </ul>
      ) : (
        <span className="tour-card-cats">{tournament.categories.length ? tournament.categories.map((category) => <span key={category.id}>{category.name}</span>) : <span className="muted">Sin categorías</span>}</span>
      )}
      <span className="tour-card-foot"><Icon name="users" size={16} />{plural(entries, 'inscripto', 'inscriptos')}<Icon name="chevronRight" size={18} className="row-chevron" /></span>
    </button>
  )
}

// ── Detalle del torneo ──────────────────────────────────────────────
type CatTab = 'bracket' | 'matches' | 'entries'

function TournamentDetail({ tournament, focus, onFocusDone, onBack }: { tournament: Tournament; focus: { categoryId: string; matchId: string } | null; onFocusDone: () => void; onBack: () => void }) {
  const { dispatch } = useStore()
  const { notify } = useProto()
  const action = useAction()
  const [categoryId, setCategoryId] = useState(focus?.categoryId ?? tournament.categories[0]?.id ?? null)
  const category = tournament.categories.find((item) => item.id === categoryId) ?? tournament.categories[0]
  const [tab, setTab] = useState<CatTab>(category && category.matches.length === 0 ? 'entries' : 'bracket')
  const [matchId, setMatchId] = useState<string | null>(focus?.matchId ?? null)
  const [editing, setEditing] = useState(false)
  const [newCat, setNewCat] = useState(false)
  const [opening, setOpening] = useState(false)
  const ctx = useTournamentCtx(category?.entries ?? [])
  const save = (next: Tournament) => dispatch({ type: 'tournament/save', tournament: withStatus(next) })
  const saveCategory = (next: TCategory) => save({ ...tournament, categories: tournament.categories.map((item) => (item.id === next.id ? next : item)) })
  const match = category?.matches.find((item) => item.id === matchId) ?? null
  const champ = category ? champion(category.matches) : null
  const rounds = category ? roundsOf(category.matches) : 0
  const final = category?.matches.find((item) => item.round === rounds)

  const pick = (id: string) => { setCategoryId(id); const next = tournament.categories.find((item) => item.id === id); setTab(next && next.matches.length ? 'bracket' : 'entries') }
  const openRegistration = () => void action.run(() => {
    save({ ...tournament, status: 'registration' })
    notify({ tone: 'success', title: 'Inscripción abierta', body: tournament.name })
    setOpening(false)
  })

  return (
    <div className="module">
      <button type="button" className="back-link" onClick={onBack}><Icon name="chevronLeft" size={18} />Torneos</button>
      <header className={`tour-hero texture-court is-${tournament.status}`}>
        <div className="tour-hero-main">
          <Badge tone={tournament.status === 'in_progress' ? 'accent' : 'dark'} dot>{TOURNAMENT_STATUS_LABEL[tournament.status]}</Badge>
          <h2 className="display">{tournament.name}</h2>
          <p>{capitalize(dayLong(tournament.startsOn))} al {dayLong(tournament.endsOn)}</p>
          {tournament.description && <p className="tour-hero-desc">{tournament.description}</p>}
        </div>
        <div className="tour-hero-actions">
          {tournament.status === 'draft' && <Button variant="accent" icon="send" onClick={() => { action.reset(); setOpening(true) }}>Abrir inscripción</Button>}
          <Button variant="on-dark" icon="edit" onClick={() => setEditing(true)}>Editar datos</Button>
        </div>
      </header>

      <div className="cat-bar">
        <div className="chip-row chip-row-scroll" role="tablist" aria-label="Categorías">
          {tournament.categories.map((item) => {
            const status = categoryStatus(item.matches)
            return (
              <button key={item.id} type="button" role="tab" aria-selected={item.id === category?.id} className={`cat-chip ${item.id === category?.id ? 'is-selected' : ''}`} onClick={() => pick(item.id)}>
                <span className={`cat-dot is-${status}`} aria-hidden="true" />
                <span>{item.name}</span>
                <small>{status === 'open' ? `${item.entries.length} insc.` : status === 'completed' ? 'Final' : 'Cuadro'}</small>
              </button>
            )
          })}
          {tournament.status !== 'completed' && <button type="button" className="cat-chip cat-chip-add" onClick={() => setNewCat(true)}><Icon name="plus" size={16} />Categoría</button>}
        </div>
      </div>

      {!category ? (
        <div className="card"><EmptyState icon="trophy" title="Agregá la primera categoría" body="Por ejemplo «Caballeros B · Singles» o «Dobles mixto». Cada categoría tiene su propio cuadro." action={<Button variant="accent" icon="plus" onClick={() => setNewCat(true)}>Nueva categoría</Button>} /></div>
      ) : (
        <>
          {champ && final && (
            <section className="champion-banner" aria-label="Campeón">
              <span className="champion-icon"><Icon name="trophy" size={34} /></span>
              <div>
                <p className="eyebrow">{category.modality === 'doubles' ? 'Campeones' : 'Campeón'} · {category.name}</p>
                <p className="champion-name display">{entryLabel(category.entries, champ)}</p>
                <p className="champion-final">Final vs. {entryLabel(category.entries, final.winner === 'a' ? final.b : final.a)} · <span className="num">{final.walkover ? 'W.O.' : final.score}</span></p>
              </div>
            </section>
          )}
          <div className="cat-head">
            <p className="muted">{category.modality === 'doubles' ? 'Dobles' : 'Singles'} · {plural(category.entries.length, 'inscripción', 'inscripciones')}{category.matches.length ? ` · cuadro de ${bracketSize(category.entries.length)} · ${plural(category.matches.filter((item) => item.winner && !item.bye).length, 'partido jugado', 'partidos jugados')}` : ' · inscripción abierta'}</p>
            <SegmentedTabs label="Vista de la categoría" size="sm" value={tab} onChange={setTab} items={[
              { id: 'bracket', label: 'Cuadro', icon: 'bracket' },
              { id: 'matches', label: 'Partidos', icon: 'list' },
              { id: 'entries', label: 'Inscriptos', icon: 'users', count: category.matches.length ? undefined : category.entries.length },
            ]} />
          </div>

          {tab === 'bracket' && (category.matches.length ? <Bracket matches={category.matches} ctx={ctx} onOpen={(item) => setMatchId(item.id)} /> : (
            <div className="card"><EmptyState icon="bracket" title="El cuadro todavía no se generó" body={category.entries.length >= MIN_ENTRIES ? 'Cuando cierres la inscripción, sorteá el cuadro desde Inscriptos.' : 'Hacen falta al menos 2 inscripciones.'} action={<Button variant="secondary" icon="users" onClick={() => setTab('entries')}>Ver inscriptos</Button>} /></div>
          ))}
          {tab === 'matches' && <MatchList category={category} ctx={ctx} onOpen={setMatchId} />}
          {tab === 'entries' && <Entries tournament={tournament} category={category} onSave={saveCategory} onGenerated={() => setTab('bracket')} />}
        </>
      )}

      {category && <MatchSheet tournament={tournament} category={category} match={match} onClose={() => { setMatchId(null); onFocusDone() }} onSave={saveCategory} />}
      <TournamentForm open={editing} editing={tournament} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />
      <CategoryForm open={newCat} tournament={tournament} onClose={() => setNewCat(false)} onCreated={(id) => { setNewCat(false); setCategoryId(id); setTab('entries') }} />
      <ConfirmDialog open={opening} title="¿Abrir la inscripción?" confirmLabel="Abrir inscripción" tone="accent" icon="send" status={action.status} onConfirm={openRegistration} onClose={() => setOpening(false)}>
        <p className="muted">El torneo pasa a «Inscripción abierta». En el portal, los jugadores solo ven torneos publicados.</p>
      </ConfirmDialog>
    </div>
  )
}

// ── Lista de partidos ───────────────────────────────────────────────
function MatchList({ category, ctx, onOpen }: { category: TCategory; ctx: BracketContext; onOpen: (id: string) => void }) {
  if (category.matches.length === 0) return <div className="card"><EmptyState icon="list" title="Sin partidos" body="Los partidos aparecen al generar el cuadro." /></div>
  const rounds = roundsOf(category.matches)
  const dateOf = (match: Match) => ctx.occupations.find((item) => item.id === match.occupationId)
  const groups: { id: string; title: string; items: Match[] }[] = [
    { id: 'today', title: 'Hoy', items: category.matches.filter((match) => !match.winner && dateOf(match)?.date === TODAY) },
    { id: 'next', title: 'Programados', items: category.matches.filter((match) => !match.winner && (dateOf(match)?.date ?? '') > TODAY) },
    { id: 'todo', title: 'Por programar', items: category.matches.filter((match) => matchState(match) === 'unscheduled' || (matchState(match) === 'scheduled' && (dateOf(match)?.date ?? '') < TODAY)) },
    { id: 'wait', title: 'Esperando rival', items: category.matches.filter((match) => matchState(match) === 'waiting') },
    { id: 'done', title: 'Finalizados', items: category.matches.filter((match) => matchState(match) === 'done').reverse() },
  ]
  return (
    <div className="match-groups">
      {groups.filter((group) => group.items.length > 0).map((group) => (
        <section key={group.id} aria-label={group.title}>
          <p className="group-title">{group.title}<span>{group.items.length}</span></p>
          <ul className="match-grid">
            {group.items.map((match) => <li key={match.id}><MatchCard match={match} ctx={ctx} label={roundName(match.round, rounds)} onOpen={() => onOpen(match.id)} /></li>)}
          </ul>
        </section>
      ))}
    </div>
  )
}

// ── Inscripciones y sorteo ──────────────────────────────────────────
function Entries({ tournament, category, onSave, onGenerated }: { tournament: Tournament; category: TCategory; onSave: (next: TCategory) => void; onGenerated: () => void }) {
  const { notify } = useProto()
  const { people, byId } = usePeople()
  const action = useAction()
  const [picking, setPicking] = useState<null | { first?: string }>(null)
  const [drawing, setDrawing] = useState(false)
  const locked = category.matches.length > 0
  const canEnroll = !locked && tournament.status !== 'completed' && category.entries.length < MAX_ENTRIES
  const enrolled = new Set(category.entries.flatMap((entry) => entry.personIds))
  const size = bracketSize(Math.max(category.entries.length, 2))
  const byes = size - category.entries.length

  const add = (personIds: string[]) => void action.run(() => {
    const entry = entryFor(`${category.id}-e${Date.now()}`, people, personIds)
    onSave({ ...category, entries: [...category.entries, entry] })
    notify({ tone: 'success', title: 'Inscripción confirmada', body: `${entry.name} · ${category.name}` })
  }, 450)
  const remove = (entry: Entry) => void action.run(() => {
    onSave({ ...category, entries: category.entries.filter((item) => item.id !== entry.id) })
    notify({ tone: 'info', title: 'Inscripción quitada', body: entry.name })
  }, 350)
  const generate = () => void action.run(() => {
    const order = shuffle(category.entries.map((entry) => entry.id), Date.now())
    onSave({ ...category, matches: generateFixture(drawSlots(order), `${category.id}-${Date.now().toString(36)}`) })
    notify({ tone: 'success', title: 'Cuadro generado', body: `${category.name} · ${plural(byes, 'pase libre', 'pases libres')}` })
    setDrawing(false)
    onGenerated()
  }, 1200)

  return (
    <section className="stack" aria-label="Inscriptos">
      {!locked && (
        <div className="entries-bar">
          <div>
            <strong className="display num">{category.entries.length}<small>/{MAX_ENTRIES}</small></strong>
            <span>{category.entries.length >= MIN_ENTRIES ? `Cuadro de ${size}${byes ? ` · ${plural(byes, 'pase libre', 'pases libres')}` : ''}` : 'Mínimo 2 para sortear'}</span>
          </div>
          <Button variant="secondary" icon="userPlus" disabled={!canEnroll} onClick={() => setPicking({})}>{category.modality === 'doubles' ? 'Inscribir pareja' : 'Inscribir'}</Button>
          <Button variant="accent" icon="bracket" disabled={category.entries.length < MIN_ENTRIES} onClick={() => { action.reset(); setDrawing(true) }}>Sortear cuadro</Button>
        </div>
      )}
      {locked && <p className="inline-alert inline-alert-info"><Icon name="lock" size={20} /><span>El cuadro ya se sorteó: las inscripciones quedan cerradas para esta categoría.</span></p>}
      {category.entries.length === 0 ? <div className="card"><EmptyState icon="users" title="Sin inscriptos" body={category.modality === 'doubles' ? 'Inscribí parejas eligiendo dos fichas.' : 'Inscribí jugadores desde sus fichas o creá una rápida.'} /></div> : (
        <ol className="entry-list">
          {category.entries.map((entry, index) => (
            <li key={entry.id}>
              <span className="entry-n num">{index + 1}</span>
              <span className="entry-main"><strong>{entry.name}</strong><span>{entry.personIds.map((id) => byId(id)?.name).filter(Boolean).join(' y ')}</span></span>
              {!locked && <IconButton icon="x" size="sm" label={`Quitar a ${entry.name}`} disabled={action.saving} onClick={() => remove(entry)} />}
            </li>
          ))}
        </ol>
      )}
      {action.failed && !drawing && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardó el cambio</strong><p>Las inscripciones no cambiaron. Probá de nuevo.</p></div></div>}

      <PersonPicker
        open={picking !== null}
        title={category.modality === 'doubles' ? (picking?.first ? `Compañero/a de ${byId(picking.first)?.name}` : 'Primer integrante') : `Inscribir en ${category.name}`}
        allowCreate
        onClose={() => setPicking(null)}
        disabledReason={(person) => (enrolled.has(person.id) ? 'Ya está inscripto en esta categoría' : person.id === picking?.first ? 'Ya elegido' : undefined)}
        onPick={(id) => {
          if (category.modality === 'doubles' && !picking?.first) { setPicking({ first: id }); return }
          add(picking?.first ? [picking.first, id] : [id])
          setPicking(null)
        }}
      />
      <ConfirmDialog open={drawing} title={`Sortear cuadro · ${category.name}`} confirmLabel="Sortear y generar" tone="accent" icon="bracket" status={action.status} onConfirm={generate} onClose={() => setDrawing(false)} errorTitle="No se generó el cuadro" errorBody="No se creó ningún partido. Reintentar no lo duplica.">
        <div className="issue-summary">
          <div><span>Inscripciones</span><strong className="display num">{category.entries.length}</strong></div>
          <div><span>Cuadro</span><strong className="display num">{size}</strong></div>
          <div><span>Pases libres</span><strong className="display num">{byes}</strong></div>
          <div className="is-total"><span>Rondas</span><strong className="display">{Array.from({ length: roundCount(size) }, (_, index) => roundName(index + 1, roundCount(size))).join(' · ')}</strong></div>
        </div>
        <p className="muted">El orden se sortea al azar. Los pases libres avanzan solos. Después no se pueden sumar inscriptos ni cambiar el cuadro.</p>
      </ConfirmDialog>
    </section>
  )
}

// ── Partido: programar y cargar resultado ───────────────────────────
function MatchSheet({ tournament, category, match, onClose, onSave }: { tournament: Tournament; category: TCategory; match: Match | null; onClose: () => void; onSave: (next: TCategory) => void }) {
  if (!match) return null
  return <MatchSheetBody key={match.id + (match.winner ?? '') + (match.occupationId ?? '')} tournament={tournament} category={category} match={match} onClose={onClose} onSave={onSave} />
}

function MatchSheetBody({ tournament, category, match, onClose, onSave }: { tournament: Tournament; category: TCategory; match: Match; onClose: () => void; onSave: (next: TCategory) => void }) {
  const { state, dispatch } = useStore()
  const { notify } = useProto()
  const { go } = useAdmin()
  const { active: courts, name: courtName } = useCourts()
  const action = useAction()
  const rounds = roundsOf(category.matches)
  const status = matchState(match)
  const occupation = state.occupations.find((item) => item.id === match.occupationId)
  const a = entryLabel(category.entries, match.a)
  const b = entryLabel(category.entries, match.b)
  const editable = canRecord(category.matches, match)
  const next = nextMatch(category.matches, match)
  const [mode, setMode] = useState<'view' | 'schedule' | 'result'>('view')
  const [unscheduling, setUnscheduling] = useState(false)

  // Programación
  const [date, setDate] = useState(occupation?.date ?? (tournament.startsOn > TODAY ? tournament.startsOn : TODAY))
  const [start, setStart] = useState<Minutes>(occupation?.start ?? (tournament.startsOn > TODAY ? 18 * 60 : Math.max(18 * 60, Math.ceil(NOW / 30) * 30)))
  const [length, setLength] = useState(occupation ? occupation.end - occupation.start : 90)
  const [courtId, setCourtId] = useState(occupation?.courtId ?? courts[0]?.id ?? '')
  const end = Math.min(start + length, DAY_CLOSE)
  const clash = findConflict(state.occupations, { courtId, date, start, end }, occupation?.id)
  const past = date === TODAY && start < NOW

  // Resultado
  const initial = scoreBySide(match)
  const [winner, setWinner] = useState<Side | null>(match.winner ?? null)
  const [walkover, setWalkover] = useState(Boolean(match.walkover))
  const [sets, setSets] = useState<[string, string][]>(initial.a.length ? initial.a.map((games, index) => [games, initial.b[index] ?? '']) : [['', ''], ['', '']])
  const [touched, setTouched] = useState(false)
  const filled = sets.filter(([x, y]) => x !== '' || y !== '')
  const setsWon = filled.reduce((acc, [x, y]) => (Number(x) > Number(y) ? { ...acc, a: acc.a + 1 } : Number(y) > Number(x) ? { ...acc, b: acc.b + 1 } : acc), { a: 0, b: 0 })
  const resultError = !touched ? undefined
    : !winner ? 'Elegí quién ganó.'
      : walkover ? undefined
        : filled.length === 0 ? 'Cargá al menos un set o marcá W.O.'
          : filled.some(([x, y]) => x === '' || y === '' || x === y) ? 'Cada set necesita dos números distintos.'
            : setsWon[winner] <= setsWon[winner === 'a' ? 'b' : 'a'] ? 'El marcador no coincide con el ganador elegido.' : undefined

  const label = `${tournament.name.replace(/^Torneo /, '').replace(/ \d{4}$/, '')} · ${category.name.replace(' · Singles', '')} · ${roundName(match.round, rounds)}`
  const title = `${(a ?? '').replace(/^.\. /, '')} vs. ${(b ?? '').replace(/^.\. /, '')}`

  const schedule = () => {
    if (clash || past || !courtId) return
    void action.run(() => {
      const id = occupation?.id ?? `mt-${match.id}-${Date.now()}`
      const occ: Occupation = { id, courtId, date, start, end, kind: 'match', title, note: label, matchRef: { tournamentId: tournament.id, categoryId: category.id, matchId: match.id } }
      dispatch(occupation ? { type: 'occ/update', occupation: occ } : { type: 'occ/add', occupation: occ })
      onSave({ ...category, matches: category.matches.map((item) => (item.id === match.id ? { ...item, occupationId: id } : item)) })
      notify({ tone: 'success', title: occupation ? 'Partido reprogramado' : 'Partido programado', body: `${courtName(courtId)} · ${relativeDay(date, TODAY)} · ${range({ start, end })}` })
      setMode('view')
    })
  }
  const unschedule = () => void action.run(() => {
    if (occupation) dispatch({ type: 'occ/cancel', id: occupation.id })
    onSave({ ...category, matches: category.matches.map((item) => (item.id === match.id ? { ...item, occupationId: undefined } : item)) })
    notify({ tone: 'info', title: 'Partido sin cancha', body: 'La cancha quedó libre en la agenda.' })
    setUnscheduling(false)
  })
  const saveResult = () => {
    setTouched(true)
    if (!winner || resultError || (!walkover && (filled.length === 0 || filled.some(([x, y]) => x === '' || y === '' || x === y) || setsWon[winner] <= setsWon[winner === 'a' ? 'b' : 'a']))) return
    const score = walkover ? undefined : filled.map(([x, y]) => (winner === 'a' ? `${x}-${y}` : `${y}-${x}`)).join(' ')
    void action.run(() => {
      const matches = recordResult(category.matches, match.id, winner, score, walkover)
      onSave({ ...category, matches })
      const name = entryLabel(category.entries, match[winner])
      const isFinal = match.round === rounds
      notify({ tone: 'success', title: isFinal ? `¡${name} ${category.modality === 'doubles' ? 'son campeones' : 'es campeón/a'}!` : 'Resultado cargado', body: isFinal ? category.name : `${name} pasa a ${roundName(match.round + 1, rounds)}` })
      setMode('view')
    })
  }

  return (
    <>
      <Modal open={!unscheduling} onClose={onClose} busy={action.saving} variant="drawer" size="md" eyebrow={`${category.name} · ${roundName(match.round, rounds)}`} title={status === 'done' ? 'Resultado' : status === 'waiting' ? 'Partido a definir' : 'Partido'}>
        <div className="detail">
          <div className="versus">
            {(['a', 'b'] as const).map((side) => {
              const name = side === 'a' ? a : b
              const chosen = mode === 'result' ? winner === side : match.winner === side
              return (
                <button key={side} type="button" className={`versus-side ${chosen ? 'is-winner' : ''} ${mode === 'result' ? 'is-pickable' : ''}`} disabled={mode !== 'result' || !name} aria-pressed={mode === 'result' ? winner === side : undefined} onClick={() => setWinner(side)}>
                  <span className="versus-name display">{name ?? 'A definir'}</span>
                  {chosen && <span className="versus-tag"><Icon name="trophy" size={14} />Ganador</span>}
                  {mode === 'result' && !chosen && name && <span className="versus-hint">Tocá si ganó</span>}
                </button>
              )
            })}
            <span className="versus-vs" aria-hidden="true">vs</span>
          </div>

          {mode === 'view' && (
            <>
              {status === 'done' && (
                <div className="score-board" aria-label="Marcador">
                  {match.walkover ? <p className="score-wo">Ganó por W.O. (no se presentó el rival)</p> : (
                    <table>
                      <thead><tr><th scope="col"><span className="visually-hidden">Jugador</span></th>{scoreBySide(match).a.map((_, index) => <th key={index} scope="col">Set {index + 1}</th>)}</tr></thead>
                      <tbody>
                        {(['a', 'b'] as const).map((side) => <tr key={side} className={match.winner === side ? 'is-winner' : ''}><th scope="row">{side === 'a' ? a : b}</th>{scoreBySide(match)[side].map((games, index) => <td key={index} className="num">{games}</td>)}</tr>)}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
              {status === 'waiting' && <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span>Se completa cuando se definan los partidos de la ronda anterior.</span></p>}

              {status !== 'waiting' && status !== 'bye' && (
                <section className="detail-section" aria-labelledby="ms-when">
                  <h3 id="ms-when" className="detail-section-title">Cancha y horario</h3>
                  {occupation ? (
                    <div className="when-card occ-match">
                      <span className="detail-time num">{range(occupation)}</span>
                      <span>{courtName(occupation.courtId)} · {capitalize(dayLong(occupation.date))}{occupation.date === TODAY && occupation.start <= NOW && NOW < occupation.end ? ' · en juego' : ''}</span>
                    </div>
                  ) : <p className="muted">{status === 'done' ? 'Se jugó sin cancha registrada en la agenda.' : 'Todavía no tiene cancha asignada.'}</p>}
                  {status !== 'done' && (
                    <div className="detail-actions">
                      <Button variant={occupation ? 'secondary' : 'primary'} icon="calendar" onClick={() => setMode('schedule')}>{occupation ? 'Reprogramar' : 'Programar en la agenda'}</Button>
                      {occupation && <Button variant="ghost" icon="x" onClick={() => { action.reset(); setUnscheduling(true) }}>Quitar de la agenda</Button>}
                    </div>
                  )}
                  {occupation && <button type="button" className="link-btn link-btn-icon" onClick={() => { onClose(); go('/admin/reservas') }}><Icon name="calendar" size={18} />Ver en la agenda de canchas</button>}
                </section>
              )}

              {editable && (
                <div className="sheet-cta">
                  <Button variant="accent" size="lg" block icon={status === 'done' ? 'edit' : 'trophy'} onClick={() => { setTouched(false); setMode('result') }}>{status === 'done' ? 'Corregir resultado' : 'Cargar resultado'}</Button>
                </div>
              )}
              {status === 'done' && !editable && next && <p className="detail-footnote"><Icon name="lock" size={16} />El partido siguiente ya tiene resultado: este marcador no se puede corregir.</p>}
            </>
          )}

          {mode === 'schedule' && (
            <section className="res-form" aria-label="Programar partido">
              <fieldset className="form-block">
                <legend className="form-legend">Cancha</legend>
                <CourtPicker courts={courts} value={courtId} onChange={setCourtId} isBusy={(id) => Boolean(findConflict(state.occupations, { courtId: id, date, start, end }, occupation?.id))} />
              </fieldset>
              <div className="form-row">
                <Field label="Fecha">{(id) => <TextInput id={id} type="date" value={date} min={TODAY} onChange={(event) => event.target.value && setDate(event.target.value)} />}</Field>
                <Field label="Hora">{(id) => <SelectInput id={id} value={start} onChange={(event) => setStart(Number(event.target.value))}>{slots(8 * 60, DAY_CLOSE - 30).map((slot) => <option key={slot} value={slot}>{hhmm(slot)}</option>)}</SelectInput>}</Field>
              </div>
              <div className="chip-row">{[60, 90, 120].map((minutes) => <Chip key={minutes} selected={length === minutes} onClick={() => setLength(minutes)}>{duration(minutes)}</Chip>)}</div>
              {(date < tournament.startsOn || date > tournament.endsOn) && <p className="inline-alert inline-alert-warning"><Icon name="alert" size={20} /><span>La fecha queda fuera del torneo ({rangeLabel(tournament)}).</span></p>}
              {past && <p className="inline-alert inline-alert-warning" role="status"><Icon name="clock" size={20} /><span>Ese horario ya pasó. Elegí uno posterior a las {hhmm(NOW)}.</span></p>}
              {clash && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>{courtName(courtId)} está ocupada</strong><p>{clash.title} · {range(clash)}. Elegí otra cancha u horario.</p></div></div>}
              {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se programó</strong><p>La agenda no cambió. Reintentá.</p></div></div>}
              <div className="form-actions">
                <Button variant="ghost" onClick={() => setMode('view')} disabled={action.saving}>Volver</Button>
                <Button variant="accent" icon={action.failed ? 'refresh' : 'check'} loading={action.saving} disabled={Boolean(clash) || past} onClick={schedule}>{action.failed ? 'Reintentar' : 'Confirmar cancha'}</Button>
              </div>
            </section>
          )}

          {mode === 'result' && (
            <section className="res-form" aria-label="Cargar resultado">
              <Switch checked={walkover} onChange={setWalkover} label="Ganó por W.O." description="El rival no se presentó. No hace falta marcador." />
              {!walkover && (
                <fieldset className="form-block">
                  <legend className="form-legend">Marcador por set</legend>
                  <div className="set-grid">
                    <span />
                    <span className="set-grid-name">{a}</span>
                    <span className="set-grid-name">{b}</span>
                    {sets.map((set, index) => (
                      <SetRow key={index} index={index} value={set} onChange={(value) => setSets(sets.map((item, i) => (i === index ? value : item)))} />
                    ))}
                  </div>
                  <div className="chip-row">
                    {sets.length < 3 && <Chip icon="plus" onClick={() => setSets([...sets, ['', '']])}>Tercer set</Chip>}
                    {sets.length > 1 && <Chip icon="minus" onClick={() => setSets(sets.slice(0, -1))}>Quitar set</Chip>}
                  </div>
                  <p className="field-hint">En el tercer set podés cargar el super tie-break (por ejemplo 10-7).</p>
                </fieldset>
              )}
              {resultError && <p className="field-error" role="alert"><Icon name="alert" size={14} />{resultError}</p>}
              {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardó el resultado</strong><p>El cuadro no cambió. Reintentar no duplica el avance.</p></div></div>}
              <div className="form-actions">
                <Button variant="ghost" onClick={() => setMode('view')} disabled={action.saving}>Volver</Button>
                <Button variant="accent" size="lg" icon={action.failed ? 'refresh' : 'check'} loading={action.saving} onClick={saveResult}>{action.failed ? 'Reintentar' : 'Guardar resultado'}</Button>
              </div>
            </section>
          )}
        </div>
      </Modal>
      <ConfirmDialog open={unscheduling} title="¿Quitar el partido de la agenda?" confirmLabel="Quitar de la agenda" icon="x" status={action.status} onConfirm={unschedule} onClose={() => setUnscheduling(false)}>
        <p className="muted">La cancha queda libre. El partido sigue en el cuadro como «Por programar».</p>
      </ConfirmDialog>
    </>
  )
}

function SetRow({ index, value, onChange }: { index: number; value: [string, string]; onChange: (value: [string, string]) => void }) {
  const clean = (text: string) => text.replace(/\D/g, '').slice(0, 2)
  return (
    <>
      <span className="set-grid-label">Set {index + 1}</span>
      <input className="input set-input num" inputMode="numeric" aria-label={`Set ${index + 1}, games del primero`} value={value[0]} onChange={(event) => onChange([clean(event.target.value), value[1]])} />
      <input className="input set-input num" inputMode="numeric" aria-label={`Set ${index + 1}, games del segundo`} value={value[1]} onChange={(event) => onChange([value[0], clean(event.target.value)])} />
    </>
  )
}

// ── Formularios de torneo y categoría ───────────────────────────────
function TournamentForm({ open, editing, onClose, onSaved }: { open: boolean; editing?: Tournament; onClose: () => void; onSaved: (id: string) => void }) {
  return <Modal open={open} onClose={onClose} variant="drawer" size="sm" eyebrow={editing ? 'Editar torneo' : 'Torneos'} title={editing ? editing.name : 'Nuevo torneo'}>{open && <TournamentFormBody editing={editing} onClose={onClose} onSaved={onSaved} />}</Modal>
}

function TournamentFormBody({ editing, onClose, onSaved }: { editing?: Tournament; onClose: () => void; onSaved: (id: string) => void }) {
  const { dispatch } = useStore()
  const { notify } = useProto()
  const action = useAction()
  const [name, setName] = useState(editing?.name ?? '')
  const [startsOn, setStartsOn] = useState(editing?.startsOn ?? addDays(TODAY, 14))
  const [endsOn, setEndsOn] = useState(editing?.endsOn ?? addDays(TODAY, 21))
  const [description, setDescription] = useState(editing?.description ?? '')
  const [touched, setTouched] = useState(false)
  const nameError = touched && name.trim().length < 3 ? 'Poné un nombre para identificarlo.' : undefined
  const dateError = touched && endsOn < startsOn ? 'La fecha de cierre no puede ser anterior al inicio.' : undefined
  const submit = (status: TournamentStatus) => {
    setTouched(true)
    if (name.trim().length < 3 || endsOn < startsOn) return
    const id = editing?.id ?? `t-new-${Date.now()}`
    void action.run(() => {
      dispatch({ type: 'tournament/save', tournament: { ...(editing ?? { id, categories: [], status }), name: name.trim(), startsOn, endsOn, description: description.trim() || undefined } as Tournament })
      notify({ tone: 'success', title: editing ? 'Torneo actualizado' : status === 'draft' ? 'Borrador creado' : 'Torneo creado con inscripción abierta', body: name.trim() })
      onSaved(id)
    })
  }
  return (
    <div className="res-form">
      <Field label="Nombre" error={nameError}>{(id, describedBy) => <TextInput id={id} value={name} placeholder="Ej.: Torneo de Verano 2027" aria-invalid={Boolean(nameError)} aria-describedby={describedBy} onChange={(event) => setName(event.target.value)} data-autofocus />}</Field>
      <div className="form-row">
        <Field label="Empieza">{(id) => <TextInput id={id} type="date" value={startsOn} onChange={(event) => event.target.value && setStartsOn(event.target.value)} />}</Field>
        <Field label="Termina" error={dateError}>{(id, describedBy) => <TextInput id={id} type="date" value={endsOn} min={startsOn} aria-describedby={describedBy} onChange={(event) => event.target.value && setEndsOn(event.target.value)} />}</Field>
      </div>
      <Field label="Descripción" optional>{(id) => <TextArea id={id} rows={2} value={description} placeholder="Formato, premios, a quién está dirigido" onChange={(event) => setDescription(event.target.value)} />}</Field>
      {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardó</strong><p>Reintentá en un momento.</p></div></div>}
      <div className="form-actions">
        <Button variant="ghost" onClick={onClose} disabled={action.saving}>Cancelar</Button>
        {editing ? <Button variant="primary" icon="check" loading={action.saving} onClick={() => submit(editing.status)}>Guardar</Button> : (
          <>
            <Button variant="secondary" onClick={() => submit('draft')} disabled={action.saving}>Guardar borrador</Button>
            <Button variant="accent" icon="send" loading={action.saving} onClick={() => submit('registration')}>Crear y abrir inscripción</Button>
          </>
        )}
      </div>
    </div>
  )
}

const CATEGORY_PRESETS = ['Caballeros A', 'Caballeros B', 'Damas A', 'Damas B', 'Menores', 'Dobles mixto']

function CategoryForm({ open, tournament, onClose, onCreated }: { open: boolean; tournament: Tournament; onClose: () => void; onCreated: (id: string) => void }) {
  const { dispatch } = useStore()
  const { notify } = useProto()
  const action = useAction()
  const [name, setName] = useState('')
  const [modality, setModality] = useState<'singles' | 'doubles'>('singles')
  const [touched, setTouched] = useState(false)
  const full = modality === 'singles' && !/dobles/i.test(name) ? `${name.trim()} · Singles` : name.trim()
  const duplicate = tournament.categories.some((category) => category.name.toLowerCase() === full.toLowerCase())
  const close = () => { setName(''); setTouched(false); action.reset(); onClose() }
  const submit = () => {
    setTouched(true)
    if (name.trim().length < 2 || duplicate) return
    const id = `cat-${Date.now()}`
    void action.run(() => {
      dispatch({ type: 'tournament/save', tournament: { ...tournament, categories: [...tournament.categories, { id, name: full, modality, entries: [], matches: [] }] } })
      notify({ tone: 'success', title: 'Categoría agregada', body: full })
      setName('')
      onCreated(id)
    })
  }
  return (
    <Modal open={open} onClose={close} size="sm" title="Nueva categoría" footer={<div className="form-actions"><Button variant="ghost" onClick={close} disabled={action.saving}>Cancelar</Button><Button variant="primary" icon={action.failed ? 'refresh' : 'check'} loading={action.saving} onClick={submit}>{action.failed ? 'Reintentar' : 'Agregar'}</Button></div>}>
      <div className="res-form">
        <SegmentedTabs label="Modalidad" stretch value={modality} onChange={setModality} items={[{ id: 'singles', label: 'Singles', icon: 'user' }, { id: 'doubles', label: 'Dobles', icon: 'users' }]} />
        <Field label="Nombre" error={touched && name.trim().length < 2 ? 'Escribí el nombre de la categoría.' : touched && duplicate ? 'Ya existe esa categoría en el torneo.' : undefined}>{(id, describedBy) => <TextInput id={id} value={name} aria-describedby={describedBy} onChange={(event) => setName(event.target.value)} placeholder="Ej.: Caballeros B" data-autofocus />}</Field>
        <div className="chip-row">{CATEGORY_PRESETS.map((preset) => <Chip key={preset} selected={name === preset} onClick={() => { setName(preset); if (/dobles/i.test(preset)) setModality('doubles') }}>{preset}</Chip>)}</div>
      </div>
    </Modal>
  )
}
