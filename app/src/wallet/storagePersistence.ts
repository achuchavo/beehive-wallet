/**
 * Whether the browser will actually KEEP the wallets we put in localStorage.
 *
 * A reported case: a user imported a wallet on an Android phone, left the app,
 * came back, and it was gone. Nothing was lost on chain - the wallet file is
 * only an encrypted key - but from the user's side their wallet vanished, which
 * is indistinguishable from losing money until somebody explains otherwise.
 *
 * There are two separate causes and they need different answers.
 *
 * 1. EVICTABLE STORAGE. By default a site's storage is "best-effort": the
 *    browser may clear it under storage pressure, and some Android browsers are
 *    aggressive about it. navigator.storage.persist() asks for "persistent"
 *    instead, which is not evicted without the user deliberately clearing site
 *    data. Chrome grants it silently to installed or frequently-used sites.
 *
 * 2. AN IN-APP BROWSER. A link opened inside KakaoTalk, Instagram, Line and so
 *    on runs in a WebView with its own short-lived storage jar, often wiped when
 *    that view closes - and it is a DIFFERENT jar from the user's real browser,
 *    so a wallet created there is invisible afterwards even if it survives. No
 *    API can fix this; the only remedy is to tell the user to open the site in
 *    their actual browser before creating a wallet.
 */

export interface StorageState {
  /** The Storage API exists and we could ask. */
  supported: boolean
  /** Storage is persistent: not evicted without the user clearing site data. */
  persisted: boolean
  /** Running inside an app's embedded WebView, where storage is often ephemeral. */
  inAppBrowser: boolean
}

/**
 * Best-effort detection of an embedded WebView.
 *
 * User-agent sniffing, which is brittle in general - but these apps append a
 * distinctive token precisely so sites can recognise them, and the cost of a
 * false positive here is one extra warning, while the cost of a false negative
 * is a user believing they lost a wallet. Erring toward warning is right.
 */
export function isInAppBrowser(ua: string = navigator.userAgent): boolean {
  return /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|kakaostory/i.test(ua)
}

/** Ask the browser to keep our storage. Safe to call repeatedly. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    // Already granted: asking again is a no-op but costs a permission check.
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

/** What we can tell the user about the durability of their wallets. */
export async function getStorageState(): Promise<StorageState> {
  const inAppBrowser = isInAppBrowser()
  try {
    if (!navigator.storage?.persisted) {
      return { supported: false, persisted: false, inAppBrowser }
    }
    return { supported: true, persisted: await navigator.storage.persisted(), inAppBrowser }
  } catch {
    return { supported: false, persisted: false, inAppBrowser }
  }
}

/**
 * True when the user should be warned that a wallet stored here might not
 * survive.
 *
 * An in-app browser always warrants it. Otherwise only a browser that SUPPORTS
 * the API and told us "not persistent" does - a browser without the API is not
 * evidence of a problem, and warning everyone on those would be noise that
 * teaches people to ignore the message.
 */
export function storageAtRisk(s: StorageState): boolean {
  return s.inAppBrowser || (s.supported && !s.persisted)
}
