import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev server proxies /api to local Apache so the PHP endpoints work during development.
// In production the app is served from beehive.achumuamah.com with /api on the same origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/wallet/api'),
      },
      // Public LCDs don't send CORS headers, so the dev server relays them.
      // In production our own node's nginx adds CORS and this proxy isn't used.
      '/lcd/medibloc': {
        target: 'https://api.gopanacea.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lcd\/medibloc/, ''),
      },
    },
  },
})
