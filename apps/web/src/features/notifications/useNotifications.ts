import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppNotification } from '../../types/domain'
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from './notificationApi'

export const POLL_INTERVAL_MS = 60_000

/**
 * Notificaciones de la cuenta en el club activo. Se actualizan al abrir, cada minuto con la pestaña visible y al volver a ella
 * (el aviso también llega por push si el dispositivo lo activó; esto cubre el resto). Al cambiar de club se descarta lo anterior.
 */
export function useNotifications(client: SupabaseClient, clubId: string) {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; unread: number; items: AppNotification[] }>({ status: 'loading', unread: 0, items: [] })
  const clubRef = useRef(clubId)
  clubRef.current = clubId

  const refresh = useCallback(async () => {
    const requested = clubId
    const snapshot = await fetchNotifications(client, requested)
    if (clubRef.current !== requested) return
    setState((current) => snapshot ? { status: 'ready', unread: snapshot.unread, items: snapshot.items } : current.status === 'ready' ? current : { status: 'error', unread: 0, items: [] })
  }, [client, clubId])

  useEffect(() => {
    setState({ status: 'loading', unread: 0, items: [] })
    void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, POLL_INTERVAL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [refresh])

  const markRead = useCallback(async (id: string) => {
    const now = new Date().toISOString()
    setState((current) => {
      const target = current.items.find((item) => item.id === id)
      if (!target || target.read_at) return current
      return { ...current, unread: Math.max(0, current.unread - 1), items: current.items.map((item) => item.id === id ? { ...item, read_at: now } : item) }
    })
    if (!(await markNotificationRead(client, id))) void refresh()
  }, [client, refresh])

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString()
    setState((current) => ({ ...current, unread: 0, items: current.items.map((item) => item.read_at ? item : { ...item, read_at: now }) }))
    if (!(await markAllNotificationsRead(client, clubId))) void refresh()
  }, [client, clubId, refresh])

  return { ...state, refresh, markRead, markAllRead }
}
