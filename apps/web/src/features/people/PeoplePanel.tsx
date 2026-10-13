import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club, ClubMembershipRecord, ClubPerson, Reservation } from '../../types/domain'
import { isoToDateAndTime } from '../reservations/reservationUtils'
import { MemberAccount } from '../fees/FinancePanel'

type PeoplePanelProps = { client: SupabaseClient; club: Club; canManageMemberships: boolean }
type Filter = 'all' | 'active-members' | 'non-members' | 'inactive'
type PersonForm = { fullName: string; phone: string; email: string; notes: string; active: boolean }

const personFields = 'id, club_id, full_name, phone, email, notes, active, created_at, updated_at'
const membershipFields = 'id, club_id, person_id, status, joined_on, created_at, updated_at'
const reservationFields = 'id, club_id, court_id, customer_name, person_id, starts_at, ends_at, status, occupation_type, block_reason, recurrence_series_id, notes, created_by, created_at, updated_at'

function emptyForm(): PersonForm { return { fullName: '', phone: '', email: '', notes: '', active: true } }
function formFor(person: ClubPerson): PersonForm { return { fullName: person.full_name, phone: person.phone ?? '', email: person.email ?? '', notes: person.notes ?? '', active: person.active } }
function membershipLabel(membership?: ClubMembershipRecord) { return membership?.status === 'active' ? 'Socio activo' : membership?.status === 'inactive' ? 'Socio inactivo' : 'No socio' }
function clubToday(timezone: string) { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()) }

export function PersonEditor({ person, onClose, onSave }: { person?: ClubPerson; onClose: () => void; onSave: (form: PersonForm) => Promise<string | null> }) {
  const [form, setForm] = useState(person ? formFor(person) : emptyForm)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.fullName.trim()) return setFeedback('Indicá el nombre del jugador.')
    setSaving(true); setFeedback(null)
    const error = await onSave(form)
    setSaving(false)
    if (error) setFeedback(error)
  }
  return <div className="reservation-modal-backdrop" role="presentation"><section className="reservation-modal" role="dialog" aria-modal="true" aria-labelledby="person-editor-title">
    <div className="modal-heading"><div><p className="eyebrow">Jugadores</p><h2 id="person-editor-title">{person ? 'Editar jugador' : 'Nuevo jugador'}</h2></div><button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}>×</button></div>
    <form className="reservation-form" onSubmit={(event) => void submit(event)}>
      <label>Nombre completo<input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required autoFocus /></label>
      <label>Teléfono <span className="optional-label">(opcional)</span><input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
      <label>Email <span className="optional-label">(opcional)</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
      <label>Notas <span className="optional-label">(opcional)</span><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={3} /></label>
      {person && <label className="toggle-field"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Jugador activo</label>}
      {feedback && <p className="form-error" role="alert">{feedback}</p>}
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Volver</button><button type="submit" disabled={saving}>{saving ? 'Guardando…' : person ? 'Guardar cambios' : 'Crear jugador'}</button></div>
    </form>
  </section></div>
}

