import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useAuth } from './AuthProvider'
import { AdminPanel } from '../features/admin/AdminPanel'
import { PlayerPortal } from '../features/player/PlayerPortal'
import { RedeemInvitationScreen } from '../features/player/RedeemInvitationScreen'
import type { PlayerClubAccess } from '../types/domain'

type StaffRow = { club_id: string }

export function AccessRouter({ user }: { user: User }) {
  const { client } = useAuth()
  const [staffCount, setStaffCount] = useState<number | null>(null)
  const [playerAccess, setPlayerAccess] = useState<PlayerClubAccess[]>([])
  const [error, setError] = useState<string | null>(null)
  const [experience, setExperience] = useState<'admin' | 'player' | null>(null)

  const refreshAccess = useCallback(async () => {
    setError(null)
    const [{ data: staffRows, error: staffError }, { data: portalData, error: portalError }] = await Promise.all([
      client.from('club_staff').select('club_id').eq('auth_user_id', user.id),
      client.rpc('player_access_context'),
    ])
    if (staffError || portalError) {
      setError('No pudimos verificar los permisos de esta cuenta. Intentá recargar la página.')
      setStaffCount(0)
      setPlayerAccess([])
      return
    }
    const nextStaffCount = ((staffRows ?? []) as StaffRow[]).length
    const nextPlayerAccess = (portalData ?? []) as PlayerClubAccess[]
    setStaffCount(nextStaffCount)
    setPlayerAccess(nextPlayerAccess)
    setExperience((current) => current ?? (nextStaffCount > 0 ? 'admin' : nextPlayerAccess.length > 0 ? 'player' : null))
  }, [client, user.id])

  useEffect(() => { void refreshAccess() }, [refreshAccess])

  if (staffCount === null) return <p className="screen-message" role="status">Verificando los accesos de tu cuenta…</p>
  if (error) return <p className="screen-message error-message" role="alert">{error}</p>
  if (staffCount === 0 && playerAccess.length === 0) return <RedeemInvitationScreen onRedeemed={() => void refreshAccess()} />
  if (experience === 'player' && playerAccess.length > 0) return <PlayerPortal access={playerAccess} onOpenAdmin={staffCount > 0 ? () => setExperience('admin') : undefined} />
  if (staffCount > 0) return <AdminPanel user={user} onOpenPlayerPortal={playerAccess.length > 0 ? () => setExperience('player') : undefined} />
  return <PlayerPortal access={playerAccess} />
}
