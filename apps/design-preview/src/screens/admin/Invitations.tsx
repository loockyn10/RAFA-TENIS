import { useState } from 'react'
import { groupCode, invitationStatus, makeCode, TODAY, type Invitation, type InvitationStatus } from '../../data/mock'
import { PersonPicker } from '../../components/domain'
import { Avatar, Badge, Button, Chip, ConfirmDialog, EmptyState, ErrorState, Icon, Modal, PageHead, SkeletonCards, StatStrip, type Tone } from '../../components/ui'
import { useAdmin } from '../../lib/admin'
import { useAction, useIntent, usePeople } from '../../lib/data'
import { plural } from '../../lib/format'
import { useProto, useScreenState } from '../../lib/proto'
import { useStore } from '../../lib/store'
import { addDays, dateShort, fromISO, hhmm } from '../../lib/time'

const STATUS: Record<InvitationStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pendiente', tone: 'info' },
  redeemed: { label: 'Usada', tone: 'success' },
  expired: { label: 'Vencida', tone: 'neutral' },
  revoked: { label: 'Revocada', tone: 'danger' },
}
const EXPIRY = [{ days: 1, label: '24 horas' }, { days: 3, label: '3 días' }, { days: 7, label: '7 días' }, { days: 30, label: '30 días' }]
const daysBetween = (from: string, to: string) => Math.round((fromISO(to).getTime() - fromISO(from).getTime()) / 86400000)

