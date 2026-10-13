import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club, ClubPerson, Court, Tournament, TournamentCategory, TournamentEntry, TournamentMatch } from '../../types/domain'
import { isoToDateAndTime, zonedDateTimeToIso } from '../reservations/reservationUtils'

type Props = { client: SupabaseClient; club: Club; courts: Court[]; canManage: boolean; requestedReservationId?: string | null; onRequestedReservationHandled?: () => void }
const matchFields = 'id, club_id, tournament_id, category_id, round_number, position, entry_one_id, entry_two_id, winner_entry_id, reservation_id, status, score_text, is_walkover, finished_at'

function today() { return new Date().toISOString().slice(0, 10) }
function rpcError(error: { message?: string } | null) { return error?.message ?? 'No pudimos completar la operación. Intentá nuevamente.' }
function roundName(round: number, maxRound: number) { const remaining = 2 ** (maxRound - round + 1); return remaining === 2 ? 'Final' : remaining === 4 ? 'Semifinal' : remaining === 8 ? 'Cuartos de final' : `Ronda ${round}` }

export function TournamentPanel({ client, club, courts, canManage, requestedReservationId, onRequestedReservationHandled }: Props) {
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [categories, setCategories] = useState<TournamentCategory[]>([])
  const [entries, setEntries] = useState<TournamentEntry[]>([])
  const [matches, setMatches] = useState<TournamentMatch[]>([])
  const [people, setPeople] = useState<ClubPerson[]>([])
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creatingTournament, setCreatingTournament] = useState(false)
  const [editingTournament, setEditingTournament] = useState<Tournament | null>(null)
  const [newTournament, setNewTournament] = useState({ name: '', description: '', startsOn: today(), endsOn: today() })
  const [newCategory, setNewCategory] = useState({ name: '', modality: 'singles' as 'singles' | 'doubles' })
  const [personIds, setPersonIds] = useState<string[]>([])
  const [quickPerson, setQuickPerson] = useState('')
  const [scheduleMatch, setScheduleMatch] = useState<TournamentMatch | null>(null)
  const [resultMatch, setResultMatch] = useState<TournamentMatch | null>(null)
  const [openedMatchId, setOpenedMatchId] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true)
    const [tournamentResult, categoryResult, peopleResult] = await Promise.all([
      client.from('tournaments').select('id, club_id, name, description, starts_on, ends_on, status, created_at').eq('club_id', club.id).order('starts_on', { ascending: false }),
      client.from('tournament_categories').select('id, club_id, tournament_id, name, modality, status, champion_entry_id').eq('club_id', club.id),
      client.from('club_people').select('id, club_id, full_name, phone, email, notes, active, created_at, updated_at').eq('club_id', club.id).eq('active', true).order('full_name'),
    ])
    if (tournamentResult.error || categoryResult.error || peopleResult.error) setFeedback('No pudimos cargar Torneos. Confirmá que la migración Sprint 07 esté aplicada.')
    const nextTournaments = (tournamentResult.data ?? []) as Tournament[]
    const nextCategories = (categoryResult.data ?? []) as TournamentCategory[]
    setTournaments(nextTournaments); setCategories(nextCategories); setPeople((peopleResult.data ?? []) as ClubPerson[])
    setSelectedTournamentId((current) => current && nextTournaments.some((item) => item.id === current) ? current : nextTournaments[0]?.id ?? null)
    setLoading(false)
  }

  useEffect(() => { void reload() }, [club.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const tournamentCategories = categories.filter((item) => item.tournament_id === selectedTournamentId)
  useEffect(() => {
    const available = categories.filter((item) => item.tournament_id === selectedTournamentId)
    setSelectedCategoryId((current) => current && available.some((item) => item.id === current) ? current : available[0]?.id ?? null)
  }, [selectedTournamentId, categories])
  const selectedTournament = tournaments.find((item) => item.id === selectedTournamentId) ?? null
  const selectedCategory = categories.find((item) => item.id === selectedCategoryId) ?? null

  const loadCategory = async (categoryId: string | null) => {
    if (!categoryId) { setEntries([]); setMatches([]); return }
    const [entryResult, matchResult] = await Promise.all([
      client.from('tournament_entries').select('id, club_id, category_id, display_name, draw_position').eq('category_id', categoryId),
      client.from('tournament_matches').select(matchFields).eq('category_id', categoryId).order('round_number').order('position'),
    ])
    if (entryResult.error || matchResult.error) setFeedback('No pudimos cargar las inscripciones o el fixture.')
    setEntries((entryResult.data ?? []) as TournamentEntry[]); setMatches((matchResult.data ?? []) as TournamentMatch[])
  }
  useEffect(() => { void loadCategory(selectedCategoryId) }, [selectedCategoryId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!requestedReservationId) return
    let cancelled = false
    const openRequestedMatch = async () => {
      const { data, error } = await client.from('tournament_matches').select('id, tournament_id, category_id').eq('reservation_id', requestedReservationId).maybeSingle()
      if (cancelled) return
      if (error || !data) { setFeedback('No pudimos abrir el partido de torneo seleccionado.'); onRequestedReservationHandled?.(); return }
      setSelectedTournamentId(data.tournament_id as string)
      setSelectedCategoryId(data.category_id as string)
      setOpenedMatchId(data.id as string)
      onRequestedReservationHandled?.()
    }
    void openRequestedMatch()
    return () => { cancelled = true }
  }, [client, requestedReservationId, onRequestedReservationHandled])
  useEffect(() => {
    const match = matches.find((item) => item.id === openedMatchId)
    if (match) { setResultMatch(match); setOpenedMatchId(null) }
  }, [matches, openedMatchId])

  const createTournament = async (event: React.FormEvent) => {
    event.preventDefault(); setFeedback(null)
    const { error } = await client.rpc('create_tournament', { p_club_id: club.id, p_name: newTournament.name, p_description: newTournament.description, p_starts_on: newTournament.startsOn, p_ends_on: newTournament.endsOn })
    if (error) return setFeedback(rpcError(error))
    setNewTournament({ name: '', description: '', startsOn: today(), endsOn: today() }); setCreatingTournament(false); setFeedback('Torneo creado en borrador. Abrí las inscripciones cuando estés listo.'); await reload()
  }
  const changeStatus = async (status: Tournament['status']) => {
    if (!selectedTournament) return
    const { error } = await client.rpc('update_tournament', { p_tournament_id: selectedTournament.id, p_name: selectedTournament.name, p_description: selectedTournament.description, p_starts_on: selectedTournament.starts_on, p_ends_on: selectedTournament.ends_on, p_status: status })
    if (error) return setFeedback(rpcError(error)); await reload()
  }
  const createCategory = async (event: React.FormEvent) => {
    event.preventDefault(); if (!selectedTournament) return
    const { error } = await client.rpc('create_tournament_category', { p_tournament_id: selectedTournament.id, p_name: newCategory.name, p_modality: newCategory.modality })
    if (error) return setFeedback(rpcError(error)); setNewCategory({ name: '', modality: 'singles' }); await reload()
  }
  const createEntry = async (event: React.FormEvent) => {
    event.preventDefault(); if (!selectedCategory) return
    const { error } = await client.rpc('create_tournament_entry', { p_category_id: selectedCategory.id, p_person_ids: personIds })
    if (error) return setFeedback(rpcError(error)); setPersonIds([]); await loadCategory(selectedCategory.id)
  }
  const createQuickPerson = async () => {
    const fullName = quickPerson.trim(); if (!fullName) return
    const { data, error } = await client.from('club_people').insert({ club_id: club.id, full_name: fullName, active: true }).select('id, club_id, full_name, phone, email, notes, active, created_at, updated_at').single()
    if (error) return setFeedback(rpcError(error)); setPeople((current) => [...current, data as ClubPerson].sort((a, b) => a.full_name.localeCompare(b.full_name))); setQuickPerson(''); setPersonIds((current) => [...current, (data as ClubPerson).id])
  }
  const generateFixture = async () => {
    if (!selectedCategory || !window.confirm('El sorteo queda fijado y ya no podrán cambiarse las inscripciones. ¿Generar fixture?')) return
    const { error } = await client.rpc('generate_tournament_fixture', { p_category_id: selectedCategory.id })
    if (error) return setFeedback(rpcError(error)); setFeedback('Fixture generado. Los pases libres avanzaron automáticamente.'); await reload(); await loadCategory(selectedCategory.id)
  }
  const entryName = (entryId: string | null) => entries.find((entry) => entry.id === entryId)?.display_name ?? 'Por definir'
  const maxRound = Math.max(1, ...matches.map((match) => match.round_number))
  const matchesByRound = useMemo(() => Array.from({ length: maxRound }, (_, index) => matches.filter((match) => match.round_number === index + 1)), [matches, maxRound])

  return <section className="tournaments-section" aria-labelledby="tournaments-title">
    <div className="section-heading"><div><p className="eyebrow">Competencia</p><h2 id="tournaments-title">Torneos</h2></div>{canManage && <button type="button" onClick={() => setCreatingTournament(true)}>Crear torneo</button>}</div>
    {feedback && <p className="form-error" role="alert">{feedback}</p>}
    {creatingTournament && <Modal title="Nuevo torneo" onClose={() => setCreatingTournament(false)}><form className="reservation-form" onSubmit={(event) => void createTournament(event)}><label>Nombre<input value={newTournament.name} onChange={(event) => setNewTournament({ ...newTournament, name: event.target.value })} required /></label><label>Descripción opcional<textarea value={newTournament.description} onChange={(event) => setNewTournament({ ...newTournament, description: event.target.value })} /></label><div className="time-fields"><label>Inicio<input type="date" value={newTournament.startsOn} onChange={(event) => setNewTournament({ ...newTournament, startsOn: event.target.value })} required /></label><label>Finalización<input type="date" min={newTournament.startsOn} value={newTournament.endsOn} onChange={(event) => setNewTournament({ ...newTournament, endsOn: event.target.value })} required /></label></div><button>Crear en borrador</button></form></Modal>}
    {loading ? <p className="calendar-loading">Cargando torneos…</p> : tournaments.length === 0 ? <p className="home-panel">Todavía no hay torneos. Creá uno para empezar a organizar sus categorías e inscripciones.</p> : <>
      <label className="tournament-selector">Torneo<select value={selectedTournamentId ?? ''} onChange={(event) => setSelectedTournamentId(event.target.value)}>{tournaments.map((item) => <option key={item.id} value={item.id}>{item.name} · {statusLabel(item.status)}</option>)}</select></label>
      {selectedTournament && <><article className="tournament-summary"><div><h3>{selectedTournament.name}</h3><p>{selectedTournament.description || 'Sin descripción.'}</p><small>{selectedTournament.starts_on} a {selectedTournament.ends_on} · {statusLabel(selectedTournament.status)}</small></div>{canManage && <div className="tournament-actions"><button className="secondary-button" type="button" onClick={() => setEditingTournament(selectedTournament)}>Editar datos</button>{selectedTournament.status === 'draft' && <button type="button" onClick={() => void changeStatus('registration_open')}>Abrir inscripciones</button>}{selectedTournament.status === 'registration_open' && <button className="secondary-button" type="button" onClick={() => void changeStatus('draft')}>Volver a borrador</button>}</div>}</article>
      <div className="tournament-category-layout"><aside className="tournament-categories"><h3>Categorías</h3>{tournamentCategories.map((category) => <button key={category.id} type="button" className={category.id === selectedCategoryId ? 'active' : ''} onClick={() => setSelectedCategoryId(category.id)}>{category.name}<small>{category.modality === 'singles' ? 'Singles' : 'Dobles'} · {category.status === 'completed' ? 'Finalizada' : category.status === 'open' ? 'Inscripciones' : 'Fixture'}</small></button>)}{canManage && selectedTournament.status !== 'completed' && selectedTournament.status !== 'cancelled' && <form className="category-form" onSubmit={(event) => void createCategory(event)}><label>Nueva categoría<input value={newCategory.name} onChange={(event) => setNewCategory({ ...newCategory, name: event.target.value })} required /></label><label>Modalidad<select value={newCategory.modality} onChange={(event) => setNewCategory({ ...newCategory, modality: event.target.value as 'singles' | 'doubles' })}><option value="singles">Singles</option><option value="doubles">Dobles</option></select></label><button>Agregar categoría</button></form>}</aside>
      <div className="tournament-detail">{selectedCategory ? <><div className="section-heading"><div><h3>{selectedCategory.name}</h3><p>{selectedCategory.modality === 'singles' ? 'Un jugador por inscripción.' : 'Dos jugadores por pareja.'}</p></div>{selectedCategory.champion_entry_id && <strong className="champion">Campeón: {entryName(selectedCategory.champion_entry_id)}</strong>}</div>
      {selectedCategory.status === 'open' && canManage && <form className="entry-form" onSubmit={(event) => void createEntry(event)}><h3>Inscribir {selectedCategory.modality === 'singles' ? 'jugador' : 'pareja'}</h3><label>{selectedCategory.modality === 'singles' ? 'Jugador' : 'Jugadores'}<select multiple size={Math.min(6, Math.max(3, people.length))} value={personIds} onChange={(event) => setPersonIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>{people.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}</select></label><p className="field-help">Seleccioná exactamente {selectedCategory.modality === 'singles' ? 'una persona' : 'dos personas distintas'}.</p><div className="quick-person"><input aria-label="Nombre de persona nueva" placeholder="Alta rápida: nombre" value={quickPerson} onChange={(event) => setQuickPerson(event.target.value)} /><button className="secondary-button" type="button" onClick={() => void createQuickPerson()}>Crear persona</button></div><button>Inscribir</button></form>}
      <section className="entry-list"><h3>Inscripciones ({entries.length})</h3>{entries.length === 0 ? <p className="field-help">Aún no hay inscriptos.</p> : entries.map((entry) => <div key={entry.id}><span>{entry.display_name}</span>{selectedCategory.status === 'open' && canManage && <button className="secondary-button" type="button" onClick={async () => { const { error } = await client.rpc('delete_tournament_entry', { p_entry_id: entry.id }); if (error) setFeedback(rpcError(error)); else await loadCategory(selectedCategory.id) }}>Quitar</button>}</div>)}</section>
      {selectedCategory.status === 'open' && canManage && <button type="button" disabled={entries.length < 2 || selectedTournament.status !== 'registration_open'} onClick={() => void generateFixture()}>Generar fixture de eliminación directa</button>}
      {matches.length > 0 && <section className="fixture"><h3>Fixture</h3><div className="fixture-rounds">{matchesByRound.map((round, index) => <div className="fixture-round" key={index}><h4>{roundName(index + 1, maxRound)}</h4>{round.map((match) => <MatchCard key={match.id} match={match} entryName={entryName} onSchedule={() => setScheduleMatch(match)} onResult={() => setResultMatch(match)} canManage />)}</div>)}</div></section>}
      </> : <p className="field-help">Elegí o creá una categoría.</p>}</div></div></>}</>}
    {scheduleMatch && <ScheduleModal client={client} club={club} courts={courts} match={scheduleMatch} entryName={entryName} onClose={() => setScheduleMatch(null)} onSaved={async () => { setScheduleMatch(null); await loadCategory(selectedCategoryId) }} onError={setFeedback} />}
    {resultMatch && <ResultModal client={client} match={resultMatch} entryName={entryName} onClose={() => setResultMatch(null)} onSaved={async () => { setResultMatch(null); await reload(); await loadCategory(selectedCategoryId) }} onError={setFeedback} />}
    {editingTournament && <TournamentEditModal client={client} tournament={editingTournament} onClose={() => setEditingTournament(null)} onSaved={async () => { setEditingTournament(null); await reload() }} onError={setFeedback} />}
  </section>
}

function MatchCard({ match, entryName, onSchedule, onResult, canManage }: { match: TournamentMatch; entryName: (id: string | null) => string; onSchedule: () => void; onResult: () => void; canManage: boolean }) {
  const ready = Boolean(match.entry_one_id && match.entry_two_id)
  return <article className="match-card"><small>Partido {match.position} · {match.status === 'completed' ? 'Finalizado' : match.status === 'scheduled' ? 'Programado' : ready ? 'Pendiente' : 'Esperando ganador'}</small><strong className={match.winner_entry_id === match.entry_one_id ? 'winner' : ''}>{entryName(match.entry_one_id)}</strong><strong className={match.winner_entry_id === match.entry_two_id ? 'winner' : ''}>{entryName(match.entry_two_id)}</strong>{match.score_text && <span>{match.is_walkover ? 'W.O. · ' : ''}{match.score_text}</span>}{canManage && ready && match.status !== 'completed' && <div><button className="secondary-button" type="button" onClick={onSchedule}>Programar</button><button type="button" onClick={onResult}>Resultado</button></div>}</article>
}

function ScheduleModal({ client, club, courts, match, entryName, onClose, onSaved, onError }: { client: SupabaseClient; club: Club; courts: Court[]; match: TournamentMatch; entryName: (id: string | null) => string; onClose: () => void; onSaved: () => Promise<void>; onError: (message: string) => void }) {
  const now = isoToDateAndTime(new Date().toISOString(), club.timezone); const [courtId, setCourtId] = useState(courts.find((court) => court.active)?.id ?? ''); const [date, setDate] = useState(now.date); const [startsAt, setStartsAt] = useState('19:00'); const [endsAt, setEndsAt] = useState('20:30'); const [saving, setSaving] = useState(false)
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); const { error } = await client.rpc('schedule_tournament_match', { p_match_id: match.id, p_court_id: courtId, p_starts_at: zonedDateTimeToIso(date, startsAt, club.timezone), p_ends_at: zonedDateTimeToIso(date, endsAt, club.timezone) }); setSaving(false); if (error) onError(rpcError(error)); else await onSaved() }
  return <Modal title="Programar partido" onClose={onClose}><p>{entryName(match.entry_one_id)} vs {entryName(match.entry_two_id)}</p><form className="reservation-form" onSubmit={(event) => void submit(event)}><label>Cancha<select value={courtId} onChange={(event) => setCourtId(event.target.value)} required>{courts.filter((court) => court.active).map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select></label><label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><div className="time-fields"><label>Inicio<input type="time" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label><label>Fin<input type="time" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required /></label></div>{match.reservation_id && <button className="danger-button" type="button" onClick={async () => { const { error } = await client.rpc('cancel_tournament_match_schedule', { p_match_id: match.id }); if (error) onError(rpcError(error)); else await onSaved() }}>Cancelar programación</button>}<button disabled={saving}>{saving ? 'Guardando…' : 'Guardar programación'}</button></form></Modal>
}

