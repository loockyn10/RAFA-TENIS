import { useMemo, useState } from 'react'
import { balanceCents, NOW, TODAY, type Membership, type Person } from '../../data/mock'
import { MemberBadge } from '../../components/domain'
import { Avatar, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Modal, PageHead, SegmentedTabs, SkeletonCards, StatStrip, TextArea, TextInput } from '../../components/ui'
import { useAdmin } from '../../lib/admin'
import { useAction, useCourts, useIntent, usePeople } from '../../lib/data'
import { dueBalance, dueStatus, DUE_STATUS_LABEL, periodLabel, personBalance } from '../../lib/dues'
import { formatARS, plural } from '../../lib/format'
import { useProto, useScreenState } from '../../lib/proto'
import { useStore } from '../../lib/store'
import { capitalize, dateShort, hhmm, relativeDay, weekdayShort } from '../../lib/time'

type Filter = 'all' | 'members' | 'guests' | 'debt' | 'account' | 'coaches' | 'inactive'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'members', label: 'Socios' },
  { id: 'guests', label: 'No socios' },
  { id: 'debt', label: 'Con saldo' },
  { id: 'account', label: 'Con cuenta' },
  { id: 'coaches', label: 'Profesores' },
  { id: 'inactive', label: 'Bajas' },
]

const monthYear = new Intl.DateTimeFormat('es-AR', { month: 'short', year: 'numeric' })
const since = (iso?: string) => (iso ? monthYear.format(new Date(`${iso}T12:00:00`)).replace('.', '') : '')

type Fact = { duesCents: number; duesMonths: number; canteenCents: number; next?: { date: string; start: number; label: string } }

/** Saldos y próximos turnos por persona, calculados una vez para toda la lista. */
function usePeopleFacts() {
  const { state } = useStore()
  return useMemo(() => {
    const facts = new Map<string, Fact>()
    state.people.forEach((person) => {
      const dues = personBalance(person.id, state.dues, state.duePayments)
      const canteenCents = state.sales.filter((sale) => sale.personId === person.id).reduce((sum, sale) => sum + balanceCents(sale), 0)
      facts.set(person.id, { duesCents: dues.cents, duesMonths: dues.months, canteenCents })
    })
    state.occupations
      .filter((item) => item.date > TODAY || (item.date === TODAY && item.end > NOW))
      .sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1))
      .forEach((item) => {
        const ids = item.kind === 'lesson' ? item.studentIds ?? [] : item.personId ? [item.personId] : []
        ids.forEach((id) => {
          const fact = facts.get(id)
          if (fact && !fact.next) fact.next = { date: item.date, start: item.start, label: item.kind === 'lesson' ? 'Clase' : item.kind === 'match' ? 'Partido' : 'Turno' }
        })
      })
    return facts
  }, [state.people, state.dues, state.duePayments, state.sales, state.occupations])
}

