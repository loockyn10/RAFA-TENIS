import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club, ClubFeeSettings, ClubMembershipRecord, ClubPerson, MembershipDue, MembershipDuePayment, PaymentMethod } from '../../types/domain'
import { UNCERTAIN_RESULT_MESSAGE } from '../../lib/idempotency'
import { recordDuePayment } from './recordDuePayment'
import { balanceCents, dueStatus, firstDayOfMonth, formatArs, isOverdue, monthLabel, paidCents, parseArsToCents, todayInClubTimezone } from './feeUtils'

const dueFields = 'id, club_id, membership_id, period, amount_cents, due_date, created_at, created_by'
const paymentFields = 'id, club_id, due_id, amount_cents, payment_date, payment_method, reference, notes, created_at, created_by, voided_at, voided_by, void_reason'
const membershipFields = 'id, club_id, person_id, status, joined_on, created_at, updated_at'
const personFields = 'id, club_id, full_name, phone, email, notes, active, created_at, updated_at'
const methods: Array<{ value: PaymentMethod; label: string }> = [{ value: 'cash', label: 'Efectivo' }, { value: 'bank_transfer', label: 'Transferencia' }, { value: 'mercado_pago', label: 'Mercado Pago' }, { value: 'other', label: 'Otro' }]

function currentMonth(timezone: string) { return todayInClubTimezone(timezone).slice(0, 7) }
function statusLabel(status: ReturnType<typeof dueStatus>) { return status === 'paid' ? 'Pagada' : status === 'partial' ? 'Parcial' : 'Pendiente' }
function methodLabel(method: PaymentMethod) { return methods.find((item) => item.value === method)?.label ?? method }
function today() { return new Date().toISOString().slice(0, 10) }

type PaymentDialogProps = { due: MembershipDue; payments: MembershipDuePayment[]; onClose: () => void; onSave: (payload: { amountCents: number; paymentDate: string; paymentMethod: PaymentMethod; reference: string; notes: string }) => Promise<string | null> }
export function PaymentDialog({ due, payments, onClose, onSave }: PaymentDialogProps) {
  const [amount, setAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState(today)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const sendingRef = useRef(false)
  const balance = balanceCents(due, payments)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sendingRef.current) return
    const amountCents = parseArsToCents(amount)
    if (!amountCents) return setFeedback('Indicá un importe mayor a cero.')
    if (amountCents > balance) return setFeedback('El importe supera el saldo pendiente.')
    sendingRef.current = true; setSaving(true); setFeedback(null)
    const error = await onSave({ amountCents, paymentDate, paymentMethod, reference, notes })
    sendingRef.current = false; setSaving(false)
    setUncertain(error === UNCERTAIN_RESULT_MESSAGE)
    if (error) setFeedback(error)
  }
  return <div className="reservation-modal-backdrop" role="presentation"><section className="reservation-modal" role="dialog" aria-modal="true" aria-labelledby="payment-title">
    <div className="modal-heading"><div><p className="eyebrow">Pago de cuota</p><h2 id="payment-title">Registrar pago</h2></div><button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}>×</button></div>
    <div className="due-amounts"><span>Cuota: <strong>{formatArs(due.amount_cents)}</strong></span><span>Pagado: <strong>{formatArs(paidCents(due.id, payments))}</strong></span><span>Pendiente: <strong>{formatArs(balance)}</strong></span></div>
    <form className="reservation-form" onSubmit={(event) => void submit(event)}>
      <label>Importe recibido (ARS)<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Ej. 20.000" required autoFocus /></label>
      <label>Fecha del pago<input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required /></label>
      <label>Método de pago<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>{methods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
      <label>Referencia <span className="optional-label">(opcional)</span><input value={reference} onChange={(event) => setReference(event.target.value)} /></label>
      <label>Observaciones <span className="optional-label">(opcional)</span><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      {feedback && <p className="form-error" role="alert">{feedback}</p>}
      <div className="modal-actions"><button className="secondary-button" type="button" disabled={saving} onClick={onClose}>Volver</button><button type="submit" disabled={saving}>{saving ? 'Registrando…' : uncertain ? 'Reintentar pago' : 'Registrar pago'}</button></div>
    </form>
  </section></div>
}