function ResultModal({ client, match, entryName, onClose, onSaved, onError }: { client: SupabaseClient; match: TournamentMatch; entryName: (id: string | null) => string; onClose: () => void; onSaved: () => Promise<void>; onError: (message: string) => void }) {
  const [winner, setWinner] = useState(match.entry_one_id ?? ''); const [score, setScore] = useState(''); const [walkover, setWalkover] = useState(false); const [saving, setSaving] = useState(false)
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); const { error } = await client.rpc('record_tournament_match_result', { p_match_id: match.id, p_winner_entry_id: winner, p_score_text: score, p_is_walkover: walkover }); setSaving(false); if (error) onError(rpcError(error)); else await onSaved() }
  return <Modal title="Registrar resultado" onClose={onClose}><form className="reservation-form" onSubmit={(event) => void submit(event)}><label>Ganador<select value={winner} onChange={(event) => setWinner(event.target.value)}><option value={match.entry_one_id ?? ''}>{entryName(match.entry_one_id)}</option><option value={match.entry_two_id ?? ''}>{entryName(match.entry_two_id)}</option></select></label><label>Marcador <input placeholder="6-4 / 6-3" value={score} onChange={(event) => setScore(event.target.value)} /></label><label className="toggle-field"><input type="checkbox" checked={walkover} onChange={(event) => setWalkover(event.target.checked)} /> Walkover (W.O.)</label><button disabled={saving}>{saving ? 'Guardando…' : 'Confirmar resultado'}</button></form></Modal>
}

