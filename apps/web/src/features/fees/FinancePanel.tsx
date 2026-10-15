import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club, ClubFeeSettings, ClubMembershipRecord, ClubPerson, MembershipDue, MembershipDuePayment, PaymentMethod } from '../../types/domain'
import { UNCERTAIN_RESULT_MESSAGE } from '../../lib/idempotency'
import { recordDuePayment, type DuePaymentPayload } from './recordDuePayment'
import { balanceCents, displayDueStatus, DUE_STATUS_LABEL, firstDayOfMonth, formatMoney as formatArs, paidCents, parseArsToCents, periodLabel, periodShort, shiftPeriod, todayInClubTimezone, type DisplayDueStatus } from './feeUtils'
import { Avatar, Badge, Button, Chip, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Meter, Modal, MoneyInput, NumberStepper, PageHead, SegmentedTabs, SkeletonCards, TextArea, TextInput, type IconName, type Tone } from '../../design/ui'
import { MethodPicker, PersonPicker, type PickerItem } from '../../design/domain'
import { PAYMENT_LABELS } from '../../design/paymentLabels'
import { dateShort } from '../../design/dates'
import { moneyInputValue, normalizeSearch, plural } from '../../design/format'
import { useAsyncAction } from '../../design/useAsyncAction'

const dueFields = 'id, club_id, membership_id, period, amount_cents, due_date, created_at, created_by'
const paymentFields = 'id, club_id, due_id, amount_cents, payment_date, payment_method, reference, notes, created_at, created_by, voided_at, voided_by, void_reason'
const membershipFields = 'id, club_id, person_id, status, joined_on, created_at, updated_at'
const personFields = 'id, club_id, full_name, phone, email, notes, active, created_at, updated_at'

const STATUS_TONE: Record<DisplayDueStatus, Tone> = { paid: 'success', partial: 'warning', overdue: 'clay', pending: 'neutral' }
const METHOD_ICON: Record<PaymentMethod, IconName> = { cash: 'cash', bank_transfer: 'transfer', mercado_pago: 'qr', other: 'more' }
const METHOD_ORDER: PaymentMethod[] = ['cash', 'bank_transfer', 'mercado_pago', 'other']
const VOID_REASONS = ['Importe equivocado', 'Ficha equivocada', 'Pago duplicado', 'Otro motivo']

type Tab = 'month' | 'balances' | 'payments'
type StatusFilter = 'all' | 'open' | 'partial' | 'paid'

const currentMonth = (timezone: string) => todayInClubTimezone(timezone).slice(0, 7)
const methodLabel = (method: PaymentMethod) => PAYMENT_LABELS[method] ?? method
const warningText = (text: string) => <p className="inline-alert inline-alert-warning"><Icon name="alert" size={20} /><span>{text}</span></p>

// ── Registrar pago (total o parcial) ────────────────────────────────
type PaymentDialogProps = { due: MembershipDue; payments: MembershipDuePayment[]; personName?: string; today?: string; onClose: () => void; onSave: (payload: DuePaymentPayload) => Promise<string | null> }

