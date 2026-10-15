import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club, ClubMembershipRecord, ClubMembershipStatus, ClubPerson, Reservation } from '../../types/domain'
import { isoToDateAndTime } from '../reservations/reservationUtils'
import { MemberAccount } from '../fees/FinancePanel'
import { PersonCanteenAccount } from '../canteen/CanteenPanel'
import { PersonAccount } from '../account/PersonAccount'
import { Avatar, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Modal, PageHead, SegmentedTabs, SkeletonCards, StatStrip, TextArea, TextInput } from '../../design/ui'
import { MemberBadge } from '../../design/domain'
import { normalizeSearch, plural } from '../../design/format'
import { useAsyncAction } from '../../design/useAsyncAction'
import type { AdminSection } from '../shell/AdminShell'

type PeoplePanelProps = { client: SupabaseClient; club: Club; canManageMemberships: boolean; createRequest?: number; onCreateRequestHandled?: () => void; onNavigate?: (section: AdminSection) => void; onOpenCanteenPending?: (personName: string) => void }
type Filter = 'all' | 'members' | 'guests' | 'coaches' | 'inactive'
type MembershipChoice = 'none' | ClubMembershipStatus
export type PersonForm = { fullName: string; phone: string; email: string; notes: string; active: boolean; membership: MembershipChoice; memberSince: string }
type TournamentParticipation = { id: string; tournamentName: string; categoryName: string; modality: string; partnerName: string | null; status: string }
type Counts = { active: number; members: number; coaches: number }

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'members', label: 'Socios' },
  { id: 'guests', label: 'No socios' },
  { id: 'coaches', label: 'Profesores' },
  { id: 'inactive', label: 'Bajas' },
]

const personFields = 'id, club_id, full_name, phone, email, notes, active, created_at, updated_at'
const membershipFields = 'id, club_id, person_id, status, joined_on, created_at, updated_at'
const reservationFields = 'id, club_id, court_id, customer_name, person_id, starts_at, ends_at, status, occupation_type, block_reason, recurrence_series_id, notes, created_by, created_at, updated_at'

