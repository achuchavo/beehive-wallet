// Beehive Wallet service worker: receives push notifications from the watcher
// and shows them even when no tab is open.
//
// Base-path strategy: the push payload carries a RELATIVE alert path (e.g.
// "alarms"). We resolve it against this worker's own registration scope, so the
// exact same code works whether the app is served at "/" (wallet subdomain) or
// at "/wallet/" (path build) - no hard-coded "/wallet/" anywhere.

// Resolve a payload-supplied path to an absolute in-scope URL. Anything that
// escapes the app's origin or scope collapses to the app root, so a notification
// can never drive the window to an arbitrary URL.
function resolveInScope(rawPath) {
  const scope = self.registration.scope // absolute, ends in "/"
  try {
    const dest = new URL(rawPath || '', scope)
    const scopeUrl = new URL(scope)
    if (dest.origin !== scopeUrl.origin) return scope
    if (!dest.href.startsWith(scope)) return scope
    return dest.href
  } catch {
    return scope
  }
}

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
      // Store the raw relative path; resolve on click against the live scope.
      data: { path: data.url || 'alarms' },
      tag: data.tag || 'beehive-alert',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const dest = resolveInScope(event.notification.data && event.notification.data.path)
  const scopeOrigin = new URL(self.registration.scope).origin

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        let sameOrigin = false
        try {
          sameOrigin = new URL(client.url).origin === scopeOrigin
        } catch {
          sameOrigin = false
        }
        if (sameOrigin && 'focus' in client) {
          // Focus the existing app window AND navigate it to the alert.
          return Promise.resolve(client.focus()).then((c) =>
            c && 'navigate' in c ? c.navigate(dest).catch(() => c) : c,
          )
        }
      }
      return clients.openWindow(dest)
    }),
  )
})