export function Players() {
  const { dataState, retry } = useScreenState()
  const { people } = usePeople()
  const facts = usePeopleFacts()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [form, setForm] = useState<{ editing?: Person } | null>(null)

  useIntent(['newPlayer', 'player'], (intent) => {
    if (intent.kind === 'newPlayer') setForm({})
    else setOpenId(intent.id)
  })

  const list = dataState === 'empty' ? [] : people
  const fact = (id: string): Fact => facts.get(id) ?? { duesCents: 0, duesMonths: 0, canteenCents: 0 }
  const count = (test: (person: Person) => boolean) => list.filter(test).length
  const tests: Record<Filter, (person: Person) => boolean> = {
    all: (person) => person.active,
    members: (person) => person.active && person.membership === 'active',
    guests: (person) => person.active && person.membership !== 'active',
    debt: (person) => person.active && fact(person.id).duesCents + fact(person.id).canteenCents > 0,
    account: (person) => person.active && Boolean(person.hasAccount),
    coaches: (person) => person.active && Boolean(person.coach),
    inactive: (person) => !person.active,
  }
  const term = query.trim().toLowerCase()
  const digits = term.replace(/\D/g, '')
  const visible = list
    .filter(tests[filter])
    .filter((person) => !term || person.name.toLowerCase().includes(term) || (digits.length > 2 && (person.phone ?? '').replace(/\D/g, '').includes(digits)))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  const groups = visible.reduce<{ letter: string; people: Person[] }[]>((acc, person) => {
    const letter = person.name[0]?.toUpperCase() ?? '#'
    const last = acc.at(-1)
    if (last?.letter === letter) last.people.push(person)
    else acc.push({ letter, people: [person] })
    return acc
  }, [])
  const open = people.find((person) => person.id === openId) ?? null

  return (
    <div className="module">
      <PageHead
        eyebrow="Club"
        title="Jugadores y socios"
        meta={`${plural(count(tests.all), 'ficha activa', 'fichas activas')} · ${plural(count(tests.members), 'socio', 'socios')}`}
        actions={<Button variant="accent" icon="userPlus" onClick={() => setForm({})}>Nuevo jugador</Button>}
      />

      <StatStrip
        label="Resumen de fichas"
        items={[
          { id: 'members', label: 'Socios activos', value: count(tests.members), tone: 'green', selected: filter === 'members', onClick: () => setFilter(filter === 'members' ? 'all' : 'members') },
          { id: 'guests', label: 'No socios', value: count(tests.guests), selected: filter === 'guests', onClick: () => setFilter(filter === 'guests' ? 'all' : 'guests') },
          { id: 'debt', label: 'Con saldo', value: count(tests.debt), tone: 'clay', foot: 'cuotas o cantina', selected: filter === 'debt', onClick: () => setFilter(filter === 'debt' ? 'all' : 'debt') },
          { id: 'account', label: 'Usan el portal', value: count(tests.account), tone: 'ball', selected: filter === 'account', onClick: () => setFilter(filter === 'account' ? 'all' : 'account') },
        ]}
      />

      <div className="list-toolbar">
        <TextInput icon="search" type="search" placeholder="Buscar por nombre o teléfono" aria-label="Buscar jugador" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="chip-row chip-row-scroll" role="group" aria-label="Filtrar fichas">
          {FILTERS.map((item) => (
            <button key={item.id} type="button" className={`chip ${filter === item.id ? 'is-selected' : ''}`} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
              <span>{item.label}</span>
              <span className="chip-count">{count(tests[item.id])}</span>
            </button>
          ))}
        </div>
      </div>

      {dataState === 'error' ? <ErrorState title="No pudimos cargar las fichas" onRetry={retry} />
        : dataState === 'loading' ? <SkeletonCards count={6} height={68} />
          : visible.length === 0 ? (
            <div className="card">
              <EmptyState
                icon="users"
                title={list.length === 0 ? 'Todavía no hay fichas' : 'Nadie coincide con la búsqueda'}
                body={list.length === 0 ? 'Cargá la primera con solo el nombre. Teléfono y membresía son opcionales.' : 'Probá con otro nombre, otro filtro o creá la ficha.'}
                action={<Button variant="accent" icon="userPlus" onClick={() => setForm({})}>{term ? `Crear «${query.trim()}»` : 'Nuevo jugador'}</Button>}
              />
            </div>
          ) : (
            <div className="people-table" role="list" aria-label="Fichas">
              <div className="people-head" aria-hidden="true">
                <span>Nombre</span><span>Membresía</span><span>Saldo</span><span>Próximo</span>
              </div>
              {groups.map((group) => (
                <section key={group.letter} className="people-group" aria-label={`Letra ${group.letter}`}>
                  <p className="people-letter" aria-hidden="true">{group.letter}</p>
                  {group.people.map((person) => <PersonRow key={person.id} person={person} fact={fact(person.id)} onOpen={() => setOpenId(person.id)} />)}
                </section>
              ))}
            </div>
          )}

      <PlayerDetail person={open} onClose={() => setOpenId(null)} onEdit={(person) => { setOpenId(null); setForm({ editing: person }) }} />
      <PlayerForm state={form} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); setOpenId(id) }} />
    </div>
  )
}