function PersonDetail({ client, club, person, membership, reservations, timezone, loadingReservations, canManageMemberships, onClose, onEdit, onMembershipChange }: { client: SupabaseClient; club: Club; person: ClubPerson; membership?: ClubMembershipRecord; reservations: Reservation[]; timezone: string; loadingReservations: boolean; canManageMemberships: boolean; onClose: () => void; onEdit: () => void; onMembershipChange: (status: 'active' | 'inactive') => void }) {
  const now = Date.now()
  const upcoming = reservations.filter((item) => new Date(item.ends_at).getTime() >= now)
  const previous = reservations.filter((item) => new Date(item.ends_at).getTime() < now)
  const reservationList = (items: Reservation[], title: string) => <section className="person-reservations"><h3>{title}</h3>{items.length === 0 ? <p className="field-help">No hay reservas vinculadas.</p> : <ul>{items.map((item) => <li key={item.id}><strong>{isoToDateAndTime(item.starts_at, timezone).date}</strong> · {isoToDateAndTime(item.starts_at, timezone).time}–{isoToDateAndTime(item.ends_at, timezone).time} <span>{item.status === 'cancelled' ? 'Cancelada' : item.status === 'active' ? 'Bloqueo activo' : 'Confirmada'}</span></li>)}</ul>}</section>
  return <div className="reservation-modal-backdrop" role="presentation"><section className="reservation-modal person-detail" role="dialog" aria-modal="true" aria-labelledby="person-detail-title">
    <div className="modal-heading"><div><p className="eyebrow">Ficha del jugador</p><h2 id="person-detail-title">{person.full_name}</h2></div><button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}>×</button></div>
    <dl className="person-details"><div><dt>Estado</dt><dd>{person.active ? 'Activo' : 'Inactivo'}</dd></div><div><dt>Condición</dt><dd>{membershipLabel(membership)}</dd></div>{person.phone && <div><dt>Teléfono</dt><dd>{person.phone}</dd></div>}{person.email && <div><dt>Email</dt><dd>{person.email}</dd></div>}{person.notes && <div><dt>Notas</dt><dd>{person.notes}</dd></div>}</dl>
    {canManageMemberships && <div className="membership-actions">{membership?.status === 'active' ? <button className="secondary-button" type="button" onClick={() => onMembershipChange('inactive')}>Desactivar membresía</button> : <button type="button" onClick={() => onMembershipChange('active')}>{membership ? 'Activar membresía' : 'Convertir en socio'}</button>}</div>}
    <div className="person-detail-actions"><button className="secondary-button" type="button" onClick={onEdit}>Editar jugador</button></div>
    <MemberAccount client={client} club={club} membership={membership} canManage={canManageMemberships} />
    {loadingReservations ? <p className="field-help">Cargando reservas vinculadas…</p> : <>{reservationList(upcoming, 'Próximas reservas')}{reservationList(previous, 'Reservas anteriores')}</>}
  </section></div>
}