export function Invitations() {
  const { state } = useStore()
  const { dataState, retry } = useScreenState()
  const { byId, people } = usePeople()
  const { go } = useAdmin()
  const [filter, setFilter] = useState<InvitationStatus | 'all'>('pending')
  const [generate, setGenerate] = useState<{ personId?: string } | null>(null)
  const [revoking, setRevoking] = useState<Invitation | null>(null)
  const { dispatch } = useStore()
  const { notify } = useProto()
  const action = useAction()

  useIntent(['invite'], (intent) => setGenerate({ personId: intent.personId }))

  const invitations = dataState === 'empty' ? [] : state.invitations
  const count = (status: InvitationStatus) => invitations.filter((item) => invitationStatus(item) === status).length
  const list = invitations.filter((item) => filter === 'all' || invitationStatus(item) === filter).sort((a, b) => (a.createdOn < b.createdOn ? 1 : -1))
  const linked = people.filter((person) => person.hasAccount)
  const rules = state.bookingRules

  const revoke = () => revoking && void action.run(() => {
    dispatch({ type: 'invite/revoke', id: revoking.id })
    notify({ tone: 'success', title: 'Invitación revocada', body: `${byId(revoking.personId)?.name}: el código ya no sirve.` })
    setRevoking(null)
  })

  return (
    <div className="module">
      <PageHead eyebrow="Configuración" title="Portal de jugadores" meta={`${plural(linked.length, 'cuenta vinculada', 'cuentas vinculadas')} · reservas online ${rules.enabled ? 'habilitadas' : 'pausadas'}`} actions={<Button variant="accent" icon="key" onClick={() => setGenerate({})}>Generar invitación</Button>} />

      <ol className="how-steps" aria-label="Cómo funciona">
        <li><span className="how-n display">1</span><div><strong>Generás un código</strong><span>Para una ficha del club. Vence cuando elijas.</span></div></li>
        <li><span className="how-n display">2</span><div><strong>Lo compartís</strong><span>Por WhatsApp o en mano. Se muestra una sola vez.</span></div></li>
        <li><span className="how-n display">3</span><div><strong>La persona lo canjea</strong><span>Crea su cuenta y queda vinculada a su ficha.</span></div></li>
      </ol>

      <button type="button" className={`portal-status ${rules.enabled ? 'is-on' : ''}`} onClick={() => go('/admin/configuracion')}>
        <span className="settings-icon is-accent"><Icon name="portal" size={22} /></span>
        <span className="todo-text"><strong>Reservas online {rules.enabled ? 'habilitadas' : 'pausadas'}</strong><span>{rules.enabled ? `De ${hhmm(rules.opensAt)} a ${hhmm(rules.closesAt)} · hasta ${rules.maxAdvanceDays} días antes · máx. ${rules.maxActive} turnos` : 'Los jugadores ven sus turnos pero no pueden reservar.'}</span></span>
        <span className="link-btn">Ajustar reglas <Icon name="arrowRight" size={16} /></span>
      </button>

      <StatStrip label="Invitaciones" items={[
        { id: 'pending', label: 'Pendientes', value: count('pending'), tone: 'ball', selected: filter === 'pending', onClick: () => setFilter('pending') },
        { id: 'redeemed', label: 'Usadas', value: count('redeemed'), tone: 'green', selected: filter === 'redeemed', onClick: () => setFilter('redeemed') },
        { id: 'expired', label: 'Vencidas', value: count('expired'), selected: filter === 'expired', onClick: () => setFilter('expired') },
        { id: 'revoked', label: 'Revocadas', value: count('revoked'), tone: 'clay', selected: filter === 'revoked', onClick: () => setFilter('revoked') },
      ]} />

      {dataState === 'error' ? <ErrorState title="No pudimos cargar las invitaciones" onRetry={retry} />
        : dataState === 'loading' ? <SkeletonCards count={3} height={72} />
          : (
            <div className="invite-layout">
              <section className="stack" aria-label="Invitaciones">
                <div className="chip-row chip-row-scroll">
                  <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>Todas</Chip>
                  {(Object.keys(STATUS) as InvitationStatus[]).map((status) => <Chip key={status} selected={filter === status} count={count(status)} onClick={() => setFilter(status)}>{STATUS[status].label}</Chip>)}
                </div>
                {list.length === 0 ? (
                  <div className="card"><EmptyState icon="key" title={invitations.length === 0 ? 'Todavía no emitiste invitaciones' : 'Nada en este estado'} body="Las invitaciones permiten que un jugador vincule su cuenta con su ficha del club." action={<Button variant="accent" icon="key" onClick={() => setGenerate({})}>Generar invitación</Button>} /></div>
                ) : (
                  <ul className="list-card">
                    {list.map((invitation) => {
                      const person = byId(invitation.personId)
                      const status = invitationStatus(invitation)
                      const left = daysBetween(TODAY, invitation.expiresOn)
                      return (
                        <li key={invitation.id} className="invite-row">
                          <Avatar name={person?.name ?? '?'} />
                          <span className="due-item-main">
                            <strong>{person?.name}</strong>
                            <span>{status === 'pending' ? (left <= 0 ? 'Vence hoy' : `Vence en ${plural(left, 'día', 'días')} · ${dateShort(invitation.expiresOn)}`) : status === 'redeemed' ? `Usada el ${dateShort(invitation.redeemedOn!)}` : status === 'revoked' ? `Revocada el ${dateShort(invitation.revokedOn!)}` : `Venció el ${dateShort(invitation.expiresOn)}`} · emitida {dateShort(invitation.createdOn)}</span>
                          </span>
                          <Badge tone={STATUS[status].tone} dot>{STATUS[status].label}</Badge>
                          {status === 'pending' && <Button variant="ghost" size="sm" onClick={() => { action.reset(); setRevoking(invitation) }}>Revocar</Button>}
                          {(status === 'expired' || status === 'revoked') && !person?.hasAccount && <Button variant="ghost" size="sm" icon="refresh" onClick={() => setGenerate({ personId: invitation.personId })}>Nueva</Button>}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
              <aside className="card linked-card" aria-labelledby="linked">
                <h3 id="linked" className="detail-section-title">Cuentas vinculadas <span className="muted num">{linked.length}</span></h3>
                {linked.length === 0 ? <p className="muted">Nadie usa el portal todavía.</p> : (
                  <ul className="linked-list">
                    {linked.map((person) => <li key={person.id}><Avatar name={person.name} size="sm" /><span>{person.name}</span><Icon name="link" size={16} label="Cuenta vinculada" /></li>)}
                  </ul>
                )}
                <p className="detail-footnote"><Icon name="info" size={16} />Una ficha no es una cuenta: solo quien canjea una invitación accede a sus datos.</p>
              </aside>
            </div>
          )}

      <GenerateDialog request={generate} onClose={() => setGenerate(null)} />
      <ConfirmDialog open={revoking !== null} title="¿Revocar la invitación?" confirmLabel="Revocar" icon="x" status={action.status} onConfirm={revoke} onClose={() => setRevoking(null)}>
        <p className="muted">El código de <b>{byId(revoking?.personId)?.name}</b> deja de funcionar. Podés generar otro cuando quieras.</p>
      </ConfirmDialog>
    </div>
  )
}

function GenerateDialog({ request, onClose }: { request: { personId?: string } | null; onClose: () => void }) {
  const { state } = useStore()
  const [personId, setPersonId] = useState<string | null>(null)
  const chosen = request?.personId ?? personId
  const close = () => { setPersonId(null); onClose() }
  if (!request) return null
  if (!chosen) {
    return (
      <PersonPicker open title="¿Para quién es la invitación?" hint="La persona necesita una ficha activa." onClose={close} onPick={setPersonId}
        disabledReason={(person) => (person.hasAccount ? 'Ya usa el portal' : undefined)} />
    )
  }
  const pending = state.invitations.find((item) => item.personId === chosen && invitationStatus(item) === 'pending')
  return <GenerateBody key={chosen} personId={chosen} pending={pending} onClose={close} />
}

function GenerateBody({ personId, pending, onClose }: { personId: string; pending?: Invitation; onClose: () => void }) {
  const { dispatch } = useStore()
  const { notify } = useProto()
  const person = usePeople().byId(personId)
  const action = useAction()
  const [days, setDays] = useState(7)
  const [code, setCode] = useState<string | null>(null)
  const expiresOn = addDays(TODAY, days)
  const first = person?.name.split(' ')[0] ?? ''
  const message = code ? `Hola ${first}: este es tu código para el portal de jugadores de Rafa Tenis: ${groupCode(code)}. Creá tu cuenta y canjealo antes del ${dateShort(expiresOn)}. Es personal y sirve una sola vez.` : ''

  const create = () => void action.run(() => {
    const next = makeCode(Date.now() % 100000)
    dispatch({ type: 'invite/add', invitation: { id: `i-new-${Date.now()}`, personId, code: next, createdOn: TODAY, expiresOn } })
    setCode(next)
  }, 900)
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      notify({ tone: 'success', title: `${what} copiado`, body: 'Pegalo en WhatsApp o donde quieras.' })
    } catch {
      notify({ tone: 'info', title: 'No se pudo copiar automáticamente', body: 'Seleccioná el código y copialo a mano.' })
    }
  }

  if (person?.hasAccount) {
    return <Modal open onClose={onClose} size="sm" title={person.name}><EmptyState icon="link" title="Ya usa el portal" body="Su cuenta ya está vinculada a la ficha. No necesita invitación." /></Modal>
  }

  return (
    <Modal open onClose={onClose} busy={action.saving} size="sm" eyebrow="Invitación al portal" title={code ? 'Código listo' : person?.name ?? ''}
      footer={code ? (
        <div className="form-actions"><Button variant="secondary" icon="copy" onClick={() => void copy(message, 'Mensaje')}>Copiar mensaje</Button><Button variant="primary" icon="check" onClick={onClose}>Listo</Button></div>
      ) : (
        <div className="form-actions"><Button variant="ghost" onClick={onClose} disabled={action.saving}>Cancelar</Button><Button variant="accent" icon={action.failed ? 'refresh' : 'key'} loading={action.saving} onClick={create}>{action.failed ? 'Reintentar' : 'Generar código'}</Button></div>
      )}
    >
      {code ? (
        <div className="code-result">
          <p className="muted">Para <b>{person?.name}</b> · vence el {dateShort(expiresOn)}</p>
          <div className="code-box">
            <code className="num">{groupCode(code)}</code>
            <Button variant="secondary" size="sm" icon="copy" onClick={() => void copy(code, 'Código')}>Copiar</Button>
          </div>
          <p className="inline-alert inline-alert-warning"><Icon name="eyeOff" size={20} /><span><b>Copialo ahora:</b> por seguridad no se vuelve a mostrar. Si se pierde, generá otro.</span></p>
          <p className="detail-footnote"><Icon name="info" size={16} />Prototipo: podés probar el canje en «Acceso» con este código.</p>
        </div>
      ) : (
        <div className="res-form">
          <div className="invite-person"><Avatar name={person?.name ?? ''} size="lg" /><div><strong>{person?.name}</strong><span>{person?.phone ?? person?.email ?? 'Sin contacto cargado'}</span></div></div>
          {pending && <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span>Ya tiene una invitación vigente hasta el {dateShort(pending.expiresOn)}. Si generás otra, las dos sirven hasta que una se use o la revoques.</span></p>}
          <fieldset className="form-block">
            <legend className="form-legend">Vence en</legend>
            <div className="chip-row">{EXPIRY.map((item) => <Chip key={item.days} selected={days === item.days} onClick={() => setDays(item.days)}>{item.label}</Chip>)}</div>
            <p className="field-hint">Vence el {dateShort(expiresOn)}. Un código vencido no se puede usar.</p>
          </fieldset>
          {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se generó</strong><p>No se creó ningún código. Reintentá.</p></div></div>}
        </div>
      )}
    </Modal>
  )
}