function PersonRow({ person, fact, onOpen }: { person: Person; fact: Fact; onOpen: () => void }) {
  const debt = fact.duesCents + fact.canteenCents
  return (
    <div role="listitem">
      <button type="button" className={`person-row ${person.active ? '' : 'is-inactive'}`} onClick={onOpen}>
        <Avatar name={person.name} />
        <span className="person-row-main">
          <strong>{person.name}{person.hasAccount && <Icon name="link" size={14} className="person-row-link" label="Usa el portal" />}</strong>
          <span>{person.phone ?? 'Sin teléfono'}{person.coach === 'active' ? ' · Profesor' : ''}</span>
        </span>
        <span className="person-row-member">
          <MemberBadge person={person} />
          {person.membership !== 'none' && person.memberSince && <small className="hide-mobile">desde {since(person.memberSince)}</small>}
        </span>
        <span className="person-row-debt">
          {debt > 0 ? <Badge tone="clay">Debe {formatARS(debt)}</Badge> : <span className="muted hide-mobile">Al día</span>}
        </span>
        <span className="person-row-next hide-mobile">
          {fact.next ? <><b className="num">{relativeDay(fact.next.date, TODAY) === 'Hoy' ? 'Hoy' : `${capitalize(weekdayShort(fact.next.date))} ${dateShort(fact.next.date)}`}</b> {hhmm(fact.next.start)} · {fact.next.label}</> : <span className="muted">—</span>}
        </span>
        <Icon name="chevronRight" size={18} className="row-chevron" />
      </button>
    </div>
  )
}

