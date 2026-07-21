import { useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate, Link } from 'react-router-dom'
import {
  LayoutDashboard,
  SendHorizontal,
  Coins,
  Gift,
  History as HistoryIcon,
  Bell,
  Settings as SettingsIcon,
  ShieldCheck,
  Info,
  TriangleAlert,
  OctagonAlert,
  LogOut,
  LogIn,
  UserCircle,
} from 'lucide-react'
import { api, type Announcement } from './api'
import { useAuth } from './auth/AuthContext'
import Dashboard from './pages/Dashboard'
import Send from './pages/Send'
import Staking from './pages/Staking'
import Rewards from './pages/Rewards'
import History from './pages/History'
import Alarms from './pages/Alarms'
import Settings from './pages/Settings'
import Admin from './pages/Admin'

const NAV = [
  { to: '/', label: 'Dashboard', Icon: LayoutDashboard },
  { to: '/send', label: 'Send / receive', Icon: SendHorizontal },
  { to: '/staking', label: 'Staking', Icon: Coins },
  { to: '/rewards', label: 'Rewards', Icon: Gift },
  { to: '/history', label: 'History', Icon: HistoryIcon },
  { to: '/alarms', label: 'Alarms', Icon: Bell },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
]

const BANNER_STYLE: Record<Announcement['severity'], string> = {
  info: 'bg-blue-50 text-blue-800 border-blue-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-red-50 text-red-800 border-red-200',
}

const BANNER_ICON: Record<Announcement['severity'], typeof Info> = {
  info: Info,
  warning: TriangleAlert,
  danger: OctagonAlert,
}

function App() {
  const auth = useAuth()
  const isAdmin = auth.status === 'in' && auth.isAdmin
  const [banner, setBanner] = useState<Announcement | null>(null)

  useEffect(() => {
    const loadBanner = () =>
      api
        .announcementGet()
        .then((r) => setBanner(r.announcement))
        .catch(() => {})
    loadBanner()
    const t = setInterval(loadBanner, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const nav = isAdmin ? [...NAV, { to: '/admin', label: 'Admin', Icon: ShieldCheck }] : NAV
  const BannerIcon = banner ? BANNER_ICON[banner.severity] : Info

  return (
    <div className="min-h-screen md:flex">
      <nav className="fixed bottom-0 inset-x-0 z-10 flex justify-around border-t border-slate-200 bg-white py-1 md:static md:block md:w-56 md:shrink-0 md:border-t-0 md:border-r md:px-3 md:py-6">
        <div className="hidden md:flex items-center gap-2 px-3 pb-6 font-semibold text-amber-600">
          <img src={`${import.meta.env.BASE_URL}beehive.ico`} alt="" className="h-6 w-6" />
          Beehive Wallet
        </div>
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 rounded-lg px-3 py-2 text-xs md:flex-row md:gap-2.5 md:text-sm ${
                isActive
                  ? 'bg-amber-50 font-medium text-amber-700'
                  : 'text-slate-600 hover:bg-slate-100'
              }`
            }
          >
            <item.Icon className="h-5 w-5 md:h-4 md:w-4" strokeWidth={1.8} />
            <span className="hidden sm:inline">{item.label}</span>
          </NavLink>
        ))}

        <div className="hidden md:mt-auto md:block md:border-t md:border-slate-200 md:pt-4">
          {auth.status === 'in' ? (
            <div className="px-3">
              <div className="flex items-center gap-2 text-sm">
                <UserCircle className="h-5 w-5 shrink-0 text-slate-400" strokeWidth={1.8} />
                <span className="truncate text-slate-700" title={auth.email ?? ''}>
                  {auth.email}
                </span>
              </div>
              <button
                onClick={() => auth.logout()}
                className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 hover:text-amber-700"
              >
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </button>
            </div>
          ) : auth.status === 'out' ? (
            <Link
              to="/alarms"
              className="mx-3 flex items-center gap-1.5 text-sm text-amber-700 hover:underline"
            >
              <LogIn className="h-4 w-4" /> Sign in
            </Link>
          ) : null}
        </div>
      </nav>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-20 pt-6 md:pb-6">
        {banner && (
          <div
            className={`mb-4 flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm ${BANNER_STYLE[banner.severity]}`}
          >
            <BannerIcon className="h-4 w-4 shrink-0" />
            {banner.message}
          </div>
        )}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/send" element={<Send />} />
          <Route path="/staking" element={<Staking />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/history" element={<History />} />
          <Route path="/alarms" element={<Alarms />} />
          <Route path="/settings" element={<Settings />} />
          <Route
            path="/admin"
            element={
              auth.status === 'loading' ? (
                <p className="text-sm text-slate-500">Loading...</p>
              ) : isAdmin ? (
                <Admin />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
        </Routes>
      </main>
    </div>
  )
}

export default App
