import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club, Court, Tournament, TournamentCategory, TournamentEntry, TournamentMatch, TournamentStatus } from '../../types/domain'
import { isoToDateAndTime, shiftCalendarDate, todayInTimezone, zonedDateTimeToIso } from '../reservations/reservationUtils'
import { courtShort } from '../reservations/occupationView'
import { courtBusyIn, useDayOccupations } from '../reservations/useDayOccupations'
import { createQuickPerson, usePersonSearch } from '../people/usePersonSearch'
import { bracketSize, buildBracketMatches, matchState, roundsOf } from './tournamentUtils'
import { Badge, Button, Chip, ConfirmDialog, EmptyState, ErrorState, Field, Icon, IconButton, Modal, PageHead, SegmentedTabs, SelectInput, SkeletonCards, Switch, TextArea, TextInput, type Tone } from '../../design/ui'
import { CourtPicker, PersonPicker, type PickerItem } from '../../design/domain'
import { Bracket, MatchCard } from '../../design/bracket'
import { roundName, scoreBySide, type BracketMatch } from '../../design/bracketUtils'
import { capitalize, dateShort, dayLong, durationLabel, fromMinutes, toMinutes, weekdayShort } from '../../design/dates'
import { plural } from '../../design/format'
import { useAsyncAction } from '../../design/useAsyncAction'

type Props = { client: SupabaseClient; club: Club; courts: Court[]; canManage: boolean; requestedReservationId?: string | null; onRequestedReservationHandled?: () => void }
type Occupation = { id: string; court_id: string; starts_at: string; ends_at: string }
type Notice = { tone: 'success' | 'danger'; text: string }
type CatTab = 'bracket' | 'matches' | 'entries'
type CategoryPhase = 'open' | 'fixture' | 'completed'
type LiveInfo = { played: number; total: number; today: { match: TournamentMatch; when: string; live: boolean }[] }

const matchFields = 'id, club_id, tournament_id, category_id, round_number, position, entry_one_id, entry_two_id, winner_entry_id, reservation_id, status, score_text, is_walkover, finished_at'
const STATUS_LABEL: Record<TournamentStatus, string> = { draft: 'Borrador', registration_open: 'Inscripción abierta', in_progress: 'En juego', completed: 'Finalizado', cancelled: 'Cancelado' }
const STATUS_TONE: Record<TournamentStatus, Tone> = { draft: 'neutral', registration_open: 'info', in_progress: 'clay', completed: 'success', cancelled: 'neutral' }
const SLOTS = Array.from({ length: 32 }, (_, index) => fromMinutes(8 * 60 + index * 30)).filter((slot) => slot < '23:00')
const rpcError = (error: { message?: string } | null) => error?.message ?? 'No pudimos completar la operación. Intentá nuevamente.'
const rangeLabel = (tournament: Tournament) => `${dateShort(tournament.starts_on)} al ${dateShort(tournament.ends_on)}`
const phaseOf = (category: TournamentCategory): CategoryPhase => (category.status === 'completed' ? 'completed' : category.status === 'fixture_generated' ? 'fixture' : 'open')

