import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Avatar, Badge, Button, Chip, ConfirmDialog, EmptyState, ErrorState, Icon, Modal, PageHead, SkeletonCards, StatStrip, type Tone } from '../../design/ui'
import { PersonPicker, type PickerItem } from '../../design/domain'
import { dateShort } from '../../design/dates'
import { plural } from '../../design/format'
import { useAsyncAction } from '../../design/useAsyncAction'
import { usePersonSearch } from '../people/usePersonSearch'
import { isoToDateAndTime, todayInTimezone } from '../reservations/reservationUtils'
import { groupInvitationCode } from '../../auth/authUtils'
import type { Club, OnlineBookingSettings } from '../../types/domain'
import { EXPIRY_OPTIONS, expiryFromNow, invitationErrorMessage, invitationStatus, linkedPeople, type InvitationStatus, type PlayerInvitation } from './invitationUtils'

const STATUS: Record<InvitationStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pendiente', tone: 'info' },
  redeemed: { label: 'Usada', tone: 'success' },
  expired: { label: 'Vencida', tone: 'neutral' },
  revoked: { label: 'Revocada', tone: 'danger' },
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)

/** Portal de jugadores (administración): invitaciones de un solo uso. Usa las RPC `*_player_invitation(s)`; el servidor guarda solo el hash del código. */
export function PlayerAccessPanel({ client, club, onOpenSettings }: { client: SupabaseClient; club: Club; onOpenSettings?: () => void }) {
  const [invitations, setInvitations] = useState<PlayerInvitation[]>([])
  const [rules, setRules] = useState<OnlineBookingSettings | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [filter, setFilter] = useState<InvitationStatus | 'all'>('pending')
  const [picking, setPicking] = useState(false)
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null)
  const [revoking, setRevoking] = useState<PlayerInvitation | null>(null)
  const revokeAction = useAsyncAction()
  const search = usePersonSearch(client, club, picking)
  const today = todayInTimezone(club.timezone)

  const load = async () => {
    const [list, settings] = await Promise.all([
      client.rpc('list_player_invitations', { p_club_id: club.id }),
      client.rpc('get_online_booking_settings', { p_club_id: club.id }),
    ])
    if (list.error) { setStatus('error'); return }
    setInvitations((list.data ?? []) as PlayerInvitation[])
    setRules(settings.error ? null : (settings.data as OnlineBookingSettings))
    setStatus('ready')
  }
  useEffect(() => { setStatus('loading'); setInvitations([]); void load() }, [client, club.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const now = Date.now()
  const count = (state: InvitationStatus) => invitations.filter((item) => invitationStatus(item, now) === state).length
  const list = invitations.filter((item) => filter === 'all' || invitationStatus(item, now) === filter)
  const linked = useMemo(() => linkedPeople(invitations), [invitations])
  const linkedIds = useMemo(() => new Set(linked.map((person) => person.id)), [linked])
  const pendingByPerson = useMemo(() => new Set(invitations.filter((item) => invitationStatus(item, now) === 'pending').map((item) => item.person_id)), [invitations]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickerItems: PickerItem[] = search.results.map((person) => ({
    id: person.id,
    name: person.full_name,
    disabledReason: linkedIds.has(person.id) ? 'Ya usa el portal' : undefined,
    hint: pendingByPerson.has(person.id) ? 'Tiene una invitación vigente' : person.phone ?? person.email ?? undefined,
  }))
  const closeGenerate = () => { setPicking(false); setChosen(null); search.reset() }

  const revoke = () => {
    if (!revoking) return
    const target = revoking
    void revokeAction.run(async () => {
      const { error } = await client.rpc('revoke_player_invitation', { p_invitation_id: target.id })
      if (error) return 'No pudimos revocar la invitación.'
      setRevoking(null)
      await load()
      return null
    })
  }

  return (
    <div className="module">
      <PageHead
        eyebrow="Configuración"
        title="Portal de jugadores"
        meta={`${plural(linked.length, 'cuenta vinculada', 'cuentas vinculadas')}${rules ? ` · reservas online ${rules.enabled ? 'habilitadas' : 'pausadas'}` : ''}`}
        actions={<Button variant="accent" icon="key" onClick={() => { revokeAction.reset(); setPicking(true) }}>Generar invitación</Button>}
      />

      <ol className="how-steps" aria-label="Cómo funciona">
        <li><span className="how-n display">1</span><div><strong>Generás un código</strong><span>Para una ficha del club. Vence cuando elijas.</span></div></li>
        <li><span className="how-n display">2</span><div><strong>Lo compartís</strong><span>Por WhatsApp o en mano. Se muestra una sola vez.</span></div></li>
        <li><span className="how-n display">3</span><div><strong>La persona lo canjea</strong><span>Crea su cuenta y queda vinculada a su ficha.</span></div></li>
      </ol>

      {rules && onOpenSettings && (
        <button type="button" className={`portal-status ${rules.enabled ? 'is-on' : ''}`} onClick={onOpenSettings}>
          <span className="settings-icon is-accent"><Icon name="portal" size={22} /></span>
          <span className="todo-text"><strong>Reservas online {rules.enabled ? 'habilitadas' : 'pausadas'}</strong><span>{rules.enabled ? `De ${rules.opens_at.slice(0, 5)} a ${rules.closes_at.slice(0, 5)} · hasta ${plural(rules.max_advance_days, 'día', 'días')} antes · máx. ${plural(rules.max_active_reservations, 'turno', 'turnos')}` : 'Los jugadores ven sus turnos pero no pueden reservar.'}</span></span>
          <span className="link-btn">Ajustar reglas <Icon name="arrowRight" size={16} /></span>
        </button>
      )}

      <StatStrip label="Invitaciones" items={[
        { id: 'pending', label: 'Pendientes', value: count('pending'), tone: 'ball', selected: filter === 'pending', onClick: () => setFilter('pending') },
        { id: 'redeemed', label: 'Usadas', value: count('redeemed'), tone: 'green', selected: filter === 'redeemed', onClick: () => setFilter('redeemed') },
        { id: 'expired', label: 'Vencidas', value: count('expired'), selected: filter === 'expired', onClick: () => setFilter('expired') },
        { id: 'revoked', label: 'Revocadas', value: count('revoked'), tone: 'clay', selected: filter === 'revoked', onClick: () => setFilter('revoked') },
      ]} />

      {status === 'error' ? <ErrorState title="No pudimos cargar las invitaciones" onRetry={() => { setStatus('loading'); void load() }} />
        : status === 'loading' ? <SkeletonCards count={3} height={72} />
          : (
            <div className="invite-layout">
              <section className="stack" aria-label="Invitaciones">
                <div className="chip-row chip-row-scroll">
                  <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>Todas</Chip>
                  {(Object.keys(STATUS) as InvitationStatus[]).map((state) => <Chip key={state} selected={filter === state} count={count(state)} onClick={() => setFilter(state)}>{STATUS[state].label}</Chip>)}
                </div>
                {list.length === 0 ? (
                  <div className="card"><EmptyState icon="key" title={invitations.length === 0 ? 'Todavía no emitiste invitaciones' : 'Nada en este estado'} body="Las invitaciones permiten que un jugador vincule su cuenta con su ficha del club." action={<Button variant="accent" icon="key" onClick={() => setPicking(true)}>Generar invitación</Button>} /></div>
                ) : (
                  <ul className="list-card">
                    {list.map((invitation) => {
                      const state = invitationStatus(invitation, now)
                      const expiresOn = isoToDateAndTime(invitation.expires_at, club.timezone).date
                      const createdOn = isoToDateAndTime(invitation.created_at, club.timezone).date
                      const left = daysBetween(today, expiresOn)
                      return (
                        <li key={invitation.id} className="invite-row">
                          <Avatar name={invitation.person_name} />
                          <span className="due-item-main">
                            <strong>{invitation.person_name}</strong>
                            <span>{state === 'pending' ? (left <= 0 ? 'Vence hoy' : `Vence en ${plural(left, 'día', 'días')} · ${dateShort(expiresOn)}`) : state === 'redeemed' ? `Usada el ${dateShort(isoToDateAndTime(invitation.redeemed_at!, club.timezone).date)}` : state === 'revoked' ? `Revocada el ${dateShort(isoToDateAndTime(invitation.revoked_at!, club.timezone).date)}` : `Venció el ${dateShort(expiresOn)}`} · emitida {dateShort(createdOn)}</span>
                          </span>
                          <Badge tone={STATUS[state].tone} dot>{STATUS[state].label}</Badge>
                          {state === 'pending' && <Button variant="ghost" size="sm" onClick={() => { revokeAction.reset(); setRevoking(invitation) }}>Revocar</Button>}
                          {(state === 'expired' || state === 'revoked') && !linkedIds.has(invitation.person_id) && <Button variant="ghost" size="sm" icon="refresh" onClick={() => setChosen({ id: invitation.person_id, name: invitation.person_name })}>Nueva</Button>}
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
                    {linked.map((item) => <li key={item.id}><Avatar name={item.name} size="sm" /><span>{item.name}</span><Icon name="link" size={16} label="Cuenta vinculada" /></li>)}
                  </ul>
                )}
                <p className="detail-footnote"><Icon name="info" size={16} />Una ficha no es una cuenta: solo quien canjea una invitación accede a sus datos.</p>
              </aside>
            </div>
          )}

      <PersonPicker open={picking && !chosen} title="¿Para quién es la invitación?" hint="La persona necesita una ficha activa." items={pickerItems} query={search.query} onQueryChange={search.setQuery} loading={search.loading} onClose={closeGenerate} onPick={(id) => setChosen({ id, name: search.results.find((item) => item.id === id)?.full_name ?? '' })} />
      {chosen && <GenerateDialog key={chosen.id} client={client} club={club} personId={chosen.id} personName={chosen.name} hasPending={pendingByPerson.has(chosen.id)} onClose={closeGenerate} onCreated={() => void load()} />}
      <ConfirmDialog open={revoking !== null} title="¿Revocar la invitación?" confirmLabel="Revocar" icon="x" status={revokeAction.status} errorTitle="No se revocó" errorBody={revokeAction.message ?? 'El código sigue vigente. Probá de nuevo.'} onConfirm={revoke} onClose={() => setRevoking(null)}>
        <p className="muted">El código de <b>{revoking?.person_name}</b> deja de funcionar. Podés generar otro cuando quieras.</p>
      </ConfirmDialog>
    </div>
  )
}

function GenerateDialog({ client, club, personId, personName, hasPending, onClose, onCreated }: { client: SupabaseClient; club: Club; personId: string; personName: string; hasPending: boolean; onClose: () => void; onCreated: () => void }) {
  const [days, setDays] = useState<number>(7)
  const [created, setCreated] = useState<{ code: string; expiresAt: string } | null>(null)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  const action = useAsyncAction()
  const first = personName.trim().split(/\s+/)[0] ?? ''
  const expiresOn = isoToDateAndTime(created?.expiresAt ?? expiryFromNow(days), club.timezone).date
  const message = created ? `Hola ${first}: este es tu código para el portal de jugadores de ${club.name}: ${groupInvitationCode(created.code)}. Creá tu cuenta y canjealo antes del ${dateShort(expiresOn)}. Es personal y sirve una sola vez.` : ''

  const create = () => void action.run(async () => {
    const { data, error } = await client.rpc('create_player_invitation', { p_club_id: club.id, p_person_id: personId, p_expires_at: expiryFromNow(days) })
    if (error) return invitationErrorMessage(error)
    const result = data as { code: string; expires_at: string }
    setCreated({ code: result.code, expiresAt: result.expires_at })
    onCreated()
    return null
  })
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setCopyNotice(`${what} copiado. Pegalo en WhatsApp o donde quieras.`) }
    catch { setCopyNotice('No se pudo copiar automáticamente: seleccioná el código y copialo a mano.') }
  }

  return (
    <Modal open onClose={onClose} busy={action.saving} size="sm" eyebrow="Invitación al portal" title={created ? 'Código listo' : personName || 'Invitación'}
      footer={created ? (
        <div className="form-actions"><Button variant="secondary" icon="copy" onClick={() => void copy(message, 'Mensaje')}>Copiar mensaje</Button><Button variant="primary" icon="check" onClick={onClose}>Listo</Button></div>
      ) : (
        <div className="form-actions"><Button variant="ghost" onClick={onClose} disabled={action.saving}>Cancelar</Button><Button variant="accent" icon={action.failed ? 'refresh' : 'key'} loading={action.saving} onClick={create}>{action.failed ? 'Reintentar' : 'Generar código'}</Button></div>
      )}
    >
      {created ? (
        <div className="code-result">
          <p className="muted">Para <b>{personName}</b> · vence el {dateShort(expiresOn)}</p>
          <div className="code-box">
            <code className="num">{groupInvitationCode(created.code)}</code>
            <Button variant="secondary" size="sm" icon="copy" onClick={() => void copy(created.code, 'Código')}>Copiar</Button>
          </div>
          <p className="inline-alert inline-alert-warning"><Icon name="eyeOff" size={20} /><span><b>Copialo ahora:</b> por seguridad no se vuelve a mostrar. Si se pierde, generá otro.</span></p>
          {copyNotice && <p className="detail-footnote" role="status"><Icon name="info" size={16} />{copyNotice}</p>}
        </div>
      ) : (
        <div className="res-form">
          <div className="invite-person"><Avatar name={personName} size="lg" /><div><strong>{personName}</strong><span>Ficha activa del club</span></div></div>
          {hasPending && <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span>Ya tiene una invitación vigente. Si generás otra, la anterior se revoca automáticamente.</span></p>}
          <fieldset className="form-block">
            <legend className="form-legend">Vence en</legend>
            <div className="chip-row">{EXPIRY_OPTIONS.map((item) => <Chip key={item.days} selected={days === item.days} onClick={() => setDays(item.days)}>{item.label}</Chip>)}</div>
            <p className="field-hint">Vence el {dateShort(expiresOn)}. Un código vencido no se puede usar.</p>
          </fieldset>
          {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se generó</strong><p>{action.message}</p></div></div>}
        </div>
      )}
    </Modal>
  )
}
