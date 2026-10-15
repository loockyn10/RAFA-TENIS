import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountItem, Club, MembershipDue, MembershipDuePayment } from '../../types/domain'
import { Badge, Button, Icon, type Tone } from '../../design/ui'
import { dateShort } from '../../design/dates'
import { plural } from '../../design/format'
import { PaymentDialog } from '../fees/FinancePanel'
import { recordDuePayment, type DuePaymentPayload } from '../fees/recordDuePayment'
import { formatMoney, periodLabel, todayInClubTimezone } from '../fees/feeUtils'
import { fetchPersonAccount } from '../courtCharges/courtChargeApi'
import { CourtChargePaymentFlow } from '../courtCharges/CourtChargeSection'
import { ACCOUNT_CONCEPT_LABEL, ACCOUNT_STATUS_LABEL, accountBreakdown, accountTotal, isAccountItemOverdue, isCourtConcept } from '../courtCharges/courtChargeUtils'

const STATUS_TONE: Record<AccountItem['status'], Tone> = { pending: 'neutral', partial: 'warning', paid: 'success', voided: 'danger' }
const dueFields = 'id, club_id, membership_id, period, amount_cents, due_date, created_at, created_by'
const duePaymentFields = 'id, club_id, due_id, amount_cents, payment_date, payment_method, reference, notes, created_at, created_by, voided_at, voided_by, void_reason'

type Collecting = { kind: 'due'; id: string } | { kind: 'court'; id: string }

/**
 * CUENTA CORRIENTE de una persona: lectura consolidada de lo que ya existe (cuotas, cantina y cargos de cancha). No guarda
 * nada propio ni reparte un pago entre módulos: «Cobrar» abre el cobro real de cada concepto.
 */