export function TournamentPanel({ client, club, courts, canManage, requestedReservationId, onRequestedReservationHandled }: Props) {
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [categories, setCategories] = useState<TournamentCategory[]>([])
  const [entries, setEntries] = useState<TournamentEntry[]>([])
  const [matches, setMatches] = useState<TournamentMatch[]>([])
  const [enrolledIds, setEnrolledIds] = useState<Set<string>>(new Set())
  const [reservations, setReservations] = useState<Map<string, Occupation>>(new Map())
  const [live, setLive] = useState<Map<string, LiveInfo>>(new Map())
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [tab, setTab] = useState<CatTab>('bracket')
  const [matchId, setMatchId] = useState<string | null>(null)
  const [filter, setFilter] = useState<TournamentStatus | 'all'>('all')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Tournament | null>(null)
  const [newCategory, setNewCategory] = useState(false)
  const [opening, setOpening] = useState<'open' | 'draft' | null>(null)
  const statusAction = useAsyncAction()
  const today = todayInTimezone(club.timezone)

  const loadLive = async (liveIds: string[]) => {
    if (liveIds.length === 0) { setLive(new Map()); return }
    const { data, error } = await client.from('tournament_matches').select(matchFields).eq('club_id', club.id).in('tournament_id', liveIds).limit(1000)
    if (error) return
    const rows = (data ?? []) as TournamentMatch[]
    const reservationIds = rows.map((row) => row.reservation_id).filter((id): id is string => Boolean(id))
    const start = zonedDateTimeToIso(today, '00:00', club.timezone)
    const end = zonedDateTimeToIso(shiftCalendarDate(today, 1), '00:00', club.timezone)
    const { data: todayRows } = reservationIds.length ? await client.from('reservations').select('id, court_id, starts_at, ends_at').in('id', reservationIds).eq('status', 'active').gte('starts_at', start).lt('starts_at', end) : { data: [] }
    const now = Date.now()
    const todayById = new Map(((todayRows ?? []) as Occupation[]).map((row) => [row.id, row]))
    setLive(new Map(liveIds.map((id) => {
      const mine = rows.filter((row) => row.tournament_id === id)
      const todays = mine.filter((row) => row.status !== 'completed' && row.reservation_id && todayById.has(row.reservation_id)).map((row) => {
        const occupation = todayById.get(row.reservation_id as string) as Occupation
        const time = isoToDateAndTime(occupation.starts_at, club.timezone).time
        return { match: row, when: `${time} · ${courts.find((court) => court.id === occupation.court_id)?.name ?? 'Cancha'}`, live: new Date(occupation.starts_at).getTime() <= now && now < new Date(occupation.ends_at).getTime() }
      }).sort((a, b) => a.when.localeCompare(b.when))
      return [id, { played: mine.filter((row) => row.status === 'completed').length, total: mine.length, today: todays }]
    })))
  }
  const reload = async () => {
    const [tournamentResult, categoryResult, entryResult] = await Promise.all([
      client.from('tournaments').select('id, club_id, name, description, starts_on, ends_on, status, created_at').eq('club_id', club.id).order('starts_on', { ascending: false }),
      client.from('tournament_categories').select('id, club_id, tournament_id, name, modality, status, champion_entry_id').eq('club_id', club.id),
      client.from('tournament_entries').select('id, club_id, category_id, display_name, draw_position').eq('club_id', club.id).limit(1000),
    ])
    if (tournamentResult.error || categoryResult.error || entryResult.error) { setStatus('error'); return }
    const nextTournaments = (tournamentResult.data ?? []) as Tournament[]
    setTournaments(nextTournaments); setCategories((categoryResult.data ?? []) as TournamentCategory[]); setEntries((entryResult.data ?? []) as TournamentEntry[])
    setOpenId((current) => (current && nextTournaments.some((item) => item.id === current) ? current : null))
    setStatus('ready')
    void loadLive(nextTournaments.filter((item) => item.status === 'in_progress').map((item) => item.id))
  }
  useEffect(() => { void reload() }, [club.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = tournaments.find((item) => item.id === openId) ?? null
  const openCategories = categories.filter((item) => item.tournament_id === openId)
  const category = openCategories.find((item) => item.id === categoryId) ?? openCategories[0] ?? null

  const loadCategory = async (target: TournamentCategory | null) => {
    if (!target) { setMatches([]); setEnrolledIds(new Set()); setReservations(new Map()); return }
    const [matchResult, memberResult] = await Promise.all([
      client.from('tournament_matches').select(matchFields).eq('category_id', target.id).order('round_number').order('position'),
      client.from('tournament_entry_members').select('person_id').eq('category_id', target.id),
    ])
    if (matchResult.error) { setNotice({ tone: 'danger', text: 'No pudimos cargar el fixture de la categoría.' }); return }
    const rows = (matchResult.data ?? []) as TournamentMatch[]
    const reservationIds = rows.map((row) => row.reservation_id).filter((id): id is string => Boolean(id))
    const { data: occupationRows } = reservationIds.length ? await client.from('reservations').select('id, court_id, starts_at, ends_at').in('id', reservationIds) : { data: [] }
    setMatches(rows)
    setEnrolledIds(new Set(((memberResult.data ?? []) as { person_id: string }[]).map((row) => row.person_id)))
    setReservations(new Map(((occupationRows ?? []) as Occupation[]).map((row) => [row.id, row])))
  }
  useEffect(() => { void loadCategory(category) }, [category?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!requestedReservationId) return
    let cancelled = false
    const openRequestedMatch = async () => {
      const { data, error } = await client.from('tournament_matches').select('id, tournament_id, category_id').eq('reservation_id', requestedReservationId).maybeSingle()
      if (cancelled) return
      if (error || !data) { setNotice({ tone: 'danger', text: 'No pudimos abrir el partido de torneo seleccionado.' }); onRequestedReservationHandled?.(); return }
      setOpenId(data.tournament_id as string); setCategoryId(data.category_id as string); setTab('bracket'); setMatchId(data.id as string)
      onRequestedReservationHandled?.()
    }
    void openRequestedMatch()
    return () => { cancelled = true }
  }, [client, requestedReservationId, onRequestedReservationHandled])

  const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries])
  const nameOf = (id: string | null) => (id ? entriesById.get(id)?.display_name ?? null : null)
  const categoryEntries = entries.filter((entry) => entry.category_id === category?.id)
  const whenOf = (match: TournamentMatch): BracketMatch['when'] => {
    const occupation = match.reservation_id ? reservations.get(match.reservation_id) : undefined
    if (!occupation) return undefined
    const start = isoToDateAndTime(occupation.starts_at, club.timezone)
    const now = Date.now()
    const day = start.date === today ? 'Hoy' : `${capitalize(weekdayShort(start.date))} ${dateShort(start.date)}`
    return { date: start.date, text: `${day} · ${start.time} · ${courts.find((court) => court.id === occupation.court_id)?.name ?? 'Cancha'}`, live: new Date(occupation.starts_at).getTime() <= now && now < new Date(occupation.ends_at).getTime() }
  }
  const bracket = useMemo(() => buildBracketMatches(matches, nameOf, whenOf), [matches, entriesById, reservations, courts, club.timezone]) // eslint-disable-line react-hooks/exhaustive-deps
  const rounds = roundsOf(matches)
  const sheetMatch = matches.find((item) => item.id === matchId) ?? null

  const afterChange = async (text: string, reloadAll = false) => {
    setNotice({ tone: 'success', text })
    if (reloadAll) await reload()
    await loadCategory(category)
  }
  const changeStatus = async (next: TournamentStatus) => {
    if (!open) return
    await statusAction.run(async () => {
      const { error } = await client.rpc('update_tournament', { p_tournament_id: open.id, p_name: open.name, p_description: open.description, p_starts_on: open.starts_on, p_ends_on: open.ends_on, p_status: next })
      if (error) return rpcError(error)
      setOpening(null)
      setNotice({ tone: 'success', text: next === 'registration_open' ? 'Inscripción abierta.' : 'El torneo volvió a borrador.' })
      await reload()
      return null
    })
  }
  const pickCategory = (id: string) => { setCategoryId(id); const next = openCategories.find((item) => item.id === id); setTab(next && next.status !== 'open' ? 'bracket' : 'entries') }
  const openTournament = (id: string) => { setOpenId(id); setCategoryId(null); setMatchId(null); const first = categories.find((item) => item.tournament_id === id); setTab(first && first.status !== 'open' ? 'bracket' : 'entries') }

  const champion = category?.champion_entry_id ? nameOf(category.champion_entry_id) : null
  const finalMatch = matches.find((match) => match.round_number === rounds && match.status === 'completed')

  const noticeBlock = notice && <p className={`inline-alert ${notice.tone === 'danger' ? 'inline-alert-danger' : 'inline-alert-success'}`} role={notice.tone === 'danger' ? 'alert' : 'status'}><Icon name={notice.tone === 'danger' ? 'alert' : 'checkCircle'} size={20} /><span>{notice.text}</span></p>

  if (status === 'error') return <div className="module"><PageHead eyebrow="Club" title="Torneos" /><ErrorState title="No pudimos cargar los torneos" body="Revisá la conexión e intentá de nuevo. Confirmá también que la migración de torneos esté aplicada." onRetry={() => { setStatus('loading'); void reload() }} /></div>

  if (open) {
    return (
      <div className="module">
        <button type="button" className="back-link" onClick={() => { setOpenId(null); setMatchId(null) }}><Icon name="chevronLeft" size={18} />Torneos</button>
        <header className={`tour-hero texture-court is-${open.status}`}>
          <div className="tour-hero-main">
            <Badge tone={open.status === 'in_progress' ? 'accent' : 'dark'} dot>{STATUS_LABEL[open.status]}</Badge>
            <h2 className="display">{open.name}</h2>
            <p>{capitalize(dayLong(open.starts_on))} al {dayLong(open.ends_on)}</p>
            {open.description && <p className="tour-hero-desc">{open.description}</p>}
          </div>
          {canManage && (
            <div className="tour-hero-actions">
              {open.status === 'draft' && <Button variant="accent" icon="send" onClick={() => { statusAction.reset(); setOpening('open') }}>Abrir inscripción</Button>}
              {open.status === 'registration_open' && <Button variant="on-dark" icon="undo" onClick={() => { statusAction.reset(); setOpening('draft') }}>Volver a borrador</Button>}
              <Button variant="on-dark" icon="edit" onClick={() => setEditing(open)}>Editar datos</Button>
            </div>
          )}
        </header>
        {noticeBlock}

        <div className="cat-bar">
          <div className="chip-row chip-row-scroll" role="tablist" aria-label="Categorías">
            {openCategories.map((item) => {
              const phase = phaseOf(item)
              const count = entries.filter((entry) => entry.category_id === item.id).length
              return (
                <button key={item.id} type="button" role="tab" aria-selected={item.id === category?.id} className={`cat-chip ${item.id === category?.id ? 'is-selected' : ''}`} onClick={() => pickCategory(item.id)}>
                  <span className={`cat-dot is-${phase}`} aria-hidden="true" />
                  <span>{item.name}</span>
                  <small>{phase === 'open' ? `${count} insc.` : phase === 'completed' ? 'Final' : 'Cuadro'}</small>
                </button>
              )
            })}
            {canManage && open.status !== 'completed' && open.status !== 'cancelled' && <button type="button" className="cat-chip cat-chip-add" onClick={() => setNewCategory(true)}><Icon name="plus" size={16} />Categoría</button>}
          </div>
        </div>

        {!category ? (
          <div className="card"><EmptyState icon="trophy" title={canManage ? 'Agregá la primera categoría' : 'Todavía no hay categorías'} body="Cada categoría tiene su propio cuadro, singles o dobles." action={canManage ? <Button variant="accent" icon="plus" onClick={() => setNewCategory(true)}>Nueva categoría</Button> : undefined} /></div>
        ) : (
          <>
            {champion && finalMatch && (
              <section className="champion-banner" aria-label="Campeón">
                <span className="champion-icon"><Icon name="trophy" size={34} /></span>
                <div>
                  <p className="kicker">{category.modality === 'doubles' ? 'Campeones' : 'Campeón'} · {category.name}</p>
                  <p className="champion-name display">{champion}</p>
                  <p className="champion-final">Final vs. {nameOf(finalMatch.winner_entry_id === finalMatch.entry_one_id ? finalMatch.entry_two_id : finalMatch.entry_one_id) ?? 'rival'} · <span className="num">{finalMatch.is_walkover ? 'W.O.' : finalMatch.score_text ?? 'sin marcador'}</span></p>
                </div>
              </section>
            )}
            <div className="cat-head">
              <p className="muted">{category.modality === 'doubles' ? 'Dobles' : 'Singles'} · {plural(categoryEntries.length, 'inscripción', 'inscripciones')}{matches.length ? ` · ${plural(matches.filter((item) => item.status === 'completed').length, 'partido jugado', 'partidos jugados')}` : ' · inscripción abierta'}</p>
              <SegmentedTabs label="Vista de la categoría" size="sm" value={tab} onChange={setTab} items={[
                { id: 'bracket', label: 'Cuadro', icon: 'bracket' },
                { id: 'matches', label: 'Partidos', icon: 'list' },
                { id: 'entries', label: 'Inscriptos', icon: 'users', count: matches.length ? undefined : categoryEntries.length },
              ]} />
            </div>

            {tab === 'bracket' && (matches.length ? <Bracket matches={bracket} onOpen={(item) => setMatchId(item.id)} /> : (
              <div className="card"><EmptyState icon="bracket" title="El cuadro todavía no se generó" body={categoryEntries.length >= 2 ? 'Cuando cierres la inscripción, sorteá el cuadro desde Inscriptos.' : 'Hacen falta al menos 2 inscripciones.'} action={<Button variant="secondary" icon="users" onClick={() => setTab('entries')}>Ver inscriptos</Button>} /></div>
            ))}
            {tab === 'matches' && <MatchList bracket={bracket} rounds={rounds} today={today} onOpen={setMatchId} />}
            {tab === 'entries' && <Entries client={client} club={club} tournament={open} category={category} entries={categoryEntries} enrolledIds={enrolledIds} locked={matches.length > 0} canManage={canManage} onChanged={afterChange} onGenerated={() => setTab('bracket')} />}
          </>
        )}

        {sheetMatch && category && <MatchSheet key={`${sheetMatch.id}-${sheetMatch.status}-${sheetMatch.reservation_id ?? ''}`} client={client} club={club} courts={courts} tournament={open} category={category} match={sheetMatch} rounds={rounds} nameOf={nameOf} occupation={sheetMatch.reservation_id ? reservations.get(sheetMatch.reservation_id) : undefined} today={today} nextMatch={matches.find((item) => item.round_number === sheetMatch.round_number + 1 && item.position === Math.ceil(sheetMatch.position / 2))} onClose={() => setMatchId(null)} onChanged={(text) => afterChange(text, true)} />}
        {editing && <TournamentForm client={client} club={club} editing={editing} today={today} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); setNotice({ tone: 'success', text: 'Torneo actualizado.' }); await reload() }} />}
        {newCategory && <CategoryForm client={client} tournament={open} existing={openCategories} onClose={() => setNewCategory(false)} onCreated={async () => { setNewCategory(false); setNotice({ tone: 'success', text: 'Categoría agregada.' }); await reload() }} />}
        <ConfirmDialog open={opening !== null} title={opening === 'open' ? '¿Abrir la inscripción?' : '¿Volver a borrador?'} confirmLabel={opening === 'open' ? 'Abrir inscripción' : 'Volver a borrador'} tone={opening === 'open' ? 'accent' : 'primary'} icon={opening === 'open' ? 'send' : 'undo'} status={statusAction.status} errorBody={statusAction.message ?? undefined} onConfirm={() => void changeStatus(opening === 'open' ? 'registration_open' : 'draft')} onClose={() => setOpening(null)}>
          <p className="muted">{opening === 'open' ? 'El torneo pasa a «Inscripción abierta»: ya se pueden sumar inscriptos y sortear cuadros.' : 'El torneo deja de aceptar inscripciones y sorteos hasta que lo vuelvas a abrir.'}</p>
        </ConfirmDialog>
      </div>
    )
  }

  const liveTournaments = tournaments.filter((item) => item.status === 'in_progress')
  const rest = tournaments.filter((item) => item.status !== 'in_progress' && (filter === 'all' || item.status === filter))
  const count = (value: TournamentStatus) => tournaments.filter((item) => item.status === value).length
  return (
    <div className="module">
      <PageHead eyebrow="Club" title="Torneos" meta={`${plural(tournaments.length, 'torneo', 'torneos')} · ${liveTournaments.length} en juego`} actions={canManage ? <Button variant="accent" icon="plus" onClick={() => setCreating(true)}>Nuevo torneo</Button> : undefined} />
      {noticeBlock}
      {status === 'loading' ? <SkeletonCards count={3} height={150} />
        : tournaments.length === 0 ? (
          <div className="card"><EmptyState icon="trophy" title="Todavía no hay torneos" body={canManage ? 'Creá uno, sumá categorías e inscriptos y generá el cuadro cuando cierre la inscripción.' : 'Cuando se cree el primero, lo vas a ver acá.'} action={canManage ? <Button variant="accent" icon="plus" onClick={() => setCreating(true)}>Nuevo torneo</Button> : undefined} /></div>
        ) : (
          <>
            {liveTournaments.map((item) => <LiveTournament key={item.id} tournament={item} categories={categories.filter((cat) => cat.tournament_id === item.id)} entries={entries} info={live.get(item.id)} nameOf={nameOf} onOpen={() => openTournament(item.id)} />)}
            <div className="chip-row chip-row-scroll" role="group" aria-label="Filtrar torneos">
              <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>Todos</Chip>
              {(['registration_open', 'draft', 'completed', 'cancelled'] as const).map((value) => count(value) > 0 && <Chip key={value} selected={filter === value} count={count(value)} onClick={() => setFilter(value)}>{STATUS_LABEL[value]}</Chip>)}
            </div>
            <ul className="tour-grid">
              {rest.map((item) => <li key={item.id}><TournamentCard tournament={item} categories={categories.filter((cat) => cat.tournament_id === item.id)} entries={entries} nameOf={nameOf} onOpen={() => openTournament(item.id)} /></li>)}
            </ul>
          </>
        )}
      {creating && <TournamentForm client={client} club={club} today={today} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); setNotice({ tone: 'success', text: 'Torneo creado en borrador. Abrí las inscripciones cuando estés listo.' }); await reload() }} />}
    </div>
  )
}

