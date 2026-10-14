import { useState, type ReactNode } from 'react'
import { type BookingRules } from '../../data/mock'
import { SaveBar } from '../../components/domain'
import { Button, Chip, Field, Icon, Modal, NumberStepper, PageHead, SelectInput, Switch, TextInput, type IconName } from '../../components/ui'
import { useAdmin } from '../../lib/admin'
import { useAction, useCourts } from '../../lib/data'
import { formatARS, plural } from '../../lib/format'
import { useProto } from '../../lib/proto'
import { useStore } from '../../lib/store'
import { duration, hhmm, slots } from '../../lib/time'
import { FeesDialog } from './Dues'

const DURATIONS = [30, 60, 90, 120]
const LEADS = [0, 1, 2, 3, 6, 12, 24]
const leadLabel = (hours: number) => (hours === 0 ? 'Hasta el inicio' : hours < 24 ? `${hours} h antes` : '1 día antes')

/** Frase única con las reglas, igual a como la lee el jugador en el portal. */
function rulesSentence(rules: BookingRules): string {
  const lengths = rules.durations.map((minutes) => duration(minutes)).join(' o ')
  return `De ${hhmm(rules.opensAt)} a ${hhmm(rules.closesAt)} · turnos de ${lengths} · hasta ${plural(rules.maxAdvanceDays, 'día', 'días')} antes · máx. ${plural(rules.maxActive, 'turno activo', 'turnos activos')} · cancelación ${rules.cancelLeadHours ? `hasta ${leadLabel(rules.cancelLeadHours)}` : 'hasta el inicio'}`
}