function PaymentsHistory({ payments, onVoid }: { payments: MembershipDuePayment[]; onVoid?: (payment: MembershipDuePayment) => void }) {
  if (payments.length === 0) return <p className="field-help">Todavía no hay pagos registrados.</p>
  return <ul className="payment-history">{payments.map((payment) => <li key={payment.id} className={payment.voided_at ? 'voided-payment' : ''}><div><strong>{formatArs(payment.amount_cents)}</strong> · {payment.payment_date} · {methodLabel(payment.payment_method)}{payment.reference && <small>Ref.: {payment.reference}</small>}{payment.notes && <small>{payment.notes}</small>}{payment.voided_at && <small>Anulado: {payment.void_reason}</small>}</div>{onVoid && !payment.voided_at && <button className="secondary-button" type="button" onClick={() => onVoid(payment)}>Anular</button>}</li>)}</ul>
}

function DueRow({ due, person, payments, timezone, onPayment, onDetail }: { due: MembershipDue; person?: ClubPerson; payments: MembershipDuePayment[]; timezone: string; onPayment: () => void; onDetail: () => void }) {
  const status = dueStatus(due, payments)
  const overdue = isOverdue(due, payments, todayInClubTimezone(timezone))
  return <article className="due-row"><div><strong>{person?.full_name ?? 'Socio'}</strong><span>{monthLabel(due.period, timezone)} · vence {due.due_date}</span></div><div className="due-row-amounts"><span className={`due-status ${status}`}>{statusLabel(status)}</span>{overdue && <span className="due-status overdue">Vencida</span>}<strong>{formatArs(balanceCents(due, payments))}</strong><small>de {formatArs(due.amount_cents)}</small></div><div className="due-actions"><button className="secondary-button" type="button" onClick={onDetail}>Detalle</button><button type="button" disabled={balanceCents(due, payments) === 0} onClick={onPayment}>Registrar pago</button></div></article>
}

function DueDetailDialog({ client, club, due, payments, onClose, onRefresh }: { client: SupabaseClient; club: Club; due: MembershipDue; payments: MembershipDuePayment[]; onClose: () => void; onRefresh: () => Promise<void> }) {
  const [voiding, setVoiding] = useState<MembershipDuePayment | null>(null)
  const [reason, setReason] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const voidPayment = async () => {
    if (!voiding || !reason.trim()) { setFeedback('Indicá el motivo de la anulación.'); return }
    setSaving(true)
    const { error } = await client.rpc('void_membership_due_payment', { p_payment_id: voiding.id, p_reason: reason.trim() })
    setSaving(false)
    if (error) { setFeedback('No pudimos anular el pago. Puede que ya haya sido anulado.'); return }
    setVoiding(null); setReason(''); setFeedback('Pago anulado.'); await onRefresh()
  }
  const duePayments = payments.filter((payment) => payment.due_id === due.id)
  return <div className="reservation-modal-backdrop" role="presentation"><section className="reservation-modal" role="dialog" aria-modal="true" aria-labelledby="due-detail-title"><div className="modal-heading"><div><p className="eyebrow">Cuota</p><h2 id="due-detail-title">{monthLabel(due.period, club.timezone)}</h2></div><button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}>×</button></div><div className="due-amounts"><span>Emitida: <strong>{formatArs(due.amount_cents)}</strong></span><span>Pagada: <strong>{formatArs(paidCents(due.id, payments))}</strong></span><span>Pendiente: <strong>{formatArs(balanceCents(due, payments))}</strong></span></div><h3>Historial de pagos</h3><PaymentsHistory payments={duePayments} onVoid={setVoiding} />{voiding && <div className="void-form"><h3>Anular pago de {formatArs(voiding.amount_cents)}</h3><label>Motivo obligatorio<textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} autoFocus /></label>{feedback && <p className="form-error" role="alert">{feedback}</p>}<div className="modal-actions"><button className="secondary-button" type="button" disabled={saving} onClick={() => { setVoiding(null); setReason(''); setFeedback(null) }}>Volver</button><button className="danger-button" type="button" disabled={saving} onClick={() => void voidPayment()}>{saving ? 'Anulando…' : 'Confirmar anulación'}</button></div></div>}{feedback && !voiding && <p className="form-success" role="status">{feedback}</p>}</section></div>
}

