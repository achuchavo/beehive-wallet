import { useSyncExternalStore } from 'react'

/**
 * Privacy mode: hide balances and blur addresses on screen.
 *
 * For the situation where someone is next to you, or you are sharing a screen.
 * It is display-only and makes no security claim - the data is still in the
 * page, and anyone with the device can turn it off. Saying that plainly in the
 * UI matters, because a "privacy" switch invites the assumption that it
 * protects something.
 */
const KEY = 'beehive_privacy_mode_v1'

let enabled = (() => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
})()

const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function setPrivacyMode(on: boolean): void {
  enabled = on
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* private mode / quota - the setting just will not persist */
  }
  emit()
}

export function usePrivacyMode(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => enabled,
    () => false,
  )
}

/** Mask an amount for display. Never used for anything that is signed. */
export function maskAmount(text: string, hidden: boolean): string {
  return hidden ? '•'.repeat(Math.min(8, Math.max(4, text.replace(/[^\d]/g, '').length))) : text
}