// ── Ficha del jugador ───────────────────────────────────────────────
function PlayerDetail({ person, onClose, onEdit }: { person: Person | null; onClose: () => void; onEdit: (person: Person) => void }) {
  const { state, dispatch } = useStore()
  const { notify } = useProto()
  const { openReservation, goWith } = useAdmin()
  const { name: courtName } = useCourts()
  const action = useAction()
  const [confirm, setConfirm] = useState(false)

  if (!person) return null

  const dues = state.dues.filter((due) => due.personId === person.id).sort((a, b) => (a.period < b.period ? 1 : -1))
  const debt = personBalance(person.id, state.dues, state.duePayments)
  const canteen = state.sales.filter((sale) => sale.personId === person.id).reduce((sum, sale) => sum + balanceCents(sale), 0)
  const upcoming = state.occupations
    .filter((item) => (item.personId === person.id || item.studentIds?.includes(person.id) || item.coachId === person.id) && (item.date > TODAY || (item.date === TODAY && item.end > NOW)))
    .sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1))
    .slice(0, 4)
  const entries = state.tournaments.flatMap((tournament) => tournament.categories.filter((category) => category.entries.some((entry) => entry.personIds.includes(person.id))).map((category) => ({ tournament, category })))
  const invitation = state.invitations.find((item) => item.personId === person.id && !item.redeemedOn && !item.revokedOn && item.expiresOn >= TODAY)

  const toggleActive = () => void action.run(() => {
    dispatch({ type: 'person/update', person: { ...person, active: !person.active } })
    notify({ tone: 'success', title: person.active ? 'Ficha dada de baja' : 'Ficha reactivada', body: person.active ? 'Se conserva su historial. Ya no aparece en búsquedas operativas.' : person.name })
    setConfirm(false)
  })

  return (
    <>
      <Modal open={!confirm} onClose={onClose} variant="drawer" size="sm" eyebrow="Ficha" title={person.name}
        footer={
          <div className="form-actions">
            <Button variant="ghost" icon={person.active ? 'power' : 'undo'} onClick={() => { action.reset(); setConfirm(true) }}>{person.active ? 'Dar de baja' : 'Reactivar'}</Button>
            <Button variant="primary" icon="edit" onClick={() => onEdit(person)}>Editar ficha</Button>
          </div>
        }
      >
        <div className="detail">
          <div className="profile-hero">
            <Avatar name={person.name} size="lg" />
            <div className="profile-hero-main">
              <div className="badge-row">
                <MemberBadge person={person} />
                {person.coach === 'active' && <Badge tone="info" icon="school">Profesor</Badge>}
                {person.hasAccount ? <Badge tone="accent" icon="link">Usa el portal</Badge> : invitation ? <Badge tone="neutral" icon="key">Invitación pendiente</Badge> : null}
              </div>
              <div className="profile-contact">
                {person.phone ? <a href={`tel:${person.phone.replace(/\s|-/g, '')}`} className="contact-link"><Icon name="phone" size={16} />{person.phone}</a> : <span className="muted">Sin teléfono</span>}
                {person.email && <a href={`mailto:${person.email}`} className="contact-link"><Icon name="mail" size={16} />{person.email}</a>}
              </div>
            </div>
          </div>

          {person.active && (
            <div className="quick-actions">
              <button type="button" className="quick-action" onClick={() => { onClose(); openReservation({ date: TODAY, personId: person.id }) }}><Icon name="calendar" size={20} />Reservar</button>
              {dues.length > 0 && <button type="button" className="quick-action" onClick={() => goWith('/admin/cuotas', { kind: 'pay', personId: person.id })}><Icon name="wallet" size={20} />Cobrar cuota</button>}
              {!person.hasAccount && <button type="button" className="quick-action" onClick={() => goWith('/admin/portal', { kind: 'invite', personId: person.id })}><Icon name="key" size={20} />{invitation ? 'Ver invitación' : 'Invitar al portal'}</button>}
            </div>
          )}

          <section className="detail-section" aria-label="Estado de cuenta">
            <div className="balance-grid">
              <div className={`balance ${debt.cents ? 'is-due' : ''}`}>
                <span>Cuotas</span>
                <strong className="display num">{debt.cents ? formatARS(debt.cents) : 'Al día'}</strong>
                <small>{debt.months ? plural(debt.months, 'mes pendiente', 'meses pendientes') : person.membership === 'active' ? 'Sin deuda' : 'No es socio'}</small>
              </div>
              <div className={`balance ${canteen ? 'is-due' : ''}`}>
                <span>Cantina</span>
                <strong className="display num">{canteen ? formatARS(canteen) : 'Al día'}</strong>
                <small>{canteen ? 'Consumos a cuenta' : 'Sin consumos pendientes'}</small>
              </div>
            </div>
            {dues.length > 0 && (
              <ul className="mini-list">
                {dues.slice(0, 3).map((due) => {
                  const status = dueStatus(due, state.duePayments)
                  return (
                    <li key={due.id}>
                      <span>{periodLabel(due.period)}</span>
                      <span className="num">{status === 'paid' ? formatARS(due.amountCents) : `Resta ${formatARS(dueBalance(due, state.duePayments))}`}</span>
                      <Badge tone={status === 'paid' ? 'success' : status === 'partial' ? 'warning' : status === 'overdue' ? 'clay' : 'neutral'}>{DUE_STATUS_LABEL[status]}</Badge>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="detail-section" aria-labelledby="pd-next">
            <h3 id="pd-next" className="detail-section-title">Próximos en la agenda</h3>
            {upcoming.length === 0 ? <p className="muted">Sin turnos, clases ni partidos próximos.</p> : (
              <ul className="mini-list">
                {upcoming.map((item) => (
                  <li key={item.id}>
                    <span><b>{relativeDay(item.date, TODAY)}</b> · <span className="num">{hhmm(item.start)}</span></span>
                    <span>{courtName(item.courtId)}</span>
                    <Badge tone={item.kind === 'lesson' ? 'accent' : item.kind === 'match' ? 'clay' : 'success'}>{item.kind === 'lesson' ? (item.coachId === person.id ? 'Dicta clase' : 'Clase') : item.kind === 'match' ? 'Partido' : 'Turno'}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {entries.length > 0 && (
            <section className="detail-section" aria-labelledby="pd-tour">
              <h3 id="pd-tour" className="detail-section-title">Torneos</h3>
              <ul className="mini-list">
                {entries.map(({ tournament, category }) => <li key={category.id}><span><b>{tournament.name}</b></span><span>{category.name}</span></li>)}
              </ul>
            </section>
          )}

          <section className="detail-section" aria-labelledby="pd-data">
            <h3 id="pd-data" className="detail-section-title">Datos</h3>
            <dl className="detail-list">
              <div><dt>Membresía</dt><dd>{person.membership === 'active' ? `Socio activo${person.memberSince ? ` desde ${since(person.memberSince)}` : ''}` : person.membership === 'inactive' ? 'Socio inactivo' : 'No socio'}</dd></div>
              <div><dt>Alta de ficha</dt><dd>{since(person.createdOn)}</dd></div>
              {person.notes && <div><dt>Observaciones</dt><dd>{person.notes}</dd></div>}
            </dl>
            <p className="detail-footnote"><Icon name="info" size={16} />La ficha no exige cuenta: puede tener turnos aunque nunca inicie sesión.</p>
          </section>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirm}
        title={person.active ? `¿Dar de baja a ${person.name}?` : `¿Reactivar a ${person.name}?`}
        confirmLabel={person.active ? 'Dar de baja' : 'Reactivar'}
        tone={person.active ? 'danger' : 'primary'}
        icon={person.active ? 'power' : 'undo'}
        status={action.status}
        onConfirm={toggleActive}
        onClose={() => setConfirm(false)}
      >
        <p className="muted">{person.active ? 'Es una baja lógica: reservas, cuotas y consumos quedan en el historial. Podés reactivarla cuando quieras.' : 'Vuelve a aparecer en búsquedas, reservas y cantina.'}</p>
        {person.active && debt.cents + canteen > 0 && <p className="inline-alert inline-alert-warning"><Icon name="alert" size={20} /><span>Tiene saldo pendiente de <b>{formatARS(debt.cents + canteen)}</b>. La baja no lo cancela.</span></p>}
      </ConfirmDialog>
    </>
  )
}

// ── Alta / edición ──────────────────────────────────────────────────
function PlayerForm({ state: formState, onClose, onSaved }: { state: { editing?: Person } | null; onClose: () => void; onSaved: (id: string) => void }) {
  const editing = formState?.editing
  return (
    <Modal open={formState !== null} onClose={onClose} variant="drawer" size="sm" eyebrow={editing ? 'Editar ficha' : 'Alta rápida'} title={editing ? editing.name : 'Nuevo jugador'}>
      {formState && <PlayerFormBody key={editing?.id ?? 'new'} editing={editing} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  )
}

function PlayerFormBody({ editing, onClose, onSaved }: { editing?: Person; onClose: () => void; onSaved: (id: string) => void }) {
  const { dispatch } = useStore()
  const { notify } = useProto()
  const { people } = usePeople()
  const action = useAction()
  const [name, setName] = useState(editing?.name ?? '')
  const [phone, setPhone] = useState(editing?.phone ?? '')
  const [email, setEmail] = useState(editing?.email ?? '')
  const [membership, setMembership] = useState<Membership>(editing?.membership ?? 'none')
  const [memberSince, setMemberSince] = useState(editing?.memberSince ?? TODAY)
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [showMore, setShowMore] = useState(Boolean(editing?.email || editing?.notes))
  const [touched, setTouched] = useState(false)
  const [another, setAnother] = useState(false)

  const clean = name.trim().replace(/\s+/g, ' ')
  const duplicate = clean.length > 2 ? people.find((person) => person.id !== editing?.id && person.name.toLowerCase() === clean.toLowerCase()) : undefined
  const nameError = touched && clean.length < 2 ? 'Escribí al menos nombre y apellido o un apodo reconocible.' : undefined
  const emailError = touched && email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim()) ? 'Revisá el formato del email.' : undefined

  const submit = async (keepOpen: boolean) => {
    setTouched(true)
    if (clean.length < 2 || emailError) return
    const id = editing?.id ?? `p-new-${Date.now()}`
    const person: Person = {
      ...(editing ?? { id, active: true, createdOn: TODAY }),
      name: clean,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      notes: notes.trim() || undefined,
      membership,
      memberSince: membership === 'none' ? undefined : memberSince,
    }
    const ok = await action.run(() => dispatch({ type: editing ? 'person/update' : 'person/add', person }))
    if (!ok) return
    notify({ tone: 'success', title: editing ? 'Ficha actualizada' : 'Ficha creada', body: person.name })
    if (keepOpen) {
      setName(''); setPhone(''); setEmail(''); setNotes(''); setMembership('none'); setTouched(false); setAnother(true)
      return
    }
    onSaved(id)
  }

  return (
    <form className="res-form" noValidate onSubmit={(event) => { event.preventDefault(); void submit(false) }}>
      {another && <p className="inline-alert inline-alert-info" role="status"><Icon name="checkCircle" size={20} /><span>Ficha guardada. Cargá la siguiente.</span></p>}
      <Field label="Nombre y apellido" error={nameError} hint={duplicate ? undefined : 'Es lo único obligatorio.'}>
        {(id, describedBy) => <TextInput id={id} value={name} autoComplete="off" placeholder="Ej.: Lucía Ferreyra" aria-invalid={Boolean(nameError)} aria-describedby={describedBy} onChange={(event) => setName(event.target.value)} data-autofocus />}
      </Field>
      {duplicate && (
        <div className="inline-alert inline-alert-warning" role="status">
          <Icon name="alert" size={20} />
          <div><strong>Ya existe una ficha con ese nombre</strong><p>{duplicate.name} · {duplicate.phone ?? 'sin teléfono'}. Si es la misma persona, usá esa ficha para no duplicar historial.</p></div>
        </div>
      )}
      <Field label="Teléfono" optional>{(id) => <TextInput id={id} type="tel" icon="phone" inputMode="tel" value={phone} placeholder="3496 00-0000" onChange={(event) => setPhone(event.target.value)} />}</Field>

      <fieldset className="form-block">
        <legend className="form-legend">Membresía</legend>
        <SegmentedTabs label="Membresía" stretch value={membership} onChange={setMembership} items={[{ id: 'none', label: 'No socio' }, { id: 'active', label: 'Socio' }, { id: 'inactive', label: 'Inactivo' }]} />
        {membership !== 'none' && <Field label="Socio desde">{(id) => <TextInput id={id} type="date" value={memberSince} max={TODAY} onChange={(event) => setMemberSince(event.target.value)} />}</Field>}
        <p className="field-hint">{membership === 'active' ? 'Recibe cuota mensual cuando se emiten las cuotas del período.' : membership === 'inactive' ? 'Conserva su historial de socio, sin cuotas nuevas.' : 'Puede reservar, jugar torneos y consumir en cantina.'}</p>
      </fieldset>

      {showMore ? (
        <>
          <Field label="Email de contacto" optional error={emailError}>{(id, describedBy) => <TextInput id={id} type="email" icon="mail" value={email} aria-invalid={Boolean(emailError)} aria-describedby={describedBy} onChange={(event) => setEmail(event.target.value)} />}</Field>
          <Field label="Observaciones" optional>{(id) => <TextArea id={id} value={notes} placeholder="Ej.: menor, contacto de la familia, preferencias" onChange={(event) => setNotes(event.target.value)} />}</Field>
        </>
      ) : (
        <button type="button" className="link-btn link-btn-icon" onClick={() => setShowMore(true)}><Icon name="plus" size={18} />Email y observaciones</button>
      )}

      <div className="form-footer">
        {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardó la ficha</strong><p>Revisá la conexión y reintentá. No se va a duplicar.</p></div></div>}
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose} disabled={action.saving}>Cancelar</Button>
          {!editing && <Button variant="secondary" onClick={() => void submit(true)} disabled={action.saving}>Guardar y cargar otro</Button>}
          <Button type="submit" variant="accent" icon={action.failed ? 'refresh' : 'check'} loading={action.saving}>{action.failed ? 'Reintentar' : editing ? 'Guardar cambios' : 'Crear ficha'}</Button>
        </div>
      </div>
    </form>
  )
}