export function MemberAccount({ client, club, membership, canManage }: { client: SupabaseClient; club: Club; membership?: ClubMembershipRecord; canManage: boolean }) {
  const [dues, setDues] = useState<MembershipDue[]>([])
  const [payments, setPayments] = useState<MembershipDuePayment[]>([])
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [payingDue, setPayingDue] = useState<MembershipDue | null>(null)
  const [detailDue, setDetailDue] = useState<MembershipDue | null>(null)
  const load = async () => {
    if (!membership || !canManage) return
    setLoading(true)
    const { data: dueRows, error: dueError } = await client.from('membership_dues').select(dueFields).eq('club_id', club.id).eq('membership_id', membership.id).order('period', { ascending: false })
    if (dueError) { setFeedback('No pudimos cargar el estado de cuenta.'); setLoading(false); return }
    const nextDues = (dueRows ?? []) as MembershipDue[]
    const { data: paymentRows, error: paymentError } = nextDues.length ? await client.from('membership_due_payments').select(paymentFields).eq('club_id', club.id).in('due_id', nextDues.map((due) => due.id)).order('payment_date', { ascending: false }) : { data: [], error: null }
    setDues(nextDues); setPayments(paymentError ? [] : (paymentRows ?? []) as MembershipDuePayment[]); setFeedback(paymentError ? 'No pudimos cargar el historial de pagos.' : null); setLoading(false)
  }
  useEffect(() => { void load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, club.id, membership?.id, canManage])
  if (!membership || !canManage) return null
  const total = dues.reduce((sum, due) => sum + balanceCents(due, payments), 0)
  const recordPayment = async (payload: { amountCents: number; paymentDate: string; paymentMethod: PaymentMethod; reference: string; notes: string }) => {
    if (!payingDue) return 'No encontramos la cuota seleccionada.'
    const result = await recordDuePayment(client, club, payingDue, payload)
    if (!result.ok) return result.message
    setPayingDue(null); setFeedback(result.recovered ? 'El pago ya estaba registrado: lo recuperamos sin duplicarlo.' : 'Pago registrado.'); await load(); return null
  }
  return <section className="member-account"><h3>Estado de cuenta</h3>{loading ? <p className="field-help">Cargando cuotas…</p> : <><p className="account-total">Saldo total: <strong>{formatArs(total)}</strong></p>{feedback && <p className="form-success" role="status">{feedback}</p>}{dues.length === 0 ? <p className="field-help">No hay cuotas emitidas para este socio.</p> : <div className="account-dues">{dues.map((due) => <div key={due.id}><DueRow due={due} payments={payments} timezone={club.timezone} onPayment={() => setPayingDue(due)} onDetail={() => setDetailDue(due)} /></div>)}</div>}</>}{payingDue && <PaymentDialog due={payingDue} payments={payments} onClose={() => setPayingDue(null)} onSave={recordPayment} />}{detailDue && <DueDetailDialog client={client} club={club} due={detailDue} payments={payments} onClose={() => setDetailDue(null)} onRefresh={load} />}</section>
}

