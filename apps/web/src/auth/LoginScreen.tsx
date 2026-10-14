import { useState, type FormEvent } from 'react'
import { useAuth } from './AuthProvider'

export function LoginScreen() {
  const { client } = useAuth()
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    setError(null)
    setNotice(null)
    if (mode === 'sign-up') {
      if (password !== passwordConfirmation) {
        setError('Las contraseñas no coinciden.')
        setIsSubmitting(false)
        return
      }
      const { data, error: signUpError } = await client.auth.signUp({ email, password })
      if (signUpError) setError('No pudimos crear la cuenta. Revisá el email y la contraseña e intentá nuevamente.')
      else if (data.session === null) setNotice('Revisá tu email para confirmar la cuenta. Después iniciá sesión y canjeá la invitación.')
      else setNotice('Cuenta creada. Ahora podés canjear tu invitación.')
    } else {
      const { error: signInError } = await client.auth.signInWithPassword({ email, password })
      if (signInError) setError('No pudimos ingresar con ese email y contraseña. Revisalos e intentá nuevamente.')
    }
    setIsSubmitting(false)
  }

  return (
    <section className="login-layout" aria-labelledby="login-title">
      <div className="login-intro">
        <p className="eyebrow">Acceso al club</p>
        <h1 id="login-title">Rafa Tenis, más claro cada día.</h1>
        <p className="intro">Ingresá para administrar el club o para consultar y reservar desde tu cuenta de jugador.</p>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
        <label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} minLength={6} required /></label>
        {mode === 'sign-up' && <label>Confirmar contraseña<input type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" minLength={6} required /></label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="form-success" role="status">{notice}</p>}
        <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Procesando…' : mode === 'sign-up' ? 'Crear cuenta' : 'Ingresar'}</button>
        <button className="text-button" type="button" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setError(null); setNotice(null) }} disabled={isSubmitting}>
          {mode === 'sign-in' ? '¿Sos jugador y no tenés cuenta? Registrate' : 'Ya tengo una cuenta'}
        </button>
      </form>
    </section>
  )
}
