import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club, Court, Reservation, ReservationDraft } from '../../types/domain'
import { CALENDAR_END_HOUR, CALENDAR_START_HOUR, SLOT_MINUTES, formatCalendarDate, isOverlapError, isValidReservationInterval, isoToDateAndTime, reservationPayload, reservationPosition, shiftCalendarDate, sortReservations, todayInTimezone, zonedDateTimeToIso } from './reservationUtils'

type ReservationCalendarProps = { client: SupabaseClient; club: Club; courts: Court[] }
type ReservationFormProps = {
  club: Club
  courts: Court[]
  initial: ReservationDraft
  reservation?: Reservation
  onClose: () => void
  onSave: (draft: ReservationDraft, reservation?: Reservation) => Promise<string | null>
  onCancel: (reservation: Reservation) => Promise<string | null>
}

function initialDraft(clubId: string, courtId: string, date: string, startsAt = '07:00'): ReservationDraft {
  const [hour, minute] = startsAt.split(':').map(Number)
  const endMinutes = Math.min(hour * 60 + minute + 60, CALENDAR_END_HOUR * 60)
  const endsAt = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`
  return { clubId, courtId, date, startsAt, endsAt, customerName: '', notes: '' }
}

function timeSlots() {
  const slots: string[] = []
  for (let minute = CALENDAR_START_HOUR * 60; minute < CALENDAR_END_HOUR * 60; minute += SLOT_MINUTES) slots.push(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`)
  return slots
}

export function ReservationForm({ club, courts, initial, reservation, onClose, onSave, onCancel }: ReservationFormProps) {
  const [draft, setDraft] = useState(initial)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const slots = timeSlots()

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft.customerName.trim()) return setFeedback('Indicá el nombre de quien reserva.')
    if (!isValidReservationInterval(draft, club.timezone)) return setFeedback('La hora de finalización debe ser posterior a la de inicio.')
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
      <label>Cancha<select value={draft.courtId} onChange={(event) => setDraft({ ...draft, courtId: event.target.value })}>{courts.filter((court) => court.active || court.id === draft.courtId).map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select></label>
      <label>Fecha<input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} required /></label>
      <div className="time-fields"><label>Desde<select value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })}>{slots.map((slot) => <option key={slot}>{slot}</option>)}</select></label><label>Hasta<select value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })}>{slots.map((slot) => <option key={slot}>{slot}</option>)}<option value="23:00">23:00</option></select></label></div>
      <label>Nombre de quien reserva<input value={draft.customerName} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} required autoFocus /></label>
      <label>Observaciones <span className="optional-label">(opcional)</span><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={3} /></label>
      {feedback && <p className="form-error" role="alert">{feedback}</p>}
      <div className="modal-actions">{reservation && <button className="danger-button" type="button" onClick={() => void cancel()} disabled={saving}>Cancelar reserva</button>}<button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Volver</button><button type="submit" disabled={saving}>{saving ? 'Guardando…' : reservation ? 'Guardar cambios' : 'Crear reserva'}</button></div>
    </form>
  </section></div>
}

