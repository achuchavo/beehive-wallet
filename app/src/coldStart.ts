import { useEffect, useState } from 'react'

/**
 * "Has the user just arrived?" - the signal deciding whether a page blocks with
 * the loading modal or refreshes quietly behind figures already on screen.
 *
 * Two things count as arriving:
 *
 *  1. A new document. Module scope gives us that for free: it survives every
 *     in-app route change and resets only on a real load - opening the app,
 *     reloading, or a PWA cold-launch after the OS discarded it.
 *
 *  2. Coming back from the background after a while. An installed PWA (or a
 *     parked tab) is usually still alive when reopened, so nothing reloads and
 *     rule 1 alone would treat a return after hours as if the user had never
 *     left - showing hours-old balances behind nothing but a small badge.
 */
export const BACKGROUND_COLD_MS = 15 * 60 * 1000

let coldStart = true
let hiddenAt: number | null = null

/**
 * The visibility rule itself. Exported so tests exercise the same code path the
 * listener does, with an injectable clock - the alternative was a parallel
 * "simulate" helper, which is exactly the sort of duplicate that drifts out of
 * sync with the real rule.
 */
export function noteHidden(at: number = Date.now()): void {
  hiddenAt = at
}

export function noteVisible(at: number = Date.now()): void {
  if (hiddenAt !== null && at - hiddenAt >= BACKGROUND_COLD_MS) {
    coldStart = true
  }
  hiddenAt = null
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') noteHidden()
    else noteVisible()
  })
}

/**
 * Whether THIS mount should treat itself as a fresh arrival. Consuming it marks
 * the session warm, so the first page landed on gets the modal and moving
 * around afterwards does not.
 */
export function useColdStart(): boolean {
  // Read in the initializer and flip in an effect, never during render:
  // StrictMode invokes the initializer twice, and mutating there would make the
  // second pass observe a warm start and hide the modal on the very first visit.
  const [isCold] = useState(() => coldStart)
  useEffect(() => {
    coldStart = false
  }, [])
  return isCold
}

/** Test seam. */
export function resetColdStart(cold = true): void {
  coldStart = cold
  hiddenAt = null
}

/** Test seam: read without consuming. */
export function peekColdStart(): boolean {
  return coldStart
}