export function Settings() {
  const { state, dispatch } = useStore()
  const { notify } = useProto()
  const { go } = useAdmin()
  const { courts, active } = useCourts()
  const action = useAction()
  const [rules, setRules] = useState<BookingRules>(state.bookingRules)
  const [club, setClub] = useState(false)
  const [fees, setFees] = useState(false)
  const dirty = JSON.stringify(rules) !== JSON.stringify(state.bookingRules)
  const set = (patch: Partial<BookingRules>) => setRules({ ...rules, ...patch })
  const toggleDuration = (minutes: number) => {
    const next = rules.durations.includes(minutes) ? rules.durations.filter((item) => item !== minutes) : [...rules.durations, minutes].sort((a, b) => a - b)
    if (next.length > 0) set({ durations: next })
  }
  const save = () => void action.run(() => {
    dispatch({ type: 'rules/save', rules })
    notify({ tone: 'success', title: 'Reglas de reservas guardadas', body: rules.enabled ? 'El portal ya usa las reglas nuevas.' : 'Las reservas online quedaron pausadas.' })
  })
  const closes = slots(rules.opensAt + 60, 24 * 60 + 1, 30)

  return (
    <div className="module settings">
      <PageHead eyebrow="Configuración" title="Configuración del club" meta="Lo que ven el equipo y los jugadores en el portal" />

      <div className="settings-grid">
        <section className="settings-card" aria-labelledby="st-club">
          <header className="settings-card-head">
            <span className="settings-icon"><Icon name="home" size={22} /></span>
            <div><h3 id="st-club">Club</h3><p>Datos visibles en la app y en el portal.</p></div>
            <Button variant="secondary" size="sm" icon="edit" onClick={() => setClub(true)}>Editar</Button>
          </header>
          <dl className="settings-list">
            <div><dt>Nombre</dt><dd>{state.club.name}</dd></div>
            <div><dt>Localidad</dt><dd>{state.club.city}</dd></div>
            <div><dt>Teléfono</dt><dd>{state.club.phone}</dd></div>
            <div><dt>Hora del club</dt><dd><Icon name="lock" size={14} />Argentina (Buenos Aires)</dd></div>
          </dl>
        </section>

        <section className="settings-card" aria-labelledby="st-links">
          <header className="settings-card-head">
            <span className="settings-icon"><Icon name="sliders" size={22} /></span>
            <div><h3 id="st-links">Más ajustes</h3><p>Accesos rápidos a otras configuraciones.</p></div>
          </header>
          <ul className="settings-links">
            <SettingsLink icon="court" title="Canchas" value={`${active.length} de ${courts.length} activas`} onClick={() => go('/admin/canchas')} />
            <SettingsLink icon="wallet" title="Cuota mensual" value={`${formatARS(state.fees.monthlyCents)} · vence el día ${state.fees.dueDay}`} onClick={() => setFees(true)} />
            <SettingsLink icon="key" title="Invitaciones al portal" value={`${state.invitations.filter((item) => !item.redeemedOn && !item.revokedOn).length} pendientes`} onClick={() => go('/admin/portal')} />
            <SettingsLink icon="calendar" title="Grilla de la agenda" value="07:00 a 23:00 · cada 30 min" />
          </ul>
        </section>

        <section className="settings-card settings-card-wide" aria-labelledby="st-rules">
          <header className="settings-card-head">
            <span className="settings-icon is-accent"><Icon name="portal" size={22} /></span>
            <div><h3 id="st-rules">Reservas online</h3><p>Qué pueden reservar los jugadores desde el portal. En la administración no hay límites.</p></div>
          </header>

          <div className={`rules-master ${rules.enabled ? 'is-on' : ''}`}>
            <Switch checked={rules.enabled} onChange={(enabled) => set({ enabled })} label={rules.enabled ? 'Reservas online habilitadas' : 'Reservas online pausadas'} description={rules.enabled ? 'Los jugadores con cuenta pueden reservar y cancelar.' : 'El portal muestra los turnos, pero no permite reservar.'} />
          </div>

          <div className={`rules ${rules.enabled ? '' : 'is-disabled'}`}>
            <RuleRow icon="clock" title="Horario" help="Primer y último horario en que puede empezar o terminar un turno online.">
              <div className="rule-hours">
                <span>De</span>
                <SelectInput aria-label="Desde" value={rules.opensAt} onChange={(event) => { const opensAt = Number(event.target.value); set({ opensAt, closesAt: Math.max(rules.closesAt, opensAt + 60) }) }}>
                  {slots(6 * 60, 22 * 60 + 1, 30).map((slot) => <option key={slot} value={slot}>{hhmm(slot)}</option>)}
                </SelectInput>
                <span>a</span>
                <SelectInput aria-label="Hasta" value={rules.closesAt} onChange={(event) => set({ closesAt: Number(event.target.value) })}>
                  {closes.map((slot) => <option key={slot} value={slot}>{slot === 24 * 60 ? '24:00' : hhmm(slot)}</option>)}
                </SelectInput>
              </div>
            </RuleRow>
            <RuleRow icon="calendar" title="Duraciones permitidas" help="Elegí una o más. Siempre queda al menos una.">
              <div className="chip-row">{DURATIONS.map((minutes) => <Chip key={minutes} selected={rules.durations.includes(minutes)} icon={rules.durations.includes(minutes) ? 'check' : undefined} onClick={() => toggleDuration(minutes)}>{duration(minutes)}</Chip>)}</div>
            </RuleRow>
            <RuleRow icon="arrowRight" title="Anticipación" help="Con cuántos días de anticipación se puede reservar.">
              <NumberStepper label="Días de anticipación" value={rules.maxAdvanceDays} onChange={(maxAdvanceDays) => set({ maxAdvanceDays })} min={0} max={30} unit={(value) => (value === 0 ? 'solo hoy' : value === 1 ? 'día antes' : 'días antes')} />
            </RuleRow>
            <RuleRow icon="users" title="Turnos activos por jugador" help="Reservas futuras que puede tener a la vez.">
              <NumberStepper label="Turnos activos" value={rules.maxActive} onChange={(maxActive) => set({ maxActive })} min={1} max={10} unit={(value) => (value === 1 ? 'turno' : 'turnos')} />
            </RuleRow>
            <RuleRow icon="x" title="Cancelación online" help="Hasta cuándo el jugador puede cancelar solo. Después, consulta al club.">
              <div className="chip-row">{LEADS.map((hours) => <Chip key={hours} selected={rules.cancelLeadHours === hours} onClick={() => set({ cancelLeadHours: hours })}>{leadLabel(hours)}</Chip>)}</div>
            </RuleRow>
          </div>

          <div className="rules-preview">
            <p className="eyebrow">Así lo ve el jugador</p>
            <div className="rules-preview-card">
              <Icon name={rules.enabled ? 'info' : 'lock'} size={18} />
              <p>{rules.enabled ? rulesSentence(rules) : 'Las reservas online están pausadas. Reservá llamando o pasando por el club.'}</p>
            </div>
            <p className="detail-footnote"><Icon name="alert" size={16} />Valores ficticios. Las reglas reales las define el club (pendiente de validar con Rafa).</p>
          </div>
        </section>
      </div>

      <SaveBar visible={dirty} saving={action.saving} failed={action.failed} onDiscard={() => { setRules(state.bookingRules); action.reset() }} onSave={save} />
      <ClubDialog open={club} onClose={() => setClub(false)} />
      <FeesDialog open={fees} onClose={() => setFees(false)} />
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

function ClubDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Modal open={open} onClose={onClose} size="sm" eyebrow="Configuración" title="Datos del club">{open && <ClubForm onClose={onClose} />}</Modal>
}

function ClubForm({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore()
  const { notify } = useProto()
  const action = useAction()
  const [name, setName] = useState(state.club.name)
  const [city, setCity] = useState(state.club.city)
  const [phone, setPhone] = useState(state.club.phone)
  const [touched, setTouched] = useState(false)
  const error = touched && name.trim().length < 2 ? 'El club necesita un nombre.' : undefined
  const save = () => {
    setTouched(true)
    if (name.trim().length < 2) return
    void action.run(() => {
      dispatch({ type: 'club/save', club: { ...state.club, name: name.trim(), city: city.trim(), phone: phone.trim() } })
      notify({ tone: 'success', title: 'Datos del club guardados' })
      onClose()
    })
  }
  return (
    <div className="res-form">
      <Field label="Nombre" error={error}>{(id, describedBy) => <TextInput id={id} value={name} aria-describedby={describedBy} onChange={(event) => setName(event.target.value)} data-autofocus />}</Field>
      <Field label="Localidad" optional>{(id) => <TextInput id={id} value={city} onChange={(event) => setCity(event.target.value)} />}</Field>
      <Field label="Teléfono de contacto" optional hint="Se muestra en el portal para consultas.">{(id, describedBy) => <TextInput id={id} type="tel" icon="phone" value={phone} aria-describedby={describedBy} onChange={(event) => setPhone(event.target.value)} />}</Field>
      {action.failed && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No se guardó</strong><p>Reintentá en un momento.</p></div></div>}
      <div className="form-actions">
        <Button variant="ghost" onClick={onClose} disabled={action.saving}>Cancelar</Button>
        <Button variant="primary" icon={action.failed ? 'refresh' : 'check'} loading={action.saving} onClick={save}>{action.failed ? 'Reintentar' : 'Guardar'}</Button>
      </div>
    </div>
  )
}