export function ReservationCalendar({ client, club, courts }: ReservationCalendarProps) {
  const [date, setDate] = useState(() => todayInTimezone(club.timezone))
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [selectedCourtId, setSelectedCourtId] = useState(courts.find((court) => court.active)?.id ?? courts[0]?.id ?? '')
  const [form, setForm] = useState<{ draft: ReservationDraft; reservation?: Reservation } | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [feedback, setFeedback] = useState<string | null>(null)
  const slots = useMemo(timeSlots, [])

  useEffect(() => { setSelectedCourtId((current) => courts.some((court) => court.id === current) ? current : courts.find((court) => court.active)?.id ?? courts[0]?.id ?? '') }, [courts])
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setStatus('loading'); setFeedback(null)
      const startsAt = zonedDateTimeToIso(date, '00:00', club.timezone)
      const endsAt = zonedDateTimeToIso(shiftCalendarDate(date, 1), '00:00', club.timezone)
      const { data, error } = await client.from('reservations').select('id, club_id, court_id, customer_name, starts_at, ends_at, status, notes, created_by, created_at, updated_at').eq('club_id', club.id).eq('status', 'confirmed').lt('starts_at', endsAt).gt('ends_at', startsAt).order('starts_at', { ascending: true })
      if (cancelled) return
      if (error) { setFeedback('No pudimos cargar las reservas de este día.'); setStatus('error'); return }
      setReservations(sortReservations((data ?? []) as Reservation[])); setStatus('ready')
    }
    void load()
    return () => { cancelled = true }
  }, [client, club.id, club.timezone, date])

  const reload = async () => {
    const startsAt = zonedDateTimeToIso(date, '00:00', club.timezone)
    const endsAt = zonedDateTimeToIso(shiftCalendarDate(date, 1), '00:00', club.timezone)
    const { data, error } = await client.from('reservations').select('id, club_id, court_id, customer_name, starts_at, ends_at, status, notes, created_by, created_at, updated_at').eq('club_id', club.id).eq('status', 'confirmed').lt('starts_at', endsAt).gt('ends_at', startsAt).order('starts_at', { ascending: true })
    if (error) return setFeedback('El cambio se guardó, pero no pudimos actualizar el calendario.')
    setReservations(sortReservations((data ?? []) as Reservation[]))
  }
  const save = async (draft: ReservationDraft, reservation?: Reservation) => {
    const payload = reservationPayload(draft, club.timezone)
    const operation = reservation ? client.from('reservations').update(payload).eq('id', reservation.id).eq('club_id', club.id) : client.from('reservations').insert(payload)
    const { error } = await operation
    if (error) return isOverlapError(error) ? 'Ese horario ya está ocupado en esta cancha. Elegí otro horario.' : 'No pudimos guardar la reserva. Revisá los datos e intentá nuevamente.'
    setForm(null); setFeedback(reservation ? 'Reserva actualizada.' : 'Reserva creada.')
    await reload()
    return null
  }
  const cancel = async (reservation: Reservation) => {
    const { error } = await client.from('reservations').update({ status: 'cancelled' }).eq('id', reservation.id).eq('club_id', club.id)
    if (error) return 'No pudimos cancelar la reserva. Intentá nuevamente.'
    setForm(null); setFeedback('Reserva cancelada. El horario volvió a quedar disponible.')
    await reload()
    return null
  }
  const openCreate = (court: Court, startsAt: string) => court.active && setForm({ draft: initialDraft(club.id, court.id, date, startsAt) })
  const openEdit = (reservation: Reservation) => {
    const start = isoToDateAndTime(reservation.starts_at, club.timezone); const end = isoToDateAndTime(reservation.ends_at, club.timezone)
    setForm({ reservation, draft: { clubId: club.id, courtId: reservation.court_id, date: start.date, startsAt: start.time, endsAt: end.time, customerName: reservation.customer_name, notes: reservation.notes ?? '' } })
  }
  const visibleCourts = courts

  return <section className="reservations-section" aria-labelledby="reservations-title">
    <div className="section-heading"><div><p className="eyebrow">Operación</p><h2 id="reservations-title">Reservas</h2><p className="calendar-date-title">{formatCalendarDate(date, club.timezone)}</p></div><div className="calendar-controls"><button className="secondary-button" type="button" onClick={() => setDate(shiftCalendarDate(date, -1))}>← Anterior</button><button className="secondary-button" type="button" onClick={() => setDate(todayInTimezone(club.timezone))}>Hoy</button><button className="secondary-button" type="button" onClick={() => setDate(shiftCalendarDate(date, 1))}>Siguiente →</button><label>Ir a fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></div></div>
    {feedback && status !== 'error' && <p className="form-success" role="status">{feedback}</p>}
    {courts.length === 0 ? <p className="screen-message">No hay canchas configuradas para este club.</p> : <>
      <label className="mobile-court-selector">Cancha<select value={selectedCourtId} onChange={(event) => setSelectedCourtId(event.target.value)}>{visibleCourts.map((court) => <option key={court.id} value={court.id}>{court.name}{court.active ? '' : ' (inactiva)'}</option>)}</select></label>
      <div className="calendar-scroll"><div className="daily-calendar" style={{ '--court-count': visibleCourts.length } as CSSProperties}>
        <div className="time-axis">{slots.map((slot) => <div className="time-label" key={slot}>{slot}</div>)}</div>
        {visibleCourts.map((court) => <article key={court.id} className={`calendar-court ${court.id === selectedCourtId ? 'selected-mobile-court' : ''} ${court.active ? '' : 'inactive-court'}`}><h3>{court.name}</h3><div className="calendar-track" aria-label={`Disponibilidad de ${court.name}`}>
          {slots.map((slot) => <button key={slot} type="button" className="calendar-slot" aria-label={`${court.name}, ${slot}${court.active ? ', crear reserva' : ', cancha inactiva'}`} onClick={() => openCreate(court, slot)} disabled={!court.active} />)}
          {reservations.filter((reservation) => reservation.court_id === court.id).map((reservation) => { const position = reservationPosition(reservation, date, club.timezone); return <button key={reservation.id} type="button" className="reservation-block" style={{ top: position.top, height: position.height }} onClick={(event) => { event.stopPropagation(); openEdit(reservation) }}><strong>{reservation.customer_name}</strong><span>{isoToDateAndTime(reservation.starts_at, club.timezone).time}–{isoToDateAndTime(reservation.ends_at, club.timezone).time}</span></button> })}
        </div></article>)}
      </div></div>
      {status === 'loading' && <p className="calendar-loading" role="status">Cargando reservas…</p>}
      {status === 'error' && <p className="form-error" role="alert">{feedback}</p>}
    </>}
    {form && <ReservationForm club={club} courts={courts} initial={form.draft} reservation={form.reservation} onClose={() => setForm(null)} onSave={save} onCancel={cancel} />}
  </section>
}
