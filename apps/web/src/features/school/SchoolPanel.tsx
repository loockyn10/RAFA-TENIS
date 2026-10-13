import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club, ClubCoach, ClubPerson, Court, LessonDraft, TennisLesson, TennisLessonStudent } from '../../types/domain'
import { isoToDateAndTime, shiftCalendarDate, todayInTimezone, weeklyOccurrenceDates, zonedDateTimeToIso } from '../reservations/reservationUtils'

type CoachWithPerson = ClubCoach & { person?: Pick<ClubPerson, 'full_name'> | null }
type LessonWithOccupation = TennisLesson & { reservation?: { court_id: string; starts_at: string; ends_at: string } }

const slots = Array.from({ length: 32 }, (_, index) => {
  const total = (7 * 60) + index * 30
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
})

function coachName(coach: CoachWithPerson) { return coach.person?.full_name ?? 'Profesor sin nombre' }

function defaultDraft(club: Club, courts: Court[], coaches: CoachWithPerson[], date = todayInTimezone(club.timezone), startsAt = '07:00'): LessonDraft {
  const startMinutes = Number(startsAt.slice(0, 2)) * 60 + Number(startsAt.slice(3))
  const endMinutes = Math.min(startMinutes + 60, 23 * 60)
  return { coachId: coaches.find((coach) => coach.active)?.id ?? '', courtId: courts.find((court) => court.active)?.id ?? '', date, startsAt, endsAt: `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`, lessonType: 'individual', capacity: 1, studentIds: [], notes: '', recurrence: 'single', recurrenceUntil: shiftCalendarDate(date, 77) }
}

