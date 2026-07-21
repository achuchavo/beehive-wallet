// Beehive Wallet service worker: receives push notifications from the
// watcher and shows them even when no tab is open.

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data.json()
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Beehive Wallet', {
      body: data.body || '',
      data: { url: data.url || '/wallet/alarms' },
      tag: data.tag || 'beehive-alert',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/wallet/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes('/wallet') && 'focus' in client) {
          return client.focus()
        }
      }
      return clients.openWindow(url)
    }),
  )
})
