import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club, Court, Reservation } from '../../types/domain'
import { OCCUPATION_FIELDS, CALENDAR_END_HOUR, CALENDAR_START_HOUR, isoToDateAndTime, shiftCalendarDate, sortReservations, todayInTimezone, zonedDateTimeToIso } from '../reservations/reservationUtils'
import { KIND_LABEL, courtShort, occupationKind, occupationTitle } from '../reservations/occupationView'
import { Badge, Button, Chip, ConfirmDialog, CourtMark, EmptyState, Field, Icon, IconButton, Modal, NumberStepper, PageHead, Switch, TextInput } from '../../design/ui'
import { plural } from '../../design/format'
import { toMinutes } from '../../design/dates'
import { useAsyncAction } from '../../design/useAsyncAction'

export type CourtPatch = Pick<Court, 'name' | 'surface' | 'active' | 'display_order'>

type CourtListProps = {
  courts: Court[]
  canManage: boolean
  onSave: (court: Court, patch: CourtPatch) => Promise<{ error?: string }>
  /** Ocupaciones de hoy (reservas reales). Sin ellas las tarjetas no muestran ocupación. */
  occupations?: Reservation[]
  timezone?: string
  onReserve?: (courtId: string) => void
}

const SURFACES = ['Polvo de ladrillo', 'Cemento', 'Césped sintético', 'Carpeta']
function surfaceClass(surface: string) {
  const text = surface.toLowerCase()
  return /cemento|hormig/.test(text) ? 'hard' : /césped|cesped|pasto/.test(text) ? 'grass' : /carpeta|sint/.test(text) ? 'carpet' : 'clay'
}

/** Minutos del día (zona del club) de un instante, acotados al día mostrado. */
function minutesIn(iso: string, timezone: string, day: string) {
  const parts = isoToDateAndTime(iso, timezone)
  return parts.date < day ? 0 : parts.date > day ? 24 * 60 : toMinutes(parts.time)
}