export function LessonForm({ client, club, courts, coaches, people = [], initial, lesson, onClose, onSaved, onCancel }: { client: SupabaseClient; club: Club; courts: Court[]; coaches: CoachWithPerson[]; people?: ClubPerson[]; initial: LessonDraft; lesson?: TennisLesson; onClose: () => void; onSaved: () => Promise<void>; onCancel?: (lesson: TennisLesson) => Promise<string | null> }) {
  const [draft, setDraft] = useState(initial)
  const [students, setStudents] = useState<ClubPerson[]>([])
  const [search, setSearch] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const query = search.trim()
    if (query.length < 2) { setStudents([]); return }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      const { data } = await client.from('club_people').select('id, club_id, full_name, phone, email, notes, active, created_at, updated_at').eq('club_id', club.id).eq('active', true).ilike('full_name', `%${query.replace(/[%_,()]/g, ' ')}%`).order('full_name').limit(8)
      if (!cancelled) setStudents((data ?? []) as ClubPerson[])
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [client, club.id, search])
  const selectedStudents = useMemo(() => students.filter((person) => draft.studentIds.includes(person.id)), [students, draft.studentIds])
  const count = draft.recurrence === 'weekly' ? weeklyOccurrenceDates(draft.date, draft.recurrenceUntil).length : 1
  const addStudent = (person: ClubPerson) => {
    if (draft.studentIds.includes(person.id)) return
    if (draft.studentIds.length >= draft.capacity) return setFeedback('El cupo de la clase ya está completo.')
    setDraft({ ...draft, studentIds: [...draft.studentIds, person.id] }); setSearch(''); setStudents([])
  }
  const createStudent = async () => {
    const fullName = search.trim()
    if (!fullName) return
    const { data, error } = await client.from('club_people').insert({ club_id: club.id, full_name: fullName, active: true }).select('id, club_id, full_name, phone, email, notes, active, created_at, updated_at').single()
    if (error || !data) return setFeedback('No pudimos crear la ficha del alumno. Intentá nuevamente.')
    addStudent(data as ClubPerson)
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setFeedback(null)
    if (!draft.coachId || !draft.courtId) return setFeedback('Elegí un profesor y una cancha.')
    if (draft.endsAt <= draft.startsAt) return setFeedback('La hora de finalización debe ser posterior a la de inicio.')
    if (draft.studentIds.length > draft.capacity) return setFeedback('La cantidad de alumnos supera el cupo.')
    if (!lesson && draft.recurrence === 'weekly' && (count < 1 || count > 12)) return setFeedback('La serie semanal debe tener entre 1 y 12 clases.')
    setSaving(true)
    const startsAt = zonedDateTimeToIso(draft.date, draft.startsAt, club.timezone)
    const endsAt = zonedDateTimeToIso(draft.date, draft.endsAt, club.timezone)
    const args = lesson ? { p_lesson_id: lesson.id, p_coach_id: draft.coachId, p_court_id: draft.courtId, p_starts_at: startsAt, p_ends_at: endsAt, p_lesson_type: draft.lessonType, p_capacity: draft.capacity, p_student_ids: draft.studentIds, p_notes: draft.notes.trim() || null } : draft.recurrence === 'weekly' ? { p_club_id: club.id, p_coach_id: draft.coachId, p_court_id: draft.courtId, p_starts_at: startsAt, p_ends_at: endsAt, p_lesson_type: draft.lessonType, p_capacity: draft.capacity, p_student_ids: draft.studentIds, p_notes: draft.notes.trim() || null, p_occurrence_count: count } : { p_club_id: club.id, p_coach_id: draft.coachId, p_court_id: draft.courtId, p_starts_at: startsAt, p_ends_at: endsAt, p_lesson_type: draft.lessonType, p_capacity: draft.capacity, p_student_ids: draft.studentIds, p_notes: draft.notes.trim() || null }
    const rpc = lesson ? 'update_tennis_lesson' : draft.recurrence === 'weekly' ? 'create_weekly_tennis_lesson_series' : 'create_tennis_lesson'
    const { error } = await client.rpc(rpc, args)
    setSaving(false)
    if (error) return setFeedback(error.code === '23P01' ? 'La cancha o el profesor ya tienen una ocupación en ese horario.' : 'No pudimos guardar la clase. Revisá los datos e intentá nuevamente.')
    await onSaved(); onClose()
  }
  const cancel = async () => {
    if (!lesson || !onCancel || !window.confirm('¿Cancelar esta clase? Se conservará el historial y se liberará la cancha.')) return
    setSaving(true); const error = await onCancel(lesson); setSaving(false); if (error) setFeedback(error)
  }
  return <div className="reservation-modal-backdrop" role="presentation"><section className="reservation-modal" role="dialog" aria-modal="true" aria-labelledby="lesson-form-title">
    <div className="modal-heading"><div><p className="eyebrow">Escuela de tenis</p><h2 id="lesson-form-title">{lesson ? 'Editar clase' : 'Nueva clase'}</h2></div><button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}>×</button></div>
    <form className="reservation-form" onSubmit={(event) => void submit(event)}>
      <label>Profesor<select value={draft.coachId} onChange={(event) => setDraft({ ...draft, coachId: event.target.value })} required><option value="">Elegí un profesor</option>{coaches.filter((coach) => coach.active || coach.id === draft.coachId).map((coach) => <option key={coach.id} value={coach.id}>{coachName(coach)}{coach.active ? '' : ' (inactivo)'}</option>)}</select></label>
      <label>Tipo de clase<select value={draft.lessonType} onChange={(event) => { const lessonType = event.target.value as LessonDraft['lessonType']; setDraft({ ...draft, lessonType, capacity: lessonType === 'individual' ? 1 : Math.max(2, draft.capacity), studentIds: lessonType === 'individual' ? draft.studentIds.slice(0, 1) : draft.studentIds }) }}><option value="individual">Individual</option><option value="group">Grupal</option></select></label>
      {draft.lessonType === 'group' && <label>Cupo<input type="number" min="1" max="99" value={draft.capacity} onChange={(event) => setDraft({ ...draft, capacity: Math.max(1, Number(event.target.value) || 1), studentIds: draft.studentIds.slice(0, Math.max(1, Number(event.target.value) || 1)) })} /></label>}
      <label>Cancha<select value={draft.courtId} onChange={(event) => setDraft({ ...draft, courtId: event.target.value })}>{courts.filter((court) => court.active || court.id === draft.courtId).map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select></label>
      <label>Fecha<input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} required /></label>
      <div className="time-fields"><label>Desde<select value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })}>{slots.map((slot) => <option key={slot}>{slot}</option>)}</select></label><label>Hasta<select value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })}>{slots.map((slot) => <option key={slot}>{slot}</option>)}<option>23:00</option></select></label></div>
      {!lesson && <fieldset className="recurrence-fieldset"><legend>Repetición</legend><label><input type="radio" checked={draft.recurrence === 'single'} onChange={() => setDraft({ ...draft, recurrence: 'single' })} /> Clase única</label><label><input type="radio" checked={draft.recurrence === 'weekly'} onChange={() => setDraft({ ...draft, recurrence: 'weekly' })} /> Repetir semanalmente</label>{draft.recurrence === 'weekly' && <label>Última fecha<input aria-label="Última fecha de la serie" type="date" min={draft.date} value={draft.recurrenceUntil} onChange={(event) => setDraft({ ...draft, recurrenceUntil: event.target.value })} /><span className="field-help">Se crearán {count} clases (máximo 12). Cada ocurrencia se podrá editar o cancelar por separado.</span></label>}</fieldset>}
      <fieldset className="recurrence-fieldset"><legend>Alumnos ({draft.studentIds.length}/{draft.capacity})</legend><label>Buscar o crear alumno<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre del alumno" /></label>{search.trim() && <button type="button" className="secondary-button" onClick={() => void createStudent()} disabled={saving}>Crear “{search.trim()}”</button>}{students.filter((person) => !draft.studentIds.includes(person.id)).map((person) => <button type="button" className="student-match" key={person.id} onClick={() => addStudent(person)}>{person.full_name}</button>)}{draft.studentIds.map((id) => <div className="selected-person" key={id}><span>{people.find((person) => person.id === id)?.full_name ?? selectedStudents.find((person) => person.id === id)?.full_name ?? 'Alumno seleccionado'}</span><button type="button" className="secondary-button" onClick={() => setDraft({ ...draft, studentIds: draft.studentIds.filter((studentId) => studentId !== id) })}>Quitar</button></div>)}</fieldset>
      <label>Observaciones <span className="optional-label">(opcional)</span><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={3} /></label>
      {feedback && <p className="form-error" role="alert">{feedback}</p>}
      <div className="modal-actions">{lesson && <button className="danger-button" type="button" onClick={() => void cancel()} disabled={saving}>Cancelar clase</button>}<button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Volver</button><button disabled={saving}>{saving ? 'Guardando…' : lesson ? 'Guardar cambios' : draft.recurrence === 'weekly' ? 'Crear serie' : 'Crear clase'}</button></div>
    </form>
  </section></div>
}

