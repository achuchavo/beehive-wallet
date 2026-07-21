import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base is '/wallet/' for the path deploy (achumuamah.com/wallet) and '/' for the
// subdomain deploy (wallet.achumuamah.com). Set VITE_BASE=/ to build the latter.
const base = process.env.VITE_BASE || '/wallet/'

// Dev server proxies API calls to local Apache so the PHP endpoints work during
// development. The proxy path matches the base so it works for both builds.
export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Local Apache only serves the site over HTTPS (port 80 redirects),
      // so target 443 directly and present the vhost's Host header.
      [`${base}api`.replace('//', '/')]: {
        target: 'https://127.0.0.1',
        secure: false,
        headers: { host: 'achumuamah.com' },
      },
    },
  },
})
