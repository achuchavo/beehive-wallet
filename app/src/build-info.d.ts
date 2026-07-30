// The source commit this bundle was built from, injected at build time by
// vite.config.ts (define). Used by the in-app "Build … · Verify" footer so a
// user can tie the running app to a public commit. "dev" for local dev builds.
declare const __BUILD_COMMIT__: string

interface ImportMetaEnv {
  /**
   * Absolute origin of the JSON API, e.g. "https://wallet.beehive.kr".
   *
   * Set ONLY for native builds (see scripts/build-native.mjs). The web app
   * leaves it undefined and keeps calling the API relative to its own origin,
   * which is what makes the PHP session cookie work there. See src/platform.ts.
   */
  readonly VITE_API_ORIGIN?: string
}