function TournamentEditModal({ client, tournament, onClose, onSaved, onError }: { client: SupabaseClient; tournament: Tournament; onClose: () => void; onSaved: () => Promise<void>; onError: (message: string) => void }) {
  const [draft, setDraft] = useState({ name: tournament.name, description: tournament.description ?? '', startsOn: tournament.starts_on, endsOn: tournament.ends_on }); const [saving, setSaving] = useState(false)
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); const { error } = await client.rpc('update_tournament', { p_tournament_id: tournament.id, p_name: draft.name, p_description: draft.description, p_starts_on: draft.startsOn, p_ends_on: draft.endsOn, p_status: tournament.status }); setSaving(false); if (error) onError(rpcError(error)); else await onSaved() }
  return <Modal title="Editar torneo" onClose={onClose}><form className="reservation-form" onSubmit={(event) => void submit(event)}><label>Nombre<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></label><label>Descripción opcional<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><div className="time-fields"><label>Inicio<input type="date" value={draft.startsOn} onChange={(event) => setDraft({ ...draft, startsOn: event.target.value })} required /></label><label>Finalización<input type="date" min={draft.startsOn} value={draft.endsOn} onChange={(event) => setDraft({ ...draft, endsOn: event.target.value })} required /></label></div><button disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button></form></Modal>
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="reservation-modal-backdrop" role="presentation"><section className="reservation-modal" role="dialog" aria-modal="true"><div className="modal-heading"><h2>{title}</h2><button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}>×</button></div>{children}</section></div> }
function statusLabel(status: Tournament['status']) { return ({ draft: 'Borrador', registration_open: 'Inscripciones abiertas', in_progress: 'En curso', completed: 'Finalizado', cancelled: 'Cancelado' })[status] }
