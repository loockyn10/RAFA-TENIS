import type { SupabaseClient } from '@supabase/supabase-js'
import type { NotificationsSnapshot } from '../../types/domain'

/** Solo RPC con alcance propio: el servidor devuelve únicamente las notificaciones de la cuenta autenticada. */
export async function fetchNotifications(client: SupabaseClient, clubId: string): Promise<NotificationsSnapshot | null> {
  const { data, error } = await client.rpc('my_notifications', { p_club_id: clubId, p_limit: 50 })
  if (error || !data) return null
  const snapshot = data as Partial<NotificationsSnapshot>
  return { unread: Number(snapshot.unread ?? 0), items: snapshot.items ?? [] }
}

export async function markNotificationRead(client: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await client.rpc('mark_notification_read', { p_notification_id: id })
  return !error
}

export async function markAllNotificationsRead(client: SupabaseClient, clubId: string): Promise<boolean> {
  const { error } = await client.rpc('mark_all_notifications_read', { p_club_id: clubId })
  return !error
}