function LiveTournament({ tournament, categories, entries, info, nameOf, onOpen }: { tournament: Tournament; categories: TournamentCategory[]; entries: TournamentEntry[]; info?: LiveInfo; nameOf: (id: string | null) => string | null; onOpen: () => void }) {
  const inscribed = entries.filter((entry) => categories.some((category) => category.id === entry.category_id)).length
  return (
    <article className="tour-live texture-court">
      <div className="tour-live-head">
        <div>
          <p className="kicker kicker-on-dark">En juego · {rangeLabel(tournament)}</p>
          <h3 className="display">{tournament.name}</h3>
        </div>
        <Button variant="on-dark" iconRight="arrowRight" onClick={onOpen}>Abrir torneo</Button>
      </div>
      <dl className="tour-live-stats">
        <div><dt>Categorías</dt><dd className="display num">{categories.length}</dd></div>
        <div><dt>Inscriptos</dt><dd className="display num">{inscribed}</dd></div>
        <div><dt>Partidos</dt><dd className="display num">{info ? info.played : '—'}<small>{info ? `/${info.total}` : ''}</small></dd></div>
      </dl>
      {info && info.today.length > 0 && (
        <ul className="tour-live-today" aria-label="Partidos de hoy">
          {info.today.map(({ match, when, live }) => (
            <li key={match.id}>
              <button type="button" onClick={onOpen}>
                {live ? <span className="live-dot" aria-label="En juego" /> : <Icon name="clock" size={16} />}
                <span className="tour-live-match"><b>{nameOf(match.entry_one_id) ?? 'A definir'} vs. {nameOf(match.entry_two_id) ?? 'A definir'}</b><small>{categories.find((category) => category.id === match.category_id)?.name}</small></span>
                <span className="num">{when}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

function TournamentCard({ tournament, categories, entries, nameOf, onOpen }: { tournament: Tournament; categories: TournamentCategory[]; entries: TournamentEntry[]; nameOf: (id: string | null) => string | null; onOpen: () => void }) {
  const inscribed = entries.filter((entry) => categories.some((category) => category.id === entry.category_id)).length
  const champions = categories.filter((category) => category.champion_entry_id)
  return (
    <button type="button" className={`tour-card is-${tournament.status === 'registration_open' ? 'registration' : tournament.status}`} onClick={onOpen}>
      <span className="tour-card-head">
        <Badge tone={STATUS_TONE[tournament.status]} dot>{STATUS_LABEL[tournament.status]}</Badge>
        <span className="muted num">{rangeLabel(tournament)}</span>
      </span>
      <strong className="tour-card-title display">{tournament.name}</strong>
      {tournament.status === 'completed' && champions.length > 0 ? (
        <ul className="champ-list">
          {champions.map((category) => <li key={category.id}><Icon name="crown" size={16} /><b>{nameOf(category.champion_entry_id) ?? 'Campeón'}</b><span>{category.name}</span></li>)}
        </ul>
      ) : (
        <span className="tour-card-cats">{categories.length ? categories.map((category) => <span key={category.id}>{category.name}</span>) : <span className="muted">Sin categorías</span>}</span>
      )}
      <span className="tour-card-foot"><Icon name="users" size={16} />{plural(inscribed, 'inscripto', 'inscriptos')}<Icon name="chevronRight" size={18} className="row-chevron" /></span>
    </button>
  )
}

// ── Lista de partidos ───────────────────────────────────────────────
function MatchList({ bracket, rounds, today, onOpen }: { bracket: BracketMatch[]; rounds: number; today: string; onOpen: (id: string) => void }) {
  const real = bracket.filter((match) => match.state !== 'bye')
  if (real.length === 0) return <div className="card"><EmptyState icon="list" title="Sin partidos" body="Los partidos aparecen al generar el cuadro." /></div>
  const scheduled = real.filter((match) => match.state === 'scheduled' && match.when)
  const groups: { id: string; title: string; items: BracketMatch[] }[] = [
    { id: 'today', title: 'Hoy', items: scheduled.filter((match) => match.when?.date === today) },
    { id: 'next', title: 'Programados', items: scheduled.filter((match) => (match.when?.date ?? '') > today) },
    { id: 'todo', title: 'Por programar', items: real.filter((match) => match.state === 'unscheduled' || (match.state === 'scheduled' && (match.when?.date ?? '') < today)) },
    { id: 'wait', title: 'Esperando rival', items: real.filter((match) => match.state === 'waiting') },
    { id: 'done', title: 'Finalizados', items: real.filter((match) => match.state === 'done').reverse() },
  ]
  return (
    <div className="match-groups">
      {groups.filter((group) => group.items.length > 0).map((group) => (
        <section key={group.id} aria-label={group.title}>
          <p className="group-title">{group.title}<span>{group.items.length}</span></p>
          <ul className="match-grid">
            {group.items.map((match) => <li key={match.id}><MatchCard match={match} label={roundName(match.round, rounds)} onOpen={() => onOpen(match.id)} /></li>)}
          </ul>
        </section>
      ))}
    </div>
  )
}

// ── Inscripciones y sorteo ──────────────────────────────────────────
function Entries({ client, club, tournament, category, entries, enrolledIds, locked, canManage, onChanged, onGenerated }: { client: SupabaseClient; club: Club; tournament: Tournament; category: TournamentCategory; entries: TournamentEntry[]; enrolledIds: Set<string>; locked: boolean; canManage: boolean; onChanged: (text: string, reloadAll?: boolean) => Promise<void>; onGenerated: () => void }) {
  const [picking, setPicking] = useState<null | { first?: string }>(null)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [names, setNames] = useState<Record<string, string>>({})
  const search = usePersonSearch(client, club, picking !== null)
  const action = useAsyncAction()
  const drawAction = useAsyncAction()
  const doubles = category.modality === 'doubles'
  const registrationOpen = tournament.status === 'registration_open'
  const canEnroll = canManage && !locked && registrationOpen && entries.length < 32
  const count = entries.length
  const size = count >= 2 && count <= 32 ? bracketSize(count) : 2
  const byes = count >= 2 ? size - count : 0
  const roundList = Array.from({ length: Math.round(Math.log2(size)) }, (_, index) => roundName(index + 1, Math.round(Math.log2(size))))

  const enroll = async (personIds: string[]) => {
    const ok = await action.run(async () => {
      const { error } = await client.rpc('create_tournament_entry', { p_category_id: category.id, p_person_ids: personIds })
      return error ? rpcError(error) : null
    })
    if (!ok) return
    setPicking(null); search.reset(); setPickerError(null)
    await onChanged('Inscripción confirmada.', true)
  }
  const pickPerson = (personId: string, fullName: string) => {
    setNames((current) => ({ ...current, [personId]: fullName }))
    if (doubles && !picking?.first) { setPicking({ first: personId }); search.reset(); return }
    void enroll(picking?.first ? [picking.first, personId] : [personId])
  }
  const removeEntry = (entry: TournamentEntry) => void action.run(async () => {
    const { error } = await client.rpc('delete_tournament_entry', { p_entry_id: entry.id })
    if (error) return rpcError(error)
    await onChanged('Inscripción quitada.', true)
    return null
  })
  const generate = () => void drawAction.run(async () => {
    const { error } = await client.rpc('generate_tournament_fixture', { p_category_id: category.id })
    if (error) return rpcError(error)
    setDrawing(false)
    await onChanged('Fixture generado. Los pases libres avanzaron automáticamente.', true)
    onGenerated()
    return null
  })
  const pickerItems: PickerItem[] = search.results.map((person) => ({ id: person.id, name: person.full_name, hint: person.phone ?? undefined, disabledReason: enrolledIds.has(person.id) ? 'Ya está inscripto en esta categoría' : person.id === picking?.first ? 'Ya elegido' : undefined }))

  return (
    <section className="stack" aria-label="Inscriptos">
      {!locked && canManage && (
        <div className="entries-bar">
          <div>
            <strong className="display num">{count}<small>/32</small></strong>
            <span>{count >= 2 ? `Cuadro de ${size}${byes ? ` · ${plural(byes, 'pase libre', 'pases libres')}` : ''}` : 'Mínimo 2 para sortear'}</span>
          </div>
          <Button variant="secondary" icon="userPlus" disabled={!canEnroll || action.saving} onClick={() => { setPickerError(null); setPicking({}) }}>{doubles ? 'Inscribir pareja' : 'Inscribir'}</Button>
          <Button variant="accent" icon="bracket" disabled={count < 2 || !registrationOpen} onClick={() => { drawAction.reset(); setDrawing(true) }}>Sortear cuadro</Button>
        </div>
      )}
      {!locked && canManage && !registrationOpen && <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span>Abrí la inscripción del torneo para sumar inscriptos y sortear el cuadro.</span></p>}
      {locked && <p className="inline-alert inline-alert-info"><Icon name="lock" size={20} /><span>El cuadro ya se sorteó: las inscripciones quedan cerradas para esta categoría.</span></p>}
      {entries.length === 0 ? <div className="card"><EmptyState icon="users" title="Sin inscriptos" body={doubles ? 'Inscribí parejas eligiendo dos fichas.' : 'Inscribí jugadores desde sus fichas o creá una rápida.'} /></div> : (
        <ol className="entry-list">
          {entries.map((entry, index) => (
            <li key={entry.id}>
              <span className="entry-n num">{index + 1}</span>
              <span className="entry-main"><strong>{entry.display_name}</strong></span>
              {!locked && canManage && <IconButton icon="x" size="sm" label={`Quitar a ${entry.display_name}`} disabled={action.saving} onClick={() => removeEntry(entry)} />}
            </li>
          ))}
        </ol>
      )}
      {action.failed && picking === null && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardó el cambio</strong><p>{action.message}</p></div></div>}

      <PersonPicker
        open={picking !== null}
        title={doubles ? (picking?.first ? `Compañero/a de ${names[picking.first] ?? 'la pareja'}` : 'Primer integrante') : `Inscribir en ${category.name}`}
        items={pickerItems} query={search.query} onQueryChange={search.setQuery} loading={search.loading} busy={action.saving} error={pickerError ?? (action.failed ? action.message : null)}
        onClose={() => { setPicking(null); search.reset() }}
        onPick={(id) => { const person = search.results.find((item) => item.id === id); if (person) pickPerson(person.id, person.full_name) }}
        onCreate={(name) => void (async () => { const result = await createQuickPerson(client, club, name); if (result.error || !result.person) { setPickerError(result.error ?? 'No pudimos crear la ficha.'); return } pickPerson(result.person.id, result.person.full_name) })()}
      />
      <ConfirmDialog open={drawing} title={`Sortear cuadro · ${category.name}`} confirmLabel="Sortear y generar" tone="accent" icon="bracket" status={drawAction.status} onConfirm={generate} onClose={() => setDrawing(false)} errorTitle="No se generó el cuadro" errorBody={drawAction.message ?? 'No se creó ningún partido. Reintentar no lo duplica.'}>
        <div className="issue-summary">
          <div><span>Inscripciones</span><strong className="display num">{count}</strong></div>
          <div><span>Cuadro</span><strong className="display num">{size}</strong></div>
          <div><span>Pases libres</span><strong className="display num">{byes}</strong></div>
          <div className="is-total"><span>Rondas</span><strong className="display">{roundList.join(' · ')}</strong></div>
        </div>
        <p className="muted">El orden se sortea al azar en el servidor. Los pases libres avanzan solos. El sorteo queda fijado: después no se pueden sumar inscriptos ni cambiar el cuadro.</p>
      </ConfirmDialog>
    </section>
  )
}

// ── Partido: programar y cargar resultado ───────────────────────────
function MatchSheet({ client, club, courts, tournament, category, match, rounds, nameOf, occupation, today, nextMatch, onClose, onChanged }: { client: SupabaseClient; club: Club; courts: Court[]; tournament: Tournament; category: TournamentCategory; match: TournamentMatch; rounds: number; nameOf: (id: string | null) => string | null; occupation?: Occupation; today: string; nextMatch?: TournamentMatch; onClose: () => void; onChanged: (text: string) => Promise<void> }) {
  const state = matchState(match)
  const a = nameOf(match.entry_one_id)
  const b = nameOf(match.entry_two_id)
  const activeCourts = courts.filter((court) => court.active)
  const action = useAsyncAction()
  const [mode, setMode] = useState<'view' | 'schedule' | 'result'>('view')
  const [unscheduling, setUnscheduling] = useState(false)

  // Programación
  const initialStart = occupation ? isoToDateAndTime(occupation.starts_at, club.timezone) : null
  const initialEnd = occupation ? isoToDateAndTime(occupation.ends_at, club.timezone) : null
  const [courtId, setCourtId] = useState(occupation?.court_id ?? activeCourts[0]?.id ?? '')
  const [date, setDate] = useState(initialStart?.date ?? (tournament.starts_on > today ? tournament.starts_on : today))
  const [startsAt, setStartsAt] = useState(initialStart?.time ?? '19:00')
  const [endsAt, setEndsAt] = useState(initialEnd?.time ?? '20:30')
  const startsIso = date && startsAt ? zonedDateTimeToIso(date, startsAt, club.timezone) : ''
  const endsIso = date && endsAt ? zonedDateTimeToIso(date, endsAt, club.timezone) : ''
  const dayOccupations = useDayOccupations(client, club, date, mode === 'schedule')
  const clash = courtBusyIn(dayOccupations, courtId, startsIso, endsIso, match.reservation_id) === true
  const intervalOk = startsIso !== '' && endsIso > startsIso

  // Resultado
  const [winner, setWinner] = useState<'a' | 'b' | null>(null)
  const [walkover, setWalkover] = useState(false)
  const [sets, setSets] = useState<[string, string][]>([['', ''], ['', '']])
  const [touched, setTouched] = useState(false)
  const filled = sets.filter(([x, y]) => x !== '' || y !== '')
  const setsWon = filled.reduce((acc, [x, y]) => (Number(x) > Number(y) ? { ...acc, a: acc.a + 1 } : Number(y) > Number(x) ? { ...acc, b: acc.b + 1 } : acc), { a: 0, b: 0 })
  const setsBroken = filled.some(([x, y]) => x === '' || y === '' || x === y)
  const resultError = !touched ? undefined : !winner ? 'Elegí quién ganó.' : !walkover && setsBroken ? 'Cada set necesita dos números distintos.' : undefined
  const mismatch = winner && !walkover && filled.length > 0 && !setsBroken && setsWon[winner] <= setsWon[winner === 'a' ? 'b' : 'a']
  const label = `${category.name} · ${roundName(match.round_number, rounds)}`
  const bm: BracketMatch = { id: match.id, round: match.round_number, position: match.position, a, b, winner: match.winner_entry_id ? (match.winner_entry_id === match.entry_one_id ? 'a' : 'b') : null, walkover: match.is_walkover, score: match.score_text, state, when: undefined }
  const sidesScore = scoreBySide(bm)
  const editable = state === 'scheduled' || state === 'unscheduled'

  const schedule = () => {
    if (!intervalOk || !courtId) return
    void action.run(async () => {
      const { error } = await client.rpc('schedule_tournament_match', { p_match_id: match.id, p_court_id: courtId, p_starts_at: startsIso, p_ends_at: endsIso })
      if (error) return error.code === '23P01' ? 'La cancha ya tiene una ocupación en ese horario.' : rpcError(error)
      setMode('view')
      await onChanged(occupation ? 'Partido reprogramado.' : 'Partido programado.')
      return null
    })
  }
  const unschedule = () => void action.run(async () => {
    const { error } = await client.rpc('cancel_tournament_match_schedule', { p_match_id: match.id })
    if (error) return rpcError(error)
    setUnscheduling(false)
    await onChanged('Programación cancelada: la cancha quedó libre.')
    return null
  })
  const saveResult = () => {
    setTouched(true)
    if (!winner || (!walkover && setsBroken)) return
    const winnerId = winner === 'a' ? match.entry_one_id : match.entry_two_id
    // El marcador se escribe con los games del ganador primero («6-4 3-6 10-7»).
    const score = walkover ? '' : filled.map(([x, y]) => (winner === 'a' ? `${x}-${y}` : `${y}-${x}`)).join(' ')
    void action.run(async () => {
      const { error } = await client.rpc('record_tournament_match_result', { p_match_id: match.id, p_winner_entry_id: winnerId, p_score_text: score, p_is_walkover: walkover })
      if (error) return rpcError(error)
      setMode('view')
      await onChanged(match.round_number === rounds ? '¡Final cargada! Se registró al campeón de la categoría.' : 'Resultado cargado. El ganador avanzó a la ronda siguiente.')
      return null
    })
  }

  const when = occupation && initialStart && initialEnd ? { day: initialStart.date, range: `${initialStart.time}–${initialEnd.time}`, court: courts.find((court) => court.id === occupation.court_id)?.name ?? 'Cancha' } : null
  const nowMs = Date.now()
  const liveNow = occupation ? new Date(occupation.starts_at).getTime() <= nowMs && nowMs < new Date(occupation.ends_at).getTime() : false

  return (
    <>
      <Modal open={!unscheduling} onClose={onClose} busy={action.saving} variant="drawer" size="md" eyebrow={label} title={state === 'done' ? 'Resultado' : state === 'waiting' ? 'Partido a definir' : 'Partido'}>
        <div className="detail">
          <div className="versus">
            {(['a', 'b'] as const).map((side) => {
              const name = side === 'a' ? a : b
              const chosen = mode === 'result' ? winner === side : bm.winner === side
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
              {state === 'done' && (
                <div className="score-board" aria-label="Marcador">
                  {match.is_walkover ? <p className="score-wo">Ganó por W.O. (no se presentó el rival)</p> : sidesScore.a.length > 0 ? (
                    <table>
                      <thead><tr><th scope="col"><span className="visually-hidden">Jugador</span></th>{sidesScore.a.map((_, index) => <th key={index} scope="col">Set {index + 1}</th>)}</tr></thead>
                      <tbody>
                        {(['a', 'b'] as const).map((side) => <tr key={side} className={bm.winner === side ? 'is-winner' : ''}><th scope="row">{side === 'a' ? a : b}</th>{sidesScore[side].map((games, index) => <td key={index} className="num">{games}</td>)}</tr>)}
                      </tbody>
                    </table>
                  ) : <p className="score-wo">{match.score_text ? `Marcador: ${match.score_text}` : 'Finalizado sin marcador cargado.'}</p>}
                </div>
              )}
              {state === 'waiting' && <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span>Se completa cuando se definan los partidos de la ronda anterior.</span></p>}

              {state !== 'waiting' && (
                <section className="detail-section" aria-labelledby="ms-when">
                  <h3 id="ms-when" className="detail-section-title">Cancha y horario</h3>
                  {when ? (
                    <div className="when-card occ-match">
                      <span className="detail-time num">{when.range}</span>
                      <span>{when.court} · {capitalize(dayLong(when.day))}{liveNow && state !== 'done' ? ' · en juego' : ''}</span>
                    </div>
                  ) : <p className="muted">{state === 'done' ? 'Se jugó sin cancha registrada en la agenda.' : 'Todavía no tiene cancha asignada.'}</p>}
                  {state !== 'done' && (
                    <div className="detail-actions">
                      <Button variant={occupation ? 'secondary' : 'primary'} icon="calendar" onClick={() => { action.reset(); setMode('schedule') }}>{occupation ? 'Reprogramar' : 'Programar en la agenda'}</Button>
                      {occupation && <Button variant="ghost" icon="x" onClick={() => { action.reset(); setUnscheduling(true) }}>Quitar de la agenda</Button>}
                    </div>
                  )}
                </section>
              )}

              {editable && (
                <div className="sheet-cta">
                  <Button variant="accent" size="lg" block icon="trophy" onClick={() => { setTouched(false); action.reset(); setMode('result') }}>Cargar resultado</Button>
                </div>
              )}
              {state === 'done' && <p className="detail-footnote"><Icon name="lock" size={16} />{nextMatch?.status === 'completed' ? 'El partido siguiente ya tiene resultado.' : 'Los resultados cargados quedan firmes: el sistema no permite corregirlos desde la app.'}</p>}
            </>
          )}

          {mode === 'schedule' && (
            <section className="res-form" aria-label="Programar partido">
              <fieldset className="form-block">
                <legend className="form-legend">Cancha</legend>
                <CourtPicker courts={activeCourts} value={courtId} onChange={setCourtId} isBusy={(id) => courtBusyIn(dayOccupations, id, startsIso, endsIso, match.reservation_id)} short={courtShort} />
              </fieldset>
              <div className="form-row">
                <Field label="Fecha">{(id) => <TextInput id={id} type="date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} />}</Field>
                <Field label="Inicio">{(id) => <SelectInput id={id} value={startsAt} onChange={(event) => setStartsAt(event.target.value)}>{SLOTS.map((slot) => <option key={slot}>{slot}</option>)}</SelectInput>}</Field>
              </div>
              <div className="form-row">
                <Field label="Fin" error={!intervalOk ? 'La hora de fin debe ser posterior al inicio.' : undefined}>{(id, describedBy) => <SelectInput id={id} aria-describedby={describedBy} value={endsAt} onChange={(event) => setEndsAt(event.target.value)}>{[...SLOTS, '23:00'].map((slot) => <option key={slot}>{slot}</option>)}</SelectInput>}</Field>
                <fieldset className="form-block">
                  <legend className="form-legend">Duración</legend>
                  <div className="chip-row">{[60, 90, 120].map((minutes) => <Chip key={minutes} selected={intervalOk && (new Date(endsIso).getTime() - new Date(startsIso).getTime()) / 60000 === minutes} disabled={toMinutes(startsAt) + minutes > 23 * 60} onClick={() => setEndsAt(fromMinutes(toMinutes(startsAt) + minutes))}>{durationLabel(minutes)}</Chip>)}</div>
                </fieldset>
              </div>
              {(date < tournament.starts_on || date > tournament.ends_on) && <p className="inline-alert inline-alert-warning"><Icon name="alert" size={20} /><span>La fecha queda fuera del torneo ({rangeLabel(tournament)}).</span></p>}
              {clash && <div className="inline-alert inline-alert-warning" role="status"><Icon name="alert" size={20} /><div><strong>{courts.find((court) => court.id === courtId)?.name} figura ocupada en ese horario</strong><p>Elegí otra cancha u horario. La confirmación final la hace el sistema al guardar.</p></div></div>}
              {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se programó</strong><p>{action.message}</p></div></div>}
              <div className="form-actions">
                <Button variant="ghost" onClick={() => setMode('view')} disabled={action.saving}>Volver</Button>
                <Button variant="accent" icon={action.failed ? 'refresh' : 'check'} loading={action.saving} disabled={!intervalOk || !courtId} onClick={schedule}>{action.failed ? 'Reintentar' : 'Guardar programación'}</Button>
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
                    {sets.map((set, index) => <SetRow key={index} index={index} value={set} onChange={(value) => setSets(sets.map((item, i) => (i === index ? value : item)))} />)}
                  </div>
                  <div className="chip-row">
                    {sets.length < 3 && <Chip icon="plus" onClick={() => setSets([...sets, ['', '']])}>Tercer set</Chip>}
                    {sets.length > 1 && <Chip icon="minus" onClick={() => setSets(sets.slice(0, -1))}>Quitar set</Chip>}
                  </div>
                  <p className="field-hint">En el tercer set podés cargar el super tie-break (por ejemplo 10-7). El marcador es opcional.</p>
                </fieldset>
              )}
              {mismatch && <p className="inline-alert inline-alert-warning" role="status"><Icon name="alert" size={20} /><span>Los sets cargados no coinciden con el ganador elegido. Revisalos antes de confirmar: el resultado no se puede corregir después.</span></p>}
              {resultError && <p className="field-error" role="alert"><Icon name="alert" size={14} />{resultError}</p>}
              {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardó el resultado</strong><p>{action.message}</p></div></div>}
              <div className="form-actions">
                <Button variant="ghost" onClick={() => setMode('view')} disabled={action.saving}>Volver</Button>
                <Button variant="accent" size="lg" icon={action.failed ? 'refresh' : 'check'} loading={action.saving} onClick={saveResult}>{action.failed ? 'Reintentar' : 'Confirmar resultado'}</Button>
              </div>
            </section>
          )}
        </div>
      </Modal>
      <ConfirmDialog open={unscheduling} title="¿Quitar el partido de la agenda?" confirmLabel="Quitar de la agenda" icon="x" status={action.status} errorBody={action.message ?? undefined} onConfirm={unschedule} onClose={() => setUnscheduling(false)}>
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
function TournamentForm({ client, club, editing, today, onClose, onSaved }: { client: SupabaseClient; club: Club; editing?: Tournament; today: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(editing?.name ?? '')
  const [startsOn, setStartsOn] = useState(editing?.starts_on ?? today)
  const [endsOn, setEndsOn] = useState(editing?.ends_on ?? shiftCalendarDate(today, 7))
  const [description, setDescription] = useState(editing?.description ?? '')
  const [touched, setTouched] = useState(false)
  const action = useAsyncAction()
  const nameError = touched && name.trim().length < 1 ? 'Poné un nombre para identificarlo.' : undefined
  const dateError = touched && endsOn < startsOn ? 'La fecha de cierre no puede ser anterior al inicio.' : undefined
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (name.trim().length < 1 || endsOn < startsOn) return
    void action.run(async () => {
      const { error } = editing
        ? await client.rpc('update_tournament', { p_tournament_id: editing.id, p_name: name, p_description: description, p_starts_on: startsOn, p_ends_on: endsOn, p_status: editing.status })
        : await client.rpc('create_tournament', { p_club_id: club.id, p_name: name, p_description: description, p_starts_on: startsOn, p_ends_on: endsOn })
      if (error) return rpcError(error)
      await onSaved()
      return null
    })
  }
  return (
    <Modal open onClose={onClose} busy={action.saving} variant="drawer" size="sm" eyebrow={editing ? 'Editar torneo' : 'Torneos'} title={editing ? editing.name : 'Nuevo torneo'}>
      <form className="res-form" noValidate onSubmit={submit}>
        <Field label="Nombre" error={nameError}>{(id, describedBy) => <TextInput id={id} value={name} placeholder="Ej.: Torneo de Verano" aria-invalid={Boolean(nameError)} aria-describedby={describedBy} onChange={(event) => setName(event.target.value)} data-autofocus />}</Field>
        <div className="form-row">
          <Field label="Empieza">{(id) => <TextInput id={id} type="date" value={startsOn} onChange={(event) => event.target.value && setStartsOn(event.target.value)} />}</Field>
          <Field label="Termina" error={dateError}>{(id, describedBy) => <TextInput id={id} type="date" value={endsOn} min={startsOn} aria-describedby={describedBy} onChange={(event) => event.target.value && setEndsOn(event.target.value)} />}</Field>
        </div>
        <Field label="Descripción" optional>{(id) => <TextArea id={id} rows={2} value={description} placeholder="Formato, premios, a quién está dirigido" onChange={(event) => setDescription(event.target.value)} />}</Field>
        {!editing && <p className="field-hint">Se crea en borrador. Abrí la inscripción cuando estés listo.</p>}
        {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardó</strong><p>{action.message}</p></div></div>}
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose} disabled={action.saving}>Cancelar</Button>
          <Button type="submit" variant={editing ? 'primary' : 'accent'} icon={action.failed ? 'refresh' : 'check'} loading={action.saving}>{action.failed ? 'Reintentar' : editing ? 'Guardar cambios' : 'Crear en borrador'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function CategoryForm({ client, tournament, existing, onClose, onCreated }: { client: SupabaseClient; tournament: Tournament; existing: TournamentCategory[]; onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [modality, setModality] = useState<'singles' | 'doubles'>('singles')
  const [touched, setTouched] = useState(false)
  const action = useAsyncAction()
  const clean = name.trim().replace(/\s+/g, ' ')
  const duplicate = existing.some((category) => category.name.toLowerCase() === clean.toLowerCase() && category.modality === modality)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (clean.length < 1 || duplicate) return
    void action.run(async () => {
      const { error } = await client.rpc('create_tournament_category', { p_tournament_id: tournament.id, p_name: clean, p_modality: modality })
      if (error) return rpcError(error)
      await onCreated()
      return null
    })
  }
  return (
    <Modal open onClose={onClose} busy={action.saving} size="sm" title="Nueva categoría">
      <form className="res-form" noValidate onSubmit={submit}>
        <SegmentedTabs label="Modalidad" stretch value={modality} onChange={setModality} items={[{ id: 'singles', label: 'Singles', icon: 'user' }, { id: 'doubles', label: 'Dobles', icon: 'users' }]} />
        <Field label="Nombre" error={touched && clean.length < 1 ? 'Escribí el nombre de la categoría.' : touched && duplicate ? 'Ya existe esa categoría en el torneo.' : undefined}>{(id, describedBy) => <TextInput id={id} value={name} aria-describedby={describedBy} onChange={(event) => setName(event.target.value)} placeholder="Ej.: Caballeros B" data-autofocus />}</Field>
        {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se agregó</strong><p>{action.message}</p></div></div>}
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose} disabled={action.saving}>Cancelar</Button>
          <Button type="submit" variant="primary" icon={action.failed ? 'refresh' : 'check'} loading={action.saving}>{action.failed ? 'Reintentar' : 'Agregar categoría'}</Button>
        </div>
      </form>
    </Modal>
  )
}
