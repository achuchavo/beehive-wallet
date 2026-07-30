// Where the app is running, and where the API lives from here.
//
// The web app and the native shells run the SAME bundle, but they reach the API
// differently and there is no way around it:
//
//   Web    - same-origin. Relative URLs, and the PHP session cookie rides along
//            (api.ts uses credentials: 'same-origin').
//   Native - cross-origin, always. Capacitor's WebView origin is
//            https://localhost (Android) or capacitor://localhost (iOS) and can
//            never be the API's own origin, because Capacitor's local server
//            claims every path on whatever host it is given - point it at
//            wallet.beehive.kr and /api/* would resolve to bundled assets. So
//            the API is addressed absolutely, and since neither cookie is sent
//            cross-site (session is SameSite=Strict, remember is Lax), native
//            authenticates with a bearer token instead. See auth/deviceToken.ts
//            and api/common.php require_trusted_caller().

import { Capacitor } from '@capacitor/core'

export type NativePlatform = 'ios' | 'android'

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

/** The native platform, or null on the web. Narrowed to what the API accepts. */
export function nativePlatform(): NativePlatform | null {
  if (!isNative()) return null
  const p = Capacitor.getPlatform()
  return p === 'ios' || p === 'android' ? p : null
}

/**
 * Root of the JSON API, with NO trailing slash. Callers append "/<endpoint>".
 *
 * Deliberately two separate branches rather than one string built with
 * replace('//', '/'): that collapse is correct for a relative base ("//api" ->
 * "/api") and catastrophic for an absolute one, where it would turn
 * "https://host" into "https:/host".
 */
export function apiRoot(): string {
  if (isNative()) {
    const origin = import.meta.env.VITE_API_ORIGIN
    if (!origin) {
      // A native build without an API origin can only fail at the first
      // request, in whatever confusing way the fetch happens to fail. Saying so
      // here points at the actual mistake: the build, not the network.
      throw new Error('VITE_API_ORIGIN must be set for native builds')
    }
    return `${origin.replace(/\/$/, '')}/api`
  }
  // Same-origin. BASE_URL always begins and ends with "/" ("/" or "/wallet/"),
  // and the origin never ends with one, so this composes cleanly into
  // ".../api" or ".../wallet/api" - where deploy.ps1 puts the PHP endpoints.
  return `${window.location.origin}${import.meta.env.BASE_URL}api`
}
