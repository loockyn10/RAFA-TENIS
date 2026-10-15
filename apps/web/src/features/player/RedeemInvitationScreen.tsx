import { useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { AuthLayout } from '../../auth/AuthLayout'
import { groupInvitationCode, INVITATION_CODE_LENGTH, INVITATION_CODE_MIN, isNetworkError, normalizeInvitationCode } from '../../auth/authUtils'
import { Button, Field, Icon } from '../../design/ui'

export type RedeemedInvitation = { club_id: string; person_id: string }

/** Canje de una invitación (un solo uso). El código viaja al servidor, que guarda solo su hash; aquí no se persiste. */
export function RedeemInvitationScreen({ email, onRedeemed }: { email?: string; onRedeemed: (result: RedeemedInvitation | null) => void }) {
  const { client, signOut } = useAuth()
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'error' | 'network'>('idle')
  const clean = normalizeInvitationCode(code).slice(0, INVITATION_CODE_LENGTH)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (status === 'saving') return
    if (clean.length < INVITATION_CODE_MIN) { setStatus('error'); return }
    setStatus('saving')
    try {
      const { data, error } = await client.rpc('redeem_player_invitation', { p_code: clean })
      if (error) { setStatus(isNetworkError(error) ? 'network' : 'error'); return }
      setCode('')
      setStatus('idle')
      onRedeemed((data ?? null) as RedeemedInvitation | null)
    } catch {
      setStatus('network')
    }
  }

  return (
    <AuthLayout>
      <form className="auth-step" onSubmit={(event) => void submit(event)} noValidate aria-labelledby="redeem-title">
        <p className="kicker">{email || 'Cuenta sin club vinculado'}</p>
        <h1 id="redeem-title" className="display auth-title">Canjeá tu invitación</h1>
        <p className="muted">Tu cuenta no recibe acceso automáticamente. Pedile al club un código personal y usalo una sola vez.</p>
        <Field label="Código de invitación" hint={`${clean.length}/${INVITATION_CODE_LENGTH} caracteres · podés pegarlo con espacios`}>
          {(id, describedBy) => <textarea id={id} className="input textarea code-input num" rows={3} value={groupInvitationCode(clean)} autoComplete="off" spellCheck={false} autoCapitalize="none" aria-describedby={describedBy} aria-invalid={status === 'error'} onChange={(event) => { setCode(event.target.value); if (status !== 'saving') setStatus('idle') }} placeholder="Pegá acá el código que te dio el club" data-autofocus />}
        </Field>
        {status === 'error' && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>No pudimos validar esa invitación</strong><p>Revisá el código o consultá al club. Puede haber vencido, haberse revocado o ya haberse usado.</p></div></div>}
        {status === 'network' && <div className="inline-alert inline-alert-danger" role="alert"><Icon name="alert" size={20} /><div><strong>Sin conexión</strong><p>Probá de nuevo: si el canje no llegó al club, el código sigue vigente.</p></div></div>}
        <Button type="submit" variant="accent" size="lg" block icon={status === 'network' ? 'refresh' : 'key'} loading={status === 'saving'} disabled={clean.length === 0}>{status === 'saving' ? 'Validando…' : status === 'network' ? 'Reintentar' : 'Canjear invitación'}</Button>
        <button type="button" className="link-btn" onClick={() => void signOut()}>Cerrar sesión</button>
      </form>
    </AuthLayout>
  )
}
