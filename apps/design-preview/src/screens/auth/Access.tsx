/*
 * Acceso simulado: inicio de sesión, registro, confirmación, canje de invitación y elección de experiencia.
 * No usa Supabase Auth ni guarda nada: los emails de demostración solo eligen a qué pantalla se llega.
 */
import { useState, type FormEvent } from 'react'
import { groupCode, invitationStatus, normalizeCode } from '../../data/mock'
import { Button, Crest, Field, Icon, TextInput } from '../../components/ui'
import { usePeople } from '../../lib/data'
import { useProto } from '../../lib/proto'
import type { RoutePath } from '../../lib/router'
import { useStore } from '../../lib/store'

type Step = 'login' | 'register' | 'registered' | 'redeem' | 'redeemed' | 'choose'
type Demo = { email: string; label: string; detail: string; icon: 'home' | 'portal' | 'swap' | 'key'; target: 'admin' | 'player' | 'both' | 'unlinked' }
const DEMOS: Demo[] = [
  { email: 'admin@club.test', label: 'Administración', detail: 'Personal del club', icon: 'home', target: 'admin' },
  { email: 'martina@correo.test', label: 'Jugadora', detail: 'Martina, con cuenta', icon: 'portal', target: 'player' },
  { email: 'rafa@club.test', label: 'Ambos accesos', detail: 'Elige experiencia', icon: 'swap', target: 'both' },
  { email: 'nueva@correo.test', label: 'Cuenta sin club', detail: 'Debe canjear', icon: 'key', target: 'unlinked' },
]
const DEMO_PASSWORD = 'demo1234'
const validEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value.trim())

