import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useAuth } from './AuthProvider'
import { AuthLayout, AuthLoading, AuthNotice, SignOutButton } from './AuthLayout'
import { RedeemInvitationScreen, type RedeemedInvitation } from '../features/player/RedeemInvitationScreen'
import { Button, Icon } from '../design/ui'
import type { PlayerClubAccess } from '../types/domain'

// Administración y portal son aplicaciones separadas: cada cuenta descarga solo la que usa.
const AdminPanel = lazy(() => import('../features/admin/AdminPanel').then((module) => ({ default: module.AdminPanel })))
const PlayerPortal = lazy(() => import('../features/player/PlayerPortal').then((module) => ({ default: module.PlayerPortal })))

type StaffRow = { club_id: string }
type Experience = 'admin' | 'player'

const storageKey = (userId: string) => `rafa:experience:${userId}`
/** Comodidad por pestaña: recuerda la experiencia elegida. Nunca otorga permisos; siempre se contrasta con los accesos reales. */
function readStoredExperience(userId: string): Experience | null {
  try {
    const value = window.sessionStorage.getItem(storageKey(userId))
    return value === 'admin' || value === 'player' ? value : null
  } catch { return null }
}
function storeExperience(userId: string, value: Experience | null) {
  try {
    if (value) window.sessionStorage.setItem(storageKey(userId), value)
    else window.sessionStorage.removeItem(storageKey(userId))
  } catch { /* sin almacenamiento: se vuelve a preguntar */ }
}

export function AccessRouter({ user }: { user: User }) {
  const { client, signOut } = useAuth()
  const [staffCount, setStaffCount] = useState<number | null>(null)
  const [playerAccess, setPlayerAccess] = useState<PlayerClubAccess[]>([])
  const [error, setError] = useState<string | null>(null)
  const [experience, setExperience] = useState<Experience | null>(() => readStoredExperience(user.id))
  const [welcome, setWelcome] = useState<PlayerClubAccess | 'pending' | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  const refreshAccess = useCallback(async (): Promise<PlayerClubAccess[]> => {
    setError(null)
    const [{ data: staffRows, error: staffError }, { data: portalData, error: portalError }] = await Promise.all([
      client.from('club_staff').select('club_id').eq('auth_user_id', user.id),
      client.rpc('player_access_context'),
    ])
    if (staffError || portalError) {
      setError('No pudimos verificar los permisos de esta cuenta. Intentá recargar la página.')
      setStaffCount(0)
      setPlayerAccess([])
      return []
    }
    const nextStaffCount = ((staffRows ?? []) as StaffRow[]).length
    const nextPlayerAccess = (portalData ?? []) as PlayerClubAccess[]
    setStaffCount(nextStaffCount)
    setPlayerAccess(nextPlayerAccess)
    return nextPlayerAccess
  }, [client, user.id])

  useEffect(() => { void refreshAccess() }, [refreshAccess])

  const choose = (next: Experience | null) => { storeExperience(user.id, next); setExperience(next) }
  const closeSession = async () => { setSigningOut(true); await signOut(); setSigningOut(false) }

  // Tras canjear: se recarga el contexto real (cuenta ↔ ficha ↔ club) y se saluda con los datos del servidor, no con los del formulario.
  const handleRedeemed = async (result: RedeemedInvitation | null) => {
    setWelcome('pending')
    const access = await refreshAccess()
    const linked = access.find((item) => item.club_id === result?.club_id && item.person_id === result?.person_id) ?? access[0] ?? null
    setWelcome(linked)
    choose('player')
  }

  if (staffCount === null) return <AuthLoading message="Verificando los accesos de tu cuenta…" />
  if (error) {
    return <AuthLayout><AuthNotice kicker="Acceso" title="No pudimos verificar tu cuenta" tone="error" action={<div className="form-actions"><Button variant="accent" icon="refresh" onClick={() => void refreshAccess()}>Reintentar</Button><SignOutButton onSignOut={() => void closeSession()} busy={signingOut} /></div>}><Icon name="alert" size={20} /><div><p>{error}</p></div></AuthNotice></AuthLayout>
  }
  if (welcome === 'pending') return <AuthLoading message="Vinculando tu cuenta con tu ficha…" />
  if (staffCount === 0 && playerAccess.length === 0) return <RedeemInvitationScreen email={user.email ?? undefined} onRedeemed={(result) => void handleRedeemed(result)} />

  if (welcome && playerAccess.length > 0) {
    const first = welcome.full_name.trim().split(/\s+/)[0] ?? ''
    return (
      <AuthLayout>
        <section className="auth-step auth-done" aria-labelledby="welcome-title">
          <span className="success-icon"><Icon name="checkCircle" size={44} /></span>
          <h1 id="welcome-title" className="display auth-title">¡Listo, {first}!</h1>
          <p>Tu cuenta quedó vinculada a tu ficha de <b>{welcome.club_name}</b>. Ya podés reservar y ver tus torneos.</p>
          <Button variant="accent" size="lg" block iconRight="arrowRight" onClick={() => setWelcome(null)}>Ir a mi portal</Button>
        </section>
      </AuthLayout>
    )
  }

  const hasAdmin = staffCount > 0
  const hasPlayer = playerAccess.length > 0
  // Solo se respeta una elección guardada si la cuenta realmente tiene ese acceso.
  const active: Experience | null = experience === 'admin' && hasAdmin ? 'admin' : experience === 'player' && hasPlayer ? 'player' : hasAdmin && hasPlayer ? null : hasAdmin ? 'admin' : 'player'

  if (active === null) {
    return (
      <AuthLayout>
        <section className="auth-step" aria-labelledby="choose-title">
          <p className="kicker">{user.email}</p>
          <h1 id="choose-title" className="display auth-title">¿Cómo querés entrar?</h1>
          <p className="muted">Tu cuenta tiene acceso administrativo y de jugador. Podés cambiar después desde «Cuenta».</p>
          <div className="choose-grid">
            <button type="button" className="choose-card" onClick={() => choose('admin')}>
              <span className="choose-icon"><Icon name="grid" size={26} /></span>
              <strong>Administración</strong>
              <span>Agenda, cantina, cuotas, escuela y torneos</span>
              <Icon name="arrowRight" size={20} className="choose-arrow" />
            </button>
            <button type="button" className="choose-card" onClick={() => choose('player')}>
              <span className="choose-icon is-ball"><Icon name="portal" size={26} /></span>
              <strong>Mi portal</strong>
              <span>Mis turnos, reservas y torneos</span>
              <Icon name="arrowRight" size={20} className="choose-arrow" />
            </button>
          </div>
          <button type="button" className="link-btn" onClick={() => void closeSession()}>Cerrar sesión</button>
        </section>
      </AuthLayout>
    )
  }

  return (
    <Suspense fallback={<AuthLoading message={active === 'player' ? 'Cargando tu portal…' : 'Cargando la administración…'} />}>
      {active === 'player'
        ? <PlayerPortal access={playerAccess} user={user} onOpenAdmin={hasAdmin ? () => choose('admin') : undefined} />
        : <AdminPanel user={user} onOpenPlayerPortal={hasPlayer ? () => choose('player') : undefined} />}
    </Suspense>
  )
}
