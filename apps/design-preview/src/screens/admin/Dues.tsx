import { useMemo, useState } from 'react'
import { CURRENT_PERIOD, PAYMENT_LABEL, periodOf, TODAY, type Due, type DuePayment, type PaymentMethod } from '../../data/mock'
import { MethodPicker, PersonPicker } from '../../components/domain'
import { METHODS } from '../../lib/payments'
import { Avatar, Badge, Button, Chip, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Meter, Modal, MoneyInput, NumberStepper, PageHead, SegmentedTabs, SkeletonCards, TextArea, TextInput, type Tone } from '../../components/ui'
import { useAction, useIntent, usePeople } from '../../lib/data'
import { dueBalance, duePaid, dueStatus, DUE_STATUS_LABEL, moneyInputValue, parseMoney, periodLabel, periodShort, periodSummary, personBalance, type DueStatus } from '../../lib/dues'
import { formatARS, plural } from '../../lib/format'
import { useProto, useScreenState } from '../../lib/proto'
import { useStore } from '../../lib/store'
import { dateShort } from '../../lib/time'

const STATUS_TONE: Record<DueStatus, Tone> = { paid: 'success', partial: 'warning', overdue: 'clay', pending: 'neutral' }
type Tab = 'month' | 'balances' | 'payments'
type StatusFilter = 'all' | 'open' | 'partial' | 'paid'

