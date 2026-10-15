import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club, CourtBillingMode, CourtRateHistoryEntry, CourtRateSettings } from '../../types/domain'
import { Button, Chip, Field, Icon, MoneyInput, Switch } from '../../design/ui'
import { dateShort, durationLabel } from '../../design/dates'
import { moneyInputValue } from '../../design/format'
import { useAsyncAction } from '../../design/useAsyncAction'
import { formatMoney, parseArsToCents } from '../fees/feeUtils'
import { fetchCourtRateHistory, fetchCourtRates, saveCourtRates } from './courtChargeApi'
import { chargeAmountCents } from './courtChargeUtils'

const BLOCKS = [15, 30, 60]
const toText = (cents: number | null) => (cents === null ? '' : moneyInputValue(cents))

type Draft = { rentalPrice: string; lightingPrice: string; rentalEnabled: boolean; lightingEnabled: boolean; mode: CourtBillingMode; block: number }
const toDraft = (rates: CourtRateSettings | null): Draft => ({ rentalPrice: toText(rates?.rental_hour_cents ?? null), lightingPrice: toText(rates?.lighting_hour_cents ?? null), rentalEnabled: rates?.rental_enabled ?? false, lightingEnabled: rates?.lighting_enabled ?? false, mode: rates?.billing_mode ?? 'exact', block: rates?.billing_block_minutes ?? 30 })

/**
 * Tarifas de cancha e iluminación del club (owner/admin). Sin valores precargados: el club define los suyos. Cambiarlas
 * solo afecta cargos NUEVOS; cada cargo conserva la tarifa y el cálculo con que se registró.
 */
