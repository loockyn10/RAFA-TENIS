import { useMemo, useState } from 'react'
import { BLOCK_REASONS, type BlockReason, type Occupation } from '../../data/mock'
import { CourtPicker, MemberBadge } from '../../components/domain'
import { useCourts, usePeople } from '../../lib/data'
import { findConflict } from '../../lib/agenda'
import { useProto } from '../../lib/proto'
import { useStore } from '../../lib/store'
import { addDays, capitalize, DAY_CLOSE, dateShort, dayLong, hhmm, range, slots, weekdayShort, type Minutes } from '../../lib/time'
import { Avatar, Button, Chip, Field, Icon, Modal, SegmentedTabs, SelectInput, Switch, TextArea, TextInput } from '../../components/ui'

export type ReservationIntent = {
  courtId?: string
  date: string
  start?: Minutes
  mode?: 'reservation' | 'block'
  editing?: Occupation
  /** Ficha precargada (por ejemplo, «Nueva reserva» desde la ficha del jugador). */
  personId?: string
}

const LENGTHS = [60, 90, 120]

export function ReservationSheet({ intent, onClose, onSaved }: { intent: ReservationIntent | null; onClose: () => void; onSaved?: (occupation: Occupation) => void }) {
  return (
    <Modal open={intent !== null} onClose={onClose} variant="drawer" size="md" eyebrow={intent?.editing ? 'Editar ocupación' : 'Agenda de canchas'} title={intent?.editing ? 'Editar reserva' : intent?.mode === 'block' ? 'Bloquear cancha' : 'Nueva reserva'}>
      {intent && <ReservationForm key={JSON.stringify({ ...intent, editing: intent.editing?.id })} intent={intent} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  )
}

function ReservationForm({ intent, onClose, onSaved }: { intent: ReservationIntent; onClose: () => void; onSaved?: (occupation: Occupation) => void }) {
  const { state, dispatch } = useStore()
  const { simulate, notify } = useProto()
  const { active: courts, byId: courtById } = useCourts()
  const { active: people, byId: personById } = usePeople()
  const editing = intent.editing
  const preset = personById(intent.personId)
  const [mode, setMode] = useState<'reservation' | 'block'>(editing?.kind === 'block' ? 'block' : intent.mode ?? 'reservation')
  const [courtId, setCourtId] = useState(editing?.courtId ?? intent.courtId ?? courts[0]?.id ?? 'c1')
  const [date, setDate] = useState(editing?.date ?? intent.date)
  const [start, setStart] = useState<Minutes>(editing?.start ?? intent.start ?? 19 * 60)
  const [end, setEnd] = useState<Minutes>(editing?.end ?? Math.min((intent.start ?? 19 * 60) + 60, DAY_CLOSE))
  const [customEnd, setCustomEnd] = useState(editing ? !LENGTHS.includes(editing.end - editing.start) : false)
  const [name, setName] = useState(editing?.kind === 'reservation' ? editing.title : preset?.name ?? '')
  const [personId, setPersonId] = useState<string | null>(editing?.personId ?? preset?.id ?? null)
  const [nameFocused, setNameFocused] = useState(false)
  const [weekly, setWeekly] = useState(false)
  const [until, setUntil] = useState(addDays(intent.date, 21))
  const [reason, setReason] = useState<BlockReason | null>(editing?.reason ?? null)
  const [note, setNote] = useState(editing?.note ?? '')
  const [showNote, setShowNote] = useState(Boolean(editing?.note))
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [touched, setTouched] = useState(false)

  const court = courtById(courtId) ?? courts[0]
  const length = end - start
  const occurrences = useMemo(() => {
    if (!weekly || mode !== 'reservation') return [date]
    const list: string[] = []
    for (let current = date; current <= until && list.length < 12; current = addDays(current, 7)) list.push(current)
    return list
  }, [weekly, mode, date, until])

  const conflicts = occurrences
    .map((day) => ({ day, hit: findConflict(state.occupations, { courtId, date: day, start, end }, editing?.id) }))
    .filter((item) => item.hit)
  const firstConflict = conflicts[0]
  const freeCourts = firstConflict && firstConflict.day === date
    ? courts.filter((item) => item.id !== courtId && !findConflict(state.occupations, { courtId: item.id, date, start, end }, editing?.id))
    : []

  const suggestions = nameFocused && !personId && name.trim().length > 0
    ? people.filter((person) => !person.coach && person.name.toLowerCase().includes(name.trim().toLowerCase())).slice(0, 5)
    : []
  const person = personById(personId)

  const nameError = touched && mode === 'reservation' && name.trim() === '' ? 'Indicá quién juega. Puede ser un nombre libre.' : undefined
  const reasonError = touched && mode === 'block' && !reason ? 'Elegí un motivo de bloqueo.' : undefined
  const canSubmit = !firstConflict && end > start

  const setLength = (minutes: number) => {
    setCustomEnd(false)
    setEnd(Math.min(start + minutes, DAY_CLOSE))
  }
  const changeStart = (value: Minutes) => {
    setStart(value)
    setEnd(Math.min(value + (length > 0 ? length : 60), DAY_CLOSE))
  }

  const submit = async () => {
    setTouched(true)
    if (!canSubmit) return
    if (mode === 'reservation' && name.trim() === '') return
    if (mode === 'block' && !reason) return
    setStatus('saving')
    try {
      await simulate()
    } catch {
      setStatus('error')
      return
    }
    const base: Omit<Occupation, 'id' | 'date'> = mode === 'block'
      ? { courtId, start, end, kind: 'block', title: reason ?? 'Bloqueo', reason: reason ?? undefined, note: note.trim() || undefined }
      : { courtId, start, end, kind: 'reservation', title: name.trim(), personId: personId ?? undefined, note: note.trim() || undefined, series: occurrences.length > 1 || undefined }
    let saved: Occupation
    if (editing) {
      saved = { ...editing, ...base, date }
      dispatch({ type: 'occ/update', occupation: saved })
    } else {
      const stamp = Date.now()
      const created = occurrences.map((day, index) => ({ ...base, id: `new-${stamp}-${index}`, date: day }))
      created.forEach((occupation) => dispatch({ type: 'occ/add', occupation }))
      saved = created[0]
    }
    notify({
      tone: 'success',
      title: editing ? 'Cambios guardados' : mode === 'block' ? 'Cancha bloqueada' : occurrences.length > 1 ? `Serie creada · ${occurrences.length} reservas` : 'Reserva confirmada',
      body: `${court.name} · ${capitalize(weekdayShort(date))} ${dateShort(date)} · ${range({ start, end })}`,
    })
    onSaved?.(saved)
    onClose()
  }

  return (
    <form className="res-form" onSubmit={(event) => { event.preventDefault(); void submit() }} noValidate>
      {!editing && (
        <SegmentedTabs
          label="Tipo de ocupación"
          stretch
          value={mode}
          onChange={setMode}
          items={[{ id: 'reservation', label: 'Reserva', icon: 'calendar' }, { id: 'block', label: 'Bloqueo', icon: 'lock' }]}
        />
      )}

      <fieldset className="form-block">
        <legend className="form-legend">Cancha</legend>
        <CourtPicker courts={courts} value={courtId} onChange={setCourtId} isBusy={(id) => Boolean(findConflict(state.occupations, { courtId: id, date, start, end }, editing?.id))} />
      </fieldset>

      <div className="form-row">
        <Field label="Fecha">{(id) => <TextInput id={id} type="date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} />}</Field>
        <Field label="Desde">{(id) => (
          <SelectInput id={id} value={start} onChange={(event) => changeStart(Number(event.target.value))}>
            {slots(7 * 60, DAY_CLOSE).map((slot) => <option key={slot} value={slot}>{hhmm(slot)}</option>)}
          </SelectInput>
        )}</Field>
      </div>

      <fieldset className="form-block">
        <legend className="form-legend">Duración</legend>
        <div className="chip-row">
          {LENGTHS.map((minutes) => (
            <Chip key={minutes} selected={!customEnd && length === minutes} disabled={start + minutes > DAY_CLOSE} onClick={() => setLength(minutes)}>
              {minutes === 60 ? '1 h' : minutes === 90 ? '1 h 30' : '2 h'}
            </Chip>
          ))}
          <Chip selected={customEnd} onClick={() => setCustomEnd(true)}>Otra</Chip>
        </div>
        {customEnd && (
          <Field label="Hasta">{(id) => (
            <SelectInput id={id} value={end} onChange={(event) => setEnd(Number(event.target.value))}>
              {slots(start + 30, DAY_CLOSE + 1).map((slot) => <option key={slot} value={slot}>{hhmm(slot)}</option>)}
            </SelectInput>
          )}</Field>
        )}
      </fieldset>

      {firstConflict?.hit && (
        <div className="inline-alert inline-alert-danger" role="alert">
          <Icon name="alert" size={20} />
          <div>
            <strong>{firstConflict.day === date ? `${court.name} está ocupada en ese horario` : `La serie choca el ${dayLong(firstConflict.day)}`}</strong>
            <p>{firstConflict.hit.title} · {range(firstConflict.hit)}. {occurrences.length > 1 ? 'No se crea ninguna reserva de la serie.' : ''}</p>
            {freeCourts.length > 0 && (
              <div className="chip-row">
                {freeCourts.slice(0, 3).map((item) => <Chip key={item.id} icon="check" onClick={() => setCourtId(item.id)}>{item.name} libre</Chip>)}
              </div>
            )}
          </div>
        </div>
      )}

      {mode === 'reservation' ? (
        <>
          <Field label="¿Quién juega?" hint={person ? undefined : 'Nombre libre o buscá una ficha existente. No hace falta que tenga cuenta.'} error={nameError}>
            {(id, describedBy) => (
              <div className="autocomplete">
                {person ? (
                  <div className="person-pill">
                    <Avatar name={person.name} size="sm" />
                    <span className="person-pill-name">{person.name}</span>
                    <MemberBadge person={person} />
                    <button type="button" className="link-btn" onClick={() => setPersonId(null)}>Usar nombre libre</button>
                  </div>
                ) : (
                  <TextInput
                    id={id}
                    icon="search"
                    value={name}
                    autoComplete="off"
                    placeholder="Ej.: Lucas Benítez"
                    aria-describedby={describedBy}
                    aria-invalid={Boolean(nameError)}
                    onFocus={() => setNameFocused(true)}
                    onBlur={() => window.setTimeout(() => setNameFocused(false), 150)}
                    onChange={(event) => setName(event.target.value)}
                    data-autofocus
                  />
                )}
                {suggestions.length > 0 && (
                  <ul className="autocomplete-list" role="listbox" aria-label="Fichas sugeridas">
                    {suggestions.map((item) => (
                      <li key={item.id}>
                        <button type="button" role="option" aria-selected={false} onMouseDown={(event) => event.preventDefault()} onClick={() => { setPersonId(item.id); setName(item.name) }}>
                          <Avatar name={item.name} size="sm" />
                          <span>{item.name}</span>
                          <MemberBadge person={item} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Field>
          {!editing && (
            <div className="form-block">
              <Switch checked={weekly} onChange={setWeekly} label="Repetir cada semana" description="Turno fijo. Cada ocurrencia se edita por separado." />
              {weekly && (
                <Field label="Última fecha" hint={`${occurrences.length} ${occurrences.length === 1 ? 'ocurrencia' : 'ocurrencias'} · máximo 12`}>
                  {(id, describedBy) => <TextInput id={id} type="date" min={date} value={until} aria-describedby={describedBy} onChange={(event) => event.target.value && setUntil(event.target.value)} />}
                </Field>
              )}
            </div>
          )}
        </>
      ) : (
        <fieldset className="form-block">
          <legend className="form-legend">Motivo</legend>
          <div className="chip-row">
            {BLOCK_REASONS.map((item) => <Chip key={item} selected={reason === item} onClick={() => setReason(item)}>{item}</Chip>)}
          </div>
          {reasonError && <p className="field-error"><Icon name="alert" size={14} />{reasonError}</p>}
        </fieldset>
      )}

      {showNote ? (
        <Field label="Observaciones" optional>{(id) => <TextArea id={id} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Visible solo para administración" />}</Field>
      ) : (
        <button type="button" className="link-btn link-btn-icon" onClick={() => setShowNote(true)}><Icon name="note" size={18} />Agregar observación</button>
      )}

      <div className="form-footer">
        {status === 'error' && (
          <div className="inline-alert inline-alert-danger" role="alert">
            <Icon name="alert" size={20} />
            <div><strong>No se pudo confirmar</strong><p>Revisá la conexión y reintentá. No se va a duplicar la reserva.</p></div>
          </div>
        )}
        <p className="form-summary">
          <Icon name="clock" size={16} />
          <span>{court.name} · {capitalize(weekdayShort(date))} {dateShort(date)} · <b className="num">{range({ start, end })}</b></span>
        </p>
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose} disabled={status === 'saving'}>Cancelar</Button>
          <Button type="submit" variant="accent" size="lg" icon={status === 'error' ? 'refresh' : 'check'} loading={status === 'saving'} disabled={!canSubmit}>
            {status === 'saving' ? 'Guardando…' : status === 'error' ? 'Reintentar' : editing ? 'Guardar cambios' : mode === 'block' ? 'Bloquear' : 'Confirmar reserva'}
          </Button>
        </div>
      </div>
    </form>
  )
}
