/*
 * Extensión Web Push del Service Worker de la PWA.
 *
 * NO es un segundo Service Worker: vite-plugin-pwa genera el único `sw.js` (precaché de la app) y lo configura con
 * `workbox.importScripts: ['push-sw.js']`, de modo que este archivo se carga DENTRO de ese mismo worker.
 *
 * Reglas:
 *  - Muestra siempre una notificación visible por cada push (exigencia de userVisibleOnly).
 *  - Solo usa título y texto cortos que ya generó el servidor (novedades, reservas). Nunca importes, saldos ni deudas.
 *  - El campo `tag` (id de la notificación) hace que un reenvío reemplace a la anterior en lugar de apilarse.
 *  - No lee ni escribe datos de Supabase: al tocar el aviso se abre la app, que muestra el centro de notificaciones.
 */
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'Rafa Tenis', body: event.data ? event.data.text() : '' }
  }
  const data = payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object' ? payload.data : {}
  const title = String(payload.title || 'Rafa Tenis').slice(0, 120)
  const options = {
    body: String(payload.body || '').slice(0, 200),
    tag: typeof payload.tag === 'string' ? payload.tag.slice(0, 80) : undefined,
    icon: '/branding/logoRafa.png',
    badge: '/branding/logoRafa.png',
    data: { notificationId: typeof data.notificationId === 'string' ? data.notificationId : null },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const notificationId = event.notification.data && event.notification.data.notificationId
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus()
        client.postMessage({ type: 'rafa:open-notifications', id: notificationId })
        return
      }
    }
    await self.clients.openWindow('/?notif=' + encodeURIComponent(notificationId || '1'))
  })())
})
