import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club, ClubCoach, ClubPerson, Court, LessonDraft, TennisLesson, TennisLessonStudent } from '../../types/domain'
import { isoToDateAndTime, shiftCalendarDate, todayInTimezone, weeklyOccurrenceDates, zonedDateTimeToIso } from '../reservations/reservationUtils'
import { courtShort } from '../reservations/occupationView'
import { createQuickPerson, usePersonSearch } from '../people/usePersonSearch'
import { Avatar, Badge, Button, Chip, ConfirmDialog, CourtMark, EmptyState, ErrorState, Field, Icon, IconButton, Meter, Modal, NumberStepper, PageHead, SegmentedTabs, SelectInput, SkeletonCards, Switch, TextArea, TextInput } from '../../design/ui'
import { CourtPicker, PersonChip, PersonPicker, type PickerItem } from '../../design/domain'
import { addDays, capitalize, dateShort, dayLong, dayNumber, durationLabel, fromMinutes, toMinutes, weekdayShort, weekStart } from '../../design/dates'
import { normalizeSearch, plural } from '../../design/format'
import { useAsyncAction } from '../../design/useAsyncAction'
import { useIsMobile } from '../../design/media'

type CoachWithPerson = ClubCoach & { person?: Pick<ClubPerson, 'full_name' | 'phone'> | null }
type LessonRow = TennisLesson & { reservation?: { court_id: string; starts_at: string; ends_at: string } }
type Tab = 'week' | 'classes' | 'coaches' | 'students'
type Creation = { courtId: string; date: string; startsAt: string }

/** Una clase con su horario ya resuelto en la zona del club. */
type LessonView = { lesson: TennisLesson; courtId: string; startsAt: string; endsAt: string; date: string; start: number; end: number; studentIds: string[]; coachName: string }

const slots = Array.from({ length: 32 }, (_, index) => fromMinutes(7 * 60 + index * 30))
const LENGTHS = [60, 90, 120]
const coachName = (coach: CoachWithPerson) => coach.person?.full_name ?? 'Profesor sin nombre'
const typeLabel = (type: 'individual' | 'group') => (type === 'individual' ? 'Clase individual' : 'Clase grupal')
const personFields = 'id, club_id, full_name, phone, email, notes, active, created_at, updated_at'

function defaultDraft(club: Club, courts: Court[], coaches: CoachWithPerson[], date = todayInTimezone(club.timezone), startsAt = '07:00'): LessonDraft {
  const endMinutes = Math.min(toMinutes(startsAt) + 60, 23 * 60)
  return { coachId: coaches.find((coach) => coach.active)?.id ?? '', courtId: courts.find((court) => court.active)?.id ?? '', date, startsAt, endsAt: fromMinutes(endMinutes), lessonType: 'individual', capacity: 1, studentIds: [], notes: '', recurrence: 'single', recurrenceUntil: shiftCalendarDate(date, 77) }
}

const draftFor = (view: LessonView): LessonDraft => ({ coachId: view.lesson.coach_id, courtId: view.courtId, date: view.date, startsAt: fromMinutes(view.start), endsAt: fromMinutes(view.end), lessonType: view.lesson.lesson_type, capacity: view.lesson.capacity, studentIds: view.studentIds, notes: view.lesson.notes ?? '', recurrence: 'single', recurrenceUntil: view.date })

/** Alta y edición de clases sobre las RPC atómicas existentes (ocupación de cancha + clase + alumnos). */
export function LessonForm({ client, club, courts, coaches, people = [], lessons = [], initial, lesson, onClose, onSaved }: { client: SupabaseClient; club: Club; courts: Court[]; coaches: CoachWithPerson[]; people?: ClubPerson[]; lessons?: LessonView[]; initial: LessonDraft; lesson?: TennisLesson; onClose: () => void; onSaved: () => Promise<void> }) {
  return (
    <Modal open onClose={onClose} variant="drawer" size="md" eyebrow={lesson ? 'Editar clase' : 'Escuela de tenis'} title={lesson ? typeLabel(lesson.lesson_type) : 'Nueva clase'}>
      <LessonFormBody client={client} club={club} courts={courts} coaches={coaches} people={people} lessons={lessons} initial={initial} lesson={lesson} onClose={onClose} onSaved={onSaved} />
    </Modal>
  )
}