const monthYear = new Intl.DateTimeFormat('es-AR', { month: 'short', year: 'numeric' })
const since = (iso?: string | null) => (iso ? monthYear.format(new Date(`${iso.slice(0, 10)}T12:00:00`)).replace('.', '') : '')
const clubToday = (timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
const emptyForm = (today: string): PersonForm => ({ fullName: '', phone: '', email: '', notes: '', active: true, membership: 'none', memberSince: today })
const formFor = (person: ClubPerson, membership: ClubMembershipRecord | undefined, today: string): PersonForm => ({ fullName: person.full_name, phone: person.phone ?? '', email: person.email ?? '', notes: person.notes ?? '', active: person.active, membership: membership?.status ?? 'none', memberSince: membership?.joined_on ?? today })
const membershipText = (membership?: ClubMembershipRecord) => membership?.status === 'active' ? `Socio activo${membership.joined_on ? ` desde ${since(membership.joined_on)}` : ''}` : membership?.status === 'inactive' ? 'Socio inactivo' : 'No socio'

/** Alta y edición de ficha. La membresía solo se ofrece a quien puede administrarla (owner/admin). */
export function PersonEditor({ person, membership, today = '', canManageMemberships = false, people = [], onClose, onSave }: { person?: ClubPerson; membership?: ClubMembershipRecord; today?: string; canManageMemberships?: boolean; people?: ClubPerson[]; onClose: () => void; onSave: (form: PersonForm, keepOpen?: boolean) => Promise<string | null> }) {
  return (
    <Modal open onClose={onClose} variant="drawer" size="sm" eyebrow={person ? 'Editar ficha' : 'Alta rápida'} title={person ? person.full_name : 'Nuevo jugador'}>
      <PersonEditorBody key={person?.id ?? 'new'} person={person} membership={membership} today={today} canManageMemberships={canManageMemberships} people={people} onClose={onClose} onSave={onSave} />
    </Modal>
  )
}

function PersonEditorBody({ person, membership, today, canManageMemberships, people, onClose, onSave }: { person?: ClubPerson; membership?: ClubMembershipRecord; today: string; canManageMemberships: boolean; people: ClubPerson[]; onClose: () => void; onSave: (form: PersonForm, keepOpen?: boolean) => Promise<string | null> }) {
  const [form, setForm] = useState<PersonForm>(() => (person ? formFor(person, membership, today) : emptyForm(today)))
  const [showMore, setShowMore] = useState(Boolean(person?.email || person?.notes))
  const [touched, setTouched] = useState(false)
  const [another, setAnother] = useState(false)
  const action = useAsyncAction()
  const patch = (next: Partial<PersonForm>) => setForm((current) => ({ ...current, ...next }))

  const clean = form.fullName.trim().replace(/\s+/g, ' ')
  const duplicate = clean.length > 2 ? people.find((item) => item.id !== person?.id && normalizeSearch(item.full_name) === normalizeSearch(clean)) : undefined
  const nameError = touched && clean.length < 1 ? 'Indicá el nombre del jugador.' : undefined
  const emailError = touched && form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim()) ? 'Revisá el formato del email.' : undefined

  const submit = async (keepOpen: boolean) => {
    setTouched(true)
    if (clean.length < 1 || (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim()))) return
    const ok = await action.run(() => onSave(form, keepOpen))
    if (ok && keepOpen) { setForm(emptyForm(today)); setTouched(false); setShowMore(false); setAnother(true) }
  }
  const onFormSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void submit(false) }
  const choices: { id: MembershipChoice; label: string }[] = membership
    ? [{ id: 'active', label: 'Socio' }, { id: 'inactive', label: 'Socio inactivo' }]
    : [{ id: 'none', label: 'No socio' }, { id: 'active', label: 'Socio' }]

  return (
    <form className="res-form" noValidate onSubmit={onFormSubmit}>
      {another && <p className="inline-alert inline-alert-info" role="status"><Icon name="checkCircle" size={20} /><span>Ficha guardada. Cargá la siguiente.</span></p>}
      <Field label="Nombre completo" error={nameError} hint={duplicate ? undefined : 'Es lo único obligatorio.'}>
        {(id, describedBy) => <TextInput id={id} value={form.fullName} autoComplete="off" placeholder="Ej.: Lucía Ferreyra" aria-invalid={Boolean(nameError)} aria-describedby={describedBy} onChange={(event) => patch({ fullName: event.target.value })} data-autofocus />}
      </Field>
      {duplicate && (
        <div className="inline-alert inline-alert-warning" role="status">
          <Icon name="alert" size={20} />
          <div><strong>Ya existe una ficha con ese nombre</strong><p>{duplicate.full_name} · {duplicate.phone ?? 'sin teléfono'}. Si es la misma persona, usá esa ficha para no duplicar historial.</p></div>
        </div>
      )}
      <Field label="Teléfono" optional>{(id) => <TextInput id={id} type="tel" icon="phone" inputMode="tel" value={form.phone} placeholder="3496 00-0000" onChange={(event) => patch({ phone: event.target.value })} />}</Field>

      {canManageMemberships && (
        <fieldset className="form-block">
          <legend className="form-legend">Membresía</legend>
          <SegmentedTabs label="Membresía" stretch value={form.membership} onChange={(membershipChoice) => patch({ membership: membershipChoice })} items={choices} />
          {!membership && form.membership === 'active' && <Field label="Socio desde">{(id) => <TextInput id={id} type="date" value={form.memberSince} max={today} onChange={(event) => event.target.value && patch({ memberSince: event.target.value })} />}</Field>}
          <p className="field-hint">{form.membership === 'active' ? 'Recibe cuota mensual cuando se emiten las cuotas del período.' : form.membership === 'inactive' ? 'Conserva su historial de socio, sin cuotas nuevas.' : 'Puede reservar, jugar torneos y consumir en cantina.'}</p>
        </fieldset>
      )}

      {showMore ? (
        <>
          <Field label="Email de contacto" optional error={emailError}>{(id, describedBy) => <TextInput id={id} type="email" icon="mail" value={form.email} aria-invalid={Boolean(emailError)} aria-describedby={describedBy} onChange={(event) => patch({ email: event.target.value })} />}</Field>
          <Field label="Observaciones" optional>{(id) => <TextArea id={id} value={form.notes} placeholder="Ej.: menor, contacto de la familia, preferencias" onChange={(event) => patch({ notes: event.target.value })} />}</Field>
        </>
      ) : (
        <button type="button" className="link-btn link-btn-icon" onClick={() => setShowMore(true)}><Icon name="plus" size={18} />Email y observaciones</button>
      )}

      <div className="form-footer">
        {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardó la ficha</strong><p>{action.message}</p></div></div>}
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose} disabled={action.saving}>Volver</Button>
          {!person && <Button variant="secondary" onClick={() => void submit(true)} disabled={action.saving}>Guardar y cargar otro</Button>}
          <Button type="submit" variant="accent" icon={action.failed ? 'refresh' : 'check'} loading={action.saving}>{action.saving ? 'Guardando…' : action.failed ? 'Reintentar' : person ? 'Guardar cambios' : 'Crear jugador'}</Button>
        </div>
      </div>
    </form>
  )
}

