/**
 * The native apps' API credential, held in the iOS Keychain / Android Keystore.
 *
 * WHAT THIS IS NOT: a wallet credential. It authenticates to the alarm/watcher
 * backend - watched addresses, alerts, push settings. It cannot move funds,
 * cannot decrypt a seed phrase, and never touches key material. The wallet's own
 * secrets are encrypted with the user's password by wallet/crypto.ts and are
 * entirely separate from this.
 *
 * On the WEB this module is inert: every function is a no-op returning null,
 * because the browser authenticates with the PHP session cookie and there is no
 * token to keep. Nothing here should ever write a credential to localStorage -
 * that is precisely the storage this exists to avoid.
 *
 * The plugin is imported dynamically so a web build never loads it (and so the
 * jsdom test environment never has to stub it).
 */

import { isNative } from '../platform'

const TOKEN_KEY = 'beehive_device_token_v1'

/**
 * Cached in memory so the common path - attaching the header to a request -
 * does not hit the Keychain every time. On iOS a Keychain read can prompt, and
 * on both platforms it is a bridge round-trip per call.
 *
 * `undefined` means "not read yet"; `null` means "read, and there is none".
 */
let cached: string | null | undefined

async function store() {
  const { SecureStorage, KeychainAccess } = await import('@aparajita/capacitor-secure-storage')
  return { SecureStorage, KeychainAccess }
}

export async function loadDeviceToken(): Promise<string | null> {
  if (!isNative()) return null
  if (cached !== undefined) return cached

  try {
    const { SecureStorage } = await store()
    const value = await SecureStorage.getItem(TOKEN_KEY)
    cached = typeof value === 'string' && value !== '' ? value : null
  } catch {
    // A Keychain/Keystore read can fail for reasons that are not "no token":
    // the device is locked, or the key was invalidated. Treat it as absent
    // rather than throwing - the user is then asked to sign in again, which is
    // recoverable, instead of the app failing to start.
    cached = null
  }
  return cached
}

export async function saveDeviceToken(token: string): Promise<void> {
  if (!isNative()) return
  const { SecureStorage, KeychainAccess } = await store()
  // whenUnlockedThisDeviceOnly: readable only while the device is unlocked, and
  // excluded from backups, so restoring a backup onto another handset does not
  // carry the credential with it. A device token should stay on its device.
  await SecureStorage.set(TOKEN_KEY, token, false, false, KeychainAccess.whenUnlockedThisDeviceOnly)
  cached = token
}

export async function clearDeviceToken(): Promise<void> {
  cached = null
  if (!isNative()) return
  try {
    const { SecureStorage } = await store()
    await SecureStorage.remove(TOKEN_KEY)
  } catch {
    // Already gone, or the store is unreadable. The in-memory copy is cleared
    // either way, so this session is signed out regardless.
  }
}

/** Test seam: drop the memo without touching the store. */
export function resetDeviceTokenCache(): void {
  cached = undefined
}