function LessonFormBody({ client, club, courts, coaches, people, lessons, initial, lesson, onClose, onSaved }: { client: SupabaseClient; club: Club; courts: Court[]; coaches: CoachWithPerson[]; people: ClubPerson[]; lessons: LessonView[]; initial: LessonDraft; lesson?: TennisLesson; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState(initial)
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(people.map((person) => [person.id, person.full_name])))
  const [picking, setPicking] = useState(false)
  const [touched, setTouched] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [dayOccupations, setDayOccupations] = useState<{ id: string; court_id: string; starts_at: string; ends_at: string }[] | null>(null)
  const search = usePersonSearch(client, club, picking)
  const action = useAsyncAction()

  // Ocupación del día elegido: solo informativa (la restricción definitiva es la exclusión de PostgreSQL).
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const dayStart = zonedDateTimeToIso(draft.date, '00:00', club.timezone)
        const dayEnd = zonedDateTimeToIso(shiftCalendarDate(draft.date, 1), '00:00', club.timezone)
        const { data, error } = await client.from('reservations').select('id, court_id, starts_at, ends_at').eq('club_id', club.id).in('status', ['confirmed', 'active']).lt('starts_at', dayEnd).gt('ends_at', dayStart)
        if (!cancelled) setDayOccupations(error ? null : (data ?? []) as { id: string; court_id: string; starts_at: string; ends_at: string }[])
      } catch { if (!cancelled) setDayOccupations(null) }
    }
    void load()
    return () => { cancelled = true }
  }, [client, club.id, club.timezone, draft.date])

  const count = draft.recurrence === 'weekly' ? weeklyOccurrenceDates(draft.date, draft.recurrenceUntil).length : 1
  const startsIso = draft.date && draft.startsAt ? zonedDateTimeToIso(draft.date, draft.startsAt, club.timezone) : ''
  const endsIso = draft.date && draft.endsAt ? zonedDateTimeToIso(draft.date, draft.endsAt, club.timezone) : ''
  const range = startsIso && endsIso && endsIso > startsIso ? { start: new Date(startsIso).getTime(), end: new Date(endsIso).getTime() } : null
  const ownReservation = (id: string) => lesson !== undefined && lessons.some((item) => item.lesson.id === lesson.id && item.lesson.reservation_id === id)
  const courtBusy = (courtId: string): boolean | undefined => {
    if (!range || dayOccupations === null) return undefined
    return dayOccupations.some((item) => item.court_id === courtId && !ownReservation(item.id) && new Date(item.starts_at).getTime() < range.end && new Date(item.ends_at).getTime() > range.start)
  }
  const coachClash = range ? lessons.find((item) => item.lesson.status === 'scheduled' && item.lesson.coach_id === draft.coachId && item.lesson.id !== lesson?.id && new Date(item.startsAt).getTime() < range.end && new Date(item.endsAt).getTime() > range.start) : undefined
  const courtClash = courtBusy(draft.courtId) === true
  const names2 = (id: string) => names[id] ?? 'Alumno seleccionado'
  const tooMany = draft.studentIds.length > draft.capacity
  const intervalError = touched && !range ? 'La hora de finalización debe ser posterior a la de inicio.' : undefined
  const activeCoaches = coaches.filter((coach) => coach.active || coach.id === draft.coachId)
  const set = (patch: Partial<LessonDraft>) => setDraft((current) => ({ ...current, ...patch }))

  const addStudent = (person: ClubPerson) => {
    if (draft.studentIds.includes(person.id)) return
    if (draft.studentIds.length >= draft.capacity) { setPickerError('El cupo de la clase ya está completo.'); return }
    setNames((current) => ({ ...current, [person.id]: person.full_name }))
    setDraft((current) => ({ ...current, studentIds: [...current.studentIds, person.id] }))
    setPickerError(null)
    search.reset()
    if (draft.studentIds.length + 1 >= draft.capacity) setPicking(false)
  }
  const createStudent = async (fullName: string) => {
    const result = await createQuickPerson(client, club, fullName)
    if (result.error || !result.person) { setPickerError(result.error ?? 'No pudimos crear la ficha del alumno. Intentá nuevamente.'); return }
    addStudent(result.person)
  }
  const pickerItems: PickerItem[] = search.results.map((person) => ({ id: person.id, name: person.full_name, hint: person.phone ?? undefined, disabledReason: draft.studentIds.includes(person.id) ? 'Ya está en la clase' : coaches.find((coach) => coach.id === draft.coachId)?.person_id === person.id ? 'Es el profesor' : undefined }))

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    setTouched(true)
    if (!draft.coachId || !draft.courtId) return
    if (!range || tooMany) return
    if (!lesson && draft.recurrence === 'weekly' && (count < 1 || count > 12)) return
    const startsAt = zonedDateTimeToIso(draft.date, draft.startsAt, club.timezone)
    const endsAt = zonedDateTimeToIso(draft.date, draft.endsAt, club.timezone)
    const args = lesson ? { p_lesson_id: lesson.id, p_coach_id: draft.coachId, p_court_id: draft.courtId, p_starts_at: startsAt, p_ends_at: endsAt, p_lesson_type: draft.lessonType, p_capacity: draft.capacity, p_student_ids: draft.studentIds, p_notes: draft.notes.trim() || null } : draft.recurrence === 'weekly' ? { p_club_id: club.id, p_coach_id: draft.coachId, p_court_id: draft.courtId, p_starts_at: startsAt, p_ends_at: endsAt, p_lesson_type: draft.lessonType, p_capacity: draft.capacity, p_student_ids: draft.studentIds, p_notes: draft.notes.trim() || null, p_occurrence_count: count } : { p_club_id: club.id, p_coach_id: draft.coachId, p_court_id: draft.courtId, p_starts_at: startsAt, p_ends_at: endsAt, p_lesson_type: draft.lessonType, p_capacity: draft.capacity, p_student_ids: draft.studentIds, p_notes: draft.notes.trim() || null }
    const rpc = lesson ? 'update_tennis_lesson' : draft.recurrence === 'weekly' ? 'create_weekly_tennis_lesson_series' : 'create_tennis_lesson'
    await action.run(async () => {
      const { error } = await client.rpc(rpc, args)
      if (error) return error.code === '23P01' ? 'La cancha o el profesor ya tienen una ocupación en ese horario.' : 'No pudimos guardar la clase. Revisá los datos e intentá nuevamente.'
      await onSaved(); onClose()
      return null
    })
  }
  const missing = touched && (!draft.coachId || !draft.courtId)

  return (
    <form className="res-form" noValidate onSubmit={(event) => void submit(event)}>
      <SegmentedTabs label="Tipo de clase" stretch value={draft.lessonType} onChange={(lessonType) => set({ lessonType, capacity: lessonType === 'individual' ? 1 : Math.max(2, draft.capacity), studentIds: lessonType === 'individual' ? draft.studentIds.slice(0, 1) : draft.studentIds })} items={[{ id: 'group', label: 'Grupal', icon: 'users' }, { id: 'individual', label: 'Individual', icon: 'user' }]} />

      <fieldset className="form-block">
        <legend className="form-legend">Profesor</legend>
        {activeCoaches.length === 0 ? <p className="inline-alert inline-alert-warning"><Icon name="alert" size={20} /><span>No hay profesores activos. Agregalos en la pestaña Profesores.</span></p> : (
          <div className="chip-row" role="radiogroup" aria-label="Profesor">
            {activeCoaches.map((coach) => <Chip key={coach.id} selected={draft.coachId === coach.id} onClick={() => set({ coachId: coach.id })}><span className="chip-avatar"><Avatar name={coachName(coach)} size="sm" /></span>{coachName(coach)}{coach.active ? '' : ' (inactivo)'}</Chip>)}
          </div>
        )}
        {missing && !draft.coachId && <p className="field-error"><Icon name="alert" size={14} />Elegí un profesor.</p>}
      </fieldset>

      <fieldset className="form-block">
        <legend className="form-legend">Cancha</legend>
        <CourtPicker courts={courts.filter((court) => court.active || court.id === draft.courtId)} value={draft.courtId} onChange={(courtId) => set({ courtId })} isBusy={courtBusy} short={courtShort} />
        {missing && !draft.courtId && <p className="field-error"><Icon name="alert" size={14} />Elegí una cancha.</p>}
      </fieldset>

      <div className="form-row">
        <Field label="Fecha">{(id) => <TextInput id={id} type="date" value={draft.date} onChange={(event) => event.target.value && set({ date: event.target.value })} required />}</Field>
        <Field label="Desde">{(id) => <SelectInput id={id} value={draft.startsAt} onChange={(event) => set({ startsAt: event.target.value })}>{slots.map((slot) => <option key={slot}>{slot}</option>)}</SelectInput>}</Field>
      </div>
      <div className="form-row">
        <Field label="Hasta" error={intervalError}>{(id, describedBy) => <SelectInput id={id} aria-describedby={describedBy} value={draft.endsAt} onChange={(event) => set({ endsAt: event.target.value })}>{[...slots, '23:00'].map((slot) => <option key={slot}>{slot}</option>)}</SelectInput>}</Field>
        <fieldset className="form-block">
          <legend className="form-legend">Duración</legend>
          <div className="chip-row">{LENGTHS.map((minutes) => <Chip key={minutes} selected={range !== null && (range.end - range.start) / 60000 === minutes} disabled={toMinutes(draft.startsAt) + minutes > 23 * 60} onClick={() => set({ endsAt: fromMinutes(toMinutes(draft.startsAt) + minutes) })}>{durationLabel(minutes)}</Chip>)}</div>
        </fieldset>
      </div>

      {(courtClash || coachClash) && (
        <div className="inline-alert inline-alert-warning" role="status">
          <Icon name="alert" size={20} />
          <div>
            {courtClash && <><strong>{courts.find((court) => court.id === draft.courtId)?.name ?? 'La cancha'} figura ocupada en ese horario</strong><p>Elegí otra cancha u horario. La confirmación final la hace el sistema al guardar.</p></>}
            {coachClash && <><strong>{coachName(coaches.find((coach) => coach.id === draft.coachId) as CoachWithPerson)} ya tiene clase en ese horario</strong><p>{typeLabel(coachClash.lesson.lesson_type)} · {fromMinutes(coachClash.start)}–{fromMinutes(coachClash.end)}.</p></>}
          </div>
        </div>
      )}

      <fieldset className="form-block">
        <legend className="form-legend">Alumnos ({draft.studentIds.length}/{draft.capacity})</legend>
        {draft.lessonType === 'group' && (
          <div className="inline-field">
            <span>Cupo</span>
            <NumberStepper label="Cupo" value={draft.capacity} onChange={(capacity) => set({ capacity })} min={Math.max(2, draft.studentIds.length)} max={99} unit={(value) => (value === 1 ? 'lugar' : 'lugares')} />
          </div>
        )}
        {draft.studentIds.length > 0 && (
          <ul className="person-chips">{draft.studentIds.map((id) => <PersonChip key={id} name={names2(id)} onRemove={() => set({ studentIds: draft.studentIds.filter((other) => other !== id) })} />)}</ul>
        )}
        {tooMany && touched && <p className="field-error"><Icon name="alert" size={14} />Hay más alumnos que lugares.</p>}
        <Button variant="secondary" icon="userPlus" disabled={draft.studentIds.length >= draft.capacity} onClick={() => { setPickerError(null); setPicking(true) }}>{draft.studentIds.length >= draft.capacity ? 'Cupo completo' : draft.studentIds.length ? 'Agregar otro alumno' : 'Agregar alumnos'}</Button>
        <p className="field-hint">Opcional: la clase puede programarse sin alumnos.</p>
      </fieldset>

      {!lesson && (
        <div className="form-block">
          <Switch checked={draft.recurrence === 'weekly'} onChange={(weekly) => set({ recurrence: weekly ? 'weekly' : 'single' })} label="Repetir cada semana" description="Cada clase de la serie se edita o cancela por separado." />
          {draft.recurrence === 'weekly' && <Field label="Última fecha" error={touched && (count < 1 || count > 12) ? 'La serie semanal debe tener entre 1 y 12 clases.' : undefined} hint={`Se crearán ${plural(count, 'clase', 'clases')} (máximo 12).`}>{(id, describedBy) => <TextInput id={id} type="date" min={draft.date} value={draft.recurrenceUntil} aria-describedby={describedBy} onChange={(event) => event.target.value && set({ recurrenceUntil: event.target.value })} />}</Field>}
        </div>
      )}
      <Field label="Observaciones" optional>{(id) => <TextArea id={id} rows={2} value={draft.notes} onChange={(event) => set({ notes: event.target.value })} placeholder="Visible solo para administración" />}</Field>

      <div className="form-footer">
        {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardó la clase</strong><p>{action.message}</p></div></div>}
        <p className="form-summary"><Icon name="clock" size={16} /><span>{courts.find((court) => court.id === draft.courtId)?.name ?? 'Sin cancha'} · {capitalize(weekdayShort(draft.date))} {dateShort(draft.date)} · <b className="num">{draft.startsAt}–{draft.endsAt}</b>{count > 1 && !lesson ? ` · ${count} semanas` : ''}</span></p>
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose} disabled={action.saving}>Volver</Button>
          <Button type="submit" variant="accent" size="lg" icon={action.failed ? 'refresh' : 'check'} loading={action.saving}>{action.saving ? 'Guardando…' : lesson ? 'Guardar cambios' : draft.recurrence === 'weekly' ? 'Crear serie' : 'Crear clase'}</Button>
        </div>
      </div>
      <PersonPicker open={picking} title="Agregar alumno" hint={`Quedan ${Math.max(0, draft.capacity - draft.studentIds.length)} lugares.`} items={pickerItems} query={search.query} onQueryChange={search.setQuery} loading={search.loading} error={pickerError} onClose={() => { setPicking(false); search.reset() }} onPick={(id) => { const person = search.results.find((item) => item.id === id); if (person) addStudent(person) }} onCreate={(name) => void createStudent(name)} />
    </form>
  )
}

