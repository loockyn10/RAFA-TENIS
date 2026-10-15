import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BlockDraft, Club, ClubPerson, Court, Reservation, ReservationDraft } from '../../types/domain'
import { Avatar, Badge, Button, Chip, CourtMark, ConfirmDialog, ErrorState, Field, Icon, IconButton, Modal, SegmentedTabs, SelectInput, Skeleton, Switch, TextArea, TextInput } from '../../design/ui'
import { CourtPicker } from '../../design/domain'
import { useIsMobile } from '../../design/media'
import { plural } from '../../design/format'
import { KIND_LABEL, KIND_TONE, courtShort, occupationKind, occupationTitle } from './occupationView'
import { CALENDAR_END_HOUR, CALENDAR_START_HOUR, OCCUPATION_FIELDS, SLOT_MINUTES, blockPayload, isOverlapError, isValidReservationInterval, isoToDateAndTime, occupationConflicts, reservationPayload, shiftCalendarDate, sortReservations, todayInTimezone, weeklyOccurrenceDates, zonedDateTimeToIso } from './reservationUtils'

/** Pedido de apertura de un formulario desde otra sección (Inicio, botón central, barra superior). */
export type CalendarFormRequest = { id: number; kind: 'reservation' | 'block'; courtId?: string; date?: string; startsAt?: string }

type ReservationCalendarProps = { client: SupabaseClient; club: Club; courts: Court[]; formRequest?: CalendarFormRequest | null; onFormRequestHandled?: () => void; onOpenLesson?: (reservationId: string) => void; onOpenTournamentMatch?: (reservationId: string) => void; onCreateLesson?: (request: { courtId: string; date: string; startsAt: string }) => void }
type SwitchRequest = { courtId: string; date: string; startsAt: string; endsAt: string }
type ReservationFormProps = { client: SupabaseClient; club: Club; courts: Court[]; initial: ReservationDraft; reservation?: Reservation; occupations?: Reservation[]; occupationsDate?: string; onClose: () => void; onSave: (draft: ReservationDraft, reservation?: Reservation) => Promise<string | null>; onCancel: (reservation: Reservation) => Promise<string | null>; onSwitchKind?: (request: SwitchRequest) => void }
type BlockFormProps = { club: Club; courts: Court[]; initial: BlockDraft; block?: Reservation; occupations?: Reservation[]; occupationsDate?: string; onClose: () => void; onSave: (draft: BlockDraft, block?: Reservation) => Promise<string | null>; onCancel: (block: Reservation) => Promise<string | null>; onSwitchKind?: (request: SwitchRequest) => void }

const START_MINUTES = CALENDAR_START_HOUR * 60
const END_MINUTES = CALENDAR_END_HOUR * 60
const LENGTHS = [60, 90, 120]
const BLOCK_REASONS = ['Lluvia', 'Mantenimiento', 'Torneo', 'Evento', 'Uso interno', 'Otro motivo']

