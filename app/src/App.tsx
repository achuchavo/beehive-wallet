import { useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate, Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  SendHorizontal,
  Coins,
  Gift,
  History as HistoryIcon,
  Bell,
  Settings as SettingsIcon,
  ShieldCheck,
  BookOpen,
  Activity,
  Info,
  TriangleAlert,
  OctagonAlert,
  LogOut,
  LogIn,
  UserCircle,
  Menu as MenuIcon,
  X,
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
import Docs from './pages/Docs'
import UptimeAlerts from './pages/UptimeAlerts'
import Admin from './pages/Admin'
import { useT } from './i18n/I18nContext'
import { LANGUAGES } from './i18n/i18n'
import Select from './components/Select'
import { useChains } from './chainStore'

const NAV = [
  { to: '/', key: 'nav.dashboard', Icon: LayoutDashboard },
  { to: '/send', key: 'nav.send', Icon: SendHorizontal },
  { to: '/staking', key: 'nav.validators', Icon: Coins },
  { to: '/rewards', key: 'nav.rewards', Icon: Gift },
  { to: '/history', key: 'nav.history', Icon: HistoryIcon },
  { to: '/alarms', key: 'nav.alarms', Icon: Bell },
  { to: '/settings', key: 'nav.settings', Icon: SettingsIcon },
  { to: '/docs', key: 'nav.docs', Icon: BookOpen },
]

// The few items that get a spot on the mobile bottom bar (rest live in the drawer).
const PRIMARY_PATHS = ['/', '/send', '/staking', '/alarms']

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
  const { t, lang, setLang } = useT()
  const location = useLocation()
  const isAdmin = auth.status === 'in' && auth.isAdmin
  // Reactive chain registry: re-renders when the DB config lands, and lets us
  // warn (and block signing) if it could not be loaded.
  const { status: chainStatus } = useChains()
  const [banner, setBanner] = useState<Announcement | null>(null)
  const [uptimeEnabled, setUptimeEnabled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const loadBanner = () =>
      api
        .announcementGet()
        .then((r) => setBanner(r.announcement))
        .catch(() => {})
    loadBanner()
    const id = setInterval(loadBanner, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    api
      .settingsPublic()
      .then((r) => setUptimeEnabled(r.uptime_alerts_enabled))
      .catch(() => {})
  }, [])

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setMenuOpen(false), [location.pathname])

  let nav = [...NAV]
  if (uptimeEnabled) nav = [...nav, { to: '/uptime', key: 'nav.uptime', Icon: Activity }]
  if (isAdmin) nav = [...nav, { to: '/admin', key: 'nav.admin', Icon: ShieldCheck }]

  // Data-heavy routes get a wider desktop column; simple forms stay focused.
  const WIDE_ROUTES = ['/admin', '/staking', '/history', '/rewards', '/uptime']
  const wide = WIDE_ROUTES.includes(location.pathname)
  const primary = NAV.filter((n) => PRIMARY_PATHS.includes(n.to))
  const BannerIcon = banner ? BANNER_ICON[banner.severity] : Info

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${
      isActive ? 'bg-amber-50 font-medium text-amber-700' : 'text-slate-600 hover:bg-slate-100'
    }`

  const account = (
    <>
      {auth.status === 'in' ? (
        <div className="px-3">
          <div className="flex items-center gap-2 text-sm">
            <UserCircle className="h-5 w-5 shrink-0 text-slate-500" strokeWidth={1.8} />
            <span className="truncate text-slate-700" title={auth.email ?? ''}>
              {auth.email}
            </span>
          </div>
          <button
            onClick={() => auth.logout()}
            className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500 hover:text-amber-700"
          >
            <LogOut className="h-3.5 w-3.5" /> {t('account.signOut')}
          </button>
        </div>
      ) : auth.status === 'out' ? (
        <Link
          to="/alarms"
          className="mx-3 flex items-center gap-1.5 text-sm text-amber-700 hover:underline"
        >
          <LogIn className="h-4 w-4" /> {t('account.signIn')}
        </Link>
      ) : null}
    </>
  )

  const langSwitcher = (
    <Select
      full
      value={lang}
      onChange={(e) => setLang(e.target.value as typeof lang)}
      className="text-xs"
      aria-label={t('common.language')}
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </Select>
  )

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop sidebar */}
      <nav className="hidden md:flex md:w-56 md:shrink-0 md:flex-col md:border-r md:border-slate-200 md:px-3 md:py-6">
        <div className="flex items-center gap-2 px-3 pb-4 font-semibold text-amber-700">
          <img src={`${import.meta.env.BASE_URL}beehive.ico`} alt="" className="h-6 w-6" />
          Beehive Wallet
        </div>
        <div className="mb-4 border-b border-slate-200 pb-4">{account}</div>
        <div className="space-y-0.5">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navLinkClass}>
              <item.Icon className="h-4 w-4" strokeWidth={1.8} />
              {t(item.key)}
            </NavLink>
          ))}
        </div>
        <div className="mt-auto px-3 pt-4">{langSwitcher}</div>
      </nav>

      {/* Mobile slide-in drawer */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${
          menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[80%] transform flex-col overflow-y-auto bg-white shadow-xl transition-transform md:hidden ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!menuOpen}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <span className="flex items-center gap-2 font-semibold text-amber-700">
            <img src={`${import.meta.env.BASE_URL}beehive.ico`} alt="" className="h-6 w-6" />
            Beehive Wallet
          </span>
          <button
            onClick={() => setMenuOpen(false)}
            aria-label={t('common.close')}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mb-3 border-y border-slate-200 py-3">{account}</div>
        <div className="space-y-0.5 px-2">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMenuOpen(false)}
              className={navLinkClass}
            >
              <item.Icon className="h-4 w-4" strokeWidth={1.8} />
              {t(item.key)}
            </NavLink>
          ))}
        </div>
        <div className="mt-auto px-4 py-4">{langSwitcher}</div>
      </aside>

      {/* Mobile bottom bar: primary items (labelled) + Menu */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] pt-1 md:hidden">
        {primary.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1 text-[11px] ${
                isActive ? 'font-medium text-amber-700' : 'text-slate-500 hover:text-amber-700'
              }`
            }
          >
            <item.Icon className="h-5 w-5" strokeWidth={1.8} />
            {t(item.key)}
          </NavLink>
        ))}
        <button
          onClick={() => setMenuOpen(true)}
          className="flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1 text-[11px] text-slate-500 hover:text-amber-700"
        >
          <MenuIcon className="h-5 w-5" strokeWidth={1.8} />
          {t('nav.menu')}
        </button>
      </nav>

      <main
        className={`mx-auto w-full flex-1 px-4 pb-24 pt-6 md:pb-6 ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}
      >
        {banner && (
          <div
            className={`mb-4 flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm ${BANNER_STYLE[banner.severity]}`}
          >
            <BannerIcon className="h-4 w-4 shrink-0" />
            {banner.message}
          </div>
        )}
        {/* Signing is blocked while this is showing (see wallet/tx.ts), so say
            so rather than letting a transaction fail with a cryptic error. */}
        {chainStatus !== 'ready' && (
          <div
            role="status"
            className={`mb-4 flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm ${
              chainStatus === 'error'
                ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
          >
            <TriangleAlert className="h-4 w-4 shrink-0" />
            {chainStatus === 'error' ? t('chains.loadError') : t('chains.loading')}
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
          <Route path="/docs" element={<Docs />} />
          <Route path="/uptime" element={<UptimeAlerts />} />
          <Route
            path="/admin"
            element={
              auth.status === 'loading' ? (
                <p className="text-sm text-slate-500">{t('common.loading')}</p>
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