export function FinancePanel({ client, club, canManage }: { client: SupabaseClient; club: Club; canManage: boolean }) {
  const [settings, setSettings] = useState<ClubFeeSettings | null>(null)
  const [amount, setAmount] = useState('')
  const [dueDay, setDueDay] = useState('10')
  const [period, setPeriod] = useState(() => currentMonth(club.timezone))
  const [dues, setDues] = useState<MembershipDue[]>([])
  const [payments, setPayments] = useState<MembershipDuePayment[]>([])
  const [memberships, setMemberships] = useState<ClubMembershipRecord[]>([])
  const [people, setPeople] = useState<ClubPerson[]>([])
  const [filter, setFilter] = useState<'all' | 'paid' | 'partial' | 'pending' | 'overdue'>('all')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [payingDue, setPayingDue] = useState<MembershipDue | null>(null)
  const [detailDue, setDetailDue] = useState<MembershipDue | null>(null)
  const [showIndividual, setShowIndividual] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [individualMembershipId, setIndividualMembershipId] = useState('')
  const [individualAmount, setIndividualAmount] = useState('')

  const load = async () => {
    setStatus('loading')
    const [{ data: settingRow, error: settingError }, { data: membershipRows, error: membershipError }, { data: peopleRows, error: peopleError }] = await Promise.all([
      client.from('club_fee_settings').select('club_id, monthly_amount_cents, due_day, currency, updated_at, updated_by').eq('club_id', club.id).maybeSingle(),
      client.from('club_memberships').select(membershipFields).eq('club_id', club.id).order('created_at'),
      client.from('club_people').select(personFields).eq('club_id', club.id).order('full_name'),
    ])
    if (settingError || membershipError || peopleError) { setFeedback('No pudimos cargar la información de cuotas de este club.'); setStatus('error'); return }
    const nextSettings = settingRow as ClubFeeSettings | null
    setSettings(nextSettings); setShowSettings((current) => current || !nextSettings); setAmount(nextSettings ? String(nextSettings.monthly_amount_cents / 100).replace('.', ',') : ''); setDueDay(String(nextSettings?.due_day ?? 10))
    const nextMemberships = (membershipRows ?? []) as ClubMembershipRecord[]; setMemberships(nextMemberships); setPeople((peopleRows ?? []) as ClubPerson[])
    await loadDues(period); setStatus('ready')
  }
  const loadDues = async (month: string) => {
    const monthStart = firstDayOfMonth(month)
    if (!monthStart) return
    const { data: dueRows, error: dueError } = await client.from('membership_dues').select(dueFields).eq('club_id', club.id).eq('period', monthStart).order('due_date').limit(500)
    if (dueError) { setFeedback('No pudimos cargar las cuotas emitidas.'); return }
    const nextDues = (dueRows ?? []) as MembershipDue[]
    const { data: paymentRows, error: paymentError } = nextDues.length ? await client.from('membership_due_payments').select(paymentFields).eq('club_id', club.id).in('due_id', nextDues.map((due) => due.id)).order('payment_date', { ascending: false }).limit(1000) : { data: [], error: null }
    setDues(nextDues); setPayments(paymentError ? [] : (paymentRows ?? []) as MembershipDuePayment[])
    if (paymentError) setFeedback('No pudimos cargar algunos pagos de este período.')
  }
  useEffect(() => { void load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, club.id])
  useEffect(() => { if (status !== 'loading') void loadDues(period) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])
  const membershipById = useMemo(() => new Map(memberships.map((membership) => [membership.id, membership])), [memberships])
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people])
  const personForDue = (due: MembershipDue) => peopleById.get(membershipById.get(due.membership_id)?.person_id ?? '')
  const visibleDues = dues.filter((due) => {
    const todayInClub = todayInClubTimezone(club.timezone)
    const currentStatus = dueStatus(due, payments)
    const matchesFilter = filter === 'all' || filter === 'overdue' && isOverdue(due, payments, todayInClub) || currentStatus === filter
    const person = personForDue(due)
    return matchesFilter && (!search.trim() || person?.full_name.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es')))
  })
  const totals = dues.reduce((result, due) => { const balance = balanceCents(due, payments); const currentStatus = dueStatus(due, payments); result.issued += due.amount_cents; result.collected += due.amount_cents - balance; result.balance += balance; result[currentStatus] += 1; return result }, { issued: 0, collected: 0, balance: 0, paid: 0, partial: 0, pending: 0 })
  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const amountCents = parseArsToCents(amount); const day = Number(dueDay)
    if (!amountCents || !Number.isInteger(day) || day < 1 || day > 28) { setFeedback('Ingresá un importe válido y un día de vencimiento entre 1 y 28.'); return }
    setSavingSettings(true); const { data, error } = await client.rpc('set_club_fee_settings', { p_club_id: club.id, p_monthly_amount_cents: amountCents, p_due_day: day }); setSavingSettings(false)
    if (error) { setFeedback('No pudimos guardar la configuración de cuotas.'); return }
    setSettings(data as ClubFeeSettings); setFeedback('Configuración de cuotas guardada.')
  }
  const generate = async () => {
    const monthStart = firstDayOfMonth(period); if (!monthStart) return
    setGenerating(true); const { data, error } = await client.rpc('generate_membership_dues', { p_club_id: club.id, p_period: monthStart }); setGenerating(false)
    if (error) { setFeedback('No pudimos generar cuotas. Verificá la configuración e intentá nuevamente.'); return }
    const result = (data as Array<{ created_count: number; existing_count: number }> | null)?.[0]; setFeedback(`Cuotas generadas: ${result?.created_count ?? 0}. Ya existentes: ${result?.existing_count ?? 0}.`); await loadDues(period)
  }
  const createIndividual = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const monthStart = firstDayOfMonth(period); const custom = individualAmount.trim() ? parseArsToCents(individualAmount) : null
    if (!individualMembershipId || !monthStart || (individualAmount.trim() && !custom)) { setFeedback('Elegí un socio e ingresá un importe válido o dejalo vacío para usar el estándar.'); return }
    const { error } = await client.rpc('create_individual_membership_due', { p_club_id: club.id, p_membership_id: individualMembershipId, p_period: monthStart, p_amount_cents: custom })
    if (error) { setFeedback('No pudimos emitir la cuota individual. Puede que ya exista o que el socio no esté activo.'); return }
    setShowIndividual(false); setIndividualMembershipId(''); setIndividualAmount(''); setFeedback('Cuota individual emitida.'); await loadDues(period)
  }
  const recordPayment = async (payload: { amountCents: number; paymentDate: string; paymentMethod: PaymentMethod; reference: string; notes: string }) => {
    if (!payingDue) return 'No encontramos la cuota seleccionada.'
    const result = await recordDuePayment(client, club, payingDue, payload)
    if (!result.ok) return result.message
    setPayingDue(null); setFeedback(result.recovered ? 'El pago ya estaba registrado: lo recuperamos sin duplicarlo.' : 'Pago registrado.'); await loadDues(period); return null
  }
  if (!canManage) return <section className="configuration-card"><p className="eyebrow">Acceso restringido</p><h2>Las cuotas son privadas.</h2><p className="intro">Solo propietario y administradores pueden consultar información financiera.</p></section>
  return <section className="fees-section" aria-labelledby="fees-title"><div className="section-heading"><div><p className="eyebrow">Administración</p><h2 id="fees-title">Cuotas</h2></div><p>Cobros y estado de cuenta del período elegido.</p></div>
    <div className="fees-controls"><label>Período<input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label><p>{settings ? <>Importe vigente: <strong>{formatArs(settings.monthly_amount_cents)}</strong> · vence el día {settings.due_day}</> : 'Configurá el importe antes de emitir cuotas.'}</p><button type="button" disabled={!settings || generating} onClick={() => void generate()}>{generating ? 'Generando…' : 'Generar cuotas del mes'}</button><button className="secondary-button" type="button" disabled={!settings} onClick={() => setShowIndividual(true)}>Emitir cuota individual</button></div>
    {feedback && <p className="form-success" role="status">{feedback}</p>}
    <div className="fee-stats" aria-label="Resumen de cuotas"><div><span>Emitido</span><strong>{formatArs(totals.issued)}</strong></div><div><span>Cobrado</span><strong>{formatArs(totals.collected)}</strong></div><div><span>Pendiente</span><strong>{formatArs(totals.balance)}</strong></div><div><span>Pagadas / parciales / pendientes</span><strong>{totals.paid} / {totals.partial} / {totals.pending}</strong></div></div>
    <div className="fee-filters"><label>Buscar socio<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre" /></label><label>Estado<select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">Todas</option><option value="paid">Pagadas</option><option value="partial">Parciales</option><option value="pending">Pendientes</option><option value="overdue">Vencidas</option></select></label></div>
    {status === 'loading' ? <p className="calendar-loading" role="status">Cargando cuotas…</p> : status === 'error' ? <p className="form-error" role="alert">{feedback}</p> : <div className="due-list">{visibleDues.length === 0 ? <p className="screen-message">No hay cuotas para los criterios seleccionados.</p> : visibleDues.map((due) => <DueRow key={due.id} due={due} person={personForDue(due)} payments={payments} timezone={club.timezone} onPayment={() => setPayingDue(due)} onDetail={() => setDetailDue(due)} />)}</div>}
    <details className="settings-disclosure" open={showSettings} onToggle={(event) => setShowSettings(event.currentTarget.open)}><summary><span><strong>Configuración mensual</strong><small>Importe estándar y día de vencimiento</small></span><span>{showSettings ? 'Ocultar' : 'Editar'}</span></summary><form className="fee-settings" onSubmit={(event) => void saveSettings(event)}><label>Importe estándar (ARS)<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Ej. 35.000" required /></label><label>Día de vencimiento<select value={dueDay} onChange={(event) => setDueDay(event.target.value)}>{Array.from({ length: 28 }, (_, index) => index + 1).map((day) => <option value={day} key={day}>{day}</option>)}</select></label><button type="submit" disabled={savingSettings}>{savingSettings ? 'Guardando…' : settings ? 'Actualizar configuración' : 'Guardar configuración'}</button></form></details>
    {showIndividual && <div className="reservation-modal-backdrop" role="presentation"><section className="reservation-modal" role="dialog" aria-modal="true" aria-labelledby="individual-due-title"><div className="modal-heading"><div><p className="eyebrow">Cuotas</p><h2 id="individual-due-title">Emitir cuota individual</h2></div><button className="icon-button" type="button" aria-label="Cerrar" onClick={() => setShowIndividual(false)}>×</button></div><form className="reservation-form" onSubmit={(event) => void createIndividual(event)}><label>Socio activo<select value={individualMembershipId} onChange={(event) => setIndividualMembershipId(event.target.value)} required><option value="">Seleccioná un socio</option>{memberships.filter((membership) => membership.status === 'active').map((membership) => <option key={membership.id} value={membership.id}>{peopleById.get(membership.person_id)?.full_name ?? 'Socio'}</option>)}</select></label><label>Importe personalizado (ARS) <span className="optional-label">(opcional)</span><input inputMode="decimal" value={individualAmount} onChange={(event) => setIndividualAmount(event.target.value)} placeholder="Usa el importe estándar" /></label><p className="field-help">Período: {monthLabel(firstDayOfMonth(period) ?? `${period}-01`, club.timezone)}. No reemplaza una cuota existente.</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowIndividual(false)}>Volver</button><button type="submit">Emitir cuota</button></div></form></section></div>}
    {payingDue && <PaymentDialog due={payingDue} payments={payments} onClose={() => setPayingDue(null)} onSave={recordPayment} />}
    {detailDue && <DueDetailDialog client={client} club={club} due={detailDue} payments={payments} onClose={() => setDetailDue(null)} onRefresh={async () => { await loadDues(period) }} />}
  </section>
}
