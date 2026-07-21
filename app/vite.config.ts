import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev server proxies /api to local Apache so the PHP endpoints work during development.
// In production the app is served from beehive.achumuamah.com with /api on the same origin.
// base is /wallet/ while the site lives at achumuamah.com/wallet.
// When beehive.achumuamah.com goes live, change base to '/'.
export default defineConfig({
  base: '/wallet/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Local Apache only serves the site over HTTPS (port 80 redirects),
      // so target 443 directly and present the vhost's Host header.
      '/wallet/api': {
        target: 'https://127.0.0.1',
        secure: false,
        headers: { host: 'achumuamah.com' },
      },
      // Public LCDs don't send CORS headers, so the dev server relays them.
      // In production our own node's nginx adds CORS and this proxy isn't used.
      '/lcd/medibloc': {
        target: 'https://api.gopanacea.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lcd\/medibloc/, ''),
      },
      '/rpc/medibloc': {
        target: 'https://rpc.gopanacea.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rpc\/medibloc/, ''),
      },
    },
  },
})