const chunk = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size))

export function SchoolPanel({ client, club, courts, canManageCoaches, requestedLessonId, onRequestedLessonHandled, requestedCreation, onRequestedCreationHandled }: { client: SupabaseClient; club: Club; courts: Court[]; canManageCoaches: boolean; requestedLessonId?: string | null; onRequestedLessonHandled?: () => void; requestedCreation?: Creation | null; onRequestedCreationHandled?: () => void }) {
  const [tab, setTab] = useState<Tab>('week')
  const [coaches, setCoaches] = useState<CoachWithPerson[]>([])
  const [peopleById, setPeopleById] = useState<Map<string, ClubPerson>>(new Map())
  const [lessons, setLessons] = useState<LessonRow[]>([])
  const [studentRows, setStudentRows] = useState<TennisLessonStudent[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [form, setForm] = useState<{ lesson?: TennisLesson; draft: LessonDraft } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [coachFilter, setCoachFilter] = useState<string | null>(null)
  const today = todayInTimezone(club.timezone)

  const load = async () => {
    const [coachResult, lessonResult, studentResult] = await Promise.all([
      client.from('club_coaches').select('id, club_id, person_id, active, notes, created_at, updated_at').eq('club_id', club.id).order('created_at'),
      client.from('tennis_lessons').select('id, club_id, coach_id, reservation_id, lesson_type, capacity, status, notes, recurrence_series_id, created_at, updated_at').eq('club_id', club.id).order('created_at', { ascending: false }).limit(200),
      client.from('tennis_lesson_students').select('lesson_id, club_id, person_id').eq('club_id', club.id),
    ])
    if (coachResult.error || lessonResult.error || studentResult.error) { setStatus('error'); return }
    const coachList = (coachResult.data ?? []) as ClubCoach[]
    const lessonList = (lessonResult.data ?? []) as TennisLesson[]
    const students = (studentResult.data ?? []) as TennisLessonStudent[]
    const personIds = [...new Set([...coachList.map((coach) => coach.person_id), ...students.map((row) => row.person_id)])]
    const reservationIds = lessonList.map((lesson) => lesson.reservation_id)
    const [personResults, occupationResults] = await Promise.all([
      Promise.all(chunk(personIds, 80).map((ids) => client.from('club_people').select(personFields).eq('club_id', club.id).in('id', ids))),
      Promise.all(chunk(reservationIds, 80).map((ids) => client.from('reservations').select('id, court_id, starts_at, ends_at').in('id', ids))),
    ])
    if (occupationResults.some((result) => result.error)) { setStatus('error'); return }
    const people = new Map(personResults.flatMap((result) => (result.data ?? []) as ClubPerson[]).map((person) => [person.id, person]))
    const occupations = occupationResults.flatMap((result) => (result.data ?? []) as { id: string; court_id: string; starts_at: string; ends_at: string }[])
    setPeopleById(people)
    setCoaches(coachList.map((coach) => ({ ...coach, person: people.get(coach.person_id) ?? null })))
    setLessons(lessonList.map((lesson) => ({ ...lesson, reservation: occupations.find((occupation) => occupation.id === lesson.reservation_id) })))
    setStudentRows(students)
    setStatus('ready')
  }
  useEffect(() => { void load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, club.id])

  const views = useMemo<LessonView[]>(() => lessons.filter((lesson) => lesson.reservation).map((lesson) => {
    const reservation = lesson.reservation as NonNullable<LessonRow['reservation']>
    const start = isoToDateAndTime(reservation.starts_at, club.timezone)
    const end = isoToDateAndTime(reservation.ends_at, club.timezone)
    const coach = coaches.find((item) => item.id === lesson.coach_id)
    return { lesson, courtId: reservation.court_id, startsAt: reservation.starts_at, endsAt: reservation.ends_at, date: start.date, start: toMinutes(start.time), end: toMinutes(end.time), studentIds: studentRows.filter((row) => row.lesson_id === lesson.id).map((row) => row.person_id), coachName: coach ? coachName(coach) : 'Profesor' }
  }).sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [lessons, studentRows, coaches, club.timezone])
  const scheduled = views.filter((view) => view.lesson.status === 'scheduled')
  const open = views.find((view) => view.lesson.id === openId) ?? null

  useEffect(() => {
    if (!requestedLessonId || status !== 'ready') return
    const view = views.find((item) => item.lesson.id === requestedLessonId || item.lesson.reservation_id === requestedLessonId)
    if (view) { setTab('week'); setOpenId(view.lesson.id) } else setNotice({ tone: 'danger', text: 'No encontramos la clase seleccionada en la agenda.' })
    onRequestedLessonHandled?.()
  }, [requestedLessonId, status, views, onRequestedLessonHandled])
  useEffect(() => {
    if (!requestedCreation) return
    setTab('week')
    setForm({ draft: { ...defaultDraft(club, courts, coaches, requestedCreation.date, requestedCreation.startsAt), courtId: requestedCreation.courtId } })
    onRequestedCreationHandled?.()
  }, [requestedCreation, club, courts, coaches, onRequestedCreationHandled])

  const thisWeek = weekStart(today)
  const weekCount = scheduled.filter((view) => view.date >= thisWeek && view.date < addDays(thisWeek, 7)).length
  const studentCount = new Set(scheduled.filter((view) => view.date >= addDays(today, -7)).flatMap((view) => view.studentIds)).size
  const activeCoaches = coaches.filter((coach) => coach.active)
  const saved = async (text: string) => { await load(); setNotice({ tone: 'success', text }) }

  return (
    <div className="module">
      <PageHead
        eyebrow="Club"
        title="Escuela de tenis"
        meta={status === 'ready' ? `${plural(weekCount, 'clase', 'clases')} esta semana · ${plural(studentCount, 'alumno', 'alumnos')} · ${plural(activeCoaches.length, 'profesor', 'profesores')}` : 'Profesores, alumnos y clases en la agenda de canchas'}
        actions={<Button variant="accent" icon="plus" onClick={() => setForm({ draft: defaultDraft(club, courts, coaches) })}>Nueva clase</Button>}
      />
      <div className="module-tabs">
        <SegmentedTabs label="Secciones de la escuela" value={tab} onChange={setTab} items={[
          { id: 'week', label: 'Programación', icon: 'calendar' },
          { id: 'classes', label: 'Clases', icon: 'list' },
          { id: 'coaches', label: 'Profesores', icon: 'school' },
          { id: 'students', label: 'Alumnos', icon: 'users' },
        ]} />
      </div>

      {notice && <p className={`inline-alert ${notice.tone === 'danger' ? 'inline-alert-danger' : 'inline-alert-success'}`} role={notice.tone === 'danger' ? 'alert' : 'status'}><Icon name={notice.tone === 'danger' ? 'alert' : 'checkCircle'} size={20} /><span>{notice.text}</span></p>}

      {status === 'error' ? <ErrorState title="No pudimos cargar la escuela" onRetry={() => { setStatus('loading'); void load() }} />
        : status === 'loading' ? <SkeletonCards count={4} height={96} />
          : tab === 'week' ? <WeekView views={scheduled} courts={courts} today={today} coachFilter={coachFilter} setCoachFilter={setCoachFilter} coaches={activeCoaches} onOpen={setOpenId} onCreate={(date) => setForm({ draft: defaultDraft(club, courts, coaches, date, '17:00') })} />
            : tab === 'classes' ? <ClassList views={views} courts={courts} today={today} onOpen={setOpenId} onCreate={() => setForm({ draft: defaultDraft(club, courts, coaches) })} />
              : tab === 'coaches' ? <Coaches client={client} club={club} coaches={coaches} views={scheduled} today={today} canManage={canManageCoaches} onSchedule={(id) => { setCoachFilter(id); setTab('week') }} onChanged={saved} onError={(text) => setNotice({ tone: 'danger', text })} />
                : <Students views={scheduled} peopleById={peopleById} today={today} onOpen={setOpenId} />}

      {open && <LessonDetail client={client} club={club} view={open} courts={courts} peopleById={peopleById} onClose={() => setOpenId(null)} onEdit={() => { setOpenId(null); setForm({ lesson: open.lesson, draft: draftFor(open) }) }} onChanged={saved} />}
      {form && <LessonForm client={client} club={club} courts={courts} coaches={coaches} people={[...peopleById.values()]} lessons={views} initial={form.draft} lesson={form.lesson} onClose={() => setForm(null)} onSaved={() => saved(form.lesson ? 'Clase actualizada.' : 'Clase programada.')} />}
    </div>
  )
}

// ── Programación semanal ────────────────────────────────────────────
function WeekView({ views, courts, today, coaches, coachFilter, setCoachFilter, onOpen, onCreate }: { views: LessonView[]; courts: Court[]; today: string; coaches: CoachWithPerson[]; coachFilter: string | null; setCoachFilter: (id: string | null) => void; onOpen: (id: string) => void; onCreate: (date: string) => void }) {
  const isMobile = useIsMobile()
  const [start, setStart] = useState(weekStart(today))
  const [day, setDay] = useState(today)
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index))
  const visible = views.filter((view) => !coachFilter || view.lesson.coach_id === coachFilter)
  const ofDay = (date: string) => visible.filter((view) => view.date === date)
  const shift = (delta: number) => { const next = addDays(start, delta * 7); setStart(next); setDay(next <= today && today < addDays(next, 7) ? today : next) }
  const selectedDay = days.includes(day) ? day : days[0]
  const monthName = new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(new Date(`${days[6]}T12:00:00`))
  const total = days.reduce((sum, date) => sum + ofDay(date).length, 0)

  return (
    <section className="stack" aria-label="Programación semanal">
      <div className="week-toolbar">
        <div className="date-nav">
          <IconButton icon="chevronLeft" label="Semana anterior" variant="secondary" onClick={() => shift(-1)} />
          <div className="date-nav-label">
            <p className="date-nav-title display">{dayNumber(days[0])}–{dayNumber(days[6])} {monthName}</p>
            <p className="date-nav-sub">{start === weekStart(today) ? 'Esta semana · ' : ''}{plural(total, 'clase', 'clases')}</p>
          </div>
          <IconButton icon="chevronRight" label="Semana siguiente" variant="secondary" onClick={() => shift(1)} />
        </div>
        <div className="chip-row chip-row-scroll" role="group" aria-label="Filtrar por profesor">
          <Chip selected={!coachFilter} onClick={() => setCoachFilter(null)}>Todos</Chip>
          {coaches.map((coach) => <Chip key={coach.id} selected={coachFilter === coach.id} onClick={() => setCoachFilter(coach.id)}>{coachName(coach).split(' ')[0]}</Chip>)}
        </div>
      </div>

      {isMobile ? (
        <>
          <div className="date-strip" role="listbox" aria-label="Elegir día">
            {days.map((date) => {
              const count = ofDay(date).length
              return (
                <button key={date} type="button" role="option" aria-selected={date === selectedDay} className={`date-chip ${date === selectedDay ? 'is-selected' : ''} ${date === today ? 'is-today' : ''}`} onClick={() => setDay(date)}>
                  <span className="date-chip-wd">{date === today ? 'Hoy' : weekdayShort(date)}</span>
                  <span className="date-chip-n display num">{dayNumber(date)}</span>
                  <span className={`load load-${Math.min(count, 3)}`} aria-label={plural(count, 'clase', 'clases')}><i /><i /><i /></span>
                </button>
              )
            })}
          </div>
          <div className="day-lessons">
            <p className="day-lessons-title">{capitalize(dayLong(selectedDay))}</p>
            {ofDay(selectedDay).length === 0 ? (
              <div className="card"><EmptyState icon="school" title="Sin clases este día" action={<Button variant="secondary" icon="plus" onClick={() => onCreate(selectedDay)}>Programar clase</Button>} /></div>
            ) : (
              <ul className="lesson-stack">{ofDay(selectedDay).map((view) => <li key={view.lesson.id}><LessonCard view={view} courts={courts} onOpen={() => onOpen(view.lesson.id)} /></li>)}</ul>
            )}
          </div>
        </>
      ) : (
        <div className="week-board" tabIndex={0} aria-label="Semana de clases">
          {days.map((date) => (
            <div key={date} className={`week-col ${date === today ? 'is-today' : ''} ${date < today ? 'is-past' : ''}`}>
              <div className="week-col-head">
                <span className="week-col-wd">{weekdayShort(date)}</span>
                <span className="week-col-n display num">{dayNumber(date)}</span>
                {date === today && <Badge tone="accent">Hoy</Badge>}
              </div>
              <ul className="lesson-stack">
                {ofDay(date).map((view) => <li key={view.lesson.id}><LessonCard view={view} courts={courts} compact onOpen={() => onOpen(view.lesson.id)} /></li>)}
              </ul>
              {date >= today && <button type="button" className="week-add" onClick={() => onCreate(date)} aria-label={`Programar clase el ${dayLong(date)}`}><Icon name="plus" size={16} />Clase</button>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function LessonCard({ view, courts, compact = false, onOpen }: { view: LessonView; courts: Court[]; compact?: boolean; onOpen: () => void }) {
  const court = courts.find((item) => item.id === view.courtId)
  const now = Date.now()
  const live = new Date(view.startsAt).getTime() <= now && now < new Date(view.endsAt).getTime()
  const past = new Date(view.endsAt).getTime() <= now
  return (
    <button type="button" className={`lesson-card ${past ? 'is-past' : ''} ${live ? 'is-live' : ''} ${compact ? 'is-compact' : ''}`} onClick={onOpen}>
      <span className="lesson-card-time display num">{fromMinutes(view.start)}<small>{durationLabel(view.end - view.start)}</small></span>
      <span className="lesson-card-main">
        <strong>{typeLabel(view.lesson.lesson_type)}</strong>
        <span className="lesson-card-coach"><Avatar name={view.coachName} size="sm" />{view.coachName}</span>
      </span>
      <span className="lesson-card-side">
        <CourtMark label={court ? courtShort(court) : '?'} size="sm" />
        <span className={`lesson-cap ${view.studentIds.length >= view.lesson.capacity ? 'is-full' : ''}`}><Icon name="users" size={14} /><span className="num">{view.studentIds.length}/{view.lesson.capacity}</span></span>
      </span>
      {live && <span className="lesson-live">En curso</span>}
      {view.lesson.recurrence_series_id && <Icon name="repeat" size={14} className="lesson-series" label="Se repite cada semana" />}
    </button>
  )
}

// ── Clases (series) ─────────────────────────────────────────────────
function ClassList({ views, courts, today, onOpen, onCreate }: { views: LessonView[]; courts: Court[]; today: string; onOpen: (id: string) => void; onCreate: () => void }) {
  const [type, setType] = useState<'all' | 'group' | 'individual' | 'cancelled'>('all')
  const now = Date.now()
  const pool = views.filter((view) => (type === 'cancelled' ? view.lesson.status === 'cancelled' : view.lesson.status === 'scheduled' && (type === 'all' || view.lesson.lesson_type === type)))
  const groups = new Map<string, LessonView[]>()
  pool.forEach((view) => { const key = view.lesson.recurrence_series_id ?? view.lesson.id; groups.set(key, [...(groups.get(key) ?? []), view]) })
  const rows = [...groups.values()].map((items) => {
    const upcoming = items.filter((item) => new Date(item.endsAt).getTime() > now)
    return { first: items[0], next: upcoming[0], remaining: upcoming.length, total: items.length }
  }).sort((a, b) => (a.next && b.next ? a.next.startsAt.localeCompare(b.next.startsAt) : a.next ? -1 : b.next ? 1 : b.first.startsAt.localeCompare(a.first.startsAt)))
  const cancelledCount = views.filter((view) => view.lesson.status === 'cancelled').length
  if (views.length === 0) return <div className="card"><EmptyState icon="school" title="Todavía no hay clases" body="Programá la primera: ocupa la cancha en la agenda única." action={<Button variant="accent" icon="plus" onClick={onCreate}>Nueva clase</Button>} /></div>
  return (
    <section className="stack" aria-label="Clases">
      <div className="chip-row">
        <Chip selected={type === 'all'} onClick={() => setType('all')}>Todas</Chip>
        <Chip selected={type === 'group'} icon="users" onClick={() => setType('group')}>Grupales</Chip>
        <Chip selected={type === 'individual'} icon="user" onClick={() => setType('individual')}>Individuales</Chip>
        {cancelledCount > 0 && <Chip selected={type === 'cancelled'} count={cancelledCount} onClick={() => setType('cancelled')}>Canceladas</Chip>}
      </div>
      {rows.length === 0 ? <div className="card"><EmptyState icon="search" title="Sin clases para este filtro" /></div> : (
        <ul className="class-grid">
          {rows.map(({ first, next, remaining, total }) => {
            const ref = next ?? first
            const court = courts.find((item) => item.id === ref.courtId)
            return (
              <li key={first.lesson.recurrence_series_id ?? first.lesson.id}>
                <button type="button" className={`class-card ${next ? '' : 'is-past'}`} onClick={() => onOpen(ref.lesson.id)}>
                  <span className="class-card-head">
                    <Badge tone={first.lesson.lesson_type === 'individual' ? 'info' : 'accent'} icon={first.lesson.lesson_type === 'individual' ? 'user' : 'users'}>{first.lesson.lesson_type === 'individual' ? 'Individual' : 'Grupal'}</Badge>
                    {total > 1 && <Badge tone="neutral" icon="repeat">Semanal</Badge>}
                    {first.lesson.status === 'cancelled' && <Badge tone="danger">Cancelada</Badge>}
                  </span>
                  <strong className="class-card-title">{typeLabel(first.lesson.lesson_type)}</strong>
                  <span className="class-card-when"><b className="display num">{capitalize(weekdayShort(ref.date))} {fromMinutes(ref.start)}</b> · {court?.name ?? 'Cancha'} · {durationLabel(ref.end - ref.start)}</span>
                  <span className="class-card-coach"><Avatar name={first.coachName} size="sm" />{first.coachName}</span>
                  <span className="class-card-foot">
                    <span className="lesson-cap"><Icon name="users" size={14} /><span className="num">{ref.studentIds.length}/{ref.lesson.capacity}</span></span>
                    <span className="muted">{first.lesson.status === 'cancelled' ? dateShort(ref.date) : next ? `Próxima ${next.date === today ? 'hoy' : dateShort(next.date)} · ${plural(remaining, 'clase', 'clases')} por delante` : 'Sin clases futuras'}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ── Profesores ──────────────────────────────────────────────────────
function Coaches({ client, club, coaches, views, today, canManage, onSchedule, onChanged, onError }: { client: SupabaseClient; club: Club; coaches: CoachWithPerson[]; views: LessonView[]; today: string; canManage: boolean; onSchedule: (id: string) => void; onChanged: (text: string) => Promise<void>; onError: (text: string) => void }) {
  const [picking, setPicking] = useState(false)
  const [toggle, setToggle] = useState<CoachWithPerson | null>(null)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const search = usePersonSearch(client, club, picking)
  const action = useAsyncAction()
  const sorted = [...coaches].sort((a, b) => (a.active === b.active ? coachName(a).localeCompare(coachName(b), 'es') : a.active ? -1 : 1))
  const week = weekStart(today)
  const now = Date.now()
  const stats = (id: string) => {
    const mine = views.filter((view) => view.lesson.coach_id === id)
    const thisWeek = mine.filter((view) => view.date >= week && view.date < addDays(week, 7))
    return { week: thisWeek.length, minutes: thisWeek.reduce((sum, view) => sum + view.end - view.start, 0), students: new Set(mine.flatMap((view) => view.studentIds)).size, upcoming: mine.filter((view) => new Date(view.endsAt).getTime() > now).length }
  }
  const pickerItems: PickerItem[] = search.results.map((person) => ({ id: person.id, name: person.full_name, hint: person.phone ?? undefined, disabledReason: coaches.some((coach) => coach.person_id === person.id) ? 'Ya es profesor' : undefined }))
  const register = async (personId: string) => {
    const { error } = await client.from('club_coaches').insert({ club_id: club.id, person_id: personId, active: true, notes: null })
    if (error) { setPickerError('No pudimos registrar el profesor. Puede que esa persona ya tenga un perfil en este club.'); return }
    setPicking(false); search.reset(); setPickerError(null); await onChanged('Profesor registrado.')
  }
  const createAndRegister = async (name: string) => {
    const result = await createQuickPerson(client, club, name)
    if (result.error || !result.person) { setPickerError(result.error ?? 'No pudimos crear la ficha.'); return }
    await register(result.person.id)
  }
  const confirmToggle = () => toggle && void action.run(async () => {
    const { error } = await client.from('club_coaches').update({ active: !toggle.active }).eq('id', toggle.id).eq('club_id', club.id)
    if (error) { onError('No pudimos actualizar el profesor.'); return 'No pudimos actualizar el profesor.' }
    setToggle(null)
    await onChanged(toggle.active ? 'Profesor desactivado.' : 'Profesor activado.')
    return null
  })
  return (
    <section className="stack" aria-label="Profesores">
      <ul className="coach-grid">
        {sorted.map((coach) => {
          const info = stats(coach.id)
          return (
            <li key={coach.id} className={`coach-card ${coach.active ? '' : 'is-inactive'}`}>
              <div className="coach-card-head">
                <Avatar name={coachName(coach)} size="lg" />
                <div><strong>{coachName(coach)}</strong><span>{coach.person?.phone ?? coach.notes ?? 'Sin teléfono'}</span></div>
                <Badge tone={coach.active ? 'success' : 'neutral'} dot>{coach.active ? 'Activo' : 'Inactivo'}</Badge>
              </div>
              <dl className="coach-stats">
                <div><dt>Esta semana</dt><dd className="display num">{info.week}</dd><dd className="coach-stat-foot">{info.minutes ? durationLabel(info.minutes) : 'sin clases'}</dd></div>
                <div><dt>Alumnos</dt><dd className="display num">{info.students}</dd></div>
                <div><dt>Próximas</dt><dd className="display num">{info.upcoming}</dd></div>
              </dl>
              <div className="coach-actions">
                {coach.active && <Button variant="secondary" size="sm" icon="calendar" onClick={() => onSchedule(coach.id)}>Ver programación</Button>}
                {canManage && <Button variant="ghost" size="sm" icon={coach.active ? 'power' : 'undo'} onClick={() => { action.reset(); setToggle(coach) }}>{coach.active ? 'Desactivar' : 'Activar'}</Button>}
              </div>
            </li>
          )
        })}
        {canManage && (
          <li>
            <button type="button" className="coach-add" onClick={() => { setPickerError(null); setPicking(true) }}><Icon name="userPlus" size={26} /><strong>Agregar profesor</strong><span>Desde una ficha existente</span></button>
          </li>
        )}
      </ul>
      {coaches.length === 0 && !canManage && <div className="card"><EmptyState icon="school" title="Todavía no hay profesores registrados" /></div>}
      <p className="detail-footnote"><Icon name="info" size={16} />Ser profesor no da acceso a la administración. Pagos y liquidaciones de profesores no están contemplados.</p>
      <PersonPicker open={picking} title="Agregar profesor" hint="Elegí la ficha de la persona que dicta clases." items={pickerItems} query={search.query} onQueryChange={search.setQuery} loading={search.loading} error={pickerError} onClose={() => { setPicking(false); search.reset() }} onPick={(id) => void register(id)} onCreate={(name) => void createAndRegister(name)} />
      <ConfirmDialog open={toggle !== null} title={toggle?.active ? `¿Desactivar a ${toggle ? coachName(toggle) : ''}?` : `¿Activar a ${toggle ? coachName(toggle) : ''}?`} confirmLabel={toggle?.active ? 'Desactivar' : 'Activar'} tone={toggle?.active ? 'danger' : 'primary'} icon="power" status={action.status} errorBody={action.message ?? undefined} onConfirm={confirmToggle} onClose={() => setToggle(null)}>
        {toggle?.active && stats(toggle.id).upcoming > 0
          ? <p className="inline-alert inline-alert-warning"><Icon name="alert" size={20} /><span>Tiene {plural(stats(toggle.id).upcoming, 'clase próxima', 'clases próximas')}. Siguen en la agenda: reasignalas o cancelalas desde cada clase.</span></p>
          : <p className="muted">{toggle?.active ? 'No podrá asignarse a clases nuevas.' : 'Vuelve a estar disponible para programar clases.'}</p>}
      </ConfirmDialog>
    </section>
  )
}

// ── Alumnos ─────────────────────────────────────────────────────────
function Students({ views, peopleById, today, onOpen }: { views: LessonView[]; peopleById: Map<string, ClubPerson>; today: string; onOpen: (lessonId: string) => void }) {
  const [query, setQuery] = useState('')
  const now = Date.now()
  const map = new Map<string, LessonView[]>()
  views.forEach((view) => view.studentIds.forEach((id) => map.set(id, [...(map.get(id) ?? []), view])))
  const rows = [...map.entries()]
    .map(([id, items]) => ({ id, name: peopleById.get(id)?.full_name ?? 'Alumno', items, next: items.find((item) => new Date(item.endsAt).getTime() > now) }))
    .filter((row) => normalizeSearch(row.name).includes(normalizeSearch(query)))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return (
    <section className="stack" aria-label="Alumnos">
      <div className="list-toolbar"><TextInput icon="search" type="search" placeholder="Buscar alumno" aria-label="Buscar alumno" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      {rows.length === 0 ? <div className="card"><EmptyState icon="users" title={map.size === 0 ? 'Todavía no hay alumnos vinculados' : 'Nadie coincide con la búsqueda'} body="Los alumnos aparecen cuando están vinculados a una clase. Sumalos desde el detalle de cada clase." /></div> : (
        <ul className="list-card">
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" className="due-item" onClick={() => onOpen((row.next ?? row.items[row.items.length - 1]).lesson.id)}>
                <Avatar name={row.name} />
                <span className="due-item-main"><strong>{row.name}</strong><span>{plural(row.items.length, 'clase vinculada', 'clases vinculadas')}</span></span>
                <span className="due-item-side">{row.next ? <><span className="muted">Próxima</span><strong className="num">{row.next.date === today ? 'Hoy' : `${capitalize(weekdayShort(row.next.date))} ${dateShort(row.next.date)}`} {fromMinutes(row.next.start)}</strong></> : <span className="muted">Sin clases próximas</span>}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Detalle de clase ────────────────────────────────────────────────
function LessonDetail({ client, club, view, courts, peopleById, onClose, onEdit, onChanged }: { client: SupabaseClient; club: Club; view: LessonView; courts: Court[]; peopleById: Map<string, ClubPerson>; onClose: () => void; onEdit: () => void; onChanged: (text: string) => Promise<void> }) {
  const [picking, setPicking] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const search = usePersonSearch(client, club, picking)
  const action = useAsyncAction()
  const { lesson } = view
  const court = courts.find((item) => item.id === view.courtId)
  const ids = view.studentIds
  const full = ids.length >= lesson.capacity
  const cancelled = lesson.status === 'cancelled'
  const nameOf = (id: string) => peopleById.get(id)?.full_name ?? names[id] ?? 'Alumno'

  const saveStudents = (studentIds: string[], message: string) => void action.run(async () => {
    const { error } = await client.rpc('update_tennis_lesson', { p_lesson_id: lesson.id, p_coach_id: lesson.coach_id, p_court_id: view.courtId, p_starts_at: view.startsAt, p_ends_at: view.endsAt, p_lesson_type: lesson.lesson_type, p_capacity: lesson.capacity, p_student_ids: studentIds, p_notes: lesson.notes })
    if (error) return 'No pudimos guardar el cambio. Los alumnos no cambiaron.'
    await onChanged(message)
    return null
  })
  const addStudent = (person: ClubPerson) => {
    if (ids.includes(person.id)) return
    setNames((current) => ({ ...current, [person.id]: person.full_name }))
    setPicking(false); search.reset(); setPickerError(null)
    saveStudents([...ids, person.id], `${person.full_name} se sumó a la clase.`)
  }
  const createStudent = async (name: string) => {
    const result = await createQuickPerson(client, club, name)
    if (result.error || !result.person) { setPickerError(result.error ?? 'No pudimos crear la ficha.'); return }
    addStudent(result.person)
  }
  const cancelLesson = () => void action.run(async () => {
    const { error } = await client.rpc('cancel_tennis_lesson', { p_lesson_id: lesson.id })
    if (error) return 'No pudimos cancelar la clase.'
    setCancelling(false); onClose()
    await onChanged('Clase cancelada. La cancha volvió a quedar disponible.')
    return null
  })
  const pickerItems: PickerItem[] = search.results.map((person) => ({ id: person.id, name: person.full_name, hint: person.phone ?? undefined, disabledReason: ids.includes(person.id) ? 'Ya está en la clase' : undefined }))

  return (
    <>
      <Modal open={!picking && !cancelling} onClose={onClose} variant="drawer" size="sm" eyebrow={typeLabel(lesson.lesson_type)} title={`${view.coachName} · ${fromMinutes(view.start)}`}
        footer={!cancelled ? (
          <div className="form-actions">
            <Button variant="ghost" icon="x" onClick={() => { action.reset(); setCancelling(true) }}>Cancelar clase</Button>
            <Button variant="primary" icon="edit" onClick={onEdit}>Editar</Button>
          </div>
        ) : undefined}
      >
        <div className="detail">
          <div className="detail-hero occ-lesson">
            <span className="detail-time num">{fromMinutes(view.start)}–{fromMinutes(view.end)}</span>
            <span>{court?.name ?? 'Cancha'} · {capitalize(dayLong(view.date))} · {durationLabel(view.end - view.start)}</span>
          </div>
          <dl className="detail-list">
            <div><dt>Profesor</dt><dd className="detail-person"><Avatar name={view.coachName} size="sm" />{view.coachName}</dd></div>
            <div><dt>Estado</dt><dd>{cancelled ? <Badge tone="danger">Cancelada</Badge> : <Badge tone="success">Programada</Badge>}</dd></div>
            <div><dt>Repetición</dt><dd>{lesson.recurrence_series_id ? <><Badge tone="info" icon="repeat">Semanal</Badge><span className="muted">cada ocurrencia se edita por separado</span></> : 'Única'}</dd></div>
            {lesson.notes && <div><dt>Observación</dt><dd>{lesson.notes}</dd></div>}
          </dl>

          <section className="detail-section" aria-labelledby="ld-students">
            <div className="detail-section-head">
              <h3 id="ld-students" className="detail-section-title">Alumnos <span className="num muted">{ids.length}/{lesson.capacity}</span></h3>
              {!cancelled && <Button variant="secondary" size="sm" icon="userPlus" disabled={full || action.saving} onClick={() => { setPickerError(null); setPicking(true) }}>{full ? 'Cupo completo' : 'Agregar'}</Button>}
            </div>
            <Meter value={ids.length} max={lesson.capacity} label={`${ids.length} de ${lesson.capacity} lugares`} tone={full ? 'clay' : 'ball'} />
            {ids.length === 0 ? <p className="muted">Sin alumnos todavía. La clase ocupa la cancha igual.</p> : (
              <ul className="person-chips">
                {ids.map((id) => <PersonChip key={id} name={nameOf(id)} onRemove={cancelled ? undefined : () => saveStudents(ids.filter((other) => other !== id), `${nameOf(id)} ya no está en la clase.`)} />)}
              </ul>
            )}
            {action.failed && !cancelling && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardó el cambio</strong><p>{action.message}</p></div></div>}
          </section>
          <p className="detail-footnote"><Icon name="calendar" size={16} />La clase ocupa la cancha en la agenda de Reservas; allí también se ve junto al resto de la ocupación.</p>
        </div>
      </Modal>
      <PersonPicker open={picking} title="Agregar alumno" hint={`Quedan ${Math.max(0, lesson.capacity - ids.length)} lugares.`} items={pickerItems} query={search.query} onQueryChange={search.setQuery} loading={search.loading} error={pickerError} onClose={() => { setPicking(false); search.reset() }} onPick={(id) => { const person = search.results.find((item) => item.id === id); if (person) addStudent(person) }} onCreate={(name) => void createStudent(name)} />
      <ConfirmDialog open={cancelling} title="¿Cancelar esta clase?" confirmLabel="Cancelar clase" icon="x" status={action.status} onConfirm={cancelLesson} onClose={() => setCancelling(false)} errorTitle="No se canceló" errorBody={action.message ?? 'La clase sigue programada.'}>
        <p><b>{typeLabel(lesson.lesson_type)}</b> · {capitalize(dateShort(view.date))} · <span className="num">{fromMinutes(view.start)}–{fromMinutes(view.end)}</span></p>
        <p className="muted">Se conserva el historial y la cancha queda libre en la agenda. {lesson.recurrence_series_id ? 'Solo se cancela esta fecha; el resto de la serie sigue igual.' : ''}</p>
      </ConfirmDialog>
    </>
  )
}
