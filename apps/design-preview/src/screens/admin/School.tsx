import { useMemo, useState } from 'react'
import { NOW, TODAY, type Occupation, type Person } from '../../data/mock'
import { CourtPicker, PersonChip, PersonPicker } from '../../components/domain'
import { Avatar, Badge, Button, Chip, ConfirmDialog, CourtMark, EmptyState, ErrorState, Field, Icon, IconButton, Meter, Modal, NumberStepper, PageHead, SegmentedTabs, SelectInput, SkeletonCards, Switch, TextArea, TextInput } from '../../components/ui'
import { useAdmin } from '../../lib/admin'
import { findConflict } from '../../lib/agenda'
import { useAction, useCourts, useIntent, usePeople } from '../../lib/data'
import { plural } from '../../lib/format'
import { useIsMobile } from '../../lib/media'
import { useProto, useScreenState } from '../../lib/proto'
import { useStore } from '../../lib/store'
import { addDays, capitalize, dateShort, DAY_CLOSE, dayLong, dayNumber, duration, fromISO, hhmm, overlaps, range, relativeDay, slots, weekdayShort, type Minutes } from '../../lib/time'

type Tab = 'week' | 'classes' | 'coaches' | 'students'
const isPast = (item: Occupation) => item.date < TODAY || (item.date === TODAY && item.end <= NOW)
const byTime = (a: Occupation, b: Occupation) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1)
const weekStart = (iso: string) => addDays(iso, -((fromISO(iso).getDay() + 6) % 7))
const lessonTitle = (type: 'individual' | 'group', group: string) => (type === 'individual' ? 'Clase individual' : `Escuela · ${group.trim() || 'Grupo'}`)

export function School() {
  const { state } = useStore()
  const { dataState, retry } = useScreenState()
  const { people, byId } = usePeople()
  const [tab, setTab] = useState<Tab>('week')
  const [openId, setOpenId] = useState<string | null>(null)
  const [form, setForm] = useState<{ editing?: Occupation; date?: string } | null>(null)
  const [coachFilter, setCoachFilter] = useState<string | null>(null)

  useIntent(['newLesson', 'lesson'], (intent) => {
    if (intent.kind === 'newLesson') setForm({})
    else { setTab('week'); setOpenId(intent.id) }
  })

  const lessons = useMemo(() => (dataState === 'empty' ? [] : state.occupations.filter((item) => item.kind === 'lesson').sort(byTime)), [state.occupations, dataState])
  const coaches = people.filter((person) => person.coach)
  const thisWeek = weekStart(TODAY)
  const weekLessons = lessons.filter((item) => item.date >= thisWeek && item.date < addDays(thisWeek, 7))
  const students = new Set(lessons.filter((item) => !isPast(item) || item.date >= addDays(TODAY, -7)).flatMap((item) => item.studentIds ?? []))
  const open = lessons.find((item) => item.id === openId) ?? null

  return (
    <div className="module">
      <PageHead
        eyebrow="Club"
        title="Escuela de tenis"
        meta={`${plural(weekLessons.length, 'clase', 'clases')} esta semana · ${plural(students.size, 'alumno', 'alumnos')} · ${plural(coaches.filter((coach) => coach.coach === 'active').length, 'profesor', 'profesores')}`}
        actions={<Button variant="accent" icon="plus" onClick={() => setForm({})}>Nueva clase</Button>}
      />
      <div className="module-tabs">
        <SegmentedTabs label="Secciones de la escuela" value={tab} onChange={setTab} items={[
          { id: 'week', label: 'Programación', icon: 'calendar' },
          { id: 'classes', label: 'Clases', icon: 'list' },
          { id: 'coaches', label: 'Profesores', icon: 'school' },
          { id: 'students', label: 'Alumnos', icon: 'users' },
        ]} />
      </div>

      {dataState === 'error' ? <ErrorState title="No pudimos cargar la escuela" onRetry={retry} />
        : dataState === 'loading' ? <SkeletonCards count={4} height={96} />
          : tab === 'week' ? <WeekView lessons={lessons} coachFilter={coachFilter} setCoachFilter={setCoachFilter} coaches={coaches} onOpen={setOpenId} onCreate={(date) => setForm({ date })} />
            : tab === 'classes' ? <ClassList lessons={lessons} onOpen={setOpenId} onCreate={() => setForm({})} />
              : tab === 'coaches' ? <Coaches lessons={lessons} onSchedule={(id) => { setCoachFilter(id); setTab('week') }} />
                : <Students lessons={lessons} byId={byId} />}

      <LessonDetail lesson={open} onClose={() => setOpenId(null)} onEdit={(lesson) => { setOpenId(null); setForm({ editing: lesson }) }} />
      <LessonForm request={form} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); setOpenId(id) }} />
    </div>
  )
}

