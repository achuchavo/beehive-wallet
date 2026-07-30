import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import { WalletProvider } from './wallet/WalletContext.tsx'
import { AuthProvider } from './auth/AuthContext.tsx'
import { I18nProvider } from './i18n/I18nContext.tsx'
import { loadChains, watchChainConfig } from './chainStore.ts'

// Refresh chain metadata/endpoints from the DB; bootstrap config covers first paint.
loadChains()
// And keep it fresh. The registry used to load only here, so an admin change to
// a staking policy, fee or validator list did not reach an already-open tab
// until a hard reload.
watchChainConfig()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <I18nProvider>
        <AuthProvider>
          <WalletProvider>
            <ErrorBoundary>
          <App />
        </ErrorBoundary>
          </WalletProvider>
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
)