export function PersonAccount({ client, club, personId, onOpenCanteen, onClose }: { client: SupabaseClient; club: Club; personId: string; onOpenCanteen?: () => void; onClose?: () => void }) {
  const [items, setItems] = useState<AccountItem[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [showSettled, setShowSettled] = useState(false)
  const [collecting, setCollecting] = useState<Collecting | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const today = todayInClubTimezone(club.timezone)

  const load = async (settled: boolean) => {
    try { setItems(await fetchPersonAccount(client, club, personId, settled)); setStatus('ready') } catch { setStatus('error') }
  }
  useEffect(() => { setStatus('loading'); void load(showSettled) }, [client, club.id, personId, showSettled]) // eslint-disable-line react-hooks/exhaustive-deps

  const total = accountTotal(items)
  const breakdown = accountBreakdown(items)
  const refresh = async (text: string) => { setCollecting(null); setNotice(text); await load(showSettled) }
  const collect = (item: AccountItem) => {
    if (item.concept === 'membership_due') setCollecting({ kind: 'due', id: item.source_id })
    else if (isCourtConcept(item.concept)) setCollecting({ kind: 'court', id: item.source_id })
    else { onClose?.(); onOpenCanteen?.() }
  }

  return (
    <section className="detail-section" aria-labelledby="pa-title">
      <h3 id="pa-title" className="detail-section-title">Cuenta corriente</h3>
      {status === 'loading' && <p className="muted">Cargando cuenta…</p>}
      {status === 'error' && <p className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><span>No pudimos cargar la cuenta corriente. <button type="button" className="link-btn" onClick={() => void load(showSettled)}>Reintentar</button></span></p>}
      {notice && <p className="inline-alert inline-alert-success" role="status"><Icon name="checkCircle" size={20} /><span>{notice}</span></p>}
      {status === 'ready' && (
        <>
          <div className="balance-grid">
            <div className={`balance ${total ? 'is-due' : ''}`}>
              <span>Total adeudado</span>
              <strong className="display num">{total ? formatMoney(total) : 'Al día'}</strong>
              <small>{total ? plural(items.filter((item) => item.balance_cents > 0).length, 'concepto pendiente', 'conceptos pendientes') : 'Sin deuda registrada'}</small>
            </div>
          </div>
          {breakdown.length > 0 && (
            <ul className="mini-list" aria-label="Desglose por concepto">
              {breakdown.map((row) => <li key={row.concept}><span>{row.label}</span><span>{plural(row.count, 'pendiente', 'pendientes')}</span><b className="num">{formatMoney(row.balanceCents)}</b></li>)}
            </ul>
          )}
          {items.length === 0 ? <p className="muted">{showSettled ? 'No hay movimientos registrados.' : 'No hay saldos pendientes.'}</p> : (
            <ul className="account-list">
              {items.map((item) => {
                const overdue = isAccountItemOverdue(item, today)
                return (
                  <li key={`${item.concept}:${item.source_id}`} className={`account-row ${item.status === 'voided' ? 'is-voided' : ''}`}>
                    <div className="account-row-main">
                      <span className="account-row-top"><b>{ACCOUNT_CONCEPT_LABEL[item.concept]}</b><Badge tone={overdue ? 'clay' : STATUS_TONE[item.status]}>{overdue ? 'Vencida' : ACCOUNT_STATUS_LABEL[item.status]}</Badge></span>
                      <span className="muted">{item.concept === 'membership_due' ? periodLabel(item.occurred_on) : dateShort(item.occurred_on)} · {item.description}</span>
                      <span className="account-row-amounts num">Original {formatMoney(item.original_cents)} · Pagado {formatMoney(item.paid_cents)} · <b>Saldo {formatMoney(item.balance_cents)}</b></span>
                    </div>
                    {item.balance_cents > 0 && <Button variant="secondary" size="sm" icon={item.concept === 'canteen' ? 'arrowRight' : 'cash'} onClick={() => collect(item)}>{item.concept === 'canteen' ? 'Ir a Cantina' : 'Cobrar'}</Button>}
                  </li>
                )
              })}
            </ul>
          )}
          <button type="button" className="link-btn link-btn-icon" onClick={() => setShowSettled((value) => !value)}><Icon name="list" size={18} />{showSettled ? 'Ver solo pendientes' : 'Ver también saldados y anulados'}</button>
          <p className="detail-footnote"><Icon name="info" size={16} />Es un resumen de cuotas, cantina y canchas ya registradas. Cada cobro se hace en su módulo; los pagos anulados no se cuentan.</p>
        </>
      )}
      {collecting?.kind === 'due' && <DuePaymentFlow client={client} club={club} dueId={collecting.id} today={today} onClose={() => setCollecting(null)} onDone={(recovered) => refresh(recovered ? 'El pago ya estaba registrado: lo recuperamos sin duplicarlo.' : 'Pago de cuota registrado.')} />}
      {collecting?.kind === 'court' && <CourtChargePaymentFlow client={client} club={club} chargeId={collecting.id} onClose={() => setCollecting(null)} onDone={(recovered) => refresh(recovered ? 'El pago ya estaba registrado: lo recuperamos sin duplicarlo.' : 'Pago de cancha registrado.')} />}
    </section>
  )
}

/** Cobro real de una cuota (mismo formulario, función y claves de idempotencia que Cuotas). */
function DuePaymentFlow({ client, club, dueId, today, onClose, onDone }: { client: SupabaseClient; club: Club; dueId: string; today: string; onClose: () => void; onDone: (recovered: boolean) => Promise<void> }) {
  const [data, setData] = useState<{ due: MembershipDue; payments: MembershipDuePayment[] } | 'error' | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data: due, error } = await client.from('membership_dues').select(dueFields).eq('club_id', club.id).eq('id', dueId).maybeSingle()
      if (error || !due) { if (!cancelled) setData('error'); return }
      const { data: payments, error: paymentError } = await client.from('membership_due_payments').select(duePaymentFields).eq('club_id', club.id).eq('due_id', dueId)
      if (!cancelled) setData(paymentError ? 'error' : { due: due as MembershipDue, payments: (payments ?? []) as MembershipDuePayment[] })
    })()
    return () => { cancelled = true }
  }, [client, club.id, dueId])
  if (data === null) return null
  if (data === 'error') return <p className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><span>No pudimos cargar la cuota. Cerrá y reintentá.</span> <Button variant="ghost" size="sm" onClick={onClose}>Cerrar</Button></p>
  const save = async (payload: DuePaymentPayload) => {
    const result = await recordDuePayment(client, club, data.due, payload)
    if (!result.ok) return result.message
    await onDone(result.recovered)
    return null
  }
  return <PaymentDialog due={data.due} payments={data.payments} today={today} onClose={onClose} onSave={save} />
}
