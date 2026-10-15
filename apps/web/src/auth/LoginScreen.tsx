import { useState, type FormEvent } from 'react'
import { useAuth } from './AuthProvider'
import { AuthLayout } from './AuthLayout'
import { Button, Field, Icon, TextInput } from '../design/ui'
import { isNetworkError, isValidEmail } from './authUtils'

type Step = 'login' | 'register' | 'registered'
type Status = 'idle' | 'saving' | 'error' | 'network'

function PasswordInput({ id, value, onChange, describedBy, invalid, autoComplete }: { id: string; value: string; onChange: (value: string) => void; describedBy?: string; invalid?: boolean; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="password-wrap">
      <TextInput id={id} icon="lock" type={show ? 'text' : 'password'} value={value} autoComplete={autoComplete} aria-describedby={describedBy} aria-invalid={invalid} onChange={(event) => onChange(event.target.value)} />
      <button type="button" className="password-toggle" aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={show} onClick={() => setShow(!show)}><Icon name={show ? 'eyeOff' : 'eye'} size={18} /></button>
    </span>
  )
}

/** Acceso real con Supabase Auth: ingreso, registro de jugadores y aviso de confirmación por email. */
export function LoginScreen() {
  const [step, setStep] = useState<Step>('login')
  const [email, setEmail] = useState('')

  return (
    <AuthLayout>
      {step === 'login' && <Login initialEmail={email} onRegister={() => setStep('register')} />}
      {step === 'register' && <Register onLogin={() => setStep('login')} onDone={(value) => { setEmail(value); setStep('registered') }} />}
      {step === 'registered' && (
        <section className="auth-step auth-done" aria-labelledby="reg-title">
          <span className="success-icon"><Icon name="mail" size={40} /></span>
          <h1 id="reg-title" className="display auth-title">Revisá tu email</h1>
          <p>Te enviamos un enlace a <b>{email}</b> para confirmar la cuenta. Después iniciá sesión y canjeá la invitación que te dio el club.</p>
          <Button variant="accent" size="lg" block iconRight="arrowRight" onClick={() => setStep('login')}>Ya confirmé, ingresar</Button>
          <p className="muted auth-small">¿No llegó? Revisá la carpeta de spam o pedile ayuda al club.</p>
        </section>
      )}
    </AuthLayout>
  )
}

function Login({ initialEmail, onRegister }: { initialEmail: string; onRegister: () => void }) {
  const { client } = useAuth()
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const emailError = touched && !isValidEmail(email) ? 'Escribí un email válido.' : undefined
  const passError = touched && password.length < 6 ? 'La contraseña tiene al menos 6 caracteres.' : undefined

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!isValidEmail(email) || password.length < 6 || status === 'saving') return
    setStatus('saving')
    try {
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password })
      // Si el ingreso funciona, AuthProvider cambia la sesión y esta pantalla se desmonta.
      setStatus(error ? (isNetworkError(error) ? 'network' : 'error') : 'idle')
    } catch {
      setStatus('network')
    }
  }

  return (
    <form className="auth-step" onSubmit={(event) => void submit(event)} noValidate aria-labelledby="login-title">
      <h1 id="login-title" className="display auth-title">Ingresar</h1>
      <p className="muted">Para administrar el club o entrar a tu portal de jugador.</p>
      <Field label="Email" error={emailError}>{(id, describedBy) => <TextInput id={id} icon="mail" type="email" autoComplete="email" inputMode="email" value={email} aria-invalid={Boolean(emailError)} aria-describedby={describedBy} onChange={(event) => setEmail(event.target.value)} />}</Field>
      <Field label="Contraseña" error={passError}>{(id, describedBy) => <PasswordInput id={id} value={password} onChange={setPassword} describedBy={describedBy} invalid={Boolean(passError)} autoComplete="current-password" />}</Field>
      {status === 'error' && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No pudimos ingresar</strong><p>Revisá el email y la contraseña e intentá nuevamente.</p></div></div>}
      {status === 'network' && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>Sin conexión con el club</strong><p>Revisá internet y probá de nuevo.</p></div></div>}
      <Button type="submit" variant="accent" size="lg" block icon={status === 'network' ? 'refresh' : 'arrowRight'} loading={status === 'saving'}>{status === 'saving' ? 'Ingresando…' : status === 'network' ? 'Reintentar' : 'Ingresar'}</Button>
      <p className="auth-switch">¿Sos jugador y no tenés cuenta? <button type="button" className="link-btn" onClick={onRegister}>Registrate</button></p>
      <p className="muted auth-small">¿Olvidaste la contraseña? Por ahora la recuperación se pide al club.</p>
    </form>
  )
}

