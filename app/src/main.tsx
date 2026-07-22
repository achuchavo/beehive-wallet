import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { WalletProvider } from './wallet/WalletContext.tsx'
import { AuthProvider } from './auth/AuthContext.tsx'
import { I18nProvider } from './i18n/I18nContext.tsx'
import { loadChains } from './chainStore.ts'

// Refresh chain metadata/endpoints from the DB; bootstrap config covers first paint.
loadChains()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <I18nProvider>
        <AuthProvider>
          <WalletProvider>
            <App />
          </WalletProvider>
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
)