export function SchoolPanel({ client, club, courts, canManageCoaches, requestedLessonId, onRequestedLessonHandled, requestedCreation, onRequestedCreationHandled }: { client: SupabaseClient; club: Club; courts: Court[]; canManageCoaches: boolean; requestedLessonId?: string | null; onRequestedLessonHandled?: () => void; requestedCreation?: { courtId: string; date: string; startsAt: string } | null; onRequestedCreationHandled?: () => void }) {
  const [tab, setTab] = useState<'coaches' | 'lessons' | 'students'>('lessons')
  const [coaches, setCoaches] = useState<CoachWithPerson[]>([])
  const [people, setPeople] = useState<ClubPerson[]>([])
  const [lessons, setLessons] = useState<LessonWithOccupation[]>([])
  const [studentRows, setStudentRows] = useState<TennisLessonStudent[]>([])
  const [feedback, setFeedback] = useState<string | null>(null)
  const [form, setForm] = useState<{ lesson?: TennisLesson; draft: LessonDraft } | null>(null)
  const load = async () => {
    const [coachResult, personResult, lessonResult, studentResult] = await Promise.all([
      client.from('club_coaches').select('id, club_id, person_id, active, notes, created_at, updated_at').eq('club_id', club.id).order('created_at'),
      client.from('club_people').select('id, club_id, full_name, phone, email, notes, active, created_at, updated_at').eq('club_id', club.id).order('full_name').limit(200),
      client.from('tennis_lessons').select('id, club_id, coach_id, reservation_id, lesson_type, capacity, status, notes, recurrence_series_id, created_at, updated_at').eq('club_id', club.id).order('created_at', { ascending: false }).limit(200),
      client.from('tennis_lesson_students').select('lesson_id, club_id, person_id').eq('club_id', club.id),
    ])
    if (coachResult.error || personResult.error || lessonResult.error || studentResult.error) return setFeedback('No pudimos cargar toda la información de la escuela de tenis.')
    const personList = (personResult.data ?? []) as ClubPerson[]; setPeople(personList)
    setCoaches(((coachResult.data ?? []) as ClubCoach[]).map((coach) => ({ ...coach, person: personList.find((person) => person.id === coach.person_id) ?? null })))
    const lessonList = (lessonResult.data ?? []) as TennisLesson[]
    const reservationIds = lessonList.map((lesson) => lesson.reservation_id)
    const occupationResult = reservationIds.length ? await client.from('reservations').select('id, court_id, starts_at, ends_at').in('id', reservationIds) : { data: [], error: null }
    if (occupationResult.error) return setFeedback('No pudimos cargar los horarios de las clases.')
    setLessons(lessonList.map((lesson) => ({ ...lesson, reservation: (occupationResult.data ?? []).find((occupation) => occupation.id === lesson.reservation_id) })))
    setStudentRows((studentResult.data ?? []) as TennisLessonStudent[])
  }
  useEffect(() => { void load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, club.id])
  useEffect(() => {
    if (!requestedLessonId || lessons.length === 0) return
    const lesson = lessons.find((item) => item.id === requestedLessonId || item.reservation_id === requestedLessonId)
    if (lesson?.reservation) {
      const start = isoToDateAndTime(lesson.reservation.starts_at, club.timezone); const end = isoToDateAndTime(lesson.reservation.ends_at, club.timezone)
      setTab('lessons'); setForm({ lesson, draft: { coachId: lesson.coach_id, courtId: lesson.reservation.court_id, date: start.date, startsAt: start.time, endsAt: end.time, lessonType: lesson.lesson_type, capacity: lesson.capacity, studentIds: studentRows.filter((row) => row.lesson_id === lesson.id).map((row) => row.person_id), notes: lesson.notes ?? '', recurrence: 'single', recurrenceUntil: start.date } })
    }
    onRequestedLessonHandled?.()
  }, [requestedLessonId, lessons, studentRows, club.timezone, onRequestedLessonHandled])
  useEffect(() => {
    if (!requestedCreation) return
    setTab('lessons')
    setForm({ draft: { ...defaultDraft(club, courts, coaches, requestedCreation.date, requestedCreation.startsAt), courtId: requestedCreation.courtId } })
    onRequestedCreationHandled?.()
  }, [requestedCreation, club, courts, coaches, onRequestedCreationHandled])
  const saveCoach = async (personId: string, active: boolean, notes: string) => {
    const { error } = await client.from('club_coaches').insert({ club_id: club.id, person_id: personId, active, notes: notes.trim() || null })
    if (error) return setFeedback('No pudimos registrar el profesor. Puede que esa persona ya tenga un perfil en este club.')
    setFeedback('Profesor registrado.'); await load()
  }
  const cancelLesson = async (lesson: TennisLesson) => { const { error } = await client.rpc('cancel_tennis_lesson', { p_lesson_id: lesson.id }); if (error) return 'No pudimos cancelar la clase.'; await load(); setFeedback('Clase cancelada. La cancha volvió a quedar disponible.'); setForm(null); return null }
  const visibleLessons = lessons.filter((lesson) => lesson.reservation).sort((a, b) => (a.reservation?.starts_at ?? '').localeCompare(b.reservation?.starts_at ?? ''))
  return <section className="school-section" aria-labelledby="school-title">
    <div className="section-heading"><div><p className="eyebrow">Operación</p><h2 id="school-title">Escuela de tenis</h2><p>Profesores, alumnos y clases conectados con la misma agenda de canchas.</p></div><button type="button" onClick={() => setForm({ draft: defaultDraft(club, courts, coaches) })}>Nueva clase</button></div>
    <nav className="school-nav" aria-label="Secciones de la escuela"><button className={tab === 'lessons' ? 'nav-button active' : 'nav-button'} onClick={() => setTab('lessons')} type="button">Clases</button><button className={tab === 'coaches' ? 'nav-button active' : 'nav-button'} onClick={() => setTab('coaches')} type="button">Profesores</button><button className={tab === 'students' ? 'nav-button active' : 'nav-button'} onClick={() => setTab('students')} type="button">Alumnos</button></nav>
    {feedback && <p className="form-success" role="status">{feedback}</p>}
    {tab === 'lessons' && <div className="school-list">{visibleLessons.length === 0 ? <p className="subtle-copy">Todavía no hay clases registradas.</p> : visibleLessons.map((lesson) => { const coach = coaches.find((item) => item.id === lesson.coach_id); const court = courts.find((item) => item.id === lesson.reservation?.court_id); const start = lesson.reservation && isoToDateAndTime(lesson.reservation.starts_at, club.timezone); return <button className="school-row" key={lesson.id} type="button" onClick={() => lesson.reservation && setForm({ lesson, draft: { coachId: lesson.coach_id, courtId: lesson.reservation.court_id, date: start?.date ?? '', startsAt: start?.time ?? '', endsAt: lesson.reservation ? isoToDateAndTime(lesson.reservation.ends_at, club.timezone).time : '', lessonType: lesson.lesson_type, capacity: lesson.capacity, studentIds: studentRows.filter((row) => row.lesson_id === lesson.id).map((row) => row.person_id), notes: lesson.notes ?? '', recurrence: 'single', recurrenceUntil: start?.date ?? '' } })}><span><strong>Clase {lesson.lesson_type === 'group' ? 'grupal' : 'individual'} · {coach ? coachName(coach) : 'Profesor'}</strong><small>{start?.date} · {start?.time}–{lesson.reservation && isoToDateAndTime(lesson.reservation.ends_at, club.timezone).time} · {court?.name ?? 'Cancha'}</small></span><em className={lesson.status === 'scheduled' ? 'person-state active' : 'person-state'}>{lesson.status === 'scheduled' ? `${studentRows.filter((row) => row.lesson_id === lesson.id).length}/${lesson.capacity} alumnos` : 'Cancelada'}</em></button> })}</div>}
    {tab === 'coaches' && <CoachesTab coaches={coaches} people={people} canManage={canManageCoaches} onSave={saveCoach} onToggle={async (coach) => { const { error } = await client.from('club_coaches').update({ active: !coach.active }).eq('id', coach.id).eq('club_id', club.id); if (error) return setFeedback('No pudimos actualizar el profesor.'); await load() }} />}
    {tab === 'students' && <div className="school-list">{people.filter((person) => studentRows.some((row) => row.person_id === person.id)).map((person) => <div className="school-row" key={person.id}><span><strong>{person.full_name}</strong><small>{studentRows.filter((row) => row.person_id === person.id).length} clase(s) vinculada(s)</small></span></div>)}{studentRows.length === 0 && <p className="subtle-copy">Los alumnos aparecerán cuando estén vinculados a una clase.</p>}</div>}
    {form && <LessonForm client={client} club={club} courts={courts} coaches={coaches} people={people} initial={form.draft} lesson={form.lesson} onClose={() => setForm(null)} onSaved={load} onCancel={cancelLesson} />}
  </section>
}

