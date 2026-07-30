// Build the web assets for the Capacitor shell, then copy them into the native
// projects.
//
// A script rather than an inline npm script because the env vars have to be set
// cross-platform: `VITE_BASE=/ vite build` is a POSIX-ism that does nothing on
// Windows cmd, which is where this repo is usually built from (see deploy.ps1,
// which sets $env: for exactly this reason).
//
// The native build differs from the web build in two ways that must not leak
// into `dist`:
//   - base is always '/' - a '/wallet/' base would not resolve inside the
//     app bundle, where there is no /wallet directory.
//   - output goes to dist-native, so deploy.ps1 and the release workflow (both
//     of which read `dist`) can never pick it up.

import { spawnSync } from 'node:child_process'

// Where the app talks to the API. Native builds MUST address it absolutely: the
// WebView origin is localhost, never the API's host. Overridable so a build can
// be pointed at the dev origin for testing before prod is touched.
const apiOrigin = process.env.VITE_API_ORIGIN || 'https://wallet.beehive.kr'

const env = {
  ...process.env,
  VITE_BASE: '/',
  VITE_OUT_DIR: 'dist-native',
  VITE_API_ORIGIN: apiOrigin,
  // Switches on the native Content-Security-Policy meta tag (see vite.config).
  VITE_NATIVE: '1',
}

console.log(`building native bundle against API origin ${apiOrigin}`)

// Each tool is invoked through its JS entrypoint with the CURRENT node binary,
// never through npm/npx. Those are .cmd shims on Windows, and since Node 20 a
// .cmd cannot be spawned without a shell (it fails with EINVAL) - while
// shell: true would concatenate the arguments rather than escape them. Going
// straight to the entrypoint avoids both, and needs no shell at all.
function run(label, scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    env,
  })
  if (result.error) {
    console.error(`${label} could not start: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`${label} failed with exit code ${result.status}`)
    process.exit(result.status ?? 1)
  }
}

// Mirrors `npm run build` (tsc -b && vite build) so the native bundle is held to
// exactly the same typecheck as the web one.
run('tsc', 'node_modules/typescript/bin/tsc', ['-b'])
run('vite build', 'node_modules/vite/bin/vite.js', ['build'])
// `sync` = copy the web assets into each native project + update native deps.
// Safe to run when only one platform exists; it skips what is not installed.
run('cap sync', 'node_modules/@capacitor/cli/bin/capacitor', ['sync'])