function PersonRow({ person, membership, isCoach, onOpen }: { person: ClubPerson; membership?: ClubMembershipRecord; isCoach: boolean; onOpen: () => void }) {
  return (
    <div role="listitem">
      <button type="button" className={`person-row ${person.active ? '' : 'is-inactive'}`} onClick={onOpen}>
        <Avatar name={person.full_name} />
        <span className="person-row-main">
          <strong>{person.full_name}</strong>
          <span>{person.phone ?? 'Sin teléfono'}{isCoach ? ' · Profesor' : ''}</span>
        </span>
        <span className="person-row-member">
          <MemberBadge active={person.active} membership={membership?.status} />
          {membership?.status === 'active' && membership.joined_on && <small className="hide-mobile">desde {since(membership.joined_on)}</small>}
        </span>
        <Icon name="chevronRight" size={18} className="row-chevron" />
      </button>
    </div>
  )
}

export function PeoplePanel({ client, club, canManageMemberships, createRequest = 0, onCreateRequestHandled, onNavigate, onOpenCanteenPending }: PeoplePanelProps) {
  const [people, setPeople] = useState<ClubPerson[]>([])
  const [memberships, setMemberships] = useState<ClubMembershipRecord[]>([])
  const [coachIds, setCoachIds] = useState<Set<string>>(new Set())
  const [counts, setCounts] = useState<Counts | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [editor, setEditor] = useState<ClubPerson | 'new' | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loadingReservations, setLoadingReservations] = useState(false)
  const [participations, setParticipations] = useState<TournamentParticipation[]>([])
  const loadSeq = useRef(0)
  const today = clubToday(club.timezone)

  useEffect(() => { if (createRequest) { setEditor('new'); onCreateRequestHandled?.() } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequest])

  const load = async (searchTerm = search) => {
    const seq = ++loadSeq.current
    setStatus('loading')
    const term = searchTerm.trim().replace(/[,()%]/g, ' ')
    const basePeopleQuery = client.from('club_people').select(personFields).eq('club_id', club.id)
    const peopleQuery = term ? basePeopleQuery.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`) : basePeopleQuery
    const { data: personRows, error: peopleError } = await peopleQuery.order('full_name', { ascending: true }).limit(100)
    if (seq !== loadSeq.current) return
    if (peopleError) { setStatus('error'); return }
    const nextPeople = (personRows ?? []) as ClubPerson[]
    const [membershipResult, coachResult, activeCount, memberCount] = await Promise.all([
      nextPeople.length === 0 ? Promise.resolve({ data: [], error: null }) : client.from('club_memberships').select(membershipFields).eq('club_id', club.id).in('person_id', nextPeople.map((person) => person.id)),
      client.from('club_coaches').select('person_id, active').eq('club_id', club.id),
      client.from('club_people').select('id', { count: 'exact', head: true }).eq('club_id', club.id).eq('active', true),
      client.from('club_memberships').select('id', { count: 'exact', head: true }).eq('club_id', club.id).eq('status', 'active'),
    ])
    if (seq !== loadSeq.current) return
    if (membershipResult.error) { setStatus('error'); return }
    const activeCoaches = ((coachResult.data ?? []) as { person_id: string; active: boolean }[]).filter((coach) => coach.active).map((coach) => coach.person_id)
    setPeople(nextPeople)
    setMemberships((membershipResult.data ?? []) as ClubMembershipRecord[])
    setCoachIds(new Set(coachResult.error ? [] : activeCoaches))
    setCounts(activeCount.error || memberCount.error ? null : { active: activeCount.count ?? 0, members: memberCount.count ?? 0, coaches: coachResult.error ? 0 : activeCoaches.length })
    setStatus('ready')
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(search) }, search ? 250 : 0)
    return () => window.clearTimeout(timer) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, club.id, search])

  const detail = people.find((person) => person.id === detailId) ?? null
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
  }, [client, club.id, detail?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!detail) return
    let cancelled = false
    const loadParticipations = async () => {
      const { data: memberRows } = await client.from('tournament_entry_members').select('entry_id, category_id, person_name_snapshot').eq('club_id', club.id).eq('person_id', detail.id)
      if (cancelled || !memberRows?.length) { if (!cancelled) setParticipations([]); return }
      const entryIds = memberRows.map((item) => item.entry_id as string)
      const categoryIds = [...new Set(memberRows.map((item) => item.category_id as string))]
      const [{ data: entryRows }, { data: categoryRows }] = await Promise.all([
        client.from('tournament_entries').select('id, display_name').in('id', entryIds),
        client.from('tournament_categories').select('id, tournament_id, name, modality, status').in('id', categoryIds),
      ])
      if (cancelled) return
      const tournamentIds = [...new Set((categoryRows ?? []).map((item) => item.tournament_id as string))]
      const { data: tournamentRows } = tournamentIds.length ? await client.from('tournaments').select('id, name').in('id', tournamentIds) : { data: [] }
      if (cancelled) return
      const entriesById = new Map((entryRows ?? []).map((item) => [item.id as string, item.display_name as string]))
      const categoriesById = new Map((categoryRows ?? []).map((item) => [item.id as string, item]))
      const tournamentsById = new Map((tournamentRows ?? []).map((item) => [item.id as string, item.name as string]))
      setParticipations(memberRows.map((item) => { const category = categoriesById.get(item.category_id as string) as { tournament_id: string; name: string; modality: string; status: string } | undefined; const entryName = entriesById.get(item.entry_id as string) ?? ''; return { id: item.entry_id as string, tournamentName: category ? tournamentsById.get(category.tournament_id) ?? 'Torneo' : 'Torneo', categoryName: category?.name ?? 'Categoría', modality: category?.modality ?? 'singles', partnerName: category?.modality === 'doubles' ? entryName.split(' / ').filter((name) => name !== item.person_name_snapshot).join(' / ') || null : null, status: category?.status ?? 'open' } }))
    }
    void loadParticipations()
    return () => { cancelled = true }
  }, [client, club.id, detail?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const membershipByPerson = useMemo(() => new Map(memberships.map((membership) => [membership.person_id, membership])), [memberships])
  const tests: Record<Filter, (person: ClubPerson) => boolean> = {
    all: (person) => person.active,
    members: (person) => person.active && membershipByPerson.get(person.id)?.status === 'active',
    guests: (person) => person.active && membershipByPerson.get(person.id)?.status !== 'active',
    coaches: (person) => person.active && coachIds.has(person.id),
    inactive: (person) => !person.active,
  }
  const term = normalizeSearch(search)
  const digits = term.replace(/\D/g, '')
  const visible = people
    .filter(tests[filter])
    .filter((person) => !term || normalizeSearch(person.full_name).includes(term) || (digits.length > 2 && (person.phone ?? '').replace(/\D/g, '').includes(digits)))
  const groups = visible.reduce<{ letter: string; people: ClubPerson[] }[]>((acc, person) => {
    const letter = person.full_name.trim()[0]?.toUpperCase() ?? '#'
    const last = acc.at(-1)
    if (last?.letter === letter) last.people.push(person)
    else acc.push({ letter, people: [person] })
    return acc
  }, [])
  const count = (filterId: Filter) => people.filter(tests[filterId]).length

  const savePerson = async (form: PersonForm, keepOpen = false): Promise<string | null> => {
    const target = editor
    const payload = { full_name: form.fullName.trim().replace(/\s+/g, ' '), phone: form.phone.trim() || null, email: form.email.trim() || null, notes: form.notes.trim() || null, active: form.active }
    let personId: string
    if (target === 'new' || target === null) {
      const { data, error } = await client.from('club_people').insert({ club_id: club.id, ...payload }).select('id').single()
      if (error || !data) return 'No pudimos guardar el jugador. Revisá los datos e intentá nuevamente.'
      personId = (data as { id: string }).id
    } else {
      const { error } = await client.from('club_people').update(payload).eq('id', target.id).eq('club_id', club.id)
      if (error) return 'No pudimos guardar el jugador. Revisá los datos e intentá nuevamente.'
      personId = target.id
    }
    // Membresía: solo owner/admin. La ficha ya está guardada; si esta segunda escritura falla se avisa sin perder la ficha.
    let warning: string | null = null
    if (canManageMemberships) {
      const existing = membershipByPerson.get(personId)
      if (existing && form.membership !== 'none' && existing.status !== form.membership) {
        const { error } = await client.from('club_memberships').update({ status: form.membership }).eq('id', existing.id).eq('club_id', club.id)
        if (error) warning = 'La ficha se guardó, pero no pudimos actualizar la membresía.'
      } else if (!existing && form.membership === 'active') {
        const { error } = await client.from('club_memberships').insert({ club_id: club.id, person_id: personId, status: 'active', joined_on: form.memberSince || clubToday(club.timezone) })
        if (error) warning = 'La ficha se creó, pero no pudimos registrar la membresía. Convertila en socio desde su ficha.'
      }
    }
    if (!keepOpen) setEditor(null)
    setNotice(warning ? { tone: 'danger', text: warning } : { tone: 'success', text: target === 'new' || target === null ? 'Jugador creado.' : 'Jugador actualizado.' })
    await load()
    return null
  }

  const changeMembership = async (person: ClubPerson, membership: ClubMembershipRecord | undefined, nextStatus: ClubMembershipStatus) => {
    if (!canManageMemberships) return
    const operation = membership ? client.from('club_memberships').update({ status: nextStatus }).eq('id', membership.id).eq('club_id', club.id) : client.from('club_memberships').insert({ club_id: club.id, person_id: person.id, status: 'active', joined_on: clubToday(club.timezone) })
    const { error } = await operation
    if (error) { setNotice({ tone: 'danger', text: 'No pudimos actualizar la membresía. Intentá nuevamente.' }); return }
    setNotice({ tone: 'success', text: nextStatus === 'active' ? 'Membresía activa.' : 'Membresía inactiva.' })
    await load()
  }
  const toggleActive = async (person: ClubPerson): Promise<string | null> => {
    const { error } = await client.from('club_people').update({ active: !person.active }).eq('id', person.id).eq('club_id', club.id)
    if (error) return 'No pudimos actualizar la ficha. Intentá nuevamente.'
    setNotice({ tone: 'success', text: person.active ? 'Ficha dada de baja. Se conserva su historial.' : 'Ficha reactivada.' })
    await load()
    return null
  }

  const editing = editor && editor !== 'new' ? editor : undefined
  return (
    <div className="module">
      <PageHead
        eyebrow="Club"
        title="Jugadores y socios"
        meta={counts ? `${plural(counts.active, 'ficha activa', 'fichas activas')} · ${plural(counts.members, 'socio', 'socios')}` : 'Fichas del club'}
        actions={<Button variant="accent" icon="userPlus" onClick={() => setEditor('new')}>Nuevo jugador</Button>}
      />

      {notice && <p className={`inline-alert ${notice.tone === 'danger' ? 'inline-alert-danger' : 'inline-alert-success'}`} role={notice.tone === 'danger' ? 'alert' : 'status'}><Icon name={notice.tone === 'danger' ? 'alert' : 'checkCircle'} size={20} /><span>{notice.text}</span></p>}

      {counts && (
        <StatStrip
          label="Resumen de fichas"
          items={[
            { id: 'active', label: 'Fichas activas', value: counts.active, selected: filter === 'all', onClick: () => setFilter('all') },
            { id: 'members', label: 'Socios activos', value: counts.members, tone: 'green', selected: filter === 'members', onClick: () => setFilter(filter === 'members' ? 'all' : 'members') },
            { id: 'coaches', label: 'Profesores', value: counts.coaches, tone: 'ball', selected: filter === 'coaches', onClick: () => setFilter(filter === 'coaches' ? 'all' : 'coaches') },
          ]}
        />
      )}

      <div className="list-toolbar">
        <TextInput icon="search" type="search" placeholder="Buscar por nombre o teléfono" aria-label="Buscar jugador" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="chip-row chip-row-scroll" role="group" aria-label="Filtrar fichas">
          {FILTERS.map((item) => (
            <button key={item.id} type="button" className={`chip ${filter === item.id ? 'is-selected' : ''}`} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
              <span>{item.label}</span>
              <span className="chip-count">{count(item.id)}</span>
            </button>
          ))}
        </div>
      </div>

      {status === 'error' ? <ErrorState title="No pudimos cargar los jugadores" onRetry={() => void load()} />
        : status === 'loading' && people.length === 0 ? <SkeletonCards count={6} height={68} />
          : visible.length === 0 ? (
            <div className="card">
              <EmptyState
                icon="users"
                title={people.length === 0 && !search.trim() ? 'Todavía no hay fichas' : 'Nadie coincide con la búsqueda'}
                body={people.length === 0 && !search.trim() ? 'Cargá la primera con solo el nombre. Teléfono y membresía son opcionales.' : 'Probá con otro nombre, otro filtro o creá la ficha.'}
                action={<Button variant="accent" icon="userPlus" onClick={() => setEditor('new')}>Nuevo jugador</Button>}
              />
            </div>
          ) : (
            <>
              <div className="people-table is-lean" role="list" aria-label="Fichas" aria-busy={status === 'loading'}>
                <div className="people-head" aria-hidden="true">
                  <span>Nombre</span><span>Membresía</span>
                </div>
                {groups.map((group) => (
                  <section key={group.letter} className="people-group" aria-label={`Letra ${group.letter}`}>
                    <p className="people-letter" aria-hidden="true">{group.letter}</p>
                    {group.people.map((person) => <PersonRow key={person.id} person={person} membership={membershipByPerson.get(person.id)} isCoach={coachIds.has(person.id)} onOpen={() => setDetailId(person.id)} />)}
                  </section>
                ))}
              </div>
              {people.length >= 100 && <p className="detail-footnote"><Icon name="info" size={16} />Se muestran hasta 100 fichas: usá la búsqueda para ubicar otra.</p>}
            </>
          )}

      {detail && (
        <PersonDetail
          client={client} club={club} person={detail} membership={membershipByPerson.get(detail.id)} isCoach={coachIds.has(detail.id)}
          reservations={reservations} participations={participations} loadingReservations={loadingReservations} canManageMemberships={canManageMemberships}
          onClose={() => setDetailId(null)} onEdit={() => { setDetailId(null); setEditor(detail) }}
          onMembershipChange={(nextStatus) => void changeMembership(detail, membershipByPerson.get(detail.id), nextStatus)}
          onToggleActive={() => toggleActive(detail)} onNavigate={onNavigate} onOpenCanteenPending={onOpenCanteenPending}
        />
      )}
      {editor && <PersonEditor person={editing} membership={editing ? membershipByPerson.get(editing.id) : undefined} today={today} canManageMemberships={canManageMemberships} people={people} onClose={() => setEditor(null)} onSave={savePerson} />}
    </div>
  )
}

function ReservationList({ title, items, timezone }: { title: string; items: Reservation[]; timezone: string }) {
  return (
    <section className="detail-section" aria-label={title}>
      <h3 className="detail-section-title">{title}</h3>
      {items.length === 0 ? <p className="muted">No hay reservas vinculadas.</p> : (
        <ul className="mini-list">
          {items.map((item) => {
            const start = isoToDateAndTime(item.starts_at, timezone)
            const end = isoToDateAndTime(item.ends_at, timezone)
            return (
              <li key={item.id}>
                <span><b>{start.date}</b> · <span className="num">{start.time}–{end.time}</span></span>
                <Badge tone={item.status === 'cancelled' ? 'neutral' : 'success'}>{item.status === 'cancelled' ? 'Cancelada' : item.status === 'active' ? 'Bloqueo activo' : 'Confirmada'}</Badge>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function PersonDetail({ client, club, person, membership, isCoach, reservations, participations, loadingReservations, canManageMemberships, onClose, onEdit, onMembershipChange, onToggleActive, onNavigate, onOpenCanteenPending }: {
  client: SupabaseClient; club: Club; person: ClubPerson; membership?: ClubMembershipRecord; isCoach: boolean; reservations: Reservation[]; participations: TournamentParticipation[]
  loadingReservations: boolean; canManageMemberships: boolean; onClose: () => void; onEdit: () => void; onMembershipChange: (status: ClubMembershipStatus) => void
  onToggleActive: () => Promise<string | null>; onNavigate?: (section: AdminSection) => void; onOpenCanteenPending?: (personName: string) => void
}) {
  const [confirm, setConfirm] = useState(false)
  const action = useAsyncAction()
  const now = Date.now()
  const upcoming = reservations.filter((item) => item.status !== 'cancelled' && new Date(item.ends_at).getTime() >= now).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const previous = reservations.filter((item) => !upcoming.includes(item))
  const confirmToggle = async () => { if (await action.run(onToggleActive)) setConfirm(false) }

  return (
    <>
      <Modal open={!confirm} onClose={onClose} variant="drawer" size="sm" eyebrow="Ficha" title={person.full_name}
        footer={
          <div className="form-actions">
            <Button variant="ghost" icon={person.active ? 'power' : 'undo'} onClick={() => { action.reset(); setConfirm(true) }}>{person.active ? 'Dar de baja' : 'Reactivar'}</Button>
            <Button variant="primary" icon="edit" onClick={onEdit}>Editar jugador</Button>
          </div>
        }
      >
        <div className="detail">
          <div className="profile-hero">
            <Avatar name={person.full_name} size="lg" />
            <div className="profile-hero-main">
              <div className="badge-row">
                <MemberBadge active={person.active} membership={membership?.status} />
                {isCoach && <Badge tone="info" icon="school">Profesor</Badge>}
              </div>
              <div className="profile-contact">
                {person.phone ? <a href={`tel:${person.phone.replace(/\s|-/g, '')}`} className="contact-link"><Icon name="phone" size={16} />{person.phone}</a> : <span className="muted">Sin teléfono</span>}
                {person.email && <a href={`mailto:${person.email}`} className="contact-link"><Icon name="mail" size={16} />{person.email}</a>}
              </div>
            </div>
          </div>

          {person.active && canManageMemberships && (
            <section className="detail-section" aria-labelledby="pd-member">
              <h3 id="pd-member" className="detail-section-title">Membresía</h3>
              <div className="detail-actions">
                {membership?.status === 'active'
                  ? <Button variant="secondary" icon="power" onClick={() => onMembershipChange('inactive')}>Desactivar membresía</Button>
                  : <Button variant="primary" icon="check" onClick={() => onMembershipChange('active')}>{membership ? 'Activar membresía' : 'Convertir en socio'}</Button>}
                {membership?.status === 'active' && onNavigate && <Button variant="ghost" icon="wallet" onClick={() => { onClose(); onNavigate('fees') }}>Ir a cuotas</Button>}
              </div>
            </section>
          )}

          {canManageMemberships && <PersonAccount client={client} club={club} personId={person.id} onClose={onClose} onOpenCanteen={() => onOpenCanteenPending?.(person.full_name)} />}
          <MemberAccount client={client} club={club} membership={membership} canManage={canManageMemberships} />
          <PersonCanteenAccount client={client} club={club} personId={person.id} />

          <ReservationList title="Próximas reservas" items={loadingReservations ? [] : upcoming} timezone={club.timezone} />
          {loadingReservations ? <p className="muted">Cargando reservas vinculadas…</p> : <ReservationList title="Reservas anteriores" items={previous} timezone={club.timezone} />}

          <section className="detail-section" aria-labelledby="pd-tour">
            <h3 id="pd-tour" className="detail-section-title">Torneos</h3>
            {participations.length === 0 ? <p className="muted">No hay participaciones registradas.</p> : (
              <ul className="mini-list">
                {participations.map((item) => <li key={item.id}><span><b>{item.tournamentName}</b> · {item.categoryName} ({item.modality === 'singles' ? 'Singles' : 'Dobles'}){item.partnerName ? ` · Pareja: ${item.partnerName}` : ''}</span><Badge tone={item.status === 'completed' ? 'success' : 'neutral'}>{item.status === 'completed' ? 'Finalizado' : item.status === 'fixture_generated' ? 'En curso' : 'Inscripto'}</Badge></li>)}
              </ul>
            )}
          </section>

          <section className="detail-section" aria-labelledby="pd-data">
            <h3 id="pd-data" className="detail-section-title">Datos</h3>
            <dl className="detail-list">
              <div><dt>Estado</dt><dd>{person.active ? 'Activo' : 'Inactivo'}</dd></div>
              <div><dt>Membresía</dt><dd>{membershipText(membership)}</dd></div>
              <div><dt>Alta de ficha</dt><dd>{since(person.created_at)}</dd></div>
              {person.notes && <div><dt>Observaciones</dt><dd>{person.notes}</dd></div>}
            </dl>
            <p className="detail-footnote"><Icon name="info" size={16} />La ficha no exige cuenta: puede tener turnos aunque nunca inicie sesión.</p>
          </section>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirm}
        title={person.active ? `¿Dar de baja a ${person.full_name}?` : `¿Reactivar a ${person.full_name}?`}
        confirmLabel={person.active ? 'Dar de baja' : 'Reactivar'}
        tone={person.active ? 'danger' : 'primary'}
        icon={person.active ? 'power' : 'undo'}
        status={action.status}
        errorBody={action.message ?? undefined}
        onConfirm={() => void confirmToggle()}
        onClose={() => setConfirm(false)}
      >
        <p className="muted">{person.active ? 'Es una baja lógica: reservas, cuotas y consumos quedan en el historial. Podés reactivarla cuando quieras.' : 'Vuelve a aparecer en búsquedas, reservas y cantina.'}</p>
      </ConfirmDialog>
    </>
  )
}
