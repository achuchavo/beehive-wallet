import { useEffect, useState } from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import { api, type Announcement } from './api'
import Dashboard from './pages/Dashboard'
import Send from './pages/Send'
import Staking from './pages/Staking'
import History from './pages/History'
import Alarms from './pages/Alarms'
import Settings from './pages/Settings'
import Admin from './pages/Admin'

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/send', label: 'Send / receive' },
  { to: '/staking', label: 'Staking' },
  { to: '/history', label: 'History' },
  { to: '/alarms', label: 'Alarms' },
  { to: '/settings', label: 'Settings' },
]

const BANNER_STYLE: Record<Announcement['severity'], string> = {
  info: 'bg-blue-50 text-blue-800 border-blue-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-red-50 text-red-800 border-red-200',
}

function App() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [banner, setBanner] = useState<Announcement | null>(null)

  useEffect(() => {
    api
      .me()
      .then((r) => setIsAdmin(r.logged_in && r.is_admin === true))
      .catch(() => setIsAdmin(false))

    const loadBanner = () =>
      api
        .announcementGet()
        .then((r) => setBanner(r.announcement))
        .catch(() => {})
    loadBanner()
    const t = setInterval(loadBanner, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const nav = isAdmin ? [...NAV, { to: '/admin', label: 'Admin' }] : NAV

  return (
    <div className="min-h-screen md:flex">
      <nav className="fixed bottom-0 inset-x-0 z-10 flex justify-around border-t border-slate-200 bg-white py-1 md:static md:block md:w-56 md:shrink-0 md:border-t-0 md:border-r md:px-3 md:py-6">
        <div className="hidden md:flex items-center gap-2 px-3 pb-6 font-semibold text-amber-600">
          Beehive Wallet
        </div>
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2 text-sm ${
                isActive
                  ? 'bg-amber-50 font-medium text-amber-700'
                  : 'text-slate-600 hover:bg-slate-100'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-20 pt-6 md:pb-6">
        {banner && (
          <div
            className={`mb-4 rounded-lg border px-4 py-3 text-sm ${BANNER_STYLE[banner.severity]}`}
          >
            {banner.message}
          </div>
        )}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/send" element={<Send />} />
          <Route path="/staking" element={<Staking />} />
          <Route path="/history" element={<History />} />
          <Route path="/alarms" element={<Alarms />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
