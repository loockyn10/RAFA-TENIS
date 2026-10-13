import { useState, type FormEvent } from 'react'
import { useAuth } from './AuthProvider'

export function LoginScreen() {
  const { client } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    setError(null)
    const { error: signInError } = await client.auth.signInWithPassword({ email, password })
    if (signInError) setError('No pudimos ingresar con ese email y contraseña. Revisalos e intentá nuevamente.')
    setIsSubmitting(false)
  }

  return (
    <section className="login-layout" aria-labelledby="login-title">
      <div className="login-intro">
        <p className="eyebrow">Administración del club</p>
        <h1 id="login-title">Rafa Tenis, más claro cada día.</h1>
        <p className="intro">Ingresá con tu cuenta autorizada para administrar las canchas del club.</p>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
        <label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Ingresando…' : 'Ingresar'}</button>
      </form>
    </section>
  )
}