function Register({ onLogin, onDone }: { onLogin: () => void; onDone: (email: string) => void }) {
  const { client } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const emailError = touched && !isValidEmail(email) ? 'Escribí un email válido.' : undefined
  const passError = touched && password.length < 6 ? 'Usá al menos 6 caracteres.' : undefined
  const confirmError = touched && confirm !== password ? 'Las contraseñas no coinciden.' : undefined
  const strength = password.length === 0 ? 0 : password.length < 6 ? 1 : /\d/.test(password) && /[a-zA-Z]/.test(password) && password.length >= 8 ? 3 : 2

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!isValidEmail(email) || password.length < 6 || confirm !== password || status === 'saving') return
    setStatus('saving')
    try {
      const { data, error } = await client.auth.signUp({ email: email.trim(), password })
      if (error) { setStatus(isNetworkError(error) ? 'network' : 'error'); return }
      setStatus('idle')
      // Sin sesión: Supabase pide confirmar el email. Con sesión, AuthProvider ya pasó a la pantalla de canje.
      if (data.session === null) onDone(email.trim())
    } catch {
      setStatus('network')
    }
  }

  return (
    <form className="auth-step" onSubmit={(event) => void submit(event)} noValidate aria-labelledby="reg-form-title">
      <h1 id="reg-form-title" className="display auth-title">Crear cuenta</h1>
      <p className="muted">Para jugadores. Después vas a canjear el código que te da el club; la cuenta sola no da acceso.</p>
      <Field label="Email" error={emailError}>{(id, describedBy) => <TextInput id={id} icon="mail" type="email" autoComplete="email" inputMode="email" value={email} aria-invalid={Boolean(emailError)} aria-describedby={describedBy} onChange={(event) => setEmail(event.target.value)} data-autofocus />}</Field>
      <Field label="Contraseña" error={passError}>{(id, describedBy) => <PasswordInput id={id} value={password} onChange={setPassword} describedBy={describedBy} invalid={Boolean(passError)} autoComplete="new-password" />}</Field>
      <span className={`strength strength-${strength}`} aria-hidden="true"><i /><i /><i /></span>
      <Field label="Repetí la contraseña" error={confirmError}>{(id, describedBy) => <PasswordInput id={id} value={confirm} onChange={setConfirm} describedBy={describedBy} invalid={Boolean(confirmError)} autoComplete="new-password" />}</Field>
      {status === 'error' && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No pudimos crear la cuenta</strong><p>Revisá el email y la contraseña e intentá nuevamente.</p></div></div>}
      {status === 'network' && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>Sin conexión con el club</strong><p>Revisá internet y probá de nuevo.</p></div></div>}
      <Button type="submit" variant="accent" size="lg" block icon={status === 'network' ? 'refresh' : 'userPlus'} loading={status === 'saving'}>{status === 'saving' ? 'Creando…' : status === 'network' ? 'Reintentar' : 'Crear cuenta'}</Button>
      <p className="auth-switch">¿Ya tenés cuenta? <button type="button" className="link-btn" onClick={onLogin}>Ingresá</button></p>
    </form>
  )
}