// ── Programación semanal ────────────────────────────────────────────
function WeekView({ lessons, coaches, coachFilter, setCoachFilter, onOpen, onCreate }: { lessons: Occupation[]; coaches: Person[]; coachFilter: string | null; setCoachFilter: (id: string | null) => void; onOpen: (id: string) => void; onCreate: (date: string) => void }) {
  const isMobile = useIsMobile()
  const [start, setStart] = useState(weekStart(TODAY))
  const [day, setDay] = useState(TODAY)
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index))
  const visible = lessons.filter((item) => !coachFilter || item.coachId === coachFilter)
  const ofDay = (date: string) => visible.filter((item) => item.date === date)
  const shift = (delta: number) => { const next = addDays(start, delta * 7); setStart(next); setDay(next <= TODAY && TODAY < addDays(next, 7) ? TODAY : next) }
  const selectedDay = days.includes(day) ? day : days[0]

  return (
    <section className="stack" aria-label="Programación semanal">
      <div className="week-toolbar">
        <div className="date-nav">
          <IconButton icon="chevronLeft" label="Semana anterior" variant="secondary" onClick={() => shift(-1)} />
          <div className="date-nav-label">
            <p className="date-nav-title display">{dayNumber(days[0])}–{dayNumber(days[6])} {new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(fromISO(days[6]))}</p>
            <p className="date-nav-sub">{start === weekStart(TODAY) ? 'Esta semana · ' : ''}{plural(days.reduce((sum, date) => sum + ofDay(date).length, 0), 'clase', 'clases')}</p>
          </div>
          <IconButton icon="chevronRight" label="Semana siguiente" variant="secondary" onClick={() => shift(1)} />
        </div>
        <div className="chip-row chip-row-scroll" role="group" aria-label="Filtrar por profesor">
          <Chip selected={!coachFilter} onClick={() => setCoachFilter(null)}>Todos</Chip>
          {coaches.filter((coach) => coach.coach === 'active').map((coach) => <Chip key={coach.id} selected={coachFilter === coach.id} onClick={() => setCoachFilter(coach.id)}>{coach.name.split(' ')[0]}</Chip>)}
        </div>
      </div>

      {isMobile ? (
        <>
          <div className="date-strip" role="listbox" aria-label="Elegir día">
            {days.map((date) => {
              const count = ofDay(date).length
              return (
                <button key={date} type="button" role="option" aria-selected={date === selectedDay} className={`date-chip ${date === selectedDay ? 'is-selected' : ''} ${date === TODAY ? 'is-today' : ''}`} onClick={() => setDay(date)}>
                  <span className="date-chip-wd">{date === TODAY ? 'Hoy' : weekdayShort(date)}</span>
                  <span className="date-chip-n display num">{dayNumber(date)}</span>
                  <span className={`load load-${Math.min(count, 3)}`} aria-label={plural(count, 'clase', 'clases')}><i /><i /><i /></span>
                </button>
              )
            })}
          </div>
          <div className="day-lessons">
            <p className="day-lessons-title">{relativeDay(selectedDay, TODAY)}</p>
            {ofDay(selectedDay).length === 0 ? (
              <div className="card"><EmptyState icon="school" title="Sin clases este día" action={<Button variant="secondary" icon="plus" onClick={() => onCreate(selectedDay)}>Programar clase</Button>} /></div>
            ) : (
              <ul className="lesson-stack">{ofDay(selectedDay).map((item) => <li key={item.id}><LessonCard lesson={item} onOpen={() => onOpen(item.id)} /></li>)}</ul>
            )}
          </div>
        </>
      ) : (
        <div className="week-board" tabIndex={0} aria-label="Semana de clases">
          {days.map((date) => (
            <div key={date} className={`week-col ${date === TODAY ? 'is-today' : ''} ${date < TODAY ? 'is-past' : ''}`}>
              <div className="week-col-head">
                <span className="week-col-wd">{weekdayShort(date)}</span>
                <span className="week-col-n display num">{dayNumber(date)}</span>
                {date === TODAY && <Badge tone="accent">Hoy</Badge>}
              </div>
              <ul className="lesson-stack">
                {ofDay(date).map((item) => <li key={item.id}><LessonCard lesson={item} compact onOpen={() => onOpen(item.id)} /></li>)}
              </ul>
              {date >= TODAY && <button type="button" className="week-add" onClick={() => onCreate(date)} aria-label={`Programar clase el ${dayLong(date)}`}><Icon name="plus" size={16} />Clase</button>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function LessonCard({ lesson, compact = false, onOpen }: { lesson: Occupation; compact?: boolean; onOpen: () => void }) {
  const court = useCourts().byId(lesson.courtId)
  const enrolled = lesson.studentIds?.length ?? 0
  const capacity = lesson.capacity ?? 1
  const live = lesson.date === TODAY && lesson.start <= NOW && NOW < lesson.end
  return (
    <button type="button" className={`lesson-card ${isPast(lesson) ? 'is-past' : ''} ${live ? 'is-live' : ''} ${compact ? 'is-compact' : ''}`} onClick={onOpen}>
      <span className="lesson-card-time display num">{hhmm(lesson.start)}<small>{duration(lesson.end - lesson.start)}</small></span>
      <span className="lesson-card-main">
        <strong>{lesson.title}</strong>
        <span className="lesson-card-coach"><Avatar name={lesson.coach ?? 'Profesor'} size="sm" />{lesson.coach}</span>
      </span>
      <span className="lesson-card-side">
        <CourtMark label={court?.short ?? '?'} size="sm" />
        <span className={`lesson-cap ${enrolled >= capacity ? 'is-full' : ''}`}><Icon name="users" size={14} /><span className="num">{enrolled}/{capacity}</span></span>
      </span>
      {live && <span className="lesson-live">En curso</span>}
      {lesson.series && <Icon name="repeat" size={14} className="lesson-series" label="Se repite cada semana" />}
    </button>
  )
}

// ── Clases (series) ─────────────────────────────────────────────────
function ClassList({ lessons, onOpen, onCreate }: { lessons: Occupation[]; onOpen: (id: string) => void; onCreate: () => void }) {
  const { name: courtName } = useCourts()
  const [type, setType] = useState<'all' | 'group' | 'individual'>('all')
  const groups = new Map<string, Occupation[]>()
  lessons.filter((item) => type === 'all' || item.lessonType === type).forEach((item) => {
    const key = item.seriesId ?? item.id
    groups.set(key, [...(groups.get(key) ?? []), item])
  })
  const rows = [...groups.values()].map((items) => {
    const upcoming = items.filter((item) => !isPast(item))
    return { first: items[0], next: upcoming[0], remaining: upcoming.length, total: items.length }
  }).sort((a, b) => (a.next && b.next ? byTime(a.next, b.next) : a.next ? -1 : 1))
  if (lessons.length === 0) return <div className="card"><EmptyState icon="school" title="Todavía no hay clases" body="Programá la primera: ocupa la cancha en la agenda única." action={<Button variant="accent" icon="plus" onClick={onCreate}>Nueva clase</Button>} /></div>
  return (
    <section className="stack" aria-label="Clases">
      <div className="chip-row">
        <Chip selected={type === 'all'} onClick={() => setType('all')}>Todas</Chip>
        <Chip selected={type === 'group'} icon="users" onClick={() => setType('group')}>Grupales</Chip>
        <Chip selected={type === 'individual'} icon="user" onClick={() => setType('individual')}>Individuales</Chip>
      </div>
      <ul className="class-grid">
        {rows.map(({ first, next, remaining, total }) => {
          const ref = next ?? first
          return (
            <li key={first.seriesId ?? first.id}>
              <button type="button" className={`class-card ${next ? '' : 'is-past'}`} onClick={() => onOpen(ref.id)}>
                <span className="class-card-head">
                  <Badge tone={first.lessonType === 'individual' ? 'info' : 'accent'} icon={first.lessonType === 'individual' ? 'user' : 'users'}>{first.lessonType === 'individual' ? 'Individual' : 'Grupal'}</Badge>
                  {total > 1 && <Badge tone="neutral" icon="repeat">Semanal</Badge>}
                </span>
                <strong className="class-card-title">{first.title}</strong>
                <span className="class-card-when"><b className="display num">{capitalize(weekdayShort(ref.date))} {hhmm(ref.start)}</b> · {courtName(ref.courtId)} · {duration(ref.end - ref.start)}</span>
                <span className="class-card-coach"><Avatar name={first.coach ?? ''} size="sm" />{first.coach}</span>
                <span className="class-card-foot">
                  <span className="lesson-cap"><Icon name="users" size={14} /><span className="num">{ref.studentIds?.length ?? 0}/{ref.capacity}</span></span>
                  <span className="muted">{next ? `Próxima ${relativeDay(next.date, TODAY).toLowerCase()} · ${plural(remaining, 'clase', 'clases')} por delante` : 'Sin clases futuras'}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ── Profesores ──────────────────────────────────────────────────────
function Coaches({ lessons, onSchedule }: { lessons: Occupation[]; onSchedule: (id: string) => void }) {
  const { dispatch } = useStore()
  const { notify } = useProto()
  const { people } = usePeople()
  const action = useAction()
  const [picking, setPicking] = useState(false)
  const [toggle, setToggle] = useState<Person | null>(null)
  const coaches = people.filter((person) => person.coach).sort((a, b) => (a.coach === b.coach ? a.name.localeCompare(b.name, 'es') : a.coach === 'active' ? -1 : 1))
  const week = weekStart(TODAY)
  const stats = (id: string) => {
    const mine = lessons.filter((item) => item.coachId === id)
    const thisWeek = mine.filter((item) => item.date >= week && item.date < addDays(week, 7))
    return { week: thisWeek.length, minutes: thisWeek.reduce((sum, item) => sum + item.end - item.start, 0), students: new Set(mine.flatMap((item) => item.studentIds ?? [])).size, upcoming: mine.filter((item) => !isPast(item)).length }
  }
  const confirmToggle = () => toggle && void action.run(() => {
    dispatch({ type: 'person/update', person: { ...toggle, coach: toggle.coach === 'active' ? 'inactive' : 'active' } })
    notify({ tone: 'success', title: toggle.coach === 'active' ? 'Profesor desactivado' : 'Profesor activado', body: toggle.name })
    setToggle(null)
  })
  return (
    <section className="stack" aria-label="Profesores">
      <ul className="coach-grid">
        {coaches.map((coach) => {
          const info = stats(coach.id)
          const active = coach.coach === 'active'
          return (
            <li key={coach.id} className={`coach-card ${active ? '' : 'is-inactive'}`}>
              <div className="coach-card-head">
                <Avatar name={coach.name} size="lg" />
                <div><strong>{coach.name}</strong><span>{coach.phone ?? 'Sin teléfono'}</span></div>
                <Badge tone={active ? 'success' : 'neutral'} dot>{active ? 'Activo' : 'Inactivo'}</Badge>
              </div>
              <dl className="coach-stats">
                <div><dt>Esta semana</dt><dd className="display num">{info.week}</dd><dd className="coach-stat-foot">{info.minutes ? duration(info.minutes) : 'sin clases'}</dd></div>
                <div><dt>Alumnos</dt><dd className="display num">{info.students}</dd></div>
                <div><dt>Próximas</dt><dd className="display num">{info.upcoming}</dd></div>
              </dl>
              <div className="coach-actions">
                {active && <Button variant="secondary" size="sm" icon="calendar" onClick={() => onSchedule(coach.id)}>Ver programación</Button>}
                <Button variant="ghost" size="sm" icon={active ? 'power' : 'undo'} onClick={() => { action.reset(); setToggle(coach) }}>{active ? 'Desactivar' : 'Activar'}</Button>
              </div>
            </li>
          )
        })}
        <li>
          <button type="button" className="coach-add" onClick={() => setPicking(true)}><Icon name="userPlus" size={26} /><strong>Agregar profesor</strong><span>Desde una ficha existente</span></button>
        </li>
      </ul>
      <p className="detail-footnote"><Icon name="info" size={16} />Ser profesor no da acceso a la administración. Pagos y liquidaciones de profesores no están contemplados.</p>
      <PersonPicker open={picking} title="Agregar profesor" hint="Elegí la ficha de la persona que dicta clases." allowCreate onClose={() => setPicking(false)}
        disabledReason={(person) => (person.coach === 'active' ? 'Ya es profesor' : undefined)}
        onPick={(id) => {
          const person = people.find((item) => item.id === id)
          dispatch({ type: 'person/update', person: { ...(person ?? { id, name: 'Profesor', active: true, membership: 'none', createdOn: TODAY }), coach: 'active' } })
          notify({ tone: 'success', title: 'Profesor agregado', body: person?.name })
          setPicking(false)
        }} />
      <ConfirmDialog open={toggle !== null} title={toggle?.coach === 'active' ? `¿Desactivar a ${toggle?.name}?` : `¿Activar a ${toggle?.name}?`} confirmLabel={toggle?.coach === 'active' ? 'Desactivar' : 'Activar'} tone={toggle?.coach === 'active' ? 'danger' : 'primary'} icon="power" status={action.status} onConfirm={confirmToggle} onClose={() => setToggle(null)}>
        {toggle?.coach === 'active' && stats(toggle.id).upcoming > 0
          ? <p className="inline-alert inline-alert-warning"><Icon name="alert" size={20} /><span>Tiene {plural(stats(toggle.id).upcoming, 'clase próxima', 'clases próximas')}. Siguen en la agenda: reasignalas o cancelalas desde cada clase.</span></p>
          : <p className="muted">{toggle?.coach === 'active' ? 'No podrá asignarse a clases nuevas.' : 'Vuelve a estar disponible para programar clases.'}</p>}
      </ConfirmDialog>
    </section>
  )
}

// ── Alumnos ─────────────────────────────────────────────────────────
function Students({ lessons, byId }: { lessons: Occupation[]; byId: (id: string) => Person | undefined }) {
  const { goWith } = useAdmin()
  const [query, setQuery] = useState('')
  const map = new Map<string, Occupation[]>()
  lessons.filter((item) => !isPast(item)).forEach((item) => (item.studentIds ?? []).forEach((id) => map.set(id, [...(map.get(id) ?? []), item])))
  const rows = [...map.entries()]
    .map(([id, items]) => ({ person: byId(id), items }))
    .filter((row): row is { person: Person; items: Occupation[] } => Boolean(row.person && row.person.name.toLowerCase().includes(query.trim().toLowerCase())))
    .sort((a, b) => a.person.name.localeCompare(b.person.name, 'es'))
  return (
    <section className="stack" aria-label="Alumnos">
      <div className="list-toolbar"><TextInput icon="search" type="search" placeholder="Buscar alumno" aria-label="Buscar alumno" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      {rows.length === 0 ? <div className="card"><EmptyState icon="users" title="Sin alumnos con clases próximas" body="Sumá alumnos desde el detalle de cada clase." /></div> : (
        <ul className="list-card">
          {rows.map(({ person, items }) => {
            const titles = [...new Set(items.map((item) => item.title))]
            return (
              <li key={person.id}>
                <button type="button" className="due-item" onClick={() => goWith('/admin/jugadores', { kind: 'player', id: person.id })}>
                  <Avatar name={person.name} />
                  <span className="due-item-main"><strong>{person.name}</strong><span>{titles.join(' · ')}</span></span>
                  <span className="due-item-side"><span className="muted">Próxima</span><strong className="num">{capitalize(weekdayShort(items[0].date))} {hhmm(items[0].start)}</strong></span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ── Detalle de clase ────────────────────────────────────────────────
function LessonDetail({ lesson, onClose, onEdit }: { lesson: Occupation | null; onClose: () => void; onEdit: (lesson: Occupation) => void }) {
  const { state, dispatch } = useStore()
  const { notify } = useProto()
  const { go } = useAdmin()
  const { byId } = usePeople()
  const court = useCourts().byId(lesson?.courtId)
  const action = useAction()
  const [picking, setPicking] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  if (!lesson) return null
  const ids = lesson.studentIds ?? []
  const capacity = lesson.capacity ?? 1
  const full = ids.length >= capacity
  const series = lesson.seriesId ? state.occupations.filter((item) => item.seriesId === lesson.seriesId).sort(byTime) : [lesson]
  const position = series.findIndex((item) => item.id === lesson.id) + 1
  const save = (studentIds: string[], message: string) => void action.run(() => {
    dispatch({ type: 'occ/update', occupation: { ...lesson, studentIds, students: studentIds.length } })
    notify({ tone: 'success', title: message, body: `${lesson.title} · ${relativeDay(lesson.date, TODAY)} ${hhmm(lesson.start)}` })
  }, 450)
  const cancel = () => void action.run(() => {
    dispatch({ type: 'occ/cancel', id: lesson.id })
    notify({ tone: 'success', title: 'Clase cancelada', body: `${court?.name} quedó libre · ${range(lesson)}` })
    setCancelling(false)
    onClose()
  })

  return (
    <>
      <Modal open={!picking && !cancelling} onClose={onClose} variant="drawer" size="sm" eyebrow={lesson.lessonType === 'individual' ? 'Clase individual' : 'Clase grupal'} title={lesson.title}
        footer={!isPast(lesson) ? (
          <div className="form-actions">
            <Button variant="ghost" icon="x" onClick={() => { action.reset(); setCancelling(true) }}>Cancelar clase</Button>
            <Button variant="primary" icon="edit" onClick={() => onEdit(lesson)}>Editar</Button>
          </div>
        ) : undefined}
      >
        <div className="detail">
          <div className="detail-hero occ-lesson">
            <span className="detail-time num">{range(lesson)}</span>
            <span>{court?.name} · {capitalize(dayLong(lesson.date))} · {duration(lesson.end - lesson.start)}</span>
          </div>
          <dl className="detail-list">
            <div><dt>Profesor</dt><dd className="detail-person"><Avatar name={lesson.coach ?? ''} size="sm" />{lesson.coach}</dd></div>
            <div><dt>Repetición</dt><dd>{series.length > 1 ? <><Badge tone="info" icon="repeat">Semanal</Badge><span className="muted">clase {position} de {series.length}</span></> : 'Única'}</dd></div>
            {lesson.note && <div><dt>Observación</dt><dd>{lesson.note}</dd></div>}
          </dl>

          <section className="detail-section" aria-labelledby="ld-students">
            <div className="detail-section-head">
              <h3 id="ld-students" className="detail-section-title">Alumnos <span className="num muted">{ids.length}/{capacity}</span></h3>
              {!isPast(lesson) && <Button variant="secondary" size="sm" icon="userPlus" disabled={full || action.saving} onClick={() => setPicking(true)}>{full ? 'Cupo completo' : 'Agregar'}</Button>}
            </div>
            <Meter value={ids.length} max={capacity} label={`${ids.length} de ${capacity} lugares`} tone={full ? 'clay' : 'ball'} />
            {ids.length === 0 ? <p className="muted">Sin alumnos todavía. La clase ocupa la cancha igual.</p> : (
              <ul className="person-chips">
                {ids.map((id) => {
                  const person = byId(id)
                  return person ? <PersonChip key={id} person={person} onRemove={isPast(lesson) ? undefined : () => save(ids.filter((other) => other !== id), `${person.name} ya no está en la clase`)} /> : null
                })}
              </ul>
            )}
            {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardó el cambio</strong><p>Los alumnos no cambiaron. Probá de nuevo.</p></div></div>}
          </section>

          <button type="button" className="link-btn link-btn-icon" onClick={() => { onClose(); go('/admin/reservas') }}><Icon name="calendar" size={18} />Ver en la agenda de canchas</button>
        </div>
      </Modal>
      <PersonPicker open={picking} title="Agregar alumno" hint={`Quedan ${capacity - ids.length} lugares.`} allowCreate onClose={() => setPicking(false)}
        disabledReason={(person) => (ids.includes(person.id) ? 'Ya está en la clase' : person.id === lesson.coachId ? 'Es el profesor' : undefined)}
        onPick={(id) => { setPicking(false); save([...ids, id], `${byId(id)?.name ?? 'Alumno'} se sumó a la clase`) }} />
      <ConfirmDialog open={cancelling} title="¿Cancelar esta clase?" confirmLabel="Cancelar clase" icon="x" status={action.status} onConfirm={cancel} onClose={() => setCancelling(false)} errorTitle="No se canceló" errorBody="La clase sigue programada.">
        <p><b>{lesson.title}</b> · {relativeDay(lesson.date, TODAY)} · <span className="num">{range(lesson)}</span></p>
        <p className="muted">La cancha queda libre en la agenda. {series.length > 1 ? 'Solo se cancela esta fecha; el resto de la serie sigue igual.' : ''}</p>
      </ConfirmDialog>
    </>
  )
}

// ── Alta / edición de clase ─────────────────────────────────────────
const LENGTHS = [60, 90, 120]

function LessonForm({ request, onClose, onSaved }: { request: { editing?: Occupation; date?: string } | null; onClose: () => void; onSaved: (id: string) => void }) {
  return (
    <Modal open={request !== null} onClose={onClose} variant="drawer" size="md" eyebrow={request?.editing ? 'Editar clase' : 'Escuela de tenis'} title={request?.editing ? request.editing.title : 'Nueva clase'}>
      {request && <LessonFormBody key={request.editing?.id ?? request.date ?? 'new'} editing={request.editing} initialDate={request.date} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  )
}

function LessonFormBody({ editing, initialDate, onClose, onSaved }: { editing?: Occupation; initialDate?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const { state, dispatch } = useStore()
  const { notify } = useProto()
  const { active: courts, byId: courtById } = useCourts()
  const { people, byId } = usePeople()
  const action = useAction()
  const coaches = people.filter((person) => person.coach === 'active' && person.active)
  const [type, setType] = useState<'group' | 'individual'>(editing?.lessonType ?? 'group')
  const [group, setGroup] = useState(editing?.title.replace(/^Escuela · /, '') ?? '')
  const [coachId, setCoachId] = useState(editing?.coachId ?? coaches[0]?.id ?? '')
  const [courtId, setCourtId] = useState(editing?.courtId ?? courts[0]?.id ?? '')
  const [date, setDate] = useState(editing?.date ?? (initialDate && initialDate >= TODAY ? initialDate : TODAY))
  const [start, setStart] = useState<Minutes>(editing?.start ?? (!initialDate || initialDate <= TODAY ? Math.max(17 * 60, Math.ceil(NOW / 30) * 30) : 17 * 60))
  const [length, setLength] = useState(editing ? editing.end - editing.start : 60)
  const [capacity, setCapacity] = useState(editing?.capacity ?? 6)
  const [studentIds, setStudentIds] = useState<string[]>(editing?.studentIds ?? [])
  const [weekly, setWeekly] = useState(false)
  const [until, setUntil] = useState(addDays(date, 28))
  const [note, setNote] = useState(editing?.note ?? '')
  const [picking, setPicking] = useState(false)
  const [touched, setTouched] = useState(false)

  const end = Math.min(start + length, DAY_CLOSE)
  const cap = type === 'individual' ? 1 : capacity
  const dates = useMemo(() => {
    if (!weekly || editing) return [date]
    const list: string[] = []
    for (let current = date; current <= until && list.length < 12; current = addDays(current, 7)) list.push(current)
    return list
  }, [weekly, editing, date, until])
  const courtClash = dates.map((day) => ({ day, hit: findConflict(state.occupations, { courtId, date: day, start, end }, editing?.id) })).find((item) => item.hit)
  const coachClash = dates.map((day) => ({ day, hit: state.occupations.find((item) => item.kind === 'lesson' && item.id !== editing?.id && item.coachId === coachId && item.date === day && overlaps(item, { start, end })) })).find((item) => item.hit)
  const coach = byId(coachId)
  const past = !editing && date === TODAY && start < NOW
  const tooMany = studentIds.length > cap
  const freeCourts = courtClash?.day === date ? courts.filter((item) => item.id !== courtId && !findConflict(state.occupations, { courtId: item.id, date, start, end }, editing?.id)) : []

  const submit = async () => {
    setTouched(true)
    if (!coach || courtClash || coachClash || tooMany || past) return
    const base: Omit<Occupation, 'id' | 'date'> = {
      courtId, start, end, kind: 'lesson', title: lessonTitle(type, group), coach: coach.name, coachId, lessonType: type,
      capacity: cap, studentIds, students: studentIds.length, note: note.trim() || undefined,
      series: editing?.series ?? (dates.length > 1 || undefined), seriesId: editing?.seriesId,
    }
    const stamp = Date.now()
    const created: Occupation[] = editing ? [{ ...editing, ...base, date }] : dates.map((day, index) => ({ ...base, id: `l-new-${stamp}-${index}`, date: day, seriesId: dates.length > 1 ? `ls-new-${stamp}` : undefined }))
    const ok = await action.run(() => dispatch(editing ? { type: 'occ/update', occupation: created[0] } : { type: 'occ/addMany', occupations: created }))
    if (!ok) return
    notify({ tone: 'success', title: editing ? 'Clase actualizada' : dates.length > 1 ? `Serie creada · ${dates.length} clases` : 'Clase programada', body: `${courtById(courtId)?.name} · ${capitalize(weekdayShort(date))} ${dateShort(date)} · ${range({ start, end })}` })
    onSaved(created[0].id)
  }

  return (
    <form className="res-form" noValidate onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <SegmentedTabs label="Tipo de clase" stretch value={type} onChange={setType} items={[{ id: 'group', label: 'Grupal', icon: 'users' }, { id: 'individual', label: 'Individual', icon: 'user' }]} />
      {type === 'group' && <Field label="Nombre del grupo" hint="Ej.: Menores, Adultos, Competencia.">{(id, describedBy) => <TextInput id={id} value={group} aria-describedby={describedBy} placeholder="Grupo" onChange={(event) => setGroup(event.target.value)} />}</Field>}

      <fieldset className="form-block">
        <legend className="form-legend">Profesor</legend>
        {coaches.length === 0 ? <p className="inline-alert inline-alert-warning"><Icon name="alert" size={20} /><span>No hay profesores activos. Agregalos en la pestaña Profesores.</span></p> : (
          <div className="chip-row">
            {coaches.map((item) => <Chip key={item.id} selected={coachId === item.id} onClick={() => setCoachId(item.id)}><span className="chip-avatar"><Avatar name={item.name} size="sm" /></span>{item.name}</Chip>)}
          </div>
        )}
      </fieldset>

      <fieldset className="form-block">
        <legend className="form-legend">Cancha</legend>
        <CourtPicker courts={courts} value={courtId} onChange={setCourtId} isBusy={(id) => Boolean(findConflict(state.occupations, { courtId: id, date, start, end }, editing?.id))} />
      </fieldset>

      <div className="form-row">
        <Field label="Fecha">{(id) => <TextInput id={id} type="date" value={date} min={TODAY} onChange={(event) => event.target.value && setDate(event.target.value)} />}</Field>
        <Field label="Desde">{(id) => (
          <SelectInput id={id} value={start} onChange={(event) => setStart(Number(event.target.value))}>
            {slots(7 * 60, DAY_CLOSE - 30).map((slot) => <option key={slot} value={slot}>{hhmm(slot)}</option>)}
          </SelectInput>
        )}</Field>
      </div>
      <fieldset className="form-block">
        <legend className="form-legend">Duración</legend>
        <div className="chip-row">{LENGTHS.map((minutes) => <Chip key={minutes} selected={length === minutes} disabled={start + minutes > DAY_CLOSE} onClick={() => setLength(minutes)}>{duration(minutes)}</Chip>)}</div>
      </fieldset>

      {past && <p className="inline-alert inline-alert-warning" role="status"><Icon name="clock" size={20} /><span>Ese horario ya pasó. Elegí uno desde las {hhmm(Math.ceil(NOW / 30) * 30)}.</span></p>}
      {(courtClash?.hit || coachClash?.hit) && (
        <div className="inline-alert inline-alert-danger" role="alert">
          <Icon name="alert" size={20} />
          <div>
            {courtClash?.hit && <><strong>{courtClash.day === date ? `${courtById(courtId)?.name} está ocupada` : `La serie choca el ${dayLong(courtClash.day)}`}</strong><p>{courtClash.hit.title} · {range(courtClash.hit)}</p></>}
            {coachClash?.hit && <><strong>{coach?.name} ya tiene clase {coachClash.day === date ? 'en ese horario' : `el ${dayLong(coachClash.day)}`}</strong><p>{coachClash.hit.title} · {range(coachClash.hit)}</p></>}
            {freeCourts.length > 0 && !coachClash?.hit && <div className="chip-row">{freeCourts.slice(0, 3).map((item) => <Chip key={item.id} icon="check" onClick={() => setCourtId(item.id)}>{item.name} libre</Chip>)}</div>}
          </div>
        </div>
      )}

      <fieldset className="form-block">
        <legend className="form-legend">Alumnos</legend>
        {type === 'group' && (
          <div className="inline-field">
            <span>Cupo</span>
            <NumberStepper label="Cupo" value={capacity} onChange={setCapacity} min={Math.max(2, studentIds.length)} max={12} unit={(value) => (value === 1 ? 'lugar' : 'lugares')} />
          </div>
        )}
        {studentIds.length > 0 && (
          <ul className="person-chips">{studentIds.map((id) => { const person = byId(id); return person ? <PersonChip key={id} person={person} onRemove={() => setStudentIds(studentIds.filter((other) => other !== id))} /> : null })}</ul>
        )}
        {tooMany && touched && <p className="field-error"><Icon name="alert" size={14} />Hay más alumnos que lugares.</p>}
        <Button variant="secondary" icon="userPlus" disabled={studentIds.length >= cap} onClick={() => setPicking(true)}>{studentIds.length >= cap ? 'Cupo completo' : studentIds.length ? 'Agregar otro alumno' : 'Agregar alumnos'}</Button>
        <p className="field-hint">Opcional: la clase puede programarse sin alumnos.</p>
      </fieldset>

      {!editing && (
        <div className="form-block">
          <Switch checked={weekly} onChange={setWeekly} label="Repetir cada semana" description="Cada clase de la serie se edita o cancela por separado." />
          {weekly && <Field label="Última fecha" hint={`${plural(dates.length, 'clase', 'clases')} · máximo 12`}>{(id, describedBy) => <TextInput id={id} type="date" min={date} value={until} aria-describedby={describedBy} onChange={(event) => event.target.value && setUntil(event.target.value)} />}</Field>}
        </div>
      )}
      <Field label="Observaciones" optional>{(id) => <TextArea id={id} rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Visible solo para administración" />}</Field>

      <div className="form-footer">
        {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardó la clase</strong><p>La cancha no se ocupó. Reintentá sin miedo a duplicar.</p></div></div>}
        <p className="form-summary"><Icon name="clock" size={16} /><span>{courtById(courtId)?.name} · {capitalize(weekdayShort(date))} {dateShort(date)} · <b className="num">{range({ start, end })}</b>{dates.length > 1 ? ` · ${dates.length} semanas` : ''}</span></p>
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose} disabled={action.saving}>Cancelar</Button>
          <Button type="submit" variant="accent" size="lg" icon={action.failed ? 'refresh' : 'check'} loading={action.saving} disabled={Boolean(courtClash || coachClash) || !coach || past}>{action.failed ? 'Reintentar' : editing ? 'Guardar cambios' : 'Programar clase'}</Button>
        </div>
      </div>
      <PersonPicker open={picking} title="Agregar alumno" allowCreate onClose={() => setPicking(false)}
        disabledReason={(person) => (studentIds.includes(person.id) ? 'Ya está en la clase' : person.id === coachId ? 'Es el profesor' : undefined)}
        onPick={(id) => { setStudentIds([...studentIds, id]); if (studentIds.length + 1 >= cap) setPicking(false) }} />
    </form>
  )
}

