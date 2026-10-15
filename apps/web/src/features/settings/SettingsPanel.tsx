import { useEffect, useState, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club, ClubFeeSettings, Court, OnlineBookingSettings } from '../../types/domain'
import { formatMoney } from '../fees/feeUtils'
import { Chip, ErrorState, Icon, NumberStepper, PageHead, SelectInput, SkeletonCards, Switch, type IconName } from '../../design/ui'
import { SaveBar } from '../../design/domain'
import { durationLabel, fromMinutes, toMinutes } from '../../design/dates'
import { plural } from '../../design/format'
import { useAsyncAction } from '../../design/useAsyncAction'
import type { AdminSection } from '../shell/AdminShell'

const defaults: OnlineBookingSettings = { enabled: false, opens_at: '07:00', closes_at: '23:00', max_advance_days: 7, allowed_durations_minutes: [60, 90], max_active_reservations: 2, cancellation_lead_minutes: 120, configured: false }
const BASE_DURATIONS = [30, 60, 90, 120]
const BASE_LEADS = [0, 60, 120, 180, 360, 720, 1440]
const hhmm = (value: string) => value.slice(0, 5)
const leadLabel = (minutes: number) => (minutes === 0 ? 'Hasta el inicio' : minutes < 60 ? `${minutes} min antes` : minutes < 1440 ? `${minutes / 60 % 1 === 0 ? minutes / 60 : (minutes / 60).toFixed(1)} h antes` : minutes === 1440 ? '1 día antes' : `${(minutes / 1440).toFixed(minutes % 1440 === 0 ? 0 : 1)} días antes`)
const sortedUnique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b)

function rulesSentence(rules: OnlineBookingSettings): string {
  const lengths = rules.allowed_durations_minutes.map((minutes) => durationLabel(minutes)).join(' o ')
  return `De ${hhmm(rules.opens_at)} a ${hhmm(rules.closes_at)} · turnos de ${lengths} · hasta ${plural(rules.max_advance_days, 'día', 'días')} antes · máx. ${plural(rules.max_active_reservations, 'turno activo', 'turnos activos')} · cancelación ${rules.cancellation_lead_minutes ? `hasta ${leadLabel(rules.cancellation_lead_minutes)}` : 'hasta el inicio'}`
}

/**
 * Configuración del club: solo lo que producción soporta hoy (reglas de reservas online y accesos a canchas, cuota
 * mensual e invitaciones). Nombre, localidad y teléfono del club no se editan: no existen en el backend actual.
 */
