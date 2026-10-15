import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Badge, Button, Icon } from '../../design/ui'
import { useAsyncAction } from '../../design/useAsyncAction'
import { UNSUPPORTED_TEXT, disablePush, enablePush, getDeviceState, getPushSupport, permissionState, type DeviceState, type PushSupport } from './pushClient'

/**
 * Avisos push de ESTE dispositivo. No pide permiso al abrir ni al iniciar sesión: solo cuando se toca «Activar».
 * Si el navegador no puede recibir push, lo explica; el centro de notificaciones de la app funciona igual.
 */
export function PushSettings({ client, support }: { client: SupabaseClient; support?: PushSupport }) {
  const resolved = support ?? getPushSupport()
  const [device, setDevice] = useState<DeviceState>('unknown')
  const [permission, setPermission] = useState(permissionState())
  const action = useAsyncAction()
  const supportStatus = resolved.status

  const refresh = useCallback(async () => {
    setPermission(permissionState())
    setDevice(supportStatus === 'ok' ? await getDeviceState(client) : 'unknown')
  }, [client, supportStatus])
  useEffect(() => { void refresh() }, [refresh])

  const activate = () => void action.run(async () => {
    const result = await enablePush(client)
    await refresh()
    if (result.ok) return null
    if (result.reason === 'denied') return 'El navegador bloqueó las notificaciones. Habilitalas desde la configuración del sitio y volvé a intentar.'
    if (result.reason === 'dismissed') return 'No se activaron: cerraste el pedido de permiso. Podés intentar de nuevo cuando quieras.'
    if (result.reason === 'no-service-worker') return 'La app todavía no terminó de prepararse para recibir avisos. Recargá la página e intentá de nuevo.'
    return 'No pudimos activar los avisos en este dispositivo. Intentá de nuevo.'
  })
  const deactivate = () => void action.run(async () => {
    const ok = await disablePush(client)
    await refresh()
    return ok ? null : 'No pudimos desactivar los avisos. Intentá de nuevo.'
  })

  return (
    <section className="np-push" aria-labelledby="np-push-title">
      <h3 id="np-push-title" className="np-push-title"><Icon name={device === 'on' ? 'bell' : 'bellOff'} size={18} />Avisos en este dispositivo</h3>

      {resolved.status === 'unsupported' && <p className="np-push-text">{UNSUPPORTED_TEXT[resolved.reason]} Seguís viendo todos los avisos desde la campanita.</p>}
      {resolved.status === 'not-configured' && <p className="np-push-text">Los avisos en el celular todavía no están habilitados en esta instalación. Seguís viendo todo desde la campanita.</p>}

      {resolved.status === 'ok' && (
        <>
          {permission === 'denied' ? (
            <p className="np-push-text">Las notificaciones están bloqueadas para este sitio. Para recibirlas, permitilas en la configuración del navegador y volvé acá.</p>
          ) : device === 'on' ? (
            <div className="np-push-row">
              <Badge tone="success" icon="check">Activados</Badge>
              <Button variant="ghost" size="sm" loading={action.saving} onClick={deactivate}>Desactivar</Button>
            </div>
          ) : (
            <>
              <p className="np-push-text">{device === 'other-account' ? 'Este dispositivo está registrado con otra cuenta. Podés activarlo para la tuya.' : 'Recibí un aviso en el celular cuando haya novedades o una reserva cambie. Podés desactivarlo cuando quieras.'}</p>
              <Button variant="secondary" size="sm" icon="bell" loading={action.saving} onClick={activate}>Activar avisos</Button>
            </>
          )}
          {action.failed && action.message && <p className="np-push-error" role="alert"><Icon name="alert" size={16} />{action.message}</p>}
        </>
      )}
    </section>
  )
}
