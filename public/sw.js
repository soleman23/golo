/* GoLo service worker — Web Push (Phase 3).
 *
 * Displays incoming push notifications and routes clicks to the right screen.
 * Deliberately minimal: no offline/asset caching yet (push only), so it can
 * never serve stale bundles. The server sends a small privacy-safe payload
 * ({ title, body, url, tag, notificationId }); details live inside the app.
 */

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }

  const title = data.title || 'GoLo'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined, // collapse duplicates of the same logical event
    renotify: Boolean(data.tag),
    data: { url: data.url || '/', notificationId: data.notificationId || null },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clientList) {
        // Focus an existing GoLo tab and let the SPA route, rather than opening
        // a duplicate window.
        if ('focus' in client) {
          client.postMessage({ type: 'notification-click', url })
          await client.focus()
          return
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url)
    })(),
  )
})

// Activate immediately so push works on first install without a reload.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