function CoachesTab({ coaches, people, canManage, onSave, onToggle }: { coaches: CoachWithPerson[]; people: ClubPerson[]; canManage: boolean; onSave: (personId: string, active: boolean, notes: string) => Promise<void>; onToggle: (coach: CoachWithPerson) => Promise<void> }) {
  const [personId, setPersonId] = useState(''); const [notes, setNotes] = useState('')
  return <><div className="school-list">{coaches.map((coach) => <div className="school-row" key={coach.id}><span><strong>{coachName(coach)}</strong><small>{coach.notes || 'Sin observaciones'}</small></span><div><em className={coach.active ? 'person-state active' : 'person-state'}>{coach.active ? 'Activo' : 'Inactivo'}</em>{canManage && <button className="secondary-button" type="button" onClick={() => void onToggle(coach)}>{coach.active ? 'Desactivar' : 'Activar'}</button>}</div></div>)}{coaches.length === 0 && <p className="subtle-copy">Todavía no hay profesores registrados.</p>}</div>{canManage && <form className="school-add-coach" onSubmit={(event) => { event.preventDefault(); if (personId) void onSave(personId, true, notes).then(() => { setPersonId(''); setNotes('') }) }}><h3>Registrar profesor</h3><label>Persona existente<select value={personId} onChange={(event) => setPersonId(event.target.value)} required><option value="">Elegí una persona</option>{people.filter((person) => !coaches.some((coach) => coach.person_id === person.id)).map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}</select></label><label>Observaciones <textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><button>Registrar profesor</button></form>}</>
}
