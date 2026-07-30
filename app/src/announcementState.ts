/**
 * Client-side memory of what the user did with each announcement modal.
 *
 * Keyed by announcement id, so a NEW announcement always breaks through - the
 * dismissal of #4 says nothing about #5. The server keeps no per-user read
 * state; this is the whole mechanism, and it is deliberately per-browser.
 *
 * Only the EXPLICIT choices persist: "don't show again" forever, snooze until
 * a timestamp. Closing the modal with X / Escape / backdrop records nothing -
 * an unsilenced announcement comes back on the next reload or Dashboard
 * visit, by design. (X used to mean "never again"; that buried announcements
 * people had only meant to push aside for a moment.)
 */

const STATE_KEY = 'beehive_announcement_state_v1'

type Entry = { status: 'dismissed' } | { status: 'snoozed'; until: string }

function loadState(): Record<string, Entry> {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveEntry(id: number, entry: Entry): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ ...loadState(), [id]: entry }))
  } catch {
    // Storage full or blocked: the worst case is the modal shows again.
  }
}

export function shouldShowAnnouncement(id: number, now: Date = new Date()): boolean {
  const entry = loadState()[String(id)]
  if (entry?.status === 'dismissed') return false
  if (entry?.status === 'snoozed') {
    const until = Date.parse(entry.until)
    // An unparseable timestamp falls through to "show": failing open only
    // costs one extra modal, failing closed loses the announcement entirely.
    if (!Number.isNaN(until) && until > now.getTime()) return false
  }
  return true
}

/** Close = never show THIS announcement again. */
export function dismissAnnouncement(id: number): void {
  saveEntry(id, { status: 'dismissed' })
}

/** Snooze = show this announcement again after `hours` (default one day). */
export function snoozeAnnouncement(id: number, hours = 24, now: Date = new Date()): void {
  const until = new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString()
  saveEntry(id, { status: 'snoozed', until })
}
