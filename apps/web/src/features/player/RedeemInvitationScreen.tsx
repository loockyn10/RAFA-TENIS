import { useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'

export function RedeemInvitationScreen({ onRedeemed }: { onRedeemed: () => void }) {
  const { client, signOut } = useAuth()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    const { error: redeemError } = await client.rpc('redeem_player_invitation', { p_code: code.trim() })
    if (redeemError) setError('No pudimos validar esa invitación. Revisá el código o consultá al club.')
    else onRedeemed()
    setIsSubmitting(false)
  }

  return <section className="access-card" aria-labelledby="redeem-title">
    <p className="eyebrow">Cuenta sin club vinculado</p>
    <h1 id="redeem-title">Canjeá tu invitación.</h1>
    <p className="intro">Tu cuenta no recibe acceso automáticamente. Pedile al club un código individual y usalo una sola vez acá.</p>
    <form className="auth-card" onSubmit={submit}>
      <label>Código de invitación<input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" minLength={32} required /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Validando…' : 'Canjear invitación'}</button>
      <button className="text-button" type="button" onClick={() => void signOut()}>Cerrar sesión</button>
    </form>
  </section>
}