export function CourtList({ courts, canManage, onSave, occupations, timezone = 'America/Argentina/Buenos_Aires', onReserve }: CourtListProps) {
  const [editing, setEditing] = useState<Court | null>(null)
  const [toggling, setToggling] = useState<Court | null>(null)
  const [ordering, setOrdering] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const action = useAsyncAction()
  const list = [...courts].sort((first, second) => first.display_order - second.display_order || first.name.localeCompare(second.name, 'es'))
  const today = todayInTimezone(timezone)
  const now = Date.now()
  const dayOpen = CALENDAR_START_HOUR * 60
  const dayClose = CALENDAR_END_HOUR * 60

  const info = (court: Court) => {
    if (!occupations) return null
    const mine = occupations.filter((item) => item.court_id === court.id && item.status !== 'cancelled')
    const current = mine.find((item) => new Date(item.starts_at).getTime() <= now && now < new Date(item.ends_at).getTime())
    const next = mine.filter((item) => new Date(item.starts_at).getTime() > now).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]
    const busy = mine.reduce((sum, item) => sum + Math.max(0, Math.min(minutesIn(item.ends_at, timezone, today), dayClose) - Math.max(minutesIn(item.starts_at, timezone, today), dayOpen)), 0)
    return { current, next, count: mine.length, usage: Math.round((busy / (dayClose - dayOpen)) * 100) }
  }

  const toggle = () => toggling && void action.run(async () => {
    const result = await onSave(toggling, { name: toggling.name, surface: toggling.surface, active: !toggling.active, display_order: toggling.display_order })
    if (result.error) return result.error
    setNotice({ tone: 'success', text: toggling.active ? `${toggling.name} desactivada. No admite reservas nuevas.` : `${toggling.name} activa: vuelve a aparecer en la agenda.` })
    setToggling(null)
    return null
  })
  const move = async (index: number, delta: -1 | 1) => {
    const a = list[index]
    const b = list[index + delta]
    if (!a || !b) return
    // Intercambia el orden de dos canchas vecinas (display_order no es único); si coinciden, solo se desplaza la elegida.
    const patchFor = (court: Court, displayOrder: number): CourtPatch => ({ name: court.name, surface: court.surface, active: court.active, display_order: displayOrder })
    if (a.display_order === b.display_order) {
      const result = await onSave(a, patchFor(a, Math.max(1, a.display_order + delta)))
      setNotice(result.error ? { tone: 'danger', text: result.error } : null)
      return
    }
    const resultA = await onSave(a, patchFor(a, b.display_order))
    if (resultA.error) { setNotice({ tone: 'danger', text: resultA.error }); return }
    const resultB = await onSave(b, patchFor(b, a.display_order))
    setNotice(resultB.error ? { tone: 'danger', text: resultB.error } : null)
  }

  return (
    <div className="module">
      <PageHead
        eyebrow="Configuración"
        title="Canchas"
        meta={`${plural(list.length, 'cancha', 'canchas')} · ${plural(list.filter((court) => court.active).length, 'activa', 'activas')}${canManage ? '' : ' · solo consulta'}`}
        actions={canManage && list.length > 1 ? <Button variant={ordering ? 'primary' : 'secondary'} icon={ordering ? 'check' : 'swap'} onClick={() => setOrdering(!ordering)}>{ordering ? 'Listo' : 'Ordenar'}</Button> : undefined}
      />
      {ordering && <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span>El orden define cómo aparecen las canchas en la agenda, en el inicio y en el portal.</span></p>}
      {notice && <p className={`inline-alert ${notice.tone === 'danger' ? 'inline-alert-danger' : 'inline-alert-success'}`} role={notice.tone === 'danger' ? 'alert' : 'status'}><Icon name={notice.tone === 'danger' ? 'alert' : 'checkCircle'} size={20} /><span>{notice.text}</span></p>}

      {list.length === 0 ? <div className="card"><EmptyState icon="court" title="Sin canchas cargadas" body="Las canchas iniciales se crean en la puesta en marcha del club." /></div> : (
        <ul className={`court-grid ${ordering ? 'is-ordering' : ''}`}>
          {list.map((court, index) => {
            const data = court.active ? info(court) : null
            return (
              <li key={court.id} className={`court-card ${court.active ? '' : 'is-inactive'}`}>
                <div className={`court-visual surface-${surfaceClass(court.surface)}`} aria-hidden="true">
                  <svg viewBox="0 0 240 120" preserveAspectRatio="none">
                    <rect x="14" y="12" width="212" height="96" />
                    <path d="M14 26h212M14 94h212M66 26v68M174 26v68M66 60h108M120 6v108" />
                  </svg>
                  <b className="display">{courtShort(court)}</b>
                  {!court.active && <span className="court-visual-off">Fuera de servicio</span>}
                </div>
                <div className="court-card-body">
                  <div className="court-card-title">
                    <h3><strong>{court.name}</strong></h3>
                    <Badge tone={court.active ? 'success' : 'neutral'} dot>{court.active ? 'Activa' : 'Inactiva'}</Badge>
                  </div>
                  <p className="court-card-surface">{court.surface} · orden {court.display_order}</p>
                  {court.active && data ? (
                    <p className="court-card-now">
                      {data.current ? <><span className="live-dot" aria-hidden="true" /><b>{KIND_LABEL[occupationKind(data.current.occupation_type)]}</b> · {occupationTitle(data.current)} hasta {isoToDateAndTime(data.current.ends_at, timezone).time}</>
                        : <><Icon name="checkCircle" size={16} /><b>Libre</b> {data.next ? `hasta ${isoToDateAndTime(data.next.starts_at, timezone).time}` : 'el resto del día'}</>}
                    </p>
                  ) : !court.active ? <p className="court-card-now muted"><Icon name="power" size={16} />No admite ocupaciones nuevas</p> : null}
                  {court.active && data && (
                    <div className="court-card-stats">
                      <span><b className="num">{data.count}</b> hoy</span>
                      <span className="court-usage" role="img" aria-label={`${data.usage}% de uso hoy`}><i style={{ width: `${data.usage}%` }} /></span>
                      <span className="num">{data.usage}%</span>
                    </div>
                  )}
                </div>
                {ordering ? (
                  <div className="court-card-order">
                    <span className="num">Posición {index + 1}</span>
                    <IconButton icon="arrowUp" label={`Subir ${court.name}`} variant="secondary" disabled={index === 0} onClick={() => void move(index, -1)} />
                    <IconButton icon="arrowDown" label={`Bajar ${court.name}`} variant="secondary" disabled={index === list.length - 1} onClick={() => void move(index, 1)} />
                  </div>
                ) : canManage ? (
                  <div className="court-card-actions">
                    <Button variant="secondary" size="sm" icon="edit" aria-label={`Editar ${court.name}`} onClick={() => { setNotice(null); setEditing(court) }}>Editar</Button>
                    {court.active && onReserve && <Button variant="ghost" size="sm" icon="calendar" aria-label={`Reservar ${court.name}`} onClick={() => onReserve(court.id)}>Reservar</Button>}
                    <Button variant="ghost" size="sm" icon={court.active ? 'power' : 'undo'} className="court-card-toggle" aria-label={`${court.active ? 'Desactivar' : 'Activar'} ${court.name}`} onClick={() => { action.reset(); setToggling(court) }}>{court.active ? 'Desactivar' : 'Activar'}</Button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {!canManage && list.length > 0 && <p className="detail-footnote"><Icon name="lock" size={16} />Tu rol permite consultar la configuración. Propietario y administración pueden editar las canchas.</p>}

      {editing && <CourtForm court={editing} courts={list} onClose={() => setEditing(null)} onSave={onSave} onSaved={(name) => { setEditing(null); setNotice({ tone: 'success', text: `${name} guardada.` }) }} />}
      <ConfirmDialog open={toggling !== null} title={toggling?.active ? `¿Desactivar ${toggling.name}?` : `¿Activar ${toggling?.name}?`} confirmLabel={toggling?.active ? 'Desactivar' : 'Activar'} tone={toggling?.active ? 'danger' : 'primary'} icon="power" status={action.status} errorBody={action.message ?? undefined} onConfirm={toggle} onClose={() => setToggling(null)}>
        {toggling?.active ? (
          <>
            <p className="muted">No se podrán cargar reservas, clases ni partidos nuevos en esta cancha, ni desde el portal.</p>
            <p className="inline-alert inline-alert-warning"><Icon name="alert" size={20} /><span>Las ocupaciones ya cargadas se conservan: revisalas en la agenda y reubicalas si hace falta.</span></p>
          </>
        ) : <p className="muted">Vuelve a estar disponible en la agenda y en el portal de jugadores.</p>}
      </ConfirmDialog>
    </div>
  )
}

function CourtForm({ court, courts, onClose, onSave, onSaved }: { court: Court; courts: Court[]; onClose: () => void; onSave: CourtListProps['onSave']; onSaved: (name: string) => void }) {
  const [name, setName] = useState(court.name)
  const [surface, setSurface] = useState(court.surface)
  const [active, setActive] = useState(court.active)
  const [order, setOrder] = useState(court.display_order)
  const [touched, setTouched] = useState(false)
  const action = useAsyncAction()
  const clean = name.trim().replace(/\s+/g, ' ')
  const duplicate = courts.some((item) => item.id !== court.id && item.name.toLowerCase() === clean.toLowerCase())
  const error = !touched ? undefined : clean.length < 1 ? 'Poné un nombre.' : duplicate ? 'Ya hay otra cancha con ese nombre.' : surface.trim().length < 1 ? 'Indicá la superficie.' : undefined
  const save = () => {
    setTouched(true)
    if (clean.length < 1 || duplicate || surface.trim().length < 1) return
    void action.run(async () => {
      const result = await onSave(court, { name: clean, surface: surface.trim(), active, display_order: order })
      if (result.error) return result.error
      onSaved(clean)
      return null
    })
  }
  return (
    <Modal open onClose={onClose} busy={action.saving} variant="drawer" size="sm" eyebrow="Editar cancha" title={court.name}>
      <form className="res-form" noValidate onSubmit={(event) => { event.preventDefault(); save() }}>
        <div className="court-form-preview">
          <CourtMark label={courtShort({ name: clean || court.name })} size="lg" tone={active ? 'clay' : 'muted'} />
          <div><strong>{clean || 'Sin nombre'}</strong><span>{surface || 'Sin superficie'} · {active ? 'Activa' : 'Inactiva'}</span></div>
        </div>
        <Field label="Nombre" error={error && /nombre|cancha con/.test(error) ? error : undefined} hint="El número del nombre se usa como marca en la agenda.">{(id, describedBy) => <TextInput id={id} value={name} aria-invalid={Boolean(error)} aria-describedby={describedBy} onChange={(event) => setName(event.target.value)} data-autofocus />}</Field>
        <Field label="Superficie" error={error && /superficie/.test(error) ? error : undefined}>{(id, describedBy) => <TextInput id={id} value={surface} aria-describedby={describedBy} onChange={(event) => setSurface(event.target.value)} />}</Field>
        <div className="chip-row">{SURFACES.map((item) => <Chip key={item} selected={surface === item} onClick={() => setSurface(item)}>{item}</Chip>)}</div>
        <div className="field">
          <span className="field-label">Orden de aparición</span>
          <NumberStepper label="Orden" value={order} onChange={setOrder} min={1} max={99} unit={() => 'posición'} />
        </div>
        <Switch checked={active} onChange={setActive} label="Cancha activa" description={active ? 'Admite reservas, clases y partidos.' : 'Queda fuera de servicio: no admite ocupaciones nuevas.'} />
        {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardó</strong><p>{action.message}</p></div></div>}
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose} disabled={action.saving}>Cancelar</Button>
          <Button type="submit" variant="primary" icon={action.failed ? 'refresh' : 'check'} loading={action.saving}>{action.failed ? 'Reintentar' : 'Guardar cancha'}</Button>
        </div>
      </form>
    </Modal>
  )
}

/** Canchas con la ocupación real de hoy: mismas consultas y filtros que la agenda (solo lectura). */
export function CourtsPanel({ client, club, courts, canManage, onSave, onReserve }: { client: SupabaseClient; club: Club; courts: Court[]; canManage: boolean; onSave: CourtListProps['onSave']; onReserve?: (courtId: string) => void }) {
  const [occupations, setOccupations] = useState<Reservation[] | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const today = todayInTimezone(club.timezone)
      const startsAt = zonedDateTimeToIso(today, '00:00', club.timezone)
      const endsAt = zonedDateTimeToIso(shiftCalendarDate(today, 1), '00:00', club.timezone)
      const { data, error } = await client.from('reservations').select(OCCUPATION_FIELDS).eq('club_id', club.id).in('status', ['confirmed', 'active']).lt('starts_at', endsAt).gt('ends_at', startsAt)
      if (!cancelled) setOccupations(error ? undefined : sortReservations((data ?? []) as Reservation[]))
    }
    void load()
    return () => { cancelled = true }
  }, [client, club.id, club.timezone])
  return <CourtList courts={courts} canManage={canManage} onSave={onSave} occupations={occupations} timezone={club.timezone} onReserve={onReserve} />
}