/** Conserva el contrato de pagos de 10B.2: un único envío por intento y reintento del mismo pago ante resultado incierto. */
export function PaymentDialog({ due, payments, personName, today, onClose, onSave }: PaymentDialogProps) {
  const balance = balanceCents(due, payments)
  const [amount, setAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState(() => today ?? new Date().toISOString().slice(0, 10))
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [showExtra, setShowExtra] = useState(false)
  const [validation, setValidation] = useState<string | null>(null)
  const action = useAsyncAction()
  const cents = parseArsToCents(amount)
  const uncertain = action.message === UNCERTAIN_RESULT_MESSAGE
  const remaining = cents === null ? balance : Math.max(0, balance - cents)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!cents) return setValidation('Indicá un importe mayor a cero.')
    if (cents > balance) return setValidation(`Supera el saldo de la cuota (${formatArs(balance)}). No se aceptan pagos de más.`)
    setValidation(null)
    await action.run(() => onSave({ amountCents: cents, paymentDate, paymentMethod, reference, notes }))
  }

  return (
    <Modal open onClose={onClose} busy={action.saving} variant="drawer" size="sm" eyebrow="Registrar pago" title={personName ?? periodLabel(due.period)}>
      <form className="res-form" noValidate onSubmit={(event) => void submit(event)}>
        <div className="issue-summary">
          <div><span>Cuota</span><strong className="display num">{formatArs(due.amount_cents)}</strong></div>
          <div><span>Pagado</span><strong className="display num">{formatArs(paidCents(due.id, payments))}</strong></div>
          <div className="is-total"><span>Pendiente</span><strong className="display num">{formatArs(balance)}</strong></div>
        </div>
        <Field label="Importe recibido (ARS)" error={validation ?? undefined} hint="Podés registrar un pago parcial.">
          {(id, describedBy) => <MoneyInput id={id} value={amount} placeholder="Ej. 20.000" aria-invalid={Boolean(validation)} aria-describedby={describedBy} onChange={(event) => setAmount(event.target.value)} data-autofocus />}
        </Field>
        <div className="chip-row">
          <Chip selected={cents === balance} onClick={() => setAmount(moneyInputValue(balance))}>Saldo {formatArs(balance)}</Chip>
          {balance >= 200 && <Chip selected={cents === Math.round(balance / 2)} onClick={() => setAmount(moneyInputValue(Math.round(balance / 2)))}>Mitad</Chip>}
        </div>
        <fieldset className="form-block">
          <legend className="form-legend">Medio de pago</legend>
          <MethodPicker value={paymentMethod} onChange={setPaymentMethod} />
        </fieldset>
        <Field label="Fecha del pago">{(id) => <TextInput id={id} type="date" value={paymentDate} max={today} onChange={(event) => event.target.value && setPaymentDate(event.target.value)} required />}</Field>
        {showExtra ? (
          <>
            <Field label="Referencia" optional>{(id) => <TextInput id={id} value={reference} placeholder="N.º de transferencia" onChange={(event) => setReference(event.target.value)} />}</Field>
            <Field label="Observaciones" optional>{(id) => <TextArea id={id} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />}</Field>
          </>
        ) : <button type="button" className="link-btn link-btn-icon" onClick={() => setShowExtra(true)}><Icon name="note" size={18} />Agregar referencia u observaciones</button>}
        <div className="form-footer">
          {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se registró el pago</strong><p>{action.message}</p></div></div>}
          <p className="form-summary"><Icon name="wallet" size={16} />{cents === null ? <span>Ingresá el importe recibido</span> : cents > balance ? <span className="field-error">Supera el saldo de <b className="num">{formatArs(balance)}</b></span> : remaining === 0 ? <span>La cuota queda <b>saldada</b></span> : <span>Pago parcial · queda saldo de <b className="num">{formatArs(remaining)}</b></span>}</p>
          <div className="form-actions">
            <Button variant="ghost" disabled={action.saving} onClick={onClose}>Volver</Button>
            <Button type="submit" variant="accent" size="lg" icon={uncertain ? 'refresh' : 'check'} loading={action.saving}>{action.saving ? 'Registrando…' : uncertain ? 'Reintentar pago' : 'Registrar pago'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

// ── Anulación de un pago (con motivo, auditada en PostgreSQL) ───────
function VoidPaymentDialog({ client, payment, onClose, onVoided }: { client: SupabaseClient; payment: MembershipDuePayment | null; onClose: () => void; onVoided: () => Promise<void> }) {
  const [reason, setReason] = useState<string | null>(null)
  const [detail, setDetail] = useState('')
  const [touched, setTouched] = useState(false)
  const action = useAsyncAction()
  const text = reason === 'Otro motivo' ? detail.trim() : [reason, detail.trim()].filter(Boolean).join(' · ')
  const close = () => { setReason(null); setDetail(''); setTouched(false); action.reset(); onClose() }
  const confirm = () => {
    setTouched(true)
    if (!payment || text.length < 3) return
    void action.run(async () => {
      const { error } = await client.rpc('void_membership_due_payment', { p_payment_id: payment.id, p_reason: text })
      if (error) return 'No pudimos anular el pago. Puede que ya haya sido anulado.'
      close()
      await onVoided()
      return null
    })
  }
  return (
    <ConfirmDialog open={payment !== null} title="¿Anular este pago?" confirmLabel="Anular pago" icon="x" status={action.status} onConfirm={confirm} onClose={close} errorTitle="No se anuló el pago" errorBody={action.message ?? 'El pago sigue vigente. Probá de nuevo.'}>
      {payment && <p><b className="num">{formatArs(payment.amount_cents)}</b> · {methodLabel(payment.payment_method)} · {dateShort(payment.payment_date)}</p>}
      <fieldset className="form-block">
        <legend className="form-legend">Motivo</legend>
        <div className="chip-row">{VOID_REASONS.map((item) => <Chip key={item} selected={reason === item} onClick={() => setReason(item)}>{item}</Chip>)}</div>
        <Field label="Motivo obligatorio" optional={reason !== 'Otro motivo' && reason !== null} error={touched && text.length < 3 ? 'Indicá el motivo: queda registrado en el historial.' : undefined}>
          {(id, describedBy) => <TextArea id={id} value={detail} aria-describedby={describedBy} rows={2} onChange={(event) => setDetail(event.target.value)} placeholder="Ej.: se cargó dos veces el mismo pago" />}
        </Field>
      </fieldset>
      <p className="muted">El pago queda visible como anulado. No se elimina y el saldo de la cuota se recalcula.</p>
    </ConfirmDialog>
  )
}

// ── Detalle de cuota ────────────────────────────────────────────────
function DueDetail({ client, club, due, payments, personName, canPay, onClose, onPay, onRefresh }: { client: SupabaseClient; club: Club; due: MembershipDue; payments: MembershipDuePayment[]; personName?: string; canPay: boolean; onClose: () => void; onPay: () => void; onRefresh: () => Promise<void> }) {
  const [voiding, setVoiding] = useState<MembershipDuePayment | null>(null)
  const today = todayInClubTimezone(club.timezone)
  const status = displayDueStatus(due, payments, today)
  const paid = paidCents(due.id, payments)
  const balance = balanceCents(due, payments)
  const list = payments.filter((payment) => payment.due_id === due.id).sort((a, b) => (a.payment_date === b.payment_date ? b.created_at.localeCompare(a.created_at) : a.payment_date < b.payment_date ? 1 : -1))
  return (
    <>
      <Modal open={voiding === null} onClose={onClose} variant="drawer" size="sm" eyebrow={`Cuota · ${periodLabel(due.period)}`} title={personName ?? 'Socio'}
        footer={canPay && balance > 0 ? <div className="form-actions"><Button variant="ghost" onClick={onClose}>Cerrar</Button><Button variant="accent" icon="cash" onClick={onPay}>Registrar pago</Button></div> : undefined}
      >
        <div className="detail">
          <div className={`due-hero is-${status}`}>
            <div>
              <span className="kicker">{status === 'paid' ? 'Saldada' : 'Saldo'}</span>
              <strong className="display num">{formatArs(status === 'paid' ? due.amount_cents : balance)}</strong>
              <span>{status === 'paid' ? `Cuota de ${formatArs(due.amount_cents)} pagada` : `de ${formatArs(due.amount_cents)} · vence ${dateShort(due.due_date)}`}</span>
            </div>
            <Badge tone={STATUS_TONE[status]} icon={status === 'paid' ? 'check' : undefined}>{DUE_STATUS_LABEL[status]}</Badge>
            <Meter value={Math.min(paid, due.amount_cents)} max={due.amount_cents} label={`Pagado ${formatArs(paid)}`} tone={status === 'paid' ? 'green' : 'clay'} />
          </div>
          <section className="detail-section" aria-labelledby="dd-pay">
            <h3 id="dd-pay" className="detail-section-title">Historial de pagos</h3>
            {list.length === 0 ? <p className="muted">Todavía no hay pagos para esta cuota.</p> : (
              <ul className="pay-list">
                {list.map((payment) => (
                  <li key={payment.id} className={payment.voided_at ? 'is-voided' : ''}>
                    <span className="pay-row-icon"><Icon name={METHOD_ICON[payment.payment_method] ?? 'cash'} size={18} /></span>
                    <span className="pay-list-main">
                      <strong className="num">{formatArs(payment.amount_cents)}</strong>
                      <span>{dateShort(payment.payment_date)} · {methodLabel(payment.payment_method)}{payment.reference ? ` · Ref. ${payment.reference}` : ''}</span>
                      {payment.notes && <span>{payment.notes}</span>}
                      {payment.voided_at && <span className="pay-void-reason"><Icon name="info" size={14} />Anulado: {payment.void_reason}</span>}
                    </span>
                    {payment.voided_at ? <Badge tone="danger">Anulado</Badge> : canPay && <Button variant="ghost" size="sm" onClick={() => setVoiding(payment)}>Anular</Button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="detail-footnote"><Icon name="lock" size={16} />El importe de una cuota emitida no cambia aunque se modifique la cuota mensual. Los pagos no se borran: se anulan con motivo.</p>
        </div>
      </Modal>
      <VoidPaymentDialog client={client} payment={voiding} onClose={() => setVoiding(null)} onVoided={onRefresh} />
    </>
  )
}

// ── Estado de cuenta en la ficha del socio ──────────────────────────
export function MemberAccount({ client, club, membership, canManage }: { client: SupabaseClient; club: Club; membership?: ClubMembershipRecord; canManage: boolean }) {
  const [dues, setDues] = useState<MembershipDue[]>([])
  const [payments, setPayments] = useState<MembershipDuePayment[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const today = todayInClubTimezone(club.timezone)
  const load = async () => {
    if (!membership || !canManage) return
    setLoading(true)
    const { data: dueRows, error: dueError } = await client.from('membership_dues').select(dueFields).eq('club_id', club.id).eq('membership_id', membership.id).order('period', { ascending: false })
    if (dueError) { setFailure('No pudimos cargar el estado de cuenta.'); setLoading(false); return }
    const nextDues = (dueRows ?? []) as MembershipDue[]
    const { data: paymentRows, error: paymentError } = nextDues.length ? await client.from('membership_due_payments').select(paymentFields).eq('club_id', club.id).in('due_id', nextDues.map((due) => due.id)).order('payment_date', { ascending: false }) : { data: [], error: null }
    setDues(nextDues); setPayments(paymentError ? [] : (paymentRows ?? []) as MembershipDuePayment[]); setFailure(paymentError ? 'No pudimos cargar el historial de pagos.' : null); setLoading(false)
  }
  useEffect(() => { void load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, club.id, membership?.id, canManage])
  if (!membership || !canManage) return null
  const open = dues.filter((due) => balanceCents(due, payments) > 0)
  const total = open.reduce((sum, due) => sum + balanceCents(due, payments), 0)
  const payingDue = dues.find((due) => due.id === payingId) ?? null
  const detailDue = dues.find((due) => due.id === detailId) ?? null
  const recordPayment = async (payload: DuePaymentPayload) => {
    if (!payingDue) return 'No encontramos la cuota seleccionada.'
    const result = await recordDuePayment(client, club, payingDue, payload)
    if (!result.ok) return result.message
    setPayingId(null); setNotice(result.recovered ? 'El pago ya estaba registrado: lo recuperamos sin duplicarlo.' : 'Pago registrado.'); await load(); return null
  }
  return (
    <section className="detail-section" aria-labelledby="ma-title">
      <h3 id="ma-title" className="detail-section-title">Cuotas</h3>
      {loading && dues.length === 0 ? <p className="muted">Cargando cuotas…</p> : (
        <>
          <div className="balance-grid">
            <div className={`balance ${total ? 'is-due' : ''}`}>
              <span>Saldo de cuotas</span>
              <strong className="display num">{total ? formatArs(total) : 'Al día'}</strong>
              <small>{open.length ? plural(open.length, 'mes pendiente', 'meses pendientes') : dues.length ? 'Sin deuda' : 'Sin cuotas emitidas'}</small>
            </div>
          </div>
          {notice && <p className="inline-alert inline-alert-success" role="status"><Icon name="checkCircle" size={20} /><span>{notice}</span></p>}
          {failure && <p className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><span>{failure}</span></p>}
          {dues.length === 0 ? <p className="muted">No hay cuotas emitidas para este socio.</p> : (
            <ul className="mini-list">
              {dues.map((due) => {
                const status = displayDueStatus(due, payments, today)
                const balance = balanceCents(due, payments)
                return (
                  <li key={due.id}>
                    <span>{periodLabel(due.period)}</span>
                    <span className="num">{status === 'paid' ? formatArs(due.amount_cents) : `Resta ${formatArs(balance)}`}</span>
                    <Badge tone={STATUS_TONE[status]}>{DUE_STATUS_LABEL[status]}</Badge>
                    <span className="due-account-actions">
                      <Button variant="ghost" size="sm" onClick={() => setDetailId(due.id)}>Detalle</Button>
                      {balance > 0 && <Button variant="secondary" size="sm" icon="cash" onClick={() => setPayingId(due.id)}>Pagar</Button>}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
      {payingDue && <PaymentDialog due={payingDue} payments={payments} today={today} onClose={() => setPayingId(null)} onSave={recordPayment} />}
      {detailDue && <DueDetail client={client} club={club} due={detailDue} payments={payments} canPay onClose={() => setDetailId(null)} onPay={() => { setDetailId(null); setPayingId(detailDue.id) }} onRefresh={load} />}
    </section>
  )
}

// ── Pantalla de cuotas ──────────────────────────────────────────────
export function FinancePanel({ client, club, canManage }: { client: SupabaseClient; club: Club; canManage: boolean }) {
  const [settings, setSettings] = useState<ClubFeeSettings | null>(null)
  const [period, setPeriod] = useState(() => currentMonth(club.timezone))
  const [dues, setDues] = useState<MembershipDue[]>([])
  const [payments, setPayments] = useState<MembershipDuePayment[]>([])
  const [memberships, setMemberships] = useState<ClubMembershipRecord[]>([])
  const [people, setPeople] = useState<ClubPerson[]>([])
  const [tab, setTab] = useState<Tab>('month')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | 'all'>('all')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [pickingPayer, setPickingPayer] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [config, setConfig] = useState(false)
  const [pickingSingle, setPickingSingle] = useState(false)
  const [singleMembershipId, setSingleMembershipId] = useState<string | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const issueAction = useAsyncAction()
  const today = todayInClubTimezone(club.timezone)

  const loadDues = async (month: string) => {
    const monthStart = firstDayOfMonth(month)
    if (!monthStart) return
    const { data: dueRows, error: dueError } = await client.from('membership_dues').select(dueFields).eq('club_id', club.id).eq('period', monthStart).order('due_date').limit(500)
    if (dueError) { setNotice({ tone: 'danger', text: 'No pudimos cargar las cuotas emitidas.' }); return }
    const nextDues = (dueRows ?? []) as MembershipDue[]
    const { data: paymentRows, error: paymentError } = nextDues.length ? await client.from('membership_due_payments').select(paymentFields).eq('club_id', club.id).in('due_id', nextDues.map((due) => due.id)).order('payment_date', { ascending: false }).limit(1000) : { data: [], error: null }
    setDues(nextDues); setPayments(paymentError ? [] : (paymentRows ?? []) as MembershipDuePayment[])
    if (paymentError) setNotice({ tone: 'danger', text: 'No pudimos cargar algunos pagos de este período.' })
  }
  const load = async () => {
    setStatus('loading')
    const [{ data: settingRow, error: settingError }, { data: membershipRows, error: membershipError }, { data: peopleRows, error: peopleError }] = await Promise.all([
      client.from('club_fee_settings').select('club_id, monthly_amount_cents, due_day, currency, updated_at, updated_by').eq('club_id', club.id).maybeSingle(),
      client.from('club_memberships').select(membershipFields).eq('club_id', club.id).order('created_at'),
      client.from('club_people').select(personFields).eq('club_id', club.id).order('full_name'),
    ])
    if (settingError || membershipError || peopleError) { setStatus('error'); return }
    setSettings(settingRow as ClubFeeSettings | null)
    setMemberships((membershipRows ?? []) as ClubMembershipRecord[]); setPeople((peopleRows ?? []) as ClubPerson[])
    await loadDues(period); setStatus('ready')
  }
  useEffect(() => { void load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, club.id])
  useEffect(() => { if (status !== 'loading') void loadDues(period) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  const membershipById = useMemo(() => new Map(memberships.map((membership) => [membership.id, membership])), [memberships])
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people])
  const personForDue = (due: MembershipDue) => peopleById.get(membershipById.get(due.membership_id)?.person_id ?? '')
  const rows = dues.map((due) => ({ due, person: personForDue(due), state: displayDueStatus(due, payments, today), paid: paidCents(due.id, payments), balance: balanceCents(due, payments) }))
  const summary = rows.reduce((acc, row) => ({
    issued: acc.issued + 1, amount: acc.amount + row.due.amount_cents, collected: acc.collected + Math.min(row.paid, row.due.amount_cents), pending: acc.pending + row.balance,
    paid: acc.paid + (row.state === 'paid' ? 1 : 0), partial: acc.partial + (row.state === 'partial' ? 1 : 0), unpaid: acc.unpaid + (row.state === 'pending' || row.state === 'overdue' ? 1 : 0),
  }), { issued: 0, amount: 0, collected: 0, pending: 0, paid: 0, partial: 0, unpaid: 0 })
  const pct = summary.amount ? Math.round((summary.collected / summary.amount) * 100) : 0
  const term = normalizeSearch(query)
  const monthRows = rows
    .filter((row) => !term || normalizeSearch(row.person?.full_name ?? '').includes(term))
    .filter((row) => filter === 'all' || (filter === 'open' ? row.state === 'pending' || row.state === 'overdue' : row.state === filter))
    .sort((a, b) => {
      const order: Record<DisplayDueStatus, number> = { overdue: 0, pending: 1, partial: 2, paid: 3 }
      return order[a.state] - order[b.state] || (a.person?.full_name ?? '').localeCompare(b.person?.full_name ?? '', 'es')
    })
  const detailDue = dues.find((due) => due.id === detailId) ?? null
  const payingDue = dues.find((due) => due.id === payingId) ?? null
  const periods = useMemo(() => {
    const now = currentMonth(club.timezone)
    const list = Array.from({ length: 7 }, (_, index) => shiftPeriod(now, index - 5))
    return list.includes(period) ? list : [...list, period].sort()
  }, [club.timezone, period])

  const recordPayment = async (payload: DuePaymentPayload): Promise<string | null> => {
    if (!payingDue) return 'No encontramos la cuota seleccionada.'
    const result = await recordDuePayment(client, club, payingDue, payload)
    if (!result.ok) return result.message
    setPayingId(null); setNotice({ tone: 'success', text: result.recovered ? 'El pago ya estaba registrado: lo recuperamos sin duplicarlo.' : 'Pago registrado.' }); await loadDues(period); return null
  }
  const activeMembers = memberships.filter((membership) => membership.status === 'active')
  const withoutDue = activeMembers.filter((membership) => !dues.some((due) => due.membership_id === membership.id))
  const dueDay = settings?.due_day ?? 10
  const generate = () => void issueAction.run(async () => {
    const monthStart = firstDayOfMonth(period)
    if (!monthStart) return 'Elegí un período válido.'
    const { data, error } = await client.rpc('generate_membership_dues', { p_club_id: club.id, p_period: monthStart })
    if (error) return 'No pudimos generar cuotas. Verificá la configuración e intentá nuevamente.'
    const result = (data as Array<{ created_count: number; existing_count: number }> | null)?.[0]
    setNotice({ tone: 'success', text: `Cuotas generadas: ${result?.created_count ?? 0}. Ya existentes: ${result?.existing_count ?? 0}.` })
    setIssuing(false)
    await loadDues(period)
    return null
  })

  if (!canManage) return <div className="module"><div className="card"><EmptyState icon="lock" title="Las cuotas son privadas" body="Solo propietario y administradores pueden consultar información financiera." /></div></div>

  const payerItems: PickerItem[] = rows.filter((row) => row.balance > 0 && row.person).map((row) => ({ id: row.due.id, name: row.person?.full_name ?? 'Socio', hint: `Resta ${formatArs(row.balance)}` }))
    .filter((item) => !pickerQuery.trim() || normalizeSearch(item.name).includes(normalizeSearch(pickerQuery)))
  const singleItems: PickerItem[] = activeMembers.map((membership) => ({ id: membership.id, name: peopleById.get(membership.person_id)?.full_name ?? 'Socio', disabledReason: dues.some((due) => due.membership_id === membership.id) ? 'Ya tiene cuota de este período' : undefined }))
    .filter((item) => !pickerQuery.trim() || normalizeSearch(item.name).includes(normalizeSearch(pickerQuery)))

  return (
    <div className="module">
      <PageHead
        eyebrow="Club · solo propietario y administración"
        title="Cuotas"
        meta={settings ? <>Cuota mensual <b className="num">{formatArs(settings.monthly_amount_cents)}</b> · vence el día {settings.due_day}</> : 'Configurá el importe antes de emitir cuotas'}
        actions={<>
          <Button variant="secondary" icon="settings" onClick={() => setConfig(true)}>Configurar</Button>
          <Button variant="accent" icon="cash" disabled={rows.every((row) => row.balance === 0)} onClick={() => { setPickerQuery(''); setPickingPayer(true) }}>Registrar pago</Button>
        </>}
      />

      <div className="period-strip" role="listbox" aria-label="Período">
        {periods.map((item) => {
          const selected = item === period
          const ratio = selected && summary.amount ? summary.collected / summary.amount : 0
          return (
            <button key={item} type="button" role="option" aria-selected={selected} className={`period-chip ${selected ? 'is-selected' : ''} ${selected && status === 'ready' && !summary.issued ? 'is-empty' : ''}`} onClick={() => setPeriod(item)}>
              <span className="period-chip-month display">{periodShort(item)}</span>
              <span className="period-chip-year">{item.slice(0, 4)}</span>
              <span className="period-chip-bar" aria-hidden="true"><i style={{ width: `${Math.round(ratio * 100)}%` }} /></span>
              <span className="period-chip-foot">{selected ? (summary.issued ? `${Math.round(ratio * 100)}%` : status === 'ready' ? 'Sin emitir' : '…') : 'Ver período'}</span>
            </button>
          )
        })}
      </div>

      {notice && <p className={`inline-alert ${notice.tone === 'danger' ? 'inline-alert-danger' : 'inline-alert-success'}`} role={notice.tone === 'danger' ? 'alert' : 'status'}><Icon name={notice.tone === 'danger' ? 'alert' : 'checkCircle'} size={20} /><span>{notice.text}</span></p>}

      {status === 'error' ? <ErrorState title="No pudimos cargar las cuotas" onRetry={() => void load()} />
        : status === 'loading' ? <SkeletonCards count={4} height={84} />
          : (
            <>
              {summary.issued > 0 && (
                <section className="dues-hero texture-court" aria-label={`Cobranza de ${periodLabel(period)}`}>
                  <div className="dues-hero-main">
                    <p className="kicker kicker-on-dark">{periodLabel(period)} · cobrado</p>
                    <p className="dues-hero-amount display num">{formatArs(summary.collected)}<small> de {formatArs(summary.amount)}</small></p>
                    <Meter value={summary.collected} max={summary.amount} label={`${pct}% cobrado`} tone="ball" />
                  </div>
                  <dl className="dues-hero-counts">
                    <div><dt>Pagadas</dt><dd className="display num">{summary.paid}</dd></div>
                    <div><dt>Parciales</dt><dd className="display num">{summary.partial}</dd></div>
                    <div><dt>Sin pago</dt><dd className="display num">{summary.unpaid}</dd></div>
                    <div className="is-due"><dt>Saldo</dt><dd className="display num">{formatArs(summary.pending)}</dd></div>
                  </dl>
                </section>
              )}

              <div className="module-tabs">
                <SegmentedTabs label="Vista de cuotas" value={tab} onChange={setTab} items={[
                  { id: 'month', label: 'Del mes', icon: 'list' },
                  { id: 'balances', label: 'Saldos', icon: 'wallet' },
                  { id: 'payments', label: 'Pagos', icon: 'receipt' },
                ]} />
              </div>

              {tab === 'month' && (summary.issued === 0 ? (
                <div className="card">
                  <EmptyState icon="wallet" title={`Las cuotas de ${periodLabel(period)} no se emitieron`}
                    body={!settings ? 'Primero configurá el importe mensual y el día de vencimiento.' : 'Se crea una cuota por cada socio activo con el importe vigente. Nada se cobra automáticamente.'}
                    action={settings ? <Button variant="accent" icon="send" onClick={() => { issueAction.reset(); setIssuing(true) }}>Emitir cuotas de {periodLabel(period, false)}</Button> : <Button variant="accent" icon="settings" onClick={() => setConfig(true)}>Configurar cuota</Button>} />
                </div>
              ) : (
                <section className="stack" aria-label={`Cuotas de ${periodLabel(period)}`}>
                  <div className="list-toolbar">
                    <TextInput icon="search" type="search" placeholder="Buscar socio" aria-label="Buscar socio" value={query} onChange={(event) => setQuery(event.target.value)} />
                    <div className="chip-row chip-row-scroll" role="group" aria-label="Filtrar por estado">
                      <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>Todas</Chip>
                      <Chip selected={filter === 'open'} count={summary.unpaid} onClick={() => setFilter('open')}>Sin pago</Chip>
                      <Chip selected={filter === 'partial'} count={summary.partial} onClick={() => setFilter('partial')}>Parciales</Chip>
                      <Chip selected={filter === 'paid'} count={summary.paid} onClick={() => setFilter('paid')}>Pagadas</Chip>
                    </div>
                  </div>
                  {monthRows.length === 0 ? <div className="card"><EmptyState icon="search" title="Sin cuotas para este filtro" /></div> : (
                    <ul className="list-card" aria-label="Cuotas">
                      {monthRows.map(({ due, person, state, paid }) => (
                        <li key={due.id}>
                          <button type="button" className="due-item" onClick={() => setDetailId(due.id)}>
                            <Avatar name={person?.full_name ?? 'Socio'} />
                            <span className="due-item-main">
                              <strong>{person?.full_name ?? 'Socio'}</strong>
                              <span className="num">{state === 'paid' ? `Pagó ${formatArs(paid)}` : paid > 0 ? `Pagó ${formatArs(paid)} · resta ${formatArs(due.amount_cents - paid)}` : `Vence ${dateShort(due.due_date)}`}</span>
                            </span>
                            <span className="due-item-side">
                              <strong className="num">{formatArs(due.amount_cents)}</strong>
                              <Badge tone={STATUS_TONE[state]} icon={state === 'paid' ? 'check' : undefined}>{DUE_STATUS_LABEL[state]}</Badge>
                            </span>
                            <span className="due-item-bar" aria-hidden="true"><i className={`is-${state}`} style={{ width: `${Math.min(100, Math.round((paid / due.amount_cents) * 100))}%` }} /></span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button type="button" className="link-btn link-btn-icon" disabled={!settings} onClick={() => { setPickerQuery(''); setPickingSingle(true) }}><Icon name="plus" size={18} />Agregar cuota individual a un socio</button>
                  {withoutDue.length > 0 && settings && <button type="button" className="link-btn link-btn-icon" onClick={() => { issueAction.reset(); setIssuing(true) }}><Icon name="send" size={18} />Emitir cuotas faltantes ({plural(withoutDue.length, 'socio', 'socios')})</button>}
                </section>
              ))}

              {tab === 'balances' && <Balances rows={rows} period={period} onPay={(dueId) => setPayingId(dueId)} />}
              {tab === 'payments' && <Payments dues={dues} payments={payments} personForDue={personForDue} method={methodFilter} setMethod={setMethodFilter} onOpen={setDetailId} />}
              <p className="detail-footnote"><Icon name="info" size={16} />Los saldos y pagos son los del período elegido. El saldo total de un socio (todos los períodos) está en su ficha de Jugadores.</p>
            </>
          )}

      {detailDue && <DueDetail client={client} club={club} due={detailDue} payments={payments} personName={personForDue(detailDue)?.full_name} canPay onClose={() => setDetailId(null)} onPay={() => { setDetailId(null); setPayingId(detailDue.id) }} onRefresh={() => loadDues(period)} />}
      {payingDue && <PaymentDialog due={payingDue} payments={payments} personName={personForDue(payingDue)?.full_name} today={today} onClose={() => setPayingId(null)} onSave={recordPayment} />}
      <PersonPicker open={pickingPayer} title="¿Quién paga?" hint="Socios con saldo pendiente en este período." items={payerItems} query={pickerQuery} onQueryChange={setPickerQuery} onClose={() => setPickingPayer(false)} emptyBody="Nadie tiene saldo pendiente en este período." onPick={(dueId) => { setPickingPayer(false); setPayingId(dueId) }} />
      <PersonPicker open={pickingSingle} title={`Cuota individual · ${periodLabel(period)}`} hint="Solo socios activos." items={singleItems} query={pickerQuery} onQueryChange={setPickerQuery} onClose={() => setPickingSingle(false)} emptyBody="No hay socios activos." onPick={(membershipId) => { setPickingSingle(false); setSingleMembershipId(membershipId) }} />
      {singleMembershipId && <SingleDueDialog client={client} club={club} period={period} membership={membershipById.get(singleMembershipId)} personName={peopleById.get(membershipById.get(singleMembershipId)?.person_id ?? '')?.full_name} standardCents={settings?.monthly_amount_cents} onClose={() => setSingleMembershipId(null)} onCreated={async () => { setSingleMembershipId(null); setNotice({ tone: 'success', text: 'Cuota individual emitida.' }); await loadDues(period) }} />}
      <ConfirmDialog open={issuing} title={`Emitir cuotas de ${periodLabel(period)}`} confirmLabel={`Emitir ${plural(withoutDue.length, 'cuota', 'cuotas')}`} tone="accent" icon="send" status={issueAction.status} disabled={withoutDue.length === 0} onConfirm={generate} onClose={() => { issueAction.reset(); setIssuing(false) }} errorTitle="No se emitieron las cuotas" errorBody={issueAction.message ?? 'No se creó ninguna. Reintentar no duplica cuotas ya emitidas.'}>
        <div className="issue-summary">
          <div><span>Socios activos sin cuota</span><strong className="display num">{withoutDue.length}</strong></div>
          <div><span>Importe</span><strong className="display num">{settings ? formatArs(settings.monthly_amount_cents) : '—'}</strong></div>
          <div><span>Vencimiento</span><strong className="display num">{dateShort(`${period}-${String(dueDay).padStart(2, '0')}`)}</strong></div>
          <div className="is-total"><span>Total a emitir</span><strong className="display num">{settings ? formatArs(withoutDue.length * settings.monthly_amount_cents) : '—'}</strong></div>
        </div>
        <p className="muted">Quien ya tiene cuota de este período no recibe otra. Emitir no registra cobros ni suspende a nadie.</p>
        {withoutDue.length === 0 && warningText('Todos los socios activos ya tienen su cuota de este período.')}
      </ConfirmDialog>
      {config && <FeesDialog client={client} club={club} settings={settings} onClose={() => setConfig(false)} onSaved={(next) => { setSettings(next); setConfig(false); setNotice({ tone: 'success', text: 'Configuración de cuotas guardada.' }) }} />}
    </div>
  )
}

// ── Saldos del período ──────────────────────────────────────────────
type Row = { due: MembershipDue; person?: ClubPerson; state: DisplayDueStatus; paid: number; balance: number }

function Balances({ rows, period, onPay }: { rows: Row[]; period: string; onPay: (dueId: string) => void }) {
  const open = rows.filter((row) => row.balance > 0).sort((a, b) => b.balance - a.balance)
  const total = open.reduce((sum, row) => sum + row.balance, 0)
  if (open.length === 0) return <div className="card"><EmptyState icon="checkCircle" title={rows.length ? 'Nadie debe cuotas de este período' : 'No hay cuotas emitidas'} body={rows.length ? 'Todos los socios están al día.' : `Emití las cuotas de ${periodLabel(period)} para ver saldos.`} /></div>
  return (
    <section className="stack" aria-label="Saldos pendientes">
      <p className="muted">{plural(open.length, 'socio', 'socios')} con saldo · total <b className="num">{formatArs(total)}</b>. El saldo se calcula desde las cuotas y los pagos válidos.</p>
      <ul className="list-card">
        {open.map((row) => (
          <li key={row.due.id}>
            <button type="button" className="due-item" onClick={() => onPay(row.due.id)}>
              <Avatar name={row.person?.full_name ?? 'Socio'} />
              <span className="due-item-main"><strong>{row.person?.full_name ?? 'Socio'}</strong><span>{DUE_STATUS_LABEL[row.state]} · vence {dateShort(row.due.due_date)}</span></span>
              <span className="due-item-side"><strong className="num balance-amount">{formatArs(row.balance)}</strong><span className="link-btn">Cobrar</span></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ── Historial de pagos del período ──────────────────────────────────
function Payments({ dues, payments, personForDue, method, setMethod, onOpen }: { dues: MembershipDue[]; payments: MembershipDuePayment[]; personForDue: (due: MembershipDue) => ClubPerson | undefined; method: PaymentMethod | 'all'; setMethod: (method: PaymentMethod | 'all') => void; onOpen: (dueId: string) => void }) {
  const list = payments
    .filter((payment) => method === 'all' || payment.payment_method === method)
    .sort((a, b) => (a.payment_date === b.payment_date ? (a.created_at < b.created_at ? 1 : -1) : a.payment_date < b.payment_date ? 1 : -1))
  const valid = list.filter((payment) => !payment.voided_at).reduce((sum, payment) => sum + payment.amount_cents, 0)
  return (
    <section className="stack" aria-label="Pagos registrados">
      <div className="chip-row chip-row-scroll" role="group" aria-label="Filtrar por medio">
        <Chip selected={method === 'all'} onClick={() => setMethod('all')}>Todos</Chip>
        {METHOD_ORDER.map((item) => <Chip key={item} icon={METHOD_ICON[item]} selected={method === item} onClick={() => setMethod(item)}>{methodLabel(item)}</Chip>)}
      </div>
      <p className="muted">{plural(list.length, 'pago', 'pagos')} · válidos <b className="num">{formatArs(valid)}</b></p>
      {list.length === 0 ? <div className="card"><EmptyState icon="receipt" title={method === 'all' ? 'Todavía no hay pagos en este período' : 'Sin pagos con ese medio'} /></div> : (
        <ul className="list-card">
          {list.map((payment) => {
            const due = dues.find((item) => item.id === payment.due_id)
            const person = due ? personForDue(due) : undefined
            return (
              <li key={payment.id}>
                <button type="button" className={`pay-row ${payment.voided_at ? 'is-voided' : ''}`} onClick={() => due && onOpen(due.id)}>
                  <span className="pay-row-icon"><Icon name={METHOD_ICON[payment.payment_method] ?? 'cash'} size={20} /></span>
                  <span className="due-item-main">
                    <strong>{person?.full_name ?? 'Ficha'}</strong>
                    <span>{due ? periodLabel(due.period) : ''} · {methodLabel(payment.payment_method)}{payment.reference ? ` · ${payment.reference}` : ''}</span>
                  </span>
                  <span className="due-item-side">
                    <strong className="num">{formatArs(payment.amount_cents)}</strong>
                    {payment.voided_at ? <Badge tone="danger">Anulado</Badge> : <span className="muted num">{dateShort(payment.payment_date)}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ── Cuota individual ────────────────────────────────────────────────
function SingleDueDialog({ client, club, period, membership, personName, standardCents, onClose, onCreated }: { client: SupabaseClient; club: Club; period: string; membership?: ClubMembershipRecord; personName?: string; standardCents?: number; onClose: () => void; onCreated: () => Promise<void> }) {
  const [amount, setAmount] = useState('')
  const [touched, setTouched] = useState(false)
  const action = useAsyncAction()
  const custom = amount.trim() ? parseArsToCents(amount) : null
  const invalid = amount.trim() !== '' && custom === null
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTouched(true)
    const monthStart = firstDayOfMonth(period)
    if (!membership || !monthStart || invalid) return
    await action.run(async () => {
      const { error } = await client.rpc('create_individual_membership_due', { p_club_id: club.id, p_membership_id: membership.id, p_period: monthStart, p_amount_cents: custom })
      if (error) return 'No pudimos emitir la cuota individual. Puede que ya exista o que el socio no esté activo.'
      await onCreated()
      return null
    })
  }
  return (
    <Modal open onClose={onClose} busy={action.saving} size="sm" eyebrow={`Cuota individual · ${periodLabel(period)}`} title={personName ?? 'Socio'}>
      <form className="res-form" noValidate onSubmit={(event) => void submit(event)}>
        <Field label="Importe personalizado (ARS)" optional error={touched && invalid ? 'Ingresá un importe válido o dejalo vacío.' : undefined} hint={standardCents ? `Vacío usa el importe estándar (${formatArs(standardCents)}). No reemplaza una cuota existente.` : 'No reemplaza una cuota existente.'}>
          {(id, describedBy) => <MoneyInput id={id} value={amount} placeholder="Importe estándar" aria-invalid={touched && invalid} aria-describedby={describedBy} onChange={(event) => setAmount(event.target.value)} data-autofocus />}
        </Field>
        {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se emitió la cuota</strong><p>{action.message}</p></div></div>}
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose} disabled={action.saving}>Volver</Button>
          <Button type="submit" variant="primary" icon={action.failed ? 'refresh' : 'check'} loading={action.saving}>{action.failed ? 'Reintentar' : 'Emitir cuota'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ── Configuración mensual ───────────────────────────────────────────
export function FeesDialog({ client, club, settings, onClose, onSaved }: { client: SupabaseClient; club: Club; settings: ClubFeeSettings | null; onClose: () => void; onSaved: (settings: ClubFeeSettings) => void }) {
  const [amount, setAmount] = useState(settings ? moneyInputValue(settings.monthly_amount_cents) : '')
  const [day, setDay] = useState(settings?.due_day ?? 10)
  const [touched, setTouched] = useState(false)
  const action = useAsyncAction()
  const cents = parseArsToCents(amount)
  const invalid = cents === null
  const next = shiftPeriod(currentMonth(club.timezone), 1)
  const save = () => {
    setTouched(true)
    if (cents === null) return
    void action.run(async () => {
      const { data, error } = await client.rpc('set_club_fee_settings', { p_club_id: club.id, p_monthly_amount_cents: cents, p_due_day: day })
      if (error) return 'No pudimos guardar la configuración de cuotas.'
      onSaved(data as ClubFeeSettings)
      return null
    })
  }
  return (
    <Modal open onClose={onClose} busy={action.saving} size="sm" eyebrow="Configuración mensual" title="Cuota de socios">
      <div className="res-form">
        <Field label="Importe mensual (ARS)" error={touched && invalid ? 'Ingresá un importe mayor a cero.' : undefined}>{(id, describedBy) => <MoneyInput id={id} value={amount} placeholder="Ej. 35.000" aria-describedby={describedBy} aria-invalid={touched && invalid} onChange={(event) => setAmount(event.target.value)} data-autofocus />}</Field>
        <div className="field">
          <span className="field-label">Día de vencimiento</span>
          <NumberStepper label="Día de vencimiento" value={day} onChange={setDay} min={1} max={28} unit={() => 'de cada mes'} />
        </div>
        <div className="preview-card">
          <Icon name="info" size={18} />
          <p>Las cuotas de <b>{periodLabel(next, false)}</b> se emitirán por <b className="num">{cents === null ? '—' : formatArs(cents)}</b> con vencimiento el <b className="num">{String(day).padStart(2, '0')}/{next.slice(5)}</b>. Las cuotas ya emitidas conservan su importe.</p>
        </div>
        {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardó</strong><p>{action.message}</p></div></div>}
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose} disabled={action.saving}>Cancelar</Button>
          <Button variant="primary" icon={action.failed ? 'refresh' : 'check'} loading={action.saving} onClick={save}>{action.failed ? 'Reintentar' : settings ? 'Actualizar configuración' : 'Guardar configuración'}</Button>
        </div>
      </div>
    </Modal>
  )
}