export function Dues() {
  const { state } = useStore()
  const { dataState, retry } = useScreenState()
  const { byId } = usePeople()
  const dues = dataState === 'empty' ? [] : state.dues
  const payments = dataState === 'empty' ? [] : state.duePayments
  const nextPeriod = periodOf(TODAY, 1)
  const periods = useMemo(() => {
    const set = new Set([...state.dues.map((due) => due.period), CURRENT_PERIOD, nextPeriod])
    return [...set].sort()
  }, [state.dues, nextPeriod])
  const [period, setPeriod] = useState(CURRENT_PERIOD)
  const [tab, setTab] = useState<Tab>('month')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')
  const [dueId, setDueId] = useState<string | null>(null)
  const [pay, setPay] = useState<{ personId?: string; dueId?: string } | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [config, setConfig] = useState(false)
  const [single, setSingle] = useState(false)

  useIntent(['pay'], (intent) => setPay({ personId: intent.personId }))

  const summary = periodSummary(dues, payments, period)
  const pct = summary.amountCents ? Math.round((summary.collectedCents / summary.amountCents) * 100) : 0
  const term = query.trim().toLowerCase()
  const monthDues = dues
    .filter((due) => due.period === period)
    .map((due) => ({ due, person: byId(due.personId), status: dueStatus(due, payments), paid: duePaid(due, payments) }))
    .filter((row) => row.person && row.person.name.toLowerCase().includes(term))
    .filter((row) => filter === 'all' || (filter === 'open' ? row.status === 'pending' || row.status === 'overdue' : row.status === filter))
    .sort((a, b) => {
      const order: Record<DueStatus, number> = { overdue: 0, pending: 1, partial: 2, paid: 3 }
      return order[a.status] - order[b.status] || a.person!.name.localeCompare(b.person!.name, 'es')
    })
  const openDue = state.dues.find((due) => due.id === dueId) ?? null

  return (
    <div className="module">
      <PageHead
        eyebrow="Club · solo propietario y administración"
        title="Cuotas"
        meta={<>Cuota mensual <b className="num">{formatARS(state.fees.monthlyCents)}</b> · vence el día {state.fees.dueDay}</>}
        actions={<>
          <Button variant="secondary" icon="settings" onClick={() => setConfig(true)}>Configurar</Button>
          <Button variant="accent" icon="cash" onClick={() => setPay({})}>Registrar pago</Button>
        </>}
      />

      <div className="period-strip" role="listbox" aria-label="Período">
        {periods.map((item) => {
          const info = periodSummary(dues, payments, item)
          const ratio = info.amountCents ? info.collectedCents / info.amountCents : 0
          return (
            <button key={item} type="button" role="option" aria-selected={item === period} className={`period-chip ${item === period ? 'is-selected' : ''} ${info.issued ? '' : 'is-empty'}`} onClick={() => setPeriod(item)}>
              <span className="period-chip-month display">{periodShort(item)}</span>
              <span className="period-chip-year">{item.slice(0, 4)}</span>
              <span className="period-chip-bar" aria-hidden="true"><i style={{ width: `${Math.round(ratio * 100)}%` }} /></span>
              <span className="period-chip-foot">{info.issued ? `${Math.round(ratio * 100)}%` : 'Sin emitir'}</span>
            </button>
          )
        })}
      </div>

      {dataState === 'error' ? <ErrorState title="No pudimos cargar las cuotas" onRetry={retry} />
        : dataState === 'loading' ? <SkeletonCards count={4} height={84} />
          : (
            <>
              {summary.issued > 0 ? (
                <section className="dues-hero texture-court" aria-label={`Cobranza de ${periodLabel(period)}`}>
                  <div className="dues-hero-main">
                    <p className="eyebrow eyebrow-on-dark">{periodLabel(period)} · cobrado</p>
                    <p className="dues-hero-amount display num">{formatARS(summary.collectedCents)}<small> de {formatARS(summary.amountCents)}</small></p>
                    <Meter value={summary.collectedCents} max={summary.amountCents} label={`${pct}% cobrado`} tone="ball" />
                  </div>
                  <dl className="dues-hero-counts">
                    <div><dt>Pagadas</dt><dd className="display num">{summary.paid}</dd></div>
                    <div><dt>Parciales</dt><dd className="display num">{summary.partial}</dd></div>
                    <div><dt>Sin pago</dt><dd className="display num">{summary.unpaid}</dd></div>
                    <div className="is-due"><dt>Saldo</dt><dd className="display num">{formatARS(summary.pendingCents)}</dd></div>
                  </dl>
                </section>
              ) : null}

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
                    body={dues.length === 0 ? 'Emití el primer período: se crea una cuota por cada socio activo.' : 'Se crea una cuota por cada socio activo con el importe vigente. Nada se cobra automáticamente.'}
                    action={<Button variant="accent" icon="send" onClick={() => setIssuing(true)}>Emitir cuotas de {periodLabel(period, false)}</Button>} />
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
                  {monthDues.length === 0 ? <div className="card"><EmptyState icon="search" title="Sin cuotas para este filtro" /></div> : (
                    <ul className="list-card" aria-label="Cuotas">
                      {monthDues.map(({ due, person, status, paid }) => (
                        <li key={due.id}>
                          <button type="button" className="due-item" onClick={() => setDueId(due.id)}>
                            <Avatar name={person!.name} />
                            <span className="due-item-main">
                              <strong>{person!.name}</strong>
                              <span className="num">{status === 'paid' ? `Pagó ${formatARS(paid)}` : paid > 0 ? `Pagó ${formatARS(paid)} · resta ${formatARS(due.amountCents - paid)}` : `Vence ${dateShort(due.dueDate)}`}</span>
                            </span>
                            <span className="due-item-side">
                              <strong className="num">{formatARS(due.amountCents)}</strong>
                              <Badge tone={STATUS_TONE[status]} icon={status === 'paid' ? 'check' : undefined}>{DUE_STATUS_LABEL[status]}</Badge>
                            </span>
                            <span className="due-item-bar" aria-hidden="true"><i className={`is-${status}`} style={{ width: `${Math.min(100, Math.round((paid / due.amountCents) * 100))}%` }} /></span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button type="button" className="link-btn link-btn-icon" onClick={() => setSingle(true)}><Icon name="plus" size={18} />Agregar cuota individual a un socio</button>
                </section>
              ))}

              {tab === 'balances' && <Balances onPay={(personId) => setPay({ personId })} />}
              {tab === 'payments' && <Payments onOpen={setDueId} />}
            </>
          )}

      <DueDetail due={openDue} onClose={() => setDueId(null)} onPay={(due) => setPay({ personId: due.personId, dueId: due.id })} />
      <PayDialog request={pay} onClose={() => setPay(null)} />
      <IssueDialog open={issuing} period={period} onClose={() => setIssuing(false)} />
      <FeesDialog open={config} onClose={() => setConfig(false)} />
      <SingleDue open={single} period={period} onClose={() => setSingle(false)} />
    </div>
  )
}

// ── Saldos por socio ────────────────────────────────────────────────
function Balances({ onPay }: { onPay: (personId: string) => void }) {
  const { state } = useStore()
  const { byId } = usePeople()
  const rows = [...new Set(state.dues.map((due) => due.personId))]
    .map((id) => ({ person: byId(id)!, ...personBalance(id, state.dues, state.duePayments) }))
    .filter((row) => row.person && row.cents > 0)
    .sort((a, b) => b.cents - a.cents)
  const total = rows.reduce((sum, row) => sum + row.cents, 0)
  if (rows.length === 0) return <div className="card"><EmptyState icon="checkCircle" title="Nadie debe cuotas" body="Todos los socios están al día." /></div>
  return (
    <section className="stack" aria-label="Saldos pendientes">
      <p className="muted">{plural(rows.length, 'socio', 'socios')} con saldo · total <b className="num">{formatARS(total)}</b>. El saldo se calcula desde las cuotas y los pagos válidos.</p>
      <ul className="list-card">
        {rows.map((row) => (
          <li key={row.person.id}>
            <button type="button" className="due-item" onClick={() => onPay(row.person.id)}>
              <Avatar name={row.person.name} />
              <span className="due-item-main"><strong>{row.person.name}</strong><span>{plural(row.months, 'cuota pendiente', 'cuotas pendientes')}</span></span>
              <span className="due-item-side"><strong className="num balance-amount">{formatARS(row.cents)}</strong><span className="link-btn">Cobrar</span></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ── Historial de pagos ──────────────────────────────────────────────
function Payments({ onOpen }: { onOpen: (dueId: string) => void }) {
  const { state } = useStore()
  const { byId } = usePeople()
  const [method, setMethod] = useState<PaymentMethod | 'all'>('all')
  const list = state.duePayments
    .filter((payment) => method === 'all' || payment.method === method)
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1))
  const valid = list.filter((payment) => !payment.voided).reduce((sum, payment) => sum + payment.amountCents, 0)
  return (
    <section className="stack" aria-label="Pagos registrados">
      <div className="chip-row chip-row-scroll" role="group" aria-label="Filtrar por medio">
        <Chip selected={method === 'all'} onClick={() => setMethod('all')}>Todos</Chip>
        {METHODS.map((item) => <Chip key={item.id} icon={item.icon} selected={method === item.id} onClick={() => setMethod(item.id)}>{PAYMENT_LABEL[item.id]}</Chip>)}
      </div>
      <p className="muted">{plural(list.length, 'pago', 'pagos')} · válidos <b className="num">{formatARS(valid)}</b></p>
      {list.length === 0 ? <div className="card"><EmptyState icon="receipt" title="Sin pagos con ese medio" /></div> : (
        <ul className="list-card">
          {list.map((payment) => {
            const due = state.dues.find((item) => item.id === payment.dueId)
            const person = byId(due?.personId)
            const icon = METHODS.find((item) => item.id === payment.method)?.icon ?? 'cash'
            return (
              <li key={payment.id}>
                <button type="button" className={`pay-row ${payment.voided ? 'is-voided' : ''}`} onClick={() => due && onOpen(due.id)}>
                  <span className="pay-row-icon"><Icon name={icon} size={20} /></span>
                  <span className="due-item-main">
                    <strong>{person?.name ?? 'Ficha'}</strong>
                    <span>{due ? periodLabel(due.period) : ''} · {PAYMENT_LABEL[payment.method]}{payment.reference ? ` · ${payment.reference}` : ''}</span>
                  </span>
                  <span className="due-item-side">
                    <strong className="num">{formatARS(payment.amountCents)}</strong>
                    {payment.voided ? <Badge tone="danger">Anulado</Badge> : <span className="muted num">{dateShort(payment.date)}</span>}
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

// ── Detalle de cuota ────────────────────────────────────────────────
function DueDetail({ due, onClose, onPay }: { due: Due | null; onClose: () => void; onPay: (due: Due) => void }) {
  const { state } = useStore()
  const { byId } = usePeople()
  const [voiding, setVoiding] = useState<DuePayment | null>(null)
  if (!due) return null
  const person = byId(due.personId)
  const status = dueStatus(due, state.duePayments)
  const paid = duePaid(due, state.duePayments)
  const balance = dueBalance(due, state.duePayments)
  const payments = state.duePayments.filter((payment) => payment.dueId === due.id).sort((a, b) => (a.date < b.date ? 1 : -1))
  return (
    <>
      <Modal open={voiding === null} onClose={onClose} variant="drawer" size="sm" eyebrow={`Cuota · ${periodLabel(due.period)}`} title={person?.name ?? ''}
        footer={balance > 0 ? <div className="form-actions"><Button variant="ghost" onClick={onClose}>Cerrar</Button><Button variant="accent" icon="cash" onClick={() => onPay(due)}>Registrar pago</Button></div> : undefined}
      >
        <div className="detail">
          <div className={`due-hero is-${status}`}>
            <div>
              <span className="eyebrow">{status === 'paid' ? 'Saldada' : 'Saldo'}</span>
              <strong className="display num">{formatARS(status === 'paid' ? due.amountCents : balance)}</strong>
              <span>{status === 'paid' ? `Cuota de ${formatARS(due.amountCents)} pagada` : `de ${formatARS(due.amountCents)} · vence ${dateShort(due.dueDate)}`}</span>
            </div>
            <Badge tone={STATUS_TONE[status]} icon={status === 'paid' ? 'check' : undefined}>{DUE_STATUS_LABEL[status]}</Badge>
            <Meter value={paid} max={due.amountCents} label={`Pagado ${formatARS(paid)}`} tone={status === 'paid' ? 'green' : 'clay'} />
          </div>

          <section className="detail-section" aria-labelledby="dd-pay">
            <h3 id="dd-pay" className="detail-section-title">Pagos</h3>
            {payments.length === 0 ? <p className="muted">Todavía no hay pagos para esta cuota.</p> : (
              <ul className="pay-list">
                {payments.map((payment) => (
                  <li key={payment.id} className={payment.voided ? 'is-voided' : ''}>
                    <span className="pay-row-icon"><Icon name={METHODS.find((item) => item.id === payment.method)?.icon ?? 'cash'} size={18} /></span>
                    <span className="pay-list-main">
                      <strong className="num">{formatARS(payment.amountCents)}</strong>
                      <span>{dateShort(payment.date)} · {PAYMENT_LABEL[payment.method]}{payment.reference ? ` · ${payment.reference}` : ''}</span>
                      {payment.voided && <span className="pay-void-reason"><Icon name="info" size={14} />Anulado: {payment.voided.reason}</span>}
                    </span>
                    {payment.voided ? <Badge tone="danger">Anulado</Badge> : <Button variant="ghost" size="sm" onClick={() => setVoiding(payment)}>Anular</Button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="detail-footnote"><Icon name="lock" size={16} />El importe de una cuota emitida no cambia aunque se modifique la cuota mensual. Los pagos no se borran: se anulan con motivo.</p>
        </div>
      </Modal>
      <VoidDialog payment={voiding} onClose={() => setVoiding(null)} />
    </>
  )
}

const VOID_REASONS = ['Importe equivocado', 'Ficha equivocada', 'Pago duplicado', 'Otro motivo']

function VoidDialog({ payment, onClose }: { payment: DuePayment | null; onClose: () => void }) {
  const { dispatch } = useStore()
  const { notify } = useProto()
  const action = useAction()
  const [reason, setReason] = useState<string | null>(null)
  const [detail, setDetail] = useState('')
  const [touched, setTouched] = useState(false)
  const text = reason === 'Otro motivo' ? detail.trim() : [reason, detail.trim()].filter(Boolean).join(' · ')
  const close = () => { setReason(null); setDetail(''); setTouched(false); action.reset(); onClose() }
  const confirm = () => {
    setTouched(true)
    if (!payment || text.length < 3) return
    void action.run(() => {
      dispatch({ type: 'duePay/void', id: payment.id, reason: text })
      notify({ tone: 'success', title: 'Pago anulado', body: `${formatARS(payment.amountCents)} · el saldo de la cuota se recalculó.` })
      close()
    })
  }
  return (
    <ConfirmDialog open={payment !== null} title="¿Anular este pago?" confirmLabel="Anular pago" icon="x" status={action.status} onConfirm={confirm} onClose={close} errorTitle="No se anuló el pago" errorBody="El pago sigue vigente. Probá de nuevo.">
      {payment && <p><b className="num">{formatARS(payment.amountCents)}</b> · {PAYMENT_LABEL[payment.method]} · {dateShort(payment.date)}</p>}
      <fieldset className="form-block">
        <legend className="form-legend">Motivo</legend>
        <div className="chip-row">{VOID_REASONS.map((item) => <Chip key={item} selected={reason === item} onClick={() => setReason(item)}>{item}</Chip>)}</div>
        <Field label="Detalle" optional={reason !== 'Otro motivo'} error={touched && text.length < 3 ? 'Indicá el motivo: queda registrado en el historial.' : undefined}>
          {(id, describedBy) => <TextArea id={id} value={detail} aria-describedby={describedBy} rows={2} onChange={(event) => setDetail(event.target.value)} placeholder="Ej.: se cargó dos veces el mismo pago" />}
        </Field>
      </fieldset>
      <p className="muted">El pago queda visible como anulado. No se elimina.</p>
    </ConfirmDialog>
  )
}

// ── Registrar pago (total o parcial) ────────────────────────────────
function PayDialog({ request, onClose }: { request: { personId?: string; dueId?: string } | null; onClose: () => void }) {
  const { state } = useStore()
  const [personId, setPersonId] = useState<string | null>(null)
  const chosen = request?.personId ?? personId
  const close = () => { setPersonId(null); onClose() }
  if (!request) return null
  if (!chosen) {
    const owes = (id: string) => personBalance(id, state.dues, state.duePayments).cents > 0
    return (
      <PersonPicker open title="¿Quién paga?" hint="Socios con cuotas pendientes." onClose={close} onPick={setPersonId}
        filter={(person) => state.dues.some((due) => due.personId === person.id)}
        disabledReason={(person) => (owes(person.id) ? undefined : 'Al día')} />
    )
  }
  return <PayForm key={`${chosen}-${request.dueId ?? ''}`} personId={chosen} dueId={request.dueId} onClose={close} />
}

function PayForm({ personId, dueId, onClose }: { personId: string; dueId?: string; onClose: () => void }) {
  const { state, dispatch } = useStore()
  const { notify } = useProto()
  const person = usePeople().byId(personId)
  const action = useAction()
  const open = state.dues.filter((due) => due.personId === personId && dueBalance(due, state.duePayments) > 0).sort((a, b) => (a.period < b.period ? -1 : 1))
  const [selected, setSelected] = useState(dueId && open.some((due) => due.id === dueId) ? dueId : open[0]?.id)
  const due = open.find((item) => item.id === selected)
  const balance = due ? dueBalance(due, state.duePayments) : 0
  const [amount, setAmount] = useState(due ? moneyInputValue(balance) : '')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [date, setDate] = useState(TODAY)
  const [reference, setReference] = useState('')
  const [showRef, setShowRef] = useState(false)
  const [touched, setTouched] = useState(false)
  const cents = parseMoney(amount)
  const error = !touched ? undefined : Number.isNaN(cents) || cents <= 0 ? 'Ingresá un importe mayor a cero.' : cents > balance ? `Supera el saldo de la cuota (${formatARS(balance)}). No se aceptan pagos de más.` : undefined
  const remaining = Number.isNaN(cents) ? balance : Math.max(0, balance - cents)

  const pick = (id: string) => {
    const next = open.find((item) => item.id === id)
    setSelected(id)
    if (next) setAmount(moneyInputValue(dueBalance(next, state.duePayments)))
  }
  const submit = () => {
    setTouched(true)
    if (!due || Number.isNaN(cents) || cents <= 0 || cents > balance) return
    void action.run(() => {
      dispatch({ type: 'duePay/add', payment: { id: `dp-new-${Date.now()}`, dueId: due.id, amountCents: cents, date, method, reference: reference.trim() || undefined } })
      notify({ tone: 'success', title: cents === balance ? 'Cuota saldada' : `Pago parcial · resta ${formatARS(balance - cents)}`, body: `${person?.name} · ${periodLabel(due.period)} · ${formatARS(cents)} ${PAYMENT_LABEL[method]}` })
      onClose()
    })
  }

  return (
    <Modal open onClose={onClose} busy={action.saving} variant="drawer" size="sm" eyebrow="Registrar pago" title={person?.name ?? ''}
      footer={open.length > 0 ? (
        <div className="form-footer-inline">
          <p className="form-summary"><Icon name="wallet" size={16} />{Number.isNaN(cents) || cents <= 0 ? <span>Ingresá el importe recibido</span> : cents > balance ? <span className="field-error">Supera el saldo de <b className="num">{formatARS(balance)}</b></span> : remaining === 0 ? <span>La cuota queda <b>saldada</b></span> : <span>Pago parcial · queda saldo de <b className="num">{formatARS(remaining)}</b></span>}</p>
          <div className="form-actions">
            <Button variant="ghost" onClick={onClose} disabled={action.saving}>Cancelar</Button>
            <Button variant="accent" size="lg" icon={action.failed ? 'refresh' : 'check'} loading={action.saving} onClick={submit}>{action.failed ? 'Reintentar' : 'Confirmar pago'}</Button>
          </div>
        </div>
      ) : undefined}
    >
      {open.length === 0 ? <EmptyState icon="checkCircle" title="Está al día" body="No tiene cuotas con saldo pendiente." /> : (
        <div className="res-form">
          <fieldset className="form-block">
            <legend className="form-legend">Cuota</legend>
            <div className="option-list" role="radiogroup" aria-label="Cuota a pagar">
              {open.map((item) => {
                const status = dueStatus(item, state.duePayments)
                return (
                  <button key={item.id} type="button" role="radio" aria-checked={item.id === selected} className={`option-row ${item.id === selected ? 'is-selected' : ''}`} onClick={() => pick(item.id)}>
                    <span className="option-radio" aria-hidden="true" />
                    <span className="option-main"><strong>{periodLabel(item.period)}</strong><span>{DUE_STATUS_LABEL[status]} · vence {dateShort(item.dueDate)}</span></span>
                    <strong className="num">{formatARS(dueBalance(item, state.duePayments))}</strong>
                  </button>
                )
              })}
            </div>
          </fieldset>
          <Field label="Importe" error={error} hint="Podés registrar un pago parcial.">
            {(id, describedBy) => <MoneyInput id={id} value={amount} aria-invalid={Boolean(error)} aria-describedby={describedBy} onChange={(event) => setAmount(event.target.value)} data-autofocus />}
          </Field>
          <div className="chip-row">
            <Chip selected={cents === balance} onClick={() => setAmount(moneyInputValue(balance))}>Saldo {formatARS(balance)}</Chip>
            {balance >= 200 && <Chip selected={cents === Math.round(balance / 2)} onClick={() => setAmount(moneyInputValue(Math.round(balance / 2)))}>Mitad</Chip>}
          </div>
          <fieldset className="form-block">
            <legend className="form-legend">Medio de pago</legend>
            <MethodPicker value={method} onChange={setMethod} />
          </fieldset>
          <div className="form-row">
            <Field label="Fecha de pago">{(id) => <TextInput id={id} type="date" value={date} max={TODAY} onChange={(event) => event.target.value && setDate(event.target.value)} />}</Field>
            {showRef ? <Field label="Referencia" optional>{(id) => <TextInput id={id} value={reference} placeholder="N.º transferencia" onChange={(event) => setReference(event.target.value)} />}</Field>
              : <button type="button" className="link-btn link-btn-icon form-row-link" onClick={() => setShowRef(true)}><Icon name="note" size={18} />Agregar referencia</button>}
          </div>
          {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se registró el pago</strong><p>El saldo no cambió. Reintentar no lo duplica.</p></div></div>}
        </div>
      )}
    </Modal>
  )
}

// ── Emisión mensual ─────────────────────────────────────────────────
function IssueDialog({ open, period, onClose }: { open: boolean; period: string; onClose: () => void }) {
  const { state, dispatch } = useStore()
  const { notify } = useProto()
  const action = useAction()
  const members = state.people.filter((person) => person.active && person.membership === 'active')
  const pending = members.filter((person) => !state.dues.some((due) => due.personId === person.id && due.period === period))
  const dueDate = `${period}-${String(state.fees.dueDay).padStart(2, '0')}`
  const confirm = () => void action.run(() => {
    dispatch({ type: 'dues/add', dues: pending.map((person) => ({ id: `d-${period}-${person.id}-${Date.now()}`, personId: person.id, period, amountCents: state.fees.monthlyCents, dueDate })) })
    notify({ tone: 'success', title: `Cuotas de ${periodLabel(period, false)} emitidas`, body: `${plural(pending.length, 'cuota', 'cuotas')} de ${formatARS(state.fees.monthlyCents)}` })
    onClose()
  }, 1100)
  return (
    <ConfirmDialog open={open} title={`Emitir cuotas de ${periodLabel(period)}`} confirmLabel={`Emitir ${plural(pending.length, 'cuota', 'cuotas')}`} tone="accent" icon="send" status={action.status} disabled={pending.length === 0} onConfirm={confirm} onClose={() => { action.reset(); onClose() }} errorTitle="No se emitieron las cuotas" errorBody="No se creó ninguna. Reintentar no duplica cuotas ya emitidas.">
      <div className="issue-summary">
        <div><span>Socios activos sin cuota</span><strong className="display num">{pending.length}</strong></div>
        <div><span>Importe</span><strong className="display num">{formatARS(state.fees.monthlyCents)}</strong></div>
        <div><span>Vencimiento</span><strong className="display num">{dateShort(dueDate)}</strong></div>
        <div className="is-total"><span>Total a emitir</span><strong className="display num">{formatARS(pending.length * state.fees.monthlyCents)}</strong></div>
      </div>
      <p className="muted">Quien ya tiene cuota de este período no recibe otra. Emitir no registra cobros ni suspende a nadie.</p>
    </ConfirmDialog>
  )
}

function SingleDue({ open, period, onClose }: { open: boolean; period: string; onClose: () => void }) {
  const { state, dispatch } = useStore()
  const { notify } = useProto()
  const has = (personId: string) => state.dues.some((due) => due.personId === personId && due.period === period)
  return (
    <PersonPicker open={open} title={`Cuota individual · ${periodLabel(period)}`} hint="Solo socios activos." onClose={onClose}
      filter={(person) => person.membership === 'active'}
      disabledReason={(person) => (has(person.id) ? 'Ya tiene cuota de este período' : undefined)}
      onPick={(personId) => {
        dispatch({ type: 'dues/add', dues: [{ id: `d-${period}-${personId}-${Date.now()}`, personId, period, amountCents: state.fees.monthlyCents, dueDate: `${period}-${String(state.fees.dueDay).padStart(2, '0')}` }] })
        notify({ tone: 'success', title: 'Cuota agregada', body: `${state.people.find((person) => person.id === personId)?.name} · ${periodLabel(period)}` })
        onClose()
      }} />
  )
}

// ── Configuración mensual ───────────────────────────────────────────
export function FeesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Modal open={open} onClose={onClose} size="sm" eyebrow="Configuración mensual" title="Cuota de socios">{open && <FeesForm onClose={onClose} />}</Modal>
}

function FeesForm({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore()
  const { notify } = useProto()
  const action = useAction()
  const [amount, setAmount] = useState(moneyInputValue(state.fees.monthlyCents))
  const [day, setDay] = useState(state.fees.dueDay)
  const [touched, setTouched] = useState(false)
  const cents = parseMoney(amount)
  const invalid = Number.isNaN(cents) || cents <= 0
  const next = periodOf(TODAY, 1)
  const save = () => {
    setTouched(true)
    if (invalid) return
    void action.run(() => {
      dispatch({ type: 'fees/save', fees: { monthlyCents: cents, dueDay: day } })
      notify({ tone: 'success', title: 'Cuota mensual actualizada', body: `${formatARS(cents)} · vence el día ${day}` })
      onClose()
    })
  }
  return (
    <div className="res-form">
      <Field label="Importe mensual" error={touched && invalid ? 'Ingresá un importe mayor a cero.' : undefined}>{(id, describedBy) => <MoneyInput id={id} value={amount} aria-describedby={describedBy} aria-invalid={touched && invalid} onChange={(event) => setAmount(event.target.value)} data-autofocus />}</Field>
      <div className="field">
        <span className="field-label">Día de vencimiento</span>
        <NumberStepper label="Día de vencimiento" value={day} onChange={setDay} min={1} max={28} unit={() => 'de cada mes'} />
      </div>
      <div className="preview-card">
        <Icon name="info" size={18} />
        <p>Las cuotas de <b>{periodLabel(next, false)}</b> se emitirán por <b className="num">{invalid ? '—' : formatARS(cents)}</b> con vencimiento el <b className="num">{String(day).padStart(2, '0')}/{next.slice(5)}</b>. Las cuotas ya emitidas conservan su importe.</p>
      </div>
      {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardó</strong><p>Reintentá en un momento.</p></div></div>}
      <div className="form-actions">
        <Button variant="ghost" onClick={onClose} disabled={action.saving}>Cancelar</Button>
        <Button variant="primary" icon={action.failed ? 'refresh' : 'check'} loading={action.saving} onClick={save}>{action.failed ? 'Reintentar' : 'Guardar'}</Button>
      </div>
    </div>
  )
}
