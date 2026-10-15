import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club, ClubPerson, CourtCharge, CourtChargePayment, CourtRateSettings, PaymentMethod, Reservation } from '../../types/domain'
import { Badge, Button, Chip, ConfirmDialog, Field, Icon, Meter, Modal, MoneyInput, Switch, TextArea, TextInput, type Tone } from '../../design/ui'
import { MemberBadge, MethodPicker, PersonPicker } from '../../design/domain'
import { PAYMENT_LABELS } from '../../design/paymentLabels'
import { dateShort, durationLabel } from '../../design/dates'
import { moneyInputValue } from '../../design/format'
import { useAsyncAction } from '../../design/useAsyncAction'
import { UNCERTAIN_RESULT_MESSAGE } from '../../lib/idempotency'
import { formatMoney, parseArsToCents, todayInClubTimezone } from '../fees/feeUtils'
import { createQuickPerson, usePersonSearch } from '../people/usePersonSearch'
import { createCourtCharge, fetchCharge, fetchCourtRates, fetchReservationCharges, recordCourtChargePayment, voidCourtCharge, voidCourtChargePayment } from './courtChargeApi'
import { CHARGE_STATUS_LABEL, balanceOnCharge, chargeConceptLabel, chargeStatus, isAdjusted, paidOnCharge, quoteCharge, reservationMinutes, suggestedConcepts, type ChargeStatus } from './courtChargeUtils'

const STATUS_TONE: Record<ChargeStatus, Tone> = { pending: 'neutral', partial: 'warning', paid: 'success', voided: 'danger' }
const VOID_REASONS = ['Importe equivocado', 'Responsable equivocado', 'Duplicado', 'Otro motivo']
const sortPayments = (list: CourtChargePayment[]) => [...list].sort((a, b) => (a.payment_date === b.payment_date ? b.created_at.localeCompare(a.created_at) : a.payment_date < b.payment_date ? 1 : -1))

type LoadState = { status: 'loading' | 'ready' | 'error'; rates: CourtRateSettings | null; charges: CourtCharge[]; payments: CourtChargePayment[] }

// ── Sección dentro del detalle de una reserva ───────────────────────
/**
 * Cobro de cancha de una reserva común. Reservar NO genera deuda: el cargo se confirma expresamente acá (owner/admin) y
 * recién entonces aparece en la cuenta corriente del responsable. El servidor decide permisos, montos y duplicados.
 */
