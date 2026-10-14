import { useState } from 'react'
import { KIND_LABEL, type Occupation } from '../../data/mock'
import { useCourts, usePeople } from '../../lib/data'
import { MemberBadge } from '../../components/domain'
import { useProto } from '../../lib/proto'
import { useStore } from '../../lib/store'
import { capitalize, dayLong, duration, range } from '../../lib/time'
import { Avatar, Badge, Button, Icon, Modal } from '../../components/ui'
import { KIND_TONE } from '../../lib/occupation'


export function OccupationDetail({ occupation, onClose, onEdit, onOpenSection }: { occupation: Occupation | null; onClose: () => void; onEdit: (occupation: Occupation) => void; onOpenSection: (occupation: Occupation) => void }) {
  const { dispatch } = useStore()
  const { simulate, notify } = useProto()
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')

  const close = () => {
    setConfirming(false)
    setStatus('idle')
    onClose()
  }

  const cancel = async () => {
    if (!occupation) return
    setStatus('saving')
    try {
      await simulate()
    } catch {
      setStatus('error')
      return
    }
    dispatch({ type: 'occ/cancel', id: occupation.id })
    notify({ tone: 'success', title: occupation.kind === 'block' ? 'Bloqueo levantado' : 'Reserva cancelada', body: 'La cancha quedó libre. El historial se conserva.' })
    close()
  }

  const court = useCourts().byId(occupation?.courtId)
  const person = usePeople().byId(occupation?.personId)
  const isGeneric = occupation?.kind === 'reservation' || occupation?.kind === 'block'

  return (
    <>
      <Modal open={occupation !== null && !confirming} onClose={close} variant="drawer" size="sm" eyebrow={occupation ? KIND_LABEL[occupation.kind] : ''} title={occupation?.title ?? ''}>
        {occupation && court && (
          <div className="detail">
            <div className={`detail-hero occ-${occupation.kind}`}>
              <span className="detail-time num">{range(occupation)}</span>
              <span>{court.name} · {capitalize(dayLong(occupation.date))} · {duration(occupation.end - occupation.start)}</span>
            </div>
            <dl className="detail-list">
              <div><dt>Tipo</dt><dd><Badge tone={KIND_TONE[occupation.kind]} dot>{KIND_LABEL[occupation.kind]}</Badge>{occupation.series && <Badge tone="info" icon="repeat">Turno fijo semanal</Badge>}</dd></div>
              {person && <div><dt>Ficha</dt><dd className="detail-person"><Avatar name={person.name} size="sm" />{person.name}<MemberBadge person={person} /></dd></div>}
              {occupation.kind === 'reservation' && !person && <div><dt>Ficha</dt><dd className="muted">Nombre libre, sin ficha vinculada</dd></div>}
              {occupation.coach && <div><dt>Profesor</dt><dd>{occupation.coach}</dd></div>}
              {occupation.capacity !== undefined && <div><dt>Alumnos</dt><dd className="num">{occupation.students} de {occupation.capacity}</dd></div>}
              {occupation.reason && <div><dt>Motivo</dt><dd>{occupation.reason}</dd></div>}
              {occupation.note && <div><dt>Observación</dt><dd>{occupation.note}</dd></div>}
            </dl>
            <p className="detail-footnote"><Icon name="info" size={16} />Reservar no genera un cobro. El uso y el pago se registran aparte.</p>
            <div className="detail-actions">
              {isGeneric ? (
                <>
                  <Button variant="primary" icon="edit" onClick={() => onEdit(occupation)}>Editar</Button>
                  <Button variant="danger" icon="x" onClick={() => setConfirming(true)}>{occupation.kind === 'block' ? 'Levantar bloqueo' : 'Cancelar reserva'}</Button>
                </>
              ) : (
                <Button variant="primary" iconRight="arrowRight" onClick={() => onOpenSection(occupation)}>
                  {occupation.kind === 'lesson' ? 'Gestionar en Escuela' : 'Gestionar en Torneos'}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={confirming}
        onClose={() => { if (status !== 'saving') { setConfirming(false); setStatus('idle') } }}
        size="sm"
        busy={status === 'saving'}
        title={occupation?.kind === 'block' ? '¿Levantar el bloqueo?' : '¿Cancelar esta reserva?'}
        footer={
          <div className="form-actions">
            <Button variant="ghost" onClick={() => { setConfirming(false); setStatus('idle') }} disabled={status === 'saving'}>Volver</Button>
            <Button variant="danger" icon={status === 'error' ? 'refresh' : 'x'} loading={status === 'saving'} onClick={() => void cancel()} data-autofocus>
              {status === 'error' ? 'Reintentar' : occupation?.kind === 'block' ? 'Levantar bloqueo' : 'Sí, cancelar'}
            </Button>
          </div>
        }
      >
        {occupation && court && (
          <div className="confirm-body">
            <p><b>{occupation.title}</b> · {court.name} · <span className="num">{range(occupation)}</span></p>
            <p className="muted">La cancha queda libre para otra reserva. {occupation.series ? 'Solo se cancela esta ocurrencia; el resto del turno fijo se mantiene.' : ''}</p>
            {status === 'error' && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se pudo cancelar</strong><p>La reserva sigue vigente. Probá de nuevo.</p></div></div>}
          </div>
        )}
      </Modal>
    </>
  )
}
