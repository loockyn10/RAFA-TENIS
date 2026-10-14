import { useState } from 'react'
import { courtShort, KIND_LABEL, NOW, SURFACES, TODAY, type Court } from '../../data/mock'
import { Badge, Button, Chip, ConfirmDialog, CourtMark, EmptyState, ErrorState, Field, Icon, IconButton, Modal, PageHead, SkeletonCards, Switch, TextInput } from '../../components/ui'
import { useAdmin } from '../../lib/admin'
import { busyMinutes, forDay, nextStartAfter, occupationAt } from '../../lib/agenda'
import { useAction, useCourts } from '../../lib/data'
import { plural } from '../../lib/format'
import { useProto, useScreenState } from '../../lib/proto'
import { useStore } from '../../lib/store'
import { DAY_CLOSE, DAY_OPEN, hhmm } from '../../lib/time'

const SURFACE_CLASS: Record<string, string> = { 'Polvo de ladrillo': 'clay', Cemento: 'hard', 'Césped sintético': 'grass', Carpeta: 'carpet' }
const surfaceClass = (surface: string) => SURFACE_CLASS[surface] ?? 'clay'

export function Courts() {
  const { state, dispatch } = useStore()
  const { dataState, retry } = useScreenState()
  const { courts } = useCourts()
  const { openReservation } = useAdmin()
  const [editing, setEditing] = useState<Court | null>(null)
  const [toggling, setToggling] = useState<Court | null>(null)
  const [ordering, setOrdering] = useState(false)
  const { notify } = useProto()
  const action = useAction()
  const list = dataState === 'empty' ? [] : courts
  const upcoming = (id: string) => state.occupations.filter((item) => item.courtId === id && (item.date > TODAY || (item.date === TODAY && item.end > NOW))).length

  const toggle = () => toggling && void action.run(() => {
    dispatch({ type: 'court/update', court: { ...toggling, active: !toggling.active } })
    notify({ tone: 'success', title: toggling.active ? `${toggling.name} desactivada` : `${toggling.name} activa`, body: toggling.active ? 'No admite reservas nuevas.' : 'Vuelve a aparecer en la agenda y en el portal.' })
    setToggling(null)
  })

  return (
    <div className="module">
      <PageHead
        eyebrow="Configuración"
        title="Canchas"
        meta={`${plural(list.length, 'cancha', 'canchas')} · ${plural(list.filter((court) => court.active).length, 'activa', 'activas')}`}
        actions={list.length > 1 && <Button variant={ordering ? 'primary' : 'secondary'} icon={ordering ? 'check' : 'swap'} onClick={() => setOrdering(!ordering)}>{ordering ? 'Listo' : 'Ordenar'}</Button>}
      />
      {ordering && <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span>El orden define cómo aparecen las canchas en la agenda, en el inicio y en el portal.</span></p>}

      {dataState === 'error' ? <ErrorState title="No pudimos cargar las canchas" onRetry={retry} />
        : dataState === 'loading' ? <SkeletonCards count={3} height={180} />
          : list.length === 0 ? <div className="card"><EmptyState icon="court" title="Sin canchas cargadas" body="Las canchas iniciales se crean en la puesta en marcha del club." /></div>
            : (
              <ul className={`court-grid ${ordering ? 'is-ordering' : ''}`}>
                {list.map((court, index) => {
                  const now = court.active ? occupationAt(state.occupations, court.id, TODAY, NOW) : undefined
                  const freeUntil = nextStartAfter(state.occupations, court.id, TODAY, NOW)
                  const today = forDay(state.occupations, TODAY, court.id).length
                  const usage = Math.round((busyMinutes(state.occupations, court.id, TODAY, DAY_OPEN, DAY_CLOSE) / (DAY_CLOSE - DAY_OPEN)) * 100)
                  return (
                    <li key={court.id} className={`court-card ${court.active ? '' : 'is-inactive'}`}>
                      <div className={`court-visual surface-${surfaceClass(court.surface)}`} aria-hidden="true">
                        <svg viewBox="0 0 240 120" preserveAspectRatio="none">
                          <rect x="14" y="12" width="212" height="96" />
                          <path d="M14 26h212M14 94h212M66 26v68M174 26v68M66 60h108M120 6v108" />
                        </svg>
                        <b className="display">{court.short}</b>
                        {!court.active && <span className="court-visual-off">Fuera de servicio</span>}
                      </div>
                      <div className="court-card-body">
                        <div className="court-card-title">
                          <strong>{court.name}</strong>
                          <Badge tone={court.active ? 'success' : 'neutral'} dot>{court.active ? 'Activa' : 'Inactiva'}</Badge>
                        </div>
                        <p className="court-card-surface">{court.surface}</p>
                        {court.active ? (
                          <p className="court-card-now">
                            {now ? <><span className="live-dot" aria-hidden="true" /><b>{now.kind === 'block' ? 'Bloqueada' : KIND_LABEL[now.kind]}</b> · {now.title} hasta {hhmm(now.end)}</>
                              : <><Icon name="checkCircle" size={16} /><b>Libre</b> {freeUntil >= DAY_CLOSE ? 'el resto del día' : `hasta ${hhmm(freeUntil)}`}</>}
                          </p>
                        ) : <p className="court-card-now muted"><Icon name="power" size={16} />{upcoming(court.id) ? plural(upcoming(court.id), 'ocupación cargada', 'ocupaciones cargadas') : 'Sin ocupaciones próximas'}</p>}
                        <div className="court-card-stats">
                          <span><b className="num">{today}</b> hoy</span>
                          <span className="court-usage" aria-label={`${usage}% de uso hoy`}><i style={{ width: `${usage}%` }} /></span>
                          <span className="num">{usage}%</span>
                        </div>
                      </div>
                      {ordering ? (
                        <div className="court-card-order">
                          <span className="num">Posición {index + 1}</span>
                          <IconButton icon="arrowUp" label={`Subir ${court.name}`} variant="secondary" disabled={index === 0} onClick={() => dispatch({ type: 'court/move', id: court.id, delta: -1 })} />
                          <IconButton icon="arrowDown" label={`Bajar ${court.name}`} variant="secondary" disabled={index === list.length - 1} onClick={() => dispatch({ type: 'court/move', id: court.id, delta: 1 })} />
                        </div>
                      ) : (
                        <div className="court-card-actions">
                          <Button variant="secondary" size="sm" icon="edit" onClick={() => setEditing(court)}>Editar</Button>
                          {court.active && <Button variant="ghost" size="sm" icon="calendar" onClick={() => openReservation({ date: TODAY, courtId: court.id })}>Reservar</Button>}
                          <Button variant="ghost" size="sm" icon={court.active ? 'power' : 'undo'} className="court-card-toggle" onClick={() => { action.reset(); setToggling(court) }}>{court.active ? 'Desactivar' : 'Activar'}</Button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

      <CourtForm court={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog open={toggling !== null} title={toggling?.active ? `¿Desactivar ${toggling.name}?` : `¿Activar ${toggling?.name}?`} confirmLabel={toggling?.active ? 'Desactivar' : 'Activar'} tone={toggling?.active ? 'danger' : 'primary'} icon="power" status={action.status} onConfirm={toggle} onClose={() => setToggling(null)}>
        {toggling?.active ? (
          <>
            <p className="muted">No se podrán cargar reservas, clases ni partidos nuevos en esta cancha, ni desde el portal.</p>
            {upcoming(toggling.id) > 0 && <p className="inline-alert inline-alert-warning"><Icon name="alert" size={20} /><span>Tiene <b>{plural(upcoming(toggling.id), 'ocupación próxima', 'ocupaciones próximas')}</b>. Se conservan: conviene reubicarlas desde la agenda.</span></p>}
          </>
        ) : <p className="muted">Vuelve a estar disponible en la agenda y en el portal de jugadores.</p>}
      </ConfirmDialog>
    </div>
  )
}

function CourtForm({ court, onClose }: { court: Court | null; onClose: () => void }) {
  return <Modal open={court !== null} onClose={onClose} variant="drawer" size="sm" eyebrow="Editar cancha" title={court?.name ?? ''}>{court && <CourtFormBody key={court.id} court={court} onClose={onClose} />}</Modal>
}

function CourtFormBody({ court, onClose }: { court: Court; onClose: () => void }) {
  const { dispatch } = useStore()
  const { notify } = useProto()
  const { courts } = useCourts()
  const action = useAction()
  const [name, setName] = useState(court.name)
  const [surface, setSurface] = useState(court.surface)
  const [active, setActive] = useState(court.active)
  const [touched, setTouched] = useState(false)
  const clean = name.trim().replace(/\s+/g, ' ')
  const duplicate = courts.some((item) => item.id !== court.id && item.name.toLowerCase() === clean.toLowerCase())
  const error = !touched ? undefined : clean.length < 2 ? 'Poné un nombre.' : duplicate ? 'Ya hay otra cancha con ese nombre.' : undefined
  const save = () => {
    setTouched(true)
    if (clean.length < 2 || duplicate) return
    void action.run(() => {
      dispatch({ type: 'court/update', court: { ...court, name: clean, short: courtShort(clean), surface, active } })
      notify({ tone: 'success', title: 'Cancha actualizada', body: `${clean} · ${surface}` })
      onClose()
    })
  }
  return (
    <div className="res-form">
      <div className="court-form-preview">
        <CourtMark label={courtShort(clean || court.name)} size="lg" tone={active ? 'clay' : 'muted'} />
        <div><strong>{clean || 'Sin nombre'}</strong><span>{surface} · {active ? 'Activa' : 'Inactiva'}</span></div>
      </div>
      <Field label="Nombre" error={error} hint="El número del nombre se usa como marca en la agenda.">{(id, describedBy) => <TextInput id={id} value={name} aria-invalid={Boolean(error)} aria-describedby={describedBy} onChange={(event) => setName(event.target.value)} data-autofocus />}</Field>
      <fieldset className="form-block">
        <legend className="form-legend">Superficie</legend>
        <div className="chip-row">{SURFACES.map((item) => <Chip key={item} selected={surface === item} onClick={() => setSurface(item)}>{item}</Chip>)}</div>
      </fieldset>
      <Switch checked={active} onChange={setActive} label="Cancha activa" description={active ? 'Admite reservas, clases y partidos.' : 'Queda fuera de servicio: no admite ocupaciones nuevas.'} />
      {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardó</strong><p>La cancha no cambió. Reintentá.</p></div></div>}
      <div className="form-actions">
        <Button variant="ghost" onClick={onClose} disabled={action.saving}>Cancelar</Button>
        <Button variant="primary" icon={action.failed ? 'refresh' : 'check'} loading={action.saving} onClick={save}>{action.failed ? 'Reintentar' : 'Guardar'}</Button>
      </div>
    </div>
  )
}
