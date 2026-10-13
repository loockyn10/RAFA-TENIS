import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BlockDraft, Club, Court, Reservation, ReservationDraft } from '../../types/domain'
import { CALENDAR_END_HOUR, CALENDAR_START_HOUR, SLOT_MINUTES, blockPayload, formatCalendarDate, isOverlapError, isValidReservationInterval, isoToDateAndTime, occupationConflicts, reservationPayload, reservationPosition, shiftCalendarDate, sortReservations, todayInTimezone, weeklyOccurrenceDates, zonedDateTimeToIso } from './reservationUtils'

type ReservationCalendarProps = { client: SupabaseClient; club: Club; courts: Court[] }
type ReservationFormProps = { club: Club; courts: Court[]; initial: ReservationDraft; reservation?: Reservation; onClose: () => void; onSave: (draft: ReservationDraft, reservation?: Reservation) => Promise<string | null>; onCancel: (reservation: Reservation) => Promise<string | null> }
type BlockFormProps = { club: Club; courts: Court[]; initial: BlockDraft; block?: Reservation; onClose: () => void; onSave: (draft: BlockDraft, block?: Reservation) => Promise<string | null>; onCancel: (block: Reservation) => Promise<string | null> }

const OCCUPATION_FIELDS = 'id, club_id, court_id, customer_name, starts_at, ends_at, status, occupation_type, block_reason, recurrence_series_id, notes, created_by, created_at, updated_at'

function initialReservationDraft(clubId: string, courtId: string, date: string, startsAt = '07:00'): ReservationDraft {
  const [hour, minute] = startsAt.split(':').map(Number)
  const endMinutes = Math.min(hour * 60 + minute + 60, CALENDAR_END_HOUR * 60)
  const endsAt = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`
  return { clubId, courtId, date, startsAt, endsAt, customerName: '', notes: '', recurrence: 'single', recurrenceUntil: shiftCalendarDate(date, 77) }
}

function initialBlockDraft(clubId: string, courtId: string, date: string, startsAt = '07:00'): BlockDraft {
  const reservation = initialReservationDraft(clubId, courtId, date, startsAt)
  return { clubId, courtId, date, startsAt: reservation.startsAt, endsAt: reservation.endsAt, reason: 'Mantenimiento', notes: '' }
}

function timeSlots() {
  const slots: string[] = []
  for (let minute = CALENDAR_START_HOUR * 60; minute < CALENDAR_END_HOUR * 60; minute += SLOT_MINUTES) slots.push(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`)
  return slots
}