export function CourtRatesCard({ client, club }: { client: SupabaseClient; club: Club }) {
  const [saved, setSaved] = useState<CourtRateSettings | null>(null)
  const [draft, setDraft] = useState<Draft>(toDraft(null))
  const [history, setHistory] = useState<CourtRateHistoryEntry[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [showHistory, setShowHistory] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const action = useAsyncAction()

  const load = async () => {
    try {
      const [rates, entries] = await Promise.all([fetchCourtRates(client, club), fetchCourtRateHistory(client, club)])
      setSaved(rates); setDraft(toDraft(rates)); setHistory(entries); setStatus('ready')
    } catch { setStatus('error') }
  }
  useEffect(() => { setStatus('loading'); void load() }, [client, club.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<Draft>) => { setNotice(null); setDraft((current) => ({ ...current, ...patch })) }
  const rentalCents = draft.rentalPrice.trim() ? parseArsToCents(draft.rentalPrice) : null
  const lightingCents = draft.lightingPrice.trim() ? parseArsToCents(draft.lightingPrice) : null
  const rentalInvalid = draft.rentalPrice.trim() !== '' && rentalCents === null
  const lightingInvalid = draft.lightingPrice.trim() !== '' && lightingCents === null
  const rentalNeedsPrice = draft.rentalEnabled && rentalCents === null
  const lightingNeedsPrice = draft.lightingEnabled && lightingCents === null
  const valid = !rentalInvalid && !lightingInvalid && !rentalNeedsPrice && !lightingNeedsPrice
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(saved))
  const block = draft.mode === 'rounded_up' ? draft.block : null
  const example = (hourCents: number | null) => (hourCents ? formatMoney(chargeAmountCents(hourCents, 90, draft.mode, block)) : null)

  const save = () => {
    setTouched(true)
    if (!valid) return
    void action.run(async () => {
      const result = await saveCourtRates(client, club, { rentalHourCents: rentalCents, lightingHourCents: lightingCents, rentalEnabled: draft.rentalEnabled, lightingEnabled: draft.lightingEnabled, billingMode: draft.mode, billingBlockMinutes: block })
      if (!result.ok) return result.message
      setNotice('Tarifas guardadas. Se aplican a los cargos nuevos; los anteriores no cambian.')
      setTouched(false)
      await load()
      return null
    })
  }

  return (
    <section className="settings-card settings-card-wide" aria-labelledby="st-rates">
      <header className="settings-card-head">
        <span className="settings-icon is-accent"><Icon name="cash" size={22} /></span>
        <div><h3 id="st-rates">Tarifas de cancha e iluminación</h3><p>Precio por hora de una cancha, sin importar cuántos jueguen. Los socios tienen el uso habitual incluido en la cuota.</p></div>
      </header>
      {status === 'loading' && <p className="muted">Cargando tarifas…</p>}
      {status === 'error' && <p className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><span>No pudimos cargar las tarifas. <button type="button" className="link-btn" onClick={() => void load()}>Reintentar</button></span></p>}
      {status === 'ready' && (
        <>
          {!saved && <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span>Todavía no hay tarifas. La app no trae precios oficiales: cargá los que acuerde el club. Mientras tanto, los cargos pueden hacerse con importe manual.</span></p>}
          {notice && <p className="inline-alert inline-alert-success" role="status"><Icon name="checkCircle" size={20} /><span>{notice}</span></p>}
          <div className="rate-grid">
            <div className="rate-block">
              <Switch checked={draft.rentalEnabled} onChange={(value) => set({ rentalEnabled: value })} label="Alquiler de cancha" description="Para no socios, o cuando el club lo decida." />
              <Field label="Precio por hora (ARS)" error={rentalInvalid ? 'Importe no válido.' : touched && rentalNeedsPrice ? 'Indicá el precio para activar la tarifa.' : undefined}>
                {(id, describedBy) => <MoneyInput id={id} value={draft.rentalPrice} aria-describedby={describedBy} placeholder="Ej. 10.000" onChange={(event) => set({ rentalPrice: event.target.value })} />}
              </Field>
              {example(rentalCents) && <p className="field-hint">Ejemplo: 90 min = {example(rentalCents)}</p>}
            </div>
            <div className="rate-block">
              <Switch checked={draft.lightingEnabled} onChange={(value) => set({ lightingEnabled: value })} label="Iluminación" description="Nunca se asume por la hora: se confirma en cada cobro." />
              <Field label="Precio por hora (ARS)" error={lightingInvalid ? 'Importe no válido.' : touched && lightingNeedsPrice ? 'Indicá el precio para activar la tarifa.' : undefined}>
                {(id, describedBy) => <MoneyInput id={id} value={draft.lightingPrice} aria-describedby={describedBy} placeholder="Ej. 4.000" onChange={(event) => set({ lightingPrice: event.target.value })} />}
              </Field>
              {example(lightingCents) && <p className="field-hint">Ejemplo: 90 min = {example(lightingCents)}</p>}
            </div>
          </div>
          <fieldset className="form-block">
            <legend className="form-legend">Cómo se calcula la duración</legend>
            <div className="chip-row">
              <Chip selected={draft.mode === 'exact'} onClick={() => set({ mode: 'exact' })}>Proporcional exacto</Chip>
              <Chip selected={draft.mode === 'rounded_up'} onClick={() => set({ mode: 'rounded_up' })}>Redondear hacia arriba</Chip>
            </div>
            {draft.mode === 'rounded_up' && <div className="chip-row">{BLOCKS.map((minutes) => <Chip key={minutes} selected={draft.block === minutes} onClick={() => set({ block: minutes })}>Bloques de {durationLabel(minutes)}</Chip>)}</div>}
            <p className="detail-footnote"><Icon name="info" size={16} />{draft.mode === 'exact' ? '90 minutos se cobran como una hora y media.' : `Los minutos se redondean hacia arriba a bloques de ${draft.block} min.`} Al cobrar siempre se puede ajustar el tiempo o el importe, con motivo.</p>
          </fieldset>
          {action.failed && <p className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><span>{action.message}</span></p>}
          <div className="form-actions">
            <Button variant="ghost" disabled={!dirty || action.saving} onClick={() => { setDraft(toDraft(saved)); setTouched(false); action.reset() }}>Descartar</Button>
            <Button variant="primary" icon="check" loading={action.saving} disabled={!dirty} onClick={save}>Guardar tarifas</Button>
          </div>
          {history.length > 0 && (
            <>
              <button type="button" className="link-btn link-btn-icon" onClick={() => setShowHistory((value) => !value)}><Icon name="list" size={18} />{showHistory ? 'Ocultar historial de tarifas' : `Historial de tarifas (${history.length})`}</button>
              {showHistory && (
                <ul className="mini-list">
                  {history.map((entry) => (
                    <li key={entry.id}>
                      <span>{dateShort(entry.changed_at.slice(0, 10))} · alquiler {entry.rental_hour_cents ? `${formatMoney(entry.rental_hour_cents)}/h${entry.rental_enabled ? '' : ' (inactiva)'}` : 'sin precio'} · luz {entry.lighting_hour_cents ? `${formatMoney(entry.lighting_hour_cents)}/h${entry.lighting_enabled ? '' : ' (inactiva)'}` : 'sin precio'}</span>
                      <span>{entry.billing_mode === 'exact' ? 'Proporcional' : `Bloques de ${entry.billing_block_minutes} min`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
