/**
 * Copying a seed phrase or private key to the clipboard, as safely as a browser
 * permits.
 *
 * The clipboard is a genuinely bad place for key material: on Windows and
 * Android it may sync to a cloud clipboard, any page the user later pastes into
 * receives it verbatim, and clipboard history tools retain it indefinitely.
 * None of that is fixable from here. What IS fixable is the duration - so the
 * value is cleared automatically a short time later.
 *
 * The clear is conditional on the clipboard still holding exactly what we wrote.
 * Blindly wiping it would destroy whatever the user copied in the meantime,
 * which is both rude and a way to lose their work.
 */

const CLEAR_AFTER_MS = 30_000

let pendingClear: ReturnType<typeof setTimeout> | null = null

/**
 * Copy `secret`, then clear it again after CLEAR_AFTER_MS if it is still there.
 *
 * Returns false if the clipboard was unavailable (permissions, insecure
 * context), so the caller can tell the user rather than silently doing nothing.
 */
export async function copySecretTemporarily(secret: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(secret)
  } catch {
    return false
  }

  if (pendingClear) clearTimeout(pendingClear)
  pendingClear = setTimeout(() => {
    void clearIfUnchanged(secret)
  }, CLEAR_AFTER_MS)

  return true
}

/**
 * Wipe the clipboard only if it still contains `secret`.
 *
 * Reading the clipboard can require permission the user has not granted. If the
 * read fails we do NOT overwrite blindly - a failed read means we cannot know
 * whether the user has since copied something they care about, and destroying
 * that is worse than the secret lingering a little longer. The reveal UI is
 * what limits exposure in that case.
 */
async function clearIfUnchanged(secret: string): Promise<void> {
  try {
    const current = await navigator.clipboard.readText()
    if (current === secret) {
      await navigator.clipboard.writeText('')
    }
  } catch {
    /* cannot verify - leave it alone, see above */
  } finally {
    pendingClear = null
  }
}

/** Cancel a pending clear (e.g. the component unmounted and already wiped). */
export function cancelPendingSecretClear(): void {
  if (pendingClear) {
    clearTimeout(pendingClear)
    pendingClear = null
  }
}

export const SECRET_CLIPBOARD_SECONDS = CLEAR_AFTER_MS / 1000
