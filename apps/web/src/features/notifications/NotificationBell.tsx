import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button, EmptyState, ErrorState, Icon, Modal, SkeletonCards } from '../../design/ui'
import type { AppNotification } from '../../types/domain'
import { PushSettings } from './PushSettings'
import { NOTIFICATION_ICON, NOTIFICATION_TONE, badgeCount, isUnread, relativeTime } from './notificationUtils'
import { useNotifications } from './useNotifications'

type Props = {
  client: SupabaseClient
  clubId: string
  timezone: string
  /** Se llama al abrir una notificación; el padre navega a la sección correspondiente. */
  onOpenNotification: (notification: AppNotification) => void
  /** `on-dark` para barras verdes (encabezados). */
  variant?: 'on-dark' | 'ghost'
}

/** Campanita con insignia de no leídas y panel con la lista, «marcar todas» y la activación de avisos del dispositivo. */
export function NotificationBell({ client, clubId, timezone, onOpenNotification, variant = 'on-dark' }: Props) {
  const [open, setOpen] = useState(false)
  const { status, unread, items, refresh, markRead, markAllRead } = useNotifications(client, clubId)

  const openPanel = useCallback(() => { setOpen(true); void refresh() }, [refresh])

  // Llegada desde un push: una ventana ya abierta recibe un mensaje del Service Worker; una ventana nueva trae ?notif=… en la URL.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has('notif')) {
      url.searchParams.delete('notif')
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
      openPanel()
    }
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => { if ((event.data as { type?: string } | null)?.type === 'rafa:open-notifications') openPanel() }
    const worker = navigator.serviceWorker
    worker.addEventListener('message', onMessage)
    return () => worker.removeEventListener('message', onMessage)
  }, [openPanel])

  const choose = (notification: AppNotification) => {
    if (isUnread(notification)) void markRead(notification.id)
    setOpen(false)
    onOpenNotification(notification)
  }

  return (
    <>
      <button type="button" className={`icon-btn icon-btn-${variant} icon-btn-md np-bell`} aria-label={unread > 0 ? `Avisos, ${unread} sin leer` : 'Avisos'} aria-haspopup="dialog" title="Avisos" onClick={openPanel}>
        <Icon name="bell" size={20} />
        {unread > 0 && <span className="np-badge num" aria-hidden="true">{badgeCount(unread)}</span>}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Avisos" eyebrow={unread > 0 ? `${unread} sin leer` : 'Estás al día'} variant="drawer" size="sm"
        footer={<PushSettings client={client} />}>
        <div className="np-panel">
          {items.length > 0 && <div className="np-toolbar"><Button variant="ghost" size="sm" icon="check" disabled={unread === 0} onClick={() => void markAllRead()}>Marcar todas como leídas</Button></div>}
          {status === 'loading' && <SkeletonCards count={3} height={64} />}
          {status === 'error' && <ErrorState title="No pudimos cargar tus avisos" onRetry={() => void refresh()} />}
          {status === 'ready' && items.length === 0 && <EmptyState icon="bell" title="No tenés avisos" body="Acá vas a ver novedades del club, eventos y cambios en tus reservas." />}
          {status === 'ready' && items.length > 0 && (
            <ul className="np-list" aria-label="Avisos">
              {items.map((notification) => (
                <li key={notification.id}>
                  <button type="button" className={`np-item ${isUnread(notification) ? 'is-unread' : ''}`} onClick={() => choose(notification)}>
                    <span className={`np-icon np-icon-${NOTIFICATION_TONE[notification.kind]}`}><Icon name={NOTIFICATION_ICON[notification.kind]} size={20} /></span>
                    <span className="np-main">
                      <strong>{notification.title}</strong>
                      {notification.body && <span>{notification.body}</span>}
                      <small>{relativeTime(notification.created_at, timezone)}{isUnread(notification) && <span className="visually-hidden"> · sin leer</span>}</small>
                    </span>
                    {isUnread(notification) && <span className="np-dot" aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </>
  )
}