const fmt = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const toMinutes = (time: string) => { const [hour, minute] = time.split(':').map(Number); return hour * 60 + minute }
/** Minutos del día (zona del club) que ocupa una ocupación, acotados a la franja visible de la agenda. */
function occupationBounds(occupation: Pick<Reservation, 'starts_at' | 'ends_at'>, date: string, timezone: string) {
  const startParts = isoToDateAndTime(occupation.starts_at, timezone)
  const endParts = isoToDateAndTime(occupation.ends_at, timezone)
  const rawStart = startParts.date < date ? 0 : toMinutes(startParts.time)
  const rawEnd = endParts.date > date ? 24 * 60 : toMinutes(endParts.time)
  return { start: Math.max(rawStart, START_MINUTES), end: Math.min(rawEnd, END_MINUTES) }
}
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const dayLabel = (value: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', ...options }).format(new Date(`${value}T12:00:00Z`))
const durationLabel = (minutes: number) => { const hours = Math.floor(minutes / 60); const rest = minutes % 60; return hours === 0 ? `${rest} min` : rest === 0 ? `${hours} h` : `${hours} h ${rest}` }

function initialReservationDraft(clubId: string, courtId: string, date: string, startsAt = '07:00'): ReservationDraft {
  const endMinutes = Math.min(toMinutes(startsAt) + 60, END_MINUTES)
  return { clubId, courtId, date, startsAt, endsAt: fmt(endMinutes), customerName: '', personId: null, notes: '', recurrence: 'single', recurrenceUntil: shiftCalendarDate(date, 77) }
}

function initialBlockDraft(clubId: string, courtId: string, date: string, startsAt = '07:00'): BlockDraft {
  const reservation = initialReservationDraft(clubId, courtId, date, startsAt)
  return { clubId, courtId, date, startsAt: reservation.startsAt, endsAt: reservation.endsAt, reason: 'Mantenimiento', notes: '' }
}

function timeSlots() {
  const slots: string[] = []
  for (let minute = START_MINUTES; minute < END_MINUTES; minute += SLOT_MINUTES) slots.push(fmt(minute))
  return slots
}

type TimeFieldsProps = { club: Club; courts: Court[]; courtId: string; date: string; startsAt: string; endsAt: string; occupations?: Reservation[]; occupationsDate?: string; ignoreId?: string; onChange: (change: Partial<Pick<ReservationDraft, 'courtId' | 'date' | 'startsAt' | 'endsAt'>>) => void }

/** Cancha, fecha y horario. El prechequeo de conflictos es informativo: la restricción de PostgreSQL es la definitiva. */
function CourtAndTimeFields({ club, courts, courtId, date, startsAt, endsAt, occupations, occupationsDate, ignoreId, onChange }: TimeFieldsProps) {
  const slots = useMemo(timeSlots, [])
  const length = toMinutes(endsAt) - toMinutes(startsAt)
  const [customEnd, setCustomEnd] = useState(!LENGTHS.includes(length))
  const selectable = courts.filter((court) => court.active || court.id === courtId)
  const known = occupations !== undefined && occupationsDate === date
  const conflictsFor = (id: string) => known && isValidReservationInterval({ date, startsAt, endsAt }, club.timezone)
    ? occupationConflicts([{ id: ignoreId ?? 'new', court_id: id, starts_at: zonedDateTimeToIso(date, startsAt, club.timezone), ends_at: zonedDateTimeToIso(date, endsAt, club.timezone) }], occupations ?? [])
    : []
  const hit = conflictsFor(courtId)[0]?.occupation
  const freeCourts = hit ? selectable.filter((court) => court.id !== courtId && court.active && conflictsFor(court.id).length === 0) : []
  const changeStart = (value: string) => onChange({ startsAt: value, endsAt: fmt(Math.min(toMinutes(value) + (length > 0 ? length : 60), END_MINUTES)) })
  return <>
    <fieldset className="form-block">
      <legend className="form-legend">Cancha</legend>
      <CourtPicker courts={selectable} value={courtId} onChange={(id) => onChange({ courtId: id })} short={courtShort} isBusy={known ? (id) => conflictsFor(id).length > 0 : undefined} />
    </fieldset>
    <div className="form-row">
      <Field label="Fecha">{(id) => <TextInput id={id} type="date" value={date} onChange={(event) => event.target.value && onChange({ date: event.target.value })} required />}</Field>
      <Field label="Desde">{(id) => <SelectInput id={id} value={startsAt} onChange={(event) => changeStart(event.target.value)}>{slots.map((slot) => <option key={slot}>{slot}</option>)}</SelectInput>}</Field>
    </div>
    <fieldset className="form-block">
      <legend className="form-legend">Duración</legend>
      <div className="chip-row">
        {LENGTHS.map((minutes) => <Chip key={minutes} selected={!customEnd && length === minutes} disabled={toMinutes(startsAt) + minutes > END_MINUTES} onClick={() => { setCustomEnd(false); onChange({ endsAt: fmt(Math.min(toMinutes(startsAt) + minutes, END_MINUTES)) }) }}>{minutes === 60 ? '1 h' : minutes === 90 ? '1 h 30' : '2 h'}</Chip>)}
        <Chip selected={customEnd} onClick={() => setCustomEnd(true)}>Otra</Chip>
      </div>
      {customEnd && <Field label="Hasta">{(id) => <SelectInput id={id} value={endsAt} onChange={(event) => onChange({ endsAt: event.target.value })}>{[...slots.slice(1), fmt(END_MINUTES)].map((slot) => <option key={slot}>{slot}</option>)}</SelectInput>}</Field>}
    </fieldset>
    {hit && (
      <div className="inline-alert inline-alert-warning" role="status">
        <Icon name="alert" size={20} />
        <div>
          <strong>{courts.find((court) => court.id === courtId)?.name ?? 'La cancha'} figura ocupada en ese horario</strong>
          <p>{occupationTitle(hit)} · {isoToDateAndTime(hit.starts_at, club.timezone).time}–{isoToDateAndTime(hit.ends_at, club.timezone).time}. Al guardar se verifica contra la agenda actualizada.</p>
          {freeCourts.length > 0 && <div className="chip-row">{freeCourts.slice(0, 3).map((court) => <Chip key={court.id} icon="check" onClick={() => onChange({ courtId: court.id })}>{court.name} libre</Chip>)}</div>}
        </div>
      </div>
    )}
  </>
}

function KindSwitch({ kind, onPick }: { kind: 'reservation' | 'block'; onPick: () => void }) {
  return <SegmentedTabs label="Tipo de ocupación" stretch value={kind} onChange={(next) => next !== kind && onPick()} items={[{ id: 'reservation', label: 'Reserva', icon: 'calendar' }, { id: 'block', label: 'Bloqueo', icon: 'lock' }]} />
}

export function ReservationForm({ client, club, courts, initial, reservation, occupations, occupationsDate, onClose, onSave, onCancel, onSwitchKind }: ReservationFormProps) {
  const [draft, setDraft] = useState(initial)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [matches, setMatches] = useState<ClubPerson[]>([])
  const [confirming, setConfirming] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [showNotes, setShowNotes] = useState(Boolean(initial.notes))
  // Las sugerencias de fichas aparecen solo cuando la persona escribe; al abrir una reserva existente no tapan el formulario.
  const [typed, setTyped] = useState(false)
  useEffect(() => {
    const query = draft.customerName.trim()
    if (!typed || query.length < 2 || draft.personId !== null) { setMatches([]); return }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      const escaped = query.replace(/[,()]/g, ' ')
      const { data } = await client.from('club_people').select('id, club_id, full_name, phone, email, notes, active, created_at, updated_at').eq('club_id', club.id).eq('active', true).or(`full_name.ilike.%${escaped}%,phone.ilike.%${escaped}%`).order('full_name', { ascending: true }).limit(8)
      if (!cancelled) setMatches((data ?? []) as ClubPerson[])
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [client, club.id, draft.customerName, draft.personId, typed])
  const occurrenceCount = draft.recurrence === 'weekly' ? weeklyOccurrenceDates(draft.date, draft.recurrenceUntil).length : 1
  const court = courts.find((item) => item.id === draft.courtId)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    if (!draft.customerName.trim()) return setFeedback('Indicá el nombre de quien reserva.')
    if (!isValidReservationInterval(draft, club.timezone)) return setFeedback('La hora de finalización debe ser posterior a la de inicio.')
    if (!reservation && draft.recurrence === 'weekly' && (occurrenceCount === 0 || occurrenceCount > 12)) return setFeedback('Elegí una fecha final que genere entre 1 y 12 reservas semanales.')
    setSaving(true); setFeedback(null)
    const error = await onSave(draft, reservation)
    setSaving(false)
    if (error) setFeedback(error)
  }
  const cancel = async () => {
    if (!reservation) return
    setSaving(true); setCancelError(null)
    const error = await onCancel(reservation)
    setSaving(false)
    if (error) setCancelError(error)
  }
  const summary = `${court?.name ?? 'Cancha'} · ${capitalize(dayLabel(draft.date, { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', ''))} · ${draft.startsAt}–${draft.endsAt}`
  return <Modal open onClose={onClose} busy={saving} variant="drawer" size="md" eyebrow={reservation ? 'Editar reserva' : 'Agenda de canchas'} title={reservation ? 'Actualizar turno' : 'Registrar turno'}>
    <form className="res-form" onSubmit={(event) => void submit(event)} noValidate>
      {!reservation && onSwitchKind && <KindSwitch kind="reservation" onPick={() => onSwitchKind({ courtId: draft.courtId, date: draft.date, startsAt: draft.startsAt, endsAt: draft.endsAt })} />}
      <CourtAndTimeFields club={club} courts={courts} courtId={draft.courtId} date={draft.date} startsAt={draft.startsAt} endsAt={draft.endsAt} occupations={occupations} occupationsDate={occupationsDate} ignoreId={reservation?.id} onChange={(change) => setDraft({ ...draft, ...change })} />
      <Field label="Nombre de quien reserva" hint={draft.personId ? undefined : 'Nombre libre o buscá una ficha existente. No hace falta que tenga cuenta.'}>
        {(id, describedBy) => (
          <div className="autocomplete">
            {draft.personId ? (
              <div className="person-pill">
                <Avatar name={draft.customerName} size="sm" />
                <span className="person-pill-name">{draft.customerName}</span>
                <Badge tone="success">Ficha vinculada</Badge>
                <button type="button" className="link-btn" onClick={() => setDraft({ ...draft, personId: null })}>Usar nombre libre</button>
              </div>
            ) : (
              <TextInput id={id} icon="search" value={draft.customerName} autoComplete="off" placeholder="Ej.: Lucas Benítez" aria-describedby={describedBy} onChange={(event) => { setTyped(true); setDraft({ ...draft, customerName: event.target.value, personId: null }) }} data-autofocus required />
            )}
            {!draft.personId && matches.length > 0 && (
              <ul className="autocomplete-list" role="listbox" aria-label="Jugadores encontrados">
                {matches.map((person) => (
                  <li key={person.id}>
                    <button type="button" role="option" aria-selected={false} onClick={() => { setDraft({ ...draft, customerName: person.full_name, personId: person.id }); setMatches([]) }}>
                      <Avatar name={person.full_name} size="sm" />
                      <span>{person.full_name}</span>
                      {person.phone && <small className="muted">{person.phone}</small>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Field>
      {!reservation && (
        <div className="form-block">
          <Switch checked={draft.recurrence === 'weekly'} onChange={(on) => setDraft({ ...draft, recurrence: on ? 'weekly' : 'single' })} label="Repetir cada semana" description="Turno fijo. Cada ocurrencia se edita por separado." />
          {draft.recurrence === 'weekly' && (
            <Field label="Última fecha de la serie" hint={`Se crearán ${occurrenceCount} reservas (máximo 12), siempre el mismo día, horario y cancha.`}>
              {(id, describedBy) => <TextInput id={id} type="date" min={draft.date} value={draft.recurrenceUntil} aria-describedby={describedBy} onChange={(event) => setDraft({ ...draft, recurrenceUntil: event.target.value })} required />}
            </Field>
          )}
        </div>
      )}
      {reservation?.recurrence_series_id && <p className="inline-alert inline-alert-info"><Icon name="repeat" size={20} /><span>Esta es una ocurrencia de una serie. Los cambios solo afectan a este turno.</span></p>}
      {showNotes
        ? <Field label="Observaciones" optional>{(id) => <TextArea id={id} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Visible solo para administración" />}</Field>
        : <button type="button" className="link-btn link-btn-icon" onClick={() => setShowNotes(true)}><Icon name="note" size={18} />Agregar observación</button>}
      <div className="form-footer">
        {feedback && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div>{feedback}</div></div>}
        <p className="form-summary"><Icon name="clock" size={16} /><span>{summary}</span></p>
        <div className="form-actions">
          {reservation && <Button variant="danger" icon="x" onClick={() => { setCancelError(null); setConfirming(true) }} disabled={saving}>Cancelar reserva</Button>}
          <Button variant="ghost" onClick={onClose} disabled={saving}>Volver</Button>
          <Button type="submit" variant="accent" size="lg" icon="check" loading={saving}>{saving ? 'Guardando…' : reservation ? 'Guardar cambios' : draft.recurrence === 'weekly' ? 'Revisar y crear serie' : 'Crear reserva'}</Button>
        </div>
      </div>
    </form>
    <ConfirmDialog open={confirming} onClose={() => { if (!saving) setConfirming(false) }} title="¿Cancelar esta reserva?" confirmLabel="Sí, cancelar reserva" status={saving ? 'saving' : cancelError ? 'error' : 'idle'} errorTitle="No se pudo cancelar" errorBody={cancelError ?? undefined} onConfirm={() => void cancel()}>
      <p>El historial se conservará y la cancha queda libre para otra reserva.</p>
      {reservation?.recurrence_series_id && <p className="muted">Solo se cancela esta ocurrencia; el resto del turno fijo se mantiene.</p>}
    </ConfirmDialog>
  </Modal>
}

export function BlockForm({ club, courts, initial, block, occupations, occupationsDate, onClose, onSave, onCancel, onSwitchKind }: BlockFormProps) {
  const [draft, setDraft] = useState(initial)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    if (!draft.reason.trim()) return setFeedback('Elegí o indicá un motivo para el bloqueo.')
    if (!isValidReservationInterval(draft, club.timezone)) return setFeedback('La hora de finalización debe ser posterior a la de inicio.')
    setSaving(true); setFeedback(null)
    const error = await onSave(draft, block)
    setSaving(false)
    if (error) setFeedback(error)
  }
  const cancel = async () => {
    if (!block) return
    setSaving(true); setCancelError(null)
    const error = await onCancel(block)
    setSaving(false)
    if (error) setCancelError(error)
  }
  const [showNotes, setShowNotes] = useState(Boolean(initial.notes))
  return <Modal open onClose={onClose} busy={saving} variant="drawer" size="md" eyebrow={block ? 'Editar bloqueo' : 'Agenda de canchas'} title={block ? 'Actualizar bloqueo' : 'Bloquear cancha'}>
    <form className="res-form" onSubmit={(event) => void submit(event)} noValidate>
      {!block && onSwitchKind && <KindSwitch kind="block" onPick={() => onSwitchKind({ courtId: draft.courtId, date: draft.date, startsAt: draft.startsAt, endsAt: draft.endsAt })} />}
      <CourtAndTimeFields club={club} courts={courts} courtId={draft.courtId} date={draft.date} startsAt={draft.startsAt} endsAt={draft.endsAt} occupations={occupations} occupationsDate={occupationsDate} ignoreId={block?.id} onChange={(change) => setDraft({ ...draft, ...change })} />
      <fieldset className="form-block">
        <legend className="form-legend">Motivo</legend>
        <div className="chip-row">{BLOCK_REASONS.map((reason) => <Chip key={reason} selected={draft.reason === reason} onClick={() => setDraft({ ...draft, reason })}>{reason}</Chip>)}</div>
      </fieldset>
      {showNotes
        ? <Field label="Observaciones" optional>{(id) => <TextArea id={id} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Visible solo para administración" />}</Field>
        : <button type="button" className="link-btn link-btn-icon" onClick={() => setShowNotes(true)}><Icon name="note" size={18} />Agregar observación</button>}
      <div className="form-footer">
        {feedback && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div>{feedback}</div></div>}
        <div className="form-actions">
          {block && <Button variant="danger" icon="x" onClick={() => { setCancelError(null); setConfirming(true) }} disabled={saving}>Cancelar bloqueo</Button>}
          <Button variant="ghost" onClick={onClose} disabled={saving}>Volver</Button>
          <Button type="submit" variant="accent" size="lg" icon="check" loading={saving}>{saving ? 'Guardando…' : block ? 'Guardar cambios' : 'Crear bloqueo'}</Button>
        </div>
      </div>
    </form>
    <ConfirmDialog open={confirming} onClose={() => { if (!saving) setConfirming(false) }} title="¿Cancelar este bloqueo?" confirmLabel="Sí, cancelar bloqueo" status={saving ? 'saving' : cancelError ? 'error' : 'idle'} errorTitle="No se pudo cancelar" errorBody={cancelError ?? undefined} onConfirm={() => void cancel()}>
      <p>El historial se conservará y el horario vuelve a quedar disponible.</p>
    </ConfirmDialog>
  </Modal>
}

function formatConflicts(conflicts: ReturnType<typeof occupationConflicts>, timezone: string) {
  const details = [...new Map(conflicts.map(({ occupation }) => [occupation.id, occupation])).values()].map((occupation) => `${occupation.occupation_type === 'block' ? `bloqueo: ${occupation.block_reason}` : occupation.occupation_type === 'lesson' ? 'clase de tenis' : occupation.occupation_type === 'tournament_match' ? 'partido de torneo' : `reserva: ${occupation.customer_name}`} (${isoToDateAndTime(occupation.starts_at, timezone).date} ${isoToDateAndTime(occupation.starts_at, timezone).time}–${isoToDateAndTime(occupation.ends_at, timezone).time})`).join(', ')
  return `Hay horarios ocupados que deben resolverse antes de guardar: ${details}.`
}

type FormState = { kind: 'reservation'; draft: ReservationDraft; reservation?: Reservation } | { kind: 'block'; draft: BlockDraft; block?: Reservation }

export function ReservationCalendar({ client, club, courts, formRequest, onFormRequestHandled, onOpenLesson, onOpenTournamentMatch, onCreateLesson }: ReservationCalendarProps) {
  const today = todayInTimezone(club.timezone)
  const [date, setDate] = useState(today)
  const [occupations, setOccupations] = useState<Reservation[]>([])
  const [selectedCourtId, setSelectedCourtId] = useState(courts.find((court) => court.active)?.id ?? courts[0]?.id ?? '')
  const [form, setForm] = useState<FormState | null>(null)
  const [detail, setDetail] = useState<Reservation | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Reservation | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<'court' | 'overview'>('court')
  const [nowMs, setNowMs] = useState(() => Date.now())
  const isMobile = useIsMobile()
  const [stripStart, setStripStart] = useState(() => shiftCalendarDate(today, -1))
  useEffect(() => { const timer = window.setInterval(() => setNowMs(Date.now()), 30_000); return () => window.clearInterval(timer) }, [])
  useEffect(() => { setSelectedCourtId((current) => courts.some((court) => court.id === current) ? current : courts.find((court) => court.active)?.id ?? courts[0]?.id ?? '') }, [courts])
  useEffect(() => { if (date < stripStart || date > shiftCalendarDate(stripStart, 8)) setStripStart(shiftCalendarDate(date, -1)) }, [date, stripStart])
  const defaultCourt = () => courts.find((court) => court.active) ?? courts[0]
  useEffect(() => {
    if (!formRequest) return
    const court = courts.find((item) => item.id === formRequest.courtId && item.active) ?? defaultCourt()
    if (court) {
      const requestDate = formRequest.date ?? date
      setForm(formRequest.kind === 'reservation' ? { kind: 'reservation', draft: initialReservationDraft(club.id, court.id, requestDate, formRequest.startsAt) } : { kind: 'block', draft: initialBlockDraft(club.id, court.id, requestDate, formRequest.startsAt) })
    }
    onFormRequestHandled?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formRequest])
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
      const { error } = await client.rpc('create_weekly_reservation_series', { p_club_id: club.id, p_court_id: draft.courtId, p_customer_name: draft.customerName.trim(), p_person_id: draft.personId, p_notes: draft.notes.trim() || null, p_starts_at: candidates[0].starts_at, p_ends_at: candidates[0].ends_at, p_occurrence_count: dates.length })
      if (error) return isOverlapError(error) ? 'Uno de los horarios acaba de ser ocupado. No se creó ninguna reserva de la serie.' : 'No pudimos crear la serie. Revisá los datos e intentá nuevamente.'
      setForm(null); setFeedback(`Serie creada con ${dates.length} reservas.`); await reload(); return null
    }
    const candidate = { id: reservation?.id ?? 'new-reservation', court_id: draft.courtId, starts_at: payload.starts_at, ends_at: payload.ends_at }
    const conflicts = conflictFor(candidate)
    if (conflicts.length) return formatConflicts(conflicts, club.timezone)
    const editablePayload = { court_id: payload.court_id, customer_name: payload.customer_name, person_id: payload.person_id, starts_at: payload.starts_at, ends_at: payload.ends_at, notes: payload.notes }
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
  const openCreate = (court: Court, startsAt: string, kind: 'reservation' | 'block' = 'reservation') => court.active && setForm(kind === 'reservation' ? { kind, draft: initialReservationDraft(club.id, court.id, date, startsAt) } : { kind, draft: initialBlockDraft(club.id, court.id, date, startsAt) })
  const openEdit = (occupation: Reservation) => {
    const start = isoToDateAndTime(occupation.starts_at, club.timezone); const end = isoToDateAndTime(occupation.ends_at, club.timezone)
    if (occupation.occupation_type === 'block') setForm({ kind: 'block', block: occupation, draft: { clubId: club.id, courtId: occupation.court_id, date: start.date, startsAt: start.time, endsAt: end.time, reason: occupation.block_reason ?? 'Otro motivo', notes: occupation.notes ?? '' } })
    else if (occupation.occupation_type === 'lesson') onOpenLesson?.(occupation.id)
    else if (occupation.occupation_type === 'tournament_match') onOpenTournamentMatch?.(occupation.id)
    else setForm({ kind: 'reservation', reservation: occupation, draft: { clubId: club.id, courtId: occupation.court_id, date: start.date, startsAt: start.time, endsAt: end.time, customerName: occupation.customer_name ?? '', personId: occupation.person_id, notes: occupation.notes ?? '', recurrence: 'single', recurrenceUntil: start.date } })
  }
  const switchKind = (request: SwitchRequest) => setForm((current) => current?.kind === 'reservation'
    ? { kind: 'block', draft: { ...initialBlockDraft(club.id, request.courtId, request.date, request.startsAt), endsAt: request.endsAt } }
    : { kind: 'reservation', draft: { ...initialReservationDraft(club.id, request.courtId, request.date, request.startsAt), endsAt: request.endsAt } })

  // Canchas visibles: activas y las inactivas que todavía tienen ocupaciones cargadas ese día.
  const dayCourts = courts.filter((court) => court.active || occupations.some((occupation) => occupation.court_id === court.id))
  const courtId = dayCourts.some((court) => court.id === selectedCourtId) ? selectedCourtId : dayCourts[0]?.id ?? ''
  const overview = isMobile && mobileView === 'overview'
  const visibleCourts = isMobile && !overview ? dayCourts.filter((court) => court.id === courtId) : dayCourts
  const nowTime = isoToDateAndTime(new Date(nowMs).toISOString(), club.timezone).time
  const nowMinutes = toMinutes(nowTime)
  const isToday = date === today
  const busyMinutes = (id: string) => occupations.filter((occupation) => occupation.court_id === id).reduce((sum, occupation) => { const { start, end } = occupationBounds(occupation, date, club.timezone); return sum + Math.max(0, end - start) }, 0)
  const occupancy = dayCourts.length ? Math.round((dayCourts.reduce((sum, court) => sum + busyMinutes(court.id), 0) / (dayCourts.length * (END_MINUTES - START_MINUTES))) * 100) : 0
  const shiftCourt = (delta: number) => { const index = dayCourts.findIndex((court) => court.id === courtId); if (index >= 0) setSelectedCourtId(dayCourts[(index + delta + dayCourts.length) % dayCourts.length].id) }
  const stripDays = Array.from({ length: 9 }, (_, index) => shiftCalendarDate(stripStart, index))

  return <section className="agenda" aria-labelledby="reservations-title">
    <h2 id="reservations-title" className="visually-hidden">Agenda de canchas</h2>
    <div className="agenda-toolbar">
      <div className="date-nav">
        <IconButton icon="chevronLeft" label="Día anterior" variant="secondary" onClick={() => setDate(shiftCalendarDate(date, -1))} />
        <div className="date-nav-label">
          <p className="date-nav-title display">{capitalize(dayLabel(date, { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
          <p className="date-nav-sub">{isToday ? 'Hoy · ' : ''}{plural(occupations.length, 'ocupación', 'ocupaciones')} · {occupancy}% de uso</p>
        </div>
        <IconButton icon="chevronRight" label="Día siguiente" variant="secondary" onClick={() => setDate(shiftCalendarDate(date, 1))} />
        {!isToday && <Button variant="ghost" size="sm" onClick={() => setDate(today)}>Hoy</Button>}
        <label className="date-picker" title="Ir a fecha">
          <Icon name="calendar" size={18} />
          <span className="visually-hidden">Ir a fecha</span>
          <input type="date" value={date} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => event.target.value && setDate(event.target.value)} />
        </label>
      </div>
      <div className="toolbar-actions">
        <Button variant="accent" icon="plus" className="show-mobile" onClick={() => { const court = defaultCourt(); if (court) openCreate(court, '07:00') }}>Nueva reserva</Button>
        <Button variant="secondary" icon="lock" className="hide-mobile" onClick={() => { const court = defaultCourt(); if (court) openCreate(court, '07:00', 'block') }}>Bloquear cancha</Button>
        <Button variant="secondary" icon="school" className="hide-mobile" onClick={() => { const court = defaultCourt(); if (court) onCreateLesson?.({ courtId: court.id, date, startsAt: '07:00' }) }}>Nueva clase</Button>
      </div>
    </div>

    <div className="date-strip" role="listbox" aria-label="Elegir día">
      {stripDays.map((day) => (
        <button key={day} type="button" role="option" aria-selected={day === date} className={`date-chip ${day === date ? 'is-selected' : ''} ${day === today ? 'is-today' : ''}`} onClick={() => setDate(day)}>
          <span className="date-chip-wd">{day === today ? 'Hoy' : dayLabel(day, { weekday: 'short' }).replace('.', '')}</span>
          <span className="date-chip-n display num">{Number(day.slice(8))}</span>
        </button>
      ))}
    </div>

    <div className="agenda-subbar">
      {isMobile && <SegmentedTabs label="Vista de agenda" size="sm" value={mobileView} onChange={setMobileView} items={[{ id: 'court', label: 'Por cancha' }, { id: 'overview', label: 'Panorama' }]} />}
      <ul className="legend" aria-label="Referencias">
        {(['reservation', 'lesson', 'match', 'block'] as const).map((kind) => <li key={kind}><span className={`legend-swatch occ-${kind}`} aria-hidden="true" />{KIND_LABEL[kind]}</li>)}
      </ul>
    </div>

    {feedback && status !== 'error' && <p className="inline-alert inline-alert-success" role="status"><Icon name="checkCircle" size={20} /><span>{feedback}</span></p>}

    {courts.length === 0 ? <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span>No hay canchas configuradas para este club.</span></p> : <>
      {isMobile && !overview && (
        <div className="court-switcher" role="radiogroup" aria-label="Elegir cancha" style={{ '--n': Math.max(dayCourts.length, 1) } as CSSProperties}>
          {dayCourts.map((court) => {
            const busyNow = isToday && occupations.some((occupation) => occupation.court_id === court.id && new Date(occupation.starts_at).getTime() <= nowMs && nowMs < new Date(occupation.ends_at).getTime())
            const count = occupations.filter((occupation) => occupation.court_id === court.id).length
            return (
              <button key={court.id} type="button" role="radio" aria-checked={court.id === courtId} aria-label={`${court.name}${court.active ? '' : ' (inactiva)'}`} className={`court-switch ${court.id === courtId ? 'is-selected' : ''}`} onClick={() => setSelectedCourtId(court.id)}>
                <CourtMark label={courtShort(court)} size="sm" tone={court.id === courtId ? 'clay' : 'muted'} />
                <span className="court-switch-meta">{!court.active ? 'Inactiva' : isToday ? (busyNow ? 'En uso' : 'Libre') : plural(count, 'turno', 'turnos')}</span>
              </button>
            )
          })}
        </div>
      )}
      {status === 'error' ? <ErrorState title="No pudimos cargar la agenda" body={feedback ?? undefined} onRetry={() => { setStatus('loading'); void load().then((result) => { if (result.error) { setStatus('error'); return }; setOccupations(result.rows); setFeedback(null); setStatus('ready') }) }} />
        : status === 'loading' ? <AgendaSkeleton columns={Math.max(visibleCourts.length, 1)} />
          : <>
            {occupations.length === 0 && <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span><b>Día sin ocupaciones.</b> Tocá cualquier horario para cargar una reserva.</span></p>}
            <AgendaGrid club={club} date={date} courts={visibleCourts} occupations={occupations} compact={overview} nowMinutes={isToday ? nowMinutes : null} nowMs={nowMs} onSlot={(court, slot) => openCreate(court, slot)} onSelect={setDetail} onCourtHead={overview ? (id) => { setSelectedCourtId(id); setMobileView('court') } : undefined} />
            {isMobile && !overview && dayCourts.length > 1 && (
              <div className="court-pager">
                <Button variant="ghost" icon="chevronLeft" onClick={() => shiftCourt(-1)}>Anterior</Button>
                <Button variant="ghost" iconRight="chevronRight" onClick={() => shiftCourt(1)}>Siguiente</Button>
              </div>
            )}
          </>}
    </>}

    <OccupationDetail club={club} courts={courts} occupation={detail} onClose={() => setDetail(null)} onEdit={(occupation) => { setDetail(null); openEdit(occupation) }} onCancel={(occupation) => { setCancelError(null); setCancelTarget(occupation) }} onOpenLesson={onOpenLesson} onOpenTournamentMatch={onOpenTournamentMatch} />
    <ConfirmDialog open={cancelTarget !== null} onClose={() => { if (!cancelling) setCancelTarget(null) }} title={cancelTarget?.occupation_type === 'block' ? '¿Levantar el bloqueo?' : '¿Cancelar esta reserva?'} confirmLabel={cancelTarget?.occupation_type === 'block' ? 'Levantar bloqueo' : 'Sí, cancelar'} status={cancelling ? 'saving' : cancelError ? 'error' : 'idle'} errorTitle="No se pudo cancelar" errorBody={cancelError ?? undefined} onConfirm={() => { if (!cancelTarget) return; setCancelling(true); setCancelError(null); void cancel(cancelTarget).then((error) => { setCancelling(false); if (error) setCancelError(error); else { setCancelTarget(null); setDetail(null) } }) }}>
      {cancelTarget && <>
        <p><b>{occupationTitle(cancelTarget)}</b> · {courts.find((court) => court.id === cancelTarget.court_id)?.name} · <span className="num">{isoToDateAndTime(cancelTarget.starts_at, club.timezone).time}–{isoToDateAndTime(cancelTarget.ends_at, club.timezone).time}</span></p>
        <p className="muted">El historial se conserva y la cancha queda libre para otra reserva. {cancelTarget.recurrence_series_id ? 'Solo se cancela esta ocurrencia; el resto del turno fijo se mantiene.' : ''}</p>
      </>}
    </ConfirmDialog>
    {form?.kind === 'reservation' && <ReservationForm client={client} club={club} courts={courts} initial={form.draft} reservation={form.reservation} occupations={occupations} occupationsDate={date} onClose={() => setForm(null)} onSave={saveReservation} onCancel={cancel} onSwitchKind={form.reservation ? undefined : switchKind} />}
    {form?.kind === 'block' && <BlockForm club={club} courts={courts} initial={form.draft} block={form.block} occupations={occupations} occupationsDate={date} onClose={() => setForm(null)} onSave={saveBlock} onCancel={cancel} onSwitchKind={form.block ? undefined : switchKind} />}
  </section>
}

function OccupationDetail({ club, courts, occupation, onClose, onEdit, onCancel, onOpenLesson, onOpenTournamentMatch }: { club: Club; courts: Court[]; occupation: Reservation | null; onClose: () => void; onEdit: (occupation: Reservation) => void; onCancel: (occupation: Reservation) => void; onOpenLesson?: (id: string) => void; onOpenTournamentMatch?: (id: string) => void }) {
  const kind = occupation ? occupationKind(occupation.occupation_type) : null
  const court = occupation ? courts.find((item) => item.id === occupation.court_id) : undefined
  const start = occupation ? isoToDateAndTime(occupation.starts_at, club.timezone) : null
  const end = occupation ? isoToDateAndTime(occupation.ends_at, club.timezone) : null
  const generic = occupation?.occupation_type === 'reservation' || occupation?.occupation_type === 'block'
  return (
    <Modal open={occupation !== null} onClose={onClose} variant="drawer" size="sm" eyebrow={kind ? KIND_LABEL[kind] : ''} title={occupation ? occupationTitle(occupation) : ''}>
      {occupation && kind && start && end && (
        <div className="detail">
          <div className={`detail-hero occ-${kind}`}>
            <span className="detail-time num">{start.time}–{end.time}</span>
            <span>{court?.name ?? 'Cancha'} · {capitalize(dayLabel(start.date, { weekday: 'long', day: 'numeric', month: 'long' }))} · {durationLabel(toMinutes(end.time) - toMinutes(start.time))}</span>
          </div>
          <dl className="detail-list">
            <div><dt>Tipo</dt><dd><Badge tone={KIND_TONE[kind]} dot>{KIND_LABEL[kind]}</Badge>{occupation.recurrence_series_id && <Badge tone="info" icon="repeat">Turno fijo semanal</Badge>}</dd></div>
            {occupation.occupation_type === 'reservation' && <div><dt>Ficha</dt><dd className={occupation.person_id ? undefined : 'muted'}>{occupation.person_id ? 'Ficha de jugador vinculada' : 'Nombre libre, sin ficha vinculada'}</dd></div>}
            {occupation.block_reason && <div><dt>Motivo</dt><dd>{occupation.block_reason}</dd></div>}
            {occupation.notes && <div><dt>Observación</dt><dd>{occupation.notes}</dd></div>}
          </dl>
          {occupation.occupation_type === 'reservation' && <p className="detail-footnote"><Icon name="info" size={16} />Reservar no genera un cobro. El uso y el pago se registran aparte.</p>}
          <div className="detail-actions">
            {generic ? (
              <>
                <Button variant="primary" icon="edit" onClick={() => onEdit(occupation)}>Editar</Button>
                <Button variant="danger" icon="x" onClick={() => onCancel(occupation)}>{occupation.occupation_type === 'block' ? 'Levantar bloqueo' : 'Cancelar reserva'}</Button>
              </>
            ) : (
              <Button variant="primary" iconRight="arrowRight" onClick={() => { onClose(); if (occupation.occupation_type === 'lesson') onOpenLesson?.(occupation.id); else onOpenTournamentMatch?.(occupation.id) }}>
                {occupation.occupation_type === 'lesson' ? 'Gestionar en Escuela' : 'Gestionar en Torneos'}
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

type GridProps = { club: Club; date: string; courts: Court[]; occupations: Reservation[]; compact: boolean; nowMinutes: number | null; nowMs: number; onSlot: (court: Court, slot: string) => void; onSelect: (occupation: Reservation) => void; onCourtHead?: (courtId: string) => void }

function AgendaGrid({ club, date, courts, occupations, compact, nowMinutes, nowMs, onSlot, onSelect, onCourtHead }: GridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const slots = useMemo(() => { const list: number[] = []; for (let minute = START_MINUTES; minute < END_MINUTES; minute += SLOT_MINUTES) list.push(minute); return list }, [])
  const isToday = nowMinutes !== null
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const rowHeight = parseFloat(getComputedStyle(node).getPropertyValue('--row')) || 32
    const target = isToday ? (nowMinutes ?? 0) - 60 : 8 * 60
    node.scrollTop = Math.max(0, ((target - START_MINUTES) / SLOT_MINUTES) * rowHeight)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, isToday])
  const bounds = (occupation: Reservation) => occupationBounds(occupation, date, club.timezone)
  const style = { '--cols': Math.max(courts.length, 1), '--rows': slots.length } as CSSProperties
  const nowOffset = nowMinutes === null ? null : (nowMinutes - START_MINUTES) / SLOT_MINUTES
  const showNow = nowOffset !== null && nowOffset >= 0 && nowOffset <= slots.length
  return (
    <div className={`agenda-scroll ${compact ? 'is-compact' : ''} ${courts.length === 1 ? 'is-single' : ''}`} ref={scrollRef} tabIndex={0} aria-label="Grilla de horarios">
      <div className="agenda-grid" style={style}>
        <div className="agenda-corner" aria-hidden="true" />
        {courts.map((court) => {
          const count = occupations.filter((occupation) => occupation.court_id === court.id).length
          const head = <>
            <CourtMark label={courtShort(court)} size="sm" />
            <span className="agenda-court-name">{compact ? courtShort(court) : court.name}</span>
            {!compact && <span className="agenda-court-meta">{court.active ? plural(count, 'turno', 'turnos') : 'Inactiva'}</span>}
          </>
          return onCourtHead
            ? <button key={court.id} type="button" className="agenda-court-head" onClick={() => onCourtHead(court.id)} aria-label={`Ver ${court.name}`}>{head}</button>
            : <div key={court.id} className="agenda-court-head">{head}</div>
        })}

        <div className="agenda-times" aria-hidden="true">
          {slots.map((slot) => <div key={slot} className={`agenda-time ${slot % 60 === 0 ? 'is-hour' : ''}`}>{slot % 60 === 0 ? fmt(slot) : ''}</div>)}
          {showNow && nowMinutes !== null && <span className="now-pill num" style={{ '--at': nowOffset } as CSSProperties}>{fmt(nowMinutes)}</span>}
        </div>

        {courts.map((court) => {
          const items = occupations.filter((occupation) => occupation.court_id === court.id).map((occupation) => ({ occupation, ...bounds(occupation) })).filter((item) => item.end > item.start)
          const covered = (slot: number) => items.some((item) => item.start <= slot && slot < item.end)
          return (
            <div key={court.id} className="agenda-col" role="group" aria-label={court.name}>
              {slots.map((slot) => {
                const past = nowMinutes !== null && slot + SLOT_MINUTES <= nowMinutes
                const hidden = covered(slot) || !court.active
                return (
                  <button key={slot} type="button" className={`agenda-cell ${slot % 60 === 0 ? 'is-hour' : ''} ${past ? 'is-past' : ''}`} tabIndex={hidden ? -1 : 0} aria-hidden={hidden || undefined} disabled={!court.active} aria-label={`${court.name}, ${fmt(slot)}${court.active ? ', crear reserva' : ', cancha inactiva'}`} onClick={() => onSlot(court, fmt(slot))}>
                    {!compact && <span className="agenda-cell-hint"><Icon name="plus" size={14} />{fmt(slot)}</span>}
                  </button>
                )
              })}
              {items.map(({ occupation, start, end }) => {
                const kind = occupationKind(occupation.occupation_type)
                const title = occupationTitle(occupation)
                const range = `${isoToDateAndTime(occupation.starts_at, club.timezone).time}–${isoToDateAndTime(occupation.ends_at, club.timezone).time}`
                const live = nowMinutes !== null && new Date(occupation.starts_at).getTime() <= nowMs && nowMs < new Date(occupation.ends_at).getTime()
                const past = nowMinutes !== null && new Date(occupation.ends_at).getTime() <= nowMs
                return (
                  <button key={occupation.id} type="button" className={`occ occ-${kind} ${end - start <= 30 ? 'is-short' : ''} ${past ? 'is-past' : ''} ${live ? 'is-live' : ''}`} style={{ '--start': (start - START_MINUTES) / SLOT_MINUTES, '--span': (end - start) / SLOT_MINUTES } as CSSProperties} onClick={() => onSelect(occupation)} aria-label={`${KIND_LABEL[kind]}: ${title}, ${range}`}>
                    {compact ? <span className="occ-compact-label">{kind === 'block' ? '' : title.split(' ').map((word) => word[0]).join('').slice(0, 2)}</span> : <>
                      <span className="occ-title">{title}</span>
                      <span className="occ-meta num">{range}{occupation.recurrence_series_id && <Icon name="repeat" size={13} label="Turno fijo" />}{occupation.notes && <Icon name="note" size={13} label="Con observación" />}</span>
                      {live && <span className="occ-live">En juego</span>}
                    </>}
                  </button>
                )
              })}
              {nowOffset !== null && showNow && <span className="now-line" style={{ '--at': nowOffset } as CSSProperties} aria-hidden="true" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AgendaSkeleton({ columns }: { columns: number }) {
  return (
    <div className="agenda-skeleton" role="status" aria-label="Cargando agenda" style={{ '--cols': columns } as CSSProperties}>
      {Array.from({ length: columns }, (_, index) => (
        <div key={index} className="agenda-skeleton-col">
          <Skeleton height={44} radius={12} />
          <Skeleton height={90} radius={10} />
          <Skeleton height={60} radius={10} />
          <Skeleton height={120} radius={10} />
        </div>
      ))}
      <span className="visually-hidden">Cargando ocupaciones…</span>
    </div>
  )
}
