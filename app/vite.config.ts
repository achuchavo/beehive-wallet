/// <reference types="vitest/config" />
// The reference (rather than importing defineConfig from 'vitest/config') adds
// the `test` key to Vite's config type without making the build config import
// the test runner.
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'

// base is '/wallet/' for the path deploy (achumuamah.com/wallet) and '/' for the
// subdomain deploy (wallet.achumuamah.com). Set VITE_BASE=/ to build the latter.
const base = process.env.VITE_BASE || '/wallet/'

// Public origin baked into the Open Graph tags in index.html (%VITE_SITE_URL%).
// Kept here rather than in .env because .env is gitignored, and this is a public
// URL, not a secret - a fresh clone must still build correct share tags.
// Social crawlers do not run JavaScript, so this cannot be resolved at runtime.
//
// TO MOVE TO THE OFFICIAL DOMAIN: change this value (or export VITE_SITE_URL)
// and rebuild. No trailing slash.
process.env.VITE_SITE_URL ||= 'https://wallet.achumuamah.com'

// Dev server proxies API calls to local Apache so the PHP endpoints work during
// development. The proxy path matches the base so it works for both builds.
// The source commit, baked into the bundle so the app can show which public
// commit it was built from (see components/BuildBadge). CI passes VITE_COMMIT;
// locally we read it from git; 'dev' when neither is available.
const buildCommit =
  process.env.VITE_COMMIT ||
  (() => {
    try {
      return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
    } catch {
      return 'dev'
    }
  })()

/**
 * Content-Security-Policy for the NATIVE build only, injected as a meta tag.
 *
 * The web app gets its CSP from an Apache header (app/public/.htaccess). A
 * bundled WebView is not served by Apache, so without this the native app would
 * ship with no policy at all.
 *
 * It is injected rather than written into index.html because the two policies
 * genuinely differ: the web is same-origin, while native must reach the API
 * across origins. A shared meta tag would be intersected with the Apache header
 * on the web, which is fragile and easy to get subtly wrong.
 *
 * Mirrors the .htaccess policy otherwise - keep the two in step.
 */
function nativeCsp(): Plugin {
  return {
    name: 'beehive-native-csp',
    transformIndexHtml(html) {
      if (!process.env.VITE_NATIVE) return html

      const apiOrigin = process.env.VITE_API_ORIGIN
      if (!apiOrigin) throw new Error('VITE_API_ORIGIN must be set for native builds')

      const csp = [
        // 'self' is the WebView origin (https://localhost / capacitor://localhost).
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        // No frame-ancestors: it is IGNORED in a meta-delivered policy (the
        // WebView logs a warning saying so), and listing it would imply a
        // protection that is not in force. It is also moot here - a native
        // WebView has no embedding context for a frame to sit in. The web build
        // still asserts it via the Apache header, where it does work.
        "form-action 'self'",
        "script-src 'self'",
        // React inline style attributes / Tailwind. Scripts stay strict.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self'",
        // The API and the RPC/LCD proxies behind it, plus Keybase for validator
        // avatars - the same two exceptions the web policy carries.
        `connect-src 'self' ${apiOrigin} https://keybase.io`,
        "worker-src 'self'",
        "manifest-src 'self'",
      ].join('; ')

      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
            injectTo: 'head-prepend',
          },
        ],
      }
    },
  }
}

export default defineConfig({
  base,
  build: {
    // The native shell builds into its own directory (see capacitor.config.ts).
    // Keeping it out of `dist` means a Capacitor bundle - different base,
    // different API wiring - can never be picked up by deploy.ps1 or by the
    // release workflow's hash manifest, both of which read `dist`.
    outDir: process.env.VITE_OUT_DIR || 'dist',
  },
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
  plugins: [react(), tailwindcss(), nativeCsp()],
  server: {
    proxy: {
      // Route API calls to the live subdomain vhost. The /wallet path now 301s
      // to the subdomain, so target it directly and strip the base prefix.
      [`${base}api`.replace('//', '/')]: {
        target: 'https://wallet.achumuamah.com',
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(base.replace(/\/$/, ''), ''),
      },
    },
  },
  test: {
    /**
     * Vitest's default is 5s, which the wallet crypto tests can exceed on a
     * loaded machine.
     *
     * They are slow BY DESIGN: encrypt/decrypt derive a key with PBKDF2 at
     * 600,000 iterations (300,000 for the legacy v1 payload), which is the
     * whole point - it is what makes a stolen wallet file expensive to attack.
     * Each takes ~120ms idle, but the suite runs files in parallel and a
     * concurrent `npm run build` is enough to push one past five seconds.
     *
     * The symptom was a test failing roughly twice in forty runs with no
     * pattern, which reads as flakiness in the code under test rather than as
     * the harness being impatient. Raised rather than lowering the iteration
     * count: the cost is a security property, not a performance bug.
     */
    testTimeout: 30_000,
  },
})