export function Access({ go }: { go: (path: RoutePath) => void }) {
  const { state } = useStore()
  const [step, setStep] = useState<Step>('login')
  const [email, setEmail] = useState('')
  const [redeemedName, setRedeemedName] = useState('')

  return (
    <div className="auth">
      <aside className="auth-brand texture-court">
        <div className="auth-brand-inner">
          <Crest size={112} className="auth-crest" />
          <p className="eyebrow eyebrow-on-dark">{state.club.city}</p>
          <h1 className="display">{state.club.name}</h1>
          <p className="auth-tagline">Reservá cancha, seguí tus torneos y tus cuotas desde el celular.</p>
          <ul className="auth-points" aria-label="Qué podés hacer">
            <li><Icon name="calendar" size={18} />Turnos en segundos</li>
            <li><Icon name="trophy" size={18} />Cuadros y partidos</li>
            <li><Icon name="wallet" size={18} />Estado de cuotas</li>
          </ul>
        </div>
      </aside>

      <main className="auth-main" id="contenido">
        <div className="auth-card">
          <p className="proto-note"><Icon name="info" size={16} />Prototipo: no ingreses datos reales. Nada se envía ni se guarda.</p>
          {step === 'login' && <Login initialEmail={email} onRegister={() => setStep('register')} onDone={(target, value) => { setEmail(value); if (target === 'admin') go('/admin/inicio'); else if (target === 'player') go('/jugador/inicio'); else setStep(target === 'both' ? 'choose' : 'redeem') }} />}
          {step === 'register' && <Register onLogin={() => setStep('login')} onDone={(value) => { setEmail(value); setStep('registered') }} />}
          {step === 'registered' && (
            <section className="auth-step auth-done" aria-labelledby="reg-title">
              <span className="success-icon"><Icon name="mail" size={40} /></span>
              <h2 id="reg-title" className="display">Revisá tu email</h2>
              <p>Te enviamos un enlace a <b>{email}</b> para confirmar la cuenta. Después iniciá sesión y canjeá la invitación que te dio el club.</p>
              <Button variant="accent" size="lg" block iconRight="arrowRight" onClick={() => setStep('login')}>Ya confirmé, ingresar</Button>
              <p className="muted auth-small">¿No llegó? Revisá spam o pedile ayuda al club. <span className="menu-item-note">simulado</span></p>
            </section>
          )}
          {step === 'redeem' && <Redeem email={email} onSignOut={() => setStep('login')} onDone={(name) => { setRedeemedName(name); setStep('redeemed') }} />}
          {step === 'redeemed' && (
            <section className="auth-step auth-done" aria-labelledby="ok-title">
              <span className="success-icon"><Icon name="checkCircle" size={44} /></span>
              <h2 id="ok-title" className="display">¡Listo, {redeemedName.split(' ')[0]}!</h2>
              <p>Tu cuenta quedó vinculada a tu ficha de <b>{state.club.name}</b>. Ya podés reservar y ver tus torneos.</p>
              <Button variant="accent" size="lg" block iconRight="arrowRight" onClick={() => go('/jugador/inicio')}>Ir a mi portal</Button>
            </section>
          )}
          {step === 'choose' && (
            <section className="auth-step" aria-labelledby="choose-title">
              <p className="eyebrow">{email}</p>
              <h2 id="choose-title" className="display">¿Cómo querés entrar?</h2>
              <p className="muted">Tu cuenta tiene acceso administrativo y de jugador. Podés cambiar después desde «Cuenta».</p>
              <div className="choose-grid">
                <button type="button" className="choose-card" onClick={() => go('/admin/inicio')}>
                  <span className="choose-icon"><Icon name="grid" size={26} /></span>
                  <strong>Administración</strong>
                  <span>Agenda, cantina, cuotas, escuela y torneos</span>
                  <Icon name="arrowRight" size={20} className="choose-arrow" />
                </button>
                <button type="button" className="choose-card" onClick={() => go('/jugador/inicio')}>
                  <span className="choose-icon is-ball"><Icon name="portal" size={26} /></span>
                  <strong>Mi portal</strong>
                  <span>Mis turnos, reservas y torneos</span>
                  <Icon name="arrowRight" size={20} className="choose-arrow" />
                </button>
              </div>
              <button type="button" className="link-btn" onClick={() => setStep('login')}>Cerrar sesión</button>
            </section>
          )}
        </div>
        <button type="button" className="auth-skip" onClick={() => go('/sistema')}><Icon name="layers" size={16} />Design system</button>
      </main>
    </div>
  )
}

function PasswordInput({ id, value, onChange, describedBy, invalid, autoComplete }: { id: string; value: string; onChange: (value: string) => void; describedBy?: string; invalid?: boolean; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="password-wrap">
      <TextInput id={id} icon="lock" type={show ? 'text' : 'password'} value={value} autoComplete={autoComplete} aria-describedby={describedBy} aria-invalid={invalid} onChange={(event) => onChange(event.target.value)} />
      <button type="button" className="password-toggle" aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={show} onClick={() => setShow(!show)}><Icon name={show ? 'eyeOff' : 'eye'} size={18} /></button>
    </span>
  )
}