export function CourtChargeSection({ client, club, reservation, courtName }: { client: SupabaseClient; club: Club; reservation: Reservation; courtName?: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading', rates: null, charges: [], payments: [] })
  const [notice, setNotice] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [paying, setPaying] = useState(false)
  const [voidingCharge, setVoidingCharge] = useState(false)
  const [voidingPayment, setVoidingPayment] = useState<CourtChargePayment | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const today = todayInClubTimezone(club.timezone)

  const load = async () => {
    try {
      const [rates, { charges, payments }] = await Promise.all([fetchCourtRates(client, club), fetchReservationCharges(client, club, reservation.id)])
      setState({ status: 'ready', rates, charges, payments })
    } catch { setState((current) => ({ ...current, status: 'error' })) }
  }
  useEffect(() => { setState({ status: 'loading', rates: null, charges: [], payments: [] }); setNotice(null); void load() }, [client, club.id, reservation.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const active = state.charges.find((charge) => charge.status === 'confirmed') ?? null
  const voided = state.charges.filter((charge) => charge.status === 'voided')
  const minutes = reservationMinutes(reservation.starts_at, reservation.ends_at)
  const cancelled = reservation.status === 'cancelled'
  const paid = active ? paidOnCharge(active.id, state.payments) : 0
  const balance = active ? balanceOnCharge(active, state.payments) : 0
  const status = active ? chargeStatus(active, state.payments) : null
  const payments = active ? sortPayments(state.payments.filter((payment) => payment.charge_id === active.id)) : []
  const hasValidPayments = payments.some((payment) => payment.voided_at === null)
  const refresh = async (text: string) => { setNotice(text); await load() }

  return (
    <section className="detail-section" aria-labelledby="cc-title">
      <h3 id="cc-title" className="detail-section-title">Cobro de cancha</h3>
      {state.status === 'loading' && <p className="muted">Cargando cobro…</p>}
      {state.status === 'error' && <p className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><span>No pudimos cargar el cobro de esta reserva. <button type="button" className="link-btn" onClick={() => void load()}>Reintentar</button></span></p>}
      {notice && <p className="inline-alert inline-alert-success" role="status"><Icon name="checkCircle" size={20} /><span>{notice}</span></p>}
      {state.status === 'ready' && (active ? (
        <>
          <div className="issue-summary">
            <div><span>Total</span><strong className="display num">{formatMoney(active.total_cents)}</strong></div>
            <div><span>Pagado</span><strong className="display num">{formatMoney(paid)}</strong></div>
            <div className="is-total"><span>Pendiente</span><strong className="display num">{formatMoney(balance)}</strong></div>
          </div>
          <Meter value={Math.min(paid, active.total_cents)} max={active.total_cents} label={`Pagado ${formatMoney(paid)}`} tone={status === 'paid' ? 'green' : 'clay'} />
          <dl className="detail-list">
            <div><dt>Responsable</dt><dd>{active.responsible_name_snapshot} <MemberBadge active membership={active.member_status === 'member' ? 'active' : undefined} /></dd></div>
            <div><dt>Concepto</dt><dd>{chargeConceptLabel(active)} · {durationLabel(active.billable_minutes)} a cobrar</dd></div>
            {active.rental_applied && <div><dt>Alquiler</dt><dd className="num">{formatMoney(active.rental_cents)}</dd></div>}
            {active.lighting_applied && <div><dt>Iluminación</dt><dd className="num">{formatMoney(active.lighting_cents)}</dd></div>}
            <div><dt>Estado</dt><dd>{status && <Badge tone={STATUS_TONE[status]}>{CHARGE_STATUS_LABEL[status]}</Badge>} {isAdjusted(active) && <Badge tone="info" icon="edit">Importe ajustado</Badge>}</dd></div>
            {isAdjusted(active) && active.adjustment_reason && <div><dt>Motivo del ajuste</dt><dd>{active.adjustment_reason}</dd></div>}
            {active.notes && <div><dt>Observación</dt><dd>{active.notes}</dd></div>}
          </dl>
          <div className="detail-actions">
            {balance > 0 && <Button variant="accent" icon="cash" onClick={() => setPaying(true)}>Registrar pago</Button>}
            <Button variant="ghost" icon="list" onClick={() => setShowHistory((value) => !value)}>{showHistory ? 'Ocultar historial' : 'Historial'}</Button>
            {!hasValidPayments && <Button variant="ghost" icon="x" onClick={() => setVoidingCharge(true)}>Anular cargo</Button>}
          </div>
          {balance > 0 && paid === 0 && <p className="detail-footnote"><Icon name="info" size={16} />Cargo pendiente: queda en la cuenta corriente de {active.responsible_name_snapshot} hasta que se registre un pago.</p>}
          {showHistory && <ChargeHistory charge={active} payments={payments} voided={voided} onVoidPayment={setVoidingPayment} />}
        </>
      ) : (
        <>
          {voided.length > 0 && <p className="muted">Hay {voided.length === 1 ? 'un cargo anulado' : `${voided.length} cargos anulados`} en el historial de esta reserva.</p>}
          <p className="detail-footnote"><Icon name="info" size={16} />Reservar no genera un cobro. {cancelled ? 'La reserva está cancelada: no admite cargos.' : 'Si corresponde cobrar cancha o luz, registralo acá: nada se carga solo.'}</p>
          {!cancelled && <div className="detail-actions"><Button variant="primary" icon="cash" onClick={() => setCreating(true)}>Cobrar cancha o luz</Button></div>}
          {voided.length > 0 && <>
            <div className="detail-actions"><Button variant="ghost" icon="list" onClick={() => setShowHistory((value) => !value)}>{showHistory ? 'Ocultar historial' : 'Historial'}</Button></div>
            {showHistory && <ul className="mini-list">{voided.map((charge) => <li key={charge.id}><span>{formatMoney(charge.total_cents)} · {chargeConceptLabel(charge)}</span><span>Anulado: {charge.void_reason}</span></li>)}</ul>}
          </>}
        </>
      ))}

      {creating && <ChargeDialog client={client} club={club} reservation={reservation} courtName={courtName} rates={state.rates} defaultMinutes={minutes} onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await refresh('Cargo registrado. Quedó pendiente de pago.') }} />}
      {paying && active && <ChargePaymentDialog client={client} club={club} charge={active} payments={state.payments} today={today} onClose={() => setPaying(false)} onDone={async (recovered) => { setPaying(false); await refresh(recovered ? 'El pago ya estaba registrado: lo recuperamos sin duplicarlo.' : 'Pago registrado.') }} />}
      {active && <VoidReasonDialog open={voidingCharge} title="¿Anular este cargo?" confirmLabel="Anular cargo" summary={<><b className="num">{formatMoney(active.total_cents)}</b> · {chargeConceptLabel(active)} · {active.responsible_name_snapshot}</>} note="El cargo queda visible como anulado y sale de la cuenta corriente. Después podés registrar otro." onClose={() => setVoidingCharge(false)} onConfirm={(reason) => voidCourtCharge(client, active.id, reason)} onDone={async () => { setVoidingCharge(false); await refresh('Cargo anulado.') }} />}
      <VoidReasonDialog open={voidingPayment !== null} title="¿Anular este pago?" confirmLabel="Anular pago" summary={voidingPayment && <><b className="num">{formatMoney(voidingPayment.amount_cents)}</b> · {PAYMENT_LABELS[voidingPayment.payment_method]} · {dateShort(voidingPayment.payment_date)}</>} note="El pago queda visible como anulado, no se elimina y el saldo se recalcula." onClose={() => setVoidingPayment(null)} onConfirm={(reason) => (voidingPayment ? voidCourtChargePayment(client, voidingPayment.id, reason) : Promise.resolve({ ok: false as const, message: 'No encontramos el pago.' }))} onDone={async () => { setVoidingPayment(null); await refresh('Pago anulado.') }} />
    </section>
  )
}

function ChargeHistory({ charge, payments, voided, onVoidPayment }: { charge: CourtCharge; payments: CourtChargePayment[]; voided: CourtCharge[]; onVoidPayment: (payment: CourtChargePayment) => void }) {
  return (
    <div className="detail-section">
      <h4 className="detail-section-title">Historial de pagos</h4>
      {payments.length === 0 ? <p className="muted">Todavía no hay pagos para este cargo.</p> : (
        <ul className="pay-list">
          {payments.map((payment) => (
            <li key={payment.id} className={payment.voided_at ? 'is-voided' : ''}>
              <span className="pay-row-icon"><Icon name={payment.payment_method === 'bank_transfer' ? 'transfer' : payment.payment_method === 'mercado_pago' ? 'qr' : payment.payment_method === 'other' ? 'more' : 'cash'} size={18} /></span>
              <span className="pay-list-main">
                <strong className="num">{formatMoney(payment.amount_cents)}</strong>
                <span>{dateShort(payment.payment_date)} · {PAYMENT_LABELS[payment.payment_method]}{payment.reference ? ` · Ref. ${payment.reference}` : ''}</span>
                {payment.notes && <span>{payment.notes}</span>}
                {payment.voided_at && <span className="pay-void-reason"><Icon name="info" size={14} />Anulado: {payment.void_reason}</span>}
              </span>
              {payment.voided_at ? <Badge tone="danger">Anulado</Badge> : <Button variant="ghost" size="sm" onClick={() => onVoidPayment(payment)}>Anular</Button>}
            </li>
          ))}
        </ul>
      )}
      {voided.length > 0 && <ul className="mini-list">{voided.map((item) => <li key={item.id}><span>{formatMoney(item.total_cents)} · {chargeConceptLabel(item)} (cargo anterior)</span><span>Anulado: {item.void_reason}</span></li>)}</ul>}
      <p className="detail-footnote"><Icon name="lock" size={16} />El importe de un cargo no cambia aunque cambien las tarifas. Los pagos no se borran: se anulan con motivo.{charge.rental_hour_cents_snapshot || charge.lighting_hour_cents_snapshot ? ` Tarifa aplicada: ${[charge.rental_applied && charge.rental_hour_cents_snapshot ? `alquiler ${formatMoney(charge.rental_hour_cents_snapshot)}/h` : null, charge.lighting_applied && charge.lighting_hour_cents_snapshot ? `luz ${formatMoney(charge.lighting_hour_cents_snapshot)}/h` : null].filter(Boolean).join(' · ')}.` : ''}</p>
    </div>
  )
}

// ── Anulación con motivo (cargo o pago) ─────────────────────────────
function VoidReasonDialog({ open, title, confirmLabel, summary, note, onClose, onConfirm, onDone }: { open: boolean; title: string; confirmLabel: string; summary: ReactNode; note: string; onClose: () => void; onConfirm: (reason: string) => Promise<{ ok: true } | { ok: false; message: string }>; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState<string | null>(null)
  const [detail, setDetail] = useState('')
  const [touched, setTouched] = useState(false)
  const action = useAsyncAction()
  const text = reason === 'Otro motivo' ? detail.trim() : [reason, detail.trim()].filter(Boolean).join(' · ')
  const close = () => { setReason(null); setDetail(''); setTouched(false); action.reset(); onClose() }
  const confirm = () => {
    setTouched(true)
    if (text.length < 3) return
    void action.run(async () => {
      const result = await onConfirm(text)
      if (!result.ok) return result.message
      setReason(null); setDetail(''); setTouched(false)
      await onDone()
      return null
    })
  }
  return (
    <ConfirmDialog open={open} title={title} confirmLabel={confirmLabel} icon="x" status={action.status} onConfirm={confirm} onClose={close} errorTitle="No se anuló" errorBody={action.message ?? 'No cambió nada. Probá de nuevo.'}>
      <p>{summary}</p>
      <fieldset className="form-block">
        <legend className="form-legend">Motivo</legend>
        <div className="chip-row">{VOID_REASONS.map((item) => <Chip key={item} selected={reason === item} onClick={() => setReason(item)}>{item}</Chip>)}</div>
        <Field label="Motivo obligatorio" error={touched && text.length < 3 ? 'Indicá el motivo: queda registrado en el historial.' : undefined}>
          {(id, describedBy) => <TextArea id={id} value={detail} aria-describedby={describedBy} rows={2} onChange={(event) => setDetail(event.target.value)} placeholder="Ej.: se cargó a la reserva equivocada" />}
        </Field>
      </fieldset>
      <p className="muted">{note}</p>
    </ConfirmDialog>
  )
}

// ── Alta de cargo ───────────────────────────────────────────────────
type Responsible = { id: string; name: string; member: boolean }

function ChargeDialog({ client, club, reservation, courtName, rates, defaultMinutes, onClose, onDone }: { client: SupabaseClient; club: Club; reservation: Reservation; courtName?: string; rates: CourtRateSettings | null; defaultMinutes: number; onClose: () => void; onDone: () => Promise<void> }) {
  const [responsible, setResponsible] = useState<Responsible | null>(null)
  const [picking, setPicking] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [pickerBusy, setPickerBusy] = useState(false)
  const [applyRental, setApplyRental] = useState(false)
  const [applyLighting, setApplyLighting] = useState(false)
  const [minutesText, setMinutesText] = useState(String(defaultMinutes))
  const [rentalAdjust, setRentalAdjust] = useState<string | null>(null)
  const [lightingAdjust, setLightingAdjust] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [touched, setTouched] = useState(false)
  const action = useAsyncAction()
  const search = usePersonSearch(client, club, picking)

  const choose = async (person: Pick<ClubPerson, 'id' | 'full_name'>) => {
    const { data } = await client.from('club_memberships').select('status').eq('club_id', club.id).eq('person_id', person.id).maybeSingle()
    const member = (data as { status?: string } | null)?.status === 'active'
    setResponsible({ id: person.id, name: person.full_name, member })
    const suggestion = suggestedConcepts(member)
    setApplyRental(suggestion.rental); setApplyLighting(suggestion.lighting)
  }
  // El responsable inicial es la ficha vinculada a la reserva (si existe); Rafa puede cambiarlo: no se asume que quien reservó paga.
  useEffect(() => {
    if (!reservation.person_id) return
    let cancelled = false
    void (async () => {
      const { data } = await client.from('club_people').select('id, full_name, active').eq('club_id', club.id).eq('id', reservation.person_id).maybeSingle()
      if (!cancelled && data && (data as ClubPerson).active) await choose(data as ClubPerson)
    })()
    return () => { cancelled = true }
  }, [client, club.id, reservation.person_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const minutes = /^\d+$/.test(minutesText.trim()) ? Number(minutesText.trim()) : 0
  const minutesValid = minutes >= 1 && minutes <= 1440
  const quote = useMemo(() => quoteCharge(rates, minutesValid ? minutes : 0), [rates, minutes, minutesValid])
  const parsed = (text: string | null) => (text === null ? null : parseArsToCents(text))
  const rentalOverride = parsed(rentalAdjust)
  const lightingOverride = parsed(lightingAdjust)
  const rentalFinal = !applyRental ? 0 : rentalAdjust !== null ? rentalOverride : quote.rentalCents
  const lightingFinal = !applyLighting ? 0 : lightingAdjust !== null ? lightingOverride : quote.lightingCents
  const rentalMissing = applyRental && !rentalFinal
  const lightingMissing = applyLighting && !lightingFinal
  const total = (rentalFinal ?? 0) + (lightingFinal ?? 0)
  // Importe manual enviado solo si realmente difiere de lo calculado (si coincide, no es un ajuste).
  const rentalSend = applyRental && rentalAdjust !== null && rentalOverride !== null && rentalOverride !== quote.rentalCents ? rentalOverride : null
  const lightingSend = applyLighting && lightingAdjust !== null && lightingOverride !== null && lightingOverride !== quote.lightingCents ? lightingOverride : null
  const needsReason = rentalSend !== null || lightingSend !== null
  const reasonError = needsReason && reason.trim().length < 3 ? 'Indicá el motivo del ajuste: queda registrado.' : undefined
  const valid = responsible !== null && (applyRental || applyLighting) && minutesValid && !rentalMissing && !lightingMissing && total > 0 && !reasonError
  const uncertain = action.message === UNCERTAIN_RESULT_MESSAGE
  const timeLabel = `${new Intl.DateTimeFormat('es-AR', { timeZone: club.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(reservation.starts_at))}–${new Intl.DateTimeFormat('es-AR', { timeZone: club.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(reservation.ends_at))}`

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTouched(true)
    if (!valid || !responsible) return
    await action.run(async () => {
      const result = await createCourtCharge(client, club, { reservationId: reservation.id, responsiblePersonId: responsible.id, applyRental, applyLighting, billableMinutes: minutes, rentalOverrideCents: rentalSend, lightingOverrideCents: lightingSend, adjustmentReason: needsReason ? reason : '', notes })
      if (!result.ok) return result.message
      await onDone()
      return null
    })
  }

  const minuteChips = [...new Set([defaultMinutes, 60, 90, 120].filter((value) => value > 0))].sort((a, b) => a - b)
  return (
    <>
      <Modal open={!picking} onClose={onClose} busy={action.saving} variant="drawer" size="sm" eyebrow="Cobro de cancha" title={reservation.customer_name ?? 'Reserva'}>
        <form className="res-form" noValidate onSubmit={(event) => void submit(event)}>
          <p className="muted">{courtName ?? 'Cancha'} · {timeLabel} · reservado {durationLabel(defaultMinutes)}. El importe es por cancha y tiempo, no por cantidad de jugadores.</p>

          <fieldset className="form-block">
            <legend className="form-legend">Quién se hace responsable del pago</legend>
            {responsible ? (
              <div className="person-chip-row"><b>{responsible.name}</b> <MemberBadge active membership={responsible.member ? 'active' : undefined} /> <Button variant="ghost" size="sm" onClick={() => { search.reset(); setPicking(true) }}>Cambiar</Button></div>
            ) : <Button variant="secondary" icon="userPlus" onClick={() => { search.reset(); setPicking(true) }}>Elegir persona</Button>}
            {touched && !responsible && <p className="field-error"><Icon name="alert" size={14} />Elegí una persona del club.</p>}
            <p className="detail-footnote"><Icon name="info" size={16} />Un cargo tiene un único responsable. No se divide entre jugadores.</p>
          </fieldset>

          <fieldset className="form-block">
            <legend className="form-legend">Qué se cobra</legend>
            {responsible?.member && <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span>Es socio: el uso habitual de la cancha está incluido. Cobrá alquiler solo si corresponde.</span></p>}
            <Switch checked={applyRental} onChange={setApplyRental} label="Alquiler de cancha" description={rates?.rental_enabled && quote.rentalCents !== null ? `Tarifa: ${formatMoney(quote.rentalCents)} por ${durationLabel(minutesValid ? minutes : 0)}` : 'Sin tarifa activa: ingresá el importe a mano'} />
            <Switch checked={applyLighting} onChange={setApplyLighting} label="Iluminación" description={rates?.lighting_enabled && quote.lightingCents !== null ? `Tarifa: ${formatMoney(quote.lightingCents)} por ${durationLabel(minutesValid ? minutes : 0)}` : 'Sin tarifa activa: ingresá el importe a mano'} />
            {touched && !applyRental && !applyLighting && <p className="field-error"><Icon name="alert" size={14} />Elegí al menos un concepto.</p>}
          </fieldset>

          <Field label="Tiempo a cobrar (minutos)" hint={rates?.billing_mode === 'rounded_up' ? `Se redondea hacia arriba a bloques de ${rates.billing_block_minutes} min.` : 'Se cobra la proporción exacta de la tarifa por hora.'} error={touched && !minutesValid ? 'Indicá entre 1 y 1440 minutos.' : undefined}>
            {(id, describedBy) => <TextInput id={id} inputMode="numeric" value={minutesText} aria-describedby={describedBy} onChange={(event) => setMinutesText(event.target.value)} />}
          </Field>
          <div className="chip-row">{minuteChips.map((value) => <Chip key={value} selected={minutes === value} onClick={() => setMinutesText(String(value))}>{durationLabel(value)}</Chip>)}</div>

          {(applyRental || applyLighting) && (
            <fieldset className="form-block">
              <legend className="form-legend">Importe</legend>
              {applyRental && <AmountRow label="Alquiler" quote={quote.rentalCents} adjust={rentalAdjust} final={rentalFinal} onAdjust={setRentalAdjust} touched={touched} />}
              {applyLighting && <AmountRow label="Iluminación" quote={quote.lightingCents} adjust={lightingAdjust} final={lightingFinal} onAdjust={setLightingAdjust} touched={touched} />}
              {needsReason && (
                <Field label="Motivo del importe ajustado" error={touched ? reasonError : undefined}>
                  {(id, describedBy) => <TextInput id={id} value={reason} aria-describedby={describedBy} placeholder="Ej.: acordado con Rafa" onChange={(event) => setReason(event.target.value)} />}
                </Field>
              )}
            </fieldset>
          )}
          <Field label="Observación" optional>{(id) => <TextArea id={id} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />}</Field>

          <div className="form-footer">
            {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se registró el cargo</strong><p>{action.message}</p></div></div>}
            <p className="form-summary"><Icon name="wallet" size={16} /><span>Total a cargar <b className="num">{formatMoney(total)}</b> · queda pendiente hasta registrar un pago</span></p>
            <div className="form-actions">
              <Button variant="ghost" disabled={action.saving} onClick={onClose}>Volver</Button>
              <Button type="submit" variant="accent" size="lg" icon={uncertain ? 'refresh' : 'check'} loading={action.saving}>{action.saving ? 'Registrando…' : uncertain ? 'Reintentar cargo' : 'Registrar cargo'}</Button>
            </div>
          </div>
        </form>
      </Modal>
      <PersonPicker open={picking} title="Responsable del pago" hint="Persona del club que se hace cargo del importe." items={search.results.map((person) => ({ id: person.id, name: person.full_name, hint: person.phone ?? undefined }))} query={search.query} onQueryChange={search.setQuery} loading={search.loading} busy={pickerBusy} error={pickerError}
        onPick={(id) => { const person = search.results.find((item) => item.id === id); if (person) { setPickerBusy(true); void choose(person).then(() => { setPickerBusy(false); setPicking(false) }) } }}
        onCreate={(name) => { setPickerBusy(true); setPickerError(null); void createQuickPerson(client, club, name).then(async (result) => { if (result.person) { await choose(result.person); setPicking(false) } else setPickerError(result.error ?? 'No pudimos crear la ficha.'); setPickerBusy(false) }) }}
        onClose={() => setPicking(false)} />
    </>
  )
}

function AmountRow({ label, quote, adjust, final, onAdjust, touched }: { label: string; quote: number | null; adjust: string | null; final: number | null; onAdjust: (value: string | null) => void; touched: boolean }) {
  const adjusting = adjust !== null
  const missing = !final
  return (
    <div className="amount-row">
      <div className="amount-row-head">
        <span>{label}</span>
        <strong className="num">{final ? formatMoney(final) : '—'}</strong>
        {!adjusting && quote !== null && <button type="button" className="link-btn" onClick={() => onAdjust(moneyInputValue(quote))}>Ajustar importe</button>}
        {!adjusting && quote === null && <button type="button" className="link-btn" onClick={() => onAdjust('')}>Ingresar importe</button>}
        {adjusting && quote !== null && <button type="button" className="link-btn" onClick={() => onAdjust(null)}>Usar tarifa</button>}
      </div>
      {adjusting && (
        <Field label={`${label}: importe autorizado (ARS)`} error={touched && missing ? 'Indicá un importe mayor a cero.' : undefined}>
          {(id, describedBy) => <MoneyInput id={id} value={adjust ?? ''} aria-describedby={describedBy} placeholder="Ej. 10.000" onChange={(event) => onAdjust(event.target.value)} />}
        </Field>
      )}
    </div>
  )
}

// ── Pago de un cargo (total o parcial) ──────────────────────────────
export function ChargePaymentDialog({ client, club, charge, payments, today, onClose, onDone }: { client: SupabaseClient; club: Club; charge: CourtCharge; payments: CourtChargePayment[]; today: string; onClose: () => void; onDone: (recovered: boolean) => Promise<void> }) {
  const balance = balanceOnCharge(charge, payments)
  const [amount, setAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState(today)
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
    if (cents > balance) return setValidation(`Supera el saldo del cargo (${formatMoney(balance)}). No se aceptan pagos de más.`)
    setValidation(null)
    await action.run(async () => {
      const result = await recordCourtChargePayment(client, club, charge.id, { amountCents: cents, paymentDate, paymentMethod, reference, notes })
      if (!result.ok) return result.message
      await onDone(result.recovered)
      return null
    })
  }

  return (
    <Modal open onClose={onClose} busy={action.saving} variant="drawer" size="sm" eyebrow={`Cobro de cancha · ${chargeConceptLabel(charge)}`} title={charge.responsible_name_snapshot}>
      <form className="res-form" noValidate onSubmit={(event) => void submit(event)}>
        <div className="issue-summary">
          <div><span>Cargo</span><strong className="display num">{formatMoney(charge.total_cents)}</strong></div>
          <div><span>Pagado</span><strong className="display num">{formatMoney(charge.total_cents - balance)}</strong></div>
          <div className="is-total"><span>Pendiente</span><strong className="display num">{formatMoney(balance)}</strong></div>
        </div>
        <Field label="Importe recibido (ARS)" error={validation ?? undefined} hint="Podés registrar un pago parcial.">
          {(id, describedBy) => <MoneyInput id={id} value={amount} placeholder="Ej. 10.000" aria-invalid={Boolean(validation)} aria-describedby={describedBy} onChange={(event) => setAmount(event.target.value)} data-autofocus />}
        </Field>
        <div className="chip-row">
          <Chip selected={cents === balance} onClick={() => setAmount(moneyInputValue(balance))}>Saldo {formatMoney(balance)}</Chip>
          {balance >= 200 && <Chip selected={cents === Math.round(balance / 2)} onClick={() => setAmount(moneyInputValue(Math.round(balance / 2)))}>Mitad</Chip>}
        </div>
        <fieldset className="form-block"><legend className="form-legend">Medio de pago</legend><MethodPicker value={paymentMethod} onChange={setPaymentMethod} /></fieldset>
        <Field label="Fecha del pago">{(id) => <TextInput id={id} type="date" value={paymentDate} max={today} onChange={(event) => event.target.value && setPaymentDate(event.target.value)} required />}</Field>
        {showExtra ? (
          <>
            <Field label="Referencia" optional>{(id) => <TextInput id={id} value={reference} placeholder="N.º de transferencia" onChange={(event) => setReference(event.target.value)} />}</Field>
            <Field label="Observaciones" optional>{(id) => <TextArea id={id} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />}</Field>
          </>
        ) : <button type="button" className="link-btn link-btn-icon" onClick={() => setShowExtra(true)}><Icon name="note" size={18} />Agregar referencia u observaciones</button>}
        <div className="form-footer">
          {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se registró el pago</strong><p>{action.message}</p></div></div>}
          <p className="form-summary"><Icon name="wallet" size={16} />{cents === null ? <span>Ingresá el importe recibido</span> : cents > balance ? <span className="field-error">Supera el saldo de <b className="num">{formatMoney(balance)}</b></span> : remaining === 0 ? <span>El cargo queda <b>saldado</b></span> : <span>Pago parcial · queda saldo de <b className="num">{formatMoney(remaining)}</b></span>}</p>
          <div className="form-actions">
            <Button variant="ghost" disabled={action.saving} onClick={onClose}>Volver</Button>
            <Button type="submit" variant="accent" size="lg" icon={uncertain ? 'refresh' : 'check'} loading={action.saving}>{action.saving ? 'Registrando…' : uncertain ? 'Reintentar pago' : 'Registrar pago'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

/** Cobro desde la cuenta corriente: carga el cargo real y abre el mismo formulario de pago de cancha. */
export function CourtChargePaymentFlow({ client, club, chargeId, onClose, onDone }: { client: SupabaseClient; club: Club; chargeId: string; onClose: () => void; onDone: (recovered: boolean) => Promise<void> }) {
  const [data, setData] = useState<{ charge: CourtCharge; payments: CourtChargePayment[] } | null | 'error'>(null)
  useEffect(() => { let cancelled = false; void fetchCharge(client, club, chargeId).then((result) => { if (!cancelled) setData(result ?? 'error') }).catch(() => { if (!cancelled) setData('error') }); return () => { cancelled = true } }, [client, club, chargeId])
  if (data === null) return null
  if (data === 'error' || balanceOnCharge(data.charge, data.payments) <= 0) {
    return <Modal open onClose={onClose} size="sm" title="Cobro de cancha"><p className="muted">{data === 'error' ? 'No pudimos cargar el cargo. Cerrá y reintentá.' : 'Este cargo ya no tiene saldo pendiente.'}</p><div className="form-actions"><Button variant="primary" onClick={onClose}>Cerrar</Button></div></Modal>
  }
  return <ChargePaymentDialog client={client} club={club} charge={data.charge} payments={data.payments} today={todayInClubTimezone(club.timezone)} onClose={onClose} onDone={onDone} />
}