export function SettingsPanel({ client, club, courts, onNavigate }: { client: SupabaseClient; club: Club; courts: Court[]; onNavigate: (section: AdminSection) => void }) {
  const [saved, setSaved] = useState<OnlineBookingSettings | null>(null)
  const [rules, setRules] = useState<OnlineBookingSettings>(defaults)
  const [fees, setFees] = useState<ClubFeeSettings | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [notice, setNotice] = useState<string | null>(null)
  const action = useAsyncAction()

  const load = async () => {
    setStatus('loading')
    const [settingsResult, feeResult] = await Promise.all([
      client.rpc('get_online_booking_settings', { p_club_id: club.id }),
      client.from('club_fee_settings').select('club_id, monthly_amount_cents, due_day, currency, updated_at, updated_by').eq('club_id', club.id).maybeSingle(),
    ])
    if (settingsResult.error) { setStatus('error'); return }
    const next = (settingsResult.data as OnlineBookingSettings | null) ?? defaults
    setSaved(next); setRules(next); setFees(feeResult.error ? null : (feeResult.data as ClubFeeSettings | null)); setStatus('ready')
  }
  useEffect(() => { void load() }, [client, club.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = saved !== null && JSON.stringify(rules) !== JSON.stringify(saved)
  const set = (patch: Partial<OnlineBookingSettings>) => { setNotice(null); setRules((current) => ({ ...current, ...patch })) }
  const durations = sortedUnique([...BASE_DURATIONS, ...rules.allowed_durations_minutes])
  const leads = sortedUnique([...BASE_LEADS, rules.cancellation_lead_minutes])
  const toggleDuration = (minutes: number) => {
    const next = rules.allowed_durations_minutes.includes(minutes) ? rules.allowed_durations_minutes.filter((item) => item !== minutes) : sortedUnique([...rules.allowed_durations_minutes, minutes])
    if (next.length > 0) set({ allowed_durations_minutes: next })
  }
  const grid = (from: number, to: number, current: string) => {
    const list = Array.from({ length: Math.floor((to - from) / 30) + 1 }, (_, index) => fromMinutes(from + index * 30))
    return list.includes(current) ? list : [...list, current].sort()
  }
  const opens = toMinutes(rules.opens_at)
  const closes = toMinutes(rules.closes_at)
  const invalidHours = closes <= opens

  const save = () => {
    if (invalidHours) return
    void action.run(async () => {
      const { error } = await client.rpc('set_online_booking_settings', { p_club_id: club.id, p_enabled: rules.enabled, p_opens_at: hhmm(rules.opens_at), p_closes_at: hhmm(rules.closes_at), p_max_advance_days: rules.max_advance_days, p_allowed_durations_minutes: rules.allowed_durations_minutes, p_max_active_reservations: rules.max_active_reservations, p_cancellation_lead_minutes: rules.cancellation_lead_minutes })
      if (error) return 'No pudimos guardar la configuración de reservas online.'
      setNotice('Reglas de reservas guardadas.')
      await load()
      return null
    })
  }

  return (
    <div className="module settings">
      <PageHead eyebrow="Configuración" title="Configuración del club" meta="Lo que ven el equipo y los jugadores en el portal" />
      {notice && <p className="inline-alert inline-alert-success" role="status"><Icon name="checkCircle" size={20} /><span>{notice}</span></p>}

      {status === 'error' ? <ErrorState title="No pudimos cargar la configuración" onRetry={() => void load()} />
        : status === 'loading' ? <SkeletonCards count={3} height={140} />
          : (
            <div className="settings-grid">
              <section className="settings-card" aria-labelledby="st-club">
                <header className="settings-card-head">
                  <span className="settings-icon"><Icon name="home" size={22} /></span>
                  <div><h3 id="st-club">Club</h3><p>Datos del club en la app.</p></div>
                </header>
                <dl className="settings-list">
                  <div><dt>Nombre</dt><dd>{club.name}</dd></div>
                  <div><dt>Hora del club</dt><dd><Icon name="lock" size={14} />{club.timezone === 'America/Argentina/Buenos_Aires' ? 'Argentina (Buenos Aires)' : club.timezone.replace(/_/g, ' ')}</dd></div>
                </dl>
                <p className="detail-footnote"><Icon name="info" size={16} />El nombre, la localidad y el teléfono del club todavía no se editan desde la app.</p>
              </section>

              <section className="settings-card" aria-labelledby="st-links">
                <header className="settings-card-head">
                  <span className="settings-icon"><Icon name="sliders" size={22} /></span>
                  <div><h3 id="st-links">Más ajustes</h3><p>Accesos rápidos a otras configuraciones.</p></div>
                </header>
                <ul className="settings-links">
                  <SettingsLink icon="court" title="Canchas" value={`${courts.filter((court) => court.active).length} de ${courts.length} activas`} onClick={() => onNavigate('courts')} />
                  <SettingsLink icon="wallet" title="Cuota mensual" value={fees ? `${formatMoney(fees.monthly_amount_cents)} · vence el día ${fees.due_day}` : 'Sin configurar'} onClick={() => onNavigate('fees')} />
                  <SettingsLink icon="key" title="Invitaciones al portal" value="Códigos de un solo uso" onClick={() => onNavigate('playerAccess')} />
                  <SettingsLink icon="calendar" title="Grilla de la agenda" value="07:00 a 23:00 · cada 30 min" />
                </ul>
              </section>

              <section className="settings-card settings-card-wide" aria-labelledby="st-rules">
                <header className="settings-card-head">
                  <span className="settings-icon is-accent"><Icon name="portal" size={22} /></span>
                  <div><h3 id="st-rules">Reservas online</h3><p>Qué pueden reservar los jugadores desde el portal. En la administración no hay límites.</p></div>
                </header>
                {!rules.configured && <p className="inline-alert inline-alert-info"><Icon name="info" size={20} /><span>Todavía no se guardaron reglas: se muestran valores iniciales. Confirmalos con el club antes de habilitar las reservas online.</span></p>}

                <div className={`rules-master ${rules.enabled ? 'is-on' : ''}`}>
                  <Switch checked={rules.enabled} onChange={(enabled) => set({ enabled })} label={rules.enabled ? 'Reservas online habilitadas' : 'Reservas online pausadas'} description={rules.enabled ? 'Los jugadores con cuenta pueden reservar y cancelar.' : 'El portal muestra los turnos, pero no permite reservar.'} />
                </div>

                <div className={`rules ${rules.enabled ? '' : 'is-disabled'}`}>
                  <RuleRow icon="clock" title="Horario" help="Primer y último horario en que puede empezar o terminar un turno online.">
                    <div className="rule-hours">
                      <span>De</span>
                      <SelectInput aria-label="Desde" value={hhmm(rules.opens_at)} onChange={(event) => set({ opens_at: event.target.value })}>
                        {grid(6 * 60, 22 * 60, hhmm(rules.opens_at)).map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                      </SelectInput>
                      <span>a</span>
                      <SelectInput aria-label="Hasta" value={hhmm(rules.closes_at)} onChange={(event) => set({ closes_at: event.target.value })}>
                        {grid(7 * 60, 23 * 60 + 30, hhmm(rules.closes_at)).map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                      </SelectInput>
                    </div>
                    {invalidHours && <p className="field-error"><Icon name="alert" size={14} />El cierre debe ser posterior a la apertura.</p>}
                  </RuleRow>
                  <RuleRow icon="calendar" title="Duraciones permitidas" help="Elegí una o más. Siempre queda al menos una.">
                    <div className="chip-row">{durations.map((minutes) => <Chip key={minutes} selected={rules.allowed_durations_minutes.includes(minutes)} icon={rules.allowed_durations_minutes.includes(minutes) ? 'check' : undefined} onClick={() => toggleDuration(minutes)}>{durationLabel(minutes)}</Chip>)}</div>
                  </RuleRow>
                  <RuleRow icon="arrowRight" title="Anticipación" help="Con cuántos días de anticipación se puede reservar.">
                    <NumberStepper label="Días de anticipación" value={rules.max_advance_days} onChange={(max_advance_days) => set({ max_advance_days })} min={0} max={90} unit={(value) => (value === 0 ? 'solo hoy' : value === 1 ? 'día antes' : 'días antes')} />
                  </RuleRow>
                  <RuleRow icon="users" title="Turnos activos por jugador" help="Reservas futuras que puede tener a la vez.">
                    <NumberStepper label="Turnos activos" value={rules.max_active_reservations} onChange={(max_active_reservations) => set({ max_active_reservations })} min={1} max={20} unit={(value) => (value === 1 ? 'turno' : 'turnos')} />
                  </RuleRow>
                  <RuleRow icon="x" title="Cancelación online" help="Hasta cuándo el jugador puede cancelar solo. Después, consulta al club.">
                    <div className="chip-row">{leads.map((minutes) => <Chip key={minutes} selected={rules.cancellation_lead_minutes === minutes} onClick={() => set({ cancellation_lead_minutes: minutes })}>{leadLabel(minutes)}</Chip>)}</div>
                  </RuleRow>
                </div>

                <div className="rules-preview">
                  <p className="kicker">Así lo ve el jugador</p>
                  <div className="rules-preview-card">
                    <Icon name={rules.enabled ? 'info' : 'lock'} size={18} />
                    <p>{rules.enabled ? rulesSentence(rules) : 'Las reservas online están pausadas. Reservá llamando o pasando por el club.'}</p>
                  </div>
                </div>
              </section>
            </div>
          )}

      <SaveBar visible={dirty || action.failed} saving={action.saving} failed={action.failed} onDiscard={() => { if (saved) setRules(saved); action.reset() }} onSave={save} />
    </div>
  )
}

function SettingsLink({ icon, title, value, onClick }: { icon: IconName; title: string; value: string; onClick?: () => void }) {
  const body = <><span className="todo-icon"><Icon name={icon} size={20} /></span><span className="todo-text"><strong>{title}</strong><span>{value}</span></span>{onClick ? <Icon name="chevronRight" size={18} className="row-chevron" /> : <Icon name="lock" size={16} className="row-chevron" />}</>
  return <li>{onClick ? <button type="button" className="todo-row" onClick={onClick}>{body}</button> : <div className="todo-row is-static">{body}</div>}</li>
}

function RuleRow({ icon, title, help, children }: { icon: IconName; title: string; help: string; children: ReactNode }) {
  return (
    <div className="rule-row">
      <span className="rule-icon"><Icon name={icon} size={18} /></span>
      <div className="rule-text"><strong>{title}</strong><span>{help}</span></div>
      <div className="rule-control">{children}</div>
    </div>
  )
}