function Login({ initialEmail, onRegister, onDone }: { initialEmail: string; onRegister: () => void; onDone: (target: Demo['target'], email: string) => void }) {
  const { simulate } = useProto()
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState(initialEmail ? DEMO_PASSWORD : '')
  const [touched, setTouched] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error' | 'network'>('idle')
  const emailError = touched && !validEmail(email) ? 'Escribí un email válido.' : undefined
  const passError = touched && password.length < 6 ? 'La contraseña tiene al menos 6 caracteres.' : undefined

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    setTouched(true)
    if (!validEmail(email) || password.length < 6) return
    setStatus('saving')
    try { await simulate(900) } catch { setStatus('network'); return }
    const demo = DEMOS.find((item) => item.email === email.trim().toLowerCase())
    if (!demo || password !== DEMO_PASSWORD) { setStatus('error'); return }
    setStatus('idle')
    onDone(demo.target, demo.email)
  }

  return (
    <form className="auth-step" onSubmit={(event) => void submit(event)} noValidate aria-labelledby="login-title">
      <h2 id="login-title" className="display">Ingresar</h2>
      <p className="muted">Para administrar el club o entrar a tu portal de jugador.</p>
      <div className="demo-accounts" role="group" aria-label="Cuentas de demostración">
        {DEMOS.map((demo) => (
          <button key={demo.email} type="button" className={`demo-account ${email === demo.email ? 'is-selected' : ''}`} onClick={() => { setEmail(demo.email); setPassword(DEMO_PASSWORD); setStatus('idle'); setTouched(false) }}>
            <Icon name={demo.icon} size={18} />
            <span><strong>{demo.label}</strong><small>{demo.detail}</small></span>
          </button>
        ))}
      </div>
      <Field label="Email" error={emailError}>{(id, describedBy) => <TextInput id={id} icon="mail" type="email" autoComplete="email" inputMode="email" value={email} aria-invalid={Boolean(emailError)} aria-describedby={describedBy} onChange={(event) => setEmail(event.target.value)} />}</Field>
      <Field label="Contraseña" error={passError} hint={passError ? undefined : `Demo: cualquiera de las cuentas de arriba con «${DEMO_PASSWORD}».`}>{(id, describedBy) => <PasswordInput id={id} value={password} onChange={setPassword} describedBy={describedBy} invalid={Boolean(passError)} autoComplete="current-password" />}</Field>
      {status === 'error' && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No pudimos ingresar</strong><p>Revisá el email y la contraseña e intentá nuevamente.</p></div></div>}
      {status === 'network' && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>Sin conexión con el club</strong><p>Revisá internet y probá de nuevo.</p></div></div>}
      <Button type="submit" variant="accent" size="lg" block icon={status === 'network' ? 'refresh' : 'arrowRight'} loading={status === 'saving'}>{status === 'saving' ? 'Ingresando…' : status === 'network' ? 'Reintentar' : 'Ingresar'}</Button>
      <p className="auth-switch">¿Sos jugador y no tenés cuenta? <button type="button" className="link-btn" onClick={onRegister}>Registrate</button></p>
      <p className="muted auth-small">¿Olvidaste la contraseña? Por ahora la recuperación se pide al club.</p>
    </form>
  )
}

function Register({ onLogin, onDone }: { onLogin: () => void; onDone: (email: string) => void }) {
  const { simulate } = useProto()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const emailError = touched && !validEmail(email) ? 'Escribí un email válido.' : undefined
  const passError = touched && password.length < 6 ? 'Usá al menos 6 caracteres.' : undefined
  const confirmError = touched && confirm !== password ? 'Las contraseñas no coinciden.' : undefined
  const strength = password.length === 0 ? 0 : password.length < 6 ? 1 : /\d/.test(password) && /[a-zA-Z]/.test(password) && password.length >= 8 ? 3 : 2

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!validEmail(email) || password.length < 6 || confirm !== password) return
    setStatus('saving')
    try { await simulate(900) } catch { setStatus('error'); return }
    onDone(email.trim())
  }

  return (
    <form className="auth-step" onSubmit={(event) => void submit(event)} noValidate aria-labelledby="reg-form-title">
      <h2 id="reg-form-title" className="display">Crear cuenta</h2>
      <p className="muted">Para jugadores. Después vas a canjear el código que te da el club; la cuenta sola no da acceso.</p>
      <Field label="Email" error={emailError}>{(id, describedBy) => <TextInput id={id} icon="mail" type="email" autoComplete="email" value={email} aria-invalid={Boolean(emailError)} aria-describedby={describedBy} onChange={(event) => setEmail(event.target.value)} data-autofocus />}</Field>
      <Field label="Contraseña" error={passError}>{(id, describedBy) => <PasswordInput id={id} value={password} onChange={setPassword} describedBy={describedBy} invalid={Boolean(passError)} autoComplete="new-password" />}</Field>
      <span className={`strength strength-${strength}`} aria-hidden="true"><i /><i /><i /></span>
      <Field label="Repetí la contraseña" error={confirmError}>{(id, describedBy) => <PasswordInput id={id} value={confirm} onChange={setConfirm} describedBy={describedBy} invalid={Boolean(confirmError)} autoComplete="new-password" />}</Field>
      {status === 'error' && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No pudimos crear la cuenta</strong><p>Revisá el email y la contraseña e intentá nuevamente.</p></div></div>}
      <Button type="submit" variant="accent" size="lg" block icon="userPlus" loading={status === 'saving'}>{status === 'saving' ? 'Creando…' : 'Crear cuenta'}</Button>
      <p className="auth-switch">¿Ya tenés cuenta? <button type="button" className="link-btn" onClick={onLogin}>Ingresá</button></p>
    </form>
  )
}