function CourtAndTimeFields({ courts, courtId, date, startsAt, endsAt, onChange }: { courts: Court[]; courtId: string; date: string; startsAt: string; endsAt: string; onChange: (change: Partial<Pick<ReservationDraft, 'courtId' | 'date' | 'startsAt' | 'endsAt'>>) => void }) {
  const slots = timeSlots()
  return <>
    <label>Cancha<select value={courtId} onChange={(event) => onChange({ courtId: event.target.value })}>{courts.filter((court) => court.active || court.id === courtId).map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select></label>
    <label>Fecha<input type="date" value={date} onChange={(event) => onChange({ date: event.target.value })} required /></label>
    <div className="time-fields"><label>Desde<select value={startsAt} onChange={(event) => onChange({ startsAt: event.target.value })}>{slots.map((slot) => <option key={slot}>{slot}</option>)}</select></label><label>Hasta<select value={endsAt} onChange={(event) => onChange({ endsAt: event.target.value })}>{slots.map((slot) => <option key={slot}>{slot}</option>)}<option value="23:00">23:00</option></select></label></div>
  </>
}

export function ReservationForm({ club, courts, initial, reservation, onClose, onSave, onCancel }: ReservationFormProps) {
  const [draft, setDraft] = useState(initial)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const occurrenceCount = draft.recurrence === 'weekly' ? weeklyOccurrenceDates(draft.date, draft.recurrenceUntil).length : 1
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft.customerName.trim()) return setFeedback('Indicá el nombre de quien reserva.')
    if (!isValidReservationInterval(draft, club.timezone)) return setFeedback('La hora de finalización debe ser posterior a la de inicio.')
    if (!reservation && draft.recurrence === 'weekly' && (occurrenceCount === 0 || occurrenceCount > 12)) return setFeedback('Elegí una fecha final que genere entre 1 y 12 reservas semanales.')
    setSaving(true); setFeedback(null)
    const error = await onSave(draft, reservation)
    setSaving(false)
    if (error) setFeedback(error)
  }
  const cancel = async () => {
    if (!reservation || !window.confirm('¿Cancelar esta reserva? El historial se conservará.')) return
    setSaving(true); setFeedback(null)
    const error = await onCancel(reservation)
    setSaving(false)
    if (error) setFeedback(error)
  }
  return <div className="reservation-modal-backdrop" role="presentation"><section className="reservation-modal" role="dialog" aria-modal="true" aria-labelledby="reservation-form-title">
    <div className="modal-heading"><div><p className="eyebrow">{reservation ? 'Editar reserva' : 'Nueva reserva'}</p><h2 id="reservation-form-title">{reservation ? 'Actualizar turno' : 'Registrar turno'}</h2></div><button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}>×</button></div>
    <form className="reservation-form" onSubmit={(event) => void submit(event)}>
      <CourtAndTimeFields courts={courts} courtId={draft.courtId} date={draft.date} startsAt={draft.startsAt} endsAt={draft.endsAt} onChange={(change) => setDraft({ ...draft, ...change })} />
      <label>Nombre de quien reserva<input value={draft.customerName} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} required autoFocus /></label>
      {!reservation && <fieldset className="recurrence-fieldset"><legend>Repetición</legend><label><input type="radio" name="recurrence" checked={draft.recurrence === 'single'} onChange={() => setDraft({ ...draft, recurrence: 'single' })} /> Reserva única</label><label><input type="radio" name="recurrence" checked={draft.recurrence === 'weekly'} onChange={() => setDraft({ ...draft, recurrence: 'weekly' })} /> Repetir semanalmente</label>{draft.recurrence === 'weekly' && <label>Última fecha de la serie<input aria-label="Última fecha de la serie" type="date" min={draft.date} value={draft.recurrenceUntil} onChange={(event) => setDraft({ ...draft, recurrenceUntil: event.target.value })} required /><span className="field-help">Se crearán {occurrenceCount} reservas (máximo 12), siempre el mismo día, horario y cancha.</span></label>}</fieldset>}
      {reservation?.recurrence_series_id && <p className="field-help">Esta es una ocurrencia de una serie. Los cambios solo afectan a este turno.</p>}
      <label>Observaciones <span className="optional-label">(opcional)</span><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={3} /></label>
      {feedback && <p className="form-error" role="alert">{feedback}</p>}
      <div className="modal-actions">{reservation && <button className="danger-button" type="button" onClick={() => void cancel()} disabled={saving}>Cancelar reserva</button>}<button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Volver</button><button type="submit" disabled={saving}>{saving ? 'Guardando…' : reservation ? 'Guardar cambios' : draft.recurrence === 'weekly' ? 'Revisar y crear serie' : 'Crear reserva'}</button></div>
    </form>
  </section></div>
}

export function BlockForm({ club, courts, initial, block, onClose, onSave, onCancel }: BlockFormProps) {
  const [draft, setDraft] = useState(initial)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft.reason.trim()) return setFeedback('Elegí o indicá un motivo para el bloqueo.')
    if (!isValidReservationInterval(draft, club.timezone)) return setFeedback('La hora de finalización debe ser posterior a la de inicio.')
    setSaving(true); setFeedback(null)
    const error = await onSave(draft, block)
    setSaving(false)
    if (error) setFeedback(error)
  }
  const cancel = async () => {
    if (!block || !window.confirm('¿Cancelar este bloqueo? El historial se conservará.')) return
    setSaving(true); setFeedback(null)
    const error = await onCancel(block)
    setSaving(false)
    if (error) setFeedback(error)
  }
  return <div className="reservation-modal-backdrop" role="presentation"><section className="reservation-modal" role="dialog" aria-modal="true" aria-labelledby="block-form-title">
    <div className="modal-heading"><div><p className="eyebrow">{block ? 'Editar bloqueo' : 'Nuevo bloqueo'}</p><h2 id="block-form-title">{block ? 'Actualizar bloqueo' : 'Bloquear cancha'}</h2></div><button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}>×</button></div>
    <form className="reservation-form" onSubmit={(event) => void submit(event)}>
      <CourtAndTimeFields courts={courts} courtId={draft.courtId} date={draft.date} startsAt={draft.startsAt} endsAt={draft.endsAt} onChange={(change) => setDraft({ ...draft, ...change })} />
      <label>Motivo<select value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })}><option>Lluvia</option><option>Mantenimiento</option><option>Torneo</option><option>Evento</option><option>Uso interno</option><option>Otro motivo</option></select></label>
      <label>Observaciones <span className="optional-label">(opcional)</span><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={3} /></label>
      {feedback && <p className="form-error" role="alert">{feedback}</p>}
      <div className="modal-actions">{block && <button className="danger-button" type="button" onClick={() => void cancel()} disabled={saving}>Cancelar bloqueo</button>}<button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Volver</button><button type="submit" disabled={saving}>{saving ? 'Guardando…' : block ? 'Guardar cambios' : 'Crear bloqueo'}</button></div>
    </form>
  </section></div>
}

