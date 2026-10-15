import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button, Icon, Modal } from '../../design/ui'
import { useAsyncAction } from '../../design/useAsyncAction'
import { enablePush, type PushEnvironment } from './pushClient'
import { markOnboardingSeen, resolveOnboarding, type OnboardingKind } from './onboardingState'

/** Bienvenida a los avisos: una sola vez por usuario y dispositivo. El permiso del sistema se pide solo al tocar «Activar notificaciones». */
export function PushOnboarding({ client, userId, environment }: { client: SupabaseClient; userId: string; environment?: PushEnvironment }) {
  const [kind, setKind] = useState<OnboardingKind | null>(null)
  const action = useAsyncAction()

  useEffect(() => {
    let cancelled = false
    void resolveOnboarding(client, userId, environment).then((next) => {
      if (cancelled || !next) return
      markOnboardingSeen(userId, next)
      setKind(next)
    })
    return () => { cancelled = true }
  }, [client, userId, environment])

  if (!kind) return null
  const close = () => setKind(null)
  const later = () => { if (kind === 'activate') markOnboardingSeen(userId, 'activate', 'later'); close() }

  const activate = () => void action.run(async () => {
    const result = await enablePush(client, environment?.vapidKey)
    if (result.ok) { markOnboardingSeen(userId, 'activate', 'activated'); close(); return null }
    if (result.reason === 'denied') { close(); return null }
    if (result.reason === 'dismissed') return 'No se activaron: cerraste el pedido de permiso. Podés intentar de nuevo o activarlos después desde Avisos.'
    if (result.reason === 'no-service-worker') return 'La app todavía no terminó de prepararse. Esperá un momento e intentá de nuevo.'
    return 'No pudimos activar los avisos en este dispositivo. Intentá de nuevo.'
  })

  if (kind === 'install-ios') {
    return (
      <Modal open onClose={close} title="Instalá Rafa Tenis para recibir avisos" eyebrow="Notificaciones" size="sm"
        footer={<Button variant="primary" onClick={close}>Entendido</Button>}>
        <div className="np-onboard">
          <p className="np-push-text">En iPhone los avisos funcionan desde la app instalada. Es rápido:</p>
          <ol className="np-onboard-steps">
            <li>Tocá <strong>Compartir</strong> en Safari.</li>
            <li>Elegí <strong>«Agregar a pantalla de inicio»</strong>.</li>
            <li>Abrí Rafa Tenis desde el ícono nuevo y activá los avisos.</li>
          </ol>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={later} busy={action.saving} title="¡Mantenete al día con Rafa Tenis!" eyebrow="Notificaciones" size="sm"
      footer={<>
        <Button variant="ghost" disabled={action.saving} onClick={later}>Ahora no</Button>
        <Button variant="primary" icon="bell" loading={action.saving} onClick={activate}>Activar notificaciones</Button>
      </>}>
      <div className="np-onboard">
        <span className="np-icon np-onboard-icon"><Icon name="bell" size={24} /></span>
        <p className="np-push-text">Vas a recibir avisos de tus reservas, torneos, peñas y novedades del club. Podés cambiarlo cuando quieras desde Avisos.</p>
        {action.failed && action.message && <p className="np-push-error" role="alert"><Icon name="alert" size={16} />{action.message}</p>}
      </div>
    </Modal>
  )
}
