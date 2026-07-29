/// <reference types="vitest/config" />
// The reference (rather than importing defineConfig from 'vitest/config') adds
// the `test` key to Vite's config type without making the build config import
// the test runner.
import { defineConfig } from 'vite'
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

export default defineConfig({
  base,
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
  plugins: [react(), tailwindcss()],
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