function formatConflicts(conflicts: ReturnType<typeof occupationConflicts>, timezone: string) {
  const details = [...new Map(conflicts.map(({ occupation }) => [occupation.id, occupation])).values()].map((occupation) => `${occupation.occupation_type === 'block' ? `bloqueo: ${occupation.block_reason}` : `reserva: ${occupation.customer_name}`} (${isoToDateAndTime(occupation.starts_at, timezone).date} ${isoToDateAndTime(occupation.starts_at, timezone).time}–${isoToDateAndTime(occupation.ends_at, timezone).time})`).join(', ')
  return `Hay horarios ocupados que deben resolverse antes de guardar: ${details}.`
}

export function ReservationCalendar({ client, club, courts }: ReservationCalendarProps) {
  const [date, setDate] = useState(() => todayInTimezone(club.timezone))
  const [occupations, setOccupations] = useState<Reservation[]>([])
  const [selectedCourtId, setSelectedCourtId] = useState(courts.find((court) => court.active)?.id ?? courts[0]?.id ?? '')
  const [form, setForm] = useState<{ kind: 'reservation'; draft: ReservationDraft; reservation?: Reservation } | { kind: 'block'; draft: BlockDraft; block?: Reservation } | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [feedback, setFeedback] = useState<string | null>(null)
  const slots = useMemo(timeSlots, [])
  useEffect(() => { setSelectedCourtId((current) => courts.some((court) => court.id === current) ? current : courts.find((court) => court.active)?.id ?? courts[0]?.id ?? '') }, [courts])
  const dayRange = (value = date) => ({ startsAt: zonedDateTimeToIso(value, '00:00', club.timezone), endsAt: zonedDateTimeToIso(shiftCalendarDate(value, 1), '00:00', club.timezone) })
  const load = async (value = date) => {
    const { startsAt, endsAt } = dayRange(value)
    const { data, error } = await client.from('reservations').select(OCCUPATION_FIELDS).eq('club_id', club.id).in('status', ['confirmed', 'active']).lt('starts_at', endsAt).gt('ends_at', startsAt).order('starts_at', { ascending: true })
    return error ? { error: true, rows: [] as Reservation[] } : { error: false, rows: sortReservations((data ?? []) as Reservation[]) }
  }
  useEffect(() => {
    let cancelled = false
    const loadDay = async () => { setStatus('loading'); setFeedback(null); const result = await load(); if (cancelled) return; if (result.error) { setFeedback('No pudimos cargar las ocupaciones de este día.'); setStatus('error'); return }; setOccupations(result.rows); setStatus('ready') }
    void loadDay()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, club.id, club.timezone, date])
  const reload = async () => { const result = await load(); if (result.error) return setFeedback('El cambio se guardó, pero no pudimos actualizar el calendario.'); setOccupations(result.rows) }
  const conflictFor = (candidate: Pick<Reservation, 'court_id' | 'starts_at' | 'ends_at' | 'id'>) => occupationConflicts([candidate], occupations)
  const saveReservation = async (draft: ReservationDraft, reservation?: Reservation) => {
    const payload = reservationPayload(draft, club.timezone)
    if (!reservation && draft.recurrence === 'weekly') {
      const dates = weeklyOccurrenceDates(draft.date, draft.recurrenceUntil)
      if (dates.length === 0 || dates.length > 12) return 'Elegí una fecha final que genere entre 1 y 12 reservas semanales.'
      const firstStart = zonedDateTimeToIso(dates[0], draft.startsAt, club.timezone); const lastEnd = zonedDateTimeToIso(dates[dates.length - 1], draft.endsAt, club.timezone)
      const { data, error: checkError } = await client.from('reservations').select(OCCUPATION_FIELDS).eq('club_id', club.id).in('status', ['confirmed', 'active']).lt('starts_at', lastEnd).gt('ends_at', firstStart)
      if (checkError) return 'No pudimos comprobar los conflictos de la serie. Intentá nuevamente.'
      const candidates = dates.map((occurrenceDate) => ({ id: `new-${occurrenceDate}`, court_id: draft.courtId, starts_at: zonedDateTimeToIso(occurrenceDate, draft.startsAt, club.timezone), ends_at: zonedDateTimeToIso(occurrenceDate, draft.endsAt, club.timezone) }))
      const conflicts = occupationConflicts(candidates, (data ?? []) as Reservation[])
      if (conflicts.length) return formatConflicts(conflicts, club.timezone)
      const { error } = await client.rpc('create_weekly_reservation_series', { p_club_id: club.id, p_court_id: draft.courtId, p_customer_name: draft.customerName.trim(), p_notes: draft.notes.trim() || null, p_starts_at: candidates[0].starts_at, p_ends_at: candidates[0].ends_at, p_occurrence_count: dates.length })
      if (error) return isOverlapError(error) ? 'Uno de los horarios acaba de ser ocupado. No se creó ninguna reserva de la serie.' : 'No pudimos crear la serie. Revisá los datos e intentá nuevamente.'
      setForm(null); setFeedback(`Serie creada con ${dates.length} reservas.`); await reload(); return null
    }
    const candidate = { id: reservation?.id ?? 'new-reservation', court_id: draft.courtId, starts_at: payload.starts_at, ends_at: payload.ends_at }
    const conflicts = conflictFor(candidate)
    if (conflicts.length) return formatConflicts(conflicts, club.timezone)
    const editablePayload = { court_id: payload.court_id, customer_name: payload.customer_name, starts_at: payload.starts_at, ends_at: payload.ends_at, notes: payload.notes }
    const operation = reservation ? client.from('reservations').update(editablePayload).eq('id', reservation.id).eq('club_id', club.id) : client.from('reservations').insert(payload)
    const { error } = await operation
    if (error) return isOverlapError(error) ? 'Ese horario ya está ocupado en esta cancha. Elegí otro horario.' : 'No pudimos guardar la reserva. Revisá los datos e intentá nuevamente.'
    setForm(null); setFeedback(reservation ? 'Reserva actualizada.' : 'Reserva creada.'); await reload(); return null
  }
  const saveBlock = async (draft: BlockDraft, block?: Reservation) => {
    const payload = blockPayload(draft, club.timezone)
    const candidate = { id: block?.id ?? 'new-block', court_id: draft.courtId, starts_at: payload.starts_at, ends_at: payload.ends_at }
    const conflicts = conflictFor(candidate)
    if (conflicts.length) return formatConflicts(conflicts, club.timezone)
    const editablePayload = { court_id: payload.court_id, starts_at: payload.starts_at, ends_at: payload.ends_at, status: payload.status, block_reason: payload.block_reason, notes: payload.notes }
    const operation = block ? client.from('reservations').update(editablePayload).eq('id', block.id).eq('club_id', club.id) : client.from('reservations').insert(payload)
    const { error } = await operation
    if (error) return isOverlapError(error) ? 'Ese horario ya está ocupado en esta cancha. No se creó el bloqueo.' : 'No pudimos guardar el bloqueo. Revisá los datos e intentá nuevamente.'
    setForm(null); setFeedback(block ? 'Bloqueo actualizado.' : 'Bloqueo creado.'); await reload(); return null
  }
  const cancel = async (occupation: Reservation) => {
    const { error } = await client.from('reservations').update({ status: 'cancelled' }).eq('id', occupation.id).eq('club_id', club.id)
    if (error) return 'No pudimos cancelar esta ocupación. Intentá nuevamente.'
    setForm(null); setFeedback(`${occupation.occupation_type === 'block' ? 'Bloqueo' : 'Reserva'} cancelado. El horario volvió a quedar disponible.`); await reload(); return null
  }
  const defaultCourt = () => courts.find((court) => court.active) ?? courts[0]
  const openCreate = (court: Court, startsAt: string, kind: 'reservation' | 'block' = 'reservation') => court.active && setForm(kind === 'reservation' ? { kind, draft: initialReservationDraft(club.id, court.id, date, startsAt) } : { kind, draft: initialBlockDraft(club.id, court.id, date, startsAt) })
  const openEdit = (occupation: Reservation) => {
    const start = isoToDateAndTime(occupation.starts_at, club.timezone); const end = isoToDateAndTime(occupation.ends_at, club.timezone)
    if (occupation.occupation_type === 'block') setForm({ kind: 'block', block: occupation, draft: { clubId: club.id, courtId: occupation.court_id, date: start.date, startsAt: start.time, endsAt: end.time, reason: occupation.block_reason ?? 'Otro motivo', notes: occupation.notes ?? '' } })
    else setForm({ kind: 'reservation', reservation: occupation, draft: { clubId: club.id, courtId: occupation.court_id, date: start.date, startsAt: start.time, endsAt: end.time, customerName: occupation.customer_name ?? '', notes: occupation.notes ?? '', recurrence: 'single', recurrenceUntil: start.date } })
  }
  return <section className="reservations-section" aria-labelledby="reservations-title">
    <div className="section-heading"><div><p className="eyebrow">Operación</p><h2 id="reservations-title">Calendario</h2><p className="calendar-date-title">{formatCalendarDate(date, club.timezone)}</p></div><div className="calendar-controls"><button className="secondary-button" type="button" onClick={() => setDate(shiftCalendarDate(date, -1))}>← Anterior</button><button className="secondary-button" type="button" onClick={() => setDate(todayInTimezone(club.timezone))}>Hoy</button><button className="secondary-button" type="button" onClick={() => setDate(shiftCalendarDate(date, 1))}>Siguiente →</button><label>Ir a fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></div></div>
    <div className="calendar-create-actions"><button type="button" onClick={() => { const court = defaultCourt(); if (court) openCreate(court, '07:00') }}>Nueva reserva</button><button className="secondary-button" type="button" onClick={() => { const court = defaultCourt(); if (court) openCreate(court, '07:00', 'block') }}>Nuevo bloqueo</button></div>
    {feedback && status !== 'error' && <p className="form-success" role="status">{feedback}</p>}
    {courts.length === 0 ? <p className="screen-message">No hay canchas configuradas para este club.</p> : <><label className="mobile-court-selector">Cancha<select value={selectedCourtId} onChange={(event) => setSelectedCourtId(event.target.value)}>{courts.map((court) => <option key={court.id} value={court.id}>{court.name}{court.active ? '' : ' (inactiva)'}</option>)}</select></label><div className="calendar-scroll"><div className="daily-calendar" style={{ '--court-count': courts.length } as CSSProperties}><div className="time-axis">{slots.map((slot) => <div className="time-label" key={slot}>{slot}</div>)}</div>{courts.map((court) => <article key={court.id} className={`calendar-court ${court.id === selectedCourtId ? 'selected-mobile-court' : ''} ${court.active ? '' : 'inactive-court'}`}><h3>{court.name}</h3><div className="calendar-track" aria-label={`Disponibilidad de ${court.name}`}>{slots.map((slot) => <button key={slot} type="button" className="calendar-slot" aria-label={`${court.name}, ${slot}${court.active ? ', crear reserva' : ', cancha inactiva'}`} onClick={() => openCreate(court, slot)} disabled={!court.active} />)}{occupations.filter((occupation) => occupation.court_id === court.id).map((occupation) => { const position = reservationPosition(occupation, date, club.timezone); const isBlock = occupation.occupation_type === 'block'; return <button key={occupation.id} type="button" className={`reservation-block ${isBlock ? 'block-occupation' : ''}`} style={{ top: position.top, height: position.height }} onClick={(event) => { event.stopPropagation(); openEdit(occupation) }}><strong>{isBlock ? occupation.block_reason : occupation.customer_name}{!isBlock && occupation.recurrence_series_id ? ' · semanal' : ''}</strong><span>{isoToDateAndTime(occupation.starts_at, club.timezone).time}–{isoToDateAndTime(occupation.ends_at, club.timezone).time}</span></button> })}</div></article>)}</div></div>{status === 'loading' && <p className="calendar-loading" role="status">Cargando ocupaciones…</p>}{status === 'error' && <p className="form-error" role="alert">{feedback}</p>}</>}
    {form?.kind === 'reservation' && <ReservationForm club={club} courts={courts} initial={form.draft} reservation={form.reservation} onClose={() => setForm(null)} onSave={saveReservation} onCancel={cancel} />}
    {form?.kind === 'block' && <BlockForm club={club} courts={courts} initial={form.draft} block={form.block} onClose={() => setForm(null)} onSave={saveBlock} onCancel={cancel} />}
  </section>
}