function Redeem({ email, onSignOut, onDone }: { email: string; onSignOut: () => void; onDone: (name: string) => void }) {
  const { state, dispatch } = useStore()
  const { simulate } = useProto()
  const { byId } = usePeople()
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'error' | 'network'>('idle')
  const clean = normalizeCode(code).slice(0, 32)
  const pending = state.invitations.filter((item) => invitationStatus(item) === 'pending')

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (clean.length < 32) { setStatus('error'); return }
    setStatus('saving')
    try { await simulate(900) } catch { setStatus('network'); return }
    const invitation = state.invitations.find((item) => item.code === clean && invitationStatus(item) === 'pending')
    if (!invitation) { setStatus('error'); return }
    dispatch({ type: 'invite/redeem', id: invitation.id })
    onDone(byId(invitation.personId)?.name ?? '')
  }

  return (
    <form className="auth-step" onSubmit={(event) => void submit(event)} noValidate aria-labelledby="redeem-title">
      <p className="eyebrow">{email || 'Cuenta sin club vinculado'}</p>
      <h2 id="redeem-title" className="display">Canjeá tu invitación</h2>
      <p className="muted">Tu cuenta no recibe acceso automáticamente. Pedile al club un código personal y usalo una sola vez.</p>
      <Field label="Código de invitación" hint={`${clean.length}/32 caracteres · podés pegarlo con espacios`}>
        {(id, describedBy) => <input id={id} className="input code-input num" value={groupCode(clean)} autoComplete="off" spellCheck={false} autoCapitalize="characters" aria-describedby={describedBy} aria-invalid={status === 'error'} onChange={(event) => { setCode(event.target.value); if (status !== 'saving') setStatus('idle') }} placeholder="XXXX XXXX XXXX XXXX …" data-autofocus />}
      </Field>
      {status === 'error' && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No pudimos validar esa invitación</strong><p>Revisá el código o consultá al club. Puede haber vencido o ya haberse usado.</p></div></div>}
      {status === 'network' && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>Sin conexión</strong><p>El código no se usó. Probá de nuevo.</p></div></div>}
      <Button type="submit" variant="accent" size="lg" block icon={status === 'network' ? 'refresh' : 'key'} loading={status === 'saving'} disabled={clean.length === 0}>{status === 'saving' ? 'Validando…' : status === 'network' ? 'Reintentar' : 'Canjear invitación'}</Button>
      <button type="button" className="link-btn" onClick={onSignOut}>Cerrar sesión</button>
      {pending.length > 0 && (
        <details className="proto-codes">
          <summary><Icon name="sliders" size={16} />Solo prototipo · códigos vigentes</summary>
          <ul>
            {pending.map((item) => <li key={item.id}><button type="button" onClick={() => { setCode(item.code); setStatus('idle') }}><span>{byId(item.personId)?.name}</span><code className="num">{groupCode(item.code).slice(0, 14)}…</code></button></li>)}
          </ul>
        </details>
      )}
    </form>
  )
}
