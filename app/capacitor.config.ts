import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Native shell config. The web app at wallet.beehive.kr is unaffected by any of
 * this - Capacitor is strictly additive, and nothing here is read by a browser.
 *
 * ORIGIN (do not change after a release):
 * The WebView keeps Capacitor's default `localhost` host, giving an origin of
 * `https://localhost` on Android and `capacitor://localhost` on iOS. It is
 * tempting to set `server.hostname` to wallet.beehive.kr so API calls stay
 * same-origin, but that CANNOT work:
 *
 *   - iOS: `iosScheme` may not be http/https (WKWebView reserves both), so the
 *     origin is `capacitor://...` regardless and is cross-origin either way.
 *   - Android: WebViewLocalServer routes every request whose host matches the
 *     WebView host to the local bundle - and registers that host with a `**`
 *     wildcard over all paths. Pointing it at wallet.beehive.kr would make
 *     /api/* and the RPC/LCD proxies resolve to local assets instead of the
 *     server.
 *
 * So the API is reached cross-origin at its real origin (see VITE_API_ORIGIN),
 * which also means native auth uses a bearer token rather than the PHP session
 * cookie: WKWebView's tracking prevention drops cross-origin cookies.
 *
 * The origin also decides the localStorage partition. Changing it in a later
 * release would make every stored wallet appear to vanish, so it is fixed.
 */
const config: CapacitorConfig = {
  appId: 'kr.beehive.wallet',
  appName: 'Beehive Wallet',

  // Built by scripts/build-native.mjs, kept separate from `dist` so a native
  // bundle can never be deployed to the web (or the reverse) by accident - the
  // two are built with different bases and different API wiring.
  webDir: 'dist-native',

  // Matches the PWA manifest's background_color, so the launch window does not
  // flash a different colour than the splash screen.
  backgroundColor: '#ffffff',

  android: {
    // Remote debugging of the WebView. Capacitor already enables this for debug
    // builds only, and false is the default - it is set explicitly because for a
    // wallet "release builds are not inspectable" is a property worth being able
    // to point at in the config rather than inferring from a default.
    webContentsDebuggingEnabled: false,
    // Reject non-HTTPS content outright rather than allowing it inside HTTPS
    // pages. Every endpoint the app talks to is HTTPS.
    allowMixedContent: false,
  },

  ios: {
    webContentsDebuggingEnabled: false,
  },
}

export default config