export function PeoplePanel({ client, club, canManageMemberships }: PeoplePanelProps) {
  const [people, setPeople] = useState<ClubPerson[]>([])
  const [memberships, setMemberships] = useState<ClubMembershipRecord[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [editor, setEditor] = useState<ClubPerson | 'new' | null>(null)
  const [detail, setDetail] = useState<ClubPerson | null>(null)
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loadingReservations, setLoadingReservations] = useState(false)

  const load = async (searchTerm = search) => {
    setStatus('loading')
    const term = searchTerm.trim().replace(/[,()]/g, ' ')
    const basePeopleQuery = client.from('club_people').select(personFields).eq('club_id', club.id)
    const peopleQuery = term ? basePeopleQuery.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`) : basePeopleQuery
    const { data: personRows, error: peopleError } = await peopleQuery.order('full_name', { ascending: true }).limit(100)
    if (peopleError) { setFeedback('No pudimos cargar los jugadores de este club.'); setStatus('error'); return }
    const nextPeople = (personRows ?? []) as ClubPerson[]
    const { data: membershipRows, error: membershipsError } = nextPeople.length === 0 ? { data: [], error: null } : await client.from('club_memberships').select(membershipFields).eq('club_id', club.id).in('person_id', nextPeople.map((person) => person.id))
    if (membershipsError) { setFeedback('No pudimos cargar la condición de socio.'); setStatus('error'); return }
    setPeople(nextPeople); setMemberships((membershipRows ?? []) as ClubMembershipRecord[]); setStatus('ready')
  }
  useEffect(() => { void load(search) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, club.id, search])
  useEffect(() => {
    if (!detail) return
    let cancelled = false
    const loadReservations = async () => {
      setLoadingReservations(true)
      const { data, error } = await client.from('reservations').select(reservationFields).eq('club_id', club.id).eq('person_id', detail.id).order('starts_at', { ascending: false }).limit(100)
      if (!cancelled) { setReservations(error ? [] : (data ?? []) as Reservation[]); setLoadingReservations(false) }
    }
    void loadReservations()
    return () => { cancelled = true }
  }, [client, club.id, detail])
  const membershipByPerson = useMemo(() => new Map(memberships.map((membership) => [membership.person_id, membership])), [memberships])
  const visiblePeople = useMemo(() => {
    const text = search.trim().toLocaleLowerCase('es')
    return people.filter((person) => {
      const membership = membershipByPerson.get(person.id)
      const matchesSearch = !text || person.full_name.toLocaleLowerCase('es').includes(text) || (person.phone ?? '').toLocaleLowerCase('es').includes(text)
      const matchesFilter = filter === 'all' || filter === 'active-members' && membership?.status === 'active' || filter === 'non-members' && !membership || filter === 'inactive' && !person.active
      return matchesSearch && matchesFilter
    })
  }, [people, membershipByPerson, filter, search])
  const savePerson = async (form: PersonForm) => {
    const payload = { full_name: form.fullName.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null, notes: form.notes.trim() || null, active: form.active }
    const operation = editor === 'new' ? client.from('club_people').insert({ club_id: club.id, ...payload }) : client.from('club_people').update(payload).eq('id', editor?.id ?? '').eq('club_id', club.id)
    const { error } = await operation
    if (error) return 'No pudimos guardar el jugador. Revisá los datos e intentá nuevamente.'
    setEditor(null); setFeedback(editor === 'new' ? 'Jugador creado.' : 'Jugador actualizado.'); await load(); return null
  }
  const changeMembership = async (person: ClubPerson, membership: ClubMembershipRecord | undefined, nextStatus: 'active' | 'inactive') => {
    if (!canManageMemberships) return
    const operation = membership ? client.from('club_memberships').update({ status: nextStatus }).eq('id', membership.id).eq('club_id', club.id) : client.from('club_memberships').insert({ club_id: club.id, person_id: person.id, status: 'active', joined_on: clubToday(club.timezone) })
    const { error } = await operation
    if (error) { setFeedback('No pudimos actualizar la membresía. Intentá nuevamente.'); return }
    setFeedback(nextStatus === 'active' ? 'Membresía activa.' : 'Membresía inactiva.'); await load()
  }
  const selectedMembership = detail ? membershipByPerson.get(detail.id) : undefined
  return <section className="people-section" aria-labelledby="people-title">
    <div className="section-heading"><div><p className="eyebrow">Club</p><h2 id="people-title">Jugadores</h2></div><p>Registrá fichas sin exigir una cuenta de acceso. Se muestran hasta 100 resultados; usá la búsqueda para ubicar una ficha.</p></div>
    <div className="people-controls"><label>Buscar por nombre o teléfono<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ej. Martín o 11 5555" /></label><label>Filtro<select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}><option value="all">Todos</option><option value="active-members">Socios activos</option><option value="non-members">No socios</option><option value="inactive">Inactivos</option></select></label><button type="button" onClick={() => setEditor('new')}>Nuevo jugador</button></div>
    {feedback && <p className="form-success" role="status">{feedback}</p>}
    {status === 'loading' ? <p className="calendar-loading" role="status">Cargando jugadores…</p> : status === 'error' ? <p className="form-error" role="alert">{feedback}</p> : <div className="people-list">{visiblePeople.length === 0 ? <p className="screen-message">No encontramos jugadores con esos criterios.</p> : visiblePeople.map((person) => { const membership = membershipByPerson.get(person.id); return <button className="person-row" type="button" key={person.id} onClick={() => setDetail(person)}><span><strong>{person.full_name}</strong>{person.phone && <small>{person.phone}</small>}</span><span className="person-badges"><em className={person.active ? 'person-state active' : 'person-state'}>{person.active ? 'Activo' : 'Inactivo'}</em><em className={`membership-state ${membership?.status ?? 'none'}`}>{membershipLabel(membership)}</em></span></button> })}</div>}
    {editor && <PersonEditor person={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSave={savePerson} />}
    {detail && <PersonDetail client={client} club={club} person={detail} membership={selectedMembership} reservations={reservations} timezone={club.timezone} loadingReservations={loadingReservations} canManageMemberships={canManageMemberships} onClose={() => setDetail(null)} onEdit={() => { setDetail(null); setEditor(detail) }} onMembershipChange={(nextStatus) => void changeMembership(detail, selectedMembership, nextStatus)} />}
  </section>
}
