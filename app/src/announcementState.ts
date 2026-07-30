/**
 * Client-side memory of what the user did with each announcement modal.
 *
 * Keyed by announcement id, so a NEW announcement always breaks through - the
 * dismissal of #4 says nothing about #5. The server keeps no per-user read
 * state; this is the whole mechanism, and it is deliberately per-browser.
 *
 * Two layers:
 *   localStorage    dismissed forever / snoozed until a timestamp
 *   sessionStorage  "already shown this session" - a modal that was neither
 *                   dismissed nor snoozed (tab reloaded with it open) should
 *                   not re-open on every navigation within the same session.
 */

const STATE_KEY = 'beehive_announcement_state_v1'
const SESSION_KEY = 'beehive_announcement_shown_v1'

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
  try {
    if (sessionStorage.getItem(SESSION_KEY) === String(id)) return false
  } catch {
    // Blocked sessionStorage: show it; the localStorage layer still applies.
  }
  return true
}

/** Record that the modal for this announcement is on screen this session. */
export function markAnnouncementShown(id: number): void {
  try {
    sessionStorage.setItem(SESSION_KEY, String(id))
  } catch {
    // Best effort only.
  }
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
