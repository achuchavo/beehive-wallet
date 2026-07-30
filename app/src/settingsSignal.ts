/**
 * A nudge that says "a global setting just changed, re-read it".
 *
 * Some settings are read in one place and written in another: App.tsx gates the
 * Uptime nav entry on app_settings.uptime_alerts_enabled, but the switch lives on
 * the admin screen. Without a signal the reader only finds out on its next poll,
 * or - as was the case - never, because it read once on mount and stopped.
 *
 * Deliberately a DOM event rather than a store or context: the writer and the
 * reader are on opposite sides of the router with no shared ancestor worth
 * threading state through, there is no payload, and this needs to work from a
 * plain async function as easily as from a component. It also means a reader that
 * unmounts simply stops listening.
 *
 * This is a hint, not a transport. Readers still fetch their own state from the
 * server, so a missed signal costs a delay, never correctness.
 */
const EVENT = 'beehive:settings-changed'

/** Call after writing a global setting. */
export function notifySettingsChanged(): void {
  window.dispatchEvent(new Event(EVENT))
}

/** Subscribe. Returns the unsubscribe function, for useEffect cleanup. */
export function onSettingsChanged(cb: () => void): () => void {
  window.addEventListener(EVENT, cb)
  return () => window.removeEventListener(EVENT, cb)
}
