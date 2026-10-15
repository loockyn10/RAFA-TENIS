import type { IconName } from '../../design/ui'
import type { AppNotification, NotificationKind } from '../../types/domain'

export const NOTIFICATION_ICON: Record<NotificationKind, IconName> = {
  news_published: 'news',
  event_published: 'calendar',
  reservation_confirmed: 'checkCircle',
  reservation_cancelled: 'alert',
  reservation_reminder: 'clock',
}

export const NOTIFICATION_TONE: Record<NotificationKind, 'green' | 'clay' | 'ball'> = {
  news_published: 'green',
  event_published: 'clay',
  reservation_confirmed: 'green',
  reservation_cancelled: 'clay',
  reservation_reminder: 'ball',
}

/** «ahora», «hace 5 min», «hace 3 h», «ayer» o «12 oct», siempre respecto del reloj recibido (no del dispositivo si se inyecta). */
export function relativeTime(iso: string, timezone: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'ayer'
  if (days < 7) return `hace ${days} días`
  return new Intl.DateTimeFormat('es-AR', { timeZone: timezone, day: 'numeric', month: 'short' }).format(new Date(iso)).replace('.', '')
}

/** Cantidad para la insignia de la campanita: nunca más de 2 cifras en pantalla. */
export const badgeCount = (unread: number) => (unread > 99 ? '99+' : String(unread))

export const isUnread = (notification: Pick<AppNotification, 'read_at'>) => notification.read_at === null

/** Hacia qué sección se navega al abrir una notificación (la pantalla concreta depende de si se está en el portal o en administración). */
export type NotificationTarget = { type: 'post' | 'reservation'; id: string } | null
export const targetOf = (notification: Pick<AppNotification, 'target_type' | 'target_id'>): NotificationTarget =>
  notification.target_type && notification.target_id ? { type: notification.target_type, id: notification.target_id } : null
